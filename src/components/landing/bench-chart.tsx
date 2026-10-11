'use client'

import { scrubSlice, useScrub } from '@/lib/motion/use-scrub'
import { cn } from '@/lib/cn'

// Animated benchmark chart (brief §6.2-10): the four setups from run #6's
// 24-task comparison drawn as bars that grow on scroll. Every number is the
// measured one — the chart is a second reading of the table below it, not a
// nicer story. Each metric scales to its own best, so the gaps are the real
// ratios, and the winner of each metric is the accent bar (higher score wins;
// lower cost and latency win).
//
// V4 §4's choreography on top of that: the chart's own grid lines draw first,
// then the bars grow in staggered order, and the *metric winner goes last* so it
// arrives after the field and overshoots into its measured length with a spring.
//
// What §4 asks for and what the data allows are not the same request. The brief
// pictures AgentOS growing past the competitors; in the real run-#6 numbers the
// full AgentOS setup is the priciest and the slowest, and it is not the best
// value of any of the three metrics. Staging "AgentOS wins" would mean either
// re-ordering so D lands last with the overshoot while scoring 0.90 against C's
// 0.92, or drawing a bar past its measurement. So the winner beat is attached to
// the honest winner — per metric, whichever setup actually holds the best number
// — and the bars keep their true ratios. §1.2 ("don't break existing
// functionality") and §7 (anti-hallucination) outrank one animation direction.

export type BenchRow = {
	setup: string
	score: number
	cost: number
	latency: number
}

type Metric = {
	key: keyof Omit<BenchRow, 'setup'>
	label: string
	fmt: (v: number) => string
	higherIsBetter: boolean
}

const METRICS: Metric[] = [
	{
		key: 'score',
		label: 'Avg judge score',
		fmt: (v) => v.toFixed(2),
		higherIsBetter: true
	},
	{
		key: 'cost',
		label: 'Avg cost / task',
		fmt: (v) => `$${v.toFixed(6)}`,
		higherIsBetter: false
	},
	{
		key: 'latency',
		label: 'Avg latency',
		fmt: (v) => `${v.toFixed(1)} s`,
		higherIsBetter: false
	}
]

// Spring overshoot on the winner's own progress: the bar reaches 107% of its
// measured length at 80% of its window, then settles back to exactly 1. It is a
// function of the scrub, not of time, so a scroll jump cannot leave the bar
// frozen mid-overshoot — wherever the wheel stops, the geometry is the same one
// the same position produced on the way down.
function overshoot(t: number): number {
	const q = Math.min(1, Math.max(0, t))
	return q < 0.8 ? (q / 0.8) * 1.07 : 1.07 - (0.07 * (q - 0.8)) / 0.2
}

export function BenchChart({ rows }: { rows: readonly BenchRow[] }) {
	const [ref, p] = useScrub<HTMLDivElement>(1.1)
	// The grid draws itself first (§4), before any bar moves.
	const grid = scrubSlice(p, 0.04, 0.3)

	return (
		<div
			ref={ref}
			data-t2="bench"
			className="border-border relative mt-12 grid gap-px rounded-xl border sm:grid-cols-3"
		>
			<span
				aria-hidden
				data-t4="bench-grid"
				className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
			>
				{[0.25, 0.5, 0.75].map((x) => (
					<span
						key={x}
						className="bg-border absolute inset-y-0 w-px origin-top"
						style={{ left: `${x * 100}%`, transform: `scaleY(${grid.toFixed(3)})` }}
					/>
				))}
			</span>

			{METRICS.map((m, mi) => {
				const values = rows.map((r) => r[m.key])
				const max = Math.max(...values)
				const best = m.higherIsBetter ? max : Math.min(...values)
				const metric = scrubSlice(p, 0.18 + mi * 0.1, 0.5)
				// Field first, winner last — the beat the brief asks for, given to the
				// setup that actually earned the number.
				const fieldSize = rows.filter((r) => r[m.key] !== best).length
				return (
					<div key={m.key} className="p-5">
						<div className="label-uppercase text-text-faint">{m.label}</div>
						<div className="mt-4 flex flex-col gap-3">
							{rows.map((r, i) => {
								const v = r[m.key]
								const isBest = v === best
								const rank = isBest
									? fieldSize
									: rows.slice(0, i).filter((x) => x[m.key] !== best).length
								const t = scrubSlice(metric, rank * 0.11, 0.4)
								const grow = isBest ? overshoot(t) : t
								const landed = isBest && t > 0.985
								return (
									<div key={r.setup} className="min-w-0">
										<div className="flex items-baseline justify-between gap-2">
											<span className="text-text-muted truncate font-mono text-[10.5px]">
												{r.setup}
											</span>
											<span
												className={cn(
													'font-numeric relative shrink-0 text-[11px]',
													isBest ? 'text-accent' : 'text-text-faint'
												)}
											>
												{m.fmt(v)}
												{/* §4's arrival flash on the winning number. It ends at
												    opacity 0, so the reduced-motion guard leaves nothing
												    behind — the number itself is the settled state. */}
												{landed && (
													<span
														aria-hidden
														data-t4="bench-ding"
														className="bench-ding border-accent absolute -inset-x-1 -inset-y-0.5 rounded-full border"
													/>
												)}
											</span>
										</div>
										<div className="bg-surface-hover mt-1.5 h-1.5 overflow-hidden rounded-full">
											<div
												className={cn(
													'bench-bar h-1.5 rounded-full',
													isBest ? 'bg-accent' : 'bg-border-strong'
												)}
												style={
													{
														width: `${((v / max) * 100).toFixed(2)}%`,
														transform: `scaleX(${grow.toFixed(3)})`,
														transformOrigin: 'left center',
														// §4's "gradient intensifies": the wash strengthens with
														// the bar instead of switching on at the end.
														'--g': t.toFixed(3)
													} as React.CSSProperties
												}
											/>
										</div>
									</div>
								)
							})}
						</div>
					</div>
				)
			})}
		</div>
	)
}
