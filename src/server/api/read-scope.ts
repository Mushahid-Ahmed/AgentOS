import 'server-only'
import type { NextRequest } from 'next/server'
import { getAdminContext } from '@/lib/rbac/context'
import { requireUserId } from './identity'

// V14 M3: the one place a stored-measurement endpoint decides whose rows it may serve.
//
// Ownership comes from `requireUserId` (the session-derived internal header proxy.ts
// writes, never a client-supplied id), and the role override comes from the existing
// RBAC context: an active AdminMember seat of any role reads the whole deployment,
// including the runs written before per-user ownership existed. Anyone else reads
// exactly their own runs, and an unowned row is served to staff or to nobody.
export type ReadScope = { userId: string; all: boolean }

export async function resolveReadScope(req: NextRequest): Promise<ReadScope> {
	const userId = requireUserId(req)
	const context = await getAdminContext()
	return { userId, all: context !== null }
}
