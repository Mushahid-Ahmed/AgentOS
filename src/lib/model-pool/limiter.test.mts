import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	FREE_RPD_FUNDED,
	FREE_RPD_UNFUNDED,
	FREE_RPM,
	createConcurrencyLimiter,
	createRateLimiter,
	defaultDayKey
} from './limiter'

// Pure limiter tests with a hand-advanced clock ($0, no timers).

function makeClock(start = 0) {
	let t = start
	return {
		now: () => t,
		advance: (ms: number) => {
			t += ms
		},
		set: (ms: number) => {
			t = ms
		}
	}
}

const FREE_LIMITS = { requestsPerMinute: FREE_RPM, requestsPerDay: FREE_RPD_UNFUNDED }

test('rate limiter: allows up to the RPM cap then refuses with a retryAfter', () => {
	const clock = makeClock()
	const rl = createRateLimiter({ now: clock.now, limits: FREE_LIMITS })
	for (let i = 0; i < FREE_RPM; i++) {
		assert.equal(rl.tryAcquire('free').ok, true, `acquire ${i} should pass`)
	}
	const refused = rl.tryAcquire('free')
	assert.equal(refused.ok, false)
	assert.ok(!refused.ok && refused.reason === 'rpm')
	assert.ok(!refused.ok && typeof refused.retryAfterMs === 'number')
})

test('rate limiter: the sliding window frees a slot once the oldest ages out', () => {
	const clock = makeClock()
	const rl = createRateLimiter({ now: clock.now, limits: FREE_LIMITS, windowMs: 1_000 })
	for (let i = 0; i < FREE_RPM; i++) {
		clock.advance(10)
		rl.tryAcquire('free')
	}
	assert.equal(rl.tryAcquire('free').ok, false)
	// Advance past the first request's window so one slot frees.
	clock.advance(1_000)
	assert.equal(rl.tryAcquire('free').ok, true)
})

test('rate limiter: daily quota is the harder wall (50/day unfunded)', () => {
	const clock = makeClock()
	const rl = createRateLimiter({ now: clock.now, limits: FREE_LIMITS, windowMs: 1 })
	for (let i = 0; i < FREE_RPD_UNFUNDED; i++) {
		clock.advance(2) // keep the tiny RPM window clear so only the daily cap binds
		assert.equal(rl.tryAcquire('free').ok, true, `daily acquire ${i}`)
	}
	clock.advance(2)
	const refused = rl.tryAcquire('free')
	assert.equal(refused.ok, false)
	assert.ok(!refused.ok && refused.reason === 'rpd')
	assert.ok(!refused.ok && refused.retryAfterMs === null)
})

test('rate limiter: daily quota rolls over on a new UTC day', () => {
	const clock = makeClock()
	const rl = createRateLimiter({ now: clock.now, limits: FREE_LIMITS, windowMs: 1 })
	for (let i = 0; i < FREE_RPD_UNFUNDED; i++) {
		clock.advance(2)
		rl.tryAcquire('free')
	}
	assert.equal(rl.tryAcquire('free').ok, false)
	clock.advance(24 * 60 * 60 * 1000) // next UTC day
	assert.equal(rl.tryAcquire('free').ok, true)
})

test('rate limiter: a funded account gets the higher daily quota (dynamic limits)', () => {
	const clock = makeClock()
	let funded = false
	const rl = createRateLimiter({
		now: clock.now,
		windowMs: 1,
		limits: () => ({
			requestsPerMinute: FREE_RPM,
			requestsPerDay: funded ? FREE_RPD_FUNDED : FREE_RPD_UNFUNDED
		})
	})
	for (let i = 0; i < FREE_RPD_UNFUNDED; i++) {
		clock.advance(2)
		rl.tryAcquire('free')
	}
	clock.advance(2)
	assert.equal(rl.tryAcquire('free').ok, false, 'unfunded: capped at 50')
	funded = true
	// Still capped by RPM within the same ms window, so advance to clear it.
	clock.advance(2)
	assert.equal(rl.tryAcquire('free').ok, true, 'funded: 51st allowed')
})

