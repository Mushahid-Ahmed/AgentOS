import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	createPoolTransport,
	PoolCallError,
	type PoolCompletion,
	type PoolMessage
} from './transport'
import type { AttemptMeta, CallModel } from './failover'
import type { ModelTier, PoolModel } from './types'

// --- fixtures --------------------------------------------------------------

const META: AttemptMeta = { attempt: 1, totalAttempt: 1, candidateIndex: 0, isRetry: false }

const MESSAGES: PoolMessage[] = [
	{ role: 'system', content: 'You are a terse assistant.' },
	{ role: 'user', content: 'Compare index sharding strategies.' }
]

function poolModel(slug: string, tier: ModelTier): PoolModel {
	return {
		slug,
		displayName: slug,
		family: slug.split('/')[0] ?? slug,
		tier,
		contextLength: 128_000,
		promptPricePer1M: null,
		completionPricePer1M: null,
		capabilities: {
			tools: false,
			structuredOutputAdvertised: false,
			structuredOutputVerified: false,
			vision: false
		},
		tags: [],
		health: {
			circuit: 'closed',
			consecutiveFailures: 0,
			openedAt: null,
			cooldownMs: 60_000,
			lastSuccessAt: null,
			lastFailureAt: null
		},
		measurements: { latencyMs: null, successRate: null, samples: 0, successes: 0, failures: 0 },
		refreshedAt: 0
	}
}

const FREE = poolModel('meta-llama/llama-3.1-8b-instruct:free', 'free')
const PREMIUM = poolModel('anthropic/claude-sonnet-4.5', 'premium')

// A fake clock that advances a fixed step per read, so latencyMs is deterministic.
function fakeClock(stepMs = 10) {
	let t = 0
	return () => (t += stepMs)
}

type Probe = { slug: string; ok: boolean; latencyMs: number }

function harness(opts: {
	completion?: PoolCompletion
	throwWith?: unknown
	messages?: PoolMessage[]
}) {
	const probes: Probe[] = []
	const calls: string[] = []
	const complete = async (slug: string): Promise<PoolCompletion> => {
		calls.push(slug)
		if (opts.throwWith) throw opts.throwWith
		return (
			opts.completion ?? { content: 'a real answer', costUsd: 0.0001, finishReason: 'stop' }
		)
	}
	const transport: CallModel = createPoolTransport({
		messages: opts.messages ?? MESSAGES,
		complete,
		recordProbe: (slug, result) => probes.push({ slug, ...result }),
		now: fakeClock()
	})
	return { transport, probes, calls }
}

// --- success ---------------------------------------------------------------

test('a usable completion returns content and the real cost in micro-USD', async () => {
	const { transport, probes, calls } = harness({
		completion: { content: 'shard by tenant id', costUsd: 0.000123, finishReason: 'stop' }
	})
	const out = await transport(PREMIUM, META)
	assert.equal(out.ok, true)
	assert.equal(calls.length, 1)
	if (out.ok) {
		assert.equal(out.content, 'shard by tenant id')
		assert.equal(out.costMicroUsd, 123)
		assert.equal(out.slug, PREMIUM.slug)
	}
	assert.deepEqual(probes, [{ slug: PREMIUM.slug, ok: true, latencyMs: 10 }])
})

test('a :free model reports a real 0 cost, not an absence', async () => {
	const { transport } = harness({ completion: { content: 'ok', costUsd: 0, finishReason: 'stop' } })
	const out = await transport(FREE, META)
	assert.equal(out.ok, true)
	if (out.ok) assert.equal(out.costMicroUsd, 0)
})

// --- privacy guard ---------------------------------------------------------

test('secret-shaped content is NEVER sent to a free model, and the model is not called', async () => {
	const leaked: PoolMessage[] = [
		{ role: 'user', content: 'Debug this: OPENROUTER_API_KEY=sk-or-abcdef1234567890' }
	]
	const { transport, calls, probes } = harness({ messages: leaked })
	const out = await transport(FREE, META)
	assert.equal(out.ok, false)
	assert.equal(calls.length, 0, 'complete must not be called for a refused free model')
	assert.equal(probes.length, 0, 'a policy refusal is not the model\'s fault — no probe')
	if (!out.ok) {
		assert.equal(out.failure.kind, 'bad-request')
		assert.match(out.failure.message, /must not be sent to a free model/)
		// The masked match must never echo the raw secret.
		assert.equal(out.failure.message.includes('sk-or-abcdef1234567890'), false)
	}
})

