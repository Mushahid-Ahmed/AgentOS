import { NANOGPT_CATALOG, pricePer1MFor } from '@/lib/models'

// What a call cost: the arithmetic applied to the curated NanoGPT price table.
// Pure — no network, no database, no Next — which is what ai-usage.test.mts
// exercises.
//
// V3 migration (decisions-log D-42): NanoGPT's `usage` returns token counts but NO
// monetary cost field (verified 2026-10-08, notes §8b), unlike OpenRouter whose
// `usage.cost` was authoritative. So cost is now ALWAYS derived from
// `tokens × curated per-1M USD price`. The rate card is no longer fetched — it is
// the static, verified catalog in src/lib/models.ts, which keeps pricing
// deterministic and unit-testable with no network.

export type TokenCounts = {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

// Costs are stored as millionths of a USD: integers sum exactly, so a spend
// total never drifts the way a running float sum does.
export const MICRO_USD_PER_USD = 1_000_000

// Per-1M USD rates for one slug. NanoGPT publishes these as numbers per million
// (NOT OpenRouter's per-token strings) — see src/lib/models.ts.
export type RatePer1M = { prompt: number; completion: number }

export type RateCard = Map<string, RatePer1M>

// The curated rate card, built once from the verified catalog. A slug absent from
// the catalog is simply not in the map, so it prices NULL (never 0).
const CATALOG_RATE_CARD: RateCard = new Map(
	Object.keys(NANOGPT_CATALOG).map((slug) => {
		const price = pricePer1MFor(slug)!
		return [slug, { prompt: price.prompt, completion: price.completion }]
	})
)

// Synchronous now — there is nothing to fetch. Kept as a function (not a bare
// export) so callers read it the same way they did the old async rate card.
export function rateCard(): RateCard {
	return CATALOG_RATE_CARD
}

// micro-USD = tokens × (per-1M price / 1e6) × 1e6 = tokens × per-1M price, so the
// two 1e6 factors cancel and the arithmetic is a clean integer round.
//
// Returns null when the slug has no known rates, never 0 — see the costMicroUsd
// comment in prisma/schema/ai-usage.prisma for why that distinction is the point.
//
// ponytail: cache-read/cache-write tokens are priced at 0. NanoGPT exposes a
// per-1K cache-read rate for some models but not a uniform per-1M one, and every
// call this repo makes reports cached_tokens:0 (no prompt caching configured), so
// there is nothing to price. If caching is ever enabled, curate a cache rate here
// rather than let cached tokens silently under-report.
export function costMicroUsd(tokens: TokenCounts, rates: RatePer1M | undefined): number | null {
	if (rates == null) return null
	const usd = (tokens.inputTokens * rates.prompt + tokens.outputTokens * rates.completion) / 1e6
	return Math.round(usd * MICRO_USD_PER_USD)
}

// The ledger's cost precedence, pure so it is unit-testable without the sink's
// server-only dependencies. Decision D-42 (V3 NanoGPT migration): a runtime-
// discovered slug is priced from the curated catalog by its resolved slug; a slug
// the catalog does not list prices NULL — never a fabricated 0.
// `providerCostMicroUsd` is retained at the head of the precedence for honesty and
// future-proofing: NanoGPT never sends one (it is always null today), but if a
// provider ever reports a real cost, it wins over the derived figure.
// `pricingSlug` is already resolved by the caller (nanoGptSlug).
export function resolveCostMicroUsd(input: {
	providerCostMicroUsd?: number | null
	tokens: TokenCounts
	pricingSlug: string | null
	rates: RateCard | undefined
}): number | null {
	const real = input.providerCostMicroUsd
	if (typeof real === 'number' && Number.isFinite(real)) return Math.round(real)
	if (input.pricingSlug == null) return null
	return costMicroUsd(input.tokens, input.rates?.get(input.pricingSlug))
}
