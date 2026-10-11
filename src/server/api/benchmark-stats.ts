import type { BenchmarkReport, LatencyStats, RouterName, RouterStats } from '@/lib/benchmark'

// Pure benchmark statistics — no 'server-only', no database, no I/O, so the
// whole thing is unit-testable under `node --test` (see benchmark-stats.test.mts).
// The engine (benchmark.ts) hands it the rows it collected; this turns them into
// the honest report. Every figure is derived from measured rows — nothing here
// invents a latency, an accuracy, or a speed-up (docs/jev-integration-notes.md §4).

// One (prompt x router) measurement, the shape the engine accumulates and the
// DB persists. `label` is '' on an error row; `agreed` is then always false.
export type BenchmarkResultRow = {
	promptId: string
	router: RouterName
	latencyMs: number
	label: string
	expectedLabel: string
	agreed: boolean
	error: string | null
}

// Linear interpolation between closest ranks (the common "type 7" quantile).
// `sorted` must already be ascending. An empty set yields 0; a single value
// yields that value for every quantile.
export function quantile(sorted: number[], q: number): number {
	if (sorted.length === 0) return 0
	if (sorted.length === 1) return sorted[0] ?? 0
	const pos = (sorted.length - 1) * q
	const base = Math.floor(pos)
	const rest = pos - base
	const lower = sorted[base] ?? 0
	const upper = sorted[base + 1] ?? lower
	return lower + rest * (upper - lower)
}

// Latency distribution over successful calls only. Rounded for display: ms are
// whole numbers, the mean keeps one decimal so a tight cluster isn't misleading.
export function latencyStats(latencies: number[]): LatencyStats {
	const sorted = [...latencies].sort((a, b) => a - b)
	const count = sorted.length
	if (count === 0) {
		return { count: 0, p50: 0, p95: 0, mean: 0, min: 0, max: 0 }
	}
	const sum = sorted.reduce((total, value) => total + value, 0)
	return {
		count,
		p50: Math.round(quantile(sorted, 0.5)),
		p95: Math.round(quantile(sorted, 0.95)),
		mean: Number((sum / count).toFixed(1)),
		min: sorted[0] ?? 0,
		max: sorted[count - 1] ?? 0
	}
}

function round4(value: number): number {
	return Number(value.toFixed(4))
}

// Per-router aggregates. Accuracy and latency are computed over SUCCESSFUL calls
// (a throttled or failed attempt has no honest decision or timing to contribute);
// failure rate is over all attempts, so a router that errors a lot is penalized
// in the metric that reflects it rather than hiding errors behind a small `ok`.
export function routerStats(router: RouterName, rows: BenchmarkResultRow[]): RouterStats {
	const total = rows.length
	const failures = rows.filter((row) => row.error != null)
	const errors = failures.length
	const ok = total - errors
	const successes = rows.filter((row) => row.error == null)
	const agreed = successes.filter((row) => row.agreed).length

	return {
		router,
		total,
		ok,
		errors,
		failureRate: total > 0 ? round4(errors / total) : 0,
		latency: latencyStats(successes.map((row) => row.latencyMs)),
		accuracy: ok > 0 ? round4(agreed / ok) : 0,
		agreed
	}
}

// Prompts where both routers succeeded and picked the same label, over prompts
// where both succeeded. Matched by promptId so the comparison is per-prompt, not
// aggregate. Returns { bothOk, agreement }.
export function routerAgreement(
	jevRows: BenchmarkResultRow[],
	judgeRows: BenchmarkResultRow[]
): { bothOk: number; agreement: number } {
	const jevByPrompt = new Map<string, BenchmarkResultRow>()
	for (const row of jevRows) {
		if (row.error == null) jevByPrompt.set(row.promptId, row)
	}
	let bothOk = 0
	let same = 0
	for (const row of judgeRows) {
		if (row.error != null) continue
		const jevRow = jevByPrompt.get(row.promptId)
		if (!jevRow) continue
		bothOk += 1
		if (jevRow.label === row.label) same += 1
	}
	return { bothOk, agreement: bothOk > 0 ? round4(same / bothOk) : 0 }
}

// judge p50 / jev p50 — how many times faster Jev's median routing hop was.
// Null (not 1, not 0) when Jev has no successful latency to divide by, so a
// failed Jev run never fabricates a speed-up.
export function speedUpFactor(jev: LatencyStats, judge: LatencyStats): number | null {
	if (jev.p50 <= 0 || judge.p50 <= 0) return null
	return Number((judge.p50 / jev.p50).toFixed(2))
}

export type ReportMeta = {
	runId: string
	label: string
	judgeModel: string
	concurrency: number
	startedAt: string
	finishedAt: string | null
	promptCount: number
	// Real NanoGPT cost (USD) summed across the judge's calls. Jev is the free
	// BeatAPI capability, so its routing cost is always 0 — a measured fact, not
	// an assumption.
	judgeRoutingCostUsd: number
}

// Assemble the full report from the two routers' rows plus run metadata.
export function buildReport(
	meta: ReportMeta,
	jevRows: BenchmarkResultRow[],
	judgeRows: BenchmarkResultRow[]
): BenchmarkReport {
	const jev = routerStats('jev', jevRows)
	const judge = routerStats('judge', judgeRows)
	const { bothOk, agreement } = routerAgreement(jevRows, judgeRows)

	return {
		runId: meta.runId,
		label: meta.label,
		judgeModel: meta.judgeModel,
		concurrency: meta.concurrency,
		startedAt: meta.startedAt,
		finishedAt: meta.finishedAt,
		promptCount: meta.promptCount,
		jev,
		judge,
		bothOk,
		routerAgreement: agreement,
		speedUpFactor: speedUpFactor(jev.latency, judge.latency),
		jevRoutingCostUsd: 0,
		judgeRoutingCostUsd: Number(meta.judgeRoutingCostUsd.toFixed(8))
	}
}
