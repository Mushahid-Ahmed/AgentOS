import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costMicroUsd, resolveCostMicroUsd, type RateCard, type RatePer1M } from './pricing'
import { nanoGptSlug } from './models'
import { extractUsage } from './usage'
import { buildRow, createAiTracker, type AiCallSpec, type AiUsageRow } from './track'

// Real per-1M USD rates, copied from the curated NanoGPT catalog in
// src/lib/models.ts. Using invented round numbers would let a units bug
// (per-token vs. per-million) pass every assertion here and still be off by six
// orders of magnitude in production. NanoGPT publishes these as NUMBERS per 1M
// tokens — NOT OpenRouter's per-token decimal strings — so no ×1e6 conversion.
const SONNET: RatePer1M = { prompt: 3, completion: 15 } // anthropic/claude-sonnet-4.5

const NO_TOKENS = {
	inputTokens: 0,
	outputTokens: 0,
	cacheWriteTokens: 0,
	cacheReadTokens: 0
}

// --- the model map ---------------------------------------------------------

test('maps a registered short id to its NanoGPT slug', () => {
	assert.equal(nanoGptSlug('claude-sonnet-4.5'), 'anthropic/claude-sonnet-4.5')
	assert.equal(nanoGptSlug('gpt-4.1'), 'openai/gpt-4.1')
	assert.equal(nanoGptSlug('gpt-4.1-nano'), 'openai/gpt-4.1-nano')
	// The Google family carries NO publisher prefix on NanoGPT — the map keeps the
	// short id and the slug identical rather than inventing a `google/` prefix.
	assert.equal(nanoGptSlug('gemini-2.5-flash'), 'gemini-2.5-flash')
})

test('an unregistered short id resolves to null, never a guess', () => {
	assert.equal(nanoGptSlug('some-new-short-id'), null)
	assert.equal(nanoGptSlug('claude-opus-6-20270101'), null)
})

// --- pricing ---------------------------------------------------------------

test('prices input and output tokens at their own per-1M rate', () => {
	const cost = costMicroUsd(
		{ inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 200, cacheReadTokens: 10_000 },
		SONNET
	)
	// (1000×3 + 500×15) / 1e6 = 0.0105 USD = 10_500 micro-USD. Cache buckets are
	// priced at 0 (no prompt caching configured; see the pricing.ts ponytail).
	assert.equal(cost, 10_500)
})

test('an unmapped model prices as null, never as zero', () => {
	assert.equal(costMicroUsd({ ...NO_TOKENS, inputTokens: 1000 }, undefined), null)
})

// --- provider response extraction ------------------------------------------
// V3: every provider is reached through NanoGPT, which normalizes Anthropic /
// OpenAI / Google into ONE OpenAI-shaped `usage` object. So `provider` is now a
// CATEGORY, not a wire-format selector — all three parse the same body, and a
// native Anthropic/Google shape never appears on the wire.

test('all three providers parse the same normalized OpenAI shape', () => {
	const body = {
		id: 'gen-1',
		model: 'openai/gpt-4.1',
		usage: { prompt_tokens: 11_000, completion_tokens: 500 }
	}
	for (const provider of ['anthropic', 'openai', 'google'] as const) {
		const extracted = extractUsage(provider, body)
		assert.equal(extracted?.model, 'openai/gpt-4.1')
		assert.equal(extracted?.requestId, 'gen-1')
		assert.equal(extracted?.tokens.inputTokens, 11_000)
		assert.equal(extracted?.tokens.outputTokens, 500)
	}
})

test('prompt_tokens includes cache, so cached tokens are subtracted out', () => {
	const extracted = extractUsage('openai', {
		id: 'chatcmpl-1',
		model: 'openai/gpt-4.1',
		usage: {
			prompt_tokens: 11_000,
			completion_tokens: 500,
			prompt_tokens_details: { cached_tokens: 10_000 }
		}
	})
	// The trap: billing 11,000 fresh input tokens here would double-count every
	// cache hit and inflate the reported spend on the cheapest calls.
	assert.equal(extracted?.tokens.inputTokens, 1000)
	assert.equal(extracted?.tokens.cacheReadTokens, 10_000)
})

test('a content_filter finish reason is recorded as a refusal, not a success', () => {
	const extracted = extractUsage('openai', {
		choices: [{ finish_reason: 'content_filter' }],
		usage: { prompt_tokens: 10, completion_tokens: 0 }
	})
	assert.equal(extracted?.status, 'refusal')
})

test('NanoGPT reports no monetary cost, so extraction records none (null)', () => {
	const extracted = extractUsage('openai', {
		id: 'gen-3',
		model: 'openai/gpt-4.1',
		usage: { prompt_tokens: 10, completion_tokens: 5 }
	})
	assert.equal(extracted?.cost, null)
})

test('a cost IS carried through when a provider ever reports one', () => {
	// Defensive future-proofing: NanoGPT never sends `cost`, but the extractor
	// reads it so a provider that does takes precedence over the rate card.
	const extracted = extractUsage('openai', {
		id: 'gen-4',
		model: 'openai/gpt-4.1',
		usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000123 }
	})
	assert.equal(extracted?.cost, 0.000123)
})

test('an unrecognised response shape yields no usage rather than throwing', () => {
	assert.equal(extractUsage('openai', { unexpected: true }), undefined)
	assert.equal(extractUsage('anthropic', null), undefined)
})

// --- row building ----------------------------------------------------------

const SPEC: AiCallSpec = {
	provider: 'anthropic',
	model: 'claude-sonnet-4.5',
	feature: 'offer_copy'
}

