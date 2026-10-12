import 'server-only'
import type { NextRequest } from 'next/server'
import { db } from '@/server/db/client'
import { captureError } from '@/lib/observability/capture-error'

// Audit trail (AGENTOS_SCALE_SECURITY §3.8): who did what, when.
//
// Deliberately narrow. Auth transitions and money-spending launches land here; LLM
// calls already have their own ledger in ai_usage (docs/rules/ai-usage.md) and
// AgentOS runs have agent_events, so duplicating either here would give two sources
// of truth for one fact. Ids, counts and outcomes only — never a prompt, an email, or
// anything that turns this table into a copy of user content.
//
// Best-effort by design, like the run store: an audit write that fails is reported
// and swallowed, because failing a login because the log table is unreachable turns
// an observability feature into an availability bug.

export type AuditAction =
	| 'signup'
	| 'login'
	| 'login_failed'
	| 'logout'
	| 'agentos_run'
	| 'benchmark_run'
	| 'rate_limited'

export async function recordAudit(input: {
	action: AuditAction
	actorId?: string | null
	target?: string | null
	metadata?: Record<string, string | number | boolean | null>
	ip?: string | null
}): Promise<void> {
	try {
		await db.auditLog.create({
			data: {
				action: input.action,
				actorId: input.actorId ?? null,
				target: input.target ?? null,
				metadata: input.metadata ? (input.metadata as object) : undefined,
				ip: input.ip ?? null
			}
		})
	} catch (error) {
		captureError(error, { feature: 'audit_log', action: input.action })
	}
}

// Retention (§3.8: keep 90 days). Not on a cron — this is called from the same
// best-effort path as recordAudit's callers would prefer, so it lives as an
// exported helper plus a script the existing cron surface can call; nothing here
// deletes data any UI reads.
export async function pruneAuditLogs(days = 90): Promise<number> {
	const cutoff = new Date(Date.now() - days * 86_400_000)
	const deleted = await db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
	const buckets = await db.rateLimitBucket.deleteMany({
		where: { windowStartedAt: { lt: cutoff } }
	})
	return deleted.count + buckets.count
}

// The identity a rate limit keys on.
//
// A signed-in user is keyed by their Supabase id, which proxy.ts verified and put on
// the internal request header — so this never re-reads the cookie (and never trusts
// a client-supplied value: the middleware overwrites the header, see proxy.ts).
// Without a session there is nothing to key on but the address, so unauthenticated
// form traffic uses `ip:<first X-Forwarded-For hop>`.
export function requestIdentity(req: NextRequest): { identity: string; userId: string | null } {
	const userId = req.headers.get('x-agentos-user-id')
	if (userId) return { identity: userId, userId }
	const forwarded = req.headers.get('x-forwarded-for') ?? ''
	const ip = forwarded.split(',')[0]?.trim() ?? 'unknown'
	return { identity: `ip:${ip}`, userId: null }
}
