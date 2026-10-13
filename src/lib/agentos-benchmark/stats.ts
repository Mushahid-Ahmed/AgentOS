// Pure types + aggregation for the AgentOS four-setup benchmark (milestone 8,
// AGENTOS_UPGRADE_PROMPT §14). No React, no fetch, no 'server-only' — the server
// engine fills these rows from real runs and the dashboard reads the aggregated
// report, and the aggregation itself is unit-tested at $0.
//
// The four setups run the SAME tasks:
//   baseline_a — a single LLM, no retrieval.
//   baseline_b — the same single LLM given retrieved evidence (RAG), no agents.
//   baseline_c — a FIXED multi-agent workflow (same team every time) on the same
//                Orchestra engine, single model, no Jev routing / gates / replan.
//   agentos    — Jev planning + dynamic team + per-agent model routing + MCP tools
//                + RAG evidence hub + D4 verification gates + D5 replan.
// Every figure below is measured by the engine; nothing is assumed or hard-coded.

export const AGENTOS_BENCHMARK_SETUPS = [
	'baseline_a',
	'baseline_b',
	'baseline_c',
	'agentos'
] as const
export type AgentosSetup = (typeof AGENTOS_BENCHMARK_SETUPS)[number]

export const SETUP_LABELS: Record<AgentosSetup, string> = {
	baseline_a: 'A · single LLM',
	baseline_b: 'B · single LLM + RAG',
	baseline_c: 'C · fixed multi-agent',
	agentos: 'AgentOS'
}

// One task executed under one setup. `ok` means the setup produced an answer; a
// failed setup keeps its real error and zeroed counters rather than being dropped
// (an honest failure rate, mirroring the M4 benchmark's toRow).
export type SetupTaskResult = {
	taskId: string
	setup: AgentosSetup
	ok: boolean
	answer: string | null
	error: string | null
	// Distinct source URLs the setup actually retrieved/cited (0 for baseline_a).
	citations: number
	// Evidence-hub verification breakdown for setups that keep an evidence hub.
	verifiedClaims: number
	contestedClaims: number
	refutedClaims: number
	costMicroUsd: number
	latencyMs: number
	modelCalls: number
	toolCalls: number
	replans: number
}

// The LLM judge's per-(task,setup) verdict. The judge is from a different model
// family than the single-LLM generator where possible (§14); `unsupportedClaims`
// is the judge's estimate of claims in the answer with no supporting evidence and
// is labelled as judge-estimated wherever it is displayed.
export type JudgeVerdict = {
	taskId: string
	setup: AgentosSetup
	// 0..1 rubric score.
	score: number
	unsupportedClaims: number
	notes: string
	judgeModel: string
}

export type SetupSummary = {
	setup: AgentosSetup
	// Tasks that produced an answer / tasks attempted.
	successRate: number
	completed: number
	attempted: number
	// Mean judge score over the tasks that both ran AND were judged.
	meanJudgeScore: number | null
	judged: number
	// Judge-estimated unsupported claims per judged answer.
	meanUnsupportedClaims: number | null
	// Mean distinct citations per successful answer.
	meanCitations: number | null
	meanVerifiedClaims: number | null
	meanContestedClaims: number | null
	// Averages over successful runs only (a failed run has no meaningful latency).
	meanCostMicroUsd: number | null
	meanLatencyMs: number | null
	meanModelCalls: number | null
	meanToolCalls: number | null
	totalReplans: number
}

export type AgentosBenchmarkReport = {
	runId: string
	label: string
	judgeModel: string
	generatorModel: string
	startedAt: string
	finishedAt: string
	taskCount: number
	setups: SetupSummary[]
	// Head-to-head: for each task, which setup scored highest (ties listed).
	perTaskWinners: Array<{ taskId: string; winners: AgentosSetup[]; bestScore: number }>
	// How often AgentOS was (joint-)best vs never-best across judged tasks.
	agentosBestCount: number
	agentosNeverBestCount: number
}

function mean(values: number[]): number | null {
	if (values.length === 0) return null
	return values.reduce((a, b) => a + b, 0) / values.length
}

