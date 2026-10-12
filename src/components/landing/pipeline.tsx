'use client'

import { useState } from 'react'
import { scrubSlice, useScrub } from '@/lib/motion/use-scrub'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// The D1 pipeline drawn BY SCROLL (brief §6.2-3): forward edges extend as the
// section travels through the viewport (stroke-dashoffset scrubbed, not a
// one-shot transition), nodes lift in ahead of their edge, the REWORK loop
// pulses once it arrives, and PASS closes the run. One scrub drives every
// stage, so the diagram reads as the pipeline executing. Reduced motion pins
// the scrub to 1: everything is fully drawn and nothing pulses.
//
// V4 §4 adds four things on top of that drawing, all of them still scrub-driven
// so no timer or extra rAF enters the page:
//   * each node *pops* — a spring curve evaluated on the node's own progress,
//     so the overshoot is a property of the scroll position rather than a
//     transition that could be caught mid-flight by a scroll jump;
//   * a data dot rides the drawing tip of every edge, and the looping packet
//     keeps running once the row is drawn;
//   * hovering a stage lifts it, dims the other stages to 0.3 and puts accent
//     on the two edges it owns;
//   * a stage readout names the phase the scrub is inside.
// The lift and the dim live on an **inner** group: the outer group's transform
// and opacity are written every frame by the scrub, so a transition there would
// make the drawing lag behind the wheel.
//
// §4's example readout says "1 of 6"; the pipeline drawn here has five stages
// (six is the architecture layer count, section 11), so the counter says
// "of 5". A number that matched the brief but not the diagram would be the one
// kind of polish that lies.
//
// Node names are the pipeline's real stages, not marketing.

export type Stage = { id: string; label: string; sub: string }

// Exported (V6 Job 2) so the pinned carousel renders the SAME five stages this
// diagram draws, from one source of truth — the carousel writes no copy of its
// own. Nothing about the scrubbed drawing below changed.
export const STAGES: Stage[] = [
	{ id: 'plan', label: 'Plan', sub: 'Jev classifies' },
	{ id: 'team', label: 'Dynamic team', sub: 'researcher · critic · synthesizer' },
	{ id: 'evidence', label: 'Evidence hub', sub: 'claims + sources' },
	{ id: 'critics', label: 'Critics', sub: 'D4: enough? valid?' },
	{ id: 'judge', label: 'Judge', sub: 'final verdict' }
]

// Layout: five nodes on a row, forward links between them, one curved
// REWORK edge judge → team. The viewBox is wider than the node row so the
// PASS terminal at the right stays inside the drawing.
const ROW = 980
const VW = 1064
const VH = 320
const NODE_W = 150
const NODE_H = 72
const Y = 120
const EASE = 'var(--ease-expo)'

function nodeX(i: number): number {
	const gap = (ROW - STAGES.length * NODE_W) / (STAGES.length - 1)
	return i * (NODE_W + gap)
}

// The sub line is 10px mono inside a NODE_W-wide box, so ~22 characters fit
// (0.6em advance, 8px of side padding). "researcher · critic · synthesizer" is
// 33, and drew itself straight through the card edge, so a sub that does not fit
// wraps on its separators and the block re-centres on the node.
//
// The separator is part of the copy, not layout glue: it has to survive the wrap.
// Dropping it at the break changed the rendered sentence ("critic synthesizer"),
// which a byte-for-byte copy gate catches.
const SUB_MAX_CHARS = Math.floor((NODE_W - 16) / 6)
const SUB_LEADING = 12

function wrapSub(sub: string, max = SUB_MAX_CHARS): string[] {
	const lines: string[] = []
	let line = ''
	for (const item of sub.split('·').map((s) => s.trim())) {
		if (!item) continue
		const next = line ? `${line} · ${item}` : item
		if (next.length > max && line) {
			lines.push(`${line} ·`)
			line = item
		} else line = next
	}
	if (line) lines.push(line)
	return lines
}

// Spring pop, evaluated on progress rather than on time: 0.82 → 1.08 at 70% of
// the node's own slice, settling to exactly 1. Same shape at the same scroll
// position on every pass, which is what keeps a scrubbed overshoot readable.
function popOf(q: number): number {
	const t = Math.min(1, Math.max(0, q))
	return t < 0.7 ? 0.82 + (0.26 * t) / 0.7 : 1.08 - (0.08 * (t - 0.7)) / 0.3
}

