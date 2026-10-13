import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { log } from '@/server/lib/logger'
import { JUDGE_MODEL, MODEL_LABELS, type ModelLabel } from '@/lib/models'
import { routeQueryMeasured } from '@/server/ai/jev'
import { judgeRoute } from '@/server/ai/judge'
import { buildReport, type BenchmarkResultRow } from './benchmark-stats'
import { createRun, finishRun, loadRunForReport, persistPromptResults } from './benchmark-store'
import type { ReadScope } from './read-scope'
import type { BenchmarkReport, BenchmarkStreamEvent, RouterName } from '@/lib/benchmark'

// The benchmark engine (milestone 4) — the proof the whole product exists to
// make. It runs every dataset prompt through BOTH routers (Jev and the
// LLM-as-judge baseline), records the real latency/label/agreement/errors, and
// reports p50/p95/mean/min/max, accuracy, agreement, failure rate, routing cost
// and the measured speed-up factor. Every number is measured here; none is
// assumed (docs/jev-integration-notes.md §4/§7 — the brief's "~30-50ms" is a
// claim we test, not a constant we hard-code).
//
// Concurrency is pinned to 1 and Jev calls are spaced + retried honoring
// Retry-After: the BeatAPI free tier 429s under load and the account has a $0
// balance / 0 concurrency limit, so a fast parallel run is not available on this
// key (the throttled-free option the developer chose). Slow but honest and free.

// Fixed, not user-configurable: a higher concurrency would hammer the free-tier
// Jev endpoint into a wall of 429s and make the latency numbers meaningless.
const BENCHMARK_CONCURRENCY = 1
// Gentle spacing between Jev calls to reduce 429s before the retry logic even
// has to engage. The judge call between two Jev calls already adds ~1s.
const JEV_SPACING_MS = 1000
const WARMUP_PROMPT = 'Hello'

export const benchmarkInputSchema = z.object({
	label: z.string().min(1).max(120).optional(),
	notes: z.string().max(2000).optional(),
	// Run only the first N prompts — a smoke subset that costs cents and seconds
	// instead of a full pass. Capped so a typo can't request an absurd run.
	limit: z.number().int().min(1).max(500).optional()
})

export type BenchmarkInput = z.infer<typeof benchmarkInputSchema>

const promptSchema = z.object({
	id: z.string().min(1),
	category: z.string().min(1),
	prompt: z.string().min(1),
	expected: z.enum(MODEL_LABELS),
	rationale: z.string().optional()
})

const datasetSchema = z.object({
	version: z.number().optional(),
	meta: z.unknown().optional(),
	// The ≥50-prompt floor is enforced at load, so a truncated dataset fails the
	// run loudly rather than quietly benchmarking a handful of prompts.
	prompts: z
		.array(promptSchema)
		.min(50, 'benchmark dataset must contain at least 50 labelled prompts')
})

type DatasetPrompt = z.infer<typeof promptSchema>
type Dataset = z.infer<typeof datasetSchema>

