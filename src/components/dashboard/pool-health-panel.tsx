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
import type { PoolHealthResponse, PoolModelHealth } from '@/lib/model-pool-health'
import type { CircuitState } from '@/lib/model-pool/types'
import { useModelPoolHealth } from './use-model-pool-health'

// The Model Pool health panel (MP-M6). It renders the LIVE registry the chat route
// and agents actually select from — the same globalThis singleton — so every figure
// is a real measurement: which free models the boot warm-up verified as serving,
// which are structurally gated (403/402 recorded as failures), which circuits are
// open. Nothing here is estimated. An unprobed model shows "no data", never a
// fabricated 100%, and the empty state says the catalog hasn't loaded yet rather
// than inventing rows.

function fmtPct(rate: number | null): string {
	if (rate == null) return '—'
	return `${Math.round(rate * 100)}%`
}

function fmtLatency(ms: number | null): string {
	if (ms == null) return '—'
	if (ms < 1000) return `${Math.round(ms)}ms`
	return `${(ms / 1000).toFixed(1)}s`
}

function fmtContext(n: number | null): string {
	if (n == null) return '—'
	if (n >= 1000) return `${Math.round(n / 1000)}k`
	return `${n}`
}

function ago(epochMs: number | null): string {
	if (epochMs == null) return 'never'
	const seconds = Math.round((Date.now() - epochMs) / 1000)
	if (seconds < 60) return 'just now'
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.round(minutes / 60)
	return `${hours}h ago`
}

const CIRCUIT_VARIANT: Record<CircuitState, 'success' | 'warning' | 'danger'> = {
	closed: 'success',
	'half-open': 'warning',
	open: 'danger'
}

function CircuitBadge({ circuit }: { circuit: CircuitState }) {
	return <Badge variant={CIRCUIT_VARIANT[circuit]}>{circuit}</Badge>
}

const COLUMNS = [
	'Model',
	'Tier',
	'Circuit',
	'Success',
	'Latency',
	'Samples',
	'Context',
	'Tags'
] as const

function PoolTable({ models }: { models: PoolModelHealth[] }) {
	return (
		<TableScroll className="table-scroll">
			<Table className="min-w-[720px]">
				<TableCaption>
					Live Model Pool health per model: tier, circuit-breaker state, measured success rate,
					measured mean latency, sample count, context length and verified capability tags. Unprobed
					models show no data rather than an assumed success rate.
				</TableCaption>
				<TableHeader>
					<TableRow className="border-border uppercase">
						{COLUMNS.map((col) => (
							<TableHead key={col} className="bg-surface sticky top-0 z-10">
								{col}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{models.map((m) => (
						<TableRow key={m.slug}>
							<TableRowHead>
								<span className="block truncate">{m.displayName}</span>
								<span className="text-text-faint font-numeric block text-xs">{m.slug}</span>
							</TableRowHead>
							<TableCell className="whitespace-nowrap">
								<Badge variant={m.tier === 'free' ? 'secondary' : 'outline'}>{m.tier}</Badge>
							</TableCell>
							<TableCell className="whitespace-nowrap">
								<CircuitBadge circuit={m.circuit} />
								{m.consecutiveFailures > 0 ? (
									<span className="text-text-faint ml-1 text-xs">{m.consecutiveFailures} fail</span>
								) : null}
							</TableCell>
							<TableNum className="tabular-nums">{fmtPct(m.successRate)}</TableNum>
							<TableNum className="tabular-nums">{fmtLatency(m.latencyMs)}</TableNum>
							<TableNum className="tabular-nums">{m.samples}</TableNum>
							<TableNum className="tabular-nums">{fmtContext(m.contextLength)}</TableNum>
							<TableCell>
								{m.tags.length === 0 ? (
									<span className="text-text-faint text-xs">—</span>
								) : (
									<span className="flex flex-wrap gap-1">
										{m.tags.map((tag) => (
											<Badge key={tag} variant="outline" className="text-[10px]">
												{tag}
											</Badge>
										))}
									</span>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</TableScroll>
	)
}

function Summary({ data }: { data: PoolHealthResponse }) {
	const s = data.summary
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="default">{s.total} models</Badge>
				<Badge variant="secondary">{s.free} free</Badge>
				<Badge variant="outline">{s.premium} premium</Badge>
				<Badge variant={s.openCircuits > 0 ? 'warning' : 'secondary'}>
					{s.openCircuits} open circuit{s.openCircuits === 1 ? '' : 's'}
				</Badge>
				<Badge variant="secondary">{s.probed} probed</Badge>
			</div>

			{/* The measured free-tier split — this is what actually serves on a $0 key.
			    freeWorking = verified-serving, freeGated = structurally blocked (403/402
			    recorded by the boot warm-up), freeUnprobed = never exercised yet. */}
			<div className="border-border border-t pt-3">
				<p className="text-text-muted mb-1.5 text-xs font-medium tracking-wide uppercase">
					Free tier (measured at boot)
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="success">{s.freeWorking} verified serving</Badge>
					<Badge variant={s.freeGated > 0 ? 'danger' : 'secondary'}>{s.freeGated} gated</Badge>
					<Badge variant={s.freeUnprobed > 0 ? 'warning' : 'secondary'}>
						{s.freeUnprobed} unprobed
					</Badge>
				</div>
			</div>

			<div className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs">
				<span className="text-text-faint">Catalog refreshed {ago(data.lastRefreshedAt)}</span>
				{data.stale ? (
					<Badge variant="warning">stale — refreshes on next read</Badge>
				) : (
					<Badge variant="success">fresh</Badge>
				)}
			</div>
		</div>
	)
}

export function PoolHealthPanel() {
	const query = useModelPoolHealth()
	const data = query.data ?? null

	return (
		<Card>
			<CardHeader>
				<CardTitle>Model Pool health</CardTitle>
				<CardDescription>
					The live registry the chat route and agents select from. Free-tier models are probed with
					a real test call at boot — verified-serving, gated (403/402) and unprobed are measured
					counts, never assumed. Premium models sit behind the credit wall on an unfunded key.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{data && data.models.length > 0 ? (
					<div className="flex flex-col gap-5">
						<Summary data={data} />
						<div className="border-border border-t pt-4">
							<PoolTable models={data.models} />
						</div>
					</div>
				) : query.isLoading ? (
					<SkeletonBlock lines={6} label="Loading pool health…" />
				) : query.isError ? (
					<div className="border-danger/40 bg-danger/10 text-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
						<AlertIcon size={16} className="mt-0.5 shrink-0" />
						<span className="break-words">Failed to load Model Pool health.</span>
					</div>
				) : (
					<EmptyState
						illustrate={false}
						title="Catalog not loaded yet"
						body="The pool discovers models from the NanoGPT catalogue on first read and warms its cache at boot — reload in a moment."
						className="py-8"
					/>
				)}
			</CardContent>
		</Card>
	)
}
