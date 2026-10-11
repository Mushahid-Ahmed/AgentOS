import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	applyProbe,
	buildPoolModels,
	capabilitiesOf,
	createModelRegistry,
	familyOf,
	isFreeModel,
	isTextGenerationModel,
	LONG_CONTEXT_THRESHOLD,
	toPoolModel
} from './registry'
import type { RawCatalogModel } from './registry'

// The registry is pure (fetch + clock injected); these tests use a fake catalog
// mirroring the real NanoGPT shape captured in V3 Phase 0 and a fake clock. No
// network, no spend, $0.
//
// NanoGPT differs from the old OpenRouter catalog in two load-bearing ways:
// `pricing.prompt/completion` are NUMBERS already in USD per 1M tokens (NOT
// per-token decimal strings), and capabilities are a boolean `capabilities` object
// (NOT a `supported_parameters` string array). The default fixture below is
// gemini-2.5-flash's real per-1M price ($0.30 in / $2.50 out).
const raw = (over: Partial<RawCatalogModel> = {}): RawCatalogModel => ({
	id: 'google/gemini-2.5-flash',
	name: 'Gemini 2.5 Flash',
	context_length: 1000000,
	max_output_tokens: 65536,
	pricing: { prompt: 0.3, completion: 2.5, unit: 'per_million_tokens' },
	architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
	capabilities: { vision: true, reasoning: true, tool_calling: true, structured_output: true },
	...over
})

test('isFreeModel: null pricing is not free (honest, never fabricated)', () => {
	// NanoGPT has no usable free tier (D-44). A model with no price is premium by
	// default rather than assumed free — the price test is the single place that
	// would change if a real free model ever shipped.
	assert.equal(isFreeModel(raw({ id: 'some/new-model', pricing: null })), false)
})

test('isFreeModel: zero prompt+completion price is free', () => {
	assert.equal(isFreeModel(raw({ id: 'x/y', pricing: { prompt: 0, completion: 0 } })), true)
})

test('isFreeModel: any nonzero price is premium', () => {
	assert.equal(isFreeModel(raw({ pricing: { prompt: 0.3, completion: 0 } })), false)
})

test('familyOf parses the slug prefix, or the whole id when prefix-less', () => {
	assert.equal(familyOf('qwen/qwen3.8-27b:free'), 'qwen')
	assert.equal(familyOf('google/gemini-2.5-flash'), 'google')
	// NanoGPT is not uniformly prefixed: a prefix-less slug's family is the whole id.
	assert.equal(familyOf('deepseek-r1'), 'deepseek-r1')
})

test('capabilitiesOf reads tools/structured/vision from the capabilities object only', () => {
	const caps = capabilitiesOf(raw())
	assert.equal(caps.tools, true)
	assert.equal(caps.structuredOutputAdvertised, true)
	assert.equal(caps.vision, true)
	// Advertised is never treated as verified by the catalog transform.
	assert.equal(caps.structuredOutputVerified, false)
})

test('capabilitiesOf: a false/absent capability flag is never inferred as true', () => {
	// gemini-2.5-flash really advertises structured_output:false on NanoGPT.
	const caps = capabilitiesOf(raw({ capabilities: { vision: true, tool_calling: false } }))
	assert.equal(caps.structuredOutputAdvertised, false)
	assert.equal(caps.tools, false)
	assert.equal(caps.vision, true)
})

test('toPoolModel reads per-1M prices directly (no ×1e6) and keeps tier', () => {
	const m = toPoolModel(raw(), 1000)
	assert.ok(m)
	assert.equal(m.slug, 'google/gemini-2.5-flash')
	assert.equal(m.tier, 'premium')
	assert.equal(m.contextLength, 1000000)
	// NanoGPT pricing is ALREADY USD per 1M — the value is read verbatim, NOT
	// multiplied by 1e6 the way the old per-token OpenRouter path was.
	assert.ok(m.promptPricePer1M !== null && Math.abs(m.promptPricePer1M - 0.3) < 1e-9)
	assert.ok(m.completionPricePer1M !== null && Math.abs(m.completionPricePer1M - 2.5) < 1e-9)
	assert.equal(m.refreshedAt, 1000)
})

test('toPoolModel drops a POOL_BLOCKLIST meta-helper (nano-gpt-help / auto-model)', () => {
	// The only 0/0-priced NanoGPT ids are routing helpers, not chat LLMs; they must
	// never enter the pool even though they emit text (D-44).
	assert.equal(toPoolModel(raw({ id: 'nano-gpt-help', pricing: { prompt: 0, completion: 0 } }), 1), null)
	assert.equal(toPoolModel(raw({ id: 'auto-model', pricing: { prompt: 0, completion: 0 } }), 1), null)
})

