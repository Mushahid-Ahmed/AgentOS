import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	fitsContext,
	headTier,
	isSelectable,
	satisfiesNeeds,
	scoreInTier,
	selectCandidates
} from './select'
import { freshHealth, freshMeasurements } from './registry'
import type { PoolModel } from './types'
import type { CapabilityRequest } from './types'

// Pure selection policy tests. Fixtures are built directly (no network, $0).

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

const PREMIUM = model({ slug: 'google/gemini-2.5-flash', tier: 'premium' })
const PREMIUM_STRONG = model({
	slug: 'anthropic/claude-sonnet-4.5',
	tier: 'premium',
	capabilities: {
		tools: true,
		structuredOutputAdvertised: true,
		structuredOutputVerified: true,
		vision: false
	}
})
const FREE_TOOLS = model({
	slug: 'qwen/qwen3.8-27b:free',
	tier: 'free',
	contextLength: 262_144,
	capabilities: {
		tools: true,
		structuredOutputAdvertised: true,
		structuredOutputVerified: false,
		vision: true
	}
})
const FREE_SMALL = model({ slug: 'liquid/lfm-2.5-2.6b:free', tier: 'free', contextLength: 65_536 })

const baseRequest: CapabilityRequest = { needs: [], minContext: 0, quality: 'balanced' }

// Regression (the live $0-key incident): the catalog holds dozens of premium models,
// so a premium-first chain of length 4 used to be ALL premium. When the credit wall
// (402) then skipped every premium candidate there was no free model left to fall to
// and the step died instead of degrading. The chain must always carry a free tail.
test('selectCandidates: a premium-saturated chain still reserves a free tail', () => {
	const manyPremium = [
		PREMIUM,
		PREMIUM_STRONG,
		model({ slug: 'p/three', tier: 'premium' }),
		model({ slug: 'p/four', tier: 'premium' }),
		model({ slug: 'p/five', tier: 'premium' }),
		model({ slug: 'p/six', tier: 'premium' })
	]
	const chain = selectCandidates([...manyPremium, FREE_SMALL], baseRequest, {
		maxChainLength: 4
	})
	assert.equal(chain.candidates.length, 4)
	assert.equal(chain.candidates[0]?.tier, 'premium')
	// The last slot is the credit-wall escape hatch.
	assert.equal(chain.candidates[3]?.slug, FREE_SMALL.slug)
	assert.ok(chain.candidates.some((m) => m.tier === 'free'))
})

test('selectCandidates: a premium-heavy chain reserves a SECOND free slot for failover depth', () => {
	// One free slot is fragile: OpenRouter gates some `:free` models to approved
	// agentic harnesses (403) and the account-wide free rate limit can bite. With
	// two free models available the chain must carry both, so a closed first free
	// model still leaves a live tail.
	const secondFree = model({ slug: 'z/second:free', tier: 'free' })
	const chain = selectCandidates(
		[
			PREMIUM,
			PREMIUM_STRONG,
			model({ slug: 'p/three', tier: 'premium' }),
			model({ slug: 'p/four', tier: 'premium' }),
			FREE_SMALL,
			secondFree
		],
		baseRequest,
		{ maxChainLength: 4 }
	)
	assert.equal(chain.candidates.length, 4)
	// The head stays premium (quality step) and is never displaced.
	assert.equal(chain.candidates[0]?.tier, 'premium')
	const freeSlots = chain.candidates.filter((m) => m.tier === 'free')
	assert.equal(freeSlots.length, 2)
	assert.ok(freeSlots.some((m) => m.slug === FREE_SMALL.slug))
	assert.ok(freeSlots.some((m) => m.slug === secondFree.slug))
})

test('selectCandidates: a free-led chain still reserves a premium tail', () => {
	const thirdFree = model({ slug: 'z/third:free', tier: 'free' })
	const chain = selectCandidates([FREE_SMALL, FREE_TOOLS, thirdFree, PREMIUM], {
		...baseRequest,
		quality: 'fast'
	}, { maxChainLength: 3 })
	assert.equal(chain.candidates[0]?.tier, 'free')
	// The slice would otherwise be all-free; the last slot is the escape hatch.
	assert.equal(chain.candidates[2]?.slug, PREMIUM.slug)
})

