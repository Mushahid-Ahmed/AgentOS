'use client'
import type { DoneEventPayload } from '@/lib/chat-stream'
import { cn } from '@/lib/cn'

// Per-turn telemetry, rendered as compact chips under each answered message.
// Every figure is a real measurement from the stream (Jev latency from the router,
// total latency/tokens from NanoGPT's usage) — per the spec's "do not invent
// numbers" rule. NanoGPT reports token counts but NO monetary cost (V3), so the
// cost chip is always the real token counts × the curated per-1M list price, and is
// labelled as an estimate. The `cost != null` branch is defensive: it would light up
// only if a future provider returned an authoritative cost.

function Chip({
	label,
	value,
	title,
	className,
	i = 0
}: {
	label: string
	value: string
	title?: string
	className?: string
	// Position in the reading-order stagger (see `.chip-in` in globals.css).
	i?: number
}) {
	return (
		<span
			title={title}
			style={{ '--i': i } as React.CSSProperties}
			className={cn(
				'border-border bg-surface text-text-muted chip-in inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
				className
			)}
		>
			<span className="text-text-faint">{label}</span>
			<span className="text-text font-mono">{value}</span>
		</span>
	)
}

function formatCost(cost: number | null, estimated: number): { value: string; title: string } {
	if (cost != null) {
		return { value: `$${cost.toFixed(6)}`, title: 'Actual cost reported by the provider' }
	}
	return {
		value: `$${estimated.toFixed(6)}`,
		title:
			'Estimated from real token counts × the curated NanoGPT list price — NanoGPT returns no cost for this turn'
	}
}

export function TelemetryChips({ telemetry }: { telemetry: DoneEventPayload }) {
	const { usage } = telemetry
	const cost = formatCost(usage.cost, usage.estimatedCost)

	return (
		<div className="mt-2 flex flex-wrap gap-1.5">
			{telemetry.degraded ? (
				<span
					title="Jev's routed model was unavailable (rate limit, error or circuit open), so the Model Pool failed over to the next healthy candidate — a cheaper paid sibling, then the cheapest reliable paid floor (NanoGPT has no free tier). The `model` chip shows what actually answered."
					className="border-warning/40 bg-warning/10 text-warning inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
				>
					pool failover
				</span>
			) : null}
			<Chip i={1} label="model" value={telemetry.model.displayName} />
			<Chip
				i={2}
				label="jev"
				value={`${telemetry.jevLatencyMs}ms`}
				title="Time spent in the Jev routing hop only (decision, no text generation)"
			/>
			<Chip
				i={3}
				label="total"
				value={`${telemetry.totalLatencyMs}ms`}
				title="Wall-clock from request start to end of stream, including the answer generation"
			/>
			<Chip
				i={4}
				label="tokens"
				value={`${usage.totalTokens}`}
				title={`${usage.promptTokens} prompt + ${usage.completionTokens} completion`}
			/>
			<Chip i={5} label="cost" value={cost.value} title={cost.title} />
		</div>
	)
}