// Aggregate one setup's rows + verdicts into its summary. Rows and verdicts are
// matched by taskId; a row with no verdict simply doesn't contribute to the judge
// means (it still counts toward success rate and cost/latency).
export function summarizeSetup(
	setup: AgentosSetup,
	results: ReadonlyArray<SetupTaskResult>,
	verdicts: ReadonlyArray<JudgeVerdict>
): SetupSummary {
	const rows = results.filter((r) => r.setup === setup)
	const okRows = rows.filter((r) => r.ok)
	const verdictByTask = new Map(verdicts.filter((v) => v.setup === setup).map((v) => [v.taskId, v]))

	const judgedScores: number[] = []
	const judgedUnsupported: number[] = []
	for (const row of okRows) {
		const verdict = verdictByTask.get(row.taskId)
		if (verdict) {
			judgedScores.push(verdict.score)
			judgedUnsupported.push(verdict.unsupportedClaims)
		}
	}

	return {
		setup,
		successRate: rows.length > 0 ? okRows.length / rows.length : 0,
		completed: okRows.length,
		attempted: rows.length,
		meanJudgeScore: mean(judgedScores),
		judged: judgedScores.length,
		meanUnsupportedClaims: mean(judgedUnsupported),
		meanCitations: mean(okRows.map((r) => r.citations)),
		meanVerifiedClaims: mean(okRows.map((r) => r.verifiedClaims)),
		meanContestedClaims: mean(okRows.map((r) => r.contestedClaims)),
		meanCostMicroUsd: mean(okRows.map((r) => r.costMicroUsd)),
		meanLatencyMs: mean(okRows.map((r) => r.latencyMs)),
		meanModelCalls: mean(okRows.map((r) => r.modelCalls)),
		meanToolCalls: mean(okRows.map((r) => r.toolCalls)),
		totalReplans: okRows.reduce((acc, r) => acc + r.replans, 0)
	}
}

// Build the full report. Per-task winners consider only setups that were both
// successful and judged for that task; a task with no judged successful row
// contributes no winner.
export function buildAgentosBenchmarkReport(
	meta: {
		runId: string
		label: string
		judgeModel: string
		generatorModel: string
		startedAt: string
		finishedAt: string
		taskCount: number
	},
	results: ReadonlyArray<SetupTaskResult>,
	verdicts: ReadonlyArray<JudgeVerdict>
): AgentosBenchmarkReport {
	const setups = AGENTOS_BENCHMARK_SETUPS.map((s) => summarizeSetup(s, results, verdicts))

	const taskIds = [...new Set(results.map((r) => r.taskId))]
	const perTaskWinners: AgentosBenchmarkReport['perTaskWinners'] = []
	let agentosBestCount = 0
	let agentosNeverBestCount = 0

	for (const taskId of taskIds) {
		const scored = AGENTOS_BENCHMARK_SETUPS.map((setup) => {
			const row = results.find((r) => r.taskId === taskId && r.setup === setup && r.ok)
			const verdict = verdicts.find((v) => v.taskId === taskId && v.setup === setup)
			if (!row || !verdict) return null
			return { setup, score: verdict.score }
		}).filter((x): x is { setup: AgentosSetup; score: number } => x !== null)
		if (scored.length === 0) continue

		const bestScore = Math.max(...scored.map((s) => s.score))
		const winners = scored.filter((s) => s.score === bestScore).map((s) => s.setup)
		perTaskWinners.push({ taskId, winners, bestScore })
		if (winners.includes('agentos')) agentosBestCount += 1
		else agentosNeverBestCount += 1
	}

	return {
		...meta,
		setups,
		perTaskWinners,
		agentosBestCount,
		agentosNeverBestCount
	}
}

// Display helpers — honest formatting, never inventing precision.
export function formatScore(score: number | null): string {
	if (score == null || !Number.isFinite(score)) return 'n/a'
	return score.toFixed(2)
}

export function formatRate(fraction: number | null): string {
	if (fraction == null || !Number.isFinite(fraction)) return 'n/a'
	return `${Math.round(fraction * 100)}%`
}
