'use client'
import gsap from 'gsap'
import { useRef, useState } from 'react'
import { SplitChars, type SplitUnit } from '@/components/motion/split-chars'
import { createParticleField } from '@/lib/motion/particle-field'
import { glyphsOf, heroPalette } from '@/lib/motion/hero-shared'
import { useIntroReady } from '@/lib/motion/intro-gate'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// The hero entrance (V4 §3.1A, the owner's own words: "alphabets joining from
// every corner"). Every glyph starts outside the viewport at one of the four
// corners, flies a curved (quadratic bezier) path into its slot while spinning
// and shrinking, drags a canvas particle trail, then lands with an overshoot
// kick and a radial shockwave.
//
// It is the survivor of the M2 bake-off, where all three candidates were built
// as separate components and measured on one production build (?heroOpt=A|B|C);
// the numbers are in _lh/harnesses4/. It won on every measured axis — shortest
// entrance (1900 ms vs 2717/3617), highest frame rate (12.6 vs 7.4/10.8 avg
// under 4x CPU throttle), best LCP (1000 ms vs 1812/1240), least jank (893 ms
// worst long frame vs 1627/1109), and no layer left mounted behind it — and it
// is the only candidate whose motion reads as a journey: at 570 ms into the
// entrance all 17 glyphs were on screen and displaced by a mean of 351 px.
//
// Why manual bezier math instead of MotionPathPlugin: the loop needs each
// glyph's live position to spawn its trail, and reading it back through
// getBoundingClientRect() mid-tween means 17 forced layouts per frame (V4 §6.10).
// Computing the position analytically costs nothing and is exactly what §7.4
// prescribes — implement the math rather than depend on a library's semantics.
//
// Budgets (all asserted by the M2 harness, not assumed): 17 glyphs against the
// brief's 30 ceiling, one trail particle per glyph every 4th frame at life 0.32 s
// ≈ 5 live per glyph, and the trail canvas unmounts when the entrance is over so
// no rAF, listener or fixed full-viewport layer survives it.
const MAX_GLYPHS = 30
const TRAIL_EVERY = 4
const TRAIL_LIFE = 0.32

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

type Flight = {
	el: HTMLElement
	cx: number
	cy: number
	x0: number
	y0: number
	bx: number
	by: number
	spin: number
	scale0: number
	delay: number
	dur: number
	landed: boolean
}

export type HeroDisplayProps = {
	/** The full sentence, carried by the sr-only twin so the accessible name is
	 *  the headline and not 17 individual letters. */
	text: string
	/** Author-controlled line breaks (the headline is two masked lines today). */
	lines: string[]
	className?: string
	lineClassName?: string
}

