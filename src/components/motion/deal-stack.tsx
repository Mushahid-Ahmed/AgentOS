'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// "The Shuffle" (V4 §4, capability grid). The cards are laid out by the grid
// exactly as a no-JS reader would see them; the animation only ever moves them
// *away* from those slots and back, which is what makes this safe to run on top
// of real content:
//
//   1. on mount, each card measures its own centre against the grid's centre and
//      writes that gap into `--dx/--dy` (plus a deterministic tilt and a depth
//      term), so "the pile" is a real geometric property of this layout at this
//      width — not a hard-coded offset that would be wrong on another viewport;
//   2. an IntersectionObserver on the grid deals: each card transitions from the
//      pile position into its own slot, face-on (`rotateY 90deg → 0`), staggered
//      by `transitionDelay`, which is why the flight needs no timer and no rAF;
//   3. when the grid leaves the viewport **above**, the same transition runs in
//      reverse and the cards fly back to the stack — §4's exit.
//
// Nothing is ever faded: the cards hold opacity 1 and their real text at every
// stage, so an off-screen pile cannot strand content, and the state is re-read
// from geometry rather than trusted from the entry alone — an observer only
// fires when intersection *changes*, so a `scrollTo` that carries the grid off
// the top in one frame would otherwise leave the cards dealt in an empty page.
// That is the same lesson as M3's reveal fallback, applied to a pile.
//
// Reduced motion installs no listener, writes no custom property, and the grid
// renders as a grid.

// Deterministic tilt (±9deg): derived from the index so server and client agree,
// and riffled rather than randomly shuffled on every render.
const tiltOf = (i: number) => ((((i * 37) % 19) - 9) * (i % 2 ? 1 : -1)).toFixed(2)

const RESTING = 'dealt'

export function DealStack({
	children,
	className,
	stagger = 100
}: {
	children: ReactNode
	className?: string
	stagger?: number
}) {
	const ref = useRef<HTMLDivElement>(null)
	const reduced = useReducedMotion()

	useEffect(() => {
		const grid = ref.current
		if (!grid || reduced) return
		const cards = Array.from(grid.children) as HTMLElement[]
		if (!cards.length) return

		const write = () => {
			const g = grid.getBoundingClientRect()
			const cx = g.left + g.width / 2
			const cy = g.top + g.height / 2
			cards.forEach((c, i) => {
				const r = c.getBoundingClientRect()
				c.style.setProperty('--dx', `${Math.round(cx - (r.left + r.width / 2))}px`)
				c.style.setProperty('--dy', `${Math.round(cy - (r.top + r.height / 2))}px`)
				c.style.setProperty('--tilt', `${tiltOf(i)}deg`)
				c.style.transitionDelay = `${i * stagger}ms`
			})
		}
		// The pile position is the *starting* state, so it is applied before the
		// first paint of the deal; the class flips to dealt once the grid is in view.
		write()

		let raf = 0
		const remeasure = () => {
			raf = 0
			const wasDealt = grid.dataset.deal === RESTING
			grid.dataset.deal = 'pile'
			write()
			if (wasDealt) grid.dataset.deal = RESTING
		}

		const settle = (intersecting: boolean, top: number, bottom: number, vh: number) => {
			if (intersecting) grid.dataset.deal = RESTING
			else if (bottom <= 0) grid.dataset.deal = 'restacked'
			else if (top >= vh) grid.dataset.deal = 'pile'
		}
		const io = new IntersectionObserver(
			([entry]) => {
				if (!entry) return
				const r = entry.boundingClientRect
				settle(entry.isIntersecting, r.top, r.bottom, window.innerHeight || 1)
			},
			{ threshold: 0.08 }
		)
		io.observe(grid)
		{
			const r = grid.getBoundingClientRect()
			const vh = window.innerHeight || 1
			settle(!(r.bottom <= 0 || r.top >= vh), r.top, r.bottom, vh)
		}

		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(remeasure)
		}
		const ro = new ResizeObserver(schedule)
		ro.observe(grid)

		return () => {
			if (raf) cancelAnimationFrame(raf)
			ro.disconnect()
			io.disconnect()
			cards.forEach((c) => {
				c.style.removeProperty('--dx')
				c.style.removeProperty('--dy')
				c.style.removeProperty('--tilt')
				c.style.transitionDelay = ''
			})
			delete grid.dataset.deal
		}
	}, [reduced, stagger])

	if (reduced)
		return (
			<div ref={ref} data-t4="deal" data-deal={undefined} className={className}>
				{children}
			</div>
		)

	return (
		<div ref={ref} data-t4="deal" className={cn('deal-grid', className)}>
			{children}
		</div>
	)
}
