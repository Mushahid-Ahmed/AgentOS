'use client'
import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Mouse-reactive particle field (V4 §4, closing CTA background). Canvas, not
// DOM nodes, because §6.4 makes that a rule and because 90 drifting motes as
// elements would put 90 layout boxes on the page; the particles are pooled
// objects that are never re-allocated after the field starts.
//
// Three things keep this honest about cost:
//   * one rAF, and only while the section intersects the viewport — an
//     IntersectionObserver gate stops the loop and clears the canvas the moment
//     the CTA scrolls away, so no hidden loop survives at the bottom of the page;
//   * the pointer is read from a passive `pointermove` on the section and only
//     stored, never used to spawn work directly;
//   * `prefers-reduced-motion` renders no canvas at all — not a paused one, so a
//     reduced-motion visitor downloads the pixels but runs no animation loop.
//
// The reaction itself is a repulsion field: a mote inside `radius` accelerates
// away from the cursor and brightens while it is moving fast, so the gesture is
// legible as light rather than as position. Drag pulls every mote back to the
// slow ambient drift within about a second.

type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number }

const COUNT = 90
const RADIUS = 150
const PUSH = 26
const DRAG = 0.94
const AMBIENT = 0.16

export function CursorField({ className }: { className?: string }) {
	const host = useRef<HTMLDivElement>(null)
	const reduced = useReducedMotion()

	useEffect(() => {
		const box = host.current
		if (!box || reduced) return

		const canvas = document.createElement('canvas')
		canvas.className = 'pointer-events-none absolute inset-0 h-full w-full'
		const ctx = canvas.getContext('2d')
		if (!ctx) return
		box.appendChild(canvas)

		let w = 0
		let h = 0
		const dpr = Math.min(2, window.devicePixelRatio || 1)
		const resize = () => {
			const rect = box.getBoundingClientRect()
			w = Math.max(1, Math.round(rect.width))
			h = Math.max(1, Math.round(rect.height))
			canvas.width = Math.round(w * dpr)
			canvas.height = Math.round(h * dpr)
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		}
		resize()

		// Pooled once for the life of the field — never allocated per frame.
		const motes: Mote[] = Array.from({ length: COUNT }, () => ({
			x: Math.random() * w,
			y: Math.random() * h,
			vx: (Math.random() - 0.5) * AMBIENT,
			vy: (Math.random() - 0.5) * AMBIENT,
			r: 0.6 + Math.random() * 1.5,
			a: 0
		}))

		const pointer = { x: -9999, y: -9999, live: false }
		const onMove = (e: PointerEvent) => {
			const rect = box.getBoundingClientRect()
			pointer.x = e.clientX - rect.left
			pointer.y = e.clientY - rect.top
			pointer.live = true
		}
		const onLeave = () => {
			pointer.live = false
			pointer.x = -9999
			pointer.y = -9999
		}

		// Canvas cannot read a CSS custom property, so the tokens are resolved once
		// here and reused every frame.
		const inks = getComputedStyle(document.documentElement)
		const accent = inks.getPropertyValue('--accent').trim()
		const ambientInk = inks.getPropertyValue('--mote-ambient').trim()

		let raf = 0
		let running = false
		const frame = () => {
			raf = 0
			ctx.clearRect(0, 0, w, h)
			for (const m of motes) {
				if (pointer.live) {
					const dx = m.x - pointer.x
					const dy = m.y - pointer.y
					const d2 = dx * dx + dy * dy
					if (d2 < RADIUS * RADIUS) {
						const d = Math.max(1, Math.sqrt(d2))
						const f = ((RADIUS - d) / RADIUS) * PUSH
						m.vx += (dx / d) * f * 0.012
						m.vy += (dy / d) * f * 0.012
					}
				}
				m.vx = m.vx * DRAG + (Math.random() - 0.5) * AMBIENT * 0.05
				m.vy = m.vy * DRAG + (Math.random() - 0.5) * AMBIENT * 0.05
				m.x += m.vx
				m.y += m.vy
				// wrap, so the field never thins out at the edges
				if (m.x < -4) m.x = w + 4
				else if (m.x > w + 4) m.x = -4
				if (m.y < -4) m.y = h + 4
				else if (m.y > h + 4) m.y = -4
				const speed = Math.min(1, Math.hypot(m.vx, m.vy) / 3)
				m.a = 0.22 + speed * 0.6
				ctx.globalAlpha = m.a
				// A mote moving faster than the ambient drift is being pushed, so it
				// takes the accent: the reaction reads as light, not as position.
				ctx.fillStyle = speed > 0.25 ? accent : ambientInk
				ctx.beginPath()
				ctx.arc(m.x, m.y, m.r + speed * 1.1, 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.globalAlpha = 1
			if (running) raf = requestAnimationFrame(frame)
		}

		const io = new IntersectionObserver(
			([entry]) => {
				const on = !!entry && entry.isIntersecting
				if (on === running) return
				running = on
				if (on) raf = requestAnimationFrame(frame)
				else {
					if (raf) cancelAnimationFrame(raf)
					raf = 0
					ctx.clearRect(0, 0, w, h)
				}
			},
			{ threshold: 0.01 }
		)
		io.observe(box)
		box.addEventListener('pointermove', onMove, { passive: true })
		box.addEventListener('pointerleave', onLeave)
		const ro = new ResizeObserver(resize)
		ro.observe(box)

		return () => {
			running = false
			if (raf) cancelAnimationFrame(raf)
			io.disconnect()
			ro.disconnect()
			box.removeEventListener('pointermove', onMove)
			box.removeEventListener('pointerleave', onLeave)
			canvas.remove()
		}
	}, [reduced])

	return <div ref={host} data-t4="field" aria-hidden className={className} />
}
