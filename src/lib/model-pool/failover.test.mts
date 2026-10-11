import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runWithFailover, type AttemptMeta, type CallModel } from './failover'
import { createHealthStore } from './circuit'
import { createConcurrencyLimiter, createRateLimiter } from './limiter'
import { freshHealth, freshMeasurements } from './registry'
import type {
	AttemptFailure,
	AttemptOutcome,
	CandidateChain,
	FailoverEvent,
	PoolModel
} from './types'

// Integration tests for the failover loop. Transport, clock, sleep, health,
// limiters and budget are all faked — no network, no real time, $0.

function model(over: Partial<PoolModel> & { slug: string }): PoolModel {
	return {
		displayName: over.slug,
		family: over.slug.split('/')[0] ?? 'x',
		tier: 'premium',
		contextLength: 128_000,
		promptPricePer1M: 1,
		completionPricePer1M: 3,
		capabilities: {
			tools: false,
			structuredOutputAdvertised: false,
			structuredOutputVerified: false,
			vision: false
		},
		tags: [],
		health: freshHealth(),
		measurements: freshMeasurements(),
		refreshedAt: 0,
		...over
	}
}

const PREMIUM_A = model({ slug: 'anthropic/claude-sonnet-4.5', tier: 'premium' })
const PREMIUM_B = model({ slug: 'google/gemini-2.5-flash', tier: 'premium' })
const FREE_C = model({ slug: 'qwen/qwen3-27b:free', tier: 'free' })

function chain(candidates: PoolModel[], decidedBy: CandidateChain['decidedBy'] = 'pool-policy'): CandidateChain {
	return {
		candidates,
		request: { needs: [], minContext: 0, quality: 'high' },
		decidedBy,
		rationale: 'test'
	}
}

function makeClock(start = 0) {
	let t = start
	return {
		now: () => t,
		advance: (ms: number) => {
			t += ms
		}
	}
}

// A scripted transport: for each slug, a queue of outcomes; the last outcome
// repeats once the queue is drained.
function scripted(bySlug: Record<string, AttemptOutcome[]>): {
	call: CallModel
	calls: Array<{ slug: string; meta: AttemptMeta }>
} {
	const calls: Array<{ slug: string; meta: AttemptMeta }> = []
	const queues = new Map(Object.entries(bySlug).map(([k, v]) => [k, [...v]]))
	const call: CallModel = async (m, meta) => {
		calls.push({ slug: m.slug, meta })
		const q = queues.get(m.slug) ?? []
		if (q.length > 1) return q.shift() as AttemptOutcome
		return (q[0] ?? { ok: false, failure: fail(m.slug, 'unknown') }) as AttemptOutcome
	}
	return { call, calls }
}

function fail(slug: string, kind: AttemptFailure['kind'], extra: Partial<AttemptFailure> = {}): AttemptFailure {
	return { kind, slug, status: null, message: kind, retryAfterMs: null, ...extra }
}
function ok(slug: string, content = 'answer', over: Partial<Extract<AttemptOutcome, { ok: true }>> = {}): AttemptOutcome {
	return { ok: true, slug, content, latencyMs: 100, costMicroUsd: 1_000, ...over }
}

function makeBudget(maxCalls = Number.POSITIVE_INFINITY) {
	let calls = 0
	let cost = 0
	return {
		reserveModelCall() {
			if (calls >= maxCalls) return { ok: false, reason: 'max_model_calls' }
			calls += 1
			return { ok: true }
		},
		addCost(c?: number | null) {
			cost += c ?? 0
		},
		get calls() {
			return calls
		},
		get cost() {
			return cost
		}
	}
}

function harness() {
	const clock = makeClock()
	const sleeps: number[] = []
	const events: FailoverEvent[] = []
	return {
		clock,
		sleeps,
		events,
		sleep: async (ms: number) => {
			sleeps.push(ms)
			clock.advance(ms)
		},
		base: {
			runId: 'r1',
			stepId: 's1',
			now: clock.now,
			onEvent: (e: FailoverEvent) => events.push(e)
		}
	}
}

test('first candidate succeeds: no failover, cost recorded, decidedBy preserved', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const budget = makeBudget()
	const { call, calls } = scripted({ [PREMIUM_A.slug]: [ok(PREMIUM_A.slug, 'A!')] })

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B], 'jev'),
		callModel: call,
		health,
		budget
	})

	assert.equal(res.ok, true)
	assert.ok(res.ok && res.slug === PREMIUM_A.slug)
	assert.ok(res.ok && res.content === 'A!')
	assert.ok(res.ok && res.degraded === false)
	assert.ok(res.ok && res.decidedBy === 'jev')
	assert.ok(res.ok && res.costMicroUsd === 1_000)
	assert.equal(budget.cost, 1_000)
	assert.equal(calls.length, 1)
	assert.equal(h.events.length, 0)
})

