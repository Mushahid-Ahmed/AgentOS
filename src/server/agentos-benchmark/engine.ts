import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { env } from '@/lib/env'
import { log } from '@/server/lib/logger'
import { AppError } from '@/lib/errors/app-error'
import { captureError } from '@/lib/observability/capture-error'
import { judgeAnswer } from '@/server/ai/rubric-judge'
import { nightlySpendMicroUsd } from '@/server/agentos/store'
import {
	AGENTOS_BENCHMARK_SETUPS,
	buildAgentosBenchmarkReport,
	type AgentosBenchmarkReport,
	type JudgeVerdict,
	type SetupTaskResult
} from '@/lib/agentos-benchmark/stats'
import type {
	AgentosBenchmarkSetupOutcome,
	AgentosBenchmarkStreamEvent
} from '@/lib/agentos-benchmark/wire'
import { runSetup, type BenchmarkTask } from './setups'
import type { ReadScope } from '@/server/api/read-scope'
import { createRun, finishRun, loadRunForReport, persistResult, persistVerdict } from './store'

// The AgentOS four-setup benchmark engine (milestone 8, AGENTOS_UPGRADE_PROMPT §14).
// It runs every task through all four setups (setups.ts), grades each successful answer
// with the rubric judge (rubric-judge.ts), persists measurements as it goes, and folds
// them into the pure report (stats.ts). EVERY number is measured; none is assumed.
//
// Spend discipline (§12) is enforced here, in code, not left to the caller:
//   - a pre-flight nightly gate refuses to START once tonight's real spend is exhausted;
//   - the run's effective ceiling is min(BENCHMARK_CAP_USD, remaining nightly headroom),
//     checked before each task so a long run stops honestly instead of overspending;
//   - cumulative spend (all four setups + judge) is tracked from REAL measured costs and
//     streamed on every progress event, so the UI shows the cap being respected.
// The DEFAULT run is a 3-task PILOT — a full 24-task run must be requested explicitly.
//
// Concurrency is 1 (sequential tasks, sequential setups within a task): the free-tier
// research endpoint 429s under load and sequential execution keeps latency meaningful.

const PILOT_TASK_COUNT = 3
// Report labels for the two models every setup shares. The real slugs live in the
// runners (gemini-2.5-flash) and the judge (gpt-4.1); these are the human-readable
// names shown in the report so the comparison is reproducible at a glance.
const GENERATOR_MODEL = 'gemini-2.5-flash'
const JUDGE_MODEL_NAME = 'gpt-4.1'

export const agentosBenchmarkInputSchema = z.object({
	label: z.string().min(1).max(120).optional(),
	notes: z.string().max(2000).optional(),
	// Number of tasks to run. Defaults to the 3-task pilot; a full run passes an
	// explicit limit (or pilot:false). Capped at the dataset size by the slice.
	limit: z.number().int().min(1).max(24).optional(),
	pilot: z.boolean().optional()
})

export type AgentosBenchmarkInput = z.infer<typeof agentosBenchmarkInputSchema>

const taskSchema = z.object({
	id: z.string().min(1),
	category: z.string().min(1),
	task: z.string().min(1),
	rubric: z.string().min(1)
})

const datasetSchema = z.object({
	version: z.number().optional(),
	meta: z.unknown().optional(),
	tasks: z.array(taskSchema).min(1, 'agentos benchmark dataset must contain at least one task')
})

type Dataset = z.infer<typeof datasetSchema>