// Read fresh on every run (a run lasts minutes; one readFileSync is nothing) so
// an edited dataset is picked up without a server restart, and a malformed one
// fails the run with a clear Zod error rather than a half-benchmarked result.
function loadDataset(): Dataset {
	const path = join(process.cwd(), 'benchmarks', 'dataset.json')
	const raw = readFileSync(path, 'utf-8')
	return datasetSchema.parse(JSON.parse(raw))
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function toCostMicroUsd(cost: number): bigint | null {
	if (!Number.isFinite(cost) || cost <= 0) return null
	return BigInt(Math.round(cost * 1_000_000))
}

// Normalize either router's result into a storable/countable row. On success the
// label is compared to the dataset's expected label to set `agreed`; on failure
// the label is empty and `agreed` is false, with the real reason kept in `error`
// so the failure rate is honest rather than dropped.
function toRow(
	router: RouterName,
	prompt: DatasetPrompt,
	result:
		| { ok: true; label: ModelLabel; latencyMs: number }
		| { ok: false; error: string; latencyMs: number }
): BenchmarkResultRow {
	if (result.ok) {
		return {
			promptId: prompt.id,
			router,
			latencyMs: result.latencyMs,
			label: result.label,
			expectedLabel: prompt.expected,
			agreed: result.label === prompt.expected,
			error: null
		}
	}
	return {
		promptId: prompt.id,
		router,
		latencyMs: result.latencyMs,
		label: '',
		expectedLabel: prompt.expected,
		agreed: false,
		error: result.error
	}
}

// One discarded call to each router so the first TIMED prompt isn't paying cold
// start (DNS/TLS/connection setup). Non-fatal: if warm-up fails (e.g. an
// immediate 429) the run still proceeds — the retry logic carries it.
async function warmUp(): Promise<void> {
	try {
		await judgeRoute(WARMUP_PROMPT)
	} catch (error) {
		log.warn('benchmark judge warm-up failed', { error })
	}
	try {
		await routeQueryMeasured(WARMUP_PROMPT)
	} catch (error) {
		log.warn('benchmark jev warm-up failed', { error })
	}
}

export type RunBenchmarkOptions = BenchmarkInput & {
	// V14 M3: the account that launched this run, recorded on the row so its scores
	// belong to that user. The CLI has no session and passes nothing.
	userId?: string | null
	onEvent?: (event: BenchmarkStreamEvent) => void
	// Aborted when the SSE client disconnects (the dashboard's Cancel button, or
	// navigating away). The loop checks it between prompts so a cancelled run
	// stops routing instead of hammering the free-tier endpoint in the background
	// for a run nobody is watching.
	signal?: AbortSignal
}

/**
 * Run the full benchmark suite and persist it. Emits progress events through
 * `onEvent` (the SSE route forwards them; the CLI prints them) and returns the
 * final report. Never throws for per-prompt router failures — those are recorded
 * as error rows; only a dataset/setup failure propagates.
 */
export async function runBenchmark(options: RunBenchmarkOptions = {}): Promise<BenchmarkReport> {
	const dataset = loadDataset()
	const prompts = options.limit != null ? dataset.prompts.slice(0, options.limit) : dataset.prompts
	const emit = options.onEvent ?? (() => {})

	const judgeModel = JUDGE_MODEL
	const label = options.label ?? `benchmark ${new Date().toISOString()}`
	const startedAtIso = new Date().toISOString()
	const runId = await createRun({
		label,
		concurrency: BENCHMARK_CONCURRENCY,
		judgeModel,
		notes: options.notes ?? null,
		userId: options.userId ?? null
	})

	emit({
		type: 'start',
		runId: runId.toString(),
		total: prompts.length,
		judgeModel,
		concurrency: BENCHMARK_CONCURRENCY
	})

	await warmUp()

	const jevRows: BenchmarkResultRow[] = []
	const judgeRows: BenchmarkResultRow[] = []
	let judgeCostUsd = 0

	for (let index = 0; index < prompts.length; index++) {
		// Stop at the next prompt boundary if the client disconnected. An in-flight
		// router call finishes; no further prompts are routed.
		if (options.signal?.aborted) break
		const prompt = prompts[index]
		if (!prompt) continue

		const jevResult = await routeQueryMeasured(prompt.prompt, {
			onWait: (waitMs, _attempt, reason) =>
				emit({ type: 'wait', promptId: prompt.id, router: 'jev', waitMs, reason })
		})
		// Space the Jev calls; the judge call below already adds its own latency.
		await sleep(JEV_SPACING_MS)
		const judgeResult = await judgeRoute(prompt.prompt)

		const jevRow = toRow(
			'jev',
			prompt,
			jevResult.ok
				? { ok: true, label: jevResult.label, latencyMs: jevResult.jevLatencyMs }
				: { ok: false, error: jevResult.error, latencyMs: jevResult.jevLatencyMs }
		)
		const judgeRow = toRow(
			'judge',
			prompt,
			judgeResult.ok
				? { ok: true, label: judgeResult.label, latencyMs: judgeResult.latencyMs }
				: { ok: false, error: judgeResult.error, latencyMs: judgeResult.latencyMs }
		)
		jevRows.push(jevRow)
		judgeRows.push(judgeRow)
		if (judgeResult.ok && judgeResult.costUsd != null) judgeCostUsd += judgeResult.costUsd

		// Persist as we go so a run that dies part-way leaves real measurements.
		await persistPromptResults(runId, [jevRow, judgeRow])

		emit({
			type: 'progress',
			index: index + 1,
			total: prompts.length,
			promptId: prompt.id,
			category: prompt.category,
			expected: prompt.expected,
			jev: jevResult.ok
				? { ok: true, label: jevResult.label, latencyMs: jevResult.jevLatencyMs }
				: { ok: false, error: jevResult.error },
			judge: judgeResult.ok
				? { ok: true, label: judgeResult.label, latencyMs: judgeResult.latencyMs }
				: { ok: false, error: judgeResult.error }
		})
	}

	await finishRun(runId, toCostMicroUsd(judgeCostUsd))

	const report = buildReport(
		{
			runId: runId.toString(),
			label,
			judgeModel,
			concurrency: BENCHMARK_CONCURRENCY,
			startedAt: startedAtIso,
			finishedAt: new Date().toISOString(),
			promptCount: prompts.length,
			judgeRoutingCostUsd: judgeCostUsd
		},
		jevRows,
		judgeRows
	)
	// A cancelled run still persisted and finished its partial measurements, but
	// must not emit `done` to a client that already disconnected — the enqueue
	// would throw. The stored run is read back honestly via getRunReport.
	if (!options.signal?.aborted) emit({ type: 'done', report })
	return report
}

function encodeEvent(event: BenchmarkStreamEvent): string {
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * The streaming SSE Response for POST /api/benchmark. A full run takes minutes
 * under free-tier throttling, so progress is streamed rather than buffered —
 * start -> (wait|progress)* -> done, or error. Mirrors chatStreamResponse: the
 * route file stays a thin adapter and never rejects the caller mid-stream.
 */
export function benchmarkStreamResponse(
	input: BenchmarkInput & { userId?: string | null }
): Response {
	// Aborted by the stream's cancel() when the client disconnects (the dashboard
	// Cancel button, or navigating away). Threaded into runBenchmark so the loop
	// stops at the next prompt boundary instead of running a 54-prompt benchmark
	// nobody is watching.
	const abort = new AbortController()
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder()
			const send = (event: BenchmarkStreamEvent) => {
				// Once the client is gone the controller is closed; swallowing the
				// emit keeps a late progress/wait event from throwing.
				if (abort.signal.aborted) return
				controller.enqueue(encoder.encode(encodeEvent(event)))
			}
			try {
				await runBenchmark({ ...input, signal: abort.signal, onEvent: send })
				controller.close()
			} catch (error) {
				log.error('benchmark run failed', { error })
				try {
					send({
						type: 'error',
						message: error instanceof Error ? error.message : 'Benchmark run failed.'
					})
				} catch {
					// controller already closed/errored; nothing left to do
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
 * Recompute a stored run's report from its persisted rows (single source of
 * truth) — the historical read the dashboard's run-history uses. Only the judge
 * routing cost is read from the run itself, since the rows can't express it.
 */
export async function getRunReport(runId: string, scope: ReadScope): Promise<BenchmarkReport> {
	const { meta, rows } = await loadRunForReport(runId, scope)
	const jevRows = rows.filter((row) => row.router === 'jev')
	const judgeRows = rows.filter((row) => row.router === 'judge')
	const judgeRoutingCostUsd =
		meta.judgeCostMicroUsd != null ? Number(meta.judgeCostMicroUsd) / 1_000_000 : 0

	return buildReport(
		{
			runId: meta.runId,
			label: meta.label,
			judgeModel: meta.judgeModel,
			concurrency: meta.concurrency,
			startedAt: meta.startedAt,
			finishedAt: meta.finishedAt,
			promptCount: jevRows.length,
			judgeRoutingCostUsd
		},
		jevRows,
		judgeRows
	)
}