test('transient failure retries the SAME model with backoff, then succeeds', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const { call, calls } = scripted({
		[PREMIUM_A.slug]: [
			{ ok: false, failure: fail(PREMIUM_A.slug, 'rate-limit', { status: 429, retryAfterMs: null }) },
			ok(PREMIUM_A.slug, 'retry-ok')
		]
	})

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: call,
		health,
		random: () => 0.5,
		baseBackoffMs: 100,
		capBackoffMs: 8_000
	})

	assert.equal(res.ok, true)
	assert.ok(res.ok && res.slug === PREMIUM_A.slug, 'same model served after retry')
	assert.ok(res.ok && res.degraded === false)
	assert.ok(res.ok && res.attempts === 2)
	assert.equal(calls.length, 2)
	// backoff with full jitter at attempt 0: floor(0.5 * min(8000, 100*2^0)) = 50
	assert.deepEqual(h.sleeps, [50])
	assert.equal(h.events.length, 0, 'no failover — same model recovered')
})

test('permanent failure opens the circuit, emits model_unhealthy, fails over', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const { call } = scripted({
		[PREMIUM_A.slug]: [{ ok: false, failure: fail(PREMIUM_A.slug, 'unavailable', { status: 404 }) }],
		[PREMIUM_B.slug]: [ok(PREMIUM_B.slug, 'B!')]
	})

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: call,
		health
	})

	assert.equal(res.ok, true)
	assert.ok(res.ok && res.slug === PREMIUM_B.slug)
	assert.ok(res.ok && res.degraded === true)
	assert.ok(res.ok && res.candidateIndex === 1)

	const unhealthy = h.events.filter((e) => e.type === 'model_unhealthy')
	const hop = h.events.filter((e) => e.type === 'model_failover')
	assert.equal(unhealthy.length, 1)
	assert.equal(hop.length, 1)
	assert.ok(hop[0] && hop[0].type === 'model_failover')
	assert.ok(
		hop[0] && hop[0].type === 'model_failover' && hop[0].fromSlug === PREMIUM_A.slug &&
		hop[0].toSlug === PREMIUM_B.slug && hop[0].reason === 'unavailable'
	)
	// Circuit for A is now open (unavailable opens immediately).
	assert.equal(health.allow(PREMIUM_A.slug, h.clock.now()), false)
})

test('empty-output (200 with blank content) is a failure and fails over', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const { call } = scripted({
		[FREE_C.slug]: [{ ok: false, failure: fail(FREE_C.slug, 'empty-output', { status: 200 }) }],
		[PREMIUM_B.slug]: [ok(PREMIUM_B.slug, 'real answer')]
	})

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([FREE_C, PREMIUM_B]),
		callModel: call,
		health,
		maxAttemptsPerModel: 1
	})

	assert.equal(res.ok, true)
	assert.ok(res.ok && res.slug === PREMIUM_B.slug, 'empty output never accepted')
})

test('402 on premium sets a credit wall: remaining premium skipped, free serves', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const budget = makeBudget()
	const { call, calls } = scripted({
		[PREMIUM_A.slug]: [{ ok: false, failure: fail(PREMIUM_A.slug, 'insufficient-credits', { status: 402 }) }],
		[PREMIUM_B.slug]: [ok(PREMIUM_B.slug, 'should-not-run')],
		[FREE_C.slug]: [ok(FREE_C.slug, 'free answer')]
	})

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B, FREE_C]),
		callModel: call,
		health,
		budget
	})

	assert.equal(res.ok, true)
	assert.ok(res.ok && res.slug === FREE_C.slug)
	assert.ok(res.ok && res.degraded === true)
	// PREMIUM_B was never attempted (credit wall skips premium).
	assert.ok(!calls.some((c) => c.slug === PREMIUM_B.slug), 'premium B skipped after 402')
	assert.equal(budget.calls, 2, 'only A (402) and C (free) reserved')
})

test('all candidates fail: ok:false with all_failed and collected failures', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const { call } = scripted({
		[PREMIUM_A.slug]: [{ ok: false, failure: fail(PREMIUM_A.slug, 'server-error', { status: 500 }) }],
		[PREMIUM_B.slug]: [{ ok: false, failure: fail(PREMIUM_B.slug, 'server-error', { status: 503 }) }]
	})

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: call,
		health,
		maxAttemptsPerModel: 1
	})

	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.reason === 'all_failed')
	assert.ok(!res.ok && res.failures.length === 2)
})

test('only 402s across the chain: reason is insufficient_credits', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const { call } = scripted({
		[PREMIUM_A.slug]: [{ ok: false, failure: fail(PREMIUM_A.slug, 'insufficient-credits', { status: 402 }) }],
		[PREMIUM_B.slug]: [{ ok: false, failure: fail(PREMIUM_B.slug, 'insufficient-credits', { status: 402 }) }]
	})

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: call,
		health
	})

	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.reason === 'insufficient_credits')
})

