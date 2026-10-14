'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { holdScroll, releaseScroll } from '@/lib/motion/scroll-engine'

// V22 — the proof gate, on the evidence section's own claim: *nothing ships without
// proof*. A run pill slides down the gate line and the two D4 jaws slam shut on it;
// the impact blooms, rings, spits four sparks and thuds through the figures above it,
// then the shut gate flares to the full width of the page and dissolves. One impact,
// not two, and the gesture is a closing rather than the shatter the reference site
// uses, because what this product does to a claim is gate it, not break it.
//
// The whole sequence lives inside the section's own bottom padding (`.v22-gate` is a
// 7rem band clipped to `sm:py-28`, which is exactly that padding), so a mark cannot
// reach a figure at any viewport width — the geometry is the guarantee, not a value
// tuned for one screenshot.
//
// While it plays, scrolling is held (see `holdScroll`), the way a scroll-triggered
// moment has to be to be seen at all. It fires once per page load, only on the wide
// layout the V7 camera runs on, and renders nothing at all under reduced motion.
//
// Only transform and opacity animate. Every mark is static markup, so server and
// client HTML agree, and the resting DOM carries no transform for the camera or the
// card tilts to collide with.

const VB_W = 1440
const VB_H = 112
const CX = VB_W / 2
/** The gate line: the vertical middle of the band, so every mark has room on both sides. */
const AXIS = VB_H / 2
/** Half the shut gate, in viewBox units. */
const JAW = 380
/** The show runs to 1.82s; the hold is a beat longer, so the last frame settles before
    the wheel comes back rather than being cut off by it. */
const HOLD_MS = 2000
/** The V7 camera stands down below this width, and so does the gate: its geometry is
    read against the camera's framing. */
const WIDE_QUERY = '(min-width: 1024px)'
/** A reload that lands mid-section must not steal the wheel on the first frame. */
const ARM_AFTER_MS = 1200

const SPARKS = [-7, 7, 173, 187] as const

export function ProofGate() {
	const reduced = useReducedMotion()
	const hostRef = useRef<HTMLDivElement>(null)
	const [playing, setPlaying] = useState(false)

	// The gate shuts when the section is framed, not when it first appears: with the
	// page receding through the camera its *visual* box is what matters, so both checks
	// read getBoundingClientRect (which includes the camera's transform). The gate band
	// has to be sitting in the lower half of the viewport, fully on screen, and the
	// section has to have come up to about a third of it — that pair is satisfiable at
	// every viewport height, which a "the section covers the middle" test is not: on a
	// 1440-tall window a 608px section can never cover 78% of it, and the gate would
	// simply never fire.
	useEffect(() => {
		if (reduced || !window.matchMedia(WIDE_QUERY).matches) return
		const host = hostRef.current
		// The overlay is only the gate band at the bottom of the section, so the framing
		// is read off the section itself.
		const el = host?.closest('section') ?? null
		if (!el || !host) return

		const armed = performance.now() + ARM_AFTER_MS
		let raf = 0
		let done = false

		const check = () => {
			raf = 0
			if (done) return
			if (performance.now() < armed) return
			const vh = window.innerHeight || 1
			const band = host.getBoundingClientRect()
			const r = el.getBoundingClientRect()
			if (band.top >= vh * 0.5 && band.bottom <= vh * 0.96 && r.top <= vh * 0.3) {
				done = true
				setPlaying(true)
				window.removeEventListener('scroll', schedule)
				window.removeEventListener('resize', schedule)
			}
		}
		const schedule = () => {
			if (!raf && !done) raf = requestAnimationFrame(check)
		}

		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule)
		schedule()

		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
		}
	}, [reduced])

	// The hold belongs to the show, so unmounting mid-flight hands the scroll back
	// instead of leaving the fuse as the only way out.
	useEffect(() => {
		if (!playing) return
		holdScroll(HOLD_MS)
		return () => releaseScroll()
	}, [playing])

	// Nothing is rendered at all under reduced motion: the layer is the show, and a
	// reader who asked for less motion gets the section exactly as V21 left it.
	if (reduced) return null

	return (
		<div
			ref={hostRef}
			aria-hidden="true"
			data-v22={playing ? 'playing' : 'idle'}
			className="v22-gate"
		>
			<svg
				viewBox={`0 0 ${VB_W} ${VB_H}`}
				preserveAspectRatio="none"
				fill="none"
				className="v22-svg"
			>
				<defs>
					<radialGradient id="v22-bloom">
						<stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" />
						<stop offset="45%" stopColor="var(--accent)" stopOpacity="0.1" />
						<stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
					</radialGradient>
				</defs>

				<ellipse
					className="v22-flash"
					cx={CX}
					cy={AXIS}
					rx={210}
					ry={52}
					fill="url(#v22-bloom)"
				/>

				{/* The claim arrives first, and the gate closes on it. The outer group puts
				    it on the gate line; the animated one slides it in from off page, because a
				    CSS transform on an element replaces its transform attribute entirely. */}
				<g transform={`translate(${CX} ${AXIS})`}>
					<g className="v22-run">
						<rect className="v22-claim" x={-26} y={-9} width={52} height={18} rx={9} />
					</g>
				</g>

				<g className="v22-jaws">
					<rect
						className="v22-jaw"
						x={CX - JAW}
						y={AXIS - 3}
						width={JAW}
						height={6}
						rx={3}
						style={{ '--v22-dir': -1 } as CSSProperties}
					/>
					<rect
						className="v22-jaw"
						x={CX}
						y={AXIS - 3}
						width={JAW}
						height={6}
						rx={3}
						style={{ '--v22-dir': 1 } as CSSProperties}
					/>
				</g>

				<circle className="v22-ring" cx={CX} cy={AXIS} r={24} />

				<g transform={`translate(${CX} ${AXIS}) rotate(45)`}>
					<rect className="v22-seal" x={-8} y={-8} width={16} height={16} rx={2} />
				</g>

				{SPARKS.map((a, i) => (
					<g key={a} transform={`translate(${CX} ${AXIS}) rotate(${a})`}>
						<rect
							className="v22-spark"
							x={34}
							y={-2}
							width={210}
							height={4}
							rx={2}
							style={{ '--step': i } as CSSProperties}
						/>
					</g>
				))}
			</svg>
		</div>
	)
}
