'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// V6 Job 6 (§9): karma's blueprint ornament — corner brackets, crosshairs, tick
// marks and dotted grids drawn on section frames and card corners, so the page
// reads as an engineered drawing rather than a flat layout.
//
// Two decisions that are not obvious from the code:
//   • The frame svg has NO viewBox. It is laid out in CSS pixels against a
//     measured box, which is the only way `stroke-dasharray="1 1"` means an
//     actual 1px dot: inside a scaled viewBox the dash length scales with the
//     drawing, and a "1 1" grid on a 100-unit box stretched to 1440px would be a
//     14px dot. The measurement is a ResizeObserver, so it re-reads on reflow
//     and never runs a frame loop.
//   • Only the four corner brackets are paths, and they are the only things that
//     draw on. Ticks, crosshairs and the grid are lines that arrive on opacity:
//     they are already dashed, so animating their offset would shimmer rather
//     than reveal.
//
// Stroke widths stay 1-1.2px and the opacity band is §9's 25-45% (the grid sits
// at the bottom of it, the brackets at the top). Reduced motion renders the
// finished frame and no transition runs (global guard).

const ARM = 26 // corner bracket arm, px
const TICK = 6 // edge tick length, px
const TILE = 22 // dotted-grid pitch, px
const CROSS = 5 // crosshair half-length, px
const DRAW_MS = 620

/** Measured px-space box of the element `ref` is attached to. */
function useBox<T extends HTMLElement>() {
	const ref = useRef<T>(null)
	const [box, setBox] = useState({ w: 0, h: 0 })

	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const read = () => {
			const r = el.getBoundingClientRect()
			setBox((p) =>
				Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5
					? p
					: { w: r.width, h: r.height }
			)
		}
		read()
		const ro = new ResizeObserver(read)
		ro.observe(el)
		return () => ro.disconnect()
	}, [])

	return [ref, box] as const
}

/** L bracket at one corner of a w x h box, drawn from its outer end inward. */
function corner(x: number, y: number, sx: number, sy: number, len = ARM) {
	return `M ${x + sx * len} ${y} L ${x} ${y} L ${x} ${y + sy * len}`
}

/** The four brackets of a box, in clockwise order from top-left. */
function brackets(w: number, h: number) {
	return [corner(0, 0, 1, 1), corner(w, 0, -1, 1), corner(w, h, -1, -1), corner(0, h, 1, -1)]
}

/**
 * Section-frame ornament. Mount it as the first child of a `position: relative`
 * section or band. Anything it must not draw over has to be positioned too (a
 * `relative` wrapper or cell): an absolutely positioned ornament paints in the
 * positioned layer, which is ABOVE in-flow non-positioned siblings regardless of
 * z-index, so plain `<p>`s would end up underneath the strokes.
 */
