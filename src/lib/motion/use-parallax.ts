'use client'
import { useEffect, useRef } from 'react'
import { useReducedMotion } from './use-reduced-motion'

// Scroll-linked transforms without a React render per frame.
//
// `useScrub` is the right tool when a component *computes* with the progress
// value (SVG geometry, staged slices). It is the wrong tool for a parallax
// offset, where the number only has to reach CSS: setting state 60 times a
// second re-renders the subtree to move one transform. These hooks write a CSS
// custom property on the element from inside the rAF instead, so the scroll
// handler costs one rect read and one property write, and the compositor does
// the rest. Same discipline as `Tilt`, which writes `transform` directly.
//
// Reduced motion writes the resting value once and installs no listener.

// `--sy`: pixels the page has scrolled while the element is still in view,
// clamped to its own height so a section that has left the screen stops
// accumulating offset. Parallax multipliers are then pure CSS:
// `translate3d(0, calc(var(--sy) * -0.5), 0)` moves the element up at 1.5×
// scroll speed (the document already carries it up at 1×).
export function useParallaxPx<T extends HTMLElement>(): React.RefObject<T | null> {
	const ref = useRef<T>(null)
	const reduced = useReducedMotion()

	useEffect(() => {
		const el = ref.current
		if (!el) return
		if (reduced) {
			el.style.setProperty('--sy', '0px')
			return
		}

		let raf = 0
		let lit = false
		const measure = () => {
			raf = 0
			const rect = el.getBoundingClientRect()
			const vh = window.innerHeight || 1
			// Only while the box overlaps the viewport; outside it nothing paints,
			// so the var holds its last value and `will-change` comes off.
			if (rect.bottom <= 0 || rect.top >= vh) {
				if (lit) {
					el.style.willChange = ''
					lit = false
				}
				return
			}
			if (!lit) {
				el.style.willChange = 'transform'
				lit = true
			}
			// Clamped at a bit over one viewport: past that the element carrying this
			// var is off-screen, and an unbounded offset would keep growing forever.
			el.style.setProperty('--sy', `${Math.round(Math.min(vh * 1.1, window.scrollY))}px`)
		}
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(measure)
		}

		measure()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule, { passive: true })
		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
		}
	}, [reduced])

	return ref
}

// `--sp`: the element's 0 → 1 journey through the viewport, as a unitless
// number CSS can multiply. Used for reveals that should be *driven* by the
// scroll position rather than triggered by it.
export function useScrubVar<T extends HTMLElement>(
	name = '--sp',
	travel = 1
): React.RefObject<T | null> {
	const ref = useRef<T>(null)
	const reduced = useReducedMotion()

	useEffect(() => {
		const el = ref.current
		if (!el) return
		if (reduced) {
			el.style.setProperty(name, '1')
			return
		}

		let raf = 0
		const measure = () => {
			raf = 0
			const rect = el.getBoundingClientRect()
			const vh = window.innerHeight || 1
			const y = window.scrollY
			const from = y + rect.top - vh * 0.9
			const to = from + Math.max(220, rect.height * travel)
			const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh)
			const span = Math.max(1, Math.min(to - from, maxScroll - from))
			const p = Math.min(1, Math.max(0, (y - from) / span))
			el.style.setProperty(name, p.toFixed(4))
		}
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(measure)
		}

		measure()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule, { passive: true })
		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
		}
	}, [reduced, name, travel])

	return ref
}
