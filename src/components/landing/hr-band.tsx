'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// V6 Job 3: karma's hr-band divider, rebuilt with AgentOS tokens.
//
// The measured DOM (docs/uiux-take6-m1-ground-truth.md §2) is one SVG with
// viewBox "0 0 1320 420", 3 paths at stroke-widths 9 / 9 / 11, stroke-dasharray
// "0px, 1600px", 3 gradients, and a pointer-events-none absolute-inset class.
// The mechanism is one short lit dash on a path that is otherwise a gap, and a
// dashoffset transition that slides it along the path — which is exactly the
// product meaning §3 assigns to this effect: a signal passing under each
// heading as you travel the page.
//
// The dash here is 6× the stroke width rather than karma's 0px: a zero-length
// dash only paints when the renderer honours round caps on empty dashes, and a
// comet that is slightly longer than it is wide is the same gesture with no
// dependency on that edge case.
//
// Direction note, because dashoffset signs are easy to get backwards: with
// `d, gap` the lit window sits at s = offset, so the offset runs POSITIVE from
// 0 to (pathLength − d) to carry the comet from the left edge to the right edge
// and leave it parked there. Going negative would wrap the pattern and slide
// the comet the wrong way.
//
// So the animation is karma's own mechanism, unmodified in kind: dashoffset
// transitions ~1.2s with a 0 / 150 / 300ms stagger, exactly as §6 prescribes,
// and the guide line underneath each dot is an addition, not a substitution —
// an invisible path would make the divider read as nothing but a stray blob,
// and §1.1 protects what exists rather than limiting what may be added.

const DRAW_MS = 1200
const STAGGER_MS = 150

const BAND_W = 1320
const BAND_H = 420
const PATH_LEN = 1600

// Three lanes at different heights and amplitudes so the band reads as depth,
// not as one line drawn three times.
const LANES = [
	{ y: 210, amp: 74, phase: 0, w: 9, pair: ['--flow-input-a', '--flow-input-b'] },
	{ y: 148, amp: 52, phase: 26, w: 9, pair: ['--flow-route-a', '--flow-route-b'] },
	{ y: 286, amp: 60, phase: -34, w: 11, pair: ['--flow-evidence-a', '--flow-evidence-b'] }
]

// One gentle S-curve per lane, entered from the left edge and exited at the
// right, so the dot can travel the whole visible width.
function lanePath(y: number, amp: number, phase: number): string {
	const p = (x: number) => y + amp * Math.sin(((x / BAND_W + phase / 360) * 2 + 0.25) * Math.PI)
	const f = (n: number) => n.toFixed(1)
	return `M ${-60} ${f(p(-60))} C ${f(BAND_W * 0.24)} ${f(p(BAND_W * 0.24))}, ${f(BAND_W * 0.4)} ${f(
		p(BAND_W * 0.4)
	)}, ${f(BAND_W * 0.55)} ${f(p(BAND_W * 0.55))} S ${f(BAND_W * 0.82)} ${f(p(BAND_W * 0.82))}, ${BAND_W + 60} ${f(
		p(BAND_W + 60)
	)}`
}

const PATHS = LANES.map((l) => lanePath(l.y, l.amp, l.phase))

export function HrBand({ className = '' }: { className?: string }) {
	const reduced = useReducedMotion()
	const hostRef = useRef<HTMLDivElement>(null)
	const [lit, setLit] = useState(false)

	useEffect(() => {
		const el = hostRef.current
		if (!el || reduced) return
		const io = new IntersectionObserver(
			(entries) => {
				const visible = entries.some((e) => e.isIntersecting)
				if (!visible) {
					// Re-arm off-screen so every pass gets its own signal.
					setLit(false)
					return
				}
				const id = requestAnimationFrame(() => setLit(true))
				return () => cancelAnimationFrame(id)
			},
			{ threshold: 0.35, rootMargin: '0px 0px -8% 0px' }
		)
		io.observe(el)
		return () => io.disconnect()
	}, [reduced])

	return (
		<div
			ref={hostRef}
			aria-hidden="true"
			className={`pointer-events-none relative h-[12vh] min-h-24 w-full overflow-hidden ${className}`}
		>
			<svg
				viewBox={`0 0 ${BAND_W} ${BAND_H}`}
				preserveAspectRatio="none"
				fill="none"
				className="absolute inset-0 size-full opacity-80"
			>
				<defs>
					{LANES.map((l, i) => (
						<linearGradient
							key={l.pair[0]}
							id={`t6hr-${i}`}
							x1="0"
							y1="0"
							x2="1"
							y2="0"
							gradientUnits="objectBoundingBox"
						>
							<stop offset="0%" stopColor={`var(${l.pair[0]})`} stopOpacity="0.55" />
							<stop offset="100%" stopColor={`var(${l.pair[1]})`} stopOpacity="1" />
						</linearGradient>
					))}
				</defs>
				{LANES.map((l, i) => (
					<path
						key={`guide-${l.pair[0]}`}
						d={PATHS[i]}
						stroke={`url(#t6hr-${i})`}
						strokeWidth={l.w}
						strokeOpacity={reduced ? 0.22 : 0.16}
						strokeLinecap="round"
					/>
				))}
				{LANES.map((l, i) => {
					// The comet's length, and the offset that parks its far edge exactly at
					// the end of the path: lit window is [offset, offset + dash).
					const dash = l.w * 6
					const run = PATH_LEN - dash
					return (
						<path
							key={`dot-${l.pair[0]}`}
							d={PATHS[i]}
							stroke={`url(#t6hr-${i})`}
							strokeWidth={l.w}
							strokeLinecap="round"
							pathLength={PATH_LEN}
							strokeDasharray={`${dash}px, ${PATH_LEN}px`}
							style={
								reduced
									? { strokeDashoffset: run }
									: {
											strokeDashoffset: lit ? run : 0,
											transition: `stroke-dashoffset ${DRAW_MS}ms var(--ease-expo) ${i * STAGGER_MS}ms`
										}
							}
						/>
					)
				})}
			</svg>
		</div>
	)
}
