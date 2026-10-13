import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { guardResponse, guardStream } from '@/server/api/stream-guard'
import { benchmarkInputSchema, benchmarkStreamResponse } from '@/server/api/benchmark'

// Streaming endpoint (a full run takes minutes under free-tier throttling), so it
// bypasses createApiRoute — which buffers JSON — but keeps the same thin-adapter
// contract: validation happens here so a malformed body gets a clean 400 instead
// of a half-open stream, and all logic lives in src/server/api/benchmark.ts.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
	let input: z.infer<typeof benchmarkInputSchema>
	let userId: string | null = null
	try {
		// Budget + session before the body is read or a token is spent.
		;({ userId } = await guardStream(req, {
			scope: 'launch',
			requireUser: true,
			auditAction: 'benchmark_run'
		}))
		const raw = await req.json().catch(() => ({}))
		input = benchmarkInputSchema.parse(raw)
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

	// The session's id is written onto the run row (V14 M3), so the scores this stream
	// produces belong to the account that paid for them and to nobody else.
	return benchmarkStreamResponse({ ...input, userId })
}
