import type { ModelLabel } from '@/lib/models'

// Shared, isomorphic types for the benchmark suite (milestone 4). No
// 'server-only': the report shape and the SSE progress-event shapes are
// consumed by the executive dashboard client (milestone 5) as well as the
// server engine, so they live in src/lib next to chat-stream.ts and models.ts.
// Nothing here is secret — it is the contract between the run engine, the
// stored rows, and the charts.

export type RouterName = 'jev' | 'judge'

// Latency distribution over the SUCCESSFUL calls of one router, in ms. p50/p95
// use linear interpolation between closest ranks; an empty set is all zeros
// with count 0 rather than null, so charts can render a flat "no data" state.
export type LatencyStats = {
	count: number
	p50: number
	p95: number
	mean: number
	min: number
	max: number
}

export type RouterStats = {
	router: RouterName
	// Prompts attempted through this router.
	total: number
	// Successful classifications (a real label came back).
	ok: number
	// Failures: timeout, rate-limit exhausted, out-of-vocab label, provider error.
	errors: number
	// errors / total (0 when total is 0).
	failureRate: number
	// Over successful calls only — a throttled or failed attempt has no honest
	// routing latency to contribute.
	latency: LatencyStats
	// Correct classifications among successful calls (agreed / ok).
	accuracy: number
	// Count where the router's label matched the dataset's expected label.
	agreed: number
}

// The full, honest result of one benchmark run — every number here is measured,
// never assumed (docs/jev-integration-notes.md §4/§7). `speedUpFactor` is
// judge p50 / jev p50: >1 means Jev routed faster. It is null when Jev has no
// successful latency to divide by, rather than a fabricated 1.
export type BenchmarkReport = {
	runId: string
	label: string
	judgeModel: string
	concurrency: number
	startedAt: string
	finishedAt: string | null
	promptCount: number
	jev: RouterStats
	judge: RouterStats
	// Prompts where BOTH routers succeeded — the like-for-like denominator.
	bothOk: number
	// Fraction of both-ok prompts where the two routers picked the same label.
	routerAgreement: number
	speedUpFactor: number | null
	// Real routing spend. Jev is the free BeatAPI capability ($0); the judge
	// side is cost derived from NanoGPT token usage × the curated per-1M catalog.
	jevRoutingCostUsd: number
	judgeRoutingCostUsd: number
}

// --- Run history (GET /api/benchmark/runs) ---

// One row of the run-history list. Isomorphic (lives here, not in the
// server-only store) so the dashboard client and the store share one type.
// BigInt id and Dates are already serialized to strings at the store boundary.
export type RunSummary = {
	id: string
	label: string
	startedAt: string
	finishedAt: string | null
	concurrency: number
	judgeModel: string
	resultCount: number
}

export type ListRunsResponse = {
	runs: RunSummary[]
	// V14 M3: whether this list is the caller's own runs or, for a staff seat, every
	// run in the deployment. The dashboard labels the history with it.
	visibility: 'own' | 'all'
}

// --- SSE progress events (POST /api/benchmark streams these) ---

export type BenchmarkStartEvent = {
	type: 'start'
	runId: string
	total: number
	judgeModel: string
	concurrency: number
}

// Emitted before a throttle/backoff wait so the UI can say "waiting — Jev
// free-tier rate limit" instead of looking hung.
export type BenchmarkWaitEvent = {
	type: 'wait'
	promptId: string
	router: RouterName
	waitMs: number
	reason: string
}

// One per prompt, after both routers have answered (or failed) it.
export type BenchmarkProgressEvent = {
	type: 'progress'
	index: number
	total: number
	promptId: string
	category: string
	expected: ModelLabel
	jev: { ok: boolean; label?: ModelLabel; latencyMs?: number; error?: string }
	judge: { ok: boolean; label?: ModelLabel; latencyMs?: number; error?: string }
}

export type BenchmarkDoneEvent = {
	type: 'done'
	report: BenchmarkReport
}

export type BenchmarkErrorEvent = {
	type: 'error'
	message: string
}

export type BenchmarkStreamEvent =
	| BenchmarkStartEvent
	| BenchmarkWaitEvent
	| BenchmarkProgressEvent
	| BenchmarkDoneEvent
	| BenchmarkErrorEvent
