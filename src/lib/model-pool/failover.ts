// Model Pool failover runner (M3) — PURE orchestration. Walks a CandidateChain
// (from select.ts) best-first, calling each model through an injected transport
// and failing over on classified failures. It never loops forever: per-model
// retries, total attempts, and wall-clock are all capped, and every paid attempt
// is gated by the injected Orchestra budget (structurally a BudgetGuard).
//
// Responsibilities (brief §3):
//  - Attempt chain: candidate 1 -> on failure candidate 2 -> ... (never one model).
//  - Classify each failure (classify.ts): rate-limit/server-error/timeout retry the
//    SAME model with backoff+jitter (honouring Retry-After) up to a bound; permanent
//    failures (unavailable / context-overflow / empty-output / unparseable /
//    bad-request) fail straight over; insufficient-credits (402) is a global stop
//    for the PREMIUM tier — remaining premium candidates are skipped so a $0 key
//    degrades to free instead of burning attempts on calls that will all 402.
//  - Circuit breaker: health.allow() gates each attempt; failures/successes are
//    recorded; an `opened` transition emits `model_unhealthy`.
//  - Free-tier rate limiter + concurrency limiter keep parallel agents inside the
//    documented 20 RPM / daily quota.
//  - Events: `model_failover` (from -> to, with reason) is emitted the moment the
//    runner actually reaches the next candidate, so the run view / replay (M6) show
//    every hop identically live and from the log.
//
// The clock, sleep, transport, health store, limiters and budget are ALL injected,
// so the whole loop is unit-tested with fakes at $0 (no network, no real time).

import { backoffDelayMs } from './backoff'
import { isSameModelRetryable } from './classify'
import type { HealthStore } from './circuit'
import {
	FREE_BUCKET,
	type ConcurrencyLimiter,
	type RateLimiter
} from './limiter'
import type {
	AttemptFailure,
	AttemptOutcome,
	CandidateChain,
	ModelFailoverEvent,
	ModelTier,
	ModelUnhealthyEvent,
	PoolModel
} from './types'

export type AttemptMeta = {
	// 1-based attempt index on the current model (retries increment this).
	attempt: number
	// 1-based attempt index across the whole chain.
	totalAttempt: number
	candidateIndex: number
	isRetry: boolean
}

// The transport: performs ONE real (or faked) completion against a model and
// reports the outcome. The server layer wraps this with trackAiCall +
// registry.recordProbe + the NanoGPT HTTP call; the runner stays transport-
// agnostic so it is testable with a stub.
export type CallModel = (model: PoolModel, meta: AttemptMeta) => Promise<AttemptOutcome>

// Structural budget interface — src/lib/orchestra's BudgetGuard satisfies it, so
// the executor can pass its guard straight in without the pool importing it.
export type FailoverBudget = {
	reserveModelCall(): { ok: boolean; reason?: string }
	addCost(costMicroUsd?: number | null): void
}

export type FailoverEvent = ModelFailoverEvent | ModelUnhealthyEvent

export type FailoverOptions = {
	chain: CandidateChain
	runId: string
	stepId: string
	callModel: CallModel
	now: () => number
	sleep: (ms: number) => Promise<void>
	health: HealthStore
	budget?: FailoverBudget
	rateLimiter?: RateLimiter
	concurrency?: ConcurrencyLimiter
	// Bounded SAME-model retries for transient failures. 2 = one try + one retry.
	maxAttemptsPerModel?: number
	// Hard cap across the whole chain. Defaults to candidates * maxAttemptsPerModel.
	maxTotalAttempts?: number
	// Wall-clock ceiling for this step's failover. Default: unbounded.
	maxWallClockMs?: number
	// Injected RNG for deterministic backoff jitter in tests.
	random?: () => number
	baseBackoffMs?: number
	capBackoffMs?: number
	onEvent?: (event: FailoverEvent) => void
}

export type FailoverStopReason =
	| 'no_candidates'
	| 'all_failed'
	| 'budget_stopped'
	| 'wall_clock'
	| 'max_attempts'
	| 'insufficient_credits'

export type FailoverSuccess = {
	ok: true
	slug: string
	tier: ModelTier
	content: string
	costMicroUsd: number
	latencyMs: number
	attempts: number
	candidateIndex: number
	// True when a non-head candidate served the step (a failover happened) — the
	// degradation ladder (M5) turns this + tier into an L0–L5 level.
	degraded: boolean
	decidedBy: CandidateChain['decidedBy']
	// The serving model's token counts when it reported them; null when absent.
	tokens: { input: number; output: number } | null
}

export type FailoverFailure = {
	ok: false
	reason: FailoverStopReason
	failures: AttemptFailure[]
	attempts: number
	budgetStopped: boolean
}

export type FailoverResult = FailoverSuccess | FailoverFailure

