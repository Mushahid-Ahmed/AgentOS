import 'server-only'
import { log } from '@/server/lib/logger'
import { trackAiCall } from '@/server/lib/ai-usage/sink'
import { getModel, costUsdFor } from '@/lib/models'
import { parseJudgeVerdict } from '@/lib/agentos-benchmark/judge-parse'
import { completeOnce, NanoGPTError, type ChatMessage, type NanoGPTCompletion } from './nanogpt'

// The rubric judge for the AgentOS 4-setup benchmark (milestone 8). It grades one
// answer against one task's rubric and returns a 0..1 score plus a JUDGE-ESTIMATED
// count of unsupported claims. Every setup (A/B/C/D) is graded by this SAME judge
// with the SAME prompt, so the comparison is fair and the numbers are measured, not
// asserted (§ "do not invent numbers").
//
// Deliberately a different model family (gpt-4.1) from the gemini-2.5-flash that
// generates the baseline answers, so the judge is not scoring its own family's prose.
// Never used on the live chat path — only by the benchmark engine.
//
// The parse is delegated to the pure, unit-tested parseJudgeVerdict (src/lib/
// agentos-benchmark/judge-parse.ts): a missing/unparsable score yields null and this
// module returns an honest failure, never a fabricated 0 or 0.5.

const JUDGE_MODEL_LABEL = 'gpt' // -> openai/gpt-4.1 (see lib/models.ts)
// The JSON verdict plus a short note needs more room than a one-word label, but
// stays small so the completion is cheap and a note can't ramble.
const RUBRIC_MAX_TOKENS = 320
const RUBRIC_MAX_RETRIES = 3
const RUBRIC_RETRY_BUFFER_MS = 250
const RUBRIC_MAX_BACKOFF_MS = 15_000

// Fixed wording for every (task, setup) so score differences are about the ANSWER,
// not the phrasing. Demands ONLY the JSON object — no prose, no fences.
const RUBRIC_SYSTEM_PROMPT = [
	'You are a strict, impartial grader for a research/answering benchmark.',
	'You are given a TASK, its scoring RUBRIC, and one candidate ANSWER. Score how well the ANSWER satisfies the RUBRIC.',
	'',
	'score: a single number from 0 to 1 (0 = does not address the task at all, 1 = fully satisfies every rubric point).',
	'unsupportedClaims: your best estimate of how many factual claims in the ANSWER have NO supporting evidence or citation. An empty or trivial answer has 0.',
	'notes: one short sentence justifying the score.',
	'',
	'Be consistent and harsh on unsupported claims. Judge ONLY against the rubric; ignore length for its own sake.',
	'Reply with EXACTLY one JSON object and nothing else: no prose, no code fences:',
	'{"score": <0..1>, "unsupportedClaims": <integer >= 0>, "notes": "<one sentence>"}'
].join('\n')

export type RubricInput = {
	taskId: string
	setup: string
	task: string
	rubric: string
	answer: string
}

export type RubricJudgeResult =
	| {
			ok: true
			score: number
			unsupportedClaims: number
			notes: string
			// The judge hop's cost in USD, computed from the response token counts ×
			// the curated per-1M price for the judge slug (NanoGPT returns no usage.cost).
			// Kept separate from the generator's so the benchmark reports both honestly.
			// Null when uncataloged — never a fabricated 0.
			costUsd: number | null
			latencyMs: number
			promptTokens: number
			completionTokens: number
	  }
	| {
			ok: false
			error: string
			latencyMs: number
			// Even a failed judge hop cost tokens; report the real cost when known.
			costUsd: number | null
	  }

function backoffMs(attempt: number): number {
	return Math.min(2 ** attempt * 500 + RUBRIC_RETRY_BUFFER_MS, RUBRIC_MAX_BACKOFF_MS)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildUserPrompt(input: RubricInput): string {
	return [
		`TASK:\n${input.task}`,
		'',
		`RUBRIC:\n${input.rubric}`,
		'',
		`ANSWER (setup=${input.setup}, task=${input.taskId}):\n${input.answer}`,
		'',
		'Return only the JSON verdict.'
	].join('\n')
}

/**
 * Grade one answer against one rubric.
 *
 * Mirrors judgeRoute's contract: returns a real verdict or an honest failure,
 * never a silent default score. Retries 429/5xx with backoff; a 4xx, an
 * unparseable verdict, or an exhausted retry budget fails. Each attempt
 * (including failures) is tracked in ai_usage under feature 'agentos_bench_judge',
 * so the judge's real spend is on the ledger.
 */
export async function judgeAnswer(input: RubricInput): Promise<RubricJudgeResult> {
	const slug = getModel(JUDGE_MODEL_LABEL).slug
	const messages: ChatMessage[] = [
		{ role: 'system', content: RUBRIC_SYSTEM_PROMPT },
		{ role: 'user', content: buildUserPrompt(input) }
	]

	let lastLatencyMs = 0

	for (let attempt = 0; attempt <= RUBRIC_MAX_RETRIES; attempt++) {
		const startedAt = performance.now()
		try {
			const response = await trackAiCall(
				{
					provider: 'openai',
					model: 'gpt-4.1',
					feature: 'agentos_bench_judge',
					// Ids/enums/numbers only (docs/rules/analytics.md rule 5).
					meta: { setup: input.setup, taskId: input.taskId, attempt },
					// Same reason the routing judge uses a custom extract: NanoGPT reports
					// the served model as the full slug ("openai/gpt-4.1"), which is NOT a key
					// in NANOGPT_SLUGS (keyed by short id), so omitting `model` lets
					// spec.model ('gpt-4.1') win and price the row.
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
				() => completeOnce(slug, messages, RUBRIC_MAX_TOKENS)
			)
			const latencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = latencyMs

			const usage = response.usage
			const costUsd = costUsdFor(slug, usage?.prompt_tokens, usage?.completion_tokens)
			const text = response.choices?.[0]?.message?.content ?? ''
			const verdict = parseJudgeVerdict(text)
			if (!verdict) {
				// An unparseable verdict is a hard failure (not retried): re-asking the
				// same model the same prompt would very likely repeat it, and a fabricated
				// score would poison the comparison. Record it honestly.
				return { ok: false, error: `unparseable_verdict:${text.slice(0, 24) || 'empty'}`, latencyMs, costUsd }
			}

			return {
				ok: true,
				score: verdict.score,
				unsupportedClaims: verdict.unsupportedClaims,
				notes: verdict.notes,
				costUsd,
				latencyMs,
				promptTokens: usage?.prompt_tokens ?? 0,
				completionTokens: usage?.completion_tokens ?? 0
			}
		} catch (error) {
			const latencyMs = Math.round(performance.now() - startedAt)
			lastLatencyMs = latencyMs
			const status = error instanceof NanoGPTError ? error.status : 0
			const retryable = status === 429 || status >= 500
			if (retryable && attempt < RUBRIC_MAX_RETRIES) {
				const waitMs = backoffMs(attempt)
				log.warn('rubric judge retrying', { status, attempt: attempt + 1, waitMs })
				await sleep(waitMs)
				continue
			}
			const reason = error instanceof Error ? error.message : 'judge_error'
			return { ok: false, error: reason.slice(0, 120), latencyMs, costUsd: null }
		}
	}

	return { ok: false, error: 'retries_exhausted', latencyMs: lastLatencyMs, costUsd: null }
}
