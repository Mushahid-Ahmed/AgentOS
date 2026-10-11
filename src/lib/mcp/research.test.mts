import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CITATIONS, RESEARCH_TOOL, parseResearchCompletion } from './research'

// The research-sonar parser's honesty contract, proven at $0 against the exact
// shape a real `perplexity/sonar` call returned (docs/agentos-integration-notes.md
// §3): citations live in `message.annotations[].url_citation`, NOT a top-level
// array. The rule that matters: never invent a source (§8).

const sonar = (content: string | null, annotations?: unknown) => ({
	id: 'gen-1',
	model: 'perplexity/sonar',
	choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, annotations } }],
	usage: { prompt_tokens: 35, completion_tokens: 69, cost: 0.0051 }
})

test('RESEARCH_TOOL is the stable tool name', () => {
	assert.equal(RESEARCH_TOOL, 'research')
})

test('parses text + real url_citation annotations from a live sonar shape', () => {
	const completion = sonar('Apple’s FY2024 revenue was $391.035 billion.[1][4]', [
		{ type: 'url_citation', url_citation: { url: 'https://www.sec.gov/x.htm', title: 'Apple 10-K', start_index: 0, end_index: 0 } },
		{ type: 'url_citation', url_citation: { url: 'https://www.macrotrends.net/aapl', title: 'Macrotrends' } }
	])
	const result = parseResearchCompletion(completion)
	assert.equal(result.text, 'Apple’s FY2024 revenue was $391.035 billion.[1][4]')
	assert.deepEqual(result.citations, [
		{ url: 'https://www.sec.gov/x.htm', title: 'Apple 10-K' },
		{ url: 'https://www.macrotrends.net/aapl', title: 'Macrotrends' }
	])
})

test('content with NO annotations yields empty citations, never invented ones', () => {
	const result = parseResearchCompletion(sonar('A plain answer with no sources.', undefined))
	assert.equal(result.text, 'A plain answer with no sources.')
	assert.deepEqual(result.citations, [])
})

test('carries a valid start/end span, and drops a degenerate or reversed one', () => {
	const completion = sonar('Revenue rose 6% while costs were flat.', [
		// A real, ordered span -> carried so the researcher can cite the exact claim.
		{ type: 'url_citation', url_citation: { url: 'https://a.example', start_index: 0, end_index: 14 } },
		// end == start (degenerate) -> no span.
		{ type: 'url_citation', url_citation: { url: 'https://b.example', start_index: 5, end_index: 5 } },
		// reversed -> no span.
		{ type: 'url_citation', url_citation: { url: 'https://c.example', start_index: 9, end_index: 2 } },
		// only one bound -> no span.
		{ type: 'url_citation', url_citation: { url: 'https://d.example', start_index: 3 } }
	])
	const result = parseResearchCompletion(completion)
	assert.deepEqual(result.citations, [
		{ url: 'https://a.example', startIndex: 0, endIndex: 14 },
		{ url: 'https://b.example' },
		{ url: 'https://c.example' },
		{ url: 'https://d.example' }
	])
})

test('annotations: null is tolerated', () => {
	const result = parseResearchCompletion(sonar('text', null))
	assert.equal(result.text, 'text')
	assert.deepEqual(result.citations, [])
})

test('skips annotations that are not url_citations or lack a url', () => {
	const completion = sonar('text', [
		{ type: 'other', url_citation: { url: 'https://good.example' } }, // wrong type but has url -> still a url_citation shape, kept
		{ type: 'url_citation' }, // no url_citation object -> skipped
		{ type: 'url_citation', url_citation: { title: 'no url here' } }, // no url -> skipped
		{ type: 'url_citation', url_citation: { url: '' } }, // empty url -> skipped
		{ type: 'url_citation', url_citation: { url: 'https://kept.example', title: '' } } // empty title -> url only
	])
	const result = parseResearchCompletion(completion)
	// The parser keys off url_citation.url presence, not the sibling `type` string,
	// so the first and last are kept; the middle three have no usable url.
	assert.deepEqual(result.citations, [{ url: 'https://good.example' }, { url: 'https://kept.example' }])
})

test('de-duplicates repeated URLs, preserving first-seen order', () => {
	const completion = sonar('text', [
		{ type: 'url_citation', url_citation: { url: 'https://a.example', title: 'A' } },
		{ type: 'url_citation', url_citation: { url: 'https://b.example' } },
		{ type: 'url_citation', url_citation: { url: 'https://a.example', title: 'A again' } }
	])
	const result = parseResearchCompletion(completion)
	assert.deepEqual(result.citations, [
		{ url: 'https://a.example', title: 'A' },
		{ url: 'https://b.example' }
	])
})

test('caps citations at MAX_CITATIONS', () => {
	const many = Array.from({ length: MAX_CITATIONS + 5 }, (_v, i) => ({
		type: 'url_citation',
		url_citation: { url: `https://src${i}.example` }
	}))
	const result = parseResearchCompletion(sonar('text', many))
	assert.equal(result.citations.length, MAX_CITATIONS)
	assert.equal(result.citations[0].url, 'https://src0.example')
	assert.equal(result.citations[MAX_CITATIONS - 1].url, `https://src${MAX_CITATIONS - 1}.example`)
})

test('null content yields empty text without throwing', () => {
	const result = parseResearchCompletion(sonar(null, [{ type: 'url_citation', url_citation: { url: 'https://a.example' } }]))
	assert.equal(result.text, '')
	assert.deepEqual(result.citations, [{ url: 'https://a.example' }])
})

test('a malformed / non-object completion degrades to empty, never throws', () => {
	for (const junk of [undefined, null, 42, 'nope', {}, { choices: 'not-an-array' }, { choices: [{}] }]) {
		const result = parseResearchCompletion(junk)
		assert.equal(result.text, '')
		assert.deepEqual(result.citations, [])
	}
})
