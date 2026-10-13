import 'server-only'
import { after } from 'next/server'
import { db } from '@/server/db/client'
import { captureError } from '@/lib/observability/capture-error'
import { nanoGptSlug } from './models'
import { resolveCostMicroUsd, rateCard } from './pricing'
import { createAiTracker, type AiUsageRow } from './track'

// The real sink: price the row, write it, and make sure a failure here can
// only ever cost a row, never the AI call that produced it. Everything that
// makes this untestable under `node --test` (server-only, next/server, the
// Prisma client) is confined to this file so track.ts stays pure.

// Deduped per process. Sentry is for things an engineer must fix, and a model
// that is unmapped on one call is unmapped on the next ten thousand —
// alerting on each would guarantee the alert gets muted, which is the exact
// failure this whole design is built to avoid.
const reportedModels = new Set<string>()

/**
 * Wrap a provider call so its token usage lands in `ai_usage`.
 *
 * ```ts
 * const message = await trackAiCall(
 *   { provider: 'anthropic', model: 'claude-sonnet-4.5', feature: 'offer_copy' },
 *   () => completeOnce('anthropic/claude-sonnet-4.5', messages)
 * )
 * ```
 *
 * Returns the provider's response untouched, and rethrows its errors
 * untouched. See docs/rules/ai-usage.md.
 */
export const trackAiCall = createAiTracker(recordUsage)

function recordUsage(row: AiUsageRow): void {
	const write = persist(row).catch((error) => {
		captureError(error, { feature: row.feature, provider: row.provider, model: row.model })
	})
	try {
		// Keeps the write alive past the response on Vercel without adding its
		// latency to the response.
		after(write)
	} catch {
		// Not inside a request scope (a script, a queue worker, a test) — the
		// promise is already running, so there is nothing left to arrange.
	}
}

async function persist(row: AiUsageRow): Promise<void> {
	// The rate card is now a synchronous curated table (src/lib/models.ts is the
	// single source of truth) — no fetch, no TTL cache, no await.
	const rates = rateCard()
	// Resolve the model id to the NanoGPT slug that keys the curated price table.
	// A runtime-discovered pool slug (Model Pool, D-36) passes through verbatim, so
	// it stores and prices by its real NanoGPT id. The service tier does not alter
	// the slug (NanoGPT has no `:batch` variant), so one resolution serves both the
	// stored `model` column and the price lookup.
	const slug = nanoGptSlug(row.model)
	// Cost precedence (resolveCostMicroUsd): the provider's real usage.cost when it
	// reported one (NanoGPT never does), else the curated rate card by slug, else
	// NULL. A row is only "unmapped" when NEITHER a slug resolved NOR the provider
	// priced it — an unmapped model is not a priced-at-0 model.
	const hasProviderCost = typeof row.providerCostMicroUsd === 'number' && Number.isFinite(row.providerCostMicroUsd)
	if (slug == null && !hasProviderCost) reportUnmappedModel(row)

	const cost = resolveCostMicroUsd({
		providerCostMicroUsd: row.providerCostMicroUsd,
		tokens: row,
		pricingSlug: slug,
		rates
	})
	await db.aiUsage.create({
		data: {
			provider: row.provider,
			// The NanoGPT slug, so one model reads as one model across every repo. A
			// provider serves the same model under different ids depending on whether
			// the call named a dated or a floating alias, and the slug is the only form
			// that collapses them.
			//
			// Falls back to the provider's raw id when nothing is mapped. That is the
			// string someone needs in order to find the slug, and those rows are exactly
			// the ones carrying a NULL cost.
			model: slug ?? row.model,
			serviceTier: row.serviceTier,
			feature: row.feature,
			inputTokens: row.inputTokens,
			outputTokens: row.outputTokens,
			cacheWriteTokens: row.cacheWriteTokens,
			cacheReadTokens: row.cacheReadTokens,
			costMicroUsd: cost == null ? null : BigInt(cost),
			status: row.status,
			latencyMs: row.latencyMs,
			requestId: row.requestId,
			meta: row.meta
		}
	})
}

function reportUnmappedModel(row: AiUsageRow): void {
	if (reportedModels.has(row.model)) return
	reportedModels.add(row.model)
	captureError(
		new Error(`No NanoGPT slug mapped for model "${row.model}"; usage is recorded unpriced`),
		{ provider: row.provider, model: row.model, feature: row.feature }
	)
}