test('satisfiesNeeds: tool-capable requires real tools metadata', () => {
	assert.equal(satisfiesNeeds(FREE_TOOLS, ['tool-capable']), true)
	assert.equal(satisfiesNeeds(PREMIUM, ['tool-capable']), false)
})

test('satisfiesNeeds: structured-output needs advertised; vision needs image input', () => {
	assert.equal(satisfiesNeeds(FREE_TOOLS, ['structured-output']), true)
	assert.equal(satisfiesNeeds(PREMIUM, ['structured-output']), false)
	assert.equal(satisfiesNeeds(FREE_TOOLS, ['vision']), true)
	assert.equal(satisfiesNeeds(FREE_SMALL, ['vision']), false)
})

test('fitsContext: known context must be >= minContext; unknown only fits min 0 when allowed', () => {
	assert.equal(fitsContext(FREE_SMALL, 65_536, false), true)
	assert.equal(fitsContext(FREE_SMALL, 100_000, false), false)
	const unknown = model({ slug: 'x/y', contextLength: null })
	assert.equal(fitsContext(unknown, 0, true), true)
	assert.equal(fitsContext(unknown, 0, false), false)
	assert.equal(fitsContext(unknown, 500, true), false)
})

test('isSelectable: an open circuit is excluded, half-open is allowed', () => {
	assert.equal(isSelectable(PREMIUM), true)
	assert.equal(isSelectable(model({ slug: 'a/b', health: { ...freshHealth(), circuit: 'open' } })), false)
	assert.equal(
		isSelectable(model({ slug: 'a/b', health: { ...freshHealth(), circuit: 'half-open' } })),
		true
	)
})

test('selectCandidates: high-stakes leads with premium, free is the tail', () => {
	const chain = selectCandidates([FREE_TOOLS, PREMIUM, PREMIUM_STRONG], {
		needs: [],
		minContext: 0,
		quality: 'high',
		highStakes: true
	})
	assert.equal(chain.candidates[0]?.tier, 'premium')
	assert.equal(headTier(chain), 'premium')
	// Free still present as a fallback tail.
	assert.ok(chain.candidates.some((m) => m.tier === 'free'))
})

test('selectCandidates: quality fast lets free lead', () => {
	const chain = selectCandidates([PREMIUM, FREE_TOOLS], {
		needs: [],
		minContext: 0,
		quality: 'fast'
	})
	assert.equal(chain.candidates[0]?.tier, 'free')
})

