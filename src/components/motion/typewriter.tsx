'use client'

import { scrubSlice, useScrub } from '@/lib/motion/use-scrub'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { cn } from '@/lib/cn'

// Scroll-driven typewriter (brief §6.2-6: "terminal snippet types in on scroll").
// The script is data, so the real engine events stay readable and the reveal is
// just a slice of it: characters appear as the block travels through the
// viewport, a block caret sits at the write head, and reduced motion renders the
// finished log immediately. Rich runs (dim label · white value · accent
// decision) survive because each line is segments, not one string.

export type TypeTone = 'dim' | 'text' | 'accent'
export type TypeSeg = { t: string; tone?: TypeTone }

const TONE = {
	dim: 'text-text-faint',
	text: 'text-text',
	accent: 'text-accent'
} as const

const lineLen = (line: TypeSeg[]) => line.reduce((n, s) => n + s.t.length, 0)

type Row = { segs: { text: string; tone?: TypeTone }[]; caret: boolean }

export function Typewriter({
	lines,
	className,
	travel = 1.2
}: {
	lines: TypeSeg[][]
	className?: string
	travel?: number
}) {
	const reduced = useReducedMotion()
	const [ref, p] = useScrub<HTMLPreElement>(travel)

	const total = lines.reduce((n, l) => n + lineLen(l), 0)
	const shown = reduced ? total : Math.round(scrubSlice(p, 0.04, 0.66) * total)

	// One pure pass over the script: characters left → per-line slices → which
	// line holds the write head. Built as data so the render below stays a
	// straight map with no mutable carry-over.
	const rows: Row[] = []
	let remaining = shown
	let head: Row | null = null
	for (const line of lines) {
		let budget = Math.max(0, Math.min(lineLen(line), remaining))
		remaining -= budget
		const segs: Row['segs'] = []
		for (const seg of line) {
			const n = Math.max(0, Math.min(seg.t.length, budget))
			budget -= n
			segs.push({ text: seg.t.slice(0, n), tone: seg.tone })
		}
		const row: Row = { segs, caret: false }
		// write head = the last line with any visible characters
		if (segs.some((s) => s.text.length > 0)) head = row
		rows.push(row)
	}
	if (!head) head = rows[0] ?? null
	if (head) head.caret = true

	return (
		<pre ref={ref} data-t2="type" className={cn('font-mono whitespace-pre-wrap', className)}>
			{rows.map((r, i) => (
				<span key={i} className="block">
					{r.segs.map((s, j) => (
						<span key={j} className={cn(s.tone && TONE[s.tone])}>
							{s.text}
						</span>
					))}
					{r.caret && (
						<span
							aria-hidden
							className="caret-blink bg-accent ml-0.5 inline-block h-[1em] w-[0.55ch] translate-y-[0.15em]"
						/>
					)}
				</span>
			))}
		</pre>
	)
}
