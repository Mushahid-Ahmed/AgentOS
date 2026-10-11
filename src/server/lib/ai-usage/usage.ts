import { z } from 'zod'
import type { TokenCounts } from './pricing'
import type { AiCallStatus, AiProvider } from './models'

// Reads token counts, the served model id, the request id and a refusal signal
// out of a raw provider response. Zod rather than hand-rolled narrowing so an
// unexpected response shape degrades to "no usage recorded" instead of throwing
// inside the tracking path (docs/rules/code-style.md: every external contract is
// parsed, never assumed).
//
// **One wire format.** Every provider is reached through NanoGPT (V3 Workstream
// 0), which normalizes Anthropic / OpenAI / Google / Meta responses into ONE
// OpenAI-shaped `usage` object. So the `provider` on an ai_usage row is now a
// CATEGORY, not a wire-format selector: all three route to the same OpenAI
// extractor. Keeping per-provider parsers would mis-parse NanoGPT's normalized
// body (Anthropic's `input_tokens` / Google's `usageMetadata` never appear).
//
// The one accounting rule that still matters, on the OpenAI shape:
//   prompt_tokens INCLUDES prompt_tokens_details.cached_tokens. Subtract it, or
//   every cache hit is billed twice. completion_tokens already includes any
//   reasoning tokens, so nothing is added on the output side.
//
// NanoGPT returns NO monetary `cost` (verified), so this extractor records token
// counts only; cost is derived downstream from tokens × the curated per-1M price
// table (pricing.ts). `ExtractedUsage.cost` stays null and resolveCostMicroUsd
// falls through to the rate card.

export type ExtractedUsage = {
	model?: string
	requestId?: string
	status?: AiCallStatus
	tokens: TokenCounts
	// The provider's OWN real spend for this call, in USD, when it reported one.
	// NanoGPT never does, so this is always null on the live path — kept on the
	// type so a future provider that DOES return a cost can populate it and take
	// precedence over the rate card (see resolveCostMicroUsd). Null (never 0).
	cost?: number | null
}

export type UsageExtractor = (response: unknown) => ExtractedUsage | undefined

const count = z
	.number()
	.nullish()
	.transform((value) => value ?? 0)

const openaiResponse = z.object({
	id: z.string().optional(),
	model: z.string().optional(),
	choices: z.array(z.object({ finish_reason: z.string().nullish() })).optional(),
	usage: z.object({
		prompt_tokens: count,
		completion_tokens: count,
		prompt_tokens_details: z.object({ cached_tokens: count }).optional(),
		// NanoGPT reports no `cost`; read defensively so a provider that does
		// returns it, and an absent one stays null (falls back to the rate card).
		cost: z.number().nullish()
	})
})

// Never let a negative fall through: a provider changing its accounting mid-
// flight should show up as an odd-looking zero, not as a credit.
function nonNegative(value: number): number {
	return value > 0 ? value : 0
}

// The single extractor every provider routes through, because NanoGPT serves them
// all in the OpenAI wire format. Reads the cached-token split, the refusal
// signal, and (when present) a provider cost.
const openAiExtractor: UsageExtractor = (response) => {
	const parsed = openaiResponse.safeParse(response)
	if (!parsed.success) return undefined
	const { id, model, choices, usage } = parsed.data
	const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
	// Carry a provider cost only when it is a finite number; NanoGPT returns none,
	// so this is null and the row is priced from the curated rate card instead.
	const cost = typeof usage.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null
	return {
		model,
		requestId: id,
		status: choices?.[0]?.finish_reason === 'content_filter' ? 'refusal' : 'ok',
		cost,
		tokens: {
			inputTokens: nonNegative(usage.prompt_tokens - cached),
			outputTokens: usage.completion_tokens,
			// OpenAI-format responses do not bill for writing a cache entry, so
			// there is no write figure to record — not a gap, an absence.
			cacheWriteTokens: 0,
			cacheReadTokens: cached
		}
	}
}

const EXTRACTORS: Record<AiProvider, UsageExtractor> = {
	anthropic: openAiExtractor,
	openai: openAiExtractor,
	google: openAiExtractor
}

export function extractUsage(provider: AiProvider, response: unknown): ExtractedUsage | undefined {
	return EXTRACTORS[provider](response)
}
