import 'server-only'
import { db } from '@/server/db/client'
import { AppError } from '@/lib/errors/app-error'
import type { ListRunsResponse, RouterName, RunSummary } from '@/lib/benchmark'
import type { BenchmarkResultRow } from './benchmark-stats'

// Persistence for the benchmark suite (milestone 4). Mirrors the chat-store
// split: the engine (benchmark.ts) owns orchestration and stats, this file owns
// the Prisma writes/reads and the JSON-safe shaping of what comes back. BigInt
// ids become strings and Dates become ISO so NextResponse.json never chokes,
// exactly as conversations.ts does.

const LIST_LIMIT = 50

export type { RunSummary }

export async function createRun(input: {
	label: string
	concurrency: number
	judgeModel: string
	notes?: string | null
}): Promise<bigint> {
	const run = await db.benchmarkRun.create({
		data: {
			label: input.label,
			concurrency: input.concurrency,
			judgeModel: input.judgeModel,
			notes: input.notes ?? null
		},
		select: { id: true }
	})
	return run.id
}

// Persist both routers' rows for one prompt in a single write. Called as the run
// progresses so a run that dies part-way still leaves its completed measurements
// behind, and so the stored history is durable rather than all-or-nothing.
export async function persistPromptResults(
	runId: bigint,
	rows: Array<BenchmarkResultRow & { router: RouterName }>
): Promise<void> {
	await db.benchmarkResult.createMany({
		data: rows.map((row) => ({
			runId,
			promptId: row.promptId,
			router: row.router,
			latencyMs: row.latencyMs,
			label: row.label,
			expectedLabel: row.expectedLabel,
			agreed: row.agreed,
			error: row.error
		}))
	})
}

// Stamp the run finished and record the judge's real routing spend (integer
// millionths of a USD, matching route_events.cost_micro_usd). Null cost stays
// null — never 0, so an unpriced run is distinguishable from a free one.
export async function finishRun(runId: bigint, judgeCostMicroUsd: bigint | null): Promise<void> {
	await db.benchmarkRun.update({
		where: { id: runId },
		data: { finishedAt: new Date(), judgeCostMicroUsd }
	})
}

export async function listRuns(): Promise<ListRunsResponse> {
	const rows = await db.benchmarkRun.findMany({
		orderBy: { startedAt: 'desc' },
		take: LIST_LIMIT,
		select: {
			id: true,
			label: true,
			startedAt: true,
			finishedAt: true,
			concurrency: true,
			judgeModel: true,
			_count: { select: { results: true } }
		}
	})
	return {
		runs: rows.map((row) => ({
			id: row.id.toString(),
			label: row.label,
			startedAt: row.startedAt.toISOString(),
			finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
			concurrency: row.concurrency,
			judgeModel: row.judgeModel,
			resultCount: row._count.results
		}))
	}
}

// Load a stored run with its result rows, shaped for report recomputation. The
// report is rebuilt from the rows (single source of truth) by benchmark-stats,
// not stored as a blob — only the judge cost, which the rows can't express, is
// read back from the run itself.
export async function loadRunForReport(runId: string): Promise<{
	meta: {
		runId: string
		label: string
		judgeModel: string
		concurrency: number
		startedAt: string
		finishedAt: string | null
		judgeCostMicroUsd: bigint | null
	}
	rows: BenchmarkResultRow[]
}> {
	const run = await db.benchmarkRun.findUnique({
		where: { id: BigInt(runId) },
		include: { results: true }
	})
	if (!run) throw new AppError('Benchmark run not found', { status: 404 })

	return {
		meta: {
			runId: run.id.toString(),
			label: run.label,
			judgeModel: run.judgeModel,
			concurrency: run.concurrency,
			startedAt: run.startedAt.toISOString(),
			finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
			judgeCostMicroUsd: run.judgeCostMicroUsd
		},
		rows: run.results.map((result) => ({
			promptId: result.promptId,
			router: result.router === 'judge' ? 'judge' : 'jev',
			latencyMs: result.latencyMs,
			label: result.label,
			expectedLabel: result.expectedLabel,
			agreed: result.agreed,
			error: result.error
		}))
	}
}
