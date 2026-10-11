import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	auditClaims,
	crossCheckVerdicts,
	normalizeVerdict,
	type ClaimInput,
	type GroundedVerdict
} from './quality'

// Pure quality-gate tests ($0, fixed inputs).

const EVIDENCE = ['ev-1', 'ev-2', 'ev-3']

test('auditClaims: every claim cited to real evidence passes the gate', () => {
	const claims: ClaimInput[] = [
		{ text: 'A', evidenceIds: ['ev-1'] },
		{ text: 'B', evidenceIds: ['ev-2', 'ev-3'] }
	]
	const audit = auditClaims(claims, EVIDENCE)
	assert.equal(audit.ok, true)
	assert.equal(audit.cited, 2)
	assert.equal(audit.unsupported, 0)
	assert.equal(audit.total, 2)
})

test('auditClaims: an honestly-labelled model-knowledge claim passes', () => {
	const audit = auditClaims([{ text: 'general fact', markedModelKnowledge: true }], EVIDENCE)
	assert.equal(audit.ok, true)
	assert.equal(audit.modelKnowledge, 1)
	assert.equal(audit.unsupported, 0)
})

test('auditClaims: an uncited, unmarked claim is unsupported and fails the gate', () => {
	const audit = auditClaims([{ text: 'made up' }], EVIDENCE)
	assert.equal(audit.ok, false)
	assert.equal(audit.unsupported, 1)
	assert.equal(audit.items[0]?.status, 'unsupported')
})

test('auditClaims: a fabricated citation (unknown evidence id) is unsupported', () => {
	const audit = auditClaims([{ text: 'lies', evidenceIds: ['ev-999'] }], EVIDENCE)
	assert.equal(audit.ok, false)
	assert.equal(audit.unsupported, 1)
	assert.deepEqual(audit.items[0]?.missingIds, ['ev-999'])
})

test('auditClaims: a claim citing both a real and a fake id is still cited (real wins)', () => {
	const audit = auditClaims([{ text: 'mixed', evidenceIds: ['ev-1', 'ev-999'] }], EVIDENCE)
	assert.equal(audit.ok, true)
	assert.equal(audit.cited, 1)
	assert.deepEqual(audit.items[0]?.missingIds, ['ev-999'])
})

test('auditClaims: model-knowledge label does NOT excuse a fabricated citation', () => {
	const audit = auditClaims(
		[{ text: 'sneaky', evidenceIds: ['ev-999'], markedModelKnowledge: true }],
		EVIDENCE
	)
	assert.equal(audit.ok, false)
	assert.equal(audit.unsupported, 1)
})

test('auditClaims: mixed set counts each bucket and fails on any unsupported', () => {
	const claims: ClaimInput[] = [
		{ text: 'cited', evidenceIds: ['ev-1'] },
		{ text: 'knowledge', markedModelKnowledge: true },
		{ text: 'bare' }
	]
	const audit = auditClaims(claims, EVIDENCE)
	assert.equal(audit.cited, 1)
	assert.equal(audit.modelKnowledge, 1)
	assert.equal(audit.unsupported, 1)
	assert.equal(audit.ok, false)
})

test('normalizeVerdict: collapses synonyms, unknown stays unknown', () => {
	assert.equal(normalizeVerdict('The claim is SUPPORTED by evidence'), 'supported')
	assert.equal(normalizeVerdict('verified'), 'supported')
	assert.equal(normalizeVerdict('This is refuted'), 'refuted')
	assert.equal(normalizeVerdict('contradicts the source'), 'refuted')
	assert.equal(normalizeVerdict('inconclusive'), 'uncertain')
	assert.equal(normalizeVerdict('banananan'), 'unknown')
})

test('crossCheckVerdicts: agreement + both grounded passes', () => {
	const a: GroundedVerdict = { modelSlug: 'claude', verdict: 'supported', citedEvidenceIds: ['ev-1'] }
	const b: GroundedVerdict = { modelSlug: 'gemini', verdict: 'The claim is supported', citedEvidenceIds: ['ev-2'] }
	const res = crossCheckVerdicts(a, b, EVIDENCE)
	assert.equal(res.ok, true)
	assert.equal(res.agree, true)
	assert.equal(res.contested, false)
	assert.equal(res.bothGrounded, true)
})

test('crossCheckVerdicts: disagreement is contested and fails', () => {
	const a: GroundedVerdict = { modelSlug: 'claude', verdict: 'supported', citedEvidenceIds: ['ev-1'] }
	const b: GroundedVerdict = { modelSlug: 'free-x', verdict: 'refuted', citedEvidenceIds: ['ev-1'] }
	const res = crossCheckVerdicts(a, b, EVIDENCE)
	assert.equal(res.ok, false)
	assert.equal(res.contested, true)
	assert.ok(res.reason.includes('contested'))
})

test('crossCheckVerdicts: agreement but an ungrounded free-model verdict is not trusted', () => {
	const a: GroundedVerdict = { modelSlug: 'claude', verdict: 'supported', citedEvidenceIds: ['ev-1'] }
	const b: GroundedVerdict = { modelSlug: 'free-x', verdict: 'supported', citedEvidenceIds: [] }
	const res = crossCheckVerdicts(a, b, EVIDENCE)
	assert.equal(res.ok, false)
	assert.equal(res.agree, true)
	assert.equal(res.bothGrounded, false)
	assert.equal(res.b.grounded, false)
	assert.ok(res.reason.includes('not both evidence-grounded'))
})

test('crossCheckVerdicts: a fabricated evidence id does not count as grounded', () => {
	const a: GroundedVerdict = { modelSlug: 'claude', verdict: 'supported', citedEvidenceIds: ['ev-1'] }
	const b: GroundedVerdict = { modelSlug: 'free-x', verdict: 'supported', citedEvidenceIds: ['ev-999'] }
	const res = crossCheckVerdicts(a, b, EVIDENCE)
	assert.equal(res.b.grounded, false)
	assert.equal(res.ok, false)
})

test('crossCheckVerdicts: two unknowns never count as agreement', () => {
	const a: GroundedVerdict = { modelSlug: 'x', verdict: 'maybe?', citedEvidenceIds: ['ev-1'] }
	const b: GroundedVerdict = { modelSlug: 'y', verdict: 'hmm', citedEvidenceIds: ['ev-2'] }
	const res = crossCheckVerdicts(a, b, EVIDENCE)
	assert.equal(res.agree, false)
	assert.equal(res.ok, false)
})
