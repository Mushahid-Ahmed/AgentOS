import 'server-only'
import { log } from '@/server/lib/logger'
import { trackAiCall } from '@/server/lib/ai-usage/sink'
import { JUDGE_MODEL, MODEL_LABELS, costUsdFor, isModelLabel, type ModelLabel } from '@/lib/models'
import { completeOnce, NanoGPTError, type ChatMessage, type NanoGPTCompletion } from './nanogpt'
import { ROUTE_CRITERIA } from './jev'

// The LLM-as-judge routing baseline (milestone 4). This is the thing Jev's
// speed story is measured AGAINST: a small NanoGPT model given a fixed
// classification prompt and the SAME {claude,gpt,gemini} label meanings Jev
// routes on (imported from jev.ts, not restated — a fair comparison needs one
// definition of what each label is for). It must generate a decision, which is
// why it is slower than Jev's decision-only hop; the benchmark quantifies that
// gap with real measurements rather than the brief's un-reproduced "~30-50ms".
//
// Never used on the live chat path — only by the benchmark engine.

// The judge answers with a single label; 8 tokens leaves room for stray
// punctuation without letting it ramble (and keeps the completion cheap).
const JUDGE_MAX_TOKENS = 8
const JUDGE_MAX_RETRIES = 3
const JUDGE_RETRY_BUFFER_MS = 250
const JUDGE_MAX_BACKOFF_MS = 15_000

// Fixed prompt: identical wording for every query so latency differences are
// about the model, not the phrasing. Criteria are interpolated from the shared
// ROUTE_CRITERIA so judge and Jev are choosing between the same meanings.
const JUDGE_SYSTEM_PROMPT = [
	'You are a routing classifier. Read the user query and choose the single model best suited to answer it.',
	'Reply with EXACTLY one word — claude, gpt, or gemini — and nothing else. No punctuation, no explanation.',
	'',
	'Model meanings:',
	...MODEL_LABELS.map((label) => `- ${label}: ${ROUTE_CRITERIA[label]}`)
].join('\n')

export type JudgeResult =
	| {
			ok: true
			label: ModelLabel
			// The successful classification hop only, ms — measured identically to
			// Jev's jevLatencyMs so the two are directly comparable.
			latencyMs: number
			// The judge hop's cost in USD, computed from the response token counts ×
			// the curated per-1M price for JUDGE_MODEL (NanoGPT returns no usage.cost);
			// the "routing cost" the judge side contributes, vs Jev's $0. Null when the
			// slug is uncataloged — never a fabricated 0.
			costUsd: number | null
			promptTokens: number
			completionTokens: number
	  }
	| {
			ok: false
			error: string
			latencyMs: number
	  }

// The judge is told to reply with one bare label, but small models decorate
// ("gpt.", "Label: gemini"). Take the first token that IS a label, else the
// first label appearing anywhere; null if none — recorded as an error row, not
// coerced, so judge accuracy/failure-rate stay honest.
function parseLabel(text: string): ModelLabel | null {
	const normalized = text.toLowerCase().trim()
	for (const token of normalized.split(/[^a-z]+/)) {
		if (isModelLabel(token)) return token
	}
	for (const label of MODEL_LABELS) {
		if (normalized.includes(label)) return label
	}
	return null
}

function backoffMs(attempt: number): number {
	return Math.min(2 ** attempt * 500 + JUDGE_RETRY_BUFFER_MS, JUDGE_MAX_BACKOFF_MS)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Classify a query with the LLM-as-judge baseline.
 *
 * Mirrors routeQueryMeasured's contract: returns the real label or an error,
 * never a silent default. Retries 429/5xx with backoff; a 4xx or an
 * out-of-vocab answer fails fast. Each attempt (including failures) is tracked
 * in ai_usage, so the judge's real spend is on the ledger.
 */
export async function judgeRoute(query: string): Promise<JudgeResult> {
	const messages: ChatMessage[] = [
		{ role: 'system', content: JUDGE_SYSTEM_PROMPT },
		{ role: 'user', content: query }
	]

	let lastLatencyMs = 0

	for (let attempt = 0; attempt <= JUDGE_MAX_RETRIES; attempt++) {
		const startedAt = performance.now()
		try {
			// trackAiCall prices the raw OpenAI-shaped response with the built-in
			// `openai` extractor (no custom extract needed — this is not streamed).
			const response = await trackAiCall(
				{
					provider: 'openai',
					model: 'gpt-4.1-nano',
					feature: 'benchmark_judge',
					// Ids/enums/numbers only (docs/rules/analytics.md rule 5).
					meta: { router: 'judge', attempt },
					// Custom extract, same reason the chat path uses one: NanoGPT
					// reports the served model as the full slug ("openai/gpt-4.1-nano"),
					// which is NOT a key in NANOGPT_SLUGS (keyed by short id), so the
					// built-in extractor would leave the row unpriced. Omitting `model`
					// lets spec.model ('gpt-4.1-nano') win, which maps to the slug and
					// prices the row. The judge does a tiny classification with no
					// caching, so the token math is just the two raw counts.
					extract: (raw) => {
						const r = raw as NanoGPTCompletion
						const usage = r.usage
						return {
							status: r.choices?.[0]?.finish_reason === 'content_filter' ? 'refusal' : 'ok',
							tokens: {
								inputTokens: usage?.prompt_tokens ?? 0,
								outputTokens: usage?.completion_tokens ?? 0,
								cacheWriteTokens: 0,
								cacheReadTokens: 0
							}
						}
					}
				},
				() => completeOnce(JUDGE_MODEL, messages, JUDGE_MAX_TOKENS)
			)
			const latencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = latencyMs

			const text = response.choices?.[0]?.message?.content ?? ''
			const label = parseLabel(text)
			if (!label) {
				return { ok: false, error: `invalid_label:${text.slice(0, 24) || 'empty'}`, latencyMs }
			}

			const usage = response.usage
			return {
				ok: true,
				label,
				latencyMs,
				costUsd: costUsdFor(JUDGE_MODEL, usage?.prompt_tokens, usage?.completion_tokens),
				promptTokens: usage?.prompt_tokens ?? 0,
				completionTokens: usage?.completion_tokens ?? 0
			}
		} catch (error) {
			const latencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = latencyMs
			const status = error instanceof NanoGPTError ? error.status : 0
			const retryable = status === 429 || status >= 500
			if (retryable && attempt < JUDGE_MAX_RETRIES) {
				const waitMs = backoffMs(attempt)
				log.warn('judge router retrying', { status, attempt: attempt + 1, waitMs })
				await sleep(waitMs)
				continue
			}
			const reason = error instanceof Error ? error.message : 'judge_error'
			return { ok: false, error: reason.slice(0, 120), latencyMs }
		}
	}

	return { ok: false, error: 'retries_exhausted', latencyMs: lastLatencyMs }
}
