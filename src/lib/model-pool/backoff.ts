// Model Pool backoff (M3) — PURE. Exponential backoff with full jitter, capped,
// and always honouring a provider's Retry-After when one was sent (a rate-limit
// response that says "retry in 30s" must not be retried in 200ms). The sleep
// itself is injected by the caller; this only computes the delay so it is
// unit-testable without real time.

export type BackoffOptions = {
	// Base delay for attempt 0. Default 250ms.
	baseMs?: number
	// Hard ceiling on a computed delay. Default 8000ms.
	capMs?: number
	// Multiplier per attempt. Default 2 (exponential).
	factor?: number
	// A provider-supplied Retry-After. When present it is a FLOOR: we never retry
	// sooner than the provider asked, but we also never exceed capMs by more than
	// the retryAfter itself (an explicit server instruction wins over our cap).
	retryAfterMs?: number | null
	// Injected RNG in [0,1) for deterministic tests. Default Math.random.
	random?: () => number
}

// Exponential-with-full-jitter delay for a 0-based attempt index.
//   raw   = baseMs * factor^attempt        (capped at capMs)
//   jitter= random() * raw                 (full jitter -> [0, raw])
// A retryAfterMs, when provided, is the floor of the result.
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
	const baseMs = options.baseMs ?? 250
	const capMs = options.capMs ?? 8_000
	const factor = options.factor ?? 2
	const random = options.random ?? Math.random
	const retryAfterMs = options.retryAfterMs ?? null

	const safeAttempt = Math.max(0, Math.floor(attempt))
	const raw = Math.min(capMs, baseMs * Math.pow(factor, safeAttempt))
	const jittered = Math.floor(random() * raw)
	const delay = retryAfterMs !== null ? Math.max(jittered, retryAfterMs) : jittered
	return Math.max(0, delay)
}

// Parse an HTTP Retry-After header value into ms. Supports both the
// delta-seconds form ("30") and, defensively, an unknown/garbage value (null).
// The HTTP-date form is rare from NanoGPT; we treat an unparsable value as
// null and fall back to computed backoff rather than guessing.
export function parseRetryAfterMs(headerValue: string | null | undefined): number | null {
	if (!headerValue) return null
	const trimmed = headerValue.trim()
	if (trimmed === '') return null
	// delta-seconds
	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed)
		return Number.isFinite(seconds) ? seconds * 1000 : null
	}
	// HTTP-date
	const dateMs = Date.parse(trimmed)
	if (Number.isFinite(dateMs)) {
		const delta = dateMs - Date.now()
		return delta > 0 ? delta : 0
	}
	return null
}
