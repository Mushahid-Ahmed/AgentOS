import { cn } from '@/lib/cn'
import { CountUp } from '@/components/motion/reveal'

// Dependency-free chart primitives for the executive dashboard (milestone 5).
// No chart library is installed and adding one would pull in a heavy client dep
// for four small visuals, so these are hand-rolled SVG/CSS.
//
// Take 3 (§5) added the draw-in choreography: the sparkline traces itself with
// the existing `gauge-sweep` keyframe, the donut sweeps each arc open from a
// zero-length dash, the bars grow from their left edge, and the two counted
// figures reuse the landing's `CountUp`. All four are CSS/mount-time effects —
// no per-frame React state, and every one is settled instantly by the global
// prefers-reduced-motion guard.
//
// Accessibility contract (DESIGN.md): every chart renders its graphic
// `aria-hidden` and pairs it with a visually-hidden <table> carrying the same
// numbers, so a screen reader gets the real data instead of a vague "image".
// The visible heading/label lives in the surrounding Card, not here. Motion is
// guarded with `motion-reduce:` so prefers-reduced-motion is honored.
//
// Colors come from design tokens via `currentColor` + Tailwind text-* utilities;
// the one exception is the donut, whose per-slice colour is a series token
// reference (var(--series-N) from MODELS) so slices stay neutral and legible on
// both themes — identity is carried by the visible legend, not brand colour.

// Each chart's numbers also exist as a real <table> for assistive tech. The table
// must not carry `sr-only` itself: a table box treats `width`/`max-width: 1px` as a
// suggestion and lays itself out at min-content, so several hundred invisible
// pixels still widened <main> horizontally at 375px — nothing on screen, but a
// real scrollbar for everyone. The clip has to live on a block box, so this div is
// the 1px window and the table is what it hides.
function HiddenDataTable({ children }: { children: React.ReactNode }) {
	return (
		<div className="sr-only">
			<table>{children}</table>
		</div>
	)
}

// --- Live Jev latency gauge -------------------------------------------------
export type LatencyGaugeProps = {
	// The measured value in ms, or null before the first turn is routed.
	valueMs: number | null
	// Upper bound the arc is drawn against. Values above it pin the arc full and
	// are labelled with the real number, so the figure is never clipped silently.
	maxMs: number
	// Accessible name for the hidden table's caption context.
	label: string
	className?: string
}

// A semicircular arc meter. pathLength={1} normalizes the arc so the filled
// fraction is just value/max — no pi*r arithmetic to get wrong.
export function LatencyGauge({ valueMs, maxMs, label, className }: LatencyGaugeProps) {
	const hasValue = valueMs != null
	const fraction = hasValue && maxMs > 0 ? Math.min(1, Math.max(0, valueMs / maxMs)) : 0
	const overMax = hasValue && maxMs > 0 && valueMs > maxMs

	return (
		<div
			className={cn(
				'flex animate-[fade-rise_var(--motion-base)_var(--ease-out-soft)_both] flex-col items-center motion-reduce:animate-none',
				className
			)}
		>
			<svg
				viewBox="0 0 200 110"
				className={cn('w-full max-w-[220px]', overMax ? 'text-warning' : 'text-accent')}
				aria-hidden="true"
			>
				<path
					d="M 20 100 A 80 80 0 0 1 180 100"
					fill="none"
					stroke="currentColor"
					className="text-border-strong"
					strokeWidth="14"
					strokeLinecap="round"
				/>
				<path
					d="M 20 100 A 80 80 0 0 1 180 100"
					fill="none"
					stroke="currentColor"
					strokeWidth="14"
					strokeLinecap="round"
					pathLength={1}
					strokeDasharray={1}
					strokeDashoffset={1 - fraction}
					className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
				/>
			</svg>
			<div className="-mt-6 text-center">
				<span className="text-text font-numeric text-3xl font-semibold">
					{hasValue ? valueMs : 'n/a'}
				</span>
				<span className="text-text-muted ml-1 text-sm">ms</span>
			</div>

			<HiddenDataTable>
				<caption>{label}</caption>
				<tbody>
					<tr>
						<th scope="row">Latest Jev latency</th>
						<td>{hasValue ? `${valueMs} milliseconds` : 'no data yet'}</td>
					</tr>
					<tr>
						<th scope="row">Gauge maximum</th>
						<td>{`${maxMs} milliseconds`}</td>
					</tr>
				</tbody>
			</HiddenDataTable>
		</div>
	)
}

