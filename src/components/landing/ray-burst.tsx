'use client'

import { useEffect, useRef, useState } from 'react'
import { useIdlePause } from '@/lib/motion/use-idle-pause'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// V6 Job 5: karma's ray hub burst (§8) behind the models & routing section.
//
// One hub at (720, 640) throws 19 quadratic spokes across the upper half of the
// box. The spoke COUNT is not invented: the caller passes the real lengths of
// the product's own decision arrays (agent roles, task types, model routes,
// complexity tiers), and each array becomes one visual family — its own width
// band, gradient and radius ring — so the burst is a picture of the orchestra's
// vocabulary rather than 19 random lines.
//
// The two facts that are not obvious from the code:
//   • Each path STARTS at the hub, so dashoffset 1 -> 0 grows the ray outward
//     from the hub (§8's direction). A path drawn hub-wards would reveal from
//     the node instead, which is the opposite gesture.
//   • No text is rendered. §8 wants the hub to be an existing product element
//     and §11 forbids invented copy, so the hub is geometry only and its
//     identity comes from the ModelRoutes list the rays point at.
// Reduced motion renders the finished burst and stops the pulse (global guard).

const HUB_X = 720
const HUB_Y = 640
const VB_W = 1440
const VB_H = 680
const DRAW_MS = 1100
const STAGGER_MS = 45

export type RayGroup = {
	/** Existing product array; used only for its length. Never rendered. */
	id: string
	count: number
}

// Per-family geometry: width inside §8's 6-10px band, radius ring, colour pair.
const FAMILY = [
	{ w: 10, r: 512, pair: ['--flow-input-a', '--flow-input-b'] as const },
	{ w: 9, r: 468, pair: ['--flow-route-a', '--flow-route-b'] as const },
	{ w: 7, r: 552, pair: ['--flow-evidence-a', '--flow-evidence-b'] as const },
	{ w: 6, r: 424, pair: ['--flow-route-b', '--flow-input-b'] as const }
] as const

const PHI_MIN = 0.07 * Math.PI
const PHI_MAX = 0.93 * Math.PI

function spokePath(hubX: number, hubY: number, phi: number, radius: number, bend: number) {
	const ex = hubX + radius * Math.cos(phi)
	const ey = hubY - radius * Math.sin(phi)
	// The control point sits a little inside the chord and rotated toward the
	// vertical, so rays bow outward from the hub instead of running straight.
	const cx = hubX + radius * 0.46 * Math.cos(phi + bend)
	const cy = hubY - radius * 0.46 * Math.sin(phi + bend)
	return {
		d: `M ${hubX} ${hubY} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
		// Comet centres are quantised: Node's V8 and Chrome's V8 can disagree in the
		// last bit of Math.sin/cos, and a raw float hydrates as a different attribute
		// string on each side.
		ex: Number(ex.toFixed(2)),
		ey: Number(ey.toFixed(2))
	}
}

export function RayBurst({ groups, className = '' }: { groups: RayGroup[]; className?: string }) {
	const hostRef = useRef<HTMLDivElement>(null)
	const reduced = useReducedMotion()
	const [lit, setLit] = useState(false)
	// The hub breathes forever once the burst has fired, so its host is marked idle
	// when it leaves the viewport (its own observer — the one below only decides
	// whether the burst is lit, and re-arms at a 30% threshold).
	useIdlePause(hostRef, '160px')

	useEffect(() => {
		const el = hostRef.current
		if (!el || reduced) return
		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					// Re-arm on exit, so every pass through the section redraws the burst.
					const next = entry.isIntersecting
					setLit((prev) => (prev === next ? prev : next))
				}
			},
			{ threshold: 0.3, rootMargin: '0px 0px -8% 0px' }
		)
		io.observe(el)
		return () => io.disconnect()
	}, [reduced])

	const total = groups.reduce((n, g) => n + g.count, 0)
	// Deterministic fan (no Math.random: the server and the client must render
	// identical markup). Spokes are ordered by family, so each family occupies
	// its own arc of the burst.
	const rays = groups.flatMap((g, gi) => {
		const fam = FAMILY[gi % FAMILY.length] ?? FAMILY[0]
		const start = groups.slice(0, gi).reduce((n, q) => n + q.count, 0)
		return Array.from({ length: g.count }, (_, k) => {
			const i = start + k
			const t = total > 1 ? i / (total - 1) : 0.5
			const phi = PHI_MIN + (PHI_MAX - PHI_MIN) * t
			// A small per-ray radius wobble keeps the ring from looking machined.
			const radius = fam.r + 26 * Math.sin(i * 2.3)
			const bend = (phi < Math.PI / 2 ? 1 : -1) * 0.22
			const { d, ex, ey } = spokePath(HUB_X, HUB_Y, phi, radius, bend)
			return { i, d, ex, ey, gi, w: fam.w, pair: fam.pair }
		})
	})

	return (
		<div
			ref={hostRef}
			aria-hidden="true"
			className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}
		>
			<svg
				viewBox={`0 0 ${VB_W} ${VB_H}`}
				preserveAspectRatio="xMidYMax slice"
				fill="none"
				className="size-full opacity-70"
			>
				<defs>
					{FAMILY.map((f, i) => (
						<linearGradient key={f.pair[0]} id={`t6rb-${i}`} x1="0" y1="1" x2="1" y2="0">
							<stop offset="0%" stopColor={`var(${f.pair[0]})`} stopOpacity="0.2" />
							<stop offset="100%" stopColor={`var(${f.pair[1]})`} stopOpacity="1" />
						</linearGradient>
					))}
					<radialGradient id="t6rb-hub" cx="0.5" cy="0.5" r="0.5">
						<stop offset="0%" stopColor="var(--flow-input-b)" stopOpacity="0.9" />
						<stop offset="100%" stopColor="var(--flow-input-a)" stopOpacity="0" />
					</radialGradient>
				</defs>

				{rays.map((r) => (
					<path
						key={r.i}
						d={r.d}
						stroke={`url(#t6rb-${r.gi})`}
						strokeWidth={r.w}
						strokeLinecap="round"
						strokeOpacity={0.28}
						pathLength={1}
						strokeDasharray={1}
						style={
							reduced
								? { strokeDashoffset: 0 }
								: {
										strokeDashoffset: lit ? 0 : 1,
										transition: `stroke-dashoffset ${DRAW_MS}ms var(--ease-expo) ${r.i * STAGGER_MS}ms`
									}
						}
					/>
				))}
				{rays.map((r) => (
					<circle
						key={`n-${r.i}`}
						cx={r.ex}
						cy={r.ey}
						r={2.2 + r.w * 0.32}
						fill={`url(#t6rb-${r.gi})`}
						style={
							reduced
								? { opacity: 0.5 }
								: {
										opacity: lit ? 0.5 : 0,
										transition: `opacity ${DRAW_MS}ms var(--ease-expo) ${r.i * STAGGER_MS + 260}ms`
									}
						}
					/>
				))}

				{/* Hub: the orchestra itself. Compositor-only breathing (§8). */}
				<g className="v6-hub">
					<circle cx={HUB_X} cy={HUB_Y} r={86} fill="url(#t6rb-hub)" />
					<circle
						cx={HUB_X}
						cy={HUB_Y}
						r={34}
						stroke="var(--flow-route-a)"
						strokeOpacity="0.5"
						strokeWidth="2"
					/>
					<circle cx={HUB_X} cy={HUB_Y} r={9} fill="var(--flow-input-b)" fillOpacity="0.75" />
				</g>
			</svg>
		</div>
	)
}
