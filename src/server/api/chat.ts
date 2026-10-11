import 'server-only'
import { z } from 'zod'
import { familyDegradationChain } from '@/lib/chat-model-chain'
import { classifyFailure } from '@/lib/model-pool/classify'
import { selectCandidates } from '@/lib/model-pool/select'
import type { FailureKind, ModelTier } from '@/lib/model-pool/types'
import { getModel, type ModelInfo } from '@/lib/models'
import { routeQuery } from '@/server/ai/jev'
import { streamCompletion, type ChatMessage, type StreamUsage } from '@/server/ai/nanogpt'
import { getModelRegistry } from '@/server/model-pool/registry'
import { PROVIDER, TRACKED_MODEL } from '@/server/ai/tracked-models'
import { log } from '@/server/lib/logger'
import { trackAiCall } from '@/server/lib/ai-usage/sink'
import { persistAssistantTurn, persistUserTurn } from './chat-store'
import type {
	ConversationEventPayload,
	DoneEventPayload,
	ErrorEventPayload,
	RouteEventPayload,
	TokenEventPayload
} from '@/lib/chat-stream'

// The chat pipeline: Jev routes the newest user turn to a model, that model
// streams the answer, and routing + usage telemetry ride along as SSE events.
// This module owns the orchestration; the route file (src/app/api/chat/route.ts)
// is a thin transport adapter, per the template's "route.ts = zero logic" rule.
//
// createApiRoute (route-factory.ts) is deliberately NOT used: it buffers a JSON
// body, and this endpoint streams. Streaming routes are the documented
// exception to that convention.
//
// Persistence (milestone 3) is best-effort and lives in ./chat-store: the user
// turn is saved before streaming so the thread exists even if the answer fails,
// and the assistant turn + route_event are saved once the stream completes. A
// database failure never breaks the answer.

export const chatInputSchema = z.object({
	messages: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string().min(1).max(32_000)
			})
		)
		.min(1)
		.max(50),
	// String form of the BigInt conversation id; omit to start a new thread.
	conversationId: z
		.string()
		.regex(/^\d+$/, 'conversationId must be a numeric string')
		.optional()
})

export type ChatInput = z.infer<typeof chatInputSchema>

// A short house prompt so the three models answer in a comparable register.
// Kept minimal — the product is the routing, not prompt engineering.
const SYSTEM_PROMPT =
	'You are a helpful assistant inside Jev-Swarm, a workspace that routes each question to the best-fit model. Answer directly and concisely. Use Markdown; put code in fenced blocks with a language.'

function encodeEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// A per-request cost (USD) -> integer millionths, the unit
// route_events.cost_micro_usd stores so dashboard sums stay exact. NanoGPT
// returns no monetary cost, so this is fed the token×curated-price estimate
// (see estimatedCost below). Null (never 0) when there is no finite figure,
// matching the ai_usage rule.
function toCostMicroUsd(cost: number | null | undefined): bigint | null {
	if (cost == null || !Number.isFinite(cost)) return null
	return BigInt(Math.round(cost * 1_000_000))
}

// One streaming candidate: either Jev's routed model (the head) or a pool model
// the selection policy placed behind it as failover.
type ChatCandidate = {
	slug: string
	displayName: string
	tier: ModelTier
	promptPricePer1M: number | null
	completionPricePer1M: number | null
}

// Failure classes another model can plausibly absorb: the credit wall (402), a
// rate limit (429), provider outage (5xx/404/timeout) or an unclassifiable
// transport error. A bad request (4xx) or an oversize prompt is a property of the
// PROMPT, not the model — swapping models would not fix it, so we do not.
const FAILOVER_WORTHY: ReadonlySet<FailureKind> = new Set([
	'insufficient-credits',
	'rate-limit',
	'server-error',
	'timeout',
	'unavailable',
	'unknown'
])