// --- Recent latency sparkline ----------------------------------------------

export type SparklineProps = {
	// Chronological (oldest -> newest) latency samples in ms.
	values: number[]
	label: string
	className?: string
}

export function Sparkline({ values, label, className }: SparklineProps) {
	const width = 240
	const height = 48
	const padded = values.length >= 2 ? values : []
	const max = padded.length > 0 ? Math.max(...padded) : 0
	const min = padded.length > 0 ? Math.min(...padded) : 0
	const span = max - min || 1

	const points = padded
		.map((value, index) => {
			const x = (index / (padded.length - 1)) * width
			// Invert y (SVG grows downward); pad 4px so the line never clips the edge.
			const y = height - 4 - ((value - min) / span) * (height - 8)
			return `${x.toFixed(1)},${y.toFixed(1)}`
		})
		.join(' ')

	return (
		<div className={cn('w-full', className)}>
			{padded.length >= 2 ? (
				<svg
					viewBox={`0 0 ${width} ${height}`}
					preserveAspectRatio="none"
					className="text-accent h-12 w-full"
					aria-hidden="true"
				>
					<polyline
						points={points}
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinejoin="round"
						strokeLinecap="round"
						pathLength={1}
						vectorEffect="non-scaling-stroke"
						className="spark-draw"
					/>
				</svg>
			) : (
				<p className="text-text-faint h-12 text-xs">Not enough turns to draw a trend yet.</p>
			)}
			<HiddenDataTable>
				<caption>{label}</caption>
				<thead>
					<tr>
						<th scope="col">Turn (oldest to newest)</th>
						<th scope="col">Jev latency (ms)</th>
					</tr>
				</thead>
				<tbody>
					{values.map((value, index) => (
						<tr key={index}>
							<th scope="row">{index + 1}</th>
							<td>{value}</td>
						</tr>
					))}
				</tbody>
			</HiddenDataTable>
		</div>
	)
}

// --- Routing distribution donut --------------------------------------------

export type DonutSlice = {
	label: string
	count: number
	// 0..1 of the whole.
	share: number
	// Per-series identity color (a sanctioned literal, see MODELS).
	color: string
}

export type DonutProps = {
	slices: DonutSlice[]
	total: number
	label: string
	className?: string
}

export function Donut({ slices, total, label, className }: DonutProps) {
	const size = 160
	const stroke = 26
	const radius = (size - stroke) / 2
	const circumference = 2 * Math.PI * radius

	// Each slice's dash starts where the preceding slices ended. Computed without
	// mutation (react-hooks/immutability): the offset is the sum of the preceding
	// shares. At most three slices, so the prefix sum is negligible.
	const visible = slices.filter((slice) => slice.count > 0)
	const arcs = visible.map((slice, index) => {
		const precedingShare = visible.slice(0, index).reduce((sum, prior) => sum + prior.share, 0)
		const dash = slice.share * circumference
		return {
			color: slice.color,
			dashArray: `${dash} ${circumference - dash}`,
			dashOffset: -precedingShare * circumference
		}
	})

	return (
		<div className={cn('flex flex-col items-center gap-4', className)}>
			<div className="relative" style={{ width: size, height: size }}>
				<svg
					width={size}
					height={size}
					viewBox={`0 0 ${size} ${size}`}
					className="-rotate-90"
					aria-hidden="true"
				>
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill="none"
						stroke="currentColor"
						className="text-surface-hover"
						strokeWidth={stroke}
					/>
					{arcs.map((arc, index) => (
						<circle
							key={index}
							cx={size / 2}
							cy={size / 2}
							r={radius}
							fill="none"
							stroke={arc.color}
							strokeWidth={stroke}
							strokeDasharray={arc.dashArray}
							strokeDashoffset={arc.dashOffset}
							className="donut-arc"
							style={{ '--i': index, '--c': circumference } as React.CSSProperties}
						/>
					))}
				</svg>
				<div className="absolute inset-0 flex flex-col items-center justify-center">
					<span className="text-text font-numeric text-2xl font-semibold">
						<CountUp to={total} />
					</span>
					<span className="text-text-faint text-xs">turns</span>
				</div>
			</div>

			<HiddenDataTable>
				<caption>{label}</caption>
				<thead>
					<tr>
						<th scope="col">Model</th>
						<th scope="col">Turns</th>
						<th scope="col">Share</th>
					</tr>
				</thead>
				<tbody>
					{slices.map((slice) => (
						<tr key={slice.label}>
							<th scope="row">{slice.label}</th>
							<td>{slice.count}</td>
							<td>{`${Math.round(slice.share * 100)}%`}</td>
						</tr>
					))}
				</tbody>
			</HiddenDataTable>
		</div>
	)
}

