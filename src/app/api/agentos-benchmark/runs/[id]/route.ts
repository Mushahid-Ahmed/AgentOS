import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { getAgentosRunReport } from '@/server/agentos-benchmark/engine'

// A single stored AgentOS benchmark run's recomputed report. createApiRoute parses
// input from the query/body, not the path, so this dynamic segment validates the `id`
// param itself and delegates to the engine — same pattern as the M4 benchmark
// runs/[id] adapter, keeping logic out of route.ts.
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
		return NextResponse.json(await getAgentosRunReport(id))
	} catch (error) {
		return toResponse(error)
	}
}