// Rough chars->tokens so a candidate is never selected into a silent truncation;
// deliberately an over-estimate (chars/4 >= tokens for English-ish text).
function estimateMinContext(messages: ChatMessage[]): number {
	const chars = messages.reduce((sum, m) => sum + m.content.length, 0)
	return Math.ceil(chars / 4)
}

// Upper bound on the failover chain: the per-family §5.3 degradation rungs plus a
// couple of health-aware Model Pool candidates for cross-family depth. A longer
// tail only matters when several paid models fail in one turn, which the spend cap
// (Section 13) bounds anyway; 6 keeps failover honest without unbounded retries.
const MAX_CHAT_CHAIN = 6

// Jev's routed model leads, followed by its §5.3 per-family degradation chain
// (cheaper same-family siblings, then the cheapest reliable paid floor) built
// PURELY from the curated catalog — so the head of the chain needs no network
// fetch and is available even during a catalog outage. Behind that, the Model Pool
// selection policy appends health-aware candidates (circuit-open models skipped,
// measured reliability first) for cross-family depth. A catalog outage therefore
// degrades gracefully to "just the family chain" rather than erroring the turn.
async function resolveChatCandidates(model: ModelInfo, messages: ChatMessage[]): Promise<ChatCandidate[]> {
	const candidates: ChatCandidate[] = familyDegradationChain(model.slug, model.displayName).map(
		(link) => ({
			slug: link.slug,
			displayName: link.displayName,
			// Every curated catalog model is paid (NanoGPT has no free tier, D-44), so
			// a family rung is always the premium tier.
			tier: 'premium' as ModelTier,
			promptPricePer1M: link.promptPricePer1M,
			completionPricePer1M: link.completionPricePer1M
		})
	)
	const seen = new Set(candidates.map((c) => c.slug))

	try {
		const poolModels = await getModelRegistry().getModels()
		const chain = selectCandidates(poolModels, {
			needs: [],
			minContext: estimateMinContext(messages),
			quality: 'balanced',
			highStakes: false,
			preferredSlug: model.slug
		})
		for (const m of chain.candidates) {
			if (candidates.length >= MAX_CHAT_CHAIN) break
			if (seen.has(m.slug)) continue
			seen.add(m.slug)
			candidates.push({
				slug: m.slug,
				displayName: m.displayName,
				tier: m.tier,
				promptPricePer1M: m.promptPricePer1M,
				completionPricePer1M: m.completionPricePer1M
			})
		}
	} catch {
		// Registry/catalog outage: the family chain alone is a complete, costable
		// failover path — fall through to it.
	}
	return candidates
}

/**
 * Build the streaming SSE Response for a validated chat input.
 *
 * Emits, in order: `conversation` (once the user turn is persisted) -> `route`
 * (once Jev decides) -> `token`* -> `done`, or `error` if the answer stream
 * fails. Never rejects: an upstream failure is converted into a terminal
 * `error` event so the client always gets a clean end-of-stream.
 */