export async function runWithFailover(options: FailoverOptions): Promise<FailoverResult> {
	const {
		chain,
		runId,
		stepId,
		callModel,
		now,
		sleep,
		health,
		budget,
		rateLimiter,
		concurrency,
		onEvent
	} = options

	const maxPerModel = options.maxAttemptsPerModel ?? 2
	const maxWallClockMs = options.maxWallClockMs ?? Number.POSITIVE_INFINITY
	const maxTotal =
		options.maxTotalAttempts ?? Math.max(1, chain.candidates.length * maxPerModel)
	const baseBackoffMs = options.baseBackoffMs ?? 250
	const capBackoffMs = options.capBackoffMs ?? 8_000
	const random = options.random

	const startedAt = now()
	const failures: AttemptFailure[] = []
	let totalAttempt = 0
	// Set once a 402 is seen: skip remaining premium candidates (they will all 402).
	let creditWall = false
	// The slug + reason of the last failure, so a `model_failover` event can be
	// emitted the moment we actually reach the next candidate.
	let pendingHop: { fromSlug: string; reason: AttemptFailure['kind'] } | null = null

	function fail(reason: FailoverStopReason, budgetStopped = false): FailoverFailure {
		return { ok: false, reason, failures, attempts: totalAttempt, budgetStopped }
	}

	if (chain.candidates.length === 0) return fail('no_candidates')

	for (let ci = 0; ci < chain.candidates.length; ci++) {
		const model = chain.candidates[ci]
		if (!model) continue
		// Credit wall: a $0 key cannot serve any premium model; skip to free.
		if (creditWall && model.tier === 'premium') continue

		// A still-cooling open circuit is not attemptable — fail over past it.
		if (!health.allow(model.slug, now())) continue

		for (let attempt = 1; attempt <= maxPerModel; attempt++) {
			if (now() - startedAt >= maxWallClockMs) return fail('wall_clock')
			if (totalAttempt >= maxTotal) return fail('max_attempts')

			// Free-tier rate limiter (account-wide bucket). A refusal here is our own
			// politeness ceiling, recorded as a rate-limit failure and failed over.
			if (rateLimiter && model.tier === 'free') {
				const acq = rateLimiter.tryAcquire(FREE_BUCKET)
				if (!acq.ok) {
					const failure: AttemptFailure = {
						kind: 'rate-limit',
						slug: model.slug,
						status: 429,
						message:
							acq.reason === 'rpd'
								? 'free daily quota exhausted (limiter)'
								: 'free per-minute limit reached (limiter)',
						retryAfterMs: acq.retryAfterMs
					}
					failures.push(failure)
					health.recordFailure(model.slug, failure.kind, now())
					pendingHop = { fromSlug: model.slug, reason: failure.kind }
					break // move to the next candidate; do not burn attempts waiting
				}
			}

			// Budget gate BEFORE the paid call (structurally the Orchestra BudgetGuard).
			if (budget) {
				const verdict = budget.reserveModelCall()
				if (!verdict.ok) return fail('budget_stopped', true)
			}

			totalAttempt += 1
			const meta: AttemptMeta = {
				attempt,
				totalAttempt,
				candidateIndex: ci,
				isRetry: attempt > 1
			}

			// Emit the hop now that we have actually arrived at this candidate.
			if (pendingHop) {
				onEvent?.({
					type: 'model_failover',
					runId,
					stepId,
					fromSlug: pendingHop.fromSlug,
					toSlug: model.slug,
					reason: pendingHop.reason,
					attempt: totalAttempt,
					at: now()
				})
				pendingHop = null
			}

			const outcome: AttemptOutcome = concurrency
				? await concurrency.run(() => callModel(model, meta))
				: await callModel(model, meta)

			if (outcome.ok) {
				health.recordSuccess(model.slug, now())
				const cost = outcome.costMicroUsd ?? 0
				budget?.addCost(cost)
				return {
					ok: true,
					slug: model.slug,
					tier: model.tier,
					content: outcome.content,
					costMicroUsd: cost,
					latencyMs: outcome.latencyMs,
					attempts: totalAttempt,
					candidateIndex: ci,
					degraded: ci > 0,
					decidedBy: chain.decidedBy,
					tokens: outcome.tokens ?? null
				}
			}

			// ---- failure path ----
			const failure = outcome.failure
			failures.push(failure)
			const { opened } = health.recordFailure(failure.slug, failure.kind, now())
			if (opened) {
				const h = health.get(failure.slug)
				onEvent?.({
					type: 'model_unhealthy',
					runId,
					slug: failure.slug,
					circuit: h.circuit,
					consecutiveFailures: h.consecutiveFailures,
					at: now()
				})
			}

			if (failure.kind === 'insufficient-credits') {
				creditWall = true
				pendingHop = { fromSlug: failure.slug, reason: failure.kind }
				break // skip to the next (possibly free) candidate
			}

			// Bounded SAME-model retry for transient failures, with backoff+jitter
			// honouring Retry-After. Otherwise fail over to the next candidate.
			const retryable = isSameModelRetryable(failure.kind)
			if (retryable && attempt < maxPerModel && now() - startedAt < maxWallClockMs) {
				const delay = backoffDelayMs(attempt - 1, {
					baseMs: baseBackoffMs,
					capMs: capBackoffMs,
					retryAfterMs: failure.retryAfterMs,
					random
				})
				await sleep(delay)
				continue
			}

			pendingHop = { fromSlug: failure.slug, reason: failure.kind }
			break
		}
	}

	// Exhausted the chain without a success.
	const onlyCreditFailures =
		failures.length > 0 && failures.every((f) => f.kind === 'insufficient-credits')
	return fail(onlyCreditFailures ? 'insufficient_credits' : 'all_failed')
}