export function HeroDisplay({ text, lines, className, lineClassName }: HeroDisplayProps) {
	const reduced = useReducedMotion()
	const ready = useIntroReady()
	const [over, setOver] = useState(false)
	const canvasRef = useRef<HTMLCanvasElement>(null)

	const onSplit = (units: SplitUnit[]) => {
		const chars = glyphsOf(units.flatMap((unit) => unit.chars)).slice(0, MAX_GLYPHS)
		const canvas = canvasRef.current
		const field = canvas ? createParticleField(canvas, heroPalette(), 400) : null

		const vw = window.innerWidth
		const vh = window.innerHeight

		const shots: Flight[] = chars.map((el, i) => {
			const r = el.getBoundingClientRect()
			// Round-robin the four corners so no two neighbouring glyphs arrive alike.
			// The offsets are deliberately just-outside-the-viewport rather than a
			// full screen away: measured, a 1020 px start left the first ~600 ms of
			// the entrance showing an empty hero, because the glyphs were still
			// off-screen and under the opacity ramp. 810 px puts the on-screen
			// flight inside 400 ms.
			const corner = i % 4
			const x0 = corner === 0 || corner === 3 ? -vw * 0.5 : vw * 0.5
			const y0 = corner < 2 ? -vh * 0.62 : vh * 0.62
			const bowX = gsap.utils.random(-200, 200)
			const bowY = gsap.utils.random(-200, 200)
			el.style.willChange = 'transform, opacity, filter'
			return {
				el,
				cx: r.left + r.width / 2,
				cy: r.top + r.height / 2,
				x0,
				y0,
				// Control point pulls the straight line into a curve; ±200 px per brief.
				bx: x0 * 0.38 + bowX,
				by: y0 * 0.38 + bowY,
				spin: gsap.utils.random(-720, 720),
				scale0: gsap.utils.random(0.1, 0.5),
				delay: i * 0.02 + gsap.utils.random(0, 0.05),
				dur: gsap.utils.random(0.95, 1.35),
				landed: false
			}
		})

		const shock = (x: number, y: number) => {
			if (!field) return
			for (let k = 0; k < 10; k++) {
				const a = (k / 10) * Math.PI * 2
				field.spawn(x, y, {
					vx: Math.cos(a) * 190,
					vy: Math.sin(a) * 190,
					size: 2,
					life: 0.3
				})
			}
		}

		const kicks: gsap.core.Tween[] = []
		const start = performance.now()
		let frame = 0
		let finished = false

		const tick = () => {
			// `frame = frame + 1`, not `frame++`: babel-plugin-react-compiler refuses
			// UpdateExpressions on a variable captured by a lambda, and the flight loop
			// is exactly that.
			frame = frame + 1
			const t = (performance.now() - start) / 1000
			let flying = 0

			for (const g of shots) {
				const p = (t - g.delay) / g.dur
				if (p >= 1) {
					if (!g.landed) {
						// Hand the glyph over: set the exact layout position, clear the
						// flight blur, and let GSAP own the landing kick only.
						g.landed = true
						g.el.style.transform = 'none'
						g.el.style.opacity = '1'
						g.el.style.filter = 'none'
						// §6.3: will-change is a promotion request, so it is dropped the
						// moment the layer stops moving — 17 promoted layers left alive
						// for the rest of the session is worse than no hint at all.
						g.el.style.willChange = 'auto'
						const r = g.el.getBoundingClientRect()
						shock(r.left + r.width / 2, r.top + r.height / 2)
						kicks.push(
							gsap.fromTo(
								g.el,
								{ scale: 1 },
								{ scale: 1.14, duration: 0.11, yoyo: true, repeat: 1, clearProps: 'transform' }
							)
						)
					}
					continue
				}
				flying++
				const e = easeOutCubic(Math.max(0, p))
				const k = 1 - e
				// Quadratic bezier with the origin slot as the end point.
				const x = k * k * g.x0 + 2 * k * e * g.bx
				const y = k * k * g.y0 + 2 * k * e * g.by
				const scale = g.scale0 + (1 - g.scale0) * e
				g.el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${g.spin * k}deg) scale(${scale})`
				g.el.style.opacity = `${Math.min(1, Math.max(0, p) * 2.4)}`
				// Motion blur tracks speed, not time: fastest at launch, zero on arrival.
				g.el.style.filter = `blur(${(4.5 * k * k).toFixed(2)}px)`
				if (field && p > 0 && frame % TRAIL_EVERY === 0) {
					// The canvas is `fixed inset-0`, so viewport px == canvas px: the
					// glyph's live position is its captured slot plus the analytic
					// offset. No layout read, which is why the trail costs nothing.
					field.spawn(g.cx + x, g.cy + y, {
						vx: gsap.utils.random(-30, 30),
						vy: gsap.utils.random(-20, 40),
						size: 3,
						life: TRAIL_LIFE
					})
				}
			}

			if (flying === 0 && !finished) {
				finished = true
				gsap.ticker.remove(tick)
				gsap.delayedCall(TRAIL_LIFE + 0.1, () => {
					field?.destroy()
					setOver(true)
				})
			}
		}

		tick()
		gsap.ticker.add(tick)

		return () => {
			gsap.ticker.remove(tick)
			for (const kick of kicks) kick.kill()
			gsap.set(chars, { clearProps: 'all' })
			field?.destroy()
		}
	}

	return (
		<>
			{/* Reduced motion never runs the flight, so `over` never flips — without this
			    guard an empty full-viewport canvas stays mounted for the whole session. */}
			{!reduced && ready && !over && (
				<canvas
					ref={canvasRef}
					aria-hidden="true"
					data-t4-field="trails"
					className="pointer-events-none fixed inset-0 z-[8] h-full w-full"
				/>
			)}
			<SplitChars
				text={text}
				lines={lines}
				as="h1"
				ready={ready}
				className={className}
				lineClassName={lineClassName}
				onSplit={onSplit}
			/>
		</>
	)
}
