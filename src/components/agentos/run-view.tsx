'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertIcon } from '@/components/ui/icons'
import { SkeletonBlock, SkeletonLines } from '@/components/ui/skeleton'
import { AppHeader } from '@/components/nav/app-header'
import { Magnetic } from '@/components/motion/magnetic'
import { StreamDots } from '@/components/ui/stream-dots'
import { Markdown } from '@/components/chat/markdown'
import { cn } from '@/lib/cn'
import {
	applyTerminalStatus,
	formatMicroUsd,
	formatMs,
	modelBadge,
	reduceRunViewEvents,
	renderDecisionAction,
	renderGateQuote,
	type PoolEventMarker,
	type RosterRow,
	type RosterStatus,
	type RunViewState
} from '@/lib/agentos/run-view'
import { useAgentRun } from './use-agent-run'
import { AGENT_RUNS_QUERY_KEY, useAgentRuns, useRunReplay } from './use-run-replay'

// The AgentOS run view (mockup D6). A monospace, hairline-card stack of live
// panels that render the Decision Bus → team → execution → evidence → verification
// pipeline as it happens. The panels sit on the same editorial surface system as
// the rest of the product (solid hairline cards, rounded corners); the mono type
// and small-caps titles are the data voice, kept for tabular telemetry legibility.
// Every figure comes from real run state folded by the one
// pure reducer in run-view.ts: a live SSE stream (useAgentRun) and a replayed run
// (useRunReplay) both produce a RunViewState, so this component renders either
// identically and never fabricates a number (§8, §13).
//
// Take 3 §5 moved this surface onto the landing's motion system without touching
// that data flow: the D6 panel order is unchanged, but the frames now enter
// through the shared `.panel-in` stagger, a roster/failover/contradiction row
// arrives with `.row-in`, live counters tick with `.tick-in`, the RUNNING dot
// breathes with `.dot-live` instead of a stock pulse, the final report unrolls
// with `.report-in`, and picking a replay replays the whole stack (see the key on
// `RunViewPanels`). Titles use `.label-uppercase`, the empty terminal carries the
// landing's aurora + hero, and every spinner became the shimmer or `StreamDots`.

// ---- Small shared pieces --------------------------------------------------

const DOT_CLASS: Record<RosterStatus, string> = {
	waiting: 'bg-text-faint',
	running: 'dot-live bg-warning',
	complete: 'bg-success',
	failed: 'bg-danger',
	skipped: 'bg-border-strong'
}

const STATUS_LABEL: Record<RosterStatus, string> = {
	waiting: 'WAITING',
	running: 'RUNNING',
	complete: 'COMPLETE',
	failed: 'FAILED',
	skipped: 'SKIPPED'
}

// A hairline card panel with a small-caps title bar. The view's whole aesthetic
// is these stacked frames; keeping them one component means the live and
// replay views are pixel-identical.
//
// `i` is the panel's position in the D6 order and drives the shared `.panel-in`
// entrance (700 ms expo, `--i` × 70 ms), so the stack assembles top-down instead
// of appearing all at once. The title bar uses `.label-uppercase`, the same
// uppercase token the landing, dashboard and chat headers use, instead of a
// run-view-specific size/tracking pair.
function Panel({
	title,
	right,
	children,
	className,
	i = 0
}: {
	title: string
	right?: React.ReactNode
	children: React.ReactNode
	className?: string
	i?: number
}) {
	return (
		<section
			aria-label={title}
			className={cn('border-border bg-surface panel-in rounded-lg border', className)}
			style={{ '--i': i } as React.CSSProperties}
		>
			<header className="border-border flex items-center justify-between gap-2 border-b px-3 py-1.5">
				<h2 className="label-uppercase text-text-muted font-mono font-semibold">{title}</h2>
				{right}
			</header>
			<div className="px-3 py-2.5">{children}</div>
		</section>
	)
}

// A figure that announces itself when it changes: the consumer keys this on the
// value, so React remounts the node and `.tick-in` replays. Used for the live
// counters, where a restart-from-zero count-up would misread as data resetting.
function Tick({ value }: { value: React.ReactNode }) {
	return (
		<span key={String(value)} className="tick-in inline-block">
			{value}
		</span>
	)
}