test('toPoolModel returns null for an entry with no usable id (skipped, not thrown)', () => {
	assert.equal(toPoolModel({ id: '' }, 1), null)
	assert.equal(toPoolModel({}, 1), null)
	assert.equal(toPoolModel({ id: 42 }, 1), null)
})

test('structuralTags: long-context only at/above the threshold, never from a name', () => {
	const big = toPoolModel(raw({ context_length: LONG_CONTEXT_THRESHOLD }), 1)
	assert.ok(big)
	assert.ok(big.tags.includes('long-context'))

	const small = toPoolModel(raw({ id: 'x/huge-context-model', context_length: 8000 }), 1)
	assert.ok(small)
	// Name says "huge-context" but metadata says 8k -> no long-context tag.
	assert.equal(small.tags.includes('long-context'), false)
})

test('structuralTags: catalog transform never assigns measured tags', () => {
	const m = toPoolModel(raw(), 1)
	assert.ok(m)
	assert.equal(m.tags.includes('fast'), false)
	assert.equal(m.tags.includes('strong-reasoning'), false)
})

test('buildPoolModels skips malformed entries and keeps good ones', () => {
	const models = buildPoolModels([raw(), { id: '' }, raw({ id: 'qwen/qwen3.8-27b:free' })], 5)
	assert.equal(models.length, 2)
	assert.deepEqual(
		models.map((m) => m.slug),
		['google/gemini-2.5-flash', 'qwen/qwen3.8-27b:free']
	)
})

test('buildPoolModels on a non-array returns empty (never throws)', () => {
	assert.deepEqual(buildPoolModels(null, 1), [])
	assert.deepEqual(buildPoolModels({ data: [] }, 1), [])
})

test('isTextGenerationModel: text-only output is eligible', () => {
	assert.equal(isTextGenerationModel(raw()), true)
	assert.equal(isTextGenerationModel(raw({ architecture: { output_modalities: ['text'] } })), true)
})

test('isTextGenerationModel: audio/image generation models are excluded', () => {
	// Real shapes from the live catalog (google/lyria-3-pro-preview, image gen).
	assert.equal(
		isTextGenerationModel(raw({ architecture: { output_modalities: ['text', 'audio'] } })),
		false
	)
	assert.equal(
		isTextGenerationModel(raw({ architecture: { output_modalities: ['image', 'text'] } })),
		false
	)
	// Audio-only (no text output) is doubly excluded.
	assert.equal(isTextGenerationModel(raw({ architecture: { output_modalities: ['audio'] } })), false)
})

test('isTextGenerationModel: absent output_modalities is not provably text -> excluded', () => {
	assert.equal(isTextGenerationModel(raw({ architecture: null })), false)
	assert.equal(isTextGenerationModel(raw({ architecture: { input_modalities: ['text'] } })), false)
})

test('toPoolModel returns null for a media-generation model (never a text candidate)', () => {
	assert.equal(
		toPoolModel(
			raw({
				id: 'google/lyria-3-clip-preview',
				architecture: { input_modalities: ['text'], output_modalities: ['text', 'audio'] }
			}),
			1
		),
		null
	)
})

test('buildPoolModels drops audio/image models from the completion pool', () => {
	const models = buildPoolModels(
		[
			raw(),
			raw({ id: 'google/lyria-3-clip-preview', architecture: { output_modalities: ['text', 'audio'] } }),
			raw({ id: 'x/image-gen', architecture: { output_modalities: ['image', 'text'] } }),
			raw({ id: 'qwen/qwen3.8-27b:free' })
		],
		5
	)
	assert.deepEqual(
		models.map((m) => m.slug),
		['google/gemini-2.5-flash', 'qwen/qwen3.8-27b:free']
	)
})

test('registry: getModels loads once, serves from cache, refreshes past TTL', async () => {
	let now = 0
	let fetches = 0
	const registry = createModelRegistry({
		fetchCatalog: async () => {
			fetches++
			return [raw()]
		},
		now: () => now,
		ttlMs: 1000
	})

	const first = await registry.getModels()
	assert.equal(first.length, 1)
	assert.equal(fetches, 1)

	// Within TTL: cached, no refetch.
	now = 500
	await registry.getModels()
	assert.equal(fetches, 1)
	assert.equal(registry.isStale(), false)

	// Past TTL: stale, refetches on read.
	now = 1500
	assert.equal(registry.isStale(), true)
	await registry.getModels()
	assert.equal(fetches, 2)
	assert.equal(registry.lastRefreshedAt(), 1500)
})

test('registry: manual refresh forces a fetch even within TTL', async () => {
	const now = 0
	let fetches = 0
	const registry = createModelRegistry({
		fetchCatalog: async () => {
			fetches++
			return [raw()]
		},
		now: () => now,
		ttlMs: 10_000
	})
	await registry.getModels()
	assert.equal(fetches, 1)
	await registry.refresh()
	assert.equal(fetches, 2)
})

