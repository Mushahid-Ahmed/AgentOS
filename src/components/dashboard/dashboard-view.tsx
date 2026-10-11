'use client'
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertIcon, SpinnerIcon } from '@/components/ui/icons'
import { MODELS } from '@/lib/models'
import type { BenchmarkReport } from '@/lib/benchmark'
import { AppHeader } from '@/components/nav/app-header'
import { Sheen } from '@/components/motion/sheen'
import { Magnetic } from '@/components/motion/magnetic'
import { CountUp } from '@/components/motion/reveal'
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton'
import { BarChart, Donut, LatencyGauge, Sparkline, type DonutSlice } from './charts'
import {
	BENCHMARK_RUNS_QUERY_KEY,
	DASHBOARD_QUERY_KEY,
	useBenchmarkRuns,
	useDashboardStats,
	useRunReport
} from './use-dashboard-data'
import { useBenchmarkRun } from './use-benchmark-run'
import { AgentosBenchmarkPanel } from './agentos-benchmark-panel'
import { SpendPanel } from './spend-panel'
import { ModelUsagePanel } from './model-usage-panel'
import { useSpendAndUsage, SPEND_QUERY_KEY } from './use-spend'
import { PoolHealthPanel } from './pool-health-panel'
import { cn } from '@/lib/cn'

// The executive dashboard view (milestone 5). Every figure is a real measurement:
// the cumulative cards, gauge, sparkline and donut come from persisted
// route_events (GET /api/dashboard); the Jev-vs-judge latency bars, accuracy,
// agreement and cost come from a stored benchmark run (GET /api/benchmark/runs/[id]).
// Nothing is invented or hard-coded — empty states say "no data yet" rather than
// showing a fabricated number (docs/jev-integration-notes.md §4).

function formatPct(fraction: number): string {
	return `${Math.round(fraction * 100)}%`
}

function formatUsd(usd: number): string {
	if (usd === 0) return '$0'
	return `$${usd.toFixed(6)}`
}

function relativeTime(iso: string): string {
	const then = new Date(iso).getTime()
	if (Number.isNaN(then)) return ''
	const seconds = Math.round((Date.now() - then) / 1000)
	if (seconds < 60) return 'just now'
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.round(hours / 24)
	if (days < 7) return `${days}d ago`
	return new Date(iso).toLocaleDateString()
}

function StatCard({
	label,
	value,
	unit,
	hint,
	index
}: {
	label: string
	value: React.ReactNode
	unit?: string
	hint?: string
	index: number
}) {
	return (
		<Card className="card-lift panel-in p-4" style={{ '--i': index } as React.CSSProperties}>
			<p className="label-uppercase text-text-faint">{label}</p>
			{/* A <div> while loading, so the value slot can hold a skeleton block
			    without putting one inside a <p> (validateDOMNesting). */}
			<div className="text-text font-numeric mt-3 text-3xl leading-none font-semibold">
				{value}
				{unit ? <span className="text-text-muted ml-1 text-sm font-normal">{unit}</span> : null}
			</div>
			{hint ? <p className="text-text-muted mt-3 text-xs">{hint}</p> : null}
		</Card>
	)
}

function ReportBars({ report }: { report: BenchmarkReport }) {
	return (
		<BarChart
			label="Jev versus judge routing latency, median and 95th percentile, in milliseconds"
			series={[
				{
					name: 'Jev',
					colorClass: 'text-accent',
					values: [
						{ label: 'p50', value: report.jev.latency.p50 },
						{ label: 'p95', value: report.jev.latency.p95 }
					]
				},
				{
					name: `Judge (${report.judgeModel})`,
					colorClass: 'text-success',
					values: [
						{ label: 'p50', value: report.judge.latency.p50 },
						{ label: 'p95', value: report.judge.latency.p95 }
					]
				}
			]}
		/>
	)
}

function ComparisonRow({ label, jev, judge }: { label: string; jev: string; judge: string }) {
	return (
		<div className="flex items-center justify-between gap-3 py-1.5">
			<span className="text-text-muted text-sm">{label}</span>
			<span className="font-numeric flex items-center gap-3 text-sm">
				<span className="text-accent">{jev}</span>
				<span className="text-text-faint">vs</span>
				<span className="text-success">{judge}</span>
			</span>
		</div>
	)
}

