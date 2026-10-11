import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
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
	try {
		const raw = await req.json().catch(() => ({}))
		query = agentRunInputSchema.parse(raw).query
	} catch (error) {
		if (error instanceof z.ZodError) {
			return NextResponse.json({ error: 'Invalid request', issues: error.flatten() }, { status: 400 })
		}
		const { userMessage, status } = captureError(error)
		return NextResponse.json({ error: userMessage }, { status })
	}

	return agentRunStreamResponse(query)
}
