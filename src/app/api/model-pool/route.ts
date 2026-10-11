import { z } from 'zod'
import { createApiRoute } from '@/server/api/route-factory'
import { getModelPoolHealth } from '@/server/api/model-pool'

// Live Model Pool health for the dashboard panel (MP-M6). Zero-logic adapter over
// the server module, per the route-factory convention. Read-only, no input.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createApiRoute({
	input: z.object({}),
	handler: () => getModelPoolHealth()
})
