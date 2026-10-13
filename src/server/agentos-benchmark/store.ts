import 'server-only'
import { db } from '@/server/db/client'
import { AppError } from '@/lib/errors/app-error'
import type { ReadScope } from '@/server/api/read-scope'
import type { ListAgentosBenchmarkRunsResponse } from '@/lib/agentos-benchmark/wire'
import type { AgentosSetup, JudgeVerdict, SetupTaskResult } from '@/lib/agentos-benchmark/stats'

// Persistence for the AgentOS four-setup benchmark (milestone 8). Mirrors the M4
// benchmark-store split: the engine (engine.ts) owns orchestration + stats, this file
// owns the Prisma writes/reads and the JSON-safe shaping. BigInt ids become strings,
// Dates become ISO, and money (integer millionths of a USD) is stored NULL-never-0 so
// an unpriced row is distinguishable from a genuinely free one — exactly as route_events
// and the M4 benchmark do. The report is REBUILT from these rows by the pure stats
// module, never stored as a blob, so a recomputed report can't drift from its inputs.

const LIST_LIMIT = 50

// A measured cost of 0 (a failed setup that made no paid call) is stored as NULL, and
// read back as 0 — lossless for the report's averages while honoring money-is-NULL.
function toCostMicroUsd(costMicroUsd: number): bigint | null {
	if (!Number.isFinite(costMicroUsd) || costMicroUsd <= 0) return null
	return BigInt(Math.round(costMicroUsd))
}

function fromCostMicroUsd(value: bigint | null): number {
	return value == null ? 0 : Number(value)
}

export type AgentosBenchmarkRunMeta = {
	runId: string
	label: string
	status: string
	judgeModel: string
	generatorModel: string
	startedAt: string
	finishedAt: string | null
	taskCount: number
	pilot: boolean
	judgeCostMicroUsd: bigint | null
}

export async function createRun(input: {
	label: string
	judgeModel: string
	generatorModel: string
	taskCount: number
	pilot: boolean
	notes?: string | null
	// The account that launched the run (V14 M3). NULL only for a launch with no
	// session, i.e. the CLI, whose runs stay staff-visible.
	userId?: string | null
}): Promise<bigint> {
	const run = await db.agentosBenchmarkRun.create({
		data: {
			label: input.label,
			judgeModel: input.judgeModel,
			generatorModel: input.generatorModel,
			taskCount: input.taskCount,
			pilot: input.pilot,
			notes: input.notes ?? null,
			userId: input.userId ?? null
		},
		select: { id: true }
	})
	return run.id
}

// Persist one (task, setup) measurement as the run progresses, so a run that dies
// part-way (a spend-cap stop, a crash, a client disconnect) still leaves every
// completed measurement behind rather than being all-or-nothing.
export async function persistResult(runId: bigint, result: SetupTaskResult): Promise<void> {
	await db.agentosBenchmarkResult.create({
		data: {
			runId,
			taskId: result.taskId,
			setup: result.setup,
			ok: result.ok,
			answer: result.answer,
			error: result.error,
			citations: result.citations,
			verifiedClaims: result.verifiedClaims,
			contestedClaims: result.contestedClaims,
			refutedClaims: result.refutedClaims,
			costMicroUsd: toCostMicroUsd(result.costMicroUsd),
			latencyMs: result.latencyMs,
			modelCalls: result.modelCalls,
			toolCalls: result.toolCalls,
			replans: result.replans
		}
	})
}

export async function persistVerdict(runId: bigint, verdict: JudgeVerdict): Promise<void> {
	await db.agentosBenchmarkVerdict.create({
		data: {
			runId,
			taskId: verdict.taskId,
			setup: verdict.setup,
			score: verdict.score,
			unsupportedClaims: verdict.unsupportedClaims,
			notes: verdict.notes || null,
			judgeModel: verdict.judgeModel
		}
	})
}

