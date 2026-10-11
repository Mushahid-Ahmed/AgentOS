// Model Pool limiters (M3) — PURE. Two independent guards so parallel agents never
// stampede provider rate limits and never exceed the documented quotas.
// The clock and the "is the account funded" signal are injected, so both are
// unit-testable without real time or a real key.
//
// LEGACY: the free-tier limits below are from the OpenRouter era (Phase 0, from the
// old OpenRouter docs — NOT invented). NanoGPT has NO free tier, so the free bucket
// is currently inert; the constants are kept (not removed) in case a future
// provider ships a real free tier:
//   - 20 requests/minute for `:free` models (account-wide, not per-model).
//   - 50 requests/day while the key has $0 credits; 1000/day once funded (>=10cr).
// These were ACCOUNT-WIDE across all free models, so the rate limiter is keyed by a
// shared bucket (`FREE_BUCKET`) rather than per slug. The premium tier has no
// platform rate cap (only the account's credit balance), so it is not limited here
// — spend is bounded separately by the Orchestra BudgetGuard.

// ---- Rate limiter (sliding-window RPM + daily quota) -----------------------

export const FREE_RPM = 20
export const FREE_RPD_UNFUNDED = 50
export const FREE_RPD_FUNDED = 1000
export const RPM_WINDOW_MS = 60_000

// The shared bucket key for all free-tier traffic (the limits are account-wide).
export const FREE_BUCKET = 'free'

export type RateLimits = {
	requestsPerMinute: number
	requestsPerDay: number
}

export type AcquireResult =
	| { ok: true }
	| { ok: false; reason: 'rpm' | 'rpd'; retryAfterMs: number | null }

export type RateLimiterOptions = {
	now: () => number
	windowMs?: number
	// Limits may be dynamic: a funded account gets a higher daily quota. Pass a
	// snapshot or a resolver; it is read on every acquire.
	limits: RateLimits | (() => RateLimits)
	// Derive the day bucket from the clock. Defaults to the UTC calendar day so a
	// daily counter rolls over at midnight UTC (matched how the OpenRouter-era
	// "per day" free quota was framed). Injected for deterministic tests.
	dayKey?: (now: number) => string
}

export type RateLimiter = {
	// Try to consume one request against `key`'s RPM window and daily quota.
	// On success the request is counted; on refusal nothing is counted and the
	// caller gets a reason + a best-effort retryAfterMs (time until the oldest
	// in-window request ages out, for the RPM case).
	tryAcquire(key: string): AcquireResult
	// Current usage for the dashboard's free-limit counters (M6). No side effects.
	peek(key: string): { rpm: number; rpd: number; limits: RateLimits }
	reset(): void
}

export function defaultDayKey(now: number): string {
	return new Date(now).toISOString().slice(0, 10)
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
	const windowMs = options.windowMs ?? RPM_WINDOW_MS
	const dayKey = options.dayKey ?? defaultDayKey
	// Capture in a local const so the narrowing survives inside the closure (TS
	// re-widens a property access in a deferred arrow otherwise).
	const limitsInput = options.limits
	const resolveLimits: () => RateLimits =
		typeof limitsInput === 'function' ? limitsInput : () => limitsInput

	// Per-key sliding window of request timestamps (ms) within `windowMs`.
	const windows = new Map<string, number[]>()
	// Per-key, per-day request counts. Keyed `${bucket}\u0000${day}` so a new UTC
	// day starts a fresh counter without an explicit rollover job.
	const daily = new Map<string, number>()

	function prune(slug: string, now: number): number[] {
		const arr = windows.get(slug) ?? []
		const cutoff = now - windowMs
		const kept = arr.filter((t) => t > cutoff)
		windows.set(slug, kept)
		return kept
	}

	return {
		tryAcquire(key) {
			const now = options.now()
			const limits = resolveLimits()
			const day = dayKey(now)

			// Daily quota first: it is the harder wall (a 429-style refusal that no
			// amount of short backoff fixes until the UTC day rolls over).
			const dayBucket = `${key}\u0000${day}`
			const usedToday = daily.get(dayBucket) ?? 0
			if (usedToday >= limits.requestsPerDay) {
				return { ok: false, reason: 'rpd', retryAfterMs: null }
			}

			// Sliding-window RPM.
			const inWindow = prune(key, now)
			if (inWindow.length >= limits.requestsPerMinute) {
				const oldest = inWindow[0]
				const retryAfterMs = oldest !== undefined ? Math.max(0, oldest + windowMs - now) : null
				return { ok: false, reason: 'rpm', retryAfterMs }
			}

			// Count the request in both buckets.
			inWindow.push(now)
			windows.set(key, inWindow)
			daily.set(dayBucket, usedToday + 1)
			return { ok: true }
		},
		peek(key) {
			const now = options.now()
			const limits = resolveLimits()
			const day = dayKey(now)
			return {
				rpm: prune(key, now).length,
				rpd: daily.get(`${key}\u0000${day}`) ?? 0,
				limits
			}
		},
		reset() {
			windows.clear()
			daily.clear()
		}
	}
}

// ---- Concurrency limiter (bounded in-flight + FIFO queue) ------------------

export type ConcurrencyLimiter = {
	// Run `fn` once a slot is free. Resolves/rejects with fn's outcome. Slots are
	// released in a finally, so a throwing fn never leaks a slot.
	run<T>(fn: () => Promise<T>): Promise<T>
	readonly active: number
	readonly queued: number
	readonly max: number
}

// A counting semaphore with a FIFO wait queue. Caps how many model calls are in
// flight at once across all parallel agents, so a fan-out of research/critique
// steps cannot simultaneously exhaust the free-tier RPM window. The rate limiter
// enforces the legacy OpenRouter-era caps; this enforces our own politeness ceiling.
export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
	const max = Math.max(1, Math.floor(maxConcurrent))
	let active = 0
	// FIFO of slot-release waiters. Each entry resolves when a slot frees up.
	const waiters: Array<() => void> = []

	function acquire(): Promise<void> {
		if (active < max) {
			active += 1
			return Promise.resolve()
		}
		return new Promise<void>((resolve) => {
			waiters.push(resolve)
		})
	}

	function release(): void {
		const next = waiters.shift()
		if (next) {
			// Hand the slot directly to the next waiter; `active` stays the same.
			next()
			return
		}
		active = Math.max(0, active - 1)
	}

	return {
		async run<T>(fn: () => Promise<T>): Promise<T> {
			await acquire()
			try {
				return await fn()
			} finally {
				release()
			}
		},
		get active() {
			return active
		},
		get queued() {
			return waiters.length
		},
		get max() {
			return max
		}
	}
}
