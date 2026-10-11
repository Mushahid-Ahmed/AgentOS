// Shared, isomorphic types for the AgentOS four-setup benchmark (milestone 8,
// AGENTOS_UPGRADE_PROMPT §14). No 'server-only': the SSE progress-event shapes and
// the run-history/report contract are consumed by the dashboard client as well as
// the server engine, so they live in src/lib next to the M4 benchmark.ts contract.
// Nothing here is secret — it is the wire agreement between the engine, the stored
// rows, and the charts. The aggregated report types live in ./stats (pure + tested).

import type { AgentosBenchmarkReport, AgentosSetup } from './stats'

// --- SSE progress events (POST /api/agentos-benchmark streams these) ---------

export type AgentosBenchmarkStartEvent = {
	type: 'start'
	runId: string
	// Tasks this run will execute (a pilot is a small subset of the 24-task set).
	taskCount: number
	setups: AgentosSetup[]
	judgeModel: string
	// The single LLM the three baselines (A/B/C) run on, so the comparison is
	// provably like-for-like and reproducible.
	generatorModel: string
	pilot: boolean
	// The spend ceiling this run is enforcing (§12 BENCHMARK_CAP_USD), in USD.
	capUsd: number
}

// One setup's measured outcome for a single task, streamed as soon as the task's
// four setups + judge have all finished. `score` is the judge's 0..1 rubric score
// (null when the setup failed and was not judged).
export type AgentosBenchmarkSetupOutcome = {
	setup: AgentosSetup
	ok: boolean
	score: number | null
	costMicroUsd: number | null
	latencyMs: number
	error: string | null
}

export type AgentosBenchmarkProgressEvent = {
	type: 'progress'
	// 1-based count of tasks fully completed (all setups + judge).
	index: number
	total: number
	taskId: string
	category: string
	outcomes: AgentosBenchmarkSetupOutcome[]
	// Cumulative REAL spend so far this run (setups + judge), integer millionths of
	// a USD — streamed so the UI shows the cap being respected, never exceeded.
	spentMicroUsd: number
}

export type AgentosBenchmarkDoneEvent = {
	type: 'done'
	report: AgentosBenchmarkReport
}

// Keep-alive emitted before each setup starts, so the SSE socket never goes silent
// for a whole task. A single task runs four setups + a judge hop sequentially and only
// the `progress` event marks its end — under a slow Setup D (full AgentOS, ~2 min) plus
// judge retries the gap between `progress` frames can exceed a Node/undici client's
// default 300s body timeout and abort the connection mid-run. One heartbeat per setup
// bounds that silence to a single setup. Both consumers ignore it: the CLI switch has a
// `default: break`, and the browser's stream switch only acts on the types it knows.
export type AgentosBenchmarkHeartbeatEvent = {
	type: 'heartbeat'
	// 1-based index of the task currently executing.
	index: number
	total: number
	taskId: string
	// The setup about to run, so a watching client can show live sub-task progress.
	setup: AgentosSetup
}

export type AgentosBenchmarkErrorEvent = {
	type: 'error'
	message: string
	// 'nightly_cap' | 'benchmark_cap' | 'internal' — lets the client distinguish a
	// honest spend-cap stop from a crash.
	code?: string
}

export type AgentosBenchmarkStreamEvent =
	| AgentosBenchmarkStartEvent
	| AgentosBenchmarkProgressEvent
	| AgentosBenchmarkHeartbeatEvent
	| AgentosBenchmarkDoneEvent
	| AgentosBenchmarkErrorEvent

// --- Run history (GET /api/agentos-benchmark/runs) --------------------------

// One row of the run-history list. BigInt id and Dates are already serialized to
// strings at the store boundary, exactly as the M4 RunSummary is.
export type AgentosBenchmarkRunSummary = {
	id: string
	label: string
	startedAt: string
	finishedAt: string | null
	status: string
	judgeModel: string
	generatorModel: string
	taskCount: number
	pilot: boolean
	resultCount: number
}

export type ListAgentosBenchmarkRunsResponse = {
	runs: AgentosBenchmarkRunSummary[]
}
