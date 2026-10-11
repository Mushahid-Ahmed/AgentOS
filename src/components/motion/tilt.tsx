'use client'

import { useEffect, useRef } from 'react'
import { useFinePointer, useReducedMotion } from '@/lib/motion/use-reduced-motion'

// 3D pointer tilt (brief §6.2-4: "cards stagger in with 3D tilt on hover
// (mouse position → rotateX/rotateY)"). Writes transform + the --mx/--my vars
// the existing `.sheen` highlight reads, directly on the node inside one rAF —
// no React state per pointer event, and the rect is cached on pointerenter so
// the handler never reads layout. Light and geometry therefore move together.
// Touch and reduced-motion users get the plain card: the component installs no
// listeners and sets no transform at all.
//
// `glow` adds V4 §4's directional border: the same pointer maths also writes
// `--ga`, the angle from the card's centre to the cursor, which the card's own
// `.edge-glow` ring uses to put the bright half of a conic gradient on the edge
// being approached. It is a prop, not a default, because the owner's ruling for
// this run is **cards yes, buttons never** — V3 deleted the button border
// animation on purpose, and a glow that follows the cursor onto a button is
// that deletion reintroduced under a new name. Only card surfaces may pass it,
// and `--ga` inherits, so the ring lives on the bordered child, not here.
export function Tilt({
	children,
	className,
	max = 7,
	lift = 6,
	glow = false
}: {
	children: React.ReactNode
	className?: string
	max?: number
	lift?: number
	glow?: boolean
}) {
	const ref = useRef<HTMLDivElement>(null)
	const reduced = useReducedMotion()
	const fine = useFinePointer()
	const on = !reduced && fine

	useEffect(() => {
		const el = ref.current
		if (!el || !on) return

		let raf = 0
		let rect: DOMRect | null = null

		const paint = (x: number, y: number) => {
			raf = 0
			if (!rect) return
			const nx = (x - rect.left) / Math.max(1, rect.width) - 0.5
			const ny = (y - rect.top) / Math.max(1, rect.height) - 0.5
			const rx = (-ny * max * 2).toFixed(2)
			const ry = (nx * max * 2).toFixed(2)
			el.style.transform =
				`perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)` + ` translateY(${-lift}px)`
			el.style.setProperty('--mx', `${(nx * 100 + 50).toFixed(1)}%`)
			el.style.setProperty('--my', `${(ny * 100 + 50).toFixed(1)}%`)
			if (glow)
				el.style.setProperty('--ga', `${((Math.atan2(ny, nx) * 180) / Math.PI + 90).toFixed(1)}deg`)
		}

		const onEnter = (e: PointerEvent) => {
			rect = el.getBoundingClientRect()
			el.style.willChange = 'transform'
			el.style.transition = 'transform 420ms var(--ease-expo)'
			paint(e.clientX, e.clientY)
		}
		const onMove = (e: PointerEvent) => {
			// Damped follow: a short transition smooths the pointer instead of
			// coupling the card 1:1 to every sample.
			el.style.transition = 'transform 140ms var(--ease-out-soft)'
			if (raf) return
			raf = requestAnimationFrame(() => paint(e.clientX, e.clientY))
		}
		const onLeave = () => {
			if (raf) cancelAnimationFrame(raf)
			raf = 0
			rect = null
			el.style.willChange = ''
			el.style.transition = 'transform 700ms var(--ease-expo)'
			el.style.transform = ''
			el.style.removeProperty('--mx')
			el.style.removeProperty('--my')
			if (glow) el.style.removeProperty('--ga')
		}

		el.addEventListener('pointerenter', onEnter)
		el.addEventListener('pointermove', onMove)
		el.addEventListener('pointerleave', onLeave)
		return () => {
			if (raf) cancelAnimationFrame(raf)
			el.removeEventListener('pointerenter', onEnter)
			el.removeEventListener('pointermove', onMove)
			el.removeEventListener('pointerleave', onLeave)
		}
	}, [on, max, lift, glow])

	return (
		<div
			ref={ref}
			data-t2="tilt"
			data-t4={glow ? 'tilt-glow' : undefined}
			className={className}
			style={on ? { transformStyle: 'preserve-3d' } : undefined}
		>
			{children}
		</div>
	)
}
