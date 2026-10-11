// A fixed, pointer-transparent film-grain layer for texture, painted over the
// whole UI at a very low opacity (var(--grain-opacity)) with a soft-light blend
// so it reads as film, not dirt. Inline SVG feTurbulence — no image asset, no
// external request. Server-safe (no 'use client', no interactivity).

export function GrainOverlay() {
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed inset-0 z-40 opacity-(--grain-opacity) mix-blend-soft-light"
		>
			<svg className="h-full w-full">
				<filter id="jev-grain">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.85"
						numOctaves={2}
						stitchTiles="stitch"
					/>
					<feColorMatrix type="saturate" values="0" />
				</filter>
				<rect width="100%" height="100%" filter="url(#jev-grain)" />
			</svg>
		</div>
	)
}
