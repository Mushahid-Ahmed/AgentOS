// Model Pool transport (server-integration seam) — PURE. Adapts one candidate
// model attempt into the `CallModel` contract the failover runner (failover.ts)
// drives: `(model, meta) => Promise<AttemptOutcome>`. This is the piece decision
// D-36 unblocked — a runtime-discovered slug is now a legal ledger subject, so the
// pool can actually call it and record the spend.
//
// Everything side-effectful is injected: `complete` performs the real HTTP
// completion (the server wrapper wraps it in trackAiCall so the row lands in
// ai_usage, priced from tokens × the curated per-1M catalog — NanoGPT reports no
// cost field), `recordProbe` folds the
// attempt into the registry's measurements, and `now` is the clock. So the whole
// attempt path — privacy guard, empty-output trap, error classification, probe
// recording — is unit-tested with fakes at $0, exactly like failover.ts.
//
// Responsibilities:
//  - Privacy guard (brief §PRIVACY): secret-shaped content NEVER goes to a free
//    model. A free candidate asked to carry a secret is refused WITHOUT calling it
//    (a permanent `bad-request` failure, so the runner fails over — ideally to a
//    premium candidate), and the refusal is not recorded against the model's health
//    because it is our policy, not the model's fault.
//  - The free-model trap (Phase 0): a 200 with blank content is NOT success. It is
//    classified `empty-output` and failed over.
//  - Real cost: derived from NanoGPT token usage × the curated per-1M USD prices
//    (NanoGPT's usage carries no cost field) and converted to integer micro-USD so
//    the failover budget and the ledger agree.
//  - Errors are classified via classify.ts so backoff-vs-cooldown-vs-failover and
//    the circuit breaker stay honest.

import { classifyFailure } from './classify'
import { guardForTier } from './privacy'
import type { CallModel } from './failover'
import type { AttemptFailure, AttemptOutcome, PoolModel } from './types'

// A chat message. Mirrors the OpenAI wire shape NanoGPT speaks; kept local so
// this module stays pure (the server wrapper casts to/from ChatMessage).
export type PoolMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// The normalized result of one completion, whatever the provider wire shape. The
// server wrapper maps NanoGPT's response into this; the pure transport never
// sees the raw HTTP body.
export type PoolCompletion = {
	// null or blank => the empty-output trap.
	content: string | null
	// Cost in USD derived from NanoGPT token usage × the curated per-1M catalog
	// (NanoGPT reports no cost field), or null when it couldn't be priced.
	costUsd: number | null
	// e.g. 'stop', 'content_filter'. Informational; blank content is what fails.
	finishReason: string | null
	// The provider's token counts when reported; null/absent when not (never guessed).
	promptTokens?: number | null
	completionTokens?: number | null
}

// Thrown by the injected `complete` on a failed call. Carries the HTTP status (null
// for a transport-level failure) and whether it timed out, so classifyFailure can
// be precise. The server wrapper maps NanoGPTError onto this.
export class PoolCallError extends Error {
	readonly status: number | null
	readonly timedOut: boolean
	// Retry-After in ms when the provider sent one (rate-limit backoff); else null.
	readonly retryAfterMs: number | null
	constructor(
		status: number | null,
		message: string,
		options: { timedOut?: boolean; retryAfterMs?: number | null } = {}
	) {
		super(message)
		this.name = 'PoolCallError'
		this.status = status
		this.timedOut = options.timedOut ?? false
		this.retryAfterMs = options.retryAfterMs ?? null
	}
}

export type PoolTransportDeps = {
	// The step's prompt, fixed across every candidate in the chain.
	messages: PoolMessage[]
	// Performs ONE completion against a slug. Resolves with a PoolCompletion or
	// throws PoolCallError. The server wrapper wraps this in trackAiCall.
	complete: (slug: string, messages: PoolMessage[]) => Promise<PoolCompletion>
	// Folds one attempt into the registry's measured latency / success rate / tags.
	recordProbe: (slug: string, result: { ok: boolean; latencyMs: number }) => void
	now: () => number
}

const MICRO_USD_PER_USD = 1_000_000

function toMicroUsd(costUsd: number | null): number {
	return typeof costUsd === 'number' && Number.isFinite(costUsd)
		? Math.round(costUsd * MICRO_USD_PER_USD)
		: 0
}

function promptText(messages: PoolMessage[]): string {
	return messages.map((m) => m.content).join('\n')
}

function failure(
	kind: AttemptFailure['kind'],
	slug: string,
	status: number | null,
	message: string,
	retryAfterMs: number | null
): AttemptOutcome {
	return { ok: false, failure: { kind, slug, status, message, retryAfterMs } }
}

/**
 * Build the `CallModel` transport for one step's failover chain.
 *
 * The returned function is what runWithFailover invokes per candidate. It guards
 * secrets, calls the model, records the probe, classifies any failure, and returns
 * an honest AttemptOutcome (never throws — a throw would escape the runner's
 * per-attempt handling).
 */
export function createPoolTransport(deps: PoolTransportDeps): CallModel {
	const { messages, complete, recordProbe, now } = deps
	const prompt = promptText(messages)

	// `meta` (the runner's attempt/total counters) is intentionally not taken —
	// the transport performs one attempt and never retries or backs off itself
	// (failover.ts owns that), so it has no use for the counters.
	const callModel: CallModel = async (model: PoolModel) => {
		// Privacy guard BEFORE any call. A free model must never receive
		// secret-shaped content; refuse it (permanently) so the runner fails over.
		const guard = guardForTier(prompt, model.tier)
		if (!guard.allowed) {
			return failure('bad-request', model.slug, null, guard.reason, null)
		}

		const startedAt = now()
		let completion: PoolCompletion
		try {
			completion = await complete(model.slug, messages)
		} catch (error) {
			const latencyMs = now() - startedAt
			recordProbe(model.slug, { ok: false, latencyMs })
			if (error instanceof PoolCallError) {
				const kind = classifyFailure(error.status, error.message, {
					timedOut: error.timedOut
				})
				return failure(kind, model.slug, error.status, error.message, error.retryAfterMs)
			}
			const message = error instanceof Error ? error.message : String(error)
			return failure(classifyFailure(null, message), model.slug, null, message, null)
		}

		const latencyMs = now() - startedAt
		const content = completion.content
		// The free-model trap: a 200 with blank content is not a usable answer.
		if (content == null || content.trim() === '') {
			recordProbe(model.slug, { ok: false, latencyMs })
			return failure(
				'empty-output',
				model.slug,
				null,
				'model returned a 200 with empty content',
				null
			)
		}

		recordProbe(model.slug, { ok: true, latencyMs })
		const promptTokens = completion.promptTokens
		const completionTokens = completion.completionTokens
		const tokens =
			typeof promptTokens === 'number' &&
			Number.isFinite(promptTokens) &&
			typeof completionTokens === 'number' &&
			Number.isFinite(completionTokens)
				? { input: promptTokens, output: completionTokens }
				: undefined
		return {
			ok: true,
			slug: model.slug,
			content,
			costMicroUsd: toMicroUsd(completion.costUsd),
			latencyMs,
			tokens
		}
	}

	return callModel
}
