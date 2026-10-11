'use client'
import { cn } from '@/lib/cn'
import { useParallaxPx } from '@/lib/motion/use-parallax'

// Scroll parallax (V4 §4, the hero depth split): the element's own on-screen
// speed as a multiple of the document's. The page already carries everything up
// at 1×, so a `speed` of 1.5 needs 0.5× of the scrolled distance taken *off* the
// top, and 0.5 needs half of it given back — i.e. translateY = (1 − speed) ×
// scrollY. The scrolled distance arrives as `--sy` from `useParallaxPx`, which
// writes it on the element from inside the rAF, so this component renders once
// and never re-renders while you scroll.
//
// Both layers must move at different rates for the split to read as depth, which
// is why this is a wrapper rather than a class: the multiplier belongs to the
// element, not to the stylesheet.
export function Parallax({
	speed,
	className,
	children
}: {
	speed: number
	className?: string
	children?: React.ReactNode
}) {
	const ref = useParallaxPx<HTMLDivElement>()
	const factor = 1 - speed

	return (
		<div
			ref={ref}
			data-t4={`parallax-${speed}`}
			className={cn('block', className)}
			// Resting value is 0px, so a reduced-motion visitor (where the hook
			// writes `--sy: 0px` once and installs no listener) gets exactly the
			// untransformed layout it would get with this component deleted.
			style={{ transform: `translate3d(0, calc(var(--sy, 0px) * ${factor}), 0)` }}
		>
			{children}
		</div>
	)
}
