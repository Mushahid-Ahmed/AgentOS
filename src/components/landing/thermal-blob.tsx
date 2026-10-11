'use client'

import { useScrub } from '@/lib/motion/use-scrub'

// V6 Job 7 (§10): the thermal blob. The landing is a single dark theme, so there
// is no "boundary between contrasting sections" to put a blob on — §10's own
// fallback applies and the heat maps to the accent shift at the CTA boundary,
// where the page leaves its evidence vocabulary and becomes the offer.
//
// Two things make this cheap enough to ship:
//   • The blur is baked into a SMALL layer (260px) that is then scaled up, so the
//     filtered surface stays tiny; a full-width blurred gradient would re-rasterise
//     a 1440x420 box on every write.
//   • Nothing animates `filter`. The scroll-linked hue travel is three pre-coloured
//     gradient layers crossfaded on OPACITY while the whole sheet moves on
//     TRANSFORM, so every frame the compositor gets is a transform + two opacity
//     steps instead of a new blur. Rotating one layer's hue through the required
//     165° would also drag --flow-input-b past magenta, which is off the house
//     palette (§11.7).
//
// Progress comes from useScrub, so there is no frame loop and reduced motion pins
// the blob at its settled state without attaching a listener.

// Centres of the three colour weights along the scroll band.
const LAYERS = [
	{ at: 0.18, color: 'var(--flow-input-b)', r: 0.46 },
	{ at: 0.55, color: 'var(--flow-route-a)', r: 0.44 },
	{ at: 0.92, color: 'var(--flow-route-b)', r: 0.46 }
]

const SIZE = 260
const SCALE = 2.35

export function ThermalBlob({ className = '' }: { className?: string }) {
	const [ref, p] = useScrub<HTMLDivElement>(1.35)

	// Total weight, so the sheet never dims between two layers (a plain max() of
	// the three would leave a dip where the falloffs cross).
	const weights = LAYERS.map((l) => Math.max(0, 1 - Math.abs(p - l.at) / l.r))
	const sum = weights.reduce((a, b) => a + b, 0) || 1

	// The blob enters from the boundary line and drifts across the section as the
	// CTA takes the viewport; a slow scale carries it forward with the travel.
	const x = (p - 0.5) * 34
	const y = 6 + p * 30
	const s = SCALE * (0.82 + 0.3 * Math.min(1, p * 1.25))

	return (
		<div
			ref={ref}
			aria-hidden="true"
			data-t6="thermal-blob"
			className={`pointer-events-none absolute inset-x-0 top-0 z-0 h-[46vh] min-h-[300px] overflow-hidden ${className}`}
		>
			<div
				style={{
					position: 'absolute',
					left: '50%',
					top: 0,
					width: SIZE,
					height: SIZE,
					marginLeft: -SIZE / 2,
					filter: 'blur(34px)',
					willChange: 'transform',
					transform: `translate3d(${x.toFixed(2)}%, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`
				}}
			>
				{LAYERS.map((l, i) => (
					<div
						key={l.color}
						className="absolute inset-0"
						style={{
							opacity: (0.62 * ((weights[i] ?? 0) / sum)).toFixed(4),
							background: `radial-gradient(closest-side, ${l.color} 0%, transparent 72%)`
						}}
					/>
				))}
			</div>
		</div>
	)
}