test('the model that served the call wins over the model that was asked for', () => {
	const row = buildRow(
		SPEC,
		{ model: 'anthropic/claude-sonnet-4.5', usage: { prompt_tokens: 1, completion_tokens: 1 } },
		{ status: 'ok', latencyMs: 12 }
	)
	assert.equal(row.model, 'anthropic/claude-sonnet-4.5')
})

test('a failed call still produces a row, with the requested model and no tokens', () => {
	const row = buildRow(SPEC, undefined, { status: 'error', latencyMs: 12 })
	assert.equal(row.status, 'error')
	assert.equal(row.model, 'claude-sonnet-4.5')
	assert.deepEqual(
		{
			inputTokens: row.inputTokens,
			outputTokens: row.outputTokens,
			cacheWriteTokens: row.cacheWriteTokens,
			cacheReadTokens: row.cacheReadTokens
		},
		NO_TOKENS
	)
})

test('buildRow leaves providerCostMicroUsd null when the response has no cost', () => {
	const row = buildRow(
		SPEC,
		{ model: 'anthropic/claude-sonnet-4.5', usage: { prompt_tokens: 10, completion_tokens: 5 } },
		{ status: 'ok', latencyMs: 5 }
	)
	assert.equal(row.providerCostMicroUsd, null)
})

test('buildRow converts a real usage.cost into provider micro-USD when present', () => {
	const row = buildRow(
		SPEC,
		{
			model: 'anthropic/claude-sonnet-4.5',
			usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000123 }
		},
		{ status: 'ok', latencyMs: 5 }
	)
	assert.equal(row.providerCostMicroUsd, 123)
})

// --- failure isolation -----------------------------------------------------
// The most important tests in this file. Everything else is an accounting detail;
// these decide whether a broken ledger takes a user-facing feature down with it.

test('a sink that throws never breaks the AI call', async () => {
	const trackAiCall = createAiTracker(() => {
		throw new Error('the database is on fire')
	})
	const result = await trackAiCall(SPEC, async () => 'the completion')
	assert.equal(result, 'the completion')
})

test('a broken custom extractor never breaks the AI call either', async () => {
	const rows: AiUsageRow[] = []
	const trackAiCall = createAiTracker((row) => rows.push(row))
	const result = await trackAiCall(
		{
			...SPEC,
			extract: () => {
				throw new Error('this extractor was written on a Friday')
			}
		},
		async () => 'the completion'
	)
	assert.equal(result, 'the completion')
	assert.equal(rows.length, 0)
})

test('a provider error is recorded and then rethrown untouched', async () => {
	const rows: AiUsageRow[] = []
	const trackAiCall = createAiTracker((row) => rows.push(row))
	const boom = new Error('529 overloaded')

	await assert.rejects(
		trackAiCall(SPEC, async () => {
			throw boom
		}),
		(error: unknown) => error === boom
	)
	assert.equal(rows.length, 1)
	assert.equal(rows[0]?.status, 'error')
})

// --- Model Pool ledger (decision D-36) -------------------------------------
// A runtime-discovered slug is not a compile-time TrackedModel, so the pool passes
// the canonical NanoGPT slug verbatim. These prove it resolves and prices from the
// curated catalog, and still degrades to NULL (never 0) when nothing is known.

const CHEAP_FLOOR = 'meta-llama/llama-3.3-70b-instruct'

test('a canonical catalog slug passes through the resolver verbatim', () => {
	// A prefix-less catalog entry (the Meta family) still resolves — the catalog
	// check, not a `/` heuristic, is what catches it.
	assert.equal(nanoGptSlug(CHEAP_FLOOR), CHEAP_FLOOR)
	assert.equal(nanoGptSlug('deepseek-r1'), 'deepseek-r1')
})

test('a prefixed slug nobody mapped still passes through (pool discovery)', () => {
	// The pool discovers slugs at runtime that no short id maps to; a publisher
	// prefix marks it canonical, so it resolves and is priced from the catalog when
	// present, or NULL when absent (never a fabricated 0).
	assert.equal(nanoGptSlug('some/new-model'), 'some/new-model')
})

// --- cost precedence -------------------------------------------------------

test('cost precedence: real provider cost wins, else rate card, else null', () => {
	const rates: RateCard = new Map([['anthropic/claude-sonnet-4.5', SONNET]])

	// A real provider cost is authoritative even when a rate card entry exists.
	assert.equal(
		resolveCostMicroUsd({
			providerCostMicroUsd: 123,
			tokens: { ...NO_TOKENS, inputTokens: 1000 },
			pricingSlug: 'anthropic/claude-sonnet-4.5',
			rates
		}),
		123
	)

	// No provider cost -> fall back to the curated rate card by slug.
	assert.equal(
		resolveCostMicroUsd({
			providerCostMicroUsd: null,
			tokens: { ...NO_TOKENS, inputTokens: 1000, outputTokens: 500 },
			pricingSlug: 'anthropic/claude-sonnet-4.5',
			rates
		}),
		10_500
	)

	// A real 0 is kept as 0, not treated as "no cost".
	assert.equal(
		resolveCostMicroUsd({ providerCostMicroUsd: 0, tokens: NO_TOKENS, pricingSlug: null, rates: undefined }),
		0
	)

	// Neither a provider cost nor a resolvable slug -> NULL, never a fabricated 0.
	assert.equal(
		resolveCostMicroUsd({ providerCostMicroUsd: null, tokens: NO_TOKENS, pricingSlug: null, rates: undefined }),
		null
	)

	// A slug the rate card does not list (and no provider cost) -> NULL.
	assert.equal(
		resolveCostMicroUsd({ providerCostMicroUsd: null, tokens: NO_TOKENS, pricingSlug: 'unknown/slug', rates }),
		null
	)
})
