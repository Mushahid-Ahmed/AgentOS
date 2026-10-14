'use client'

import type { CSSProperties } from 'react'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// V21: the benchmark section's arrival. A task token falls onto the section and the
// impact fans out along ROUTING-shaped legs (a trunk that bends once, like a
// decision forking), then a second, heavier strike lands and its fan is wider. The
// whole thing is one shot, keyed off [data-v21="playing"], and it lives behind the
// cards (z-5, between the cable bundle at z-0 and the numbers at z-10) so it can
// never cover a measured figure.
//
// Two properties carry all of it: transform/opacity on the token and rings, and
// stroke-dashoffset on the legs (pathLength=1, so one dash covers any leg length).
// No rAF loop, no layout property, and the legs are static markup, so the server and
// client HTML agree.

const VB_W = 1440
const VB_H = 900

type Strike = {
	cls: 'a' | 'b'
	x: number
	y: number
	legs: number
	reach: number
}

// Where the two impacts land, in viewBox units. The section box is 1440x1033 on a
// 1440-wide viewport and `slice` scales the 1440x900 viewBox to cover it, so the
// visible band is roughly y 0..780 — a strike placed below that happens off screen.
// Both land in the upper band, left of and above the figures: the fans frame the
// numbers instead of crossing them, which is the same rule the cable bundle follows.
const STRIKES: Strike[] = [
	{ cls: 'a', x: 330, y: 300, legs: 9, reach: 210 },
	{ cls: 'b', x: 1010, y: 250, legs: 15, reach: 330 }
]

// Deterministic, because a random fan would differ between the server render and
// the client hydration and the legs would jump.
const jitter = (i: number, salt: number) => {
	const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
	return v - Math.floor(v)
}

// One leg = a trunk out of the impact point, then a single bend. The fan is squashed
// vertically (0.62) so it reads as a fracture lying on the page, not a starburst.
const fan = (s: Strike) =>
	Array.from({ length: s.legs }, (_, i) => {
		const spread = (i / s.legs) * Math.PI * 2
		const a1 = spread + (jitter(i, 1) - 0.5) * 0.5
		const len1 = s.reach * (0.42 + jitter(i, 2) * 0.5)
		const x1 = Math.cos(a1) * len1
		const y1 = Math.sin(a1) * len1 * 0.62
		const bend = a1 + (jitter(i, 3) - 0.5) * 1.15
		const len2 = s.reach * (0.18 + jitter(i, 4) * 0.36)
		return `M0 0L${x1.toFixed(1)} ${y1.toFixed(1)}L${(x1 + Math.cos(bend) * len2).toFixed(1)} ${(
			y1 +
			Math.sin(bend) * len2 * 0.62
		).toFixed(1)}`
	})

export function RoutingStrike() {
	const reduced = useReducedMotion()
	const [hostRef, playing] = useInView<HTMLDivElement>(0.16)

	// The effect's end state is invisible, so there is nothing to settle into: under
	// reduced motion the layer is simply absent, and the content wrapper it thuds on
	// keeps its own transforms untouched.
	if (reduced) return null

	return (
		<div
			ref={hostRef}
			aria-hidden="true"
			data-v21={playing ? 'playing' : 'idle'}
			className="v21-strike"
		>
			<svg
				viewBox={`0 0 ${VB_W} ${VB_H}`}
				preserveAspectRatio="xMidYMid slice"
				fill="none"
				className="v21-fan"
			>
				<defs>
					<radialGradient id="v21-flash">
						<stop offset="0%" stopColor="var(--accent)" stopOpacity="0.5" />
						<stop offset="55%" stopColor="var(--accent)" stopOpacity="0.12" />
						<stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
					</radialGradient>
				</defs>
				{STRIKES.map((s) => (
					<g key={s.cls} transform={`translate(${s.x} ${s.y})`}>
						{fan(s).map((d, i) => (
							<path
								key={i}
								d={d}
								pathLength={1}
								className={`v21-crack v21-crack-${s.cls}`}
								// Each leg starts 20-26ms after the previous one, so the fracture
								// travels outward instead of appearing all at once.
								style={{ '--step': i } as CSSProperties}
							/>
						))}
						<circle className={`v21-flash v21-flash-${s.cls}`} r={150} fill="url(#v21-flash)" />
						<circle className={`v21-ring v21-ring-${s.cls}`} r={26} />
						<rect
							className={`v21-token v21-token-${s.cls}`}
							x={-9}
							y={-9}
							width={18}
							height={18}
							rx={2}
						/>
					</g>
				))}
			</svg>
		</div>
	)
}