test('selectCandidates: Jev preferred slug leads and is recorded decidedBy jev', () => {
	const chain = selectCandidates([FREE_TOOLS, PREMIUM, PREMIUM_STRONG], {
		...baseRequest,
		preferredSlug: PREMIUM_STRONG.slug
	})
	assert.equal(chain.candidates[0]?.slug, PREMIUM_STRONG.slug)
	assert.equal(chain.decidedBy, 'jev')
	assert.match(chain.rationale, /Jev's routed model/)
})

test('selectCandidates: a preferred slug that is ineligible falls back to pool-policy', () => {
	// PREMIUM has no tools; the request needs tools, so the preferred pick cannot
	// lead and the pool substitutes -> decidedBy pool-policy.
	const chain = selectCandidates([PREMIUM, FREE_TOOLS], {
		needs: ['tool-capable'],
		minContext: 0,
		quality: 'balanced',
		preferredSlug: PREMIUM.slug
	})
	assert.equal(chain.decidedBy, 'pool-policy')
	assert.equal(chain.candidates[0]?.slug, FREE_TOOLS.slug)
})

test('selectCandidates: hard need filters out models that lack it', () => {
	const chain = selectCandidates([PREMIUM, FREE_SMALL, FREE_TOOLS], {
		needs: ['tool-capable'],
		minContext: 0,
		quality: 'balanced'
	})
	assert.deepEqual(
		chain.candidates.map((m) => m.slug),
		[FREE_TOOLS.slug]
	)
})

test('selectCandidates: minContext drops too-small models (never silent truncation)', () => {
	const chain = selectCandidates([FREE_SMALL, FREE_TOOLS], {
		needs: [],
		minContext: 100_000,
		quality: 'balanced'
	})
	assert.deepEqual(
		chain.candidates.map((m) => m.slug),
		[FREE_TOOLS.slug]
	)
})

test('selectCandidates: open circuit is excluded from the chain', () => {
	const openPremium = model({
		slug: 'anthropic/claude-sonnet-4.5',
		tier: 'premium',
		health: { ...freshHealth(), circuit: 'open' }
	})
	const chain = selectCandidates([openPremium, FREE_TOOLS], baseRequest)
	assert.equal(chain.candidates.some((m) => m.slug === openPremium.slug), false)
	assert.equal(chain.candidates[0]?.slug, FREE_TOOLS.slug)
})

test('selectCandidates: empty result when nothing is eligible, with an honest rationale', () => {
	const chain = selectCandidates([PREMIUM, FREE_SMALL], {
		needs: ['vision'],
		minContext: 0,
		quality: 'high'
	})
	assert.equal(chain.candidates.length, 0)
	assert.equal(chain.decidedBy, 'pool-policy')
	assert.match(chain.rationale, /No model satisfies the request/)
})

test('selectCandidates: chain is capped at maxChainLength (min 1)', () => {
	const many = [
		PREMIUM,
		PREMIUM_STRONG,
		FREE_TOOLS,
		FREE_SMALL,
		model({ slug: 'a/one:free', tier: 'free' }),
		model({ slug: 'b/two:free', tier: 'free' })
	]
	const capped = selectCandidates(many, baseRequest, { maxChainLength: 3 })
	assert.equal(capped.candidates.length, 3)
	const atLeastOne = selectCandidates(many, baseRequest, { maxChainLength: 0 })
	assert.equal(atLeastOne.candidates.length, 1)
})

test('selectCandidates: deterministic ordering for identical input', () => {
	const models = [FREE_TOOLS, PREMIUM, PREMIUM_STRONG, FREE_SMALL]
	const a = selectCandidates(models, baseRequest).candidates.map((m) => m.slug)
	const b = selectCandidates(models, baseRequest).candidates.map((m) => m.slug)
	assert.deepEqual(a, b)
})

test('scoreInTier: verified structured output outranks advertised when the need is structured-output', () => {
	const req: CapabilityRequest = { needs: ['structured-output'], minContext: 0, quality: 'balanced' }
	const verified = model({
		slug: 'v/m',
		capabilities: {
			tools: false,
			structuredOutputAdvertised: true,
			structuredOutputVerified: true,
			vision: false
		}
	})
	const advertised = model({
		slug: 'a/m',
		capabilities: {
			tools: false,
			structuredOutputAdvertised: true,
			structuredOutputVerified: false,
			vision: false
		}
	})
	assert.ok(scoreInTier(verified, req) > scoreInTier(advertised, req))
})

test('scoreInTier: higher measured success rate scores higher', () => {
	const req: CapabilityRequest = { needs: [], minContext: 0, quality: 'balanced' }
	const reliable = model({
		slug: 'r/m',
		measurements: { latencyMs: 500, successRate: 1, samples: 10, successes: 10, failures: 0 }
	})
	const flaky = model({
		slug: 'f/m',
		measurements: { latencyMs: 500, successRate: 0.3, samples: 10, successes: 3, failures: 7 }
	})
	assert.ok(scoreInTier(reliable, req) > scoreInTier(flaky, req))
})

test('scoreInTier: a proven-failing model ranks BELOW an unprobed one', () => {
	// A model that 403s as app-restricted records successRate 0; it must fall under
	// a model we have never tried (null), or the free tail repeats a dead model.
	const req = { ...baseRequest }
	const provenBad = model({
		slug: 'x/proven-bad:free',
		measurements: { latencyMs: 100, successRate: 0, samples: 3, successes: 0, failures: 3 }
	})
	const unprobed = model({ slug: 'x/unprobed:free' })
	assert.ok(scoreInTier(unprobed, req) > scoreInTier(provenBad, req))
})