test('rate limiter: buckets are independent per key', () => {
	const clock = makeClock()
	const rl = createRateLimiter({ now: clock.now, limits: FREE_LIMITS })
	for (let i = 0; i < FREE_RPM; i++) rl.tryAcquire('free')
	assert.equal(rl.tryAcquire('free').ok, false)
	assert.equal(rl.tryAcquire('other').ok, true)
})

test('rate limiter: peek reports usage without consuming', () => {
	const clock = makeClock()
	const rl = createRateLimiter({ now: clock.now, limits: FREE_LIMITS })
	rl.tryAcquire('free')
	rl.tryAcquire('free')
	const p = rl.peek('free')
	assert.equal(p.rpm, 2)
	assert.equal(p.rpd, 2)
	assert.equal(p.limits.requestsPerDay, FREE_RPD_UNFUNDED)
	// peek again is idempotent
	assert.equal(rl.peek('free').rpm, 2)
})

test('rate limiter: reset clears all counters', () => {
	const clock = makeClock()
	const rl = createRateLimiter({ now: clock.now, limits: FREE_LIMITS })
	for (let i = 0; i < FREE_RPM; i++) rl.tryAcquire('free')
	assert.equal(rl.tryAcquire('free').ok, false)
	rl.reset()
	assert.equal(rl.tryAcquire('free').ok, true)
})

test('defaultDayKey: buckets by UTC calendar day', () => {
	assert.equal(defaultDayKey(Date.parse('2026-10-03T01:00:00Z')), '2026-10-03')
	assert.equal(defaultDayKey(Date.parse('2026-10-03T23:59:59Z')), '2026-10-03')
	assert.equal(defaultDayKey(Date.parse('2026-10-04T00:00:00Z')), '2026-10-04')
})

// ---- concurrency limiter ---------------------------------------------------

test('concurrency: never exceeds max in-flight', async () => {
	const cl = createConcurrencyLimiter(2)
	let inFlight = 0
	let peak = 0
	const make = () =>
		cl.run(async () => {
			inFlight += 1
			peak = Math.max(peak, inFlight)
			await new Promise((r) => setTimeout(r, 5))
			inFlight -= 1
		})
	await Promise.all([make(), make(), make(), make(), make()])
	assert.equal(peak, 2)
	assert.equal(cl.active, 0)
})

test('concurrency: resolves each run with its own value (FIFO order preserved)', async () => {
	const cl = createConcurrencyLimiter(1)
	const order: number[] = []
	const make = (n: number) =>
		cl.run(async () => {
			order.push(n)
			return n * 10
		})
	const results = await Promise.all([make(1), make(2), make(3)])
	assert.deepEqual(results, [10, 20, 30])
	assert.deepEqual(order, [1, 2, 3])
})

test('concurrency: a throwing run releases its slot and rejects', async () => {
	const cl = createConcurrencyLimiter(1)
	await assert.rejects(
		cl.run(async () => {
			throw new Error('boom')
		})
	)
	assert.equal(cl.active, 0)
	// A subsequent run still gets the slot.
	const v = await cl.run(async () => 42)
	assert.equal(v, 42)
	assert.equal(cl.active, 0)
})

test('concurrency: queued reflects waiting tasks', async () => {
	const cl = createConcurrencyLimiter(1)
	let release!: () => void
	const gate = new Promise<void>((r) => {
		release = r
	})
	const first = cl.run(() => gate)
	const second = cl.run(async () => 'b')
	// Let microtasks settle so `second` is queued behind `first`.
	await new Promise((r) => setTimeout(r, 0))
	assert.equal(cl.active, 1)
	assert.equal(cl.queued, 1)
	release()
	await first
	await second
	assert.equal(cl.queued, 0)
})
