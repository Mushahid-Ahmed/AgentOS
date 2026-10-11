import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { extractJson, isBlankOutput, repairJson, validateStructured } from './validate'

// Pure output-validation tests with fixed strings ($0, no model, no network).

const schema = z.object({
	score: z.number().min(0).max(1),
	notes: z.string()
})

test('extractJson: plain object, fenced, and prose-wrapped all parse', () => {
	assert.deepEqual(extractJson('{"score":0.5,"notes":"x"}'), { score: 0.5, notes: 'x' })
	assert.deepEqual(extractJson('```json\n{"score":1,"notes":"y"}\n```'), { score: 1, notes: 'y' })
	assert.deepEqual(extractJson('Sure! Here you go: {"score":0,"notes":"z"} hope that helps'), {
		score: 0,
		notes: 'z'
	})
})

test('extractJson: a brace inside a string value does not break the match', () => {
	const parsed = extractJson('{"notes":"a } b","score":0.2}') as { notes: string; score: number }
	assert.equal(parsed.notes, 'a } b')
	assert.equal(parsed.score, 0.2)
})

test('extractJson: arrays and nested objects parse', () => {
	assert.deepEqual(extractJson('prefix [1,2,3] suffix'), [1, 2, 3])
	assert.deepEqual(extractJson('{"a":{"b":[1,{"c":2}]}}'), { a: { b: [1, { c: 2 }] } })
})

test('extractJson: returns null (never a guess) when there is no JSON', () => {
	assert.equal(extractJson(''), null)
	assert.equal(extractJson('   '), null)
	assert.equal(extractJson('no json here at all'), null)
	assert.equal(extractJson('{ this is not valid json }'), null)
})

test('repairJson: strips fences and removes trailing commas', () => {
	assert.equal(repairJson('```json\n{"a":1,}\n```'), '{"a":1}')
	assert.equal(repairJson('{"a":[1,2,],}'), '{"a":[1,2]}')
})

test('repairJson: returns null when nothing would change (repair retry is pointless)', () => {
	assert.equal(repairJson('{"a":1}'), null)
	assert.equal(repairJson('not json'), null)
})

test('validateStructured: valid payload passes with repaired:false', () => {
	const res = validateStructured('{"score":0.8,"notes":"good"}', schema)
	assert.equal(res.ok, true)
	assert.ok(res.ok && res.repaired === false)
	assert.ok(res.ok && res.data.score === 0.8)
})

test('validateStructured: fenced valid payload passes', () => {
	const res = validateStructured('```json\n{"score":0.3,"notes":"meh"}\n```', schema)
	assert.equal(res.ok, true)
	assert.ok(res.ok && res.data.notes === 'meh')
})

test('validateStructured: a trailing comma is repaired once (repaired:true)', () => {
	const res = validateStructured('{"score":0.9,"notes":"ok",}', schema)
	assert.equal(res.ok, true)
	assert.ok(res.ok && res.repaired === true)
	assert.ok(res.ok && res.data.score === 0.9)
})

test('validateStructured: schema violation reports real issues, never fabricates', () => {
	const res = validateStructured('{"score":5,"notes":"out of range"}', schema)
	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.issues.length > 0)
	assert.ok(!res.ok && res.issues.some((i) => i.includes('score')))
})

test('validateStructured: missing required field is reported, not defaulted', () => {
	const res = validateStructured('{"score":0.5}', schema)
	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.issues.some((i) => i.includes('notes')))
})

test('validateStructured: no JSON at all -> honest failure', () => {
	const res = validateStructured('I cannot answer that.', schema)
	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.issues[0]?.includes('no JSON'))
	assert.ok(!res.ok && res.raw === 'I cannot answer that.')
})

test('isBlankOutput: the free-model 200-with-empty-content trap', () => {
	assert.equal(isBlankOutput(''), true)
	assert.equal(isBlankOutput('   \n\t '), true)
	assert.equal(isBlankOutput('real content'), false)
})
