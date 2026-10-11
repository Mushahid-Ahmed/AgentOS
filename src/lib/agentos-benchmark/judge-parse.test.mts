import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJudgeVerdict } from './judge-parse'

// parseJudgeVerdict extracts a {score, unsupportedClaims, notes} verdict from raw
// judge completion text. It NEVER fabricates a score: anything without a finite
// numeric `score` returns null so the engine can record an honest judge failure.

test('parseJudgeVerdict: clean JSON object', () => {
	const verdict = parseJudgeVerdict('{"score":0.75,"unsupportedClaims":2,"notes":"Solid."}')
	assert.deepEqual(verdict, { score: 0.75, unsupportedClaims: 2, notes: 'Solid.' })
})

test('parseJudgeVerdict: ```json fenced', () => {
	const text = '```json\n{"score":0.5,"unsupportedClaims":1,"notes":"Mixed."}\n```'
	assert.deepEqual(parseJudgeVerdict(text), { score: 0.5, unsupportedClaims: 1, notes: 'Mixed.' })
})

test('parseJudgeVerdict: wrapped in prose', () => {
	const text = 'Here is my verdict:\n{"score":0.9,"unsupportedClaims":0,"notes":"Great."}\nHope that helps!'
	assert.deepEqual(parseJudgeVerdict(text), { score: 0.9, unsupportedClaims: 0, notes: 'Great.' })
})

test('parseJudgeVerdict: clamps a score above 1 to 1', () => {
	assert.equal(parseJudgeVerdict('{"score":3.4}')?.score, 1)
})

test('parseJudgeVerdict: clamps a negative score to 0', () => {
	assert.equal(parseJudgeVerdict('{"score":-2}')?.score, 0)
})

test('parseJudgeVerdict: rounds fractional unsupportedClaims and floors negatives at 0', () => {
	assert.equal(parseJudgeVerdict('{"score":0.5,"unsupportedClaims":2.6}')?.unsupportedClaims, 3)
	assert.equal(parseJudgeVerdict('{"score":0.5,"unsupportedClaims":-4}')?.unsupportedClaims, 0)
})

test('parseJudgeVerdict: missing notes/unsupportedClaims default to empty string and 0', () => {
	assert.deepEqual(parseJudgeVerdict('{"score":0.4}'), {
		score: 0.4,
		unsupportedClaims: 0,
		notes: ''
	})
})

test('parseJudgeVerdict: a brace inside the notes string still parses', () => {
	const text = '{"score":0.6,"unsupportedClaims":1,"notes":"Answer said {x} works but no source."}'
	const verdict = parseJudgeVerdict(text)
	assert.equal(verdict?.score, 0.6)
	assert.equal(verdict?.notes, 'Answer said {x} works but no source.')
})

test('parseJudgeVerdict: object followed by prose containing a stray brace', () => {
	const text = '{"score":0.8,"unsupportedClaims":0,"notes":"Good."} (see rubric item {2})'
	assert.equal(parseJudgeVerdict(text)?.score, 0.8)
})

test('parseJudgeVerdict: a string score is not accepted', () => {
	assert.equal(parseJudgeVerdict('{"score":"0.7","notes":"x"}'), null)
})

test('parseJudgeVerdict: a NaN/Infinity score is not accepted', () => {
	assert.equal(parseJudgeVerdict('{"score":NaN}'), null)
	assert.equal(parseJudgeVerdict('{"score":Infinity}'), null)
})

test('parseJudgeVerdict: no score field returns null', () => {
	assert.equal(parseJudgeVerdict('{"notes":"no number here"}'), null)
})

test('parseJudgeVerdict: no JSON object at all returns null', () => {
	assert.equal(parseJudgeVerdict('I cannot judge this answer.'), null)
})

test('parseJudgeVerdict: malformed JSON returns null', () => {
	assert.equal(parseJudgeVerdict('{"score":0.5,,}'), null)
})

test('parseJudgeVerdict: empty / whitespace-only string returns null', () => {
	assert.equal(parseJudgeVerdict(''), null)
	assert.equal(parseJudgeVerdict('   \n  '), null)
})
