import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { benchmarkInputSchema, benchmarkStreamResponse } from '@/server/api/benchmark'

// Streaming endpoint (a full run takes minutes under free-tier throttling), so it
// bypasses createApiRoute — which buffers JSON — but keeps the same thin-adapter
// contract: validation happens here so a malformed body gets a clean 400 instead
// of a half-open stream, and all logic lives in src/server/api/benchmark.ts.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
	let input: z.infer<typeof benchmarkInputSchema>
	try {
		const raw = await req.json().catch(() => ({}))
		input = benchmarkInputSchema.parse(raw)
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

	return benchmarkStreamResponse(input)
}
