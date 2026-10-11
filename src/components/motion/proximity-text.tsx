'use client'
import { Fragment, useEffect, useRef } from 'react'
import { splitWords, proximityFactor } from '@/lib/motion/split-text'
import { useFinePointer, useReducedMotion } from '@/lib/motion/use-reduced-motion'

// The owner's DownBeat ask (UI/UX run UX-D6): display type split into characters
// where glyphs near the cursor scale up and gain a glow, smoothly interpolated.
// Applied ONLY to display-size type, never body text. Animates transform /
// opacity / filter only (no layout thrash), rAF-throttled. Disabled on touch and
// under reduced motion (renders plain unsplit text there). Accessibility: an
// sr-only twin carries the full string for screen readers; the split spans are
// aria-hidden.
export function ProximityText({
	text,
	className,
	radius = 120,
	maxScale = 1.25
}: {
	text: string
	className?: string
	radius?: number
	maxScale?: number
}) {
	const reduced = useReducedMotion()
	const fine = useFinePointer()
	const wrapRef = useRef<HTMLSpanElement>(null)
	const enabled = !reduced && fine

	useEffect(() => {
		if (!enabled) return
		const wrap = wrapRef.current
		if (!wrap) return
		const chars = Array.from(wrap.querySelectorAll<HTMLElement>('[data-char]'))
		if (chars.length === 0) return

		let px = -9999
		let py = -9999
		let raf = 0
		let running = false

		const apply = () => {
			running = false
			for (const el of chars) {
				const r = el.getBoundingClientRect()
				const cx = r.left + r.width / 2
				const cy = r.top + r.height / 2
				const d = Math.hypot(px - cx, py - cy)
				const f = proximityFactor(d, radius)
				const s = 1 + (maxScale - 1) * f
				el.style.transform = `scale(${s})`
				el.style.opacity = `${0.55 + 0.45 * f}`
				el.style.filter = f > 0.02 ? `drop-shadow(0 0 ${8 * f}px var(--ring-color))` : 'none'
			}
		}
		const onMove = (e: PointerEvent) => {
			px = e.clientX
			py = e.clientY
			if (!running) {
				running = true
				raf = requestAnimationFrame(apply)
			}
		}

		window.addEventListener('pointermove', onMove, { passive: true })
		return () => {
			window.removeEventListener('pointermove', onMove)
			cancelAnimationFrame(raf)
			for (const el of chars) {
				el.style.transform = ''
				el.style.opacity = ''
				el.style.filter = ''
			}
		}
	}, [enabled, radius, maxScale])

	if (!enabled) {
		return <span className={className}>{text}</span>
	}

	return (
		<span className={className} ref={wrapRef}>
			<span className="sr-only">{text}</span>
			<span aria-hidden="true">
				{/* Words are non-breaking boxes of per-char spans: line breaks can
				    only land between words, never mid-word. */}
				{splitWords(text).map((part, wi) =>
					/^\s+$/.test(part) ? (
						<Fragment key={`s${wi}`}>{part}</Fragment>
					) : (
						<span key={`w${wi}`} className="inline-block whitespace-nowrap">
							{Array.from(part).map((ch, ci) => (
								<span
									key={ci}
									data-char=""
									className="inline-block will-change-transform"
									style={{ opacity: 0.55 }}
								>
									{ch}
								</span>
							))}
						</span>
					)
				)}
			</span>
		</span>
	)
}
