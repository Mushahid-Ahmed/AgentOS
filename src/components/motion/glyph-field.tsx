'use client'
import { useEffect, useRef } from 'react'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// V8 Job 4: the CTA's cursor-pushed glyph field, mounted where the warm thermal blob was removed.
// The owner's reference is lusion.co's confetti field — hundreds of tiny geometric marks (+, ×, ○,
// •, △, □) that the pointer shoves aside and that spring back into their lattice when it leaves.
//
// Three decisions make that ours rather than a copy:
//
//   * It is a LATTICE, not a drift. Every glyph owns a home coordinate and a spring pulls it back,
//     so the section keeps its composition while the pointer writes through it. `cursor-field.tsx`
//     is the opposite: 90 motes with drag and no home, which is why they read as dust. Both can run
//     in one section without becoming soup — the glyphs are structure, the motes are light.
//   * It keeps a void. The heading sits in an elliptical hole in the field with a 60px feather, so
//     no mark ever lands behind the copy. That is what the reference does (measured: 7.7% of its
//     marks fall in the centre of the frame), and here it is also the contrast argument — white
//     confetti under 72px type is a legibility problem before it is a design one.
//   * It has no colours of its own. Resting marks take `--text`, marks the pointer is moving take
//     `--accent`, both resolved from the cascade once at start because a canvas cannot read it.
//
// Cost, per §6.4 (particle systems are canvas, never DOM nodes): one rAF, gated by an
// IntersectionObserver so the loop stops and the surface clears when the CTA scrolls away; glyphs
// pooled once per layout and never re-allocated per frame. Every mark is still drawn every frame —
// the marks breathe continuously, so nothing can be skipped — but they are emitted into one path per
// colour and alpha level instead of one path per mark, because the 420 separate strokes were the
// frame cost: under a 4x CPU throttle the field's marginal per-frame cost — each arm paired against
// its own hidden arm inside one run, so the number is a within-run difference and not a cross-run
// fps comparison — fell from 74.8ms at rest and 84.6ms while pushed to 31.9ms and 35.5ms
// (`_lh/v8j4-fps.mjs` run 1 against runs 5 and 6 of this artifact; the two later runs bracket the
// machine rather than the field, their off-arm noise floors being 1.6-4.2fps and 5.8-17.8fps), which
// leaves 8-9ms of real work per frame: frames under that artificial throttle, none at 1x. Drawing the
// marks as pre-rendered sprites instead of paths measured worse still (`_lh/v8j4-drawbench.mjs`:
// 31.6ms vs 6.9ms per frame). `_lh/v8j4-paintparity.mjs` proves the two renderers put the same pixels
// down: every mark lands within 0.018px of where it used to and 2.8% of its own pixels differ by more
// than 8/255, against 37% for a control renderer that really moved them. At 1x — the machine a reader
// actually uses — the field costs nothing measurable: 60fps with the pointer pushing it (p50 16.7ms,
// p95 16.8ms, no frame longer than two vsyncs) against 60fps without it.
// `prefers-reduced-motion` renders no canvas at all rather than a paused one.
//
// The pointer arrives on `window`, not on the host. The host is `pointer-events-none` so the field
// cannot eat clicks meant for the Sign up button, and a pointer-events:none element is skipped by
// hit-testing — which is why a listener bound to it never fires. Measured before writing this:
// 25 trusted mouse moves over the section delivered 25 pointermove events to the section and 0 to
// the field host. So the field listens globally and tests containment itself.

type Glyph = {
	hx: number
	hy: number
	x: number
	y: number
	vx: number
	vy: number
	shape: number
	size: number
	rot: number
	spin: number
	phase: number
	feather: number
}

const PLUS = 0
const CROSS = 1
const RING = 2
const DOT = 3
const TRI = 4
// Six marks, in the reference's order of frequency: the two stroke crosses, a ring, a solid dot,
// and two cornered marks (TRI here, the square in `mark`'s default arm). Dots are the only filled
// shape, which keeps the field light.

const PER_PX2 = 1 / 2600
const MIN_GLYPHS = 110
const MAX_GLYPHS = 420
const RADIUS = 165
const PUSH = 5.4
const SPRING = 0.016
const DAMP = 0.87
const BREATH = 1.6
// Displacement at which a mark stops being neutral ink and takes the accent.
const HOT = 5
// Marks are batched by alpha so a bucket can be laid down with one stroke. 1/32 is the coarsest
// step that stays invisible here: the resting field runs at alpha 0.14-0.30 on a near-black ground,
// so the rounding moves a mark by at most ~4 of 255 luminance levels.
const ALPHA_STEPS = 32

