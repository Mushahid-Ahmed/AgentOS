import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryEvidence } from '@/lib/evidence'
import { RESEARCH_TOOL } from '@/lib/mcp/research'
import type { ToolResult } from '@/lib/orchestra/types'
import { buildEvidence, readResearchOutput, runResearchStep } from './researcher-core'

// The Researcher's honesty contract, proven at $0 with a mocked research tool and an
// in-memory evidence hub. The rules that matter (§8/§13): a real span -> a real
// source-backed claim; NO usable span -> one coarse record with a null source rather
// than a fabricated per-citation link; a failed tool fails the step; the tool's spend
// is never double-counted into StepResult.costMicroUsd.

const okTool = (output: unknown): ToolResult => ({ ok: true, output, summary: 'research' })

// A structured research result shaped exactly like the server's structuredContent.
const research = (text: string, citations: unknown[], costMicroUsd?: number) => ({
	text,
	citations,
	...(costMicroUsd == null ? {} : { costMicroUsd })
})

test('span-backed citations become sourced evidence records, findings carry the URLs', async () => {
	const text = 'Apple revenue was $391B. Costs were flat.'
	const citations = [
		{ url: 'https://sec.gov/a', title: 'Apple 10-K', startIndex: 0, endIndex: 24 },
		{ url: 'https://macrotrends.net/b', startIndex: 25, endIndex: 41 }
	]
	const evidence = createMemoryEvidence()
	let toolArgs: unknown
	const result = await runResearchStep({
		query: 'Apple finances',
		runId: '42',
		evidence,
		callTool: async (_name, args) => {
			toolArgs = args
			return okTool(research(text, citations, 5100))
		}
	})

	assert.equal(result.ok, true)
	// runId is threaded to the tool so its ledger row is attributable to the run.
	assert.deepEqual(toolArgs, { query: 'Apple finances', runId: '42' })
	// The tool's own cost must NOT be echoed as step cost (the executor already
	// recorded it) — that would double-count against the budget.
	assert.equal(result.costMicroUsd, undefined)

	const rows = await evidence.list()
	assert.equal(rows.length, 2)
	assert.equal(rows[0]?.claim, 'Apple revenue was $391B.')
	assert.equal(rows[0]?.source, 'https://sec.gov/a')
	assert.equal(rows[0]?.discoveredByAgent, 'researcher')
	assert.equal(rows[0]?.verificationStatus, 'unverified')
	assert.equal(rows[0]?.retrievedText, text)
	assert.equal(rows[1]?.claim, 'Costs were flat.')
	assert.equal(rows[1]?.source, 'https://macrotrends.net/b')

	const out = result.output as { text: string; citations: string[]; evidenceCount: number }
	assert.equal(out.evidenceCount, 2)
	assert.deepEqual(out.citations, ['https://sec.gov/a', 'https://macrotrends.net/b'])
	assert.match(out.text, /Sources:/)
	assert.match(out.text, /https:\/\/sec\.gov\/a/)
})

test('a failed research tool fails the step honestly (no invented sources)', async () => {
	const evidence = createMemoryEvidence()
	const result = await runResearchStep({
		query: 'q',
		runId: '1',
		evidence,
		callTool: async () => ({ ok: false, error: 'budget:max_tool_calls' })
	})
	assert.equal(result.ok, false)
	if (!result.ok) assert.match(result.error, /research_failed: budget:max_tool_calls/)
	assert.equal((await evidence.list()).length, 0)
})

test('citations with NO usable span still keep every real URL as a source', async () => {
	const text = 'A sourced-looking answer whose citations carried no indices.'
	const citations = [{ url: 'https://a.example' }, { url: 'https://b.example' }, { url: 'https://a.example' }]
	const evidence = createMemoryEvidence()
	const result = await runResearchStep({
		query: 'q',
		runId: '1',
		evidence,
		callTool: async () => okTool(research(text, citations))
	})
	assert.equal(result.ok, true)
	const rows = await evidence.list()
	// One record per UNIQUE real URL sonar returned (the duplicate collapses) — the URLs
	// are never thrown away just because sonar omitted span indices. Each attributes the
	// whole finding to that source rather than fabricating a per-citation sub-claim.
	assert.equal(rows.length, 2)
	assert.deepEqual(rows.map((r) => r.source), ['https://a.example', 'https://b.example'])
	for (const row of rows) {
		assert.equal(row.retrievedText, text)
		assert.match(row.claim, /sourced-looking answer/)
		assert.equal(row.verificationStatus, 'unverified')
	}
	// The step echoes the tool's raw citation list (the parser upstream already dedups
	// real sonar output); the evidence hub is what de-duplicates by URL.
	const out = result.output as { citations: string[]; evidenceCount: number }
	assert.deepEqual(out.citations, ['https://a.example', 'https://b.example', 'https://a.example'])
	assert.equal(out.evidenceCount, 2)
})

