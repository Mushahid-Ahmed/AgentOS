// Model Pool failure classification (M3) — PURE. Maps an HTTP status / provider
// error into a FailureKind so the failover loop can decide backoff-vs-cooldown-vs-
// retry and which event to emit. The classification is deliberately conservative:
// an unknown shape is `unknown` (retryable up to the cap), never silently dropped.
//
// Grounded in Phase 0 evidence: 402 = insufficient credits (the $0-key wall),
// 400 "Provider returned error" = a provider-side bad-request (sonar), 200-with-
// empty-content = the free-model reasoning trap (classified by the caller as
// `empty-output`, not here, since it is a body inspection not a status).

import type { FailureKind } from './types'

// Classify by HTTP status. `status` is null for a transport-level failure
// (timeout, network throw) which the caller tags explicitly.
export function classifyStatus(status: number | null): FailureKind {
	if (status === null) return 'unknown'
	if (status === 429) return 'rate-limit'
	if (status === 402) return 'insufficient-credits'
	if (status === 404) return 'unavailable'
	// NanoGPT 403 = this caller/app may not use THIS model (e.g. "only available
	// on agentic harnesses"). It is a property of the model↔caller pairing, not of
	// the prompt, so another model may still serve — treat as unavailable so the
	// failover ladder walks on and the breaker remembers this model is closed to us.
	if (status === 403) return 'unavailable'
	if (status === 408) return 'timeout'
	if (status >= 500 && status <= 599) return 'server-error'
	if (status >= 400 && status < 500) return 'bad-request'
	return 'unknown'
}

// Refine a classification using the provider's error message. A 400 can be a
// context overflow ("maximum context length", "too many tokens") or a data-policy
// exclusion ("No endpoints found matching your data policy") — both are more
// specific than a generic bad-request and change the failover behaviour.
export function classifyFailure(
	status: number | null,
	message: string,
	options: { timedOut?: boolean } = {}
): FailureKind {
	if (options.timedOut) return 'timeout'
	const msg = message.toLowerCase()
	// Context overflow can surface as 400 or a provider error string.
	if (
		msg.includes('maximum context') ||
		msg.includes('context length') ||
		msg.includes('too many tokens') ||
		msg.includes('reduce the length')
	) {
		return 'context-overflow'
	}
	// Data-policy exclusion (free models when training opt-out is on) -> treat as
	// unavailable so the chain fails over to a model the account can route to.
	if (msg.includes('data policy') || msg.includes('no endpoints found')) {
		return 'unavailable'
	}
	const base = classifyStatus(status)
	// A 400 whose body says "provider returned error" is a provider-side fault,
	// which behaves like a transient server error (fail over), not a client bug.
	if (base === 'bad-request' && msg.includes('provider returned error')) {
		return 'server-error'
	}
	return base
}

// Whether a failure kind should trigger a bounded retry of the SAME model before
// failing over. Rate-limit and server-error retry (with backoff); permanent
// failures (unavailable, insufficient-credits, bad-request, context-overflow) do
// not retry the same model — they fail over or stop immediately.
export function isSameModelRetryable(kind: FailureKind): boolean {
	return kind === 'rate-limit' || kind === 'server-error' || kind === 'timeout' || kind === 'unknown'
}

// Whether a failure kind should OPEN the circuit breaker (mark the model
// unhealthy for a cooldown) rather than just fail this one attempt.
//  - unavailable / insufficient-credits: the model cannot serve right now -> open.
//  - rate-limit: a soft open (cooldown) so we stop hammering a limited model.
//  - server-error / timeout: open only after repeated failures (the breaker's own
//    consecutive-failure threshold handles that), so a single 5xx does not open it.
export function opensCircuitImmediately(kind: FailureKind): boolean {
	return kind === 'unavailable' || kind === 'insufficient-credits'
}

// Whether the whole run should stop trying paid models (a credit wall is not
// per-model — every premium call will 402). The caller degrades to free-only
// rather than burning attempts. Insufficient-credits is the only such signal.
export function isGlobalStopSignal(kind: FailureKind): boolean {
	return kind === 'insufficient-credits'
}
