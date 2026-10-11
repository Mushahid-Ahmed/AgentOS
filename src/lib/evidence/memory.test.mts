import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryEvidence } from './memory'
import type { EvidenceView } from './types'

// The evidence hub's contract, proven at $0 against the in-memory reference
// implementation. The rules that matter for §8/§13: a claim defaults to
// `unverified` (never silently "verified"), a source is null rather than invented,
// a fact-checker verdict mutates the right row, and a contradiction is recorded as
// a `contradicts` row that references the claim it conflicts with.

test('add records a claim, defaults to unverified/supports, returns a stable id', async () => {
	const hub = createMemoryEvidence()
	const id = await hub.add({
		claim: 'Apple reported Q4 revenue of $94.9B',
		source: 'https://www.apple.com/newsroom/q4-2024',
		retrievedText: 'Apple today announced financial results for Q4...',
		discoveredByAgent: 'researcher'
	})
	assert.equal(id, '1')
	const rows = await hub.list()
	assert.equal(rows.length, 1)
	const row = rows[0] as EvidenceView
	assert.equal(row.claim, 'Apple reported Q4 revenue of $94.9B')
	assert.equal(row.verificationStatus, 'unverified')
	assert.equal(row.relation, 'supports')
	assert.equal(row.referencesEvidenceId, null)
	assert.equal(row.discoveredByAgent, 'researcher')
})

test('add keeps a missing source null rather than inventing one', async () => {
	const hub = createMemoryEvidence()
	await hub.add({ claim: 'Something with no citation', discoveredByAgent: 'researcher' })
	const [row] = await hub.list()
	assert.equal(row?.source, null)
	assert.equal(row?.retrievedText, null)
})

test('ids increment and are strings', async () => {
	const hub = createMemoryEvidence()
	const a = await hub.add({ claim: 'first', discoveredByAgent: 'researcher' })
	const b = await hub.add({ claim: 'second', discoveredByAgent: 'researcher' })
	assert.equal(a, '1')
	assert.equal(b, '2')
})

test('markVerification moves only the targeted row', async () => {
	const hub = createMemoryEvidence()
	const keep = await hub.add({ claim: 'well sourced', discoveredByAgent: 'researcher' })
	const flip = await hub.add({ claim: 'shaky', discoveredByAgent: 'researcher' })
	await hub.markVerification(keep, 'verified')
	await hub.markVerification(flip, 'refuted')
	const rows = await hub.list()
	assert.equal(rows.find((r) => r.id === keep)?.verificationStatus, 'verified')
	assert.equal(rows.find((r) => r.id === flip)?.verificationStatus, 'refuted')
})

test('markVerification on an unknown id is a harmless no-op', async () => {
	const hub = createMemoryEvidence()
	await hub.add({ claim: 'only row', discoveredByAgent: 'researcher' })
	await hub.markVerification('999', 'verified')
	const rows = await hub.list()
	assert.equal(rows.length, 1)
	assert.equal(rows[0]?.verificationStatus, 'unverified')
})

test('flagContradiction flips an existing row to contradict another (no new row)', async () => {
	const hub = createMemoryEvidence()
	const grew = await hub.add({
		claim: 'Revenue grew 6% YoY',
		source: 'https://a.example',
		discoveredByAgent: 'researcher'
	})
	const flat = await hub.add({
		claim: 'Revenue was flat YoY',
		source: 'https://b.example',
		discoveredByAgent: 'researcher'
	})
	const id = await hub.flagContradiction({
		claimId: flat,
		againstId: grew,
		claim: 'Revenue was flat YoY',
		againstClaim: 'Revenue grew 6% YoY',
		discoveredByAgent: 'critic'
	})
	assert.equal(id, flat)
	const rows = await hub.list()
	// Still two rows — the relationship is recorded ON the offending row.
	assert.equal(rows.length, 2)
	const contra = rows.find((r) => r.id === flat)
	assert.equal(contra?.relation, 'contradicts')
	assert.equal(contra?.referencesEvidenceId, grew)
	// The other row is untouched by the relation flip.
	assert.equal(rows.find((r) => r.id === grew)?.relation, 'supports')
})

test('flagContradiction on unknown ids is refused and changes nothing', async () => {
	const hub = createMemoryEvidence()
	const a = await hub.add({ claim: 'only row', discoveredByAgent: 'researcher' })
	const id = await hub.flagContradiction({
		claimId: a,
		againstId: '999',
		claim: 'only row',
		againstClaim: 'ghost',
		discoveredByAgent: 'critic'
	})
	assert.equal(id, '')
	const rows = await hub.list()
	assert.equal(rows.length, 1)
	assert.equal(rows[0]?.relation, 'supports')
})

test('list returns copies, so a caller cannot mutate the hub', async () => {
	const hub = createMemoryEvidence()
	await hub.add({ claim: 'immutable', discoveredByAgent: 'researcher' })
	const first = await hub.list()
	first[0]!.claim = 'tampered'
	const second = await hub.list()
	assert.equal(second[0]?.claim, 'immutable')
})