export function BlueprintFrame({
	className = '',
	gridAt = 'bl',
	threshold = 0.25
}: {
	className?: string
	/** Which corner carries the dotted grid patch (the opposite one carries the crosshair). */
	gridAt?: 'bl' | 'br'
	threshold?: number
}) {
	const reduced = useReducedMotion()
	const [hostRef, seen] = useInView<HTMLDivElement>(threshold)
	const [boxRef, { w, h }] = useBox<HTMLDivElement>()
	const on = reduced || seen
	const step = (i: number) => `${i * 70}ms`

	// A 8 x 5 patch is 13 lines; the full-box carpet §9 warns against ("not
	// clutter") would be 100+.
	const cols = 8
	const rows = 5
	const gx = gridAt === 'bl' ? 0 : Math.max(0, w - cols * TILE)
	const gy = h - rows * TILE
	const cx = gridAt === 'bl' ? w - 34 : 34

	return (
		<div
			ref={(el) => {
				hostRef.current = el
				boxRef.current = el
			}}
			aria-hidden="true"
			data-t6="blueprint-frame"
			className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
		>
			{w > 0 && h > 0 && (
				<svg fill="none" className="size-full">
					<g stroke="var(--accent)">
						{brackets(w, h).map((d, i) => (
							<path
								key={d}
								d={d}
								strokeWidth={1.2}
								strokeOpacity={0.42}
								strokeLinecap="round"
								// pathLength + dasharray stay attributes (they describe the geometry);
								// the offset is written through `style`, because a CSS transition
								// samples the computed style, not a presentation-attribute change.
								pathLength={1}
								strokeDasharray={1}
								style={{
									strokeDashoffset: on ? 0 : 1,
									...(reduced
										? null
										: {
												transition: `stroke-dashoffset ${DRAW_MS}ms var(--ease-expo) ${step(i)}`
											})
								}}
							/>
						))}
						{/* edge ticks: 10 along the top, 10 along the bottom */}
						{Array.from({ length: 10 }, (_, k) => {
							const x = ((w * (k + 1)) / 11) | 0
							return (
								<g
									key={`t${k}`}
									strokeWidth={1}
									strokeOpacity={0.3}
									style={
										reduced
											? undefined
											: {
													opacity: on ? 1 : 0,
													transition: `opacity ${DRAW_MS}ms var(--ease-expo) ${step(k % 4)}`
												}
									}
								>
									<line x1={x} y1={0} x2={x} y2={TICK} />
									<line x1={x} y1={h} x2={x} y2={h - TICK} />
								</g>
							)
						})}
						{/* left-edge ticks + the crosshair opposite the grid */}
						<g
							strokeWidth={1}
							strokeOpacity={0.3}
							style={
								reduced
									? undefined
									: {
											opacity: on ? 1 : 0,
											transition: `opacity ${DRAW_MS}ms var(--ease-expo) ${step(2)}`
										}
							}
						>
							{Array.from({ length: 5 }, (_, k) => {
								const y = ((h * (k + 1)) / 6) | 0
								return <line key={`l${k}`} x1={0} y1={y} x2={TICK} y2={y} />
							})}
							<g strokeOpacity={0.38}>
								<line x1={cx - CROSS} y1={34} x2={cx + CROSS} y2={34} />
								<line x1={cx} y1={34 - CROSS} x2={cx} y2={34 + CROSS} />
								<circle cx={cx} cy={34} r={CROSS + 2} strokeOpacity={0.3} />
							</g>
						</g>
						{/* dotted grid patch: §9's literal 1px 1px, only possible in px space */}
						<g
							strokeWidth={1}
							strokeDasharray="1 1"
							strokeOpacity={0.26}
							style={
								reduced
									? undefined
									: {
											opacity: on ? 1 : 0,
											transition: `opacity ${DRAW_MS}ms var(--ease-expo) ${step(3)}`
										}
							}
						>
							{Array.from({ length: cols + 1 }, (_, k) => (
								<line
									key={`c${k}`}
									x1={gx + k * TILE}
									y1={gy}
									x2={gx + k * TILE}
									y2={gy + rows * TILE}
								/>
							))}
							{Array.from({ length: rows + 1 }, (_, k) => (
								<line
									key={`r${k}`}
									x1={gx}
									y1={gy + k * TILE}
									x2={gx + cols * TILE}
									y2={gy + k * TILE}
								/>
							))}
						</g>
					</g>
				</svg>
			)}
		</div>
	)
}

/**
 * Card-corner ornament: two brackets and one crosshair, each authored in a small
 * fixed box so it needs no measurement and cannot overflow the card. They are put
 * in three corners that the card's own padding (20px) guarantees are empty of ink,
 * which is §9's "engineering detail, not clutter" made structural: the marks live
 * inside the padding band and the content lives outside it.
 */
export function BlueprintCorners({ className = '' }: { className?: string }) {
	const reduced = useReducedMotion()
	const [ref, seen] = useInView<HTMLDivElement>(0.4)
	const on = reduced || seen

	return (
		<div
			ref={ref}
			aria-hidden="true"
			data-t6="blueprint-card"
			className={`pointer-events-none absolute inset-0 ${className}`}
		>
			<svg
				viewBox="0 0 14 14"
				className="absolute top-1 left-1 size-[14px]"
				fill="none"
				stroke="var(--accent)"
				strokeWidth={1.2}
				strokeOpacity={0.45}
				strokeLinecap="round"
			>
				<path
					d="M9.5 1H1V9.5"
					pathLength={1}
					strokeDasharray={1}
					style={{
						strokeDashoffset: on ? 0 : 1,
						...(reduced
							? null
							: { transition: `stroke-dashoffset ${DRAW_MS}ms var(--ease-expo) 90ms` })
					}}
				/>
			</svg>
			<svg
				viewBox="0 0 14 14"
				className="absolute right-1 bottom-1 size-[14px]"
				fill="none"
				stroke="var(--accent)"
				strokeWidth={1.2}
				strokeOpacity={0.45}
				strokeLinecap="round"
			>
				<path
					d="M4.5 13H13V4.5"
					pathLength={1}
					strokeDasharray={1}
					style={{
						strokeDashoffset: on ? 0 : 1,
						...(reduced
							? null
							: { transition: `stroke-dashoffset ${DRAW_MS}ms var(--ease-expo) 160ms` })
					}}
				/>
			</svg>
			<svg
				viewBox="0 0 8 8"
				className="absolute top-1 right-1 size-2"
				fill="none"
				stroke="var(--accent)"
				strokeWidth={1}
				strokeOpacity={0.3}
			>
				<line
					x1="0"
					y1="4"
					x2="8"
					y2="4"
					style={
						reduced
							? undefined
							: { opacity: on ? 1 : 0, transition: `opacity ${DRAW_MS}ms var(--ease-expo) 240ms` }
					}
				/>
				<line
					x1="4"
					y1="0"
					x2="4"
					y2="8"
					style={
						reduced
							? undefined
							: { opacity: on ? 1 : 0, transition: `opacity ${DRAW_MS}ms var(--ease-expo) 240ms` }
					}
				/>
			</svg>
		</div>
	)
}
