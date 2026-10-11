'use client'
// V5 §4 — the five supporting layers, each self-contained and each writing only
// transform / opacity / paint. They are mounted as one additive block so no
// existing section markup is edited: everything here reads the DOM and decorates
// it, nothing here re-renders it.
import { useEffect, useRef, useState } from 'react'
import { scrollDocument } from '@/lib/motion/scroll-engine'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

const ease = (u: number) => u * u * (3 - 2 * u)

/** §4.1 — a tinted band sweeps across on each section boundary, alternating axis. */
export function SectionWipe() {
	const reduced = useReducedMotion()
	const band = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (reduced) return
		const el = band.current
		if (!el) return
		const seen = new WeakSet<Element>()
		const counter = { n: 0 }
		const fire = (target: Element) => {
			if (seen.has(target)) return
			// 0 L→R, 1 top→bottom, 2 R→L, 3 bottom→top
			const d = counter.n % 4
			counter.n += 1
			seen.add(target)
			const horiz = d < 2
			const fwd = d === 0 || d === 3
			el.dataset.axis = horiz ? 'x' : 'y'
			el.dataset.dir = fwd ? 'fwd' : 'rev'
			el.classList.remove('is-wiping')
			void el.offsetWidth
			el.classList.add('is-wiping')
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) if (e.isIntersecting) fire(e.target)
			},
			{ rootMargin: '-50% 0px -50% 0px', threshold: 0 }
		)
		for (const s of document.querySelectorAll('main section')) io.observe(s)
		return () => io.disconnect()
	}, [reduced])

	return <div ref={band} aria-hidden data-axis="x" data-dir="fwd" className="v5-wipe" />
}

/** §4.3 — a 60px grid drifts upward and intensifies as sections enter. */
export function GridDrift() {
	const root = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const el = root.current
		if (!el) return
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries.some((e) => e.isIntersecting)) return
				el.removeAttribute('data-lit')
				void el.offsetWidth
				el.setAttribute('data-lit', '')
				window.setTimeout(() => el.removeAttribute('data-lit'), 500)
			},
			{ rootMargin: '-45% 0px -45% 0px', threshold: 0 }
		)
		for (const s of document.querySelectorAll('main section')) io.observe(s)
		return () => io.disconnect()
	}, [])

	return <div ref={root} aria-hidden className="v5-grid" />
}

/** §4.2 — the text block nearest the viewport centre is lifted. Rects are read in
 * one batch per layout change and never inside the scroll frame (§6.10). */
export function ReadingSpotlight() {
	const reduced = useReducedMotion()

	useEffect(() => {
		if (reduced) return
		const SEL = 'main section p, main section li, main section h2'
		let boxes: { el: HTMLElement; mid: number }[] = []
		let lit: HTMLElement | null = null
		const measure = () => {
			boxes = Array.from(document.querySelectorAll<HTMLElement>(SEL))
				.map((el) => ({ el, mid: el.getBoundingClientRect().top + window.scrollY }))
				.filter((b) => b.el.offsetHeight > 0 && b.el.offsetHeight < window.innerHeight * 0.8)
		}
		measure()
		let raf = 0
		const write = () => {
			raf = 0
			const line = window.scrollY + window.innerHeight / 2
			let best: { el: HTMLElement; mid: number } | null = null
			let bd = Infinity
			for (const b of boxes) {
				const d = Math.abs(b.mid - line)
				if (d < bd) {
					bd = d
					best = b
				}
			}
			const next = bd < window.innerHeight * 0.34 ? (best?.el ?? null) : null
			if (next !== lit) {
				lit?.classList.remove('v5-spot')
				next?.classList.add('v5-spot')
				lit = next
			}
		}
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(write)
		}
		window.addEventListener('scroll', schedule, { passive: true })
		let t: number | undefined
		const remeasure = () => {
			window.clearTimeout(t)
			t = window.setTimeout(measure, 250)
		}
		window.addEventListener('resize', remeasure)
		const ro = new ResizeObserver(remeasure)
		ro.observe(document.body)
		write()
		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.clearTimeout(t)
			lit?.classList.remove('v5-spot')
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', remeasure)
			ro.disconnect()
		}
	}, [reduced])

	return null
}

/** §4.4 — a flashlight follows the cursor inside the diagram regions only. */
export function XRayHover() {
	const reduced = useReducedMotion()
	const root = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (reduced) return
		const el = root.current
		if (!el) return
		const ZONES = '#capabilities, #evidence, #surfaces, #benchmarks, #pipeline'
		const zones = Array.from(document.querySelectorAll(ZONES))
		if (!zones.length) return
		let raf = 0
		let x = 0
		let y = 0
		const write = () => {
			raf = 0
			el.style.setProperty('--xx', `${x}px`)
			el.style.setProperty('--yy', `${y}px`)
		}
		const onMove = (e: PointerEvent) => {
			x = e.clientX
			y = e.clientY
			let inside = false
			for (const z of zones) {
				const r = z.getBoundingClientRect()
				if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
					inside = true
					break
				}
			}
			el.toggleAttribute('data-on', inside)
			if (!raf) raf = requestAnimationFrame(write)
		}
		window.addEventListener('pointermove', onMove, { passive: true })
		return () => window.removeEventListener('pointermove', onMove)
	}, [reduced])

	return (
		<div
			ref={root}
			aria-hidden
			className="v5-xray"
			style={{ '--xx': '0px', '--yy': '0px' } as React.CSSProperties}
		/>
	)
}

/** §4.6 — the right-edge thread: fills with scroll, pulses on milestones, jumps on click. */
export function ProgressThread() {
	const reduced = useReducedMotion()
	const [p, setP] = useState(0)
	const fill = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const el = fill.current
		let raf = 0
		const write = () => {
			raf = 0
			const max = document.documentElement.scrollHeight - window.innerHeight
			const q = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
			if (el) el.style.transform = `scaleY(${q.toFixed(4)})`
			setP(q)
		}
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(write)
		}
		write()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule, { passive: true })
		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
		}
	}, [])

	const jump = (e: React.MouseEvent) => {
		const max = document.documentElement.scrollHeight - window.innerHeight
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const q = ease(Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)))
		scrollDocument(Math.round(q * max))
	}

	if (reduced) return null

	return (
		<div aria-hidden className="v5-thread" onMouseDown={jump}>
			<div ref={fill} className="v5-thread-fill" style={{ transform: 'scaleY(0)' }} />
			{[0.25, 0.5, 0.75].map((m) => (
				<span
					key={m}
					className="v5-thread-mark"
					style={{ top: `${m * 100}%`, opacity: p >= m ? 1 : 0.25 }}
				/>
			))}
		</div>
	)
}

/** The five layers as one mount. Each gates its own listeners on reduced motion. */
export function V5Layers() {
	return (
		<>
			<GridDrift />
			<SectionWipe />
			<ReadingSpotlight />
			<XRayHover />
			<ProgressThread />
		</>
	)
}
