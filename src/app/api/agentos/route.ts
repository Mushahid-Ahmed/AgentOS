import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { guardResponse, guardStream } from '@/server/api/stream-guard'
import { agentRunStreamResponse } from '@/server/agentos/run'

// Streaming endpoint (SSE), so it bypasses createApiRoute (which buffers JSON)
// but keeps the same "route.ts is a thin adapter, logic lives in src/server"
// contract. Validation happens here so a malformed body gets a clean 400 instead
// of a half-open stream.
export const runtime = 'nodejs'
// A run holds the connection open while agents execute and events stream; opt out
// of any static caching so every POST reaches the handler.
export const dynamic = 'force-dynamic'

const agentRunInputSchema = z.object({
	query: z.string().trim().min(1).max(8_000)
})

export async function POST(req: NextRequest) {
	let query: string
	let userId: string
	try {
		// Budget + session before the body is read or a token is spent.
		const guard = await guardStream(req, {
			scope: 'launch',
			requireUser: true,
			auditAction: 'agentos_run'
		})
		// requireUser makes guardStream throw on no session, so this is the verified
		// id from proxy.ts — the owner the run row is stamped with.
		userId = guard.userId as string
		const raw = await req.json().catch(() => ({}))
		query = agentRunInputSchema.parse(raw).query
	} catch (error) {
		const guarded = guardResponse(error)
		if (guarded) return guarded
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ error: 'Invalid request', issues: error.flatten() },
				{ status: 400 }
			)
		}
		const { userMessage, status } = captureError(error)
		return NextResponse.json({ error: userMessage }, { status })
	}

	// guardStream already refused anything with no session, so userId is set.
	return agentRunStreamResponse(query, userId as string)
}
