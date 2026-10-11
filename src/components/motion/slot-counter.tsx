'use client'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Slot-machine counters (V4 §4, the metrics moment). Each digit is a reel of
// 0-9 repeated, translated from row 0 to its final row by one long-out easing,
// so the strip genuinely scrolls past real digits and decelerates into its
// stop — no number re-rendered 60 times a second, no rAF of our own. Stops come
// left-to-right (`stopMs` grows with the digit index), each landing gives the
// digit a spring "click", and one sonar ping leaves the number when the last
// reel stops. The caption only drifts up after that, so text never arrives
// ahead of the figure it describes.
//
// Widths: the reels are tabular by declaration, so every digit cell has the
// same advance and the columns cannot jitter as they scroll.
//
// Content contract: the digits are real DOM text and the value is the same one
// the copy states; the spinning layer is `aria-hidden` and an sr-only twin
// carries the final number once, so a screen reader gets "24 — tasks in the
// completed live benchmark" and never the twelve rows it scrolled through.

const DIGITS = '0123456789'
const REPS = 4
const FINAL_ROW = (d: number) => REPS * DIGITS.length + d
const N_ROWS = REPS * DIGITS.length + DIGITS.length

// Leftmost stops first: 0.76 s for the first reel, +0.2 s per column after it.
const stopMs = (i: number) => 760 + i * 200

export function SlotNumber({
	to,
	suffix = '',
	label,
	className
}: {
	to: number
	suffix?: string
	label?: string
	className?: string
}) {
	const reduced = useReducedMotion()
	const [ref, inView] = useInView<HTMLDivElement>(0.5)
	const run = !reduced && inView
	const [landed, setLanded] = useState(false)
	const chars = `${to}${suffix}`.split('')
	const last = chars.length - 1

	useEffect(() => {
		if (!run) return
		const t = setTimeout(() => setLanded(true), stopMs(last) + 200)
		return () => clearTimeout(t)
	}, [run, last])

	const done = reduced || landed

	return (
		<div ref={ref} data-t4="slot" className={className}>
			{/* The accessible value is stated once, from the settled number; the
			    spinning reels are decoration and never read out. */}
			<span className="sr-only">
				{to}
				{suffix}
				{label ? ` — ${label}` : ''}
			</span>
			<span
				aria-hidden
				className="font-numeric font-display relative inline-flex leading-none font-bold tracking-[-0.04em]"
			>
				{chars.map((c, i) => {
					if (!DIGITS.includes(c))
						return (
							<span key={i} className="inline-block">
								{c}
							</span>
						)
					const rows = FINAL_ROW(Number(c))
					return (
						<span
							key={i}
							className={cn('relative block h-[1em] overflow-hidden', run && 'slot-land')}
							style={run ? { animationDelay: `${stopMs(i)}ms` } : undefined}
						>
							<span
								className="ease-slot-reel block"
								style={{
									// reduced motion pins the reel at its final row: row 0 of the strip is the digit
									// `0`, so a resting-at-zero reel would silently display the wrong figure (§6.9).
									transform: run || reduced ? `translateY(${-rows}em)` : 'translateY(0)',
									transitionDuration: `${stopMs(i)}ms`,
									transitionDelay: `${i * 40}ms`
								}}
							>
								{Array.from({ length: N_ROWS }, (_, r) => DIGITS[r % DIGITS.length]).map((d, r) => (
									<span key={r} className="block h-[1em]">
										{d}
									</span>
								))}
							</span>
						</span>
					)
				})}
				{run && (
					<span
						aria-hidden
						className="slot-ping border-accent pointer-events-none absolute top-1/2 left-1/2 size-[1.4em] -translate-x-1/2 -translate-y-1/2 rounded-full border"
						style={{ animationDelay: `${stopMs(last)}ms` }}
					/>
				)}
			</span>
			{label && (
				<p
					className={cn(
						'text-text-faint ease-expo mt-3 max-w-[24ch] text-[13px] leading-[1.5] transition-all duration-[900ms]',
						done ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
					)}
				>
					{label}
				</p>
			)}
		</div>
	)
}