export function PipelineDiagram() {
	const reduced = useReducedMotion()
	const [ref, p] = useScrub<HTMLDivElement>(1.1)
	const [hover, setHover] = useState<number | null>(null)

	const link = (i: number) => scrubSlice(p, 0.08 + i * 0.15, 0.17)
	const node = (i: number) => scrubSlice(p, i * 0.11, 0.26)
	const rework = scrubSlice(p, 0.7, 0.2)
	const pass = scrubSlice(p, 0.86, 0.14)
	const drawn = p > 0.72 && !reduced
	const active = STAGES.reduce((n, _s, i) => (node(i) > 0.5 ? i + 1 : n), 0)
	const phase = active > 0 ? STAGES[active - 1] : undefined

	return (
		<div
			ref={ref}
			data-t2="pipeline"
			className="border-border bg-surface w-full overflow-hidden rounded-xl border"
		>
			<svg viewBox={`0 0 ${VW} ${VH}`} aria-hidden className="h-auto w-full">
				{/* Forward links: each line's own length is its dash cycle, so the
				    offset is a pure fraction of the scroll. The dot sits at the tip
				    the edge has been drawn to. */}
				{STAGES.slice(0, -1).map((s, i) => {
					const x1 = nodeX(i) + NODE_W
					const x2 = nodeX(i + 1)
					const q = link(i)
					const hot = hover === i || hover === i + 1
					return (
						<g key={s.id}>
							<line
								x1={x1}
								y1={Y + NODE_H / 2}
								x2={x2}
								y2={Y + NODE_H / 2}
								stroke={hot ? 'var(--accent)' : 'var(--border-strong)'}
								strokeWidth={hot ? 2.2 : 1.5}
								strokeDasharray={x2 - x1}
								strokeDashoffset={(1 - q) * (x2 - x1)}
								style={{ transition: reduced ? 'none' : `stroke 320ms ${EASE}` }}
							/>
							<path
								d={`M ${x2 - 6} ${Y + NODE_H / 2 - 4} L ${x2} ${Y + NODE_H / 2} L ${x2 - 6} ${Y + NODE_H / 2 + 4}`}
								fill="none"
								stroke={hot ? 'var(--accent)' : 'var(--border-strong)'}
								strokeWidth="1.5"
								opacity={q > 0.98 ? 1 : 0}
							/>
							<circle
								cx={x1 + (x2 - x1) * q}
								cy={Y + NODE_H / 2}
								r="3"
								fill="var(--accent)"
								opacity={q > 0.02 && q < 0.97 ? 0.9 : 0}
							/>
						</g>
					)
				})}

				{/* The packet: an accent dot running the drawn row, so the diagram
				    keeps moving after it has been drawn. Transform-only animation,
				    removed entirely under reduced motion. */}
				<g
					opacity={drawn ? 1 : 0}
					style={{ transition: reduced ? 'none' : `opacity 600ms ${EASE}` }}
				>
					<circle
						cx={nodeX(0)}
						cy={Y + NODE_H / 2}
						r="3"
						fill="var(--accent)"
						className={drawn && !reduced ? 'pipeline-flow' : undefined}
					/>
				</g>

				{/* REWORK edge: judge → team, curved below, pulsing once drawn */}
				<path
					d={`M ${nodeX(4) + NODE_W / 2} ${Y + NODE_H} C ${nodeX(4)} ${Y + NODE_H + 110}, ${nodeX(1) + NODE_W} ${Y + NODE_H + 110}, ${nodeX(1) + NODE_W / 2} ${Y + NODE_H + 4}`}
					fill="none"
					stroke="var(--accent)"
					strokeOpacity={0.65 * rework}
					strokeWidth="1.5"
					strokeDasharray="6 6"
					className={rework > 0.6 && !reduced ? 'pipeline-rework' : undefined}
				/>
				<text
					x={(nodeX(1) + NODE_W / 2 + nodeX(4) + NODE_W / 2) / 2}
					y={Y + NODE_H + 92}
					textAnchor="middle"
					className="font-mono"
					fill="var(--accent)"
					fontSize="11"
					letterSpacing="0.14em"
					opacity={0.9 * rework}
				>
					REWORK
				</text>
				<path
					d={`M ${nodeX(1) + NODE_W / 2 - 5} ${Y + NODE_H + 8} L ${nodeX(1) + NODE_W / 2} ${Y + NODE_H - 1} L ${nodeX(1) + NODE_W / 2 + 5} ${Y + NODE_H + 8}`}
					fill="none"
					stroke="var(--accent)"
					strokeOpacity={0.65 * rework}
					strokeWidth="1.5"
				/>

				{/* Nodes: outer group carries the scrub (no transition), inner group
				    carries the hover response (transition). */}
				{STAGES.map((s, i) => {
					const x = nodeX(i)
					const q = node(i)
					const subLines = wrapSub(s.sub)
					const isHot = hover === i
					const dim = hover === null || isHot ? 1 : 0.3
					return (
						<g
							key={s.id}
							onPointerEnter={() => setHover(i)}
							onPointerLeave={() => setHover((h) => (h === i ? null : h))}
							style={{
								opacity: q,
								transform: `translateY(${((1 - q) * 10).toFixed(2)}px) scale(${popOf(q).toFixed(3)})`,
								transformBox: 'fill-box',
								transformOrigin: 'center'
							}}
						>
							<g
								className="pipeline-lift"
								style={{
									opacity: dim,
									transform: isHot ? 'translateY(-5px)' : 'translateY(0)',
									transition: reduced ? 'none' : `transform 320ms ${EASE}, opacity 320ms ${EASE}`
								}}
							>
								<rect
									x={x}
									y={Y}
									width={NODE_W}
									height={NODE_H}
									rx="10"
									fill="var(--surface-hover)"
									stroke={
										isHot ? 'var(--accent)' : q > 0.99 ? 'var(--border-strong)' : 'var(--border)'
									}
									style={{ transition: reduced ? 'none' : `stroke 320ms ${EASE}` }}
								/>
								<text
									x={x + NODE_W / 2}
									y={Y + 30}
									textAnchor="middle"
									fill="var(--text)"
									fontSize="15"
									fontWeight="600"
									letterSpacing="-0.01em"
								>
									{s.label}
								</text>
								{/* §4: the label lands after the node it names. */}
								{subLines.map((line, k) => (
									<text
										key={line}
										x={x + NODE_W / 2}
										y={Y + 50 - ((subLines.length - 1) * SUB_LEADING) / 2 + k * SUB_LEADING}
										textAnchor="middle"
										fill="var(--text-faint)"
										fontSize="10"
										opacity={scrubSlice(p, i * 0.11 + 0.09, 0.22)}
										className="font-mono"
									>
										{line}
									</text>
								))}
							</g>
						</g>
					)
				})}

				{/* PASS terminal */}
				<g opacity={pass}>
					<circle cx={nodeX(4) + NODE_W + 26} cy={Y + NODE_H / 2} r="5" fill="var(--accent)" />
					<text
						x={nodeX(4) + NODE_W + 40}
						y={Y + NODE_H / 2 + 4}
						fill="var(--text-muted)"
						fontSize="11"
						letterSpacing="0.12em"
					>
						PASS
					</text>
				</g>
			</svg>

			{/* Scroll-linked stage progress (§4). Derived from the same scrub that
			    draws the diagram, so the readout can never disagree with the ink. */}
			<div
				data-t4="stage-progress"
				className="border-border flex items-baseline justify-between gap-3 border-t px-4 py-2.5"
			>
				<span className="label-uppercase text-text-faint">
					Stage {active} of {STAGES.length}
				</span>
				<span className="text-text-muted font-mono text-[11px]">
					{phase ? phase.label : 'scroll to run'}
				</span>
			</div>

			<style>{`
				@keyframes rework-dash { to { stroke-dashoffset: -48; } }
				.pipeline-rework { animation: rework-dash 1600ms linear infinite; }
				@keyframes pipeline-flow {
					0% { transform: translateX(0); opacity: 0; }
					12% { opacity: 1; }
					88% { opacity: 1; }
					100% { transform: translateX(980px); opacity: 0; }
				}
				.pipeline-flow { animation: pipeline-flow 3600ms var(--ease-in-out) infinite; }
				.pipeline-lift { cursor: default; }
				@media (prefers-reduced-motion: reduce) {
					.pipeline-rework, .pipeline-flow { animation: none; }
				}
			`}</style>
		</div>
	)
}