// Stamp the run terminal and record the judge's real spend. `status` is one of
// completed | budget_stopped | failed; taskCount is the number actually executed
// (a capped run finishes fewer than it planned).
export async function finishRun(
	runId: bigint,
	input: {
		status: string
		judgeCostMicroUsd: bigint | null
		taskCount: number
		notes?: string | null
	}
): Promise<void> {
	await db.agentosBenchmarkRun.update({
		where: { id: runId },
		data: {
			finishedAt: new Date(),
			status: input.status,
			judgeCostMicroUsd: input.judgeCostMicroUsd,
			taskCount: input.taskCount,
			...(input.notes == null ? {} : { notes: input.notes })
		}
	})
}

export async function listRuns(scope: ReadScope): Promise<ListAgentosBenchmarkRunsResponse> {
	const rows = await db.agentosBenchmarkRun.findMany({
		// Every read is scoped: a non-staff account only ever sees the runs it launched.
		where: scope.all ? {} : { userId: scope.userId },
		orderBy: { startedAt: 'desc' },
		take: LIST_LIMIT,
		select: {
			id: true,
			label: true,
			startedAt: true,
			finishedAt: true,
			status: true,
			judgeModel: true,
			generatorModel: true,
			taskCount: true,
			pilot: true,
			_count: { select: { results: true } }
		}
	})
	return {
		// The panel states its own scope, so a user is never shown somebody else's
		// numbers and a staff member knows they are looking past ownership.
		visibility: scope.all ? 'all' : 'own',
		runs: rows.map((row) => ({
			id: row.id.toString(),
			label: row.label,
			startedAt: row.startedAt.toISOString(),
			finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
			status: row.status,
			judgeModel: row.judgeModel,
			generatorModel: row.generatorModel,
			taskCount: row.taskCount,
			pilot: row.pilot,
			resultCount: row._count.results
		}))
	}
}

// Load a stored run with its result + verdict rows, shaped for report recomputation
// by the pure stats module (single source of truth = the rows).
export async function loadRunForReport(
	runId: string,
	scope: ReadScope
): Promise<{
	meta: AgentosBenchmarkRunMeta
	results: SetupTaskResult[]
	verdicts: JudgeVerdict[]
}> {
	const id = BigInt(runId)
	const run = await db.agentosBenchmarkRun.findUnique({
		where: { id },
		include: { results: true, verdicts: true }
	})
	// A run the caller does not own answers 404, not 403: the id exists, and saying
	// "forbidden" would confirm that much to an account that has no business knowing it.
	if (!run || (!scope.all && run.userId !== scope.userId)) {
		throw new AppError('AgentOS benchmark run not found', { status: 404 })
	}

	const results: SetupTaskResult[] = run.results.map((row) => ({
		taskId: row.taskId,
		setup: row.setup as AgentosSetup,
		ok: row.ok,
		answer: row.answer,
		error: row.error,
		citations: row.citations,
		verifiedClaims: row.verifiedClaims,
		contestedClaims: row.contestedClaims,
		refutedClaims: row.refutedClaims,
		costMicroUsd: fromCostMicroUsd(row.costMicroUsd),
		latencyMs: row.latencyMs,
		modelCalls: row.modelCalls,
		toolCalls: row.toolCalls,
		replans: row.replans
	}))

	const verdicts: JudgeVerdict[] = run.verdicts.map((row) => ({
		taskId: row.taskId,
		setup: row.setup as AgentosSetup,
		score: row.score,
		unsupportedClaims: row.unsupportedClaims,
		notes: row.notes ?? '',
		judgeModel: row.judgeModel
	}))

	return {
		meta: {
			runId: run.id.toString(),
			label: run.label,
			status: run.status,
			judgeModel: run.judgeModel,
			generatorModel: run.generatorModel,
			startedAt: run.startedAt.toISOString(),
			finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
			taskCount: run.taskCount,
			pilot: run.pilot,
			judgeCostMicroUsd: run.judgeCostMicroUsd
		},
		results,
		verdicts
	}
}
