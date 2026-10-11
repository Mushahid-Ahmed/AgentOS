'use client'

import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Click ripple (brief §7.2-5), rendered as the first child of a button:
// <Button><RippleLayer />Sign in</Button>.
//
// Two constraints shape it. The host span is one React renders permanently
// empty, so the ripple nodes we append never collide with children React wants
// to manage (this button's label swaps to "Please wait…" mid-ripple). And the
// listener goes on the parent button rather than through an onClick prop,
// because a hook that handed its ref back to the caller would be a ref access
// during render — which the React Compiler rejects here.

export function RippleLayer() {
	const hostRef = useRef<HTMLSpanElement>(null)
	const reduced = useReducedMotion()

	useEffect(() => {
		const host = hostRef.current
		const button = host?.parentElement
		if (!host || !button || reduced) return

		const onClick = (event: MouseEvent) => {
			const rect = button.getBoundingClientRect()
			const size = Math.max(rect.width, rect.height) * 2
			// Keyboard activation reports (0, 0): centre the ripple then.
			const keyed = event.clientX === 0 && event.clientY === 0
			const px = keyed ? rect.width / 2 : event.clientX - rect.left
			const py = keyed ? rect.height / 2 : event.clientY - rect.top

			const span = document.createElement('span')
			span.className = 'ripple'
			span.style.width = `${size}px`
			span.style.height = `${size}px`
			span.style.left = `${px - size / 2}px`
			span.style.top = `${py - size / 2}px`
			span.addEventListener('animationend', () => span.remove())
			host.appendChild(span)
		}

		button.addEventListener('click', onClick)
		return () => button.removeEventListener('click', onClick)
	}, [reduced])

	return <span ref={hostRef} aria-hidden className="ripple-host" />
}
