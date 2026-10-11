'use client'
import { cn } from '@/lib/cn'
import { useScrubVar } from '@/lib/motion/use-parallax'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Diagonal clip-path reveal (V4 §4, the intro moment). The mask is a
// parallelogram translated across the box, so the leading edge is a slant: the
// top-left of the type appears first and the cut travels down-right. It is the
// one reveal in the kit that is not a translate/opacity move, and it stays
// cheap because `clip-path` is composited — no layout, no paint of new pixels.
//
// Two properties of this mechanism matter for the content contract:
//   * the text keeps its box the whole time, so nothing reflows and LCP is not
//     gated (the mask hides ink, never layout);
//   * the *shown* polygon is the resting state, and reduced motion never
//     installs the hidden one, so a reveal that cannot run cannot hide anything.

// Vertex order is TL, TR, BR, BL. Hidden = the same parallelogram pushed a
// full body-width to the left of the box; the 60% shear is what makes the
// sweep diagonal instead of vertical.
const SHOWN = 'polygon(0% 0%, 220% 0%, 160% 100%, -60% 100%)'
const HIDDEN = 'polygon(-220% 0%, 0% 0%, -60% 100%, -280% 100%)'

export function SweepReveal({
	children,
	className,
	duration = 1100,
	threshold = 0.35,
	as: Tag = 'span'
}: {
	children: React.ReactNode
	className?: string
	duration?: number
	threshold?: number
	// The mask has to be a block, but which block is the parent's problem: a
	// `<span>` is right inside an `<h2>` and wrong around a `<p>`, which would put
	// flow content inside phrasing content. The ref is typed as the intersection of
	// both element types so it satisfies whichever one renders.
	as?: 'span' | 'div'
}) {
	const reduced = useReducedMotion()
	const [ref, inView] = useInView<HTMLSpanElement & HTMLDivElement>(threshold)
	const shown = reduced || inView

	return (
		<Tag
			ref={ref}
			data-t4="sweep"
			className={cn('block', className)}
			style={{
				clipPath: shown ? SHOWN : HIDDEN,
				transition: reduced ? 'none' : `clip-path ${duration}ms var(--ease-expo)`
			}}
		>
			{children}
		</Tag>
	)
}

// The slow background mark behind the intro section: one CSS rotation at
// §4's 0.5 deg per second (720 s per turn) and a scale that rides the section's
// scroll progress, both on the compositor. `--sp` comes from `useScrubVar`, so
// the scroll handler never re-renders React, and the global reduced-motion
// guard in globals.css collapses the loop while the scale settles at 1.
export function DriftMark({ path }: { path: string }) {
	const ref = useScrubVar<HTMLSpanElement>('--sp', 1)
	return (
		<span
			ref={ref}
			aria-hidden
			data-t4="mark"
			className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
		>
			<svg viewBox="0 0 200 200" fill="none" className="drift-mark size-[min(78vw,760px)]">
				<path d={path} stroke="var(--border-strong)" strokeWidth="0.7" strokeLinejoin="round" />
			</svg>
		</span>
	)
}
