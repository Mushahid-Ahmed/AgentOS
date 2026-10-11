import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { getRunReport } from '@/server/api/benchmark'

// A single stored benchmark run's recomputed report. createApiRoute parses input
// from the query/body, not the path, so this dynamic segment validates the `id`
// param itself and delegates to the server module — same pattern as the
// conversations/[id] adapter, keeping logic out of route.ts.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ id: z.string().regex(/^\d+$/, 'id must be a numeric string') })

type Ctx = { params: Promise<{ id: string }> }

function toResponse(error: unknown): NextResponse {
	if (error instanceof z.ZodError) {
		return NextResponse.json({ error: 'Invalid request', issues: error.flatten() }, { status: 400 })
	}
	const { userMessage, status } = captureError(error)
	return NextResponse.json({ error: userMessage }, { status })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
	try {
		const { id } = paramsSchema.parse(await ctx.params)
		return NextResponse.json(await getRunReport(id))
	} catch (error) {
		return toResponse(error)
	}
}
