'use client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableNum,
	TableRow,
	TableRowHead,
	TableScroll
} from '@/components/ui/table'
import { AlertIcon } from '@/components/ui/icons'
import { SkeletonBlock } from '@/components/ui/skeleton'
import type { CapUtilization, FamilySpend, SpendView } from '@/lib/spend'
import { MeterBar } from './meter-bar'

// The Spend view (V3 §15, milestone 10). Every figure is real persisted spend from the
// funded NanoGPT key, summed from the ai_usage per-call ledger — never an estimate. The
// ledger total is the only cumulative number; the per-run and benchmark tables are
// labelled subsets of it (their calls are also in the ledger), so nothing is
// double-counted. Where a model's USD price is unpublished the row is counted as
// "unpriced" and its tokens are shown with USD marked unknown — never a made-up number.
// NanoGPT has no verified balance endpoint, so remaining credit is reported unknown.

function usd(microUsd: number): string {
	if (microUsd === 0) return '$0'
	return `$${(microUsd / 1_000_000).toFixed(6)}`
}

// A cost that may be unknown (NULL price) — rendered distinctly, never as $0.
function usdOrUnknown(microUsd: number | null): string {
	return microUsd == null ? 'unknown' : usd(microUsd)
}

function tokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
	return `${n}`
}

function ago(iso: string): string {
	const then = new Date(iso).getTime()
	if (Number.isNaN(then)) return ''
	const minutes = Math.round((Date.now() - then) / 60000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.round(hours / 24)
	if (days < 7) return `${days}d ago`
	return new Date(iso).toLocaleDateString()
}

// One inline horizontal meter with a formatted value label. Used for the family
// breakdown, the daily trend and the cap utilization bars — a small local primitive
// because the shared BarChart is latency-shaped (it appends "ms" and prints raw
// numbers), which would mislabel money.
function capColor(utilization: number | null): string {
	if (utilization == null) return 'bg-text-faint'
	if (utilization >= 0.9) return 'bg-danger'
	if (utilization >= 0.5) return 'bg-warning'
	return 'bg-success'
}

const FAMILY_LABEL: Record<FamilySpend['family'], string> = {
	claude: 'Claude',
	gpt: 'GPT',
	gemini: 'Gemini',
	other: 'Other'
}

const FAMILY_COLOR: Record<FamilySpend['family'], string> = {
	claude: 'var(--series-1)',
	gpt: 'var(--series-2)',
	gemini: 'var(--series-3)',
	other: 'var(--color-text-faint)'
}

function CapRow({ cap }: { cap: CapUtilization }) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-3 text-xs">
				<span className="text-text font-medium">{cap.label}</span>
				<span className="text-text-muted font-mono tabular-nums">
					{usd(Math.round(cap.spentUsd * 1_000_000))}
					<span className="text-text-faint"> / ${cap.capUsd.toFixed(2)}</span>
				</span>
			</div>
			<MeterBar
				label=""
				valueText=""
				fraction={cap.utilization ?? 0}
				colorClass={capColor(cap.utilization)}
			/>
			<span className="text-text-faint text-[11px]">{cap.basis}</span>
		</div>
	)
}