test('empty chain: no_candidates without calling the transport', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	let called = false
	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([]),
		callModel: async () => {
			called = true
			return ok('x')
		},
		health
	})
	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.reason === 'no_candidates')
	assert.equal(called, false)
})

test('budget refusal stops the run with budget_stopped', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const budget = makeBudget(0) // refuses every call
	const { call, calls } = scripted({ [PREMIUM_A.slug]: [ok(PREMIUM_A.slug)] })

	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: call,
		health,
		budget
	})

	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.reason === 'budget_stopped')
	assert.ok(!res.ok && res.budgetStopped === true)
	assert.equal(calls.length, 0, 'transport never called when budget refuses')
})

test('wall clock ceiling stops the run with wall_clock', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: async () => ok(PREMIUM_A.slug),
		health,
		maxWallClockMs: 0
	})
	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.reason === 'wall_clock')
})

test('max total attempts cap stops the run with max_attempts', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const { call } = scripted({
		[PREMIUM_A.slug]: [{ ok: false, failure: fail(PREMIUM_A.slug, 'server-error', { status: 500 }) }],
		[PREMIUM_B.slug]: [ok(PREMIUM_B.slug)]
	})
	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: call,
		health,
		maxAttemptsPerModel: 1,
		maxTotalAttempts: 1
	})
	assert.equal(res.ok, false)
	assert.ok(!res.ok && res.reason === 'max_attempts')
})

test('a candidate with an open circuit is skipped (no attempt)', async () => {
	const h = harness()
	const health = createHealthStore({
		now: h.clock.now,
		seed: { [PREMIUM_A.slug]: { ...freshHealth(60_000), circuit: 'open', openedAt: 0 } }
	})
	const { call, calls } = scripted({
		[PREMIUM_A.slug]: [ok(PREMIUM_A.slug, 'A!')],
		[PREMIUM_B.slug]: [ok(PREMIUM_B.slug, 'B!')]
	})
	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A, PREMIUM_B]),
		callModel: call,
		health
	})
	assert.equal(res.ok, true)
	assert.ok(res.ok && res.slug === PREMIUM_B.slug)
	assert.ok(res.ok && res.degraded === true)
	assert.ok(!calls.some((c) => c.slug === PREMIUM_A.slug), 'open circuit not attempted')
})

test('free-tier rate limiter refusal fails over to the next candidate', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	// A limiter whose daily quota is already exhausted for the free bucket.
	const rateLimiter = createRateLimiter({
		now: h.clock.now,
		limits: { requestsPerMinute: 20, requestsPerDay: 1 }
	})
	rateLimiter.tryAcquire('free') // consume the single daily allowance

	const { call, calls } = scripted({
		[FREE_C.slug]: [ok(FREE_C.slug, 'free')],
		[PREMIUM_B.slug]: [ok(PREMIUM_B.slug, 'premium')]
	})
	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([FREE_C, PREMIUM_B]),
		callModel: call,
		health,
		rateLimiter
	})

	assert.equal(res.ok, true)
	assert.ok(res.ok && res.slug === PREMIUM_B.slug, 'limiter refusal skipped the free model')
	assert.ok(!calls.some((c) => c.slug === FREE_C.slug), 'free transport never called')
	const hop = h.events.find((e) => e.type === 'model_failover')
	assert.ok(hop && hop.type === 'model_failover' && hop.reason === 'rate-limit')
})

test('concurrency limiter wraps each attempt', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const concurrency = createConcurrencyLimiter(1)
	const { call } = scripted({ [PREMIUM_A.slug]: [ok(PREMIUM_A.slug, 'A!')] })
	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A]),
		callModel: call,
		health,
		concurrency
	})
	assert.equal(res.ok, true)
	assert.ok(res.ok && res.content === 'A!')
	assert.equal(concurrency.active, 0, 'slot released')
})

test('retryAfterMs is honoured as the backoff floor', async () => {
	const h = harness()
	const health = createHealthStore({ now: h.clock.now })
	const { call } = scripted({
		[PREMIUM_A.slug]: [
			{ ok: false, failure: fail(PREMIUM_A.slug, 'rate-limit', { status: 429, retryAfterMs: 5_000 }) },
			ok(PREMIUM_A.slug, 'after-wait')
		]
	})
	const res = await runWithFailover({
		...h.base,
		sleep: h.sleep,
		chain: chain([PREMIUM_A]),
		callModel: call,
		health,
		random: () => 0.1,
		baseBackoffMs: 100,
		capBackoffMs: 8_000,
		maxAttemptsPerModel: 2
	})
	assert.equal(res.ok, true)
	// jitter floor(0.1*100)=10, but Retry-After 5000 is the floor -> 5000.
	assert.deepEqual(h.sleeps, [5_000])
})
