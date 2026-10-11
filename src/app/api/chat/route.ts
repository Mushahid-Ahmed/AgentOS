import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { chatInputSchema, chatStreamResponse } from '@/server/api/chat'

// Streaming endpoint, so it bypasses createApiRoute (which buffers JSON) but
// keeps the same "route.ts is a thin adapter, logic lives in src/server/api"
// contract. Validation still happens here so a malformed body gets a clean 400
// instead of a half-open stream.
export const runtime = 'nodejs'
// A chat turn holds the connection open while tokens stream; opt out of any
// static caching so every POST reaches the handler.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
	let input: z.infer<typeof chatInputSchema>
	try {
		const raw = await req.json().catch(() => ({}))
		input = chatInputSchema.parse(raw)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{ error: 'Invalid request', issues: error.flatten() },
				{ status: 400 }
			)
		}
		const { userMessage, status } = captureError(error)
		return NextResponse.json({ error: userMessage }, { status })
	}

	return chatStreamResponse(input)
}
