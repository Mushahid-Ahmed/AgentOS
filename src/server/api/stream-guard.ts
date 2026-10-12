import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AppError } from '@/lib/errors/app-error'
import { enforceRateLimit, RateLimitError, type BudgetScope } from './rate-limit'
import { recordAudit, requestIdentity } from '@/server/lib/audit'

// The four streaming endpoints (/api/chat, /api/agentos, /api/benchmark,
// /api/agentos-benchmark) cannot go through createApiRoute — that buffers a JSON
// body, and these return an open SSE stream. This is the same guard those routes
// get, expressed once, so "streaming" is not a way to be unlimited and unlogged.
//
// Order matters: identity, then budget, then the money decision. A request that has
// spent its budget must be turned away before anything is written or billed.
export async function guardStream(
	req: NextRequest,
	config: {
		scope: BudgetScope
		// The paid routes require a session in the handler too, not only in proxy.ts:
		// these are the endpoints that spend provider credits, and the brief's §3.4
		// asks for defence in depth rather than one correct line of middleware.
		requireUser?: boolean
		// Counted, and fail-closed: if the counter cannot be written, a launch route
		// returns an error rather than running unbounded. A 500 during a Postgres
		// incident is the cheaper outcome than an uncapped spend.
		failClosed?: boolean
		auditAction?: 'agentos_run' | 'benchmark_run'
	}
): Promise<{ userId: string | null }> {
	const { identity, userId } = requestIdentity(req)
	if (config.requireUser && !userId) {
		throw new AppError('Sign in to run this.', { status: 401, code: 'unauthorized' })
	}
	await enforceRateLimit(config.scope, identity, { failClosed: config.failClosed ?? Boolean(config.requireUser) })
	if (config.auditAction) {
		await recordAudit({
			action: config.auditAction,
			actorId: userId,
			// The counter identity is the user id when there is one; an IP-keyed
			// launch has no actor, and that is worth seeing in the log.
			metadata: { key: identity === userId ? 'session' : 'ip', budget: config.scope }
		})
	}
	return { userId }
}

// A streaming route's catch block turns anything it does not recognise into a
// generic error through captureError(); a 429 has to keep its status and its
// Retry-After, so each route asks this first and only falls through when the answer
// is null. Same shape as the handling inside createApiRoute.
export function guardResponse(error: unknown): NextResponse | null {
	if (error instanceof RateLimitError) {
		return NextResponse.json(
			{ error: error.userMessage },
			{ status: 429, headers: { 'Retry-After': String(error.retryAfterSec) } }
		)
	}
	if (error instanceof AppError && error.status === 401) {
		return NextResponse.json({ error: error.userMessage }, { status: 401 })
	}
	return null
}
