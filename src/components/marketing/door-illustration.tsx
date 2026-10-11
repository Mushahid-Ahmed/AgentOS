import { cn } from '@/lib/cn'
import { HAIRLINE_PX } from '@/lib/design-tokens'

// Original line-art door, drawn for this product in the style of the reference
// (monochrome hairline door standing ajar on a broken ground line, near-black
// interior speckled with a few stars). Inline SVG only, so strokes stay crisp
// at any zoom/DPR. Decorative — always aria-hidden.
//
// Proportions measured off the reference: door panel ~64x186, interior gap
// ~24 wide, ground line broken around both. `open` controls the swing:
// 'ajar' for login, 'wide' for signup (narrower panel, wider gap).
//
// Painted entirely from tokens (UI/UX run M5) so it belongs to the dark system:
// hairlines in the current text colour, panel in the elevated surface fill, the
// gap in the canvas colour with a faint accent spill from the opening.

const PRESETS = {
	ajar: { doorRight: 152, interiorX: 155, interiorW: 22 },
	wide: { doorRight: 142, interiorX: 145, interiorW: 32 }
} as const

export function DoorIllustration({
	open = 'ajar',
	className
}: {
	open?: keyof typeof PRESETS
	className?: string
}) {
	const p = PRESETS[open]
	return (
		<svg
			viewBox="0 0 260 230"
			role="presentation"
			aria-hidden="true"
			focusable="false"
			className={cn('text-text', className)}
			style={{ shapeRendering: 'geometricPrecision' }}
		>
			{/* Ground line, broken around the door. */}
			<g stroke="currentColor" strokeOpacity="0.28" strokeWidth={HAIRLINE_PX}>
				<line x1="6" y1="218" x2="92" y2="218" vectorEffect="non-scaling-stroke" />
				<line x1="186" y1="218" x2="254" y2="218" vectorEffect="non-scaling-stroke" />
			</g>

			{/* The dark interior revealed by the gap. */}
			<rect x={p.interiorX} y="20" width={p.interiorW} height="198" fill="var(--bg)" />
			{/* Light from beyond: a hairline of accent down the opening edge. */}
			<rect x={p.interiorX} y="20" width="1.5" height="198" fill="var(--accent)" opacity="0.45" />
			<g fill="var(--text)">
				<circle className="door-star" cx={p.interiorX + 8} cy="60" r="0.9" opacity="0.85" />
				<circle
					className="door-star"
					cx={p.interiorX + 15}
					cy="105"
					r="0.8"
					opacity="0.7"
					style={{ animationDelay: '0.9s' }}
				/>
				<circle
					className="door-star"
					cx={p.interiorX + 5}
					cy="150"
					r="0.7"
					opacity="0.6"
					style={{ animationDelay: '1.7s' }}
				/>
				<circle
					className="door-star"
					cx={p.interiorX + 13}
					cy="190"
					r="0.6"
					opacity="0.55"
					style={{ animationDelay: '2.4s' }}
				/>
			</g>

			{/* Door panel in perspective + its thickness edge. */}
			<g fill="var(--surface-hover)" stroke="currentColor" strokeWidth={HAIRLINE_PX}>
				<polygon points={`96,26 ${p.doorRight},16 ${p.doorRight},220 96,210`} />
				<polygon
					points={`${p.doorRight},16 ${p.interiorX},16.6 ${p.interiorX},220 ${p.doorRight},220`}
				/>
			</g>

			{/* Handle: a short rail + small plate on the opening edge. */}
			<g stroke="currentColor" strokeWidth={HAIRLINE_PX} fill="var(--surface-hover)">
				<line
					x1={p.doorRight - 10}
					y1="118"
					x2={p.doorRight - 2}
					y2="118"
					vectorEffect="non-scaling-stroke"
				/>
				<rect x={p.doorRight - 4} y="113" width="2.6" height="10" />
			</g>
		</svg>
	)
}