export function GlyphField({ className = '' }: { className?: string }) {
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

		const dpr = Math.min(2, window.devicePixelRatio || 1)
		let w = 0
		let h = 0
		let glyphs: Glyph[] = []

		const inks = getComputedStyle(document.documentElement)
		const ink = inks.getPropertyValue('--text').trim()
		const hot = inks.getPropertyValue('--accent').trim()

		const build = () => {
			const rect = box.getBoundingClientRect()
			w = Math.max(1, Math.round(rect.width))
			h = Math.max(1, Math.round(rect.height))
			canvas.width = Math.round(w * dpr)
			canvas.height = Math.round(h * dpr)
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

			// The void is where the heading sits: centred a little above the section's middle, wide
			// enough for the 16ch headline and tall enough for its two lines plus the button row.
			const cx = w * 0.5
			const cy = h * 0.44
			const rx = Math.max(60, w * 0.33)
			const ry = Math.max(50, h * 0.3)

			const count = Math.max(MIN_GLYPHS, Math.min(MAX_GLYPHS, Math.round(w * h * PER_PX2)))
			const list: Glyph[] = []
			for (let i = 0; i < count; i++) {
				let x = 0
				let y = 0
				let nr = 0
				// Rejection-sample the hole out rather than fading marks inside it: a dim glyph
				// behind a letterform is still a glyph behind a letterform.
				for (let t = 0; t < 14; t++) {
					x = Math.random() * w
					y = Math.random() * h
					nr = Math.hypot((x - cx) / rx, (y - cy) / ry)
					if (nr >= 1) break
				}
				if (nr < 1) continue
				const big = Math.random() < 0.14
				list.push({
					hx: x,
					hy: y,
					x,
					y,
					vx: 0,
					vy: 0,
					shape: Math.floor(Math.random() * 6),
					size: big ? 5 + Math.random() * 5 : 2 + Math.random() * 3.4,
					rot: Math.random() * Math.PI,
					spin: (Math.random() - 0.5) * 0.004,
					phase: Math.random() * Math.PI * 2,
					feather: Math.min(1, ((nr - 1) * rx) / 60)
				})
			}
			glyphs = list
		}
		build()

		const pointer = { cx: -9999, cy: -9999, live: false }
		const onMove = (e: PointerEvent) => {
			pointer.cx = e.clientX
			pointer.cy = e.clientY
			pointer.live = true
		}
		const onOut = () => {
			pointer.live = false
		}

		let t = 0
		let raf = 0
		let running = false

		// One mark's geometry, written directly in canvas coordinates so that marks sharing a colour
		// and an alpha level can be emitted into one Path2D and laid down with one stroke call. The
		// rotation the previous per-glyph transform applied is applied to the vertices by math
		// instead: a rotated segment is the same segment, and the two round marks are invariant
		// under their own rotation, so the pixels land where they used to.
		const seg = (
			p: Path2D,
			X: number,
			Y: number,
			co: number,
			si: number,
			ax: number,
			ay: number,
			bx: number,
			by: number
		) => {
			p.moveTo(X + ax * co - ay * si, Y + ax * si + ay * co)
			p.lineTo(X + bx * co - by * si, Y + bx * si + by * co)
		}

		const bake = (p: Path2D, g: Glyph, X: number, Y: number) => {
			const s = g.size
			if (g.shape === RING) {
				p.moveTo(X + s * 0.92, Y)
				p.arc(X, Y, s * 0.92, 0, Math.PI * 2)
				return
			}
			if (g.shape === DOT) {
				p.moveTo(X + s * 0.62, Y)
				p.arc(X, Y, s * 0.62, 0, Math.PI * 2)
				return
			}
			// PLUS and RING sit upright; the rest carry their own angle, which is what makes a
			// lattice of 400 marks read as confetti rather than as a grid.
			const ang = g.shape === PLUS ? 0 : g.shape === CROSS ? g.rot + Math.PI / 4 : g.rot
			const co = Math.cos(ang)
			const si = Math.sin(ang)
			if (g.shape === PLUS || g.shape === CROSS) {
				seg(p, X, Y, co, si, -s, 0, s, 0)
				seg(p, X, Y, co, si, 0, -s, 0, s)
				return
			}
			if (g.shape === TRI) {
				p.moveTo(X + s * si, Y - s * co)
				p.lineTo(X + s * (0.88 * co - 0.62 * si), Y + s * (0.88 * si + 0.62 * co))
				p.lineTo(X - s * (0.88 * co + 0.62 * si), Y + s * (0.62 * co - 0.88 * si))
				p.closePath()
				return
			}
			const q = s * 0.78
			p.moveTo(X - q * co + q * si, Y - q * si - q * co)
			p.lineTo(X + q * co + q * si, Y + q * si - q * co)
			p.lineTo(X + q * co - q * si, Y + q * si + q * co)
			p.lineTo(X - q * co - q * si, Y - q * si + q * co)
			p.closePath()
		}

		const frame = () => {
			raf = 0
			t += 1
			// Read once per frame even when no pointer is live: gating this on pointer.live was
			// measured (_lh/v8j4-fps.mjs run 3 against run 2, 4x park 36.5ms vs 30.8ms of marginal
			// frame time) and bought nothing, because the read is served from clean layout while the
			// camera is parked. The position it gives is what the push is measured against.
			const rect = box.getBoundingClientRect()
			const px = pointer.live ? pointer.cx - rect.left : -9999
			const py = pointer.live ? pointer.cy - rect.top : -9999
			const inside = px >= -RADIUS && py >= -RADIUS && px <= w + RADIUS && py <= h + RADIUS

			for (const g of glyphs) {
				if (inside) {
					const dx = g.x - px
					const dy = g.y - py
					const d2 = dx * dx + dy * dy
					if (d2 < RADIUS * RADIUS) {
						const d = Math.max(1, Math.sqrt(d2))
						const f = (1 - d / RADIUS) ** 2
						g.vx += (dx / d) * f * PUSH
						g.vy += (dy / d) * f * PUSH
					}
				}
				// The spring is against the home coordinate, so the field always recomposes itself.
				g.vx = (g.vx + (g.hx - g.x) * SPRING) * DAMP
				g.vy = (g.vy + (g.hy - g.y) * SPRING) * DAMP
				g.x += g.vx
				g.y += g.vy
				g.rot += g.spin
			}

			// Four batches, drawn in the order the per-glyph version drew them: resting strokes,
			// resting dots, pushed strokes, pushed dots. The field is 400+ marks, and one stroke()
			// per mark was the frame — measured, not assumed: with this same loop painting into a
			// surface that is suppressed from the screen (opacity:0, its backing store still holding
			// 13.6k painted px) the page runs at exactly the visible loop's cadence, while the same
			// page with the loop stopped runs faster. Alpha is quantised to 1/ALPHA_STEPS, which is at
			// most 4/255 of the blend on a fully covered pixel; the pixels that move by more are the
			// anti-aliased perimeter — 2.8% of a mark's own ink — and no mark's centroid moves more
			// than 0.018px (v8j4-paintparity.mjs).
			const inkPaths = new Map<number, Path2D>()
			const inkFills = new Map<number, Path2D>()
			const accentPaths = new Map<number, Path2D>()
			const accentFills = new Map<number, Path2D>()
			for (const g of glyphs) {
				const X = g.x + Math.sin(t * 0.011 + g.phase) * BREATH
				const Y = g.y + Math.cos(t * 0.009 + g.phase) * BREATH
				const disp = Math.hypot(g.x - g.hx, g.y - g.hy)
				const warm = disp > HOT
				const a = warm
					? Math.min(0.92, 0.3 + (disp / RADIUS) * 1.9) * g.feather
					: (0.14 + (g.size / 12) * 0.16) * g.feather
				const q = Math.round(a * ALPHA_STEPS)
				if (q <= 0) continue
				// Dot is the one filled shape, so it needs its own batch per colour and alpha.
				const filled = g.shape === DOT
				let target: Map<number, Path2D>
				if (warm) target = filled ? accentFills : accentPaths
				else target = filled ? inkFills : inkPaths
				let path = target.get(q)
				if (!path) {
					path = new Path2D()
					target.set(q, path)
				}
				bake(path, g, X, Y)
			}

			ctx.clearRect(0, 0, w, h)
			ctx.lineWidth = 1.15
			ctx.lineCap = 'round'
			const lay = (strokes: Map<number, Path2D>, fills: Map<number, Path2D>, colour: string) => {
				ctx.strokeStyle = colour
				ctx.fillStyle = colour
				for (const [q, path] of strokes) {
					ctx.globalAlpha = q / ALPHA_STEPS
					ctx.stroke(path)
				}
				for (const [q, path] of fills) {
					ctx.globalAlpha = q / ALPHA_STEPS
					ctx.fill(path)
				}
			}
			lay(inkPaths, inkFills, ink)
			lay(accentPaths, accentFills, hot)
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
		const ro = new ResizeObserver(build)
		ro.observe(box)
		window.addEventListener('pointermove', onMove, { passive: true })
		window.addEventListener('blur', onOut)
		document.addEventListener('pointerleave', onOut)

		return () => {
			running = false
			if (raf) cancelAnimationFrame(raf)
			io.disconnect()
			ro.disconnect()
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('blur', onOut)
			document.removeEventListener('pointerleave', onOut)
			canvas.remove()
		}
	}, [reduced])

	return <div ref={host} data-v8j4="glyph-field" aria-hidden className={className} />
}
