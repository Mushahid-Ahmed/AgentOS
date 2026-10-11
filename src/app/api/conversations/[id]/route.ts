import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { captureError } from '@/lib/observability/capture-error'
import { deleteConversation, getConversation } from '@/server/api/conversations'

// Load / delete a single conversation. createApiRoute parses input from the
// query string or body, not the path, so this dynamic segment validates the
// `id` param itself and delegates to the same server module — keeping the
// business logic out of route.ts while still returning a clean 400/404.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ id: z.string().regex(/^\d+$/, 'id must be a numeric string') })

type Ctx = { params: Promise<{ id: string }> }

async function resolveId(ctx: Ctx): Promise<string> {
	const { id } = paramsSchema.parse(await ctx.params)
	return id
}

function toResponse(error: unknown): NextResponse {
	if (error instanceof z.ZodError) {
		return NextResponse.json({ error: 'Invalid request', issues: error.flatten() }, { status: 400 })
	}
	const { userMessage, status } = captureError(error)
	return NextResponse.json({ error: userMessage }, { status })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
	try {
		return NextResponse.json(await getConversation(await resolveId(ctx)))
	} catch (error) {
		return toResponse(error)
	}
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
	try {
		return NextResponse.json(await deleteConversation(await resolveId(ctx)))
	} catch (error) {
		return toResponse(error)
	}
}
