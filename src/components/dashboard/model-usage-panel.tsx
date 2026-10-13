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
import type { FamilySpend, ModelUsageView, SpendFamily } from '@/lib/spend'
import { MeterBar } from './meter-bar'

// The Model-usage view (V3 §15, milestone 10): which models actually answered, per
// family and per feature, plus the chat routing telemetry. Every count comes from the
// persisted ai_usage ledger and route_events — never an estimate. NanoGPT has no free
// tier, so the honest "fallback" figure is how often Jev errored/timed-out and the
// DEFAULT_LABEL answered instead (route_events.fallback), not a flagship-vs-free split.

function usd(microUsd: number): string {
	if (microUsd === 0) return '$0'
	return `$${(microUsd / 1_000_000).toFixed(6)}`
}

function usdOrUnknown(microUsd: number | null): string {
	return microUsd == null ? 'unknown' : usd(microUsd)
}

function tokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
	return `${n}`
}

function pct(fraction: number): string {
	return `${Math.round(fraction * 100)}%`
}

const FAMILY_LABEL: Record<SpendFamily, string> = {
	claude: 'Claude',
	gpt: 'GPT',
	gemini: 'Gemini',
	other: 'Other'
}

const FAMILY_COLOR: Record<SpendFamily, string> = {
	claude: 'var(--series-1)',
	gpt: 'var(--series-2)',
	gemini: 'var(--series-3)',
	other: 'var(--color-text-faint)'
}