export function chatStreamResponse(input: ChatInput): Response {
	const requestStartedAt = performance.now()

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder()
			const send = (event: string, data: unknown) => {
				controller.enqueue(encoder.encode(encodeEvent(event, data)))
			}

			try {
				// Route on the newest user turn. Jev sees only that query, not the
				// whole transcript — routing is about the current intent.
				const lastUser = [...input.messages].reverse().find((m) => m.role === 'user')
				if (!lastUser) {
					const payload: ErrorEventPayload = { message: 'No user message to route.' }
					send('error', payload)
					controller.close()
					return
				}

				// Start routing immediately and persist the user turn alongside it,
				// so the Jev hop overlaps the database write instead of following it.
				const routePromise = routeQuery(lastUser.content)
				const conversationId = await persistUserTurn({
					conversationId: input.conversationId ?? null,
					messages: input.messages
				})
				if (conversationId != null) {
					const payload: ConversationEventPayload = { conversationId: conversationId.toString() }
					send('conversation', payload)
				}

				const route = await routePromise
				const model = getModel(route.label)

				const routePayload: RouteEventPayload = {
					label: route.label,
					displayName: model.displayName,
					shortName: model.shortName,
					color: model.color,
					confidence: route.confidence,
					probabilities: route.probabilities,
					jevLatencyMs: route.jevLatencyMs,
					fallback: route.fallback,
					fallbackReason: route.fallbackReason
				}
				send('route', routePayload)

				const messages: ChatMessage[] = [
					{ role: 'system', content: SYSTEM_PROMPT },
					...input.messages.map((m) => ({ role: m.role, content: m.content }))
				]

				// Time-to-first-token of the answer stream, measured from request
				// start; null if no token ever arrived.
				let ttftMs: number | null = null
				let answerText = ''
				let usage: StreamUsage | null = null

				// The chat gets the same credit-wall rescue the AgentOS agents get: the
				// routed flagship leads its §5.3 per-family degradation chain (cheaper
				// same-family sibling, then the cheapest reliable paid floor — NanoGPT has
				// no free tier) with health-aware pool candidates behind it, and a
				// 402/429/5xx BEFORE any token has streamed fails over to the next candidate
				// instead of failing the turn. Failover happens only at the stream boundary
				// — once a candidate emits a token we are committed to it, so a mid-stream
				// drop is reported honestly and never re-streamed as duplicated partial text.
				const candidates = await resolveChatCandidates(model, messages)
				let served: ChatCandidate = candidates[0] ?? {
					slug: model.slug,
					displayName: model.displayName,
					tier: 'premium',
					promptPricePer1M: model.promptPricePer1M,
					completionPricePer1M: model.completionPricePer1M
				}
				let degraded = false
				let lastError: ErrorEventPayload | null = null

				for (let i = 0; i < candidates.length; i++) {
					const candidate = candidates[i]
					if (!candidate) break

					// The head is Jev's routed model and keeps its historical ledger
					// identity. Any failover candidate is a runtime pool slug, recorded as
					// one under provider 'openai' so the cost-capturing extractor applies
					// (D-36). One ai_usage row per real HTTP attempt, failures included.
					const isHead = candidate.slug === model.slug
					const spec = isHead
						? { provider: PROVIDER[route.label], model: TRACKED_MODEL[route.label] as string }
						: { provider: 'openai' as const, model: candidate.slug }

					// trackAiCall times this attempt and records one ai_usage row from the
					// usage NanoGPT reports. The custom extractor reads the aggregated
					// stream result (the built-in extractors expect a non-streaming
					// provider response). A tracking failure is swallowed by the tracker
					// and can never break the answer. The callback's return value is what
					// trackAiCall resolves to, so the attempt outcome is read in
					// straight-line code below (TS cannot narrow closure-assigned vars).
					const attemptStartedAt = performance.now()
					const outcome = await trackAiCall(
						{
							provider: spec.provider,
							model: spec.model,
							feature: 'chat_completion',
							// Ids/enums/numbers only (docs/rules/analytics.md rule 5): no text.
							meta: {
								label: route.label,
								fallback: route.fallback,
								jev_latency_ms: route.jevLatencyMs,
								attempt: i
							},
							extract: (response) => {
								const r = response as { usage: StreamUsage | null; errored: boolean }
								return {
									status: r.errored ? 'error' : 'ok',
									tokens: {
										inputTokens: r.usage?.promptTokens ?? 0,
										outputTokens: r.usage?.completionTokens ?? 0,
										cacheWriteTokens: 0,
										cacheReadTokens: 0
									}
								}
							}
						},
						async () => {
							let attemptUsage: StreamUsage | null = null
							let attemptErrored = false
							let attemptEmitted = false
							let attemptError: { message: string; status?: number } | null = null
							for await (const event of streamCompletion(candidate.slug, messages)) {
								if (event.type === 'token') {
									if (ttftMs == null) ttftMs = Math.round(performance.now() - requestStartedAt)
									attemptEmitted = true
									answerText += event.text
									const payload: TokenEventPayload = { text: event.text }
									send('token', payload)
								} else if (event.type === 'usage') {
									attemptUsage = event.usage
								} else if (event.type === 'error') {
									attemptErrored = true
									attemptError = { message: event.message, status: event.status }
									break
								}
							}
							return {
								usage: attemptUsage,
								errored: attemptErrored,
								emitted: attemptEmitted,
								error: attemptError
							}
						}
					)

					// Only the SERVING attempt's usage feeds the done telemetry; a failed
					// attempt still reports its own (empty) usage to the ledger.
					if (!outcome.errored) usage = outcome.usage

					// Feed the registry's measured reliability so a model that 403s as
					// app-restricted (or 402s on the credit wall) is demoted below unprobed
					// models on the NEXT selection instead of leading the tail again.
					getModelRegistry().recordProbe(candidate.slug, {
						ok: !outcome.errored,
						latencyMs: Math.round(performance.now() - attemptStartedAt)
					})

					if (!outcome.errored) {
						served = candidate
						degraded = i > 0
						lastError = null
						break
					}
					lastError = { message: outcome.error?.message ?? 'Upstream stream failed.' }
					const kind = classifyFailure(outcome.error?.status ?? null, outcome.error?.message ?? '', {})
					if (outcome.emitted || !FAILOVER_WORTHY.has(kind)) break
				}

				if (lastError) {
					send('error', lastError)
					controller.close()
					return
				}

				const promptTokens = usage?.promptTokens ?? 0
				const completionTokens = usage?.completionTokens ?? 0
				const estimatedCost =
					(promptTokens * (served.promptPricePer1M ?? model.promptPricePer1M) +
						completionTokens * (served.completionPricePer1M ?? model.completionPricePer1M)) /
					1_000_000
				const totalLatencyMs = Math.round(performance.now() - requestStartedAt)

				// Persist the completed turn (best-effort) before the terminal event,
				// so a client that refreshes on `done` sees the saved transcript.
				if (conversationId != null) {
					await persistAssistantTurn({
						conversationId,
						content: answerText,
						route: {
							chosenModel: route.label,
							jevLatencyMs: route.jevLatencyMs,
							confidence: route.fallback ? null : route.confidence,
							// A fallback produced no real distribution (all zeros) — store
							// null rather than a synthetic flat line.
							probabilities: route.fallback ? null : route.probabilities,
							fallback: route.fallback,
							fallbackReason: route.fallbackReason ?? null,
							ttftMs,
							totalLatencyMs,
							promptTokens,
							completionTokens,
							costMicroUsd: toCostMicroUsd(estimatedCost)
						}
					})
				}

				const donePayload: DoneEventPayload = {
					// The model that ACTUALLY produced the answer. On a failover this is
					// the pool model, not Jev's routed label — the `route` event above keeps
					// the routing intent, this keeps the serving truth.
					model: { label: model.label, slug: served.slug, displayName: served.displayName },
					degraded,
					jevLatencyMs: route.jevLatencyMs,
					totalLatencyMs,
					usage: {
						promptTokens,
						completionTokens,
						totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
						// NanoGPT returns no monetary cost, so the authoritative-cost field
						// is null and estimatedCost (tokens × curated per-1M) is the figure
						// the UI shows. Never fabricate a provider cost.
						cost: null,
						estimatedCost: Number(estimatedCost.toFixed(8))
					}
				}
				send('done', donePayload)
				controller.close()
			} catch (error) {
				log.error('chat stream failed', { error })
				try {
					const payload: ErrorEventPayload = {
						message: error instanceof Error ? error.message : 'Unexpected server error.'
					}
					send('error', payload)
				} catch {
					// controller may already be closed/errored; nothing left to do
				}
				controller.close()
			}
		}
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			// Stop proxies from buffering the stream.
			'X-Accel-Buffering': 'no'
		}
	})
}