test('registry: get(slug) finds a model and returns null when absent', async () => {
	const registry = createModelRegistry({
		fetchCatalog: async () => [raw({ id: 'qwen/qwen3.8-27b:free' })],
		now: () => 0,
		ttlMs: 1000
	})
	assert.ok(await registry.get('qwen/qwen3.8-27b:free'))
	assert.equal(await registry.get('does/not-exist'), null)
})

test('registry: pinned premium targets survive a catalog that drops them', async () => {
	let phase = 0
	const registry = createModelRegistry({
		fetchCatalog: async () => {
			phase++
			// First load includes the pinned slug; second load omits it.
			return phase === 1
				? [raw({ id: 'google/gemini-2.5-flash' }), raw({ id: 'qwen/qwen3.8-27b:free' })]
				: [raw({ id: 'qwen/qwen3.8-27b:free' })]
		},
		now: () => 0,
		ttlMs: 0, // always stale -> every read refetches
		pinnedPremium: ['google/gemini-2.5-flash']
	})
	await registry.getModels()
	const second = await registry.getModels()
	// The pinned premium target is retained even though the fresh catalog lacks it.
	assert.ok(second.some((m) => m.slug === 'google/gemini-2.5-flash'))
})

test('applyProbe folds a result into rolling latency + success rate', () => {
	const m = toPoolModel(raw({ id: 'qwen/qwen3.8-27b:free' }), 1)
	assert.ok(m)
	const after1 = applyProbe(m, { ok: true, latencyMs: 400 })
	assert.equal(after1.measurements.samples, 1)
	assert.equal(after1.measurements.successes, 1)
	assert.equal(after1.measurements.latencyMs, 400)
	assert.equal(after1.measurements.successRate, 1)

	const after2 = applyProbe(after1, { ok: false, latencyMs: 800 })
	assert.equal(after2.measurements.samples, 2)
	assert.equal(after2.measurements.successes, 1)
	assert.equal(after2.measurements.failures, 1)
	// Rolling mean of 400 and 800.
	assert.equal(after2.measurements.latencyMs, 600)
	assert.equal(after2.measurements.successRate, 0.5)
})

test('applyProbe assigns the measured `fast` tag only under the latency threshold', () => {
	const m = toPoolModel(raw({ id: 'a/b:free' }), 1)
	assert.ok(m)
	const quick = applyProbe(m, { ok: true, latencyMs: 400 })
	assert.ok(quick.tags.includes('fast'))
	const slow = applyProbe(m, { ok: true, latencyMs: 5000 })
	assert.equal(slow.tags.includes('fast'), false)
})

test('registry.recordProbe updates the cached model; unknown slug is a no-op', async () => {
	const registry = createModelRegistry({
		fetchCatalog: async () => [raw({ id: 'qwen/qwen3.8-27b:free' })],
		now: () => 0,
		ttlMs: 1000
	})
	await registry.getModels()
	registry.recordProbe('qwen/qwen3.8-27b:free', { ok: true, latencyMs: 300 })
	// Does not throw for a slug that is not cached.
	registry.recordProbe('not/cached', { ok: true, latencyMs: 300 })
	const m = await registry.get('qwen/qwen3.8-27b:free')
	assert.ok(m)
	assert.equal(m.measurements.samples, 1)
	assert.equal(m.measurements.latencyMs, 300)
	assert.ok(m.tags.includes('fast'))
})

test('registry: a TTL refresh preserves measured health but re-reads fresh metadata', async () => {
	// ttlMs 0 => every read refetches, so the second getModels() is a real refresh.
	// The second catalog bumps context_length; the probe measurement must survive
	// the rebuild while the new metadata is picked up.
	let phase = 0
	const registry = createModelRegistry({
		fetchCatalog: async () => {
			phase++
			return [
				raw({
					id: 'qwen/qwen3.8-27b:free',
					context_length: phase === 1 ? 32_000 : 131_072
				})
			]
		},
		now: () => 0,
		ttlMs: 0
	})
	await registry.getModels()
	registry.recordProbe('qwen/qwen3.8-27b:free', { ok: true, latencyMs: 300 })

	const refreshed = await registry.getModels()
	const m = refreshed.find((x) => x.slug === 'qwen/qwen3.8-27b:free')
	assert.ok(m)
	// Measurements carried forward across the refresh — not reset to samples 0.
	assert.equal(m.measurements.samples, 1)
	assert.equal(m.measurements.latencyMs, 300)
	assert.equal(m.measurements.successRate, 1)
	// The measured `fast` tag is recomputed from the preserved latency.
	assert.ok(m.tags.includes('fast'))
	// Fresh metadata is still applied: 131_072 >= LONG_CONTEXT_THRESHOLD earns the
	// structural tag that the pre-refresh 32k entry did not have.
	assert.equal(m.contextLength, 131_072)
	assert.ok(m.tags.includes('long-context'))
	assert.equal(phase, 2)
})
