'use client'
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './use-reduced-motion'

// Scroll scrub: a 0 → 1 progress value for how far an element has travelled
// through the viewport (brief §6.3 "scroll-driven where appropriate"). One
// rAF-throttled, passive scroll listener per element; the rect is read inside
// the frame only, so the handler never thrashes layout.
//
// The band is clamped against the document's maximum scroll offset: an element
// near the end of the page (the footer wordmark) still reaches 1, so no
// scrubbed content can be left half-drawn because there was nothing more to
// scroll. Reduced motion pins progress to 1 without listening at all, which
// renders every scrubbed drawing complete (§8 a11y: motion never gates content).
export function useScrub<T extends HTMLElement>(
	travel = 1
): [React.RefObject<T | null>, number] {
	const ref = useRef<T>(null)
	const reduced = useReducedMotion()
	const [progress, setProgress] = useState(0)

	useEffect(() => {
		const el = ref.current
		if (!el || reduced) return

		let raf = 0
		const measure = () => {
			raf = 0
			const rect = el.getBoundingClientRect()
			const vh = window.innerHeight || 1
			const y = window.scrollY
			const from = y + rect.top - vh * 0.9
			const to = from + Math.max(220, rect.height * travel)
			const maxScroll = Math.max(
				0,
				document.documentElement.scrollHeight - (window.innerHeight || 1)
			)
			const span = Math.max(1, Math.min(to - from, maxScroll - from))
			const next = Math.min(1, Math.max(0, (y - from) / span))
			setProgress((prev) => (Math.abs(prev - next) < 0.004 ? prev : next))
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
	}, [reduced, travel])

	return [ref, reduced ? 1 : progress]
}

// Maps a scrub window inside an overall progress value, so several elements in
// one section can draw sequentially from the same scroll.
export function scrubSlice(p: number, from: number, span = 1): number {
	return Math.min(1, Math.max(0, (p - from) / span))
}

// SVG stroke draw-on: pathLength=1 makes dash maths resolution-independent, so
// the same expression works for a 20px glyph and a 900px connector.
export function drawProps(p: number): React.SVGProps<SVGPathElement> {
	const q = Math.min(1, Math.max(0, p))
	return {
		pathLength: 1,
		strokeDasharray: 1,
		strokeDashoffset: 1 - q
	}
}
