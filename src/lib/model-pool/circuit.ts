// Model Pool circuit breaker (M3) — PURE. Per-model health state machine so a
// model that is rate-limited, removed, or repeatedly failing stops being hammered
// and the chain fails over instead. Health lives on the PoolModel (the registry
// owns the cache); these are the transition rules plus a small in-memory store the
// failover loop (failover.ts) drives. Persistence of key stats to Supabase is an
// injected `onStateChange` hook — this module never touches the DB or the clock
// except through what it is given.
//
// States (brief §3):
//   closed     -> serving; failures accumulate toward the threshold.
//   open       -> refusing; a cooldown must elapse before any probe.
//   half-open  -> cooldown elapsed; ONE probe is allowed. Success -> closed,
//                 failure -> open again (fresh cooldown).
//
// Two ways a circuit opens:
//   immediately  — `unavailable` (404 / data-policy) and `insufficient-credits`
//                  (402): the model cannot serve right now, so one failure is
//                  enough (see classify.opensCircuitImmediately).
//   by threshold — rate-limit / server-error / timeout / empty-output / etc. open
//                  only after `failureThreshold` consecutive failures, so a single
//                  transient 5xx does not bench a good model.

import { opensCircuitImmediately } from './classify'
import { freshHealth } from './registry'
import type { CircuitState, FailureKind, ModelHealth } from './types'

export const DEFAULT_FAILURE_THRESHOLD = 3
export const DEFAULT_COOLDOWN_MS = 60_000

export type CircuitOptions = {
	// Consecutive failures before a threshold-kind failure opens the circuit.
	failureThreshold?: number
	// How long an open circuit refuses requests before allowing a half-open probe.
	cooldownMs?: number
}

// The circuit's effective state at `now`. An open circuit whose cooldown has
// elapsed reports `half-open` (a probe is allowed). Pure — does not mutate; call
// onSuccess/onFailure (or the store) to persist a transition.
export function stateAt(health: ModelHealth, now: number): CircuitState {
	if (health.circuit !== 'open') return health.circuit
	if (health.openedAt === null) return 'closed'
	return now - health.openedAt >= health.cooldownMs ? 'half-open' : 'open'
}

// May a request be attempted against this model right now? Closed and half-open
// (cooldown elapsed) allow it; a still-cooling open circuit does not.
export function allowRequest(health: ModelHealth, now: number): boolean {
	return stateAt(health, now) !== 'open'
}

// A successful attempt closes the circuit and clears the failure streak.
export function onSuccess(health: ModelHealth, now: number): ModelHealth {
	return {
		...health,
		circuit: 'closed',
		consecutiveFailures: 0,
		openedAt: null,
		lastSuccessAt: now,
		lastFailureAt: health.lastFailureAt
	}
}

// A failed attempt. Immediate-open kinds bench the model at once; threshold kinds
// bench it only once the consecutive-failure streak reaches the threshold. When a
// half-open probe fails, the circuit re-opens with a fresh cooldown.
export function onFailure(
	health: ModelHealth,
	kind: FailureKind,
	now: number,
	options: CircuitOptions = {}
): ModelHealth {
	const threshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD
	const cooldownMs = options.cooldownMs ?? health.cooldownMs
	const consecutiveFailures = health.consecutiveFailures + 1
	// A half-open probe that fails means the model is still not healthy: re-open
	// with a fresh cooldown regardless of the streak, so we stop probing a model
	// that keeps failing.
	const wasHalfOpen = stateAt(health, now) === 'half-open'
	const shouldOpen =
		opensCircuitImmediately(kind) || wasHalfOpen || consecutiveFailures >= threshold

	if (shouldOpen) {
		return {
			...health,
			circuit: 'open',
			consecutiveFailures,
			openedAt: now,
			cooldownMs,
			lastFailureAt: now,
			lastSuccessAt: health.lastSuccessAt
		}
	}
	return {
		...health,
		consecutiveFailures,
		lastFailureAt: now,
		lastSuccessAt: health.lastSuccessAt
	}
}

// ---- In-memory health store ------------------------------------------------

export type FailureRecord = { health: ModelHealth; opened: boolean }

// The failover loop's view of per-model health. Keyed by slug so it can also back
// models the registry has not cached yet (defensive: an unknown slug starts
// fresh/closed). `onStateChange` is the seam for Supabase persistence — fired on
// every transition with the new health; this module stays DB-free.
export type HealthStore = {
	get(slug: string): ModelHealth
	allow(slug: string, now: number): boolean
	recordSuccess(slug: string, now: number): ModelHealth
	recordFailure(slug: string, kind: FailureKind, now: number): FailureRecord
	// All tracked health, for the dashboard health panel (M6).
	snapshot(): Record<string, ModelHealth>
}

export type HealthStoreOptions = CircuitOptions & {
	now: () => number
	onStateChange?: (slug: string, health: ModelHealth) => void
	// Seed known health (e.g. rehydrated from Supabase at boot).
	seed?: Record<string, ModelHealth>
}

export function createHealthStore(options: HealthStoreOptions): HealthStore {
	const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD
	const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
	const map = new Map<string, ModelHealth>(Object.entries(options.seed ?? {}))

	function current(slug: string): ModelHealth {
		const existing = map.get(slug)
		return existing ?? freshHealth(cooldownMs)
	}

	function set(slug: string, health: ModelHealth): void {
		map.set(slug, health)
		options.onStateChange?.(slug, health)
	}

	return {
		get: current,
		allow(slug, now) {
			// Reflect a cooldown that elapsed since the last write (open -> half-open)
			// without mutating: allowRequest computes the effective state.
			return allowRequest(current(slug), now)
		},
		recordSuccess(slug, now) {
			const next = onSuccess(current(slug), now)
			set(slug, next)
			return next
		},
		recordFailure(slug, kind, now) {
			const prev = current(slug)
			const next = onFailure(prev, kind, now, { failureThreshold, cooldownMs })
			set(slug, next)
			// "opened" = this failure transitioned the circuit INTO a refusing open
			// state (closed -> open, or a half-open probe that failed and re-opened).
			// An already-cooling open circuit that fails again is not a new open.
			const opened = next.circuit === 'open' && stateAt(prev, now) !== 'open'
			return { health: next, opened }
		},
		snapshot() {
			const out: Record<string, ModelHealth> = {}
			for (const [slug, health] of map) out[slug] = health
			return out
		}
	}
}
