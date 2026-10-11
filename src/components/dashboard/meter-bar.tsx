'use client'
import { cn } from '@/lib/cn'

// One inline horizontal meter with a formatted value label, shared by the Spend and
// Model-usage panels. A small local primitive because the dashboard's BarChart is
// latency-shaped (it appends "ms" and prints raw numbers), which would mislabel money
// and call counts. The bar is decorative (`role="img"` with a text alternative); the
// real numbers are the visible label and the surrounding tables.
export function MeterBar({
	label,
	valueText,
	fraction,
	colorClass,
	colorStyle,
	hint
}: {
	label: string
	valueText: string
	// 0..1 of the axis maximum.
	fraction: number
	// A Tailwind bg-* token utility (caps, accent bars)…
	colorClass?: string
	// …or an inline CSS color for the series tokens (var(--series-N)), which have no
	// bg-* utility. One of the two supplies the fill.
	colorStyle?: string
	hint?: string
}) {
	const pct = Math.min(100, Math.max(0, fraction * 100))
	return (
		<div className="flex flex-col gap-1">
			{label || valueText ? (
				<div className="flex items-center justify-between gap-3 text-xs">
					<span className="text-text truncate font-medium">{label}</span>
					<span className="text-text-muted shrink-0 font-mono tabular-nums">
						{valueText}
						{hint ? <span className="text-text-faint ml-1">{hint}</span> : null}
					</span>
				</div>
			) : null}
			<span
				className="bg-surface-hover h-2 w-full overflow-hidden rounded-full"
				role="img"
				aria-label={`${label}: ${valueText}`}
			>
				<span
					className={cn(
						'block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
						colorClass
					)}
					style={{ width: `${pct}%`, ...(colorStyle ? { backgroundColor: colorStyle } : {}) }}
				/>
			</span>
		</div>
	)
}
