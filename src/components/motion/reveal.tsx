'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Shared reveal primitives (UI/UX run M3) — ONE set reused everywhere, not
// per-section ad-hoc code. All are IntersectionObserver-driven and collapse to
// fully-visible / no-transform under reduced motion (content is never trapped
// behind an animation that doesn't run).

// A reveal that waits only for IntersectionObserver CAN trap content, and on this
// page it did. An observer reports a change of intersection state; a scroll JUMP
// (Ctrl+End, dragging the scrollbar thumb, Next.js restoring the position after a
// reload) carries an element from below the viewport to above it, where the state
// is "not intersecting" both before and after, so no threshold is crossed and
// Chromium sends no entry at all. Measured on the landing page with an observer
// identical to the one below: one initial entry (ratio 0), then silence after a
// jump to the bottom, and a reload restored at scrollY 9164 left 33 text-bearing
// blocks at opacity 0 — copy the user has already scrolled past and will never
// see. §6.9 forbids that, so every pending reveal also gets a direct geometry
// check, driven by ONE shared passive listener that detaches as soon as nothing
// is pending (the steady-state cost of the safety net is zero).
type RevealTest = () => boolean
const pending = new Set<RevealTest>()
let frame = 0
let listening = false

const pump = () => {
	frame = 0
	// Copy first: a test removes itself from `pending` while running.
	for (const test of [...pending]) {
		if (test()) pending.delete(test)
	}
	if (pending.size === 0) detach()
}
const schedule = () => {
	if (!frame) frame = requestAnimationFrame(pump)
}
const attach = () => {
	if (listening) return
	listening = true
	window.addEventListener('scroll', schedule, { passive: true })
	window.addEventListener('resize', schedule, { passive: true })
}
const detach = () => {
	if (!listening) return
	listening = false
	window.removeEventListener('scroll', schedule)
	window.removeEventListener('resize', schedule)
}
function watchReveal(test: RevealTest): () => void {
	pending.add(test)
	attach()
	// One pass without waiting for a scroll event: that is what fixes a reload at
	// a restored position, where nothing will ever scroll.
	schedule()
	return () => {
		pending.delete(test)
		if (pending.size === 0) detach()
	}
}

// Fires once when the element enters the viewport — or once it has been scrolled
// past, which the observer alone cannot tell us about.
export function useInView<T extends HTMLElement>(
	threshold = 0.2
): [React.RefObject<T | null>, boolean] {
	const ref = useRef<T>(null)
	const [inView, setInView] = useState(false)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		const shown = () => {
			const r = el.getBoundingClientRect()
			// A collapsed box has nothing to wait for, and a box above the viewport
			// has already been passed: both count as revealed so no text is stranded.
			if (r.height <= 0 || r.bottom <= 0) return true
			const vh = window.innerHeight || 1
			const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0)
			return visible > 0 && visible / r.height >= Math.min(Math.max(threshold, 0.01), 1)
		}

		const reveal = () => {
			setInView(true)
			io.disconnect()
			stop()
			return true
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) reveal()
			},
			{ threshold }
		)
		const stop = watchReveal(() => (shown() ? reveal() : false))
		io.observe(el)

		return () => {
			io.disconnect()
			stop()
		}
	}, [threshold])

	return [ref, inView]
}

// Fade-up: opacity 0→1 with a small translateY (and optional scale for the
// huge-type moments, brief §6.2-12) on the signature expo ease.
export function FadeUp({
	children,
	delay = 0,
	y = 24,
	scale,
	className
}: {
	children: React.ReactNode
	delay?: number
	y?: number
	scale?: number
	className?: string
}) {
	const reduced = useReducedMotion()
	const [ref, inView] = useInView<HTMLDivElement>()
	const shown = reduced || inView

	return (
		<div
			ref={ref}
			className={cn('ease-expo transition-all', className)}
			style={{
				transitionDuration: reduced ? '0ms' : '900ms',
				transitionDelay: `${delay}ms`,
				opacity: shown ? 1 : 0,
				transform: shown ? 'none' : `translateY(${y}px)${scale ? ` scale(${scale})` : ''}`
			}}
		>
			{children}
		</div>
	)
}

// Line-mask reveal: each line sits in an overflow-hidden mask; the inner block
// translates up on view with a stagger (the DownBeat `.ln` technique).
//
// `alternate` adds V4 §4's "pages settling into a book" on top of the mask: the
// mask box itself slides in from the left on odd lines and from the right on
// even ones, with a ±1.5deg tilt that unwinds as it lands. The offset is on the
// OUTER box on purpose — the mask clips its own child, so pushing the inner
// line sideways would just move the ink against the clip and read as a smear.
export function LineMaskReveal({
	lines,
	className,
	lineClassName,
	stagger = 120,
	alternate = false,
	as: Tag = 'div'
}: {
	lines: string[]
	className?: string
	lineClassName?: string
	stagger?: number
	alternate?: boolean
	as?: 'div' | 'h1' | 'h2' | 'h3' | 'p'
}) {
	const reduced = useReducedMotion()
	const [ref, inView] = useInView<HTMLDivElement>(0.3)
	const shown = reduced || inView

	return (
		<Tag ref={ref} className={className}>
			{lines.map((line, i) => (
				<span
					key={i}
					className={cn(
						'block overflow-hidden',
						'pb-[0.06em]', // allowlist token: descender clearance that scales with any font size inside the mask
						lineClassName
					)}
					style={
						alternate
							? {
									transition: reduced
										? 'none'
										: `transform 1100ms cubic-bezier(0.16,1,0.3,1) ${i * stagger}ms, opacity 700ms linear ${i * stagger}ms`,
									opacity: shown ? 1 : 0,
									transform: shown
										? 'none'
										: `translateX(${(i % 2 ? -1 : 1) * 22}px) rotate(${(i % 2 ? -1 : 1) * 1.5}deg)`
								}
							: undefined
					}
				>
					<span
						className="ease-expo block"
						style={{
							transition: reduced
								? 'none'
								: `transform 1100ms cubic-bezier(0.16,1,0.3,1) ${i * stagger}ms`,
							transform: shown ? 'translateY(0)' : 'translateY(110%)'
						}}
					>
						{line}{' '}
						{/* the trailing space is the word break between masked lines:
						    without it the h1's accessible name reads "First SuperAgentOS" */}
					</span>
				</span>
			))}
		</Tag>
	)
}

// Count-up counter on first view (mirrors the run view's live counts). Renders
// the final value immediately under reduced motion. `decimals` exists because the
// dashboard counts real measured ratios (speed-up factor, cost) as well as
// integers — the landing only ever counted integers and passes nothing.
export function CountUp({
	to,
	duration = 1400,
	suffix = '',
	decimals = 0
}: {
	to: number
	duration?: number
	suffix?: string
	decimals?: number
}) {
	const reduced = useReducedMotion()
	const [ref, inView] = useInView<HTMLSpanElement>(0.5)
	const [value, setValue] = useState(0)

	useEffect(() => {
		if (reduced || !inView) return
		let raf = 0
		const start = performance.now()
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / duration)
			const eased = 1 - Math.pow(1 - t, 3)
			setValue(to * eased)
			if (t < 1) raf = requestAnimationFrame(step)
		}
		raf = requestAnimationFrame(step)
		return () => cancelAnimationFrame(raf)
	}, [inView, reduced, to, duration])

	// Reduced motion shows the final value immediately, no animation.
	const display = (reduced ? to : value).toFixed(decimals)

	return (
		<span ref={ref} className="font-numeric">
			{display}
			{suffix}
		</span>
	)
}
