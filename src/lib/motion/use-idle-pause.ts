'use client'
import { useEffect } from 'react'

// §11 (M9): V6's three infinite CSS loops — the cable bundle's 22 marching dashes,
// the ray hub's 5.5 s breath and the pipeline stage's marquee — are declared with
// `animation: … infinite`, and a dashoffset animation is ticked on the main thread
// whether or not any of it is on screen. This marks the host `data-v6-idle="paused"`
// once it leaves the viewport and `="active"` when it returns; globals.css turns that
// into `animation-play-state`, which suspends the loop without touching it.
//
// Pausing is scoping, not reducing, and the distinction is the point: the animation
// keeps its duration, easing, iteration count and phase, and resumes on the frame it
// stopped at, so every pixel a viewer can see is the pixel the effect already drew.
export function useIdlePause(ref: React.RefObject<HTMLElement | null>, rootMargin = '0px'): void {
	useEffect(() => {
		const el = ref.current
		if (!el || typeof IntersectionObserver === 'undefined') return
		const io = new IntersectionObserver(
			([entry]) => el.setAttribute('data-v6-idle', entry?.isIntersecting ? 'active' : 'paused'),
			{ rootMargin }
		)
		io.observe(el)
		return () => {
			io.disconnect()
			el.removeAttribute('data-v6-idle')
		}
	}, [ref, rootMargin])
}
