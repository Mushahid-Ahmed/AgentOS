'use client'

import type { CSSProperties } from 'react'
import { useIdlePause } from '@/lib/motion/use-idle-pause'
import { scrubSlice, useScrub } from '@/lib/motion/use-scrub'

// V6 Job 4: karma's cable bundle (§7) — a fat gradient trunk with 22 dashed
// satellites behind the cards of the darkest section. This element is z-0 and the
// section's cards stay z-10, so the bundle can never cover a number in the table.
//
// The two facts that are not obvious from the code:
//   • Scroll reveal rides stroke-dashoffset (trunk) and stroke-opacity (strands);
//     the marching loop also writes stroke-dashoffset, so the trunk is the only
//     element that does both — the strands keep their rhythm and light up instead.
//   • The march travels 2700 units, the LCM of the three rhythm periods (12, 54,
//     150), so every rhythm returns to its starting phase at the end of the loop.
//     A shorter travel visibly jumps.
// Reduced motion pins the scrub at 1 and the global guard stops the march.

const VB_W = 1440
const VB_H = 720
const TRUNK_D = 'M-80 820C260 780 420 640 620 560S1020 420 1180 300 1420 120 1540 60'

// [dash-on, dash-off] in viewBox units: karma's three groups.
const RHYTHMS = [
	[2, 10],
	[40, 14],
	[120, 30]
] as const

const MARCH_UNITS = 2700
// Seconds per 2700 units, by rhythm group — fine threads march fastest.
const MARCH_SECONDS = [9, 21, 46]

const PAIRS = [
	['--flow-input-a', '--flow-input-b'],
	['--flow-route-a', '--flow-route-b'],
	['--flow-evidence-a', '--flow-evidence-b']
] as const

const SATELLITES = Array.from({ length: 22 }, (_, i) => {
	const t = i / 21
	// The cable enters bottom-left and exits top-right, so the fan is offset
	// mostly horizontally and only a little vertically; a pure vertical offset
	// would stack the strands into a wall.
	const dx = -64 + 128 * t
	const dy = 96 - 192 * t
	return {
		i,
		dx,
		dy,
		g: i % 3,
		width: 1 + (i % 5) * 0.18,
		// Strands near the trunk light first, so the bundle fills outward.
		from: 0.06 + 0.5 * Math.abs(t - 0.5)
	}
})

export function CableBundle({ className = '' }: { className?: string }) {
	const [hostRef, p] = useScrub<HTMLDivElement>(0.9)
	useIdlePause(hostRef, '160px')
	const trunk = scrubSlice(p, 0, 0.8)

	return (
		<div
			ref={hostRef}
			aria-hidden="true"
			className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}
		>
			<svg
				viewBox={`0 0 ${VB_W} ${VB_H}`}
				preserveAspectRatio="xMidYMid slice"
				fill="none"
				className="size-full opacity-90"
			>
				<defs>
					{PAIRS.map((pair, i) => (
						<linearGradient key={pair[0]} id={`t6cb-${i}`} x1="0" y1="1" x2="1" y2="0">
							<stop offset="0%" stopColor={`var(${pair[0]})`} stopOpacity="0.25" />
							<stop offset="100%" stopColor={`var(${pair[1]})`} stopOpacity="1" />
						</linearGradient>
					))}
				</defs>

				{/* The trunk: karma's fat gradient cable, drawn on by scroll. */}
				<path
					d={TRUNK_D}
					stroke="url(#t6cb-1)"
					strokeWidth={60}
					strokeOpacity={0.16}
					strokeLinecap="round"
					pathLength={1}
					strokeDasharray={1}
					strokeDashoffset={1 - trunk}
				/>

				{SATELLITES.map((s) => {
					const rhythm = RHYTHMS[s.g] ?? RHYTHMS[0]
					const style = {
						animationDuration: `${MARCH_SECONDS[s.g] ?? MARCH_SECONDS[0]}s`,
						'--v6-march-units': `${-MARCH_UNITS}px`
					} as CSSProperties
					return (
						<path
							key={s.i}
							d={TRUNK_D}
							transform={`translate(${s.dx} ${s.dy})`}
							stroke={`url(#t6cb-${s.g})`}
							strokeWidth={s.width}
							strokeLinecap="round"
							strokeDasharray={`${rhythm[0]} ${rhythm[1]}`}
							// Scroll lights the strand; the march moves its dashes.
							strokeOpacity={0.1 + 0.34 * scrubSlice(p, s.from * 0.6, 0.45)}
							className="v6-march"
							style={style}
						/>
					)
				})}
			</svg>
		</div>
	)
}
