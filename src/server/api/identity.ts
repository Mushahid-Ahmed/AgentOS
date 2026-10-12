import 'server-only'
import { AppError } from '@/lib/errors/app-error'
import type { NextRequest } from 'next/server'
import { requestIdentity } from '@/server/lib/audit'

// The one place a handler asks "who is this?" for data ownership.
//
// `x-agentos-user-id` is written by src/proxy.ts from the verified Supabase
// session — set when there is a session, deleted when there is not — so a
// client-forged value never reaches a handler. Everything else about identity
// (rate-limit keys, audit actor ids) may fall back to the IP; ownership may
// not: a null user must never resolve to "all rows" or "unowned rows", so this
// throws 401 instead of returning null.
export function requireUserId(req: NextRequest): string {
	const { userId } = requestIdentity(req)
	if (!userId) throw new AppError('Unauthorized', { status: 401 })
	return userId
}
