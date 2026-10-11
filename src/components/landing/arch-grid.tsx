'use client'

import { drawProps, scrubSlice, useScrub } from '@/lib/motion/use-scrub'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { cn } from '@/lib/cn'

// The six architecture layers, drawn on scroll (brief §6.2-9): each glyph's
// stroke extends as the grid travels through the viewport, a card lifts into
// place ahead of its own line, and the finished glyph gains the accent glow
// with a node pulse on its layer id — the diagram keeps breathing after it is
// drawn. One scrub drives all six, so the layers arrive in D1 → D6 order.
// Reduced motion pins the scrub at 1: glyphs fully drawn, glow steady, no pulse.

const ARCH = [
	{
		d: 'D1',
		title: 'Entry → plan → team',
		body: 'The question hits Jev, which plans and staffs a dynamic team for this run alone.',
		glyph:
			'M4 12h4m0 0 5-5m-5 5 5 5M14 7h6m-6 10h6m-3-10v0m3 10a1 1 0 1 0-2 0 1 1 0 0 0 2 0Zm0-10a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'
	},
	{
		d: 'D2',
		title: 'Evidence RAG hub',
		body: 'Workers and critics read and write the same structured hub — claims, sources, status.',
		glyph: 'M4 8l8-4 8 4-8 4-8-4Zm0 4 8 4 8-4m-16 4 8 4 8-4'
	},
	{
		d: 'D3',
		title: 'Orchestra → MCP',
		body: 'Agents execute through MCP tools — research, repo, browser — with every call evented.',
		glyph:
			'M12 4v4m0 0H6v4m6-4h6v4M6 12v4h5m7-4v4h-5m-2-8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm8 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 20a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm8 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z'
	},
	{
		d: 'D4',
		title: 'Two verification gates',
		body: 'Enough evidence? Evidence valid? Both gates must pass before the judge sees the draft.',
		glyph:
			'M4 12h3m4 0h3m4 0h2M8 8v8m8-8v8m-4-4a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z'
	},
	{
		d: 'D5',
		title: 'Replan loop',
		body: 'A failing gate can spawn new agents mid-run — the delta team closes the gap and feeds back in.',
		glyph: 'M18 8a6 6 0 1 0 1 4m-1-4h4m-4 0V4'
	},
	{
		d: 'D6',
		title: 'Run view + replay',
		body: 'One terminal shows team, events, evidence, spend and gates live — and replays any finished run.',
		glyph: 'M4 6h16v12H4zM8 10l3 2-3 2m6 0h3'
	}
] as const

export function ArchGrid() {
	const reduced = useReducedMotion()
	const [ref, p] = useScrub<HTMLDivElement>(1.15)

	return (
		<div ref={ref} data-t2="arch" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{ARCH.map((a, i) => {
				const q = scrubSlice(p, i * 0.08, 0.34)
				const card = scrubSlice(p, i * 0.08, 0.24)
				const lit = q > 0.985
				return (
					<div
						key={a.d}
						className="border-border bg-surface ease-expo h-full rounded-xl border p-6 transition-[border-color,background-color] duration-[var(--motion-base)] hover:border-[var(--border-strong)]"
						style={{
							opacity: card,
							transform: `translateY(${((1 - card) * 16).toFixed(2)}px)`
						}}
					>
						<svg
							viewBox="0 0 24 24"
							aria-hidden
							fill="none"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
							className={cn('arch-glyph h-8 w-full', lit ? 'text-accent arch-lit' : 'text-accent/70')}
						>
							<path d={a.glyph} {...drawProps(q)} />
						</svg>
						<div className="text-text-faint mt-4 flex items-center gap-2 font-mono text-[10px] tracking-[0.18em]">
							<span
								className={cn(
									'size-1 rounded-full',
									lit ? 'bg-accent' : 'bg-border-strong',
									lit && !reduced && 'arch-pulse'
								)}
							/>
							{a.d}
						</div>
						<h3 className="font-display text-text mt-1 text-[17px] font-semibold tracking-[-0.01em]">
							{a.title}
						</h3>
						<p className="text-text-muted mt-2 text-[13px] leading-[1.55]">{a.body}</p>
					</div>
				)
			})}

			<style>{`
				.arch-lit { filter: drop-shadow(0 0 5px color-mix(in oklab, var(--accent) 45%, transparent)); }
				@keyframes arch-node {
					0%, 100% { transform: scale(1); opacity: 1; }
					50% { transform: scale(2.1); opacity: 0.45; }
				}
				.arch-pulse { animation: arch-node 2200ms var(--ease-in-out) infinite; }
				@media (prefers-reduced-motion: reduce) { .arch-pulse { animation: none; } }
			`}</style>
		</div>
	)
}
