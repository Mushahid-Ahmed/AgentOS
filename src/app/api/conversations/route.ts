import { z } from 'zod'
import { createApiRoute } from '@/server/api/route-factory'
import { listConversations } from '@/server/api/conversations'

// History sidebar feed: the most recently active conversations. Logic lives in
// src/server/api/conversations.ts; this file is the zero-logic adapter the
// route-factory convention asks for.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createApiRoute({
	input: z.object({}),
	handler: () => listConversations()
})
