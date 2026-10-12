import 'server-only'
import { db, Prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors/app-error'

// Fixed-window request budgets (AGENTOS_SCALE_SECURITY §2.3). Postgres holds the
// counters — see prisma/schema/scale-security.prisma for why not Redis.
//
// The window is per (scope, identity): a user burning their chat budget does not
// lock themselves out of the dashboard, and a benchmark launch has its own, much
// smaller, budget because it is the one that costs money.
export const BUDGETS = {
	// Every authenticated API route.
	api: { limit: 100, windowSec: 60 },
	// The chat turn route: each request is a paid completion.
	chat: { limit: 10, windowSec: 60 },
	// The three routes that launch a paid run (agentos, benchmark, agentos-benchmark).
	launch: { limit: 3, windowSec: 60 },
	// Unauthenticated form traffic, keyed by IP.
	login: { limit: 10, windowSec: 900 }
} as const

export type BudgetScope = keyof typeof BUDGETS

// The 429 path. AppError already carries the status through captureError() without
// paging Sentry, but a rate-limit response is the one case the caller also needs a
// header for, so the retry window rides on the error itself and route-factory reads
// it back out.
export class RateLimitError extends AppError {
	readonly retryAfterSec: number

	constructor(retryAfterSec: number) {
		const mins = Math.ceil(retryAfterSec / 60)
		super(`Too many requests. Try again in ${retryAfterSec > 60 ? `${mins} minute${mins > 1 ? 's' : ''}` : `${retryAfterSec}s`}.`, {
			status: 429,
			code: 'rate_limited',
			message: `rate limit exceeded, retry after ${retryAfterSec}s`
		})
		this.name = 'RateLimitError'
		this.retryAfterSec = retryAfterSec
	}
}

// Comma-separated Supabase user ids exempt from the limits (§2.3 "whitelist admin"),
// for a demo or a load run that has to keep working. Unset = nobody exempt.
function adminIds(): Set<string> {
	return new Set(
		(process.env.RATE_LIMIT_ADMIN_USER_IDS ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	)
}

export function isRateLimitAdmin(identity: string | null): boolean {
	if (!identity) return false
	const ids = adminIds()
	return ids.size > 0 && ids.has(identity)
}

/**
 * Read-modify-write the counter in ONE statement.
 *
 * `SELECT count` then `UPDATE count + 1` is two round trips and, worse, races: two
 * concurrent requests both read 99 and both allow the 100th and 101st through.
 * `INSERT … ON CONFLICT DO UPDATE` makes the increment atomic in Postgres, and the
 * window rollover is a CASE inside the same statement, so an expired bucket restarts
 * at 1 rather than needing a second query or a sweeper.
 *
 * Every value is a bound parameter (`Prisma.sql` placeholders), never interpolated.
 */
async function increment(
	bucketKey: string,
	windowSec: number
): Promise<{ count: number; retryAfterSec: number }> {
	const rows = await db.$queryRaw<{ count: number; window_started_at: Date }[]>(Prisma.sql`
		INSERT INTO "rate_limit_buckets" ("bucket_key", "window_started_at", "window_sec", "count", "updated_at")
		VALUES (${bucketKey}, now(), ${windowSec}, 1, now())
		ON CONFLICT ("bucket_key") DO UPDATE SET
			"count" = CASE
				WHEN "rate_limit_buckets"."window_started_at" < now() - (${windowSec} * interval '1 second')
				THEN 1 ELSE "rate_limit_buckets"."count" + 1
			END,
			"window_started_at" = CASE
				WHEN "rate_limit_buckets"."window_started_at" < now() - (${windowSec} * interval '1 second')
				THEN now() ELSE "rate_limit_buckets"."window_started_at"
			END,
			"updated_at" = now()
		RETURNING "count", "window_started_at"
	`)
	const row = rows[0]
	if (!row) return { count: 1, retryAfterSec: windowSec }
	const msLeft = new Date(row.window_started_at).getTime() + windowSec * 1000 - Date.now()
	return {
		count: row.count,
		// Never 0 — a client that sees `Retry-After: 0` retries immediately and the
		// window never gets to close.
		retryAfterSec: Math.max(1, Math.ceil(msLeft / 1000))
	}
}

/**
 * Throw RateLimitError when this identity has used up `scope`'s budget.
 *
 * Fails OPEN when the counter itself cannot be written: a rate limiter that returns
 * 500 when Postgres is unhappy turns a database incident into a total outage, which
 * is a worse failure than letting a little extra traffic through. The one exception
 * is a money route, where an unbounded failure mode is a bill — those pass
 * `failClosed: true` and take the 500 instead.
 */
export async function enforceRateLimit(
	scope: BudgetScope,
	identity: string,
	{ failClosed = false }: { failClosed?: boolean } = {}
): Promise<void> {
	const budget = BUDGETS[scope]
	if (isRateLimitAdmin(identity)) return
	const key = `${scope}:${identity}`
	let result: { count: number; retryAfterSec: number }
	try {
		result = await increment(key, budget.windowSec)
	} catch (error) {
		if (failClosed) throw error
		return
	}
	if (result.count > budget.limit) throw new RateLimitError(result.retryAfterSec)
}