// Read fresh on every run so an edited dataset is picked up without a restart, and a
// malformed one fails loudly with a Zod error rather than half-benchmarking.
function loadDataset(): Dataset {
	const path = join(process.cwd(), 'benchmarks', 'agentos-tasks.json')
	return datasetSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

export type RunAgentosBenchmarkOptions = AgentosBenchmarkInput & {
	// V14 M3: the account that launched this run, recorded on the row so its scores
	// belong to that user. The CLI has no session and passes nothing.
	userId?: string | null
	onEvent?: (event: AgentosBenchmarkStreamEvent) => void
	// Aborted when the SSE client disconnects; checked between tasks so a cancelled
	// run stops spending instead of running a benchmark nobody is watching.
	signal?: AbortSignal
}

/**
 * Run the four-setup benchmark and persist it. Emits start -> progress* -> done (or
 * throws for a nightly-cap refusal / unexpected crash). A spend-cap stop mid-run is
 * NOT an error: it finishes honestly as 'budget_stopped' and still emits `done` with
 * the partial report, so the measurements already taken are never discarded.
 */
export async function runAgentosBenchmark(
	options: RunAgentosBenchmarkOptions = {}
): Promise<AgentosBenchmarkReport> {
	const dataset = loadDataset()
	const pilot = options.pilot ?? true
	const limit = options.limit ?? (pilot ? PILOT_TASK_COUNT : dataset.tasks.length)
	const tasks: BenchmarkTask[] = dataset.tasks.slice(0, limit)
	const emit = options.onEvent ?? (() => {})

	const capMicro = Math.round(env.BENCHMARK_CAP_USD * 1_000_000)
	const nightlyCapMicro = Math.round(env.NIGHTLY_SPEND_CAP_USD * 1_000_000)

	// Pre-flight nightly gate (§12): refuse to START a new run once tonight's real
	// spend has reached the cap. Checked before any paid call, before the row exists.
	const spentTonight = Number(await nightlySpendMicroUsd())
	if (spentTonight >= nightlyCapMicro) {
		throw new AppError(
			`Nightly spend cap reached (${env.NIGHTLY_SPEND_CAP_USD} USD). No new benchmark runs until it resets.`,
			{ status: 409 }
		)
	}
	// Bound this run by BOTH the benchmark cap and the remaining nightly headroom, so
	// a long run can never push the night over its cap. spentMicro below is measured
	// from real costs (all setups + judge), and spentTonight is the pre-run baseline.
	const effectiveCapMicro = Math.min(capMicro, Math.max(0, nightlyCapMicro - spentTonight))

	const startedAtIso = new Date().toISOString()
	const label = options.label ?? `agentos benchmark ${pilot ? 'pilot' : 'full'} ${startedAtIso}`
	const runId = await createRun({
		label,
		judgeModel: JUDGE_MODEL_NAME,
		generatorModel: GENERATOR_MODEL,
		taskCount: tasks.length,
		pilot,
		notes: options.notes ?? null,
		userId: options.userId ?? null
	})

	emit({
		type: 'start',
		runId: runId.toString(),
		taskCount: tasks.length,
		setups: [...AGENTOS_BENCHMARK_SETUPS],
		judgeModel: JUDGE_MODEL_NAME,
		generatorModel: GENERATOR_MODEL,
		pilot,
		capUsd: env.BENCHMARK_CAP_USD
	})

	const results: SetupTaskResult[] = []
	const verdicts: JudgeVerdict[] = []
	let spentMicro = 0
	let judgeCostMicro = 0
	let executedTasks = 0
	let status = 'completed'
	let stopNote: string | null = null

	// Row writes are ISSUED the moment a measurement exists, but no longer awaited
	// inline. Between a setup's model call and its judge call the insert cost a full
	// cross-region round trip (~1.8 s here) of dead wall clock inside the paid path —
	// up to ~14 s per task with four setups, and each of those seconds counted against
	// the 300s undici body timeout the heartbeats exist to dodge. Issuing at the same
	// point and draining at the task boundary keeps the durability guarantee it always
	// promised (a run that dies part-way still leaves its completed measurements
	// behind) while making nothing on the client's critical path wait for a row.
	const pendingWrites: Promise<void>[] = []
	const trackWrite = (write: Promise<unknown>, op: 'result' | 'verdict') => {
		pendingWrites.push(
			write.then(
				() => undefined,
				(error) => {
					captureError(error, { feature: 'agentos_benchmark_persist', op })
				}
			)
		)
	}
	const drainWrites = async () => {
		if (pendingWrites.length === 0) return
		await Promise.all(pendingWrites.splice(0))
	}

	for (let index = 0; index < tasks.length; index++) {
		if (options.signal?.aborted) {
			status = 'failed'
			stopNote = 'cancelled'
			break
		}
		// Honest spend-cap stop BEFORE starting a task that would exceed the ceiling.
		if (spentMicro >= effectiveCapMicro) {
			status = 'budget_stopped'
			stopNote = `spend cap reached: ${(spentMicro / 1_000_000).toFixed(4)} USD of ${(effectiveCapMicro / 1_000_000).toFixed(2)} USD ceiling`
			log.warn('agentos benchmark stopping at spend cap', { spentMicro, effectiveCapMicro })
			break
		}
		const task = tasks[index]
		if (!task) continue

		const outcomes: AgentosBenchmarkSetupOutcome[] = []
		for (const setup of AGENTOS_BENCHMARK_SETUPS) {
			// Keep-alive before each (potentially multi-minute) setup so a Node/undici
			// client's default 300s body timeout never fires during one task's silence.
			emit({
				type: 'heartbeat',
				index: index + 1,
				total: tasks.length,
				taskId: task.id,
				setup
			})
			const result = await runSetup(setup, task)
			results.push(result)
			spentMicro += result.costMicroUsd
			trackWrite(persistResult(runId, result), 'result')

			// Grade only an answer that actually exists; a failed setup is recorded as a
			// failure row and simply isn't judged (its success-rate hit is the honest signal).
			let score: number | null = null
			if (result.ok && result.answer) {
				const judged = await judgeAnswer({
					taskId: task.id,
					setup,
					task: task.task,
					rubric: task.rubric,
					answer: result.answer
				})
				if (judged.ok) {
					score = judged.score
					if (judged.costUsd != null && Number.isFinite(judged.costUsd)) {
						const micro = Math.round(judged.costUsd * 1_000_000)
						judgeCostMicro += micro
						spentMicro += micro
					}
					const verdict: JudgeVerdict = {
						taskId: task.id,
						setup,
						score: judged.score,
						unsupportedClaims: judged.unsupportedClaims,
						notes: judged.notes,
						judgeModel: JUDGE_MODEL_NAME
					}
					verdicts.push(verdict)
					trackWrite(persistVerdict(runId, verdict), 'verdict')
				} else {
					// A judge failure is recorded honestly (no verdict row), never coerced
					// into a fabricated score. The task still counts; it just isn't scored
					// for this setup.
					log.warn('agentos benchmark judge failed', {
						taskId: task.id,
						setup,
						error: judged.error
					})
				}
			}

			outcomes.push({
				setup,
				ok: result.ok,
				score,
				costMicroUsd: result.costMicroUsd,
				latencyMs: result.latencyMs,
				error: result.error
			})
		}
		// The task boundary: every row this task measured is durable before the
		// progress event that reports it, and before the counter the run's final
		// taskCount is built from.
		await drainWrites()
		executedTasks += 1

		emit({
			type: 'progress',
			index: index + 1,
			total: tasks.length,
			taskId: task.id,
			category: task.category,
			outcomes,
			spentMicroUsd: spentMicro
		})
	}

	const finishedAtIso = new Date().toISOString()
	// No row write may still be in flight when the run row goes terminal, or a client
	// reading the finished run sees fewer results than were measured. Each task
	// boundary already drains, so this normally costs nothing.
	await drainWrites()
	await finishRun(runId, {
		status,
		judgeCostMicroUsd: judgeCostMicro > 0 ? BigInt(judgeCostMicro) : null,
		taskCount: executedTasks,
		notes: stopNote
	})

	const report = buildAgentosBenchmarkReport(
		{
			runId: runId.toString(),
			label,
			judgeModel: JUDGE_MODEL_NAME,
			generatorModel: GENERATOR_MODEL,
			startedAt: startedAtIso,
			finishedAt: finishedAtIso,
			taskCount: executedTasks
		},
		results,
		verdicts
	)

	// A cancelled run persisted its partial measurements but must not emit `done` to a
	// client that already disconnected — the enqueue would throw. Read it back via
	// getAgentosRunReport instead.
	if (!options.signal?.aborted) emit({ type: 'done', report })
	return report
}

function encodeEvent(event: AgentosBenchmarkStreamEvent): string {
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * The streaming SSE Response for POST /api/agentos-benchmark. A full run takes minutes
 * (24 tasks × 4 setups × a judge hop each), so progress is streamed, not buffered:
 * start -> progress* -> done, or error. Mirrors benchmarkStreamResponse — the route file
 * stays a thin adapter and the stream never rejects the caller mid-flight.
 */
export function agentosBenchmarkStreamResponse(
	input: AgentosBenchmarkInput & { userId?: string | null }
): Response {
	const abort = new AbortController()
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder()
			const send = (event: AgentosBenchmarkStreamEvent) => {
				// Once the client is gone the controller is closed; swallowing the emit
				// keeps a late progress event from throwing.
				if (abort.signal.aborted) return
				controller.enqueue(encoder.encode(encodeEvent(event)))
			}
			try {
				await runAgentosBenchmark({ ...input, signal: abort.signal, onEvent: send })
				controller.close()
			} catch (error) {
				log.error('agentos benchmark run failed', { error })
				// The only AppError this engine throws is the nightly-cap refusal; anything
				// else is an unexpected crash. The code lets the client tell them apart.
				const code = error instanceof AppError ? 'nightly_cap' : 'internal'
				try {
					send({
						type: 'error',
						message: error instanceof Error ? error.message : 'Benchmark run failed.',
						code
					})
				} catch {
					// controller already closed/errored; nothing left to deliver
				}
				controller.close()
			}
		},
		cancel() {
			abort.abort()
		}
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	})
}

/**
 * Recompute a stored run's report from its persisted rows (single source of truth) —
 * the historical read the dashboard's run-history uses. The report is rebuilt by the
 * pure stats module, so a recomputed report can never drift from the measurements.
 */
export async function getAgentosRunReport(
	runId: string,
	scope: ReadScope
): Promise<AgentosBenchmarkReport> {
	const { meta, results, verdicts } = await loadRunForReport(runId, scope)
	return buildAgentosBenchmarkReport(
		{
			runId: meta.runId,
			label: meta.label,
			judgeModel: meta.judgeModel,
			generatorModel: meta.generatorModel,
			startedAt: meta.startedAt,
			// A run still in flight has no finishedAt; fall back to startedAt so the
			// report type stays whole without inventing a duration.
			finishedAt: meta.finishedAt ?? meta.startedAt,
			taskCount: meta.taskCount
		},
		results,
		verdicts
	)
}
