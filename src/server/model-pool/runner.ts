import 'server-only'
import { createHealthStore, type HealthStore } from '@/lib/model-pool/circuit'
import {
	createConcurrencyLimiter,
	createRateLimiter,
	FREE_RPM,
	FREE_RPD_UNFUNDED,
	type ConcurrencyLimiter,
	type RateLimiter
} from '@/lib/model-pool/limiter'
import { selectCandidates } from '@/lib/model-pool/select'
import { runWithFailover, type FailoverBudget, type FailoverEvent, type FailoverStopReason } from '@/lib/model-pool/failover'
import type {
	CapabilityRequest,
	CapabilityTag,
	ModelTier,
	QualityTier
} from '@/lib/model-pool/types'
import type { PoolMessage } from '@/lib/model-pool/transport'
import { getModelRegistry } from './registry'
import { createServerPoolTransport } from './transport'

// The ONE server-side entry point that turns "a step needs a completion" into a
// failover-driven pool call. Every NanoGPT-calling agent (generating / critic /
// code) goes through here instead of calling completeOnce directly, so a premium
// 402 (the credit wall) degrades to a cheaper paid sibling rather than
// failing the step — the behaviour the Model Pool brief exists for.
//
// Process-wide singletons (health, rate limiter, concurrency) are shared by all
// agents in the process so the circuit breaker sees every attempt and the
// account-wide free-tier quotas (20 RPM / 50 RPD unfunded — legacy OpenRouter-era
// caps, inert under NanoGPT which has no free tier) are enforced globally, not per step.
//
// The Decision Bus is deliberately NOT routed through here: its pure core already
// policy-fallbacks (and flags `decided_by: policy`) on any Jev error/timeout, so a
// Jev 402 degrades verification instead of wedging the run. The researcher makes no
// NanoGPT call at all (its spend is the sonar MCP tool), so it needs no swap.

let healthStore: HealthStore | null = null
let rateLimiter: RateLimiter | null = null
let concurrencyLimiter: ConcurrencyLimiter | null = null

export function getPoolHealthStore(): HealthStore {
	if (!healthStore) {
		healthStore = createHealthStore({ now: () => Date.now() })
	}
	return healthStore
}

export function getPoolRateLimiter(): RateLimiter {
	if (!rateLimiter) {
		// Conservative (unfunded) free-tier quotas. A funded key raises the daily
		// quota to 1000, but capping at 50/day is always safe and never overspends.
		rateLimiter = createRateLimiter({
			now: () => Date.now(),
			limits: { requestsPerMinute: FREE_RPM, requestsPerDay: FREE_RPD_UNFUNDED }
		})
	}
	return rateLimiter
}

export function getPoolConcurrencyLimiter(): ConcurrencyLimiter {
	if (!concurrencyLimiter) {
		// A handful of parallel agents; keeps a fan-out from stampeding the free RPM
		// window. The rate limiter still enforces its legacy OpenRouter-era cap on top
		// (currently inert — NanoGPT has no free tier).
		concurrencyLimiter = createConcurrencyLimiter(3)
	}
	return concurrencyLimiter
}

export type PoolCallOptions = {
	messages: PoolMessage[]
	// The ai_usage `feature` axis.
	feature: string
	// The slug Jev/the Decision Bus routed this step to; becomes the chain head when
	// eligible (recorded `decidedBy:'jev'`), else pool policy leads.
	preferredSlug: string | null
	runId: string
	// Identifies the step in failover events; the agent name is a stable stand-in.
	stepId: string
	maxTokens?: number
	// High-stakes steps (final synthesis, verification) lead with premium and never
	// let free LEAD — but free remains the failover tail, which is what rescues a
	// $0-key run.
	highStakes?: boolean
	quality?: QualityTier
	needs?: CapabilityTag[]
	// The Orchestra BudgetGuard; gates every paid attempt and accumulates real cost.
	budget?: FailoverBudget
	// Wall-clock ceiling for this step's whole failover (ms).
	maxWallClockMs?: number
	// Forwards the pool's failover/circuit events (model_failover, model_unhealthy)
	// so the calling agent can re-emit them onto the Orchestra bus — the run view
	// and replay then show a mid-step failover identically live and from the log
	// (MP-M6). Optional: a step that doesn't care about surfacing failovers omits it.
	onEvent?: (event: FailoverEvent) => void
}

export type PoolCallOutcome =
	| {
			ok: true
			content: string
			slug: string
			tier: ModelTier
			costMicroUsd: number
			latencyMs: number
			attempts: number
			// True when a non-head candidate served it (a failover happened).
			degraded: boolean
			decidedBy: 'jev' | 'pool-policy'
			tokens: { input: number; output: number } | null
	  }
	| { ok: false; reason: FailoverStopReason; message: string }

// Rough chars->tokens so a candidate is never selected into a silent truncation.
// Deliberately an over-estimate of the true token count (chars/4 >= tokens for
// English-ish text), so `fitsContext` errs toward larger-context models.
function estimateMinContext(messages: PoolMessage[]): number {
	const chars = messages.reduce((sum, m) => sum + m.content.length, 0)
	return Math.ceil(chars / 4)
}

export async function runPoolStep(options: PoolCallOptions): Promise<PoolCallOutcome> {
	const registry = getModelRegistry()
	const models = await registry.getModels()

	const request: CapabilityRequest = {
		needs: options.needs ?? [],
		minContext: estimateMinContext(options.messages),
		quality: options.quality ?? 'balanced',
		highStakes: options.highStakes ?? false,
		preferredSlug: options.preferredSlug
	}

	const chain = selectCandidates(models, request)
	if (chain.candidates.length === 0) {
		return { ok: false, reason: 'no_candidates', message: chain.rationale }
	}

	const callModel = createServerPoolTransport({
		messages: options.messages,
		feature: options.feature,
		maxTokens: options.maxTokens
	})

	const result = await runWithFailover({
		chain,
		runId: options.runId,
		stepId: options.stepId,
		callModel,
		now: () => Date.now(),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		health: getPoolHealthStore(),
		budget: options.budget,
		rateLimiter: getPoolRateLimiter(),
		concurrency: getPoolConcurrencyLimiter(),
		maxWallClockMs: options.maxWallClockMs,
		onEvent: options.onEvent
	})

	if (!result.ok) {
		return {
			ok: false,
			reason: result.reason,
			message: `pool failover exhausted (${result.reason}) after ${result.attempts} attempt(s)`
		}
	}
	return {
		ok: true,
		content: result.content,
		slug: result.slug,
		tier: result.tier,
		costMicroUsd: result.costMicroUsd,
		latencyMs: result.latencyMs,
		attempts: result.attempts,
		degraded: result.degraded,
		decidedBy: result.decidedBy,
		tokens: result.tokens
	}
}