function SpendBody({ spend }: { spend: SpendView }) {
	const maxFamily = Math.max(1, ...spend.perFamily.map((f) => f.costMicroUsd))
	const maxDay = Math.max(1, ...spend.overTime.map((d) => d.costMicroUsd))

	return (
		<div className="flex flex-col gap-6">
			{/* Headline total + honesty counters */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-text-muted text-xs font-medium tracking-wide uppercase">
						Cumulative spend (funded NanoGPT key)
					</p>
					<p className="text-text font-mono text-4xl font-semibold tabular-nums">
						{usd(spend.totalCostMicroUsd)}
					</p>
					<p className="text-text-faint mt-1 text-xs">
						Sum of every priced ai_usage ledger row — the single source of truth.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">{spend.pricedRows} priced calls</Badge>
					<Badge variant={spend.unpricedRows > 0 ? 'warning' : 'secondary'}>
						{spend.unpricedRows} unpriced
					</Badge>
					<Badge variant="outline">balance unknown</Badge>
				</div>
			</div>

			{spend.unpricedRows > 0 ? (
				<p className="text-text-faint text-xs">
					{spend.unpricedRows} ledger row(s) hit a model with no published USD price —{' '}
					<span className="text-text-muted font-mono">{tokens(spend.unpricedTokens)}</span> tokens
					consumed, USD marked <span className="text-text-muted">unknown</span> (never $0).
				</p>
			) : null}

			<p className="text-text-faint text-xs">{spend.balance.note}</p>

			{/* Caps */}
			<div className="border-border border-t pt-4">
				<p className="text-text-muted mb-3 text-xs font-medium tracking-wide uppercase">
					Spend caps (utilization)
				</p>
				<div className="grid gap-4 sm:grid-cols-3">
					{spend.caps.map((cap) => (
						<CapRow key={cap.name} cap={cap} />
					))}
				</div>
			</div>

			{/* Per-family breakdown */}
			<div className="border-border border-t pt-4">
				<p className="text-text-muted mb-3 text-xs font-medium tracking-wide uppercase">
					Per-family spend
				</p>
				<div className="flex flex-col gap-3">
					{spend.perFamily.map((f) => (
						<MeterBar
							key={f.family}
							label={FAMILY_LABEL[f.family]}
							valueText={usd(f.costMicroUsd)}
							hint={`· ${f.calls} calls · ${Math.round(f.share * 100)}%`}
							fraction={f.costMicroUsd / maxFamily}
							colorStyle={FAMILY_COLOR[f.family]}
						/>
					))}
				</div>
			</div>

			{/* Spend over time (UTC days) */}
			{spend.overTime.length > 0 ? (
				<div className="border-border border-t pt-4">
					<p className="text-text-muted mb-3 text-xs font-medium tracking-wide uppercase">
						Spend over time (UTC day)
					</p>
					<div className="flex flex-col gap-2">
						{spend.overTime.map((day) => (
							<MeterBar
								key={day.day}
								label={day.day}
								valueText={usd(day.costMicroUsd)}
								hint={`· ${day.calls} calls`}
								fraction={day.costMicroUsd / maxDay}
								colorClass="bg-accent"
							/>
						))}
					</div>
				</div>
			) : null}

			{/* Per-run costs (AgentOS runs — a subset of the ledger) */}
			<div className="border-border border-t pt-4">
				<p className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
					Per-run costs (AgentOS runs)
				</p>
				{spend.perRun.length === 0 ? (
					<p className="text-text-faint text-sm">No AgentOS runs recorded yet.</p>
				) : (
					<TableScroll>
						<Table className="min-w-[640px]">
							<TableCaption>
								Newest AgentOS runs first. Cost is the run&apos;s own persisted spend, a subset of
								the ledger total above — not added to it.
							</TableCaption>
							<TableHeader>
								<TableRow className="border-border uppercase">
									<TableHead>Run</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Calls</TableHead>
									<TableHead>Cost</TableHead>
									<TableHead>When</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{spend.perRun.map((run) => (
									<TableRow key={run.id}>
										<TableRowHead>
											<span className="text-text-faint font-mono text-xs">#{run.id}</span>
											<span className="block max-w-[280px] truncate">{run.query}</span>
										</TableRowHead>
										<TableCell className="whitespace-nowrap">{run.taskType}</TableCell>
										<TableCell className="whitespace-nowrap">
											<Badge variant={run.status === 'completed' ? 'success' : 'outline'}>
												{run.status}
											</Badge>
										</TableCell>
										<TableNum className="tabular-nums">
											{run.modelCalls}m/{run.toolCalls}t
										</TableNum>
										<TableNum className="tabular-nums">{usdOrUnknown(run.costMicroUsd)}</TableNum>
										<TableCell className="text-text-faint text-xs whitespace-nowrap">
											{ago(run.createdAt)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableScroll>
				)}
			</div>

			{/* Benchmark run costs (a subset of the ledger) */}
			<div className="border-border border-t pt-4">
				<p className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
					Benchmark run costs
				</p>
				{spend.benchmarkRuns.length === 0 ? (
					<p className="text-text-faint text-sm">No benchmark runs recorded yet.</p>
				) : (
					<TableScroll>
						<Table className="min-w-[640px]">
							<TableCaption>
								Four-setup benchmark runs, newest first. Total = per-setup costs + the judge spend,
								both persisted on the run.
							</TableCaption>
							<TableHeader>
								<TableRow className="border-border uppercase">
									<TableHead>Run</TableHead>
									<TableHead>Tasks</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Setups</TableHead>
									<TableHead>Judge</TableHead>
									<TableHead>Total</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{spend.benchmarkRuns.map((run) => (
									<TableRow key={run.id}>
										<TableRowHead>
											<span className="text-text-faint font-mono text-xs">#{run.id}</span>
											<span className="block max-w-[280px] truncate">{run.label}</span>
										</TableRowHead>
										<TableNum className="tabular-nums">{run.taskCount}</TableNum>
										<TableCell className="whitespace-nowrap">
											<Badge
												variant={
													run.status === 'completed'
														? 'success'
														: run.status === 'budget_stopped'
															? 'warning'
															: 'outline'
												}
											>
												{run.status}
											</Badge>
										</TableCell>
										<TableNum className="tabular-nums">{usd(run.setupCostMicroUsd)}</TableNum>
										<TableNum className="tabular-nums">
											{usdOrUnknown(run.judgeCostMicroUsd)}
										</TableNum>
										<TableNum className="tabular-nums">{usd(run.totalCostMicroUsd)}</TableNum>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableScroll>
				)}
			</div>
		</div>
	)
}

export function SpendPanel({
	spend,
	isLoading,
	isError
}: {
	spend: SpendView | null
	isLoading: boolean
	isError: boolean
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Spend</CardTitle>
				<CardDescription>
					Real cumulative spend from the funded NanoGPT key — total, per-family, per-run, over time,
					and each cap&apos;s utilization. Summed from the ai_usage ledger; an unpublished price
					shows tokens with USD &ldquo;unknown&rdquo;, never a fabricated number.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{spend && spend.pricedRows + spend.unpricedRows > 0 ? (
					<SpendBody spend={spend} />
				) : isLoading ? (
					<SkeletonBlock lines={5} label="Loading spend…" />
				) : isError ? (
					<div className="border-danger/40 bg-danger/10 text-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
						<AlertIcon size={16} className="mt-0.5 shrink-0" />
						<span className="break-words">Failed to load spend.</span>
					</div>
				) : (
					<EmptyState
						illustrate={false}
						title="No spend yet"
						body="Spend appears here once a chat turn, AgentOS run or benchmark makes a priced call on the funded key."
						className="py-8"
					/>
				)}
			</CardContent>
		</Card>
	)
}