test('no-span citations are capped at MAX_EVIDENCE', () => {
	const many = Array.from({ length: 12 }, (_v, i) => ({ url: `https://n${i}.example` }))
	assert.equal(buildEvidence('An answer with many sources but no spans.', many, 'researcher').length, 8)
})

test('no citations at all still records the retrieved answer as coarse evidence', async () => {
	const evidence = createMemoryEvidence()
	await runResearchStep({
		query: 'q',
		runId: '1',
		evidence,
		callTool: async () => okTool(research('Just an answer, no sources.', []))
	})
	const rows = await evidence.list()
	assert.equal(rows.length, 1)
	assert.equal(rows[0]?.claim, 'Just an answer, no sources.')
	assert.equal(rows[0]?.source, null)
})

test('an empty answer yields zero evidence and an honest "no content" finding', async () => {
	const evidence = createMemoryEvidence()
	const result = await runResearchStep({
		query: 'q',
		runId: '1',
		evidence,
		callTool: async () => okTool(research('', []))
	})
	assert.equal(result.ok, true)
	assert.equal((await evidence.list()).length, 0)
	const out = result.output as { text: string; evidenceCount: number }
	assert.equal(out.text, 'Research returned no content.')
	assert.equal(out.evidenceCount, 0)
})

test('buildEvidence de-duplicates identical spans and caps the fan-out', () => {
	const text = 'Revenue rose. Costs fell.'
	const dupes = [
		{ url: 'https://a.example', startIndex: 0, endIndex: 13 }, // 'Revenue rose.'
		{ url: 'https://b.example', startIndex: 0, endIndex: 13 }, // identical span -> deduped
		{ url: 'https://c.example', startIndex: 14, endIndex: 25 } // 'Costs fell.'
	]
	const rows = buildEvidence(text, dupes, 'researcher')
	assert.equal(rows.length, 2)
	assert.equal(rows[0]?.claim, 'Revenue rose.')
	assert.equal(rows[0]?.source, 'https://a.example')
	assert.equal(rows[1]?.claim, 'Costs fell.')
	assert.equal(rows[1]?.source, 'https://c.example')

	// Cap: 12 DISTINCT span-bearing citations write only MAX_EVIDENCE (8).
	const distinct = Array.from({ length: 12 }, (_v, i) => ({
		url: `https://d${i}.example`,
		startIndex: i,
		endIndex: i + 1
	}))
	assert.equal(buildEvidence('0123456789ab', distinct, 'researcher').length, 8)

	// 12 citations that all resolve to the SAME span text dedupe to 1.
	const wide = 'x'.repeat(200)
	const same = Array.from({ length: 12 }, (_v, i) => ({
		url: `https://s${i}.example`,
		startIndex: 0,
		endIndex: wide.length
	}))
	assert.equal(buildEvidence(wide, same, 'researcher').length, 1)
})

test('readResearchOutput is defensive about shape', () => {
	assert.deepEqual(readResearchOutput('plain summary'), { text: 'plain summary', citations: [] })
	assert.deepEqual(readResearchOutput(undefined), { text: '', citations: [] })
	assert.deepEqual(readResearchOutput(null), { text: '', citations: [] })
	assert.deepEqual(readResearchOutput(42), { text: '', citations: [] })
	assert.deepEqual(readResearchOutput({ text: 't', citations: 'nope' }), { text: 't', citations: [] })
	// Citations lacking a url are dropped; a valid one survives with its span.
	assert.deepEqual(readResearchOutput({ text: 't', citations: [{ title: 'x' }, { url: 'https://ok', startIndex: 1, endIndex: 4 }] }), {
		text: 't',
		citations: [{ url: 'https://ok', startIndex: 1, endIndex: 4 }]
	})
})

test('the research tool is called by its stable name', async () => {
	let calledWith = ''
	await runResearchStep({
		query: 'q',
		runId: '1',
		evidence: createMemoryEvidence(),
		callTool: async (name) => {
			calledWith = name
			return okTool(research('answer', []))
		}
	})
	assert.equal(calledWith, RESEARCH_TOOL)
})
