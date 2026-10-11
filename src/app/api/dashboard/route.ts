import { z } from 'zod'
import { createApiRoute } from '@/server/api/route-factory'
import { getDashboard } from '@/server/api/dashboard'

// Cumulative routing telemetry for the executive dashboard (milestone 5).
// Zero-logic adapter over the server module, per the route-factory convention.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createApiRoute({
	input: z.object({}),
	handler: () => getDashboard()
})
