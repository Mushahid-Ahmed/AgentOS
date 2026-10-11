import { z } from 'zod'
import { createApiRoute } from '@/server/api/route-factory'
import { listRuns } from '@/server/agentos-benchmark/store'

// AgentOS benchmark run history for the dashboard. Zero-logic adapter over the store,
// per the route-factory convention.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createApiRoute({
	input: z.object({}),
	handler: () => listRuns()
})
