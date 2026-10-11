'use client'
import { useEffect, useMemo, useState } from 'react'
import { drawProps, scrubSlice, useScrub } from '@/lib/motion/use-scrub'

// Three strands that enter from the left edge, run horizontally with the reader,
// loop all the way around the section heading and then straighten into a vertical
// descent. The guide geometry is sampled once per layout change; scroll only moves
// a dash offset, so the frame cost is one attribute write per strand and the curve
// itself never re-flows anything.

type Strand = {
	color: string
	width: number
	opacity: number
	start: number
	span: number
	dip: number
	exit: number
}

const STRANDS: Strand[] = [
	{ color: 'var(--flow-input-a)', width: 7, opacity: 1, start: 0, span: 0.8, dip: 54, exit: 0.22 },
	{
		color: 'var(--flow-input-b)',
		width: 5.5,
		opacity: 0.92,
		start: 0.07,
		span: 0.8,
		dip: 18,
		exit: -0.36
	},
	{
		color: 'var(--flow-route-a)',
		width: 4,
		opacity: 0.45,
		start: 0.15,
		span: 0.76,
		dip: 86,
		exit: 0.54
	}
]

const smooth = (u: number) => u * u * (3 - 2 * u)

function strandPath(w: number, h: number, hb: Box, s: Strand, i: number): string {
	const cx = hb.x + hb.w / 2
	const cy = hb.y + hb.h / 2
	const rx = hb.w / 2 + 38 + i * 20
	const ry = hb.h / 2 + 30 + i * 16
	const x0 = -30
	const y0 = Math.max(16, cy - ry - 64 + i * 34)
	const pts: string[] = []
	const push = (x: number, y: number) => pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`)

	for (let k = 0; k <= 34; k++) {
		const u = smooth(k / 34)
		push(x0 + (cx - rx - x0) * u, y0 + (cy - y0) * u - s.dip * Math.sin(Math.PI * (k / 34)))
	}
	const turns = 1.9
	for (let k = 1; k <= 92; k++) {
		const th = Math.PI + (k / 92) * turns * Math.PI
		push(cx + rx * Math.cos(th), cy + ry * Math.sin(th))
	}
	const end = Math.PI + turns * Math.PI
	const sx = cx + rx * Math.cos(end)
	const sy = cy + ry * Math.sin(end)
	const tx = cx + rx * s.exit
	for (let k = 1; k <= 40; k++) {
		const u = smooth(k / 40)
		push(sx + (tx - sx) * u, sy + (h + 40 - sy) * u)
	}
	return `M ${pts[0] ?? '0 0'} L ${pts.slice(1).join(' L ')}`
}

type Box = { x: number; y: number; w: number; h: number }
type Frame = { w: number; h: number; hb: Box } | null

export function StrandTrail({ heading = 'h2' }: { heading?: string }) {
	const [ref, p] = useScrub<HTMLDivElement>(1.5)
	const [frame, setFrame] = useState<Frame>(null)

	useEffect(() => {
		const host = ref.current
		if (!host) return
		const read = () => {
			const wrap = host.getBoundingClientRect()
			// The heading this choreography orbits is a SIBLING (landing-page puts StrandTrail
			// next to <SectionHead>), so it can only be found from the wrapper. Looking inside
			// `host` was self-referential: the svg that would contain nothing is only rendered
			// once a frame exists, so the frame never existed and no strand ever painted.
			const head = host.parentElement
				?.querySelector(heading)
				?.getBoundingClientRect()
			if (wrap.width < 1 || !head) return
			setFrame({
				w: Math.round(wrap.width),
				h: Math.round(wrap.height),
				hb: {
					x: head.left - wrap.left,
					y: head.top - wrap.top,
					w: Math.round(head.width),
					h: Math.round(head.height)
				}
			})
		}
		read()
		const ro = new ResizeObserver(read)
		ro.observe(host)
		window.addEventListener('resize', read)
		return () => {
			ro.disconnect()
			window.removeEventListener('resize', read)
		}
	}, [heading, ref])

	const paths = useMemo(
		() => (frame ? STRANDS.map((s, i) => strandPath(frame.w, frame.h, frame.hb, s, i)) : []),
		[frame]
	)

	return (
		<div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
			{frame && (
				<svg
					width={frame.w}
					height={frame.h}
					viewBox={`0 0 ${frame.w} ${frame.h}`}
					// The choreography deliberately leaves the box: strands enter from x=-30 and
					// the orbit radii are the heading width plus up to 78px of margin. UA default
					// for <svg> is overflow:hidden, which would cut both the fly-in and the loop.
					overflow="visible"
					fill="none"
					className="absolute inset-0"
					style={{ transform: `translate3d(${((p - 0.5) * 16).toFixed(2)}px,0,0)` }}
				>
					{STRANDS.map((s, i) => (
						<path
							key={i}
							d={paths[i] ?? ''}
							style={{ stroke: s.color }}
							strokeWidth={s.width}
							strokeOpacity={s.opacity}
							strokeLinecap="round"
							strokeLinejoin="round"
							{...drawProps(scrubSlice(p, s.start, s.span))}
						/>
					))}
				</svg>
			)}
		</div>
	)
}
