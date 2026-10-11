import type { TokenCounts } from './pricing'
import { MICRO_USD_PER_USD } from './pricing'
import type { AiCallStatus, AiProvider, ServiceTier, TrackedModel } from './models'
import { extractUsage, type UsageExtractor } from './usage'

// Orchestration only: wrap a provider call, time it, build the row, hand the
// row to a sink. Deliberately imports neither `next/server` nor the Prisma
// client, so the whole thing is unit-testable under `node --test` — the sink
// is where those live (see sink.ts). The injection is load-bearing, not
// decorative: it is the only reason the "a tracking failure never breaks the
// AI call" test can exist.

export type AiUsageRow = TokenCounts & {
	provider: AiProvider
	model: string
	serviceTier: ServiceTier
	feature: string
	status: AiCallStatus
	latencyMs: number
	requestId?: string
	meta?: AiUsageMeta
	// The provider's own real spend for this call, in integer millionths of a USD,
	// when the response reported one. NanoGPT never does (its `usage` carries token
	// counts but no monetary cost), so on the live path this is null and the sink
	// prices the row from the curated rate card (tokens × per-1M). The field is kept
	// so a provider that DOES report a cost still takes precedence over the table.
	providerCostMicroUsd?: number | null
}

// Ids, enums and booleans only — the same rule as an analytics property
// (docs/rules/analytics.md rule 5). No prompt text, no completion text, no
// free text a human typed.
export type AiUsageMeta = Record<string, string | number | boolean>

export type AiCallSpec = {
	provider: AiProvider
	// What the spend is FOR. Required, and worth a moment's thought: it is
	// the axis every cost question gets asked along.
	feature: string
	// The model being asked for. Mapped models (TrackedModel) are the normal,
	// compile-time-checked path: a new short provider id must be registered in
	// models.ts before a call site can name it, and `pnpm check:ai-models` guards
	// the mapping against upstream retirement.
	//
	// The `(string & {})` arm is the Model Pool escape hatch (decision D-36): a
	// runtime-discovered slug is not known at compile time, so the pool passes the
	// CANONICAL NanoGPT slug verbatim (e.g. `meta-llama/llama-3.3-70b-instruct`).
	// A string that is already a slug is priced from the curated rate card by that
	// slug (NanoGPT returns no usage.cost); anything unmapped prices NULL — never 0
	// — and is reported once. Autocomplete for the mapped literals is preserved by
	// the intersection trick.
	model: TrackedModel | (string & {})
	serviceTier?: ServiceTier
	meta?: AiUsageMeta
	// Override for a response shape the built-in extractors don't know —
	// a streamed aggregate, an image endpoint, a provider SDK's own wrapper.
	extract?: UsageExtractor
}

export type UsageSink = (row: AiUsageRow) => void

const NO_TOKENS: TokenCounts = {
	inputTokens: 0,
	outputTokens: 0,
	cacheWriteTokens: 0,
	cacheReadTokens: 0
}

export function buildRow(
	spec: AiCallSpec,
	response: unknown,
	outcome: { status: AiCallStatus; latencyMs: number }
): AiUsageRow {
	const extracted =
		outcome.status === 'error'
			? undefined
			: (spec.extract ?? ((raw) => extractUsage(spec.provider, raw)))(response)
	// The provider's real spend, converted to the ledger's integer-millionths unit.
	// A finite 0 (a `:free` model) is kept as a real 0; an absent/garbage cost stays
	// null so the sink falls back to the rate card rather than inventing a number.
	const rawCost = extracted?.cost
	const providerCostMicroUsd =
		typeof rawCost === 'number' && Number.isFinite(rawCost)
			? Math.round(rawCost * MICRO_USD_PER_USD)
			: null
	return {
		provider: spec.provider,
		// The served model wins over the requested one — that is the whole
		// point of the column, and of a billing dispute.
		model: extracted?.model ?? spec.model,
		serviceTier: spec.serviceTier ?? 'standard',
		feature: spec.feature,
		status: extracted?.status ?? outcome.status,
		latencyMs: outcome.latencyMs,
		requestId: extracted?.requestId,
		meta: spec.meta,
		providerCostMicroUsd,
		...(extracted?.tokens ?? NO_TOKENS)
	}
}

export function createAiTracker(sink: UsageSink) {
	// Nothing in the tracking path is allowed to reach the caller. A failed
	// row costs a line in a spend report; a failed AI call costs a user their
	// feature. That trade is never close, so this swallows everything —
	// including a bug in buildRow or in a caller's own `extract`.
	function record(spec: AiCallSpec, response: unknown, status: AiCallStatus, startedAt: number) {
		try {
			sink(buildRow(spec, response, { status, latencyMs: Date.now() - startedAt }))
		} catch {
			// The sink is responsible for reporting its own failures to Sentry;
			// it holds the context to do it usefully and this frame does not.
		}
	}

	return async function trackAiCall<T>(spec: AiCallSpec, call: () => Promise<T>): Promise<T> {
		const startedAt = Date.now()
		try {
			const response = await call()
			record(spec, response, 'ok', startedAt)
			return response
		} catch (error) {
			record(spec, undefined, 'error', startedAt)
			throw error
		}
	}
}
