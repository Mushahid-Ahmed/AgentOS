import { z } from 'zod'
import { createApiRoute } from '@/server/api/route-factory'
import { listRuns } from '@/server/agentos/replay'

// AgentOS run history for the D6 replay picker (M7). Zero-logic adapter over the
// replay store, per the route-factory convention (same shape as the benchmark runs
// list). Newest first; the client folds a selected run's events through the pure
// run-view reducer.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createApiRoute({
	input: z.object({}),
	handler: () => listRuns()
})
