import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRunFrame, splitFrames } from './sse'

// parseRunFrame reads the frame NAME from the `event:` line and the payload from
// the `data:` line(s), falling back to `data.type` for self-describing frames.
// The wire is a boundary, so a malformed frame yields null rather than throwing.

test('parseRunFrame: reads name from event line and JSON from data line', () => {
	const frame = parseRunFrame('event: run\ndata: {"runId":"16"}')
	assert.deepEqual(frame, { name: 'run', data: { runId: '16' } })
})

test('parseRunFrame: falls back to data.type when no event line', () => {
	const frame = parseRunFrame('data: {"type":"agent_started","stepId":"researcher"}')
	assert.deepEqual(frame, {
		name: 'agent_started',
		data: { type: 'agent_started', stepId: 'researcher' }
	})
})

test('parseRunFrame: joins multiple data lines before parsing', () => {
	const frame = parseRunFrame('event: decision\ndata: {"kind":"task_type",\ndata: "value":"x"}')
	assert.deepEqual(frame, { name: 'decision', data: { kind: 'task_type', value: 'x' } })
})

test('parseRunFrame: event name wins over data.type', () => {
	const frame = parseRunFrame('event: status\ndata: {"type":"something_else"}')
	assert.equal(frame?.name, 'status')
})

test('parseRunFrame: returns null when there is no data line', () => {
	assert.equal(parseRunFrame('event: run'), null)
})

test('parseRunFrame: returns null on invalid JSON', () => {
	assert.equal(parseRunFrame('event: run\ndata: {not json}'), null)
})

test('parseRunFrame: returns null when neither event line nor data.type gives a name', () => {
	assert.equal(parseRunFrame('data: {"runId":"16"}'), null)
})

// splitFrames carves a raw buffer on the blank-line delimiter and hands back the
// incomplete remainder so a frame split across reads is never dropped.

test('splitFrames: splits complete frames and returns empty remainder', () => {
	const { frames, rest } = splitFrames('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')
	assert.deepEqual(frames, ['event: a\ndata: 1', 'event: b\ndata: 2'])
	assert.equal(rest, '')
})

test('splitFrames: keeps an incomplete trailing frame as the remainder', () => {
	const { frames, rest } = splitFrames('event: a\ndata: 1\n\nevent: b\ndata:')
	assert.deepEqual(frames, ['event: a\ndata: 1'])
	assert.equal(rest, 'event: b\ndata:')
})

test('splitFrames: returns the whole buffer as remainder when nothing is complete', () => {
	const { frames, rest } = splitFrames('event: a\ndata: 1')
	assert.deepEqual(frames, [])
	assert.equal(rest, 'event: a\ndata: 1')
})

test('splitFrames: empty buffer yields no frames and no remainder', () => {
	assert.deepEqual(splitFrames(''), { frames: [], rest: '' })
})

test('splitFrames + parseRunFrame: a frame split across two chunks reassembles', () => {
	// Chunk 1 ends mid-frame; the remainder carries over into chunk 2.
	const first = splitFrames('event: run\ndata: {"run')
	assert.deepEqual(first.frames, [])
	const second = splitFrames(first.rest + 'Id":"16"}\n\n')
	assert.equal(second.frames.length, 1)
	assert.deepEqual(parseRunFrame(second.frames[0] as string), {
		name: 'run',
		data: { runId: '16' }
	})
})
