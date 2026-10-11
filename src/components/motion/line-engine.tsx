'use client'
import { useEffect, useImperativeHandle, useRef } from 'react'
import {
	LINE_COUNT,
	SAMPLES,
	headAt,
	morphSamples,
	sampleShape,
	shapeForStep,
	tailAlpha,
	type ShapeId
} from '@/lib/motion/line-shapes'
import { prefersReducedMotion } from '@/lib/motion/use-reduced-motion'

// V6 Job 1: the reusable line engine behind the pinned pipeline carousel.
//
// Canvas 2D, three fat strokes whose colours are AgentOS design tokens read at
// runtime (never karma's peach/red-orange/violet). Shapes are normalized
// waypoint sets from lib/motion/line-shapes; a step change snapshots wherever
// each line currently is and interpolates toward the new shape with a
// per-sample stagger, so lines glide instead of teleporting — and an interrupted
// morph continues from the interrupted geometry. Each line carries a head that
// travels with scroll progress and a tail that lengthens with scroll velocity.
//
// The rAF loop is not permanent: it runs only while the stage is on screen AND
// something is still moving (morph in flight, velocity decaying, fresh input).
// An idle, off-screen or reduced-motion stage costs zero frames.

export type LineEngineHandle = {
	setProgress: (p: number) => void
	setStepIndex: (n: number) => void
}

type Props = {
	ref?: React.Ref<LineEngineHandle>
	className?: string
}

/** The three existing flow gradients: input → route → evidence. */
const TOKEN_PAIRS: readonly (readonly [string, string])[] = [
	['--flow-input-a', '--flow-input-b'],
	['--flow-route-a', '--flow-route-b'],
	['--flow-evidence-a', '--flow-evidence-b']
]

const LINE_OPACITY = [1, 0.86, 0.68]
const MORPH_MS = 900
const CHUNKS = 18
const MAX_DPR = 2

function readTokenPairs(): [string, string][] | null {
	const cs = getComputedStyle(document.documentElement)
	const out: [string, string][] = []
	for (const [a, b] of TOKEN_PAIRS) {
		const va = cs.getPropertyValue(a).trim()
		const vb = cs.getPropertyValue(b).trim()
		if (!va || !vb) return null
		out.push([va, vb])
	}
	return out
}

