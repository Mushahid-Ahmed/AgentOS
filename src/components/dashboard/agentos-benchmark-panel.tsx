'use client'
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertIcon, InfoIcon, SpinnerIcon } from '@/components/ui/icons'
import { SkeletonBlock } from '@/components/ui/skeleton'
import { Magnetic } from '@/components/motion/magnetic'
import {
	SETUP_LABELS,
	formatRate,
	formatScore,
	type AgentosBenchmarkReport,
	type SetupSummary
} from '@/lib/agentos-benchmark/stats'
import type { AgentosBenchmarkSetupOutcome } from '@/lib/agentos-benchmark/wire'
import { cn } from '@/lib/cn'
import {
	AGENTOS_BENCHMARK_RUNS_QUERY_KEY,
	useAgentosBenchmarkRuns,
	useAgentosRunReport
} from './use-agentos-benchmark-data'
import { useAgentosBenchmarkRun, type AgentosBenchmarkMode } from './use-agentos-benchmark-run'
import { SPEND_QUERY_KEY } from './use-spend'

// The AgentOS four-setup benchmark panel (milestone 8, AGENTOS_UPGRADE_PROMPT §14).
// It runs the SAME tasks through four setups — A single LLM, B single LLM + RAG,
// C a fixed multi-agent DAG, and the full AgentOS pipeline — grades every answer with
// the gpt-4.1 rubric judge, and shows the measured comparison. Every figure is a real
// measurement from a real run; empty states say "no data yet" rather than inventing a
// number, and the "where AgentOS did NOT win" section is shown deliberately, not hidden.

function fmtUsdMicro(micro: number | null): string {
	if (micro == null || !Number.isFinite(micro)) return '—'
	return `$${(micro / 1_000_000).toFixed(4)}`
}

function fmtMs(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—'
	if (value < 1000) return `${Math.round(value)}ms`
	return `${(value / 1000).toFixed(1)}s`
}

function fmtNum(value: number | null, digits = 1): string {
	if (value == null || !Number.isFinite(value)) return '—'
	return value.toFixed(digits)
}

const COLUMNS = [
	'Setup',
	'Success',
	'Judge score',
	'Unsup. claims',
	'Citations',
	'Verified',
	'Mean cost',
	'Mean latency',
	'Calls (m/t)',
	'Replans'
] as const