// --- Grouped horizontal bar chart (Jev vs judge latency) --------------------

export type BarSeries = {
	name: string
	// Tailwind text-* token utility applied to the bar fill via currentColor.
	colorClass: string
	values: Array<{ label: string; value: number; suffix?: string }>
}

export type BarChartProps = {
	series: BarSeries[]
	// Shared axis maximum so bars across series are comparable. Computed from the
	// data when omitted.
	max?: number
	label: string
	className?: string
}

// CSS bars (not SVG): trivially responsive, and each bar carries a visible value
// label plus the hidden table below, so nothing depends on the graphic.
export function BarChart({ series, max, label, className }: BarChartProps) {
	const dataMax = max ?? Math.max(1, ...series.flatMap((s) => s.values.map((v) => v.value)))

	return (
		<div
			className={cn(
				'flex animate-[fade-rise_var(--motion-base)_var(--ease-out-soft)_both] flex-col gap-4 motion-reduce:animate-none',
				className
			)}
		>
			{series.map((s) => (
				<div key={s.name} className="flex flex-col gap-2">
					<span className="text-text text-sm font-medium">{s.name}</span>
					{s.values.map((v, barIndex) => {
						const pct = Math.min(100, Math.max(0, (v.value / dataMax) * 100))
						return (
							<div key={v.label} className="flex items-center gap-3">
								<span className="text-text-muted w-10 shrink-0 text-xs">{v.label}</span>
								<span className="bg-surface-hover relative h-5 flex-1 overflow-hidden rounded-full">
									<span
										className={cn(
											'absolute inset-y-0 left-0 origin-left rounded-full transition-[width] duration-500 motion-reduce:transition-none',
											'animate-[bar-grow_600ms_var(--ease-expo)_both] motion-reduce:animate-none',
											s.colorClass
										)}
										style={{
											width: `${pct}%`,
											backgroundColor: 'currentColor',
											animationDelay: `${barIndex * 90}ms`
										}}
									/>
								</span>
								<span className="text-text font-numeric w-20 shrink-0 text-right text-xs">
									{v.value}
									{v.suffix ?? 'ms'}
								</span>
							</div>
						)
					})}
				</div>
			))}

			<HiddenDataTable>
				<caption>{label}</caption>
				<thead>
					<tr>
						<th scope="col">Router</th>
						<th scope="col">Statistic</th>
						<th scope="col">Value</th>
					</tr>
				</thead>
				<tbody>
					{series.flatMap((s) =>
						s.values.map((v) => (
							<tr key={`${s.name}-${v.label}`}>
								<th scope="row">{s.name}</th>
								<td>{v.label}</td>
								<td>{`${v.value}${v.suffix ?? 'ms'}`}</td>
							</tr>
						))
					)}
				</tbody>
			</HiddenDataTable>
		</div>
	)
}
