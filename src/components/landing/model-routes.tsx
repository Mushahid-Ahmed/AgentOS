'use client'

import { useEffect, useState } from 'react'
import { scrubSlice, useScrub } from '@/lib/motion/use-scrub'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { cn } from '@/lib/cn'

// Models & routing drawn as routes (brief §6.2-8): one scrub runs down the
// family list, each row's accent hairline draws left→right with a packet riding
// its leading edge, the copy rises in behind it, and the line settles to the
// plain hairline once the connection is made. Reduced motion pins the scrub at
// 1 — every row fully drawn, no packet, nothing hidden.
//
// V4 §4 turns that drawing into the routing *story*: the request dot reaches a
// decision node at the head of a row, the node glows, the dot runs the branch,
// and the slug it arrives at flashes once. The row that plays is the one the
// scrub has just finished drawing, and after the section settles the route
// hands over to a 3 s cadence — a request arrives, another family takes it.
// Nothing here pretends to be live traffic: it is a diagram of a policy that is
// stated in the copy above it.
//
// Two perf rules decide the shape of it. §6.2 forbids animating `left`, so the
// travelling dot rides a **full-width track translated in %** — a percentage
// transform resolves against the track's own box, which is the row's width, so
// the dot lands exactly at the drawing tip with no measurement and no layout.
// And §6.6, so the cadence and the breathing only run while the stack is in
// view: the interval is installed by the observer and torn down by it.

export type ModelRoute = { family: string; slug: string; dim?: boolean }

const CADENCE_MS = 3000

export function ModelRoutes({ rows }: { rows: readonly ModelRoute[] }) {
	const reduced = useReducedMotion()
	const [ref, p] = useScrub<HTMLDivElement>(1.05)
	const [stackRef, seen] = useInView<HTMLDivElement>(0.4)
	const [step, setStep] = useState(0)

	// Which rows have finished drawing: while the scrub is still travelling, that
	// is the active route; once it lands, the timer takes the wheel.
	const drawn = rows.reduce((n, _r, i) => (scrubSlice(p, i * 0.12, 0.4) > 0.995 ? i + 1 : n), 0)
	const settled = p > 0.995
	const live = seen && !reduced
	const route = live ? (settled ? step % rows.length : drawn - 1) : -1

	useEffect(() => {
		if (!live || !settled) return
		const t = setInterval(() => setStep((s) => s + 1), CADENCE_MS)
		return () => clearInterval(t)
	}, [live, settled])

	return (
		<div ref={ref} data-t2="routes" className="border-border mt-12 border-t">
			<div ref={stackRef} data-t4="routes-stack" className="min-w-0">
				{rows.map((r, i) => {
					const start = i * 0.12
					const line = scrubSlice(p, start, 0.4)
					const copy = scrubSlice(p, start + 0.1, 0.3)
					const fade = 1 - scrubSlice(line, 0.82, 0.18)
					const isRoute = i === route
					return (
						<div
							key={r.family}
							data-t4={isRoute ? 'route-live' : undefined}
							className="border-border hover:bg-surface group relative border-b"
						>
							<div
								className={cn(
									'ease-expo flex items-baseline justify-between gap-6 py-4 pl-8 transition-colors duration-[var(--motion-base)]',
									live && 'route-breathe'
								)}
								style={{
									opacity: copy,
									transform: `translateY(${((1 - copy) * 8).toFixed(2)}px)`,
									animationDelay: `${i * 700}ms`
								}}
							>
								<span className="font-display text-text w-24 text-[18px] font-semibold tracking-[-0.01em]">
									{r.family}
								</span>
								<span
									className={cn(
										'text-right font-mono text-[12px]',
										r.dim ? 'text-text-faint' : 'text-text-muted'
									)}
								>
									{r.slug}
								</span>
							</div>

							{/* the decision node at the head of the branch */}
							<span
								aria-hidden
								className="border-border bg-surface absolute top-1/2 left-[9px] size-2.5 -translate-y-1/2 rounded-full border"
								style={{
									opacity: copy,
									borderColor: isRoute ? 'var(--accent)' : undefined
								}}
							>
								{isRoute && (
									<span
										key={`glow-${step}`}
										aria-hidden
										className="route-glow bg-accent/30 absolute inset-0 rounded-full"
									/>
								)}
							</span>

							{/* the route being drawn, then handed back to the row's hairline */}
							<span
								aria-hidden
								className="route-line bg-accent absolute bottom-0 left-0 h-px w-full origin-left"
								style={{ transform: `scaleX(${line.toFixed(3)})`, opacity: fade }}
							/>
							<span
								aria-hidden
								className="route-track absolute bottom-0 left-0 h-0 w-full"
								style={{
									// -100% parks the right-pinned dot on the row's left edge,
									// 0% at its right edge: the dot tracks the drawing tip.
									transform: `translate3d(${((line - 1) * 100).toFixed(2)}%, 0, 0)`,
									opacity: line > 0.001 && line < 0.999 ? fade : 0
								}}
							>
								<span className="bg-accent route-packet absolute right-0 bottom-[-3px] size-1.5 rounded-full" />
							</span>

							{/* the request that picked this route: it runs the branch and
							    flashes where it lands, then the next one is dispatched */}
							{isRoute && (
								<span
									key={`shot-${step}`}
									aria-hidden
									className="route-track route-shot absolute bottom-0 left-0 h-0 w-full"
								>
									<span className="bg-accent route-landed absolute right-0 bottom-[-3px] size-1.5 rounded-full" />
								</span>
							)}
							<span
								aria-hidden
								className="bg-accent/40 group-hover:bg-accent/70 ease-expo absolute bottom-0 left-0 h-px w-full opacity-0 transition-opacity duration-[var(--motion-base)] group-hover:opacity-100"
							/>
						</div>
					)
				})}
			</div>
		</div>
	)
}
