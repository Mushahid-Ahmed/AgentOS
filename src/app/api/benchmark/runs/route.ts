import { z } from 'zod'
import { createApiRoute } from '@/server/api/route-factory'
import { listRuns } from '@/server/api/benchmark-store'
import { resolveReadScope } from '@/server/api/read-scope'

// Benchmark run history for the dashboard (milestone 5) and for verifying a run
// persisted. Zero-logic adapter over the store, per the route-factory convention.
// The read is ownership-scoped (V14 M3): an account gets its own runs, a staff
// seat gets every run.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createApiRoute({
	input: z.object({}),
	handler: async (_input, req) => listRuns(await resolveReadScope(req))
})