function ModelPill({ model }: { model: string }) {
	const badge = modelBadge(model)
	return (
		<span
			className="border-border text-text-muted inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide"
			style={badge.color ? { borderColor: badge.color, color: badge.color } : undefined}
		>
			{badge.color ? (
				<span
					className="h-1.5 w-1.5 rounded-full"
					style={{ backgroundColor: badge.color }}
					aria-hidden="true"
				/>
			) : null}
			{badge.label}
		</span>
	)
}

function ChecklistRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-0.5 font-mono text-xs">
			<span className="text-text-faint tracking-wide uppercase">{label}</span>
			<span className="text-text tabular-nums">{value}</span>
		</div>
	)
}

// ---- The panels -----------------------------------------------------------

function HeaderPanel({ view }: { view: RunViewState }) {
	const phaseLabel =
		view.phase === 'streaming'
			? 'RUNNING'
			: view.phase === 'complete'
				? 'COMPLETE'
				: view.phase === 'failed'
					? 'FAILED'
					: view.phase === 'budget_stopped'
						? 'BUDGET STOPPED'
						: 'IDLE'
	return (
		<div
			className="border-border bg-surface panel-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5"
			style={{ '--i': 0 } as React.CSSProperties}
		>
			<div className="flex min-w-0 items-baseline gap-2">
				<span className="text-text font-mono text-sm font-bold tracking-[0.12em]">AGENTOS</span>
				<span className="text-text-faint hidden font-mono text-[11px] tracking-wide sm:inline">
					| Adaptive Multi-Agent Intelligence
				</span>
			</div>
			<div className="ml-auto flex flex-wrap items-center gap-2">
				{view.tier ? (
					<Badge variant="secondary" className="font-mono tracking-wide">
						tier: {view.tier}
					</Badge>
				) : null}
				<Badge
					variant={
						view.phase === 'failed' || view.phase === 'budget_stopped'
							? 'danger'
							: view.phase === 'complete'
								? 'success'
								: view.phase === 'streaming'
									? 'warning'
									: 'outline'
					}
					className="font-mono tracking-wide"
				>
					{phaseLabel}
				</Badge>
			</div>
			<div className="text-text-muted flex w-full flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums sm:w-auto">
				<span>
					cost <Tick value={formatMicroUsd(view.costMicroUsd)} />
				</span>
				<span>
					elapsed <Tick value={formatMs(view.elapsedMs)} />
				</span>
				<span>
					models <Tick value={view.modelCalls} />
				</span>
				<span>
					tools <Tick value={view.toolCalls} />
				</span>
				{view.runId ? <span>run #{view.runId}</span> : null}
			</div>
		</div>
	)
}

function UserPanel({ query, i }: { query: string | null; i: number }) {
	return (
		<Panel title="User" i={i}>
			{query ? (
				<blockquote className="text-text border-text-faint/40 border-l-2 pl-3 font-mono text-sm break-words">
					&ldquo;{query}&rdquo;
				</blockquote>
			) : (
				<p className="text-text-faint font-mono text-sm">
					No query yet. Enter one below to start a run.
				</p>
			)}
		</Panel>
	)
}

function DecisionBusPanel({ view, i }: { view: RunViewState; i: number }) {
	const c = view.checklist
	const pct = (n: number | null) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`)
	return (
		<Panel title="Jev Decision Bus" i={i}>
			<div className="flex flex-col gap-0.5">
				<ChecklistRow label="Task classified" value={c.taskType ?? 'n/a'} />
				<ChecklistRow
					label="Complexity"
					value={
						c.complexityConfidence != null
							? `${c.complexityConfidence.toFixed(2)}${c.tier ? ` · ${c.tier}` : ''}`
							: (c.tier ?? 'n/a')
					}
				/>
				<ChecklistRow label="Agents selected" value={c.agentsSelected || 'n/a'} />
				<ChecklistRow
					label="Model routing"
					value={c.modelRouting ? `${c.modelRouting} models` : 'n/a'}
				/>
			</div>
			{view.deferred.length > 0 ? (
				<p className="text-text-faint mt-2 font-mono text-[11px]">
					deferred roles (not yet implemented): {view.deferred.join(', ')}
				</p>
			) : null}
			<p className="text-text-faint mt-1 font-mono text-[11px]">
				<Tick value={pct(c.complexityConfidence)} /> confidence · {view.executionMode ?? 'n/a'} mode
			</p>
		</Panel>
	)
}

function RosterPanel({ roster, i }: { roster: RosterRow[]; i: number }) {
	return (
		<Panel title={`Agent roster${roster.length ? ` · ${roster.length}` : ''}`} i={i}>
			{roster.length === 0 ? (
				<p className="text-text-faint font-mono text-sm">Team not assembled yet.</p>
			) : (
				<ul className="flex flex-col gap-1">
					{roster.map((row, index) => (
						<li
							key={row.stepId}
							className="row-in flex items-center gap-2 font-mono text-xs"
							style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
						>
							<span
								className={cn('h-2 w-2 shrink-0 rounded-full', DOT_CLASS[row.status])}
								aria-hidden="true"
							/>
							<span className="text-text truncate">
								{row.agent}
								{row.replan ? (
									<span className="text-accent ml-1 text-[10px] tracking-wide">+REPLAN</span>
								) : null}
							</span>
							{row.model ? <ModelPill model={row.model} /> : null}
							{row.degraded ? (
								<span
									className="text-warning text-[10px] tracking-wide"
									title="This step's routed model was unavailable (e.g. the credit wall on a $0 key), so the Model Pool failed over to a later candidate. The pill shows the routed model; the timeline below shows what actually served."
								>
									+FAILOVER
								</span>
							) : null}
							<span className="ml-auto flex shrink-0 items-center gap-2">
								{row.latencyMs != null ? (
									<span className="text-text-faint tabular-nums">{formatMs(row.latencyMs)}</span>
								) : null}
								<span
									className={cn(
										'tracking-wide',
										row.status === 'complete'
											? 'text-success'
											: row.status === 'running'
												? 'text-warning'
												: row.status === 'failed'
													? 'text-danger'
													: 'text-text-faint'
									)}
								>
									{STATUS_LABEL[row.status]}
								</span>
							</span>
						</li>
					))}
				</ul>
			)}
		</Panel>
	)
}

function PoolFailoverLine({ marker, index }: { marker: PoolEventMarker; index: number }) {
	if (marker.kind === 'failover') {
		return (
			<li
				className="border-warning/40 bg-warning/10 text-warning row-in border-l-2 pl-2 font-mono text-[11px]"
				style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
			>
				<span className="tracking-wide">FAILOVER{marker.stepId ? ` · ${marker.stepId}` : ''}:</span>{' '}
				<span className="break-all">
					{marker.fromSlug || 'n/a'} → {marker.toSlug || 'n/a'}
				</span>
				<span className="text-text-faint">
					{' '}
					({marker.reason}
					{marker.attempt > 0 ? `, attempt ${marker.attempt}` : ''})
				</span>
			</li>
		)
	}
	return (
		<li
			className="border-danger/40 bg-danger/10 text-danger row-in border-l-2 pl-2 font-mono text-[11px]"
			style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
		>
			<span className="tracking-wide">CIRCUIT {marker.circuit.toUpperCase()}:</span>{' '}
			<span className="break-all">{marker.slug || 'n/a'}</span>
			<span className="text-text-faint">
				{' '}
				after {marker.consecutiveFailures} consecutive failures
			</span>
		</li>
	)
}

// The Model Pool failover timeline (MP-M6). Rendered only when the pool actually
// degraded a step or tripped a circuit — a clean run on a funded key shows nothing
// here, which is the honest state. Every line is a real event folded by the reducer
// from the live SSE stream or the replayed log, so a degrade is never hidden.
function PoolFailoverPanel({ view, i }: { view: RunViewState; i: number }) {
	if (view.poolEvents.length === 0) return null
	return (
		<Panel
			title="Model Pool Failover"
			i={i}
			right={
				<span className="text-text-faint font-mono text-[10px] tracking-wide tabular-nums">
					{view.poolEvents.length} event{view.poolEvents.length === 1 ? '' : 's'}
				</span>
			}
		>
			<ul className="flex flex-col gap-1">
				{view.poolEvents.map((marker, index) => (
					<PoolFailoverLine key={index} marker={marker} index={index} />
				))}
			</ul>
		</Panel>
	)
}

function EvidencePanel({ view, i }: { view: RunViewState; i: number }) {
	const g = view.evidence
	return (
		<Panel title="Evidence Graph" i={i}>
			<div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs tabular-nums">
				<span className="text-text">
					<Tick value={g.sources} /> sources
				</span>
				<span className="text-success">
					<Tick value={g.verified} /> verified
				</span>
				<span className="text-warning">
					<Tick value={g.contested} /> contested
				</span>
				<span className="text-danger">
					<Tick value={g.refuted} /> refuted
				</span>
				<span className="text-text-muted">
					<Tick value={g.claims} /> claims
				</span>
				<span className="text-danger">
					<Tick value={g.contradictions} /> contradictions
				</span>
			</div>
			{view.contradictions.length > 0 ? (
				<ul className="mt-2 flex flex-col gap-1">
					{view.contradictions.map((m, index) => (
						<li
							key={index}
							className="border-danger/40 bg-danger/10 text-danger row-in border-l-2 pl-2 font-mono text-[11px]"
							style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
						>
							<span className="tracking-wide">CONTRADICTION:</span> {m.claim || 'n/a'} ⟷{' '}
							{m.againstClaim || 'n/a'}
						</li>
					))}
				</ul>
			) : null}
		</Panel>
	)
}

function JevDecisionPanel({ view, i }: { view: RunViewState; i: number }) {
	const quote = renderGateQuote(view.latestGate)
	const action = renderDecisionAction(view)
	return (
		<Panel
			title="Jev Decision"
			i={i}
			right={
				view.latestGate ? (
					<span className="text-text-faint font-mono text-[10px] tracking-wide">
						{view.latestGate.decidedBy} · {formatMs(view.latestGate.latencyMs)}
					</span>
				) : null
			}
		>
			{quote ? (
				// Keyed on the quote so a NEW gate firing replays the entrance, while the
				// same gate re-rendering (any other event) does not.
				<blockquote
					key={quote}
					className="text-text border-accent/50 row-in border-l-2 pl-3 font-mono text-sm break-words"
				>
					&ldquo;{quote}&rdquo;
				</blockquote>
			) : (
				<p className="text-text-faint font-mono text-sm">No verification gate has fired.</p>
			)}
			<p className="text-accent mt-1.5 font-mono text-xs break-words">→ {action}</p>
			{view.replans.length > 0 ? (
				<ul className="mt-2 flex flex-col gap-1">
					{view.replans.map((r, index) => (
						<li
							key={r.index}
							className="border-accent/40 bg-accent/10 text-accent row-in border-l-2 pl-2 font-mono text-[11px]"
							style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
						>
							<span className="tracking-wide">REPLAN #{r.index}:</span> {r.reason || 'replanned'}
							{r.addedSteps.length ? ` → spawn ${r.addedSteps.join(', ')}` : ''}
						</li>
					))}
				</ul>
			) : null}
		</Panel>
	)
}

function AnswerPanel({
	view,
	i,
	isStreaming
}: {
	view: RunViewState
	i: number
	isStreaming: boolean
}) {
	if (view.error) {
		return (
			<Panel title="Result" i={i}>
				<div className="border-danger/40 bg-danger/10 text-danger row-in flex items-start gap-2 border-l-2 pl-2 font-mono text-sm">
					<AlertIcon size={16} className="mt-0.5 shrink-0" />
					{/* min-w-0: a flex item's min-width defaults to min-content, and break-words doesn't shrink it */}
					<span className="min-w-0 break-words">{view.error}</span>
				</div>
			</Panel>
		)
	}
	if (!view.finalAnswer) {
		return (
			<Panel title="Result" i={i}>
				{view.phase === 'streaming' && isStreaming ? (
					// Gated on the CLIENT's stream, not just the folded phase: Cancel aborts
					// this browser's reader while the run keeps going server-side, and dots
					// that never stop would claim a connection that is already closed.
					<StreamDots
						className="text-text-muted mt-0.5 block font-mono text-sm"
						label="Synthesizing…"
					/>
				) : (
					<p className="text-text-faint font-mono text-sm">No final answer yet.</p>
				)}
			</Panel>
		)
	}
	return (
		<Panel
			title="Result"
			i={i}
			right={
				view.elapsedMs != null ? (
					<span className="text-text-faint font-mono text-[10px] tabular-nums">
						{formatMs(view.elapsedMs)}
					</span>
				) : null
			}
		>
			<Markdown content={view.finalAnswer} className="report-in font-mono" />
			{view.citations.length > 0 ? (
				<div className="border-border mt-3 border-t pt-2">
					<p className="label-uppercase text-text-faint mb-1 font-mono tracking-wide">
						Citations · {view.citations.length}
					</p>
					<ul className="flex flex-col gap-0.5">
						{view.citations.map((c, index) => (
							<li
								key={index}
								className="row-in font-mono text-[11px]"
								style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
							>
								<span className="text-text-faint">[{index + 1}]</span>{' '}
								{/^https?:\/\//i.test(c) ? (
									<a
										href={c}
										target="_blank"
										rel="noreferrer noopener"
										className="link-external text-accent focus-visible:outline-accent inline-flex items-start gap-1 break-all hover:underline focus-visible:outline focus-visible:outline-2"
									>
										{/* §5.5: an outbound link marks itself with an arrow that takes the
										    diagonal on hover. Decorative — href and target already say so. */}
										<svg
											viewBox="0 0 8 8"
											aria-hidden
											fill="none"
											stroke="currentColor"
											strokeWidth="1.2"
											className="ext-arrow mt-1 size-2 shrink-0"
										>
											<path d="M2 6 6 2M3.2 2H6v2.8" />
										</svg>
										<span>{c}</span>
									</a>
								) : (
									<span className="text-text-muted break-all">{c}</span>
								)}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</Panel>
	)
}

// The full stacked view. Renders any RunViewState — live or replayed — in mockup
// D6's panel order, which is the pipeline's own order (who was asked → what Jev
// decided → what the team produced → what the gate said → the answer). The order
// is load-bearing for the product and is not rearranged by this pass; what changed
// is that each frame now enters through the shared `.panel-in` stagger.
function RunViewPanels({ view, isStreaming }: { view: RunViewState; isStreaming: boolean }) {
	return (
		<div className="flex flex-col gap-3">
			<HeaderPanel view={view} />
			<UserPanel query={view.query} i={1} />
			<DecisionBusPanel view={view} i={2} />
			<RosterPanel roster={view.roster} i={3} />
			<PoolFailoverPanel view={view} i={4} />
			<EvidencePanel view={view} i={5} />
			<JevDecisionPanel view={view} i={6} />
			<AnswerPanel view={view} i={7} isStreaming={isStreaming} />
		</div>
	)
}

// The view's answer to the landing hero and the chat/dashboard equivalents: the
// same accent field, eyebrow label and hero face, shown only while the terminal is
// empty. Once a run exists the panels are the content and this steps aside.
function IdleHero() {
	return (
		<section
			aria-label="About this run view"
			className="panel-in relative overflow-hidden"
			style={{ '--i': 0 } as React.CSSProperties}
		>
			<div className="app-aurora" aria-hidden="true" />
			<div className="relative flex flex-col gap-2 py-8">
				<p className="label-uppercase text-text-faint">AgentOS · multi-agent pipeline</p>
				<h2 className="hero-editorial text-text">Ask once. Watch every hop.</h2>
				<p className="text-text-muted max-w-xl text-sm leading-relaxed">
					Jev tiers the query, assembles a roster and hands each step to a model. The frames below
					fill in as the run streams, and every figure in them comes from that run&apos;s own
					events.
				</p>
			</div>
		</section>
	)
}

// ---- The view container ---------------------------------------------------

export function AgentOSView() {
	const queryClient = useQueryClient()
	const live = useAgentRun()
	const [draft, setDraft] = useState('')
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

	const runsQuery = useAgentRuns()
	const replayQuery = useRunReplay(selectedRunId)

	// When a live run reaches a terminal phase its row has just been persisted;
	// refresh the history so it appears in the replay picker without a manual
	// refresh. Keyed on the phase string + the stable queryClient (never on the
	// per-render query object) so this fires once per run, not every render.
	const phase = live.view.phase
	useEffect(() => {
		if (phase === 'complete' || phase === 'failed' || phase === 'budget_stopped') {
			void queryClient.invalidateQueries({ queryKey: AGENT_RUNS_QUERY_KEY })
		}
	}, [phase, queryClient])

	const replayView = useMemo(() => {
		const payload = replayQuery.data
		if (!payload) return null
		// Fold the reconstructed wire events, then reconcile the terminal phase with
		// the stored run row (a run killed mid-stream never persisted a final frame).
		return applyTerminalStatus(
			reduceRunViewEvents(payload.events),
			payload.run.status,
			payload.run.error
		)
	}, [replayQuery.data])

	const runs = runsQuery.data?.runs ?? []
	// A live run takes the view; otherwise show the selected replay (if loaded).
	const inReplay = selectedRunId !== null && !live.isStreaming && live.view.phase === 'idle'
	const view = inReplay ? (replayView ?? live.view) : live.view
	// The hero is the empty terminal's masthead, so it retires the moment there is
	// anything real on screen — a run, a stored replay, or a query being typed.
	const showHero = !inReplay && view.phase === 'idle' && !view.query

	const onStart = useCallback(
		(event: React.FormEvent) => {
			event.preventDefault()
			const q = draft.trim()
			if (!q || live.isStreaming) return
			setSelectedRunId(null)
			live.start(q)
			// Refresh history once a run has been kicked off so it appears in the picker.
			void runsQuery.refetch()
		},
		[draft, live, runsQuery]
	)

	const onClear = useCallback(() => {
		live.reset()
		setDraft('')
	}, [live])

	return (
		<div className="bg-bg text-text flex h-dvh flex-col">
			<AppHeader title="AgentOS" subtitle="run view · D6" />

			<main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
				<div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_18rem]">
					{/* Left: the terminal panels + run control */}
					<div className="flex min-w-0 flex-col gap-4">
						{showHero ? <IdleHero /> : null}
						<form onSubmit={onStart} className="flex flex-col gap-2 sm:flex-row">
							<label htmlFor="agentos-query" className="sr-only">
								Query for AgentOS
							</label>
							<Input
								id="agentos-query"
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								placeholder="Ask AgentOS a research, analysis, or comparison question…"
								disabled={live.isStreaming}
								className="font-mono"
								autoComplete="off"
							/>
							<div className="flex shrink-0 gap-2">
								<Magnetic>
									<Button type="submit" disabled={live.isStreaming || draft.trim().length === 0}>
										{live.isStreaming ? (
											<StreamDots className="inline-flex items-center gap-2" label="Running…" />
										) : (
											'Run'
										)}
									</Button>
								</Magnetic>
								{live.isStreaming ? (
									<Button type="button" variant="outline" onClick={live.cancel}>
										Cancel
									</Button>
								) : (
									<Button
										type="button"
										variant="outline"
										onClick={onClear}
										disabled={draft.length === 0 && view.phase === 'idle'}
									>
										Clear
									</Button>
								)}
							</div>
						</form>

						{live.transportError ? (
							<div className="border-danger/40 bg-danger/10 text-danger flex items-start gap-2 rounded-lg border px-3 py-2 font-mono text-sm">
								<AlertIcon size={16} className="mt-0.5 shrink-0" />
								<span className="min-w-0 flex-1 break-words">{live.transportError}</span>
							</div>
						) : null}

						{/* Streaming status is announced to assistive tech without stealing focus. */}
						<div aria-live="polite" className="sr-only">
							{live.isStreaming
								? `Run streaming. ${view.roster.filter((r) => r.status === 'complete').length} of ${view.roster.length} agents complete.`
								: view.phase === 'complete'
									? 'Run complete.'
									: ''}
						</div>

						{/* The key is the swap transition: picking a different run (or returning to
						    live) remounts the stack, so every frame replays its `.panel-in`
						    entrance instead of the content snapping underneath a static shell.
						    Keyed on the SELECTION, never on run state — a live stream updates this
						    tree many times a second and must not restart the choreography. */}
						<RunViewPanels
							key={selectedRunId ?? 'live'}
							view={view}
							isStreaming={live.isStreaming}
						/>
					</div>

					{/* Right: replay picker */}
					<aside
						aria-label="Run replay"
						className="panel-in flex min-w-0 flex-col gap-3"
						style={{ '--i': 1 } as React.CSSProperties}
					>
						<div className="border-border bg-surface rounded-lg border">
							<header className="border-border flex items-center justify-between gap-2 border-b px-3 py-1.5">
								<h2 className="label-uppercase text-text-muted font-mono font-semibold">Replay</h2>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-6 px-2 font-mono text-[11px]"
									onClick={() => runsQuery.refetch()}
									disabled={runsQuery.isFetching}
								>
									{runsQuery.isFetching ? (
										<StreamDots className="inline-flex items-center gap-2" label="refreshing" />
									) : (
										'refresh'
									)}
								</Button>
							</header>
							<div className="px-2 py-2">
								{selectedRunId ? (
									<button
										type="button"
										onClick={() => setSelectedRunId(null)}
										className="text-accent focus-visible:outline-accent mb-2 font-mono text-[11px] hover:underline focus-visible:outline focus-visible:outline-2"
									>
										← back to live
									</button>
								) : null}
								{runsQuery.isLoading ? (
									// Same shimmer the chat history and dashboard use: a spinner says
									// "something is happening", the shimmer says how much is left to arrive.
									<SkeletonBlock lines={5} label="Loading run history" className="px-1 py-1" />
								) : runsQuery.isError ? (
									<p className="text-danger px-1 font-mono text-xs">Could not load run history.</p>
								) : runs.length === 0 ? (
									<p className="text-text-faint px-1 font-mono text-xs">
										No stored runs yet. Start one above.
									</p>
								) : (
									<ul className="flex max-h-[28rem] flex-col gap-0.5 overflow-y-auto">
										{runs.map((run, index) => {
											const active = run.id === selectedRunId
											return (
												<li
													key={run.id}
													className="panel-in"
													style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
												>
													<button
														type="button"
														onClick={() => setSelectedRunId(run.id)}
														aria-current={active ? 'true' : undefined}
														className={cn(
															'focus-visible:outline-accent rounded-control flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2',
															active
																? 'bg-surface-hover text-text'
																: 'text-text-muted hover:bg-surface-hover hover:text-text'
														)}
													>
														<span className="flex w-full items-center gap-2 font-mono text-[11px]">
															<span className="tabular-nums">#{run.id}</span>
															<span
																className={cn(
																	'ml-auto tracking-wide',
																	run.hasFinalAnswer
																		? 'text-success'
																		: run.status === 'budget_stopped' || run.error
																			? 'text-danger'
																			: 'text-text-faint'
																)}
															>
																{run.status}
															</span>
														</span>
														<span className="truncate font-mono text-[11px]">{run.query}</span>
														<span className="text-text-faint font-mono text-[10px] tabular-nums">
															{run.tier} · {run.eventCount} events
															{run.costMicroUsd != null
																? ` · ${formatMicroUsd(run.costMicroUsd)}`
																: ''}
														</span>
													</button>
												</li>
											)
										})}
									</ul>
								)}
							</div>
						</div>

						{inReplay && replayQuery.isLoading ? (
							<div role="status" aria-busy="true" className="flex flex-col gap-2 px-1">
								<SkeletonLines lines={4} />
								<span className="sr-only">Loading replay for run {selectedRunId}.</span>
							</div>
						) : null}
						{inReplay && replayQuery.isError ? (
							<p className="text-danger px-1 font-mono text-xs">
								Could not load that run&apos;s replay.
							</p>
						) : null}
					</aside>
				</div>
			</main>
		</div>
	)
}