export function DashboardView() {
	const queryClient = useQueryClient()
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

	const statsQuery = useDashboardStats()
	const runsQuery = useBenchmarkRuns()
	const spendQuery = useSpendAndUsage()

	const handleRunDone = useCallback(
		(report: BenchmarkReport) => {
			// Select the just-finished run so its fresh report charts immediately,
			// then refresh the history list and the cumulative route_events stats.
			setSelectedRunId(report.runId)
			void queryClient.invalidateQueries({ queryKey: BENCHMARK_RUNS_QUERY_KEY })
			void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY })
			// A finished run spent real money and made real calls — refresh the Spend and
			// Model-usage views so their totals reflect it without a manual reload.
			void queryClient.invalidateQueries({ queryKey: SPEND_QUERY_KEY })
		},
		[queryClient]
	)

	const run = useBenchmarkRun({ onDone: handleRunDone })

	const runs = runsQuery.data?.runs ?? []
	const latestRunId = runs[0]?.id ?? null

	const effectiveRunId = selectedRunId ?? latestRunId
	const reportQuery = useRunReport(effectiveRunId)
	const report =
		run.report && run.report.runId === effectiveRunId ? run.report : (reportQuery.data ?? null)

	const stats = statsQuery.data ?? null
	const hasTurns = (stats?.totalTurns ?? 0) > 0

	// Axis ceiling adapts to the slowest observed Jev hop, floored at 1s so a
	// fast cluster still reads against a meaningful scale. A display bound, not a
	// measurement.
	const gaugeMax = Math.max(1000, Math.ceil((stats?.maxJevLatencyMs ?? 0) / 500) * 500)
	// recent is newest-first; the sparkline reads oldest -> newest.
	const sparkValues = stats ? [...stats.recent].reverse().map((turn) => turn.jevLatencyMs) : []
	const donutSlices: DonutSlice[] = stats
		? stats.modelDistribution.map((slice) => ({
				label: MODELS[slice.label].shortName,
				count: slice.count,
				share: slice.share,
				color: MODELS[slice.label].color
			}))
		: []

	const progressPct =
		run.total > 0 ? Math.min(100, Math.round((run.completed / run.total) * 100)) : 0

	return (
		<div className="bg-bg text-text flex h-dvh flex-col">
			<AppHeader title="Executive dashboard" subtitle="real measured routing telemetry" />

			<main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
					{/* Masthead — the dashboard's answer to the landing hero: the same
					    display voice and the same quiet accent field, at product scale.
					    A statement, not a repeat of the header's <h1>. It is an <h2>
					    because every card title below is an <h3>, and axe reports a
					    skipped level as a heading-order failure. `overflow-hidden`
					    is load-bearing: the aurora is inset -18%, and <main> scrolls on
					    both axes, so an unclipped field adds page-width of scroll. */}
					<section aria-label="About this dashboard" className="panel-in relative overflow-hidden">
						<div className="app-aurora" aria-hidden="true" />
						<p className="label-uppercase text-text-faint relative">AgentOS · routing telemetry</p>
						<h2 className="app-masthead text-text relative mt-2">Every number here is measured.</h2>
						<p className="text-text-muted relative mt-3 max-w-xl text-sm leading-relaxed">
							Routing decisions, latency and cost are read back from the persisted event ledger and
							stored benchmark runs. Nothing on this page is simulated, sampled or assumed.
						</p>
					</section>

					{statsQuery.isError ? (
						<div className="border-danger/40 bg-danger/10 text-danger flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
							<AlertIcon size={16} className="shrink-0" />
							<span className="flex-1 break-words">
								{statsQuery.error instanceof Error
									? statsQuery.error.message
									: 'Could not load dashboard stats.'}
							</span>
							<Button variant="outline" size="sm" onClick={() => statsQuery.refetch()}>
								Try again
							</Button>
						</div>
					) : null}

					{/* Cumulative stats */}
					<section
						aria-label="Cumulative routing statistics"
						className="grid grid-cols-2 gap-4 lg:grid-cols-4"
					>
						<StatCard
							index={1}
							label="Queries routed"
							value={stats ? <CountUp to={stats.totalTurns} /> : <Skeleton className="h-8 w-12" />}
							hint={
								stats && hasTurns
									? `${stats.pricedTurns} priced from the curated NanoGPT table`
									: 'no chat turns yet'
							}
						/>
						<StatCard
							index={2}
							label="Avg Jev latency"
							value={
								hasTurns ? (
									<CountUp to={stats?.avgJevLatencyMs ?? 0} />
								) : (
									<span aria-hidden="true">—</span>
								)
							}
							unit={hasTurns ? 'ms' : undefined}
							hint={
								hasTurns
									? `min ${stats?.minJevLatencyMs ?? 0} · max ${stats?.maxJevLatencyMs ?? 0} ms`
									: 'the Jev routing hop only'
							}
						/>
						<StatCard
							index={3}
							label="Measured speed-up"
							value={
								report?.speedUpFactor != null ? (
									<CountUp to={report.speedUpFactor} decimals={1} />
								) : (
									<span aria-hidden="true">—</span>
								)
							}
							unit={report?.speedUpFactor != null ? '× vs judge' : undefined}
							hint={report ? `judge p50 ÷ Jev p50 · run #${report.runId}` : 'run a benchmark'}
						/>
						<StatCard
							index={4}
							label="Fallback rate"
							value={
								hasTurns ? (
									<CountUp to={Math.round((stats?.fallbackRate ?? 0) * 100)} suffix="%" />
								) : (
									<span aria-hidden="true">—</span>
								)
							}
							hint={
								hasTurns
									? `${stats?.fallbackCount ?? 0} of ${stats?.totalTurns ?? 0} turns fell back`
									: 'Jev errored → default model'
							}
						/>
					</section>

					{/* Live gauge + distribution */}
					<section
						aria-label="Live latency and routing distribution"
						className="panel-in grid gap-6 lg:grid-cols-2"
						style={{ '--i': 5 } as React.CSSProperties}
					>
						<Sheen>
							<Card>
								<CardHeader>
									<CardTitle>Live Jev latency</CardTitle>
									<CardDescription>
										The most recent routing decision&apos;s Jev hop, against the slowest observed so
										far.
									</CardDescription>
								</CardHeader>
								<CardContent className="flex flex-col gap-4">
									<LatencyGauge
										valueMs={stats?.latestJevLatencyMs ?? null}
										maxMs={gaugeMax}
										label="Live Jev routing latency gauge"
									/>
									<div>
										<p className="label-uppercase text-text-faint mb-2">Recent turns</p>
										<Sparkline values={sparkValues} label="Jev latency across recent turns" />
									</div>
								</CardContent>
							</Card>
						</Sheen>

						<Card>
							<CardHeader>
								<CardTitle>Routing distribution</CardTitle>
								<CardDescription>
									Which model Jev chose, across every persisted chat turn.
								</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-center">
								<Donut
									slices={donutSlices}
									total={stats?.totalTurns ?? 0}
									label="Routing distribution by model"
								/>
								<ul className="flex flex-col gap-2">
									{donutSlices.map((slice) => (
										<li key={slice.label} className="flex items-center gap-2 text-sm">
											<span
												className="h-3 w-3 shrink-0 rounded-full"
												style={{ backgroundColor: slice.color }}
												aria-hidden="true"
											/>
											<span className="text-text w-16">{slice.label}</span>
											<span className="text-text-muted font-numeric tabular-nums">
												{slice.count} · {formatPct(slice.share)}
											</span>
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					</section>

					{/* Benchmark: run control + report */}
					<section
						aria-label="Benchmark"
						className="panel-in grid gap-6 lg:grid-cols-3"
						style={{ '--i': 6 } as React.CSSProperties}
					>
						<Card className="card-lift lg:col-span-1">
							<CardHeader>
								<CardTitle>Run benchmark</CardTitle>
								<CardDescription>
									Route the full labelled dataset through Jev and the{' '}
									<code className="font-mono text-xs">gpt-4.1-nano</code> judge baseline.
									Concurrency 1, honoring the free-tier throttle — waits are excluded from measured
									latency.
								</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								<div className="flex items-center gap-2">
									<Magnetic>
										<Button onClick={run.start} disabled={run.isRunning}>
											{run.isRunning ? <SpinnerIcon size={16} /> : null}
											{run.isRunning ? 'Running…' : 'Run benchmark'}
										</Button>
									</Magnetic>
									{run.isRunning ? (
										<Button variant="outline" onClick={run.cancel}>
											Cancel
										</Button>
									) : null}
								</div>

								{run.isRunning ? (
									<div className="flex flex-col gap-2">
										<div className="flex items-center justify-between text-xs">
											<span className="text-text-muted">
												Routed {run.completed} of {run.total || '…'}
											</span>
											<span className="text-text-faint font-numeric">{progressPct}%</span>
										</div>
										<span
											className="bg-surface-hover h-2 w-full overflow-hidden rounded-full"
											role="progressbar"
											aria-valuenow={run.completed}
											aria-valuemin={0}
											aria-valuemax={run.total || 0}
											aria-label="Benchmark progress"
										>
											<span
												className="bg-accent block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
												style={{ width: `${progressPct}%` }}
											/>
										</span>
										{run.currentPromptId ? (
											<p className="text-text-faint text-xs">
												Measuring {run.currentPromptId}
												{run.currentCategory ? ` · ${run.currentCategory}` : ''}
											</p>
										) : null}
									</div>
								) : null}

								{run.waitNotice ? (
									<Badge variant="warning" className="justify-start text-left whitespace-normal">
										{run.waitNotice}
									</Badge>
								) : null}

								{run.error ? (
									<div className="border-danger/40 bg-danger/10 text-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
										<AlertIcon size={16} className="mt-0.5 shrink-0" />
										<span className="break-words">{run.error}</span>
									</div>
								) : null}
							</CardContent>
						</Card>

						<Card className="card-lift lg:col-span-2">
							<CardHeader>
								<CardTitle>Jev vs judge</CardTitle>
								<CardDescription>
									{report
										? `Run #${report.runId} · ${report.promptCount} prompts · ${relativeTime(report.startedAt)}`
										: 'Latency, accuracy and routing cost from a stored benchmark run.'}
								</CardDescription>
							</CardHeader>
							<CardContent>
								{report ? (
									/* Keyed on the run so switching runs (or finishing one) replays the
									   entrance instead of redrawing bars in place. */
									<div key={report.runId} className="panel-in flex flex-col gap-5">
										<ReportBars report={report} />
										<div className="border-border border-t pt-3">
											<ComparisonRow
												label="Accuracy vs expected"
												jev={formatPct(report.jev.accuracy)}
												judge={formatPct(report.judge.accuracy)}
											/>
											<ComparisonRow
												label="Reliability (success rate)"
												jev={formatPct(1 - report.jev.failureRate)}
												judge={formatPct(1 - report.judge.failureRate)}
											/>
											<ComparisonRow
												label="Routing cost"
												jev={formatUsd(report.jevRoutingCostUsd)}
												judge={formatUsd(report.judgeRoutingCostUsd)}
											/>
											<div className="text-text-muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
												<span>
													Router agreement:{' '}
													<span className="text-text font-numeric">
														{formatPct(report.routerAgreement)}
													</span>{' '}
													over {report.bothOk} prompts both completed.
												</span>
											</div>
										</div>
									</div>
								) : reportQuery.isLoading ? (
									<SkeletonBlock lines={5} label="Loading benchmark report…" />
								) : (
									<p className="text-text-faint text-sm">
										No benchmark runs yet. Run one to compare Jev against the LLM-as-judge baseline
										— every bar, accuracy and cost figure here is measured, never assumed.
									</p>
								)}
							</CardContent>
						</Card>
					</section>

					{/* Run history */}
					<section
						aria-label="Benchmark run history"
						className="panel-in"
						style={{ '--i': 7 } as React.CSSProperties}
					>
						<Card className="card-lift">
							<CardHeader>
								<CardTitle>Run history</CardTitle>
								<CardDescription>
									Stored benchmark runs, newest first. Select one to chart its report above.
								</CardDescription>
							</CardHeader>
							<CardContent>
								{runsQuery.isLoading ? (
									<SkeletonBlock lines={4} label="Loading stored benchmark runs…" />
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
															'focus-visible:outline-accent rounded-control flex w-full items-center gap-3 px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2',
															active
																? 'bg-surface-hover text-text'
																: 'text-text-muted hover:bg-surface-hover hover:text-text'
														)}
													>
														{/* The active marker is always in the layout and only
														    fades, so selecting a run never nudges the row text. */}
														<span
															aria-hidden="true"
															className={cn(
																'bg-accent h-4 w-0.5 shrink-0 rounded-full transition-opacity motion-reduce:transition-none',
																active ? 'opacity-100' : 'opacity-0'
															)}
														/>
														<span className="font-numeric text-xs tabular-nums">#{entry.id}</span>
														<span className="min-w-0 flex-1 truncate text-sm font-medium">
															{entry.label}
														</span>
														<span className="text-text-faint shrink-0 text-xs">
															{entry.resultCount} rows · {relativeTime(entry.startedAt)}
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

					{/* AgentOS four-setup benchmark (milestone 8): same tasks through A/B/C and the
					    full pipeline, each graded by the gpt-4.1 rubric judge. */}
					<div className="panel-in" style={{ '--i': 8 } as React.CSSProperties}>
						<AgentosBenchmarkPanel />
					</div>

					{/* Spend + Model usage (V3 §15, milestone 10): real cumulative spend from the
					    funded NanoGPT key and which models actually answered, both driven by the
					    persisted ai_usage ledger, agent_runs, benchmark runs and route_events. */}
					<section
						aria-label="Spend and model usage"
						className="panel-in grid gap-6 lg:grid-cols-2"
						style={{ '--i': 9 } as React.CSSProperties}
					>
						<SpendPanel
							spend={spendQuery.data?.spend ?? null}
							isLoading={spendQuery.isLoading}
							isError={spendQuery.isError}
						/>
						<ModelUsagePanel
							usage={spendQuery.data?.usage ?? null}
							isLoading={spendQuery.isLoading}
							isError={spendQuery.isError}
						/>
					</section>

					{/* Model Pool health (MP-M6): the live registry every chat/agent call selects
					    from — measured free-tier verification, circuit state, latency. */}
					<div className="panel-in" style={{ '--i': 10 } as React.CSSProperties}>
						<PoolHealthPanel />
					</div>
				</div>
			</main>
		</div>
	)
}