test('the same secret-shaped content IS allowed to a premium model', async () => {
	const leaked: PoolMessage[] = [
		{ role: 'user', content: 'Debug this: OPENROUTER_API_KEY=sk-or-abcdef1234567890' }
	]
	const { transport, calls } = harness({ messages: leaked })
	const out = await transport(PREMIUM, META)
	assert.equal(out.ok, true)
	assert.equal(calls.length, 1)
})

// --- the empty-output trap -------------------------------------------------

test('a 200 with blank content is empty-output, not success', async () => {
	const { transport, probes } = harness({
		completion: { content: '   ', costUsd: 0, finishReason: 'stop' }
	})
	const out = await transport(FREE, META)
	assert.equal(out.ok, false)
	if (!out.ok) assert.equal(out.failure.kind, 'empty-output')
	assert.deepEqual(probes, [{ slug: FREE.slug, ok: false, latencyMs: 10 }])
})

test('a 200 with null content is empty-output too', async () => {
	const { transport } = harness({ completion: { content: null, costUsd: 0, finishReason: null } })
	const out = await transport(FREE, META)
	assert.equal(out.ok, false)
	if (!out.ok) assert.equal(out.failure.kind, 'empty-output')
})

// --- error classification --------------------------------------------------

test('a 402 is classified insufficient-credits and records a failed probe', async () => {
	const { transport, probes } = harness({
		throwWith: new PoolCallError(402, 'can only afford 328 tokens')
	})
	const out = await transport(PREMIUM, META)
	assert.equal(out.ok, false)
	if (!out.ok) {
		assert.equal(out.failure.kind, 'insufficient-credits')
		assert.equal(out.failure.status, 402)
	}
	assert.deepEqual(probes, [{ slug: PREMIUM.slug, ok: false, latencyMs: 10 }])
})

test('a 403 (model gated to approved agentic harnesses) is unavailable, not bad-request', async () => {
	// OpenRouter returns 403 "only available on agentic harnesses" for `:free`
	// models our app isn't approved for. That is a model↔caller restriction, so the
	// runner must walk on to the next candidate rather than blame the prompt.
	const { transport } = harness({
		throwWith: new PoolCallError(403, 'only available on agentic harnesses')
	})
	const out = await transport(FREE, META)
	assert.equal(out.ok, false)
	if (!out.ok) {
		assert.equal(out.failure.kind, 'unavailable')
		assert.equal(out.failure.status, 403)
	}
})

test('a 429 preserves Retry-After for the runner\'s backoff', async () => {
	const { transport } = harness({
		throwWith: new PoolCallError(429, 'rate limited', { retryAfterMs: 4_000 })
	})
	const out = await transport(FREE, META)
	assert.equal(out.ok, false)
	if (!out.ok) {
		assert.equal(out.failure.kind, 'rate-limit')
		assert.equal(out.failure.retryAfterMs, 4_000)
	}
})

test('a context-overflow message refines a 400', async () => {
	const { transport } = harness({
		throwWith: new PoolCallError(400, 'maximum context length exceeded')
	})
	const out = await transport(PREMIUM, META)
	if (!out.ok) assert.equal(out.failure.kind, 'context-overflow')
})

test('a non-PoolCallError throw is classified unknown, never rethrown', async () => {
	const { transport, probes } = harness({ throwWith: new Error('socket hang up') })
	const out = await transport(PREMIUM, META)
	assert.equal(out.ok, false)
	if (!out.ok) {
		assert.equal(out.failure.kind, 'unknown')
		assert.equal(out.failure.message, 'socket hang up')
	}
	assert.equal(probes.length, 1)
})

test('the transport never throws, even on a non-Error rejection', async () => {
	const { transport } = harness({ throwWith: 'a bare string rejection' })
	const out = await transport(PREMIUM, META)
	assert.equal(out.ok, false)
	if (!out.ok) assert.equal(out.failure.kind, 'unknown')
})