function SetupTable({ report }: { report: AgentosBenchmarkReport }) {
	return (
		<div className="-mx-1 overflow-x-auto px-1">
			<table className="w-full min-w-[720px] border-collapse text-sm">
				<caption className="sr-only">
					Measured per-setup comparison: success rate, mean judge score, judge-estimated unsupported
					claims, citations, verified claims, mean cost, mean latency, model and tool calls, and
					replans for each of the four setups.
				</caption>
				<thead>
					<tr className="border-border text-text-muted border-b text-left text-xs tracking-wide uppercase">
						{COLUMNS.map((col) => (
							<th key={col} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
								{col}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{report.setups.map((s: SetupSummary) => {
						const isAgentos = s.setup === 'agentos'
						return (
							<tr
								key={s.setup}
								className={cn(
									'border-border/60 border-b last:border-0',
									isAgentos && 'bg-accent/5'
								)}
							>
								<th scope="row" className="px-2 py-2 text-left font-medium whitespace-nowrap">
									<span className={cn(isAgentos && 'text-accent')}>{SETUP_LABELS[s.setup]}</span>
									<span className="text-text-faint ml-1 text-xs">
										({s.completed}/{s.attempted})
									</span>
								</th>
								<td className="px-2 py-2 font-mono tabular-nums">{formatRate(s.successRate)}</td>
								<td className="px-2 py-2 font-mono tabular-nums">
									{formatScore(s.meanJudgeScore)}
									<span className="text-text-faint ml-1 text-xs">n={s.judged}</span>
								</td>
								<td className="px-2 py-2 font-mono tabular-nums">
									{fmtNum(s.meanUnsupportedClaims, 2)}
								</td>
								<td className="px-2 py-2 font-mono tabular-nums">{fmtNum(s.meanCitations, 2)}</td>
								<td className="px-2 py-2 font-mono tabular-nums">
									{fmtNum(s.meanVerifiedClaims, 2)}
								</td>
								<td className="px-2 py-2 font-mono tabular-nums">
									{fmtUsdMicro(s.meanCostMicroUsd)}
								</td>
								<td className="px-2 py-2 font-mono tabular-nums">{fmtMs(s.meanLatencyMs)}</td>
								<td className="px-2 py-2 font-mono whitespace-nowrap tabular-nums">
									{fmtNum(s.meanModelCalls, 1)}/{fmtNum(s.meanToolCalls, 1)}
								</td>
								<td className="px-2 py-2 font-mono tabular-nums">{s.totalReplans}</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

function OutcomeChip({ outcome }: { outcome: AgentosBenchmarkSetupOutcome }) {
	const short = outcome.setup === 'agentos' ? 'AgentOS' : outcome.setup.replace('baseline_', '')
	if (!outcome.ok) {
		return (
			<Badge variant="danger" className="whitespace-nowrap">
				{short}: failed
			</Badge>
		)
	}
	return (
		<Badge variant="secondary" className="font-mono whitespace-nowrap tabular-nums">
			{short}: {formatScore(outcome.score)} · {fmtUsdMicro(outcome.costMicroUsd)} ·{' '}
			{fmtMs(outcome.latencyMs)}
		</Badge>
	)
}

function WinnersList({ report }: { report: AgentosBenchmarkReport }) {
	const neverBest = report.perTaskWinners.filter((w) => !w.winners.includes('agentos'))
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<Badge variant="success">AgentOS (joint-)best on {report.agentosBestCount}</Badge>
				<Badge variant={neverBest.length > 0 ? 'warning' : 'secondary'}>
					Never best on {report.agentosNeverBestCount}
				</Badge>
			</div>

			<div>
				<p className="text-text-muted mb-1 text-xs font-medium tracking-wide uppercase">
					Per-task winners (highest judge score; ties listed)
				</p>
				{report.perTaskWinners.length === 0 ? (
					<p className="text-text-faint text-sm">No task was both completed and judged.</p>
				) : (
					<ul className="flex flex-col gap-1">
						{report.perTaskWinners.map((w) => (
							<li key={w.taskId} className="flex items-baseline gap-2 text-sm">
								<span className="font-mono text-xs tabular-nums">{w.taskId}</span>
								<span className="text-text-faint font-mono text-xs">
									best {formatScore(w.bestScore)}
								</span>
								<span className="text-text-muted truncate">
									→ {w.winners.map((s) => SETUP_LABELS[s]).join(' + ')}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>

			{/* Shown deliberately: where the full pipeline did NOT beat a cheaper baseline.
			    §14 — report the losses honestly, not just the wins. */}
			<div className="border-border border-t pt-3">
				<p className="text-text-muted mb-1 text-xs font-medium tracking-wide uppercase">
					Where AgentOS did NOT win
				</p>
				{neverBest.length === 0 ? (
					<p className="text-text-faint text-sm">
						AgentOS was (joint-)best on every judged task in this run.
					</p>
				) : (
					<ul className="flex flex-col gap-1">
						{neverBest.map((w) => (
							<li key={w.taskId} className="flex items-baseline gap-2 text-sm">
								<span className="font-mono text-xs tabular-nums">{w.taskId}</span>
								<span className="text-text-muted truncate">
									lost to {w.winners.map((s) => SETUP_LABELS[s]).join(' + ')} (
									{formatScore(w.bestScore)})
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}

const METHODOLOGY = [
	'All four setups run the SAME tasks. A = one gemini-2.5-flash call, no retrieval. B = research-sonar retrieval, then one gemini-2.5-flash call over it. C = a FIXED researcher→critic→synthesizer DAG on the real Orchestra engine, all gemini, no Jev routing / gates / replan. AgentOS = the full production pipeline (Jev planning, dynamic team, per-agent model routing, MCP tools, RAG evidence hub, D4 gates, D5 replan), consumed in-process and folded through the same reducer the run view uses.',
	'Every answer is graded by a gpt-4.1 rubric judge — a different model family from the gemini generator — against each task\'s fixed rubric. "Unsup. claims" is the JUDGE\'S ESTIMATE of claims with no supporting evidence, not a ground-truth count.',
	'Cost, latency, model/tool calls and replans are measured per run, never estimated. Spend is capped (§12): a run stops honestly at the benchmark cap or the nightly cap rather than overspending.'
]

const LIMITATIONS = [
	'A pilot is only 3 tasks — directional, not statistically strong. Run the full 24 for a firmer picture.',
	'Baselines A/B/C all run on one gemini generator, so the comparison isolates scaffolding, not model quality.',
	"The very first call of a run bears a one-time connection cold start that slightly inflates baseline A's mean latency; it washes out over more tasks.",
	'AgentOS does more work per task (planning, gates, possible replans), so it usually costs more — the table shows that real cost rather than hiding it.'
]

export function AgentosBenchmarkPanel() {
	const queryClient = useQueryClient()
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

	const runsQuery = useAgentosBenchmarkRuns()

	const handleDone = useCallback(
		(report: AgentosBenchmarkReport) => {
			setSelectedRunId(report.runId)
			void queryClient.invalidateQueries({ queryKey: AGENTOS_BENCHMARK_RUNS_QUERY_KEY })
			// The run just spent real money on the funded key — refresh the Spend and
			// Model-usage views so their totals pick it up without a manual reload.
			void queryClient.invalidateQueries({ queryKey: SPEND_QUERY_KEY })
		},
		[queryClient]
	)

	const run = useAgentosBenchmarkRun({ onDone: handleDone })

	const runs = runsQuery.data?.runs ?? []
	const latestRunId = runs[0]?.id ?? null
	const effectiveRunId = selectedRunId ?? latestRunId
	const reportQuery = useAgentosRunReport(effectiveRunId)
	const report =
		run.report && run.report.runId === effectiveRunId ? run.report : (reportQuery.data ?? null)

	const progressPct =
		run.total > 0 ? Math.min(100, Math.round((run.completed / run.total) * 100)) : 0
	// Spend meter against the cap the server is enforcing this run.
	const spendPct =
		run.capUsd > 0 ? Math.min(100, (run.spentMicroUsd / 1_000_000 / run.capUsd) * 100) : 0

	const startRun = (mode: AgentosBenchmarkMode) => run.start(mode)

	return (
		<section aria-label="AgentOS four-setup benchmark" className="flex flex-col gap-6">
			{/* Run control + live progress */}
			<div className="grid gap-6 lg:grid-cols-3">
				<Card className="lg:col-span-1">
					<CardHeader>
						<CardTitle>Run four-setup benchmark</CardTitle>
						<CardDescription>
							Same tasks through A (single LLM), B (+RAG), C (fixed multi-agent) and the full
							AgentOS pipeline, each graded by the{' '}
							<code className="font-mono text-xs">gpt-4.1</code> rubric judge. Pilot = 3 tasks; full
							= all 24.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<Magnetic>
								<Button onClick={() => startRun('pilot')} disabled={run.isRunning}>
									{run.isRunning && run.mode === 'pilot' ? <SpinnerIcon size={16} /> : null}
									{run.isRunning && run.mode === 'pilot' ? 'Running pilot…' : 'Run pilot (3)'}
								</Button>
							</Magnetic>
							<Button variant="outline" onClick={() => startRun('full')} disabled={run.isRunning}>
								{run.isRunning && run.mode === 'full' ? <SpinnerIcon size={16} /> : null}
								{run.isRunning && run.mode === 'full' ? 'Running full…' : 'Run full (24)'}
							</Button>
							{run.isRunning ? (
								<Button variant="ghost" onClick={run.cancel}>
									Cancel
								</Button>
							) : null}
						</div>

						{run.isRunning ? (
							<div className="flex flex-col gap-2">
								<div className="flex items-center justify-between text-xs">
									<span className="text-text-muted">
										Task {run.completed} of {run.total || '…'}
									</span>
									<span className="text-text-faint font-mono tabular-nums">{progressPct}%</span>
								</div>
								<span
									className="bg-surface-hover h-2 w-full overflow-hidden rounded-full"
									role="progressbar"
									aria-valuenow={run.completed}
									aria-valuemin={0}
									aria-valuemax={run.total || 0}
									aria-label="Benchmark task progress"
								>
									<span
										className="bg-accent block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
										style={{ width: `${progressPct}%` }}
									/>
								</span>

								<div className="flex items-center justify-between text-xs">
									<span className="text-text-muted">
										Spent {fmtUsdMicro(run.spentMicroUsd)}
										{run.capUsd > 0 ? ` of $${run.capUsd.toFixed(2)} cap` : ''}
									</span>
									<span className="text-text-faint font-mono tabular-nums">
										{Math.round(spendPct)}%
									</span>
								</div>
								<span
									className="bg-surface-hover h-1.5 w-full overflow-hidden rounded-full"
									role="progressbar"
									aria-valuenow={Math.round(spendPct)}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-label="Spend against cap"
								>
									<span
										className={cn(
											'block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
											spendPct > 85 ? 'bg-warning' : 'bg-success'
										)}
										style={{ width: `${spendPct}%` }}
									/>
								</span>

								{run.currentTaskId ? (
									<p className="text-text-faint text-xs">
										Running {run.currentTaskId}
										{run.currentCategory ? ` · ${run.currentCategory}` : ''}
									</p>
								) : null}
								{run.lastOutcomes.length > 0 ? (
									<div className="flex flex-wrap gap-1.5" aria-label="Last task setup outcomes">
										{run.lastOutcomes.map((o) => (
											<OutcomeChip key={o.setup} outcome={o} />
										))}
									</div>
								) : null}
							</div>
						) : null}

						{run.error ? (
							<div className="border-danger/40 bg-danger/10 text-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
								<AlertIcon size={16} className="mt-0.5 shrink-0" />
								<span className="break-words">
									{run.errorCode === 'nightly_cap'
										? `Nightly spend cap reached — ${run.error}`
										: run.error}
								</span>
							</div>
						) : null}
					</CardContent>
				</Card>

				{/* Methodology + limitations */}
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Methodology &amp; limitations</CardTitle>
						<CardDescription>
							What is measured, how, and what the numbers do not claim.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<div>
							<p className="text-text-muted mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
								<InfoIcon size={14} /> Methodology
							</p>
							<ul className="text-text-muted flex list-disc flex-col gap-1.5 pl-5 text-sm">
								{METHODOLOGY.map((line) => (
									<li key={line.slice(0, 24)}>{line}</li>
								))}
							</ul>
						</div>
						<div className="border-border border-t pt-3">
							<p className="text-text-muted mb-1 text-xs font-medium tracking-wide uppercase">
								Limitations (stated honestly)
							</p>
							<ul className="text-text-faint flex list-disc flex-col gap-1.5 pl-5 text-sm">
								{LIMITATIONS.map((line) => (
									<li key={line.slice(0, 24)}>{line}</li>
								))}
							</ul>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Results */}
			<Card>
				<CardHeader>
					<CardTitle>Four-setup comparison</CardTitle>
					<CardDescription>
						{report
							? `Run #${report.runId} · ${report.taskCount} task(s) · generator ${report.generatorModel} · judge ${report.judgeModel}`
							: 'Measured per-setup results from a stored benchmark run.'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{report ? (
						<div className="flex flex-col gap-6">
							<SetupTable report={report} />
							<div className="border-border border-t pt-4">
								<WinnersList report={report} />
							</div>
						</div>
					) : reportQuery.isLoading || runsQuery.isLoading ? (
						<SkeletonBlock lines={5} label="Loading benchmark…" />
					) : (
						<p className="text-text-faint text-sm">
							No AgentOS benchmark runs yet. Run a pilot to compare the full pipeline against the
							single-LLM, RAG and fixed-multi-agent baselines — every figure here is measured, never
							assumed.
						</p>
					)}
				</CardContent>
			</Card>

			{/* Run history */}
			<Card>
				<CardHeader>
					<CardTitle>Benchmark run history</CardTitle>
					<CardDescription>
						Stored four-setup runs, newest first. Select one to load its report above.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{runsQuery.isLoading ? (
						<SkeletonBlock lines={5} label="Loading runs…" />
					) : runs.length === 0 ? (
						<p className="text-text-faint text-sm">No runs stored yet.</p>
					) : (
						<ul className="flex flex-col gap-1">
							{runs.map((entry) => {
								const active = entry.id === effectiveRunId
								return (
									<li key={entry.id}>
										<button
											type="button"
											onClick={() => setSelectedRunId(entry.id)}
											aria-current={active ? 'true' : undefined}
											className={cn(
												'focus-visible:outline-accent flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2',
												active
													? 'bg-surface-hover text-text'
													: 'text-text-muted hover:bg-surface-hover hover:text-text'
											)}
										>
											<span className="font-mono text-xs tabular-nums">#{entry.id}</span>
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{entry.label}
											</span>
											{entry.pilot ? <Badge variant="secondary">pilot</Badge> : null}
											<Badge
												variant={
													entry.status === 'completed'
														? 'success'
														: entry.status === 'budget_stopped'
															? 'warning'
															: entry.status === 'failed'
																? 'danger'
																: 'secondary'
												}
											>
												{entry.status}
											</Badge>
											<span className="text-text-faint shrink-0 text-xs">
												{entry.taskCount} tasks · {entry.resultCount} rows
											</span>
										</button>
									</li>
								)
							})}
						</ul>
					)}
				</CardContent>
			</Card>
		</section>
	)
}
