import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { agentosBenchmarkInputSchema, agentosBenchmarkStreamResponse } from '@/server/agentos-benchmark/engine'

// Streaming endpoint (a full 24×4 run takes minutes), so it bypasses createApiRoute —
// which buffers JSON — but keeps the same thin-adapter contract: validation happens
// here so a malformed body gets a clean 400 instead of a half-open stream, and all
// logic lives in src/server/agentos-benchmark/engine.ts.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
	let input: z.infer<typeof agentosBenchmarkInputSchema>
	try {
		const raw = await req.json().catch(() => ({}))
		input = agentosBenchmarkInputSchema.parse(raw)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return NextResponse.json({ error: 'Invalid request', issues: error.flatten() }, { status: 400 })
		}
		const { userMessage, status } = captureError(error)
		return NextResponse.json({ error: userMessage }, { status })
	}

	return agentosBenchmarkStreamResponse(input)
}