function UsageBody({ usage }: { usage: ModelUsageView }) {
	const maxModelCalls = Math.max(1, ...usage.perModel.map((m) => m.calls))
	const maxFamilyCalls = Math.max(1, ...usage.perFamily.map((f) => f.calls))

	return (
		<div className="flex flex-col gap-6">
			{/* Headline counts */}
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="default">{usage.totalCalls} provider calls</Badge>
				<Badge variant="secondary">{usage.perModel.length} distinct models</Badge>
				<Badge variant="outline">
					{usage.agentRuns.count} AgentOS runs · {usage.agentRuns.totalModelCalls}m/
					{usage.agentRuns.totalToolCalls}t
				</Badge>
			</div>

			{/* Per-family call distribution */}
			<div className="border-border border-t pt-4">
				<p className="text-text-muted mb-3 text-xs font-medium tracking-wide uppercase">
					Calls per family
				</p>
				<div className="flex flex-col gap-3">
					{usage.perFamily.map((f: FamilySpend) => (
						<MeterBar
							key={f.family}
							label={FAMILY_LABEL[f.family]}
							valueText={`${f.calls} calls`}
							hint={`· ${usd(f.costMicroUsd)}`}
							fraction={f.calls / maxFamilyCalls}
							colorStyle={FAMILY_COLOR[f.family]}
						/>
					))}
				</div>
			</div>

			{/* Per-model table: which models actually answered */}
			<div className="border-border border-t pt-4">
				<p className="text-text-muted mb-2 text-xs font-medium tracking-wide uppercase">
					Per model
				</p>
				{usage.perModel.length === 0 ? (
					<p className="text-text-faint text-sm">No model calls recorded yet.</p>
				) : (
					<TableScroll>
						<Table className="min-w-[680px]">
							<TableCaption>
								Every model that answered a call, by call count. Cost is the real ledger sum for
								that model; &ldquo;unknown&rdquo; means its USD price is unpublished, never $0.
							</TableCaption>
							<TableHeader>
								<TableRow className="border-border uppercase">
									<TableHead>Model</TableHead>
									<TableHead>Family</TableHead>
									<TableHead>Calls</TableHead>
									<TableHead>In tok</TableHead>
									<TableHead>Out tok</TableHead>
									<TableHead>Cost</TableHead>
									<TableHead>Share</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{usage.perModel.map((m) => (
									<TableRow key={m.model}>
										<TableRowHead>
											<span className="block max-w-[260px] truncate font-mono text-xs">
												{m.model}
											</span>
											<span
												className="bg-surface-hover mt-1 block h-1 rounded-full"
												aria-hidden="true"
											>
												<span
													className="block h-full rounded-full"
													style={{
														width: `${(m.calls / maxModelCalls) * 100}%`,
														backgroundColor: FAMILY_COLOR[m.family]
													}}
												/>
											</span>
										</TableRowHead>
										<TableCell className="whitespace-nowrap">
											<Badge variant="outline">{FAMILY_LABEL[m.family]}</Badge>
										</TableCell>
										<TableNum className="tabular-nums">{m.calls}</TableNum>
										<TableNum className="tabular-nums">{tokens(m.inputTokens)}</TableNum>
										<TableNum className="tabular-nums">{tokens(m.outputTokens)}</TableNum>
										<TableNum className="tabular-nums">{usdOrUnknown(m.costMicroUsd)}</TableNum>
										<TableNum className="tabular-nums">{pct(m.share)}</TableNum>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableScroll>
				)}
			</div>

			{/* Per-feature breakdown */}
			{usage.byFeature.length > 0 ? (
				<div className="border-border border-t pt-4">
					<p className="text-text-muted mb-3 text-xs font-medium tracking-wide uppercase">
						Calls per feature
					</p>
					<ul className="flex flex-col gap-1.5">
						{usage.byFeature.map((f) => (
							<li key={f.feature} className="flex items-center justify-between gap-3 text-xs">
								<span className="text-text truncate font-mono">{f.feature}</span>
								<span className="text-text-muted shrink-0 font-mono tabular-nums">
									{f.calls} calls · {usd(f.costMicroUsd)}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{/* Chat routing telemetry */}
			<div className="border-border border-t pt-4">
				<p className="text-text-muted mb-3 text-xs font-medium tracking-wide uppercase">
					Chat routing (route_events)
				</p>
				{usage.chat.turns === 0 ? (
					<p className="text-text-faint text-sm">No chat turns routed yet.</p>
				) : (
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="secondary">{usage.chat.turns} turns</Badge>
							<Badge variant={usage.chat.jevFallbacks > 0 ? 'warning' : 'success'}>
								{usage.chat.jevFallbacks} Jev fallbacks · {pct(usage.chat.fallbackRate)}
							</Badge>
						</div>
						<ul className="flex flex-col gap-1.5">
							{usage.chat.perLabel.map((row) => (
								<li key={row.label} className="flex items-center justify-between gap-3 text-xs">
									<span className="text-text capitalize">{row.label}</span>
									<span className="text-text-muted shrink-0 font-mono tabular-nums">
										{row.count} · {pct(row.share)}
									</span>
								</li>
							))}
						</ul>
						<p className="text-text-faint text-[11px]">
							NanoGPT has no free tier, so a &ldquo;fallback&rdquo; is Jev erroring or timing out
							and the default label answering, counted from persisted route_events. estimated.
						</p>
					</div>
				)}
			</div>
		</div>
	)
}

export function ModelUsagePanel({
	usage,
	isLoading,
	isError
}: {
	usage: ModelUsageView | null
	isLoading: boolean
	isError: boolean
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Model usage</CardTitle>
				<CardDescription>
					Which models actually answered, per family, per model and per feature, plus chat routing
					telemetry. Counted from the persisted ledger and route_events; unpriced models show their
					tokens with USD &ldquo;unknown&rdquo;.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{usage && usage.totalCalls > 0 ? (
					<UsageBody usage={usage} />
				) : isLoading ? (
					<SkeletonBlock lines={5} label="Loading model usage…" />
				) : isError ? (
					<div className="border-danger/40 bg-danger/10 text-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
						<AlertIcon size={16} className="mt-0.5 shrink-0" />
						<span className="break-words">Failed to load model usage.</span>
					</div>
				) : (
					<EmptyState
						illustrate={false}
						title="No model calls yet"
						body="Model usage appears here once a chat turn, AgentOS run or benchmark answers a call on the funded key."
						className="py-8"
					/>
				)}
			</CardContent>
		</Card>
	)
}
