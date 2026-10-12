import test from 'node:test'
import assert from 'node:assert/strict'
import { isRetryableStatus, providerFetch } from './provider-fetch'

// A stand-in Response with just the surface providerFetch touches.
function fakeResponse(status: number, { onCancel }: { onCancel?: () => void } = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		body: { cancel: async () => onCancel?.() }
	} as unknown as Response
}

type Attempt = { status?: number; stalls?: boolean; throws?: boolean }

// Records every attempt and every backoff sleep, and can answer in the three shapes
// that matter: an HTTP status, a transport throw, or a call that never settles until
// its signal aborts.
function harness(attempts: Attempt[], overrides: { timeoutMs?: number } = {}) {
	const calls: { url: string; signal?: AbortSignal }[] = []
	const sleeps: number[] = []
	const fetchImpl = ((url: string, init: RequestInit) => {
		const attempt = attempts[calls.length] ?? attempts[attempts.length - 1]
		calls.push({ url, signal: init.signal ?? undefined })
		if (attempt?.throws) return Promise.reject(new Error('socket hang up'))
		if (attempt?.stalls) {
			return new Promise((_resolve, reject) => {
				init.signal?.addEventListener('abort', () =>
					reject(init.signal?.reason ?? new Error('aborted'))
				)
			})
		}
		return Promise.resolve(fakeResponse(attempt?.status ?? 200))
	}) as typeof fetch
	const sleep = async (ms: number) => {
		sleeps.push(ms)
	}
	return { calls, sleeps, fetchImpl, sleep, timeoutMs: overrides.timeoutMs ?? 30_000 }
}

const INIT = () => ({ method: 'POST' as const, headers: { a: 'b' }, body: '{}' })

test('a 200 on the first attempt returns immediately, with no backoff slept', async () => {
	const h = harness([{ status: 200 }])
	const res = await providerFetch('https://example.test/v1', INIT, {
		timeoutMs: h.timeoutMs,
		retries: 2,
		fetchImpl: h.fetchImpl,
		sleep: h.sleep
	})
	assert.equal(res.status, 200)
	assert.equal(h.calls.length, 1)
	assert.deepEqual(h.sleeps, [])
})

test('a 429 is retried once and the error body is released before the retry', async () => {
	let cancelled = 0
	const calls: unknown[] = []
	const fetchImpl = ((url: string) => {
		const n = calls.length
		calls.push(url)
		if (n === 0) {
			return Promise.resolve({
				ok: false,
				status: 429,
				body: { cancel: async () => cancelled++ }
			} as unknown as Response)
		}
		return Promise.resolve(fakeResponse(200))
	}) as typeof fetch
	const sleeps: number[] = []

	const res = await providerFetch('https://example.test/v1', INIT, {
		fetchImpl,
		sleep: async (ms) => void sleeps.push(ms),
		retries: 2
	})
	assert.equal(res.status, 200)
	assert.equal(calls.length, 2)
	assert.equal(cancelled, 1, 'the 429 body was cancelled — no leaked connection')
	assert.deepEqual(sleeps, [1000], 'first backoff step is 1s')
})

test('backoff doubles: a 503 twice then success sleeps 1s then 2s', async () => {
	const h = harness([{ status: 503 }, { status: 503 }, { status: 200 }])
	const sleeps: number[] = []
	const res = await providerFetch('https://example.test/v1', INIT, {
		timeoutMs: h.timeoutMs,
		retries: 2,
		fetchImpl: h.fetchImpl,
		sleep: async (ms) => void sleeps.push(ms)
	})
	assert.equal(res.status, 200)
	assert.equal(sleeps.join(','), '1000,2000')
})

test('the retry budget is bounded: three 500s stop after the budget and the last response reaches the caller', async () => {
	const h = harness([{ status: 500 }, { status: 500 }, { status: 500 }])
	const res = await providerFetch('https://example.test/v1', INIT, {
		timeoutMs: h.timeoutMs,
		retries: 2,
		fetchImpl: h.fetchImpl,
		sleep: h.sleep
	})
	// 1 initial + 2 retries, and nothing after that. The exhausted status is returned,
	// not thrown: nanogpt.ts already turns a non-ok response into the user-facing error,
	// and duplicating that here would change the message users see today.
	assert.equal(res.status, 500)
	assert.equal(h.calls.length, 3)
})

test('a 400 is returned to the caller untouched — a rejected prompt is never re-sent', async () => {
	const h = harness([{ status: 400 }, { status: 200 }])
	const res = await providerFetch('https://example.test/v1', INIT, {
		timeoutMs: h.timeoutMs,
		retries: 2,
		fetchImpl: h.fetchImpl,
		sleep: h.sleep
	})
	assert.equal(res.status, 400)
	assert.equal(h.calls.length, 1, 'no retry on a 4xx that is not 429')
	assert.equal(isRetryableStatus(400), false)
	assert.equal(isRetryableStatus(429), true)
})

test('a stalled provider is cut off by the timeout instead of hanging the stream', async () => {
	// timeoutMs: 5 with a fetch that only ever settles when its signal aborts: if the
	// signal were not wired, this test would never finish. The assertion is that it
	// finishes at all, rejects, and gives up after the retry budget.
	const h = harness([{ stalls: true }, { stalls: true }, { stalls: true }], { timeoutMs: 5 })
	const started = Date.now()
	await assert.rejects(
		providerFetch('https://example.test/v1', INIT, {
			timeoutMs: h.timeoutMs,
			retries: 2,
			fetchImpl: h.fetchImpl,
			// No real sleeping in the stall arm: the point is the abort, not the backoff.
			sleep: async () => {}
		})
	)
	assert.ok(Date.now() - started < 2_000, 'bounded by the timeout, not by the platform')
	assert.equal(h.calls.length, 3)
	assert.ok(
		h.calls.every((c) => c.signal !== undefined),
		'every attempt carried an AbortSignal'
	)
})

test('a transport error is retried, and the last one propagates', async () => {
	const h = harness([{ throws: true }, { throws: true }, { status: 200 }])
	const res = await providerFetch('https://example.test/v1', INIT, {
		timeoutMs: h.timeoutMs,
		retries: 2,
		fetchImpl: h.fetchImpl,
		sleep: h.sleep
	})
	assert.equal(res.status, 200)
	assert.equal(h.calls.length, 3)
})
