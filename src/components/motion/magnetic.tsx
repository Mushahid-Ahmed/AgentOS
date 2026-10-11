'use client'

// Magnetic wrapper: the child eases toward the pointer, then springs back —
// falia's "magnetic buttons". The transform is written straight to the node (no
// React state), and the springy return comes from the --ease-spring transition.
// Skipped for touch pointers (pointerType !== 'mouse') where a magnetic pull is
// meaningless, and neutral under prefers-reduced-motion via motion-reduce:*.
//
// `radius` is V4 §4's "approach" behaviour: the pull starts before the cursor
// arrives, while it is still `radius` px from the element's edge. That needs a
// listener on the page rather than on the (small) element, so the component
// installs one passive window listener, throttled to one rAF, and — this is the
// part that matters for §6.10 — it caches the box once per frame boundary
// instead of calling getBoundingClientRect() per pointer event. It also only
// runs while the element intersects the viewport, so a magnetic control at the
// bottom of a long page costs nothing at the top.

import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

export function Magnetic({
	children,
	className,
	strength = 0.3,
	radius
}: {
	children: ReactNode
	className?: string
	// Fraction of the pointer's offset from centre to travel. Keep subtle.
	strength?: number
	// Approach distance in px. Without it, the pull is hover-only.
	radius?: number
}) {
	const ref = useRef<HTMLSpanElement>(null)
	// §6.7 is a hard requirement, and `motion-reduce:transform-none` alone does
	// NOT satisfy it: an inline `style.transform` written by script outranks a
	// class rule, so the utility would be decorative. The behaviour itself is
	// what gets turned off — no listener, no transform, no pull.
	const reduced = useReducedMotion()

	// Hover-only mode keeps the declarative handlers: no listener to manage.
	const local = !radius

	const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
		if (!local || reduced || event.pointerType !== 'mouse') return
		const el = ref.current
		if (!el) return
		const rect = el.getBoundingClientRect()
		const dx = (event.clientX - (rect.left + rect.width / 2)) * strength
		const dy = (event.clientY - (rect.top + rect.height / 2)) * strength
		el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
	}

	const reset = () => {
		if (!local) return
		const el = ref.current
		if (el) el.style.transform = 'translate3d(0, 0, 0)'
	}

	useEffect(() => {
		const el = ref.current
		if (!el || !radius || reduced) return

		let raf = 0
		let visible = false
		let box = el.getBoundingClientRect()
		const measure = () => {
			box = el.getBoundingClientRect()
		}

		const paint = (x: number, y: number) => {
			raf = 0
			const cx = box.left + box.width / 2
			const cy = box.top + box.height / 2
			const dx = x - cx
			const dy = y - cy
			// Distance from the element's edge, so `radius` means what §4 says it means.
			const edge = Math.max(0, Math.hypot(dx, dy) - Math.max(box.width, box.height) / 2)
			if (edge > radius) {
				el.style.transform = 'translate3d(0, 0, 0)'
				return
			}
			const falloff = 1 - edge / radius
			el.style.transform = `translate3d(${(dx * strength * falloff).toFixed(2)}px, ${(
				dy *
				strength *
				falloff
			).toFixed(2)}px, 0)`
		}

		const onMove = (e: PointerEvent) => {
			if (e.pointerType !== 'mouse' || !visible) return
			if (raf) return
			raf = requestAnimationFrame(() => paint(e.clientX, e.clientY))
		}
		const onScrollOrResize = () => {
			measure()
		}

		const io = new IntersectionObserver(([entry]) => {
			visible = !!entry?.isIntersecting
			if (!visible) el.style.transform = 'translate3d(0, 0, 0)'
		})
		io.observe(el)
		measure()
		window.addEventListener('pointermove', onMove, { passive: true })
		window.addEventListener('scroll', onScrollOrResize, { passive: true })
		window.addEventListener('resize', onScrollOrResize, { passive: true })

		return () => {
			if (raf) cancelAnimationFrame(raf)
			io.disconnect()
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('scroll', onScrollOrResize)
			window.removeEventListener('resize', onScrollOrResize)
			el.style.transform = 'translate3d(0, 0, 0)'
		}
	}, [radius, strength, reduced])

	return (
		<span
			ref={ref}
			onPointerMove={local ? onPointerMove : undefined}
			onPointerLeave={local ? reset : undefined}
			className={cn(
				'inline-block transition-transform duration-(--motion-slow) ease-(--ease-spring) motion-reduce:transform-none motion-reduce:transition-none',
				className
			)}
		>
			{children}
		</span>
	)
}
