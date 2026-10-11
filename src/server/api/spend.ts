import 'server-only'
import { env } from '@/lib/env'
import { db } from '@/server/db/client'
import { nightlySpendMicroUsd } from '@/server/agentos/store'
import {
	buildModelUsageView,
	buildSpendView,
	type AgentRunRow,
	type BenchmarkRunRow,
	type RouteEventRow,
	type SpendAndUsage,
	type UsageRow
} from '@/lib/spend'

// Orchestration for GET /api/spend (V3 §15, milestone 10). Reads the REAL persisted
// rows — the ai_usage per-call ledger, agent_runs, the agentos benchmark run/result
// rows, and route_events — widens BigInt money to number micro-USD, then hands plain
// rows to the pure builders in src/lib/spend.ts. Every figure the two views show is a
// measurement from these tables; nothing is estimated or invented here.
//
// Money widening: Prisma returns BigInt for cost_micro_usd. Number() is exact for the
// magnitudes involved (micro-USD stays far below 2^53), and NULL stays NULL — never 0 —
// so an unpriced row is still visibly unpriced downstream.

const micro = (value: bigint | null): number | null => (value == null ? null : Number(value))

export async function getSpendAndUsage(): Promise<SpendAndUsage> {
	const [usageRows, runRows, benchRuns, benchResultSums, routeRows, spentTonight] =
		await Promise.all([
			db.aiUsage.findMany({
				select: {
					model: true,
					feature: true,
					inputTokens: true,
					outputTokens: true,
					costMicroUsd: true,
					status: true,
					createdAt: true
				}
			}),
			db.agentRun.findMany({
				select: {
					id: true,
					query: true,
					status: true,
					taskType: true,
					costMicroUsd: true,
					modelCalls: true,
					toolCalls: true,
					createdAt: true
				}
			}),
			db.agentosBenchmarkRun.findMany({
				select: {
					id: true,
					label: true,
					status: true,
					taskCount: true,
					judgeCostMicroUsd: true,
					startedAt: true
				}
			}),
			// Per-setup cost summed per benchmark run; the judge cost lives on the run row.
			db.agentosBenchmarkResult.groupBy({
				by: ['runId'],
				_sum: { costMicroUsd: true }
			}),
			db.routeEvent.findMany({
				select: { chosenModel: true, fallback: true }
			}),
			nightlySpendMicroUsd()
		])

	const usage: UsageRow[] = usageRows.map((row) => ({
		model: row.model,
		feature: row.feature,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		costMicroUsd: micro(row.costMicroUsd),
		status: row.status,
		createdAt: row.createdAt.toISOString()
	}))

	const agentRuns: AgentRunRow[] = runRows.map((row) => ({
		id: row.id.toString(),
		// Truncate a long query so the per-run list stays readable; the full text lives
		// on the run itself.
		query: row.query.length > 90 ? `${row.query.slice(0, 90)}…` : row.query,
		status: row.status,
		taskType: row.taskType,
		costMicroUsd: micro(row.costMicroUsd),
		modelCalls: row.modelCalls,
		toolCalls: row.toolCalls,
		createdAt: row.createdAt.toISOString()
	}))

	const setupCostByRun = new Map<string, number>()
	for (const group of benchResultSums) {
		setupCostByRun.set(group.runId.toString(), Number(group._sum.costMicroUsd ?? 0))
	}

	const benchmarkRuns: BenchmarkRunRow[] = benchRuns.map((row) => ({
		id: row.id.toString(),
		label: row.label,
		status: row.status,
		taskCount: row.taskCount,
		setupCostMicroUsd: setupCostByRun.get(row.id.toString()) ?? 0,
		judgeCostMicroUsd: micro(row.judgeCostMicroUsd),
		createdAt: row.startedAt.toISOString()
	}))

	const routeEvents: RouteEventRow[] = routeRows.map((row) => ({
		chosenModel: row.chosenModel,
		fallback: row.fallback
	}))

	const raw = {
		usage,
		agentRuns,
		benchmarkRuns,
		routeEvents,
		caps: {
			perRunUsd: env.PER_RUN_CAP_USD,
			nightlyUsd: env.NIGHTLY_SPEND_CAP_USD,
			benchmarkUsd: env.BENCHMARK_CAP_USD
		},
		spentTonightMicroUsd: Number(spentTonight)
	}

	return {
		spend: buildSpendView(raw),
		usage: buildModelUsageView(raw)
	}
}
