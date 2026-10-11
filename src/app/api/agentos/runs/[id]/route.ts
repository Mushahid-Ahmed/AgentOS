import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { getRunReplay } from '@/server/agentos/replay'

// One AgentOS run's reconstructed wire-event stream for replay (M7 / D6). The path
// segment is validated here (createApiRoute parses query/body, not the path), then
// delegates to the server module — same adapter pattern as benchmark/runs/[id].
// An unknown id is an honest 404, never an empty 200.
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
		const replay = await getRunReplay(BigInt(id))
		if (!replay) {
			return NextResponse.json({ error: 'Run not found' }, { status: 404 })
		}
		return NextResponse.json(replay)
	} catch (error) {
		return toResponse(error)
	}
}
