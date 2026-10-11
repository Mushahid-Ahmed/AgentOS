import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPoolHealth } from './model-pool-health.ts'
import type { PoolModel } from './model-pool/types.ts'

// Minimal PoolModel fixture; override only what a case cares about.
function pm(overrides: Partial<PoolModel> & { slug: string }): PoolModel {
	return {
		displayName: overrides.slug,
		family: overrides.slug.split('/')[0] ?? overrides.slug,
		tier: 'free',
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
		refreshedAt: 0,
		...overrides
	} as PoolModel
}

function measured(successes: number, failures: number, latencyMs: number): PoolModel['measurements'] {
	const samples = successes + failures
	return {
		latencyMs,
		successRate: samples === 0 ? null : successes / samples,
		samples,
		successes,
		failures
	}
}

test('summary counts free/premium, probed, circuits, and the measured free split', () => {
	const models = [
		// working free (probed, success)
		pm({ slug: 'a/work:free', measurements: measured(1, 0, 400) }),
		// gated free (probed, all failures) + an open circuit
		pm({
			slug: 'b/gated:free',
			measurements: measured(0, 1, 120),
			health: {
				circuit: 'open',
				consecutiveFailures: 3,
				openedAt: 5,
				cooldownMs: 60_000,
				lastSuccessAt: null,
				lastFailureAt: 5
			}
		}),
		// unprobed free
		pm({ slug: 'c/unprobed:free' }),
		// premium, probed
		pm({ slug: 'openai/gpt-4.1', tier: 'premium', measurements: measured(2, 0, 900) })
	]
	const { summary } = buildPoolHealth(models, { stale: false, lastRefreshedAt: 123 })
	assert.equal(summary.total, 4)
	assert.equal(summary.free, 3)
	assert.equal(summary.premium, 1)
	assert.equal(summary.probed, 3)
	assert.equal(summary.openCircuits, 1)
	assert.equal(summary.healthy, 3) // the three closed circuits
	assert.equal(summary.freeWorking, 1)
	assert.equal(summary.freeGated, 1)
	assert.equal(summary.freeUnprobed, 1)
})

test('unprobed models report null successRate/latency — never a fabricated 100%', () => {
	const { models } = buildPoolHealth([pm({ slug: 'x/new:free' })], {
		stale: true,
		lastRefreshedAt: null
	})
	const only = models[0]
	assert.ok(only)
	assert.equal(only.successRate, null)
	assert.equal(only.latencyMs, null)
	assert.equal(only.samples, 0)
})

test('order: working free, then unprobed free, then gated free, then premium', () => {
	const models = [
		pm({ slug: 'p/prem', tier: 'premium', measurements: measured(1, 0, 100) }),
		pm({ slug: 'f/gated:free', measurements: measured(0, 1, 100) }),
		pm({ slug: 'f/unprobed:free' }),
		pm({ slug: 'f/work:free', measurements: measured(1, 0, 100) })
	]
	const { models: out } = buildPoolHealth(models, { stale: false, lastRefreshedAt: 0 })
	assert.deepEqual(
		out.map((m) => m.slug),
		['f/work:free', 'f/unprobed:free', 'f/gated:free', 'p/prem']
	)
})

test('stale + lastRefreshedAt are passed through untouched', () => {
	const res = buildPoolHealth([], { stale: true, lastRefreshedAt: 999 })
	assert.equal(res.stale, true)
	assert.equal(res.lastRefreshedAt, 999)
	assert.deepEqual(res.models, [])
	assert.equal(res.summary.total, 0)
	assert.equal(res.summary.freeWorking, 0)
})
