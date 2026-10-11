import { z } from 'zod'
import { createApiRoute } from '@/server/api/route-factory'
import { getSpendAndUsage } from '@/server/api/spend'

// Spend + model-usage views for the dashboard (V3 §15, milestone 10). Zero-logic
// adapter over the server module, per the route-factory convention. Read-only, no
// input — mirrors GET /api/model-pool and GET /api/dashboard.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createApiRoute({
	input: z.object({}),
	handler: () => getSpendAndUsage()
})