export function LineEngine({ ref, className }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const kickRef = useRef<() => void>(() => {})

	// Mutable engine state, deliberately outside React: a scroll update must
	// never cost a re-render of the pinned stage.
	const engine = useRef({
		progress: 0,
		step: 0,
		dstId: 'sweep' as ShapeId,
		morph: 1,
		velocity: 0,
		visible: false,
		dirty: true,
		lastInput: 0,
		lastFrame: 0,
		raf: 0,
		w: 0,
		h: 0,
		colors: null as [string, string][] | null,
		cur: [] as Float32Array[],
		src: [] as Float32Array[],
		px: [] as Float32Array[]
	})

	useImperativeHandle(
		ref,
		(): LineEngineHandle => ({
			setProgress(p: number) {
				const s = engine.current
				const next = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0
				const now = performance.now()
				const dt = Math.max(8, now - (s.lastInput || now))
				// Wheel deltas arrive in bursts; a 900px/s sweep reads as "fast".
				const speed = Math.min(1, (Math.abs(next - s.progress) / dt) * 900)
				s.velocity = Math.max(speed, s.velocity * 0.82)
				s.progress = next
				s.lastInput = now
				s.dirty = true
				kickRef.current()
			},
			setStepIndex(n: number) {
				const s = engine.current
				const step = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
				s.step = step
				const target = shapeForStep(step)
				if (target === s.dstId) return
				for (let line = 0; line < LINE_COUNT; line++) {
					const cur = s.cur[line]
					const src = s.src[line]
					if (cur && src) src.set(cur)
				}
				s.dstId = target
				s.morph = 0
				s.dirty = true
				kickRef.current()
			}
		}),
		[]
	)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext('2d', { alpha: true })
		if (!ctx) return

		const s = engine.current
		const reduced = prefersReducedMotion()

		s.dstId = shapeForStep(s.step)
		for (let line = 0; line < LINE_COUNT; line++) {
			const cur = Float32Array.from(sampleShape(s.dstId, line))
			s.cur[line] = cur
			s.src[line] = Float32Array.from(cur)
			s.px[line] = new Float32Array(SAMPLES * 2)
		}
		s.colors = readTokenPairs()

		const resize = () => {
			const rect = canvas.getBoundingClientRect()
			const w = Math.max(1, Math.round(rect.width))
			const h = Math.max(1, Math.round(rect.height))
			const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
			if (w === s.w && h === s.h && canvas.width === Math.round(w * dpr)) return
			s.w = w
			s.h = h
			canvas.width = Math.round(w * dpr)
			canvas.height = Math.round(h * dpr)
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			s.dirty = true
		}

		const strokeLine = (line: number, alphaAt: (u: number) => number) => {
			const pair = s.colors?.[line]
			const cur = s.cur[line]
			const pts = s.px[line]
			if (!pair || !cur || !pts) return
			for (let i = 0; i < SAMPLES; i++) {
				pts[i * 2] = (cur[i * 2] ?? 0) * s.w
				pts[i * 2 + 1] = (cur[i * 2 + 1] ?? 0) * s.h
			}
			const end = (SAMPLES - 1) * 2
			const grad = ctx.createLinearGradient(
				pts[0] ?? 0,
				pts[1] ?? 0,
				pts[end] ?? 0,
				pts[end + 1] ?? 0
			)
			grad.addColorStop(0, pair[0])
			grad.addColorStop(1, pair[1])
			ctx.strokeStyle = grad
			ctx.lineWidth = Math.min(14, Math.max(6, s.w * 0.012))
			ctx.lineCap = 'round'
			ctx.lineJoin = 'round'

			// Chunked so the fading tail is a handful of strokes, not one per sample.
			const per = (SAMPLES - 1) / CHUNKS
			for (let c = 0; c < CHUNKS; c++) {
				const from = Math.round(c * per)
				const to = Math.min(SAMPLES - 1, Math.round((c + 1) * per))
				if (to <= from) continue
				const a = alphaAt((from + to) / 2 / (SAMPLES - 1)) * (LINE_OPACITY[line] ?? 1)
				if (a <= 0.02) continue
				ctx.globalAlpha = a
				ctx.beginPath()
				ctx.moveTo(pts[from * 2] ?? 0, pts[from * 2 + 1] ?? 0)
				for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i * 2] ?? 0, pts[i * 2 + 1] ?? 0)
				ctx.stroke()
			}
			ctx.globalAlpha = 1
		}

		const draw = () => {
			ctx.clearRect(0, 0, s.w, s.h)
			if (!s.colors || !s.w) return
			if (reduced) {
				// §4: reduced motion paints the step's terminal shape — no tail, no loop.
				for (let line = 0; line < LINE_COUNT; line++) {
					s.cur[line]?.set(sampleShape(s.dstId, line))
					strokeLine(line, () => 1)
				}
				return
			}
			for (let line = 0; line < LINE_COUNT; line++) {
				const cur = s.cur[line]
				const src = s.src[line]
				if (cur && src) morphSamples(cur, src, sampleShape(s.dstId, line), s.morph)
				const head = headAt(s.progress, line)
				strokeLine(line, (u) => tailAlpha(u, head, s.velocity))
			}
		}

		const frame = (now: number) => {
			s.raf = 0
			if (!s.visible || reduced) return
			const dt = Math.min(64, Math.max(1, now - (s.lastFrame || now)))
			s.lastFrame = now
			s.dirty = false
			if (s.morph < 1) s.morph = Math.min(1, s.morph + dt / MORPH_MS)
			s.velocity *= Math.pow(0.94, dt / 16.7)
			draw()
			if (s.dirty || s.morph < 1 || s.velocity >= 0.01) {
				s.raf = requestAnimationFrame(frame)
			}
		}

		const kick = () => {
			// Reduced motion has no loop, so an input repaints the static shape
			// synchronously instead of being dropped on the floor.
			if (reduced) {
				s.dirty = false
				if (s.visible) draw()
				return
			}
			if (s.raf || !s.visible) return
			s.raf = requestAnimationFrame(frame)
		}
		kickRef.current = kick

		resize()
		draw()

		const ro = new ResizeObserver(() => {
			resize()
			if (reduced) draw()
			else kick()
		})
		ro.observe(canvas)

		const io = new IntersectionObserver(
			(entries) => {
				s.visible = entries.some((e) => e.isIntersecting)
				if (s.visible) {
					s.dirty = true
					if (reduced) draw()
					else kick()
				} else if (s.raf) {
					cancelAnimationFrame(s.raf)
					s.raf = 0
				}
			},
			{ rootMargin: '120px' }
		)
		io.observe(canvas)

		const onVisibility = () => {
			if (document.hidden) {
				if (s.raf) cancelAnimationFrame(s.raf)
				s.raf = 0
			} else {
				s.dirty = true
				kick()
			}
		}
		document.addEventListener('visibilitychange', onVisibility)

		return () => {
			kickRef.current = () => {}
			document.removeEventListener('visibilitychange', onVisibility)
			ro.disconnect()
			io.disconnect()
			if (s.raf) cancelAnimationFrame(s.raf)
			s.raf = 0
		}
	}, [])

	return (
		<canvas
			ref={canvasRef}
			aria-hidden="true"
			className={`pointer-events-none absolute inset-0 size-full ${className ?? ''}`}
		/>
	)
}
