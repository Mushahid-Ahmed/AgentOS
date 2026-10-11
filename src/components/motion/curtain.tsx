'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/cn'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Curtain reveal (V4 §5.4): a solid panel the colour of the background sits over a
// diagram and slides away — left to right, or top to bottom — so the thing underneath
// appears to be *uncovered* rather than faded in.
//
// The difference from the rest of the kit matters for §6.9. An opacity reveal hides
// content in the content; a curtain hides it behind something else, which means a
// curtain that never animates is a tarpaulin left on a diagram. Two things make that
// impossible here: the veil is only ever mounted while it still has work to do (so
// reduced motion, and every state after the sweep, render without it), and the
// reveal itself is the jump-safe `useInView` from M3 — a scroll that teleports past a
// diagram still uncovers it.
//
// The panel is `aria-hidden` and `pointer-events-none`: it must never intercept a
// click on a link it happens to be covering, and it carries no text.
//
// Client-liveness is read through an external store, not a setState in an effect, so
// the first client render agrees with the markup being hydrated.
const subscribeNothing = () => () => {}
const onClient = () => true
const onServer = () => false

export function CurtainReveal({
	children,
	className,
	direction = 'right',
	duration = 800,
	threshold = 0.25,
	color = 'var(--bg)'
}: {
	children: React.ReactNode
	className?: string
	// `right` uncovering left→right, `down` top→bottom (§5.4 offers both).
	direction?: 'right' | 'down'
	duration?: number
	threshold?: number
	color?: string
}) {
	const reduced = useReducedMotion()
	const [ref, inView] = useInView<HTMLDivElement>(threshold)
	const shown = reduced || inView
	// The panel appears one step *after* the server HTML, on the first commit that has
	// a chance of removing it again. Rendering it during the prerender would put a
	// tarpaulin over the diagram in the markup, and a visitor with scripts disabled —
	// or a crawler — would never get the reveal that takes it off. Every use here is
	// far below the fold, so the cover happens out of sight.
	const ready = useSyncExternalStore(subscribeNothing, onClient, onServer)
	const [veil, setVeil] = useState(true)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		// transitionend is the honest signal; the timer exists because a veil that is
		// covered by its own parent, or a tab that is backgrounded mid-sweep, can end
		// up never firing it — and a leftover panel is the failure mode this component
		// is not allowed to have.
		if (!shown || reduced) return
		const ms = duration + 260
		timer.current = setTimeout(() => setVeil(false), ms)
		return () => {
			if (timer.current) clearTimeout(timer.current)
		}
	}, [shown, reduced, duration])

	const hidden = direction === 'right' ? 'translate(-101%, 0)' : 'translate(0, -101%)'

	return (
		<div ref={ref} data-t4="curtain" className={cn('relative overflow-hidden', className)}>
			{children}
			{ready && veil && !reduced && (
				<div
					aria-hidden
					onTransitionEnd={() => setVeil(false)}
					className="curtain-veil pointer-events-none absolute inset-0"
					style={{
						background: color,
						transform: shown ? hidden : 'translate(0, 0)'
					}}
				/>
			)}
		</div>
	)
}
