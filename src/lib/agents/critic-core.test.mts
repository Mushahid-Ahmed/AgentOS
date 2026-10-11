import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryEvidence } from '@/lib/evidence'
import type { CriticCompleter } from './critic-core'
import { parseCriticVerdict, runCriticStep } from './critic-core'

// The Fact-Checker's honesty contract, proven at $0 with a mocked completer and an
// in-memory hub. The rules that matter (§8): it only acts on ids that exist, an
// unparseable model reply leaves claims `unverified` rather than guessing, one bad
// verdict element doesn't discard the good ones, and a contradiction flips the row and
// contests both claims.

const completerReturning = (text: string, costMicroUsd = 700): CriticCompleter => async () => ({
	text,
	tokens: { input: 120, output: 40 },
	costMicroUsd
})

async function seed() {
	const evidence = createMemoryEvidence()
	const a = await evidence.add({ claim: 'Revenue grew 6% YoY', source: 'https://a.example', discoveredByAgent: 'researcher' })
	const b = await evidence.add({ claim: 'Revenue was flat YoY', source: 'https://b.example', discoveredByAgent: 'researcher' })
	return { evidence, a, b }
}

test('no evidence is a clean no-op success (the model is never called)', async () => {
	const evidence = createMemoryEvidence()
	let called = false
	const result = await runCriticStep({
		model: 'claude',
		evidence,
		completer: async () => {
			called = true
			return { text: '{}', tokens: { input: 0, output: 0 } }
		}
	})
	assert.equal(result.ok, true)
	assert.equal(called, false)
	const out = result.output as { checked: number }
	assert.equal(out.checked, 0)
})

test('verdicts are applied to real ids and a hallucinated id is ignored', async () => {
	const { evidence, a } = await seed()
	const result = await runCriticStep({
		model: 'claude',
		evidence,
		completer: completerReturning(
			JSON.stringify({
				verdicts: [
					{ id: a, status: 'verified', reason: 'SEC filing backs it' },
					{ id: '999', status: 'refuted' } // not in the hub -> ignored
				]
			})
		)
	})
	assert.equal(result.ok, true)
	const rows = await evidence.list()
	assert.equal(rows.find((r) => r.id === a)?.verificationStatus, 'verified')
	const out = result.output as { verdictsApplied: number; checked: number }
	assert.equal(out.verdictsApplied, 1)
	assert.equal(out.checked, 2)
	// The real model spend is reported for the budget guard.
	assert.equal(result.costMicroUsd, 700)
	assert.deepEqual(result.tokens, { input: 120, output: 40 })
})

test('a contradiction flips the row and contests both claims', async () => {
	const { evidence, a, b } = await seed()
	const result = await runCriticStep({
		model: 'claude',
		evidence,
		completer: completerReturning(
			JSON.stringify({
				verdicts: [{ id: a, status: 'verified' }],
				contradictions: [{ claimId: b, againstId: a, reason: 'grew vs flat' }]
			})
		)
	})
	assert.equal(result.ok, true)
	const rows = await evidence.list()
	const contra = rows.find((r) => r.id === b)
	assert.equal(contra?.relation, 'contradicts')
	assert.equal(contra?.referencesEvidenceId, a)
	// Both end contested — the earlier "verified" on `a` is overridden by the conflict.
	assert.equal(contra?.verificationStatus, 'contested')
	assert.equal(rows.find((r) => r.id === a)?.verificationStatus, 'contested')
	const out = result.output as { contradictions: number }
	assert.equal(out.contradictions, 1)
})

test('a self-contradiction (same id twice) is ignored', async () => {
	const { evidence, a } = await seed()
	const result = await runCriticStep({
		model: 'claude',
		evidence,
		completer: completerReturning(JSON.stringify({ contradictions: [{ claimId: a, againstId: a }] }))
	})
	assert.equal(result.ok, true)
	const out = result.output as { contradictions: number }
	assert.equal(out.contradictions, 0)
	const rows = await evidence.list()
	assert.equal(rows.find((r) => r.id === a)?.relation, 'supports')
})

test('an unknown routed model fails the step without a paid call', async () => {
	const { evidence } = await seed()
	let called = false
	const result = await runCriticStep({
		model: 'not-a-label',
		evidence,
		completer: async () => {
			called = true
			return { text: '{}', tokens: { input: 0, output: 0 } }
		}
	})
	assert.equal(result.ok, false)
	assert.equal(called, false)
	if (!result.ok) assert.match(result.error, /unknown_model/)
})

test('a thrown model call is retryable on 429/5xx and reports the status', async () => {
	const { evidence } = await seed()
	const failing: CriticCompleter = async () => {
		throw Object.assign(new Error('OpenRouter 503'), { status: 503 })
	}
	const result = await runCriticStep({ model: 'claude', evidence, completer: failing })
	assert.equal(result.ok, false)
	assert.equal(result.retryable, true)
})

test('parseCriticVerdict reads bare, fenced, and prose-wrapped JSON', () => {
	const shape = { verdicts: [{ id: '1', status: 'verified' }], contradictions: [] }
	assert.deepEqual(parseCriticVerdict(JSON.stringify(shape)).verdicts, [{ id: '1', status: 'verified' }])
	assert.deepEqual(parseCriticVerdict('```json\n' + JSON.stringify(shape) + '\n```').verdicts, [
		{ id: '1', status: 'verified' }
	])
	assert.deepEqual(parseCriticVerdict(`Sure! Here you go: ${JSON.stringify(shape)} Hope that helps.`).verdicts, [
		{ id: '1', status: 'verified' }
	])
})

test('parseCriticVerdict normalizes numeric ids to strings', () => {
	const parsed = parseCriticVerdict(JSON.stringify({ verdicts: [{ id: 3, status: 'refuted' }], contradictions: [{ claimId: 1, againstId: 2 }] }))
	assert.deepEqual(parsed.verdicts, [{ id: '3', status: 'refuted' }])
	assert.deepEqual(parsed.contradictions, [{ claimId: '1', againstId: '2' }])
})

test('parseCriticVerdict drops one bad element but keeps the good ones', () => {
	const parsed = parseCriticVerdict(
		JSON.stringify({
			verdicts: [
				{ id: '1', status: 'verified' },
				{ id: '2', status: 'not-a-real-status' }, // dropped
				{ id: '3', status: 'contested', reason: 'thin' }
			]
		})
	)
	assert.deepEqual(parsed.verdicts, [
		{ id: '1', status: 'verified' },
		{ id: '3', status: 'contested', reason: 'thin' }
	])
})

test('parseCriticVerdict degrades to empty on garbage, never throws', () => {
	assert.deepEqual(parseCriticVerdict(''), { verdicts: [], contradictions: [] })
	assert.deepEqual(parseCriticVerdict('not json at all'), { verdicts: [], contradictions: [] })
	assert.deepEqual(parseCriticVerdict('{ broken'), { verdicts: [], contradictions: [] })
	assert.deepEqual(parseCriticVerdict(JSON.stringify({ verdicts: 'nope' })), { verdicts: [], contradictions: [] })
})
