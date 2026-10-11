// Canvas particle engine (Take 4). V4 §6.4 is a hard rule — particle systems use
// <canvas>, never DOM elements — which also wins on cost: the hero's letter
// trails alone would otherwise add ~17 animated nodes to the page.
//
// The loop is *demand-driven*: it starts on the first spawn and stops itself when
// the last particle dies, so an idle page holds no rAF. That is deliberate — the
// Take 3 leak audit counts rAF callbacks across route changes.

export type ParticleSpawn = {
	// 'fly' interpolates start → target with an ease-out curve (text
	// crystallising). 'spray' integrates velocity with drag (letter trails).
	mode?: 'fly' | 'spray'
	x?: number
	y?: number
	vx?: number
	vy?: number
	drag?: number
	size?: number
	life?: number
	delay?: number
	travel?: number
	color?: number
	targetX?: number
	targetY?: number
	settle?: number
}

export type ParticleField = {
	spawn: (x: number, y: number, opts?: ParticleSpawn) => void
	live: () => number
	resize: () => void
	destroy: () => void
}

type P = {
	x0: number
	y0: number
	x: number
	y: number
	tx: number
	ty: number
	vx: number
	vy: number
	drag: number
	size: number
	age: number
	life: number
	travel: number
	settle: number
	fill: string
	mode: 'fly' | 'spray'
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

// --accent, the token the hero palette is built from. Used when a caller passes
// an out-of-range colour index.
const FALLBACK_COLOR = '#5b7cfa'

export function createParticleField(
	canvas: HTMLCanvasElement,
	colors: string[],
	max = 1800
): ParticleField {
	const ctx = canvas.getContext('2d')
	if (!ctx) return { spawn: () => {}, live: () => 0, resize: () => {}, destroy: () => {} }

	const pool: P[] = []
	let raf = 0
	let last = 0
	let w = 0
	let h = 0
	let dpr = 1

	const resize = () => {
		dpr = Math.min(2, window.devicePixelRatio || 1)
		const rect = canvas.getBoundingClientRect()
		w = Math.max(1, Math.round(rect.width))
		h = Math.max(1, Math.round(rect.height))
		canvas.width = Math.round(w * dpr)
		canvas.height = Math.round(h * dpr)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
	}
	resize()

	const step = (now: number) => {
		const dt = Math.min(50, now - last) / 1000
		last = now
		ctx.clearRect(0, 0, w, h)
		ctx.globalCompositeOperation = 'lighter'

		let dead = false
		for (const p of pool) {
			p.age += dt
			if (p.age >= p.life) {
				dead = true
				continue
			}
			// Negative age is a scheduled start: staggered particles wait in the pool
			// without a setTimeout each, which is how 2000 letters land in a wave.
			if (p.age < 0) continue

			if (p.mode === 'fly') {
				// `travel` decouples the flight time from the lifetime: a particle can
				// reach its glyph pixel, HOLD there while the crisp text crossfades in,
				// and only then retire. Without the hold the word dissolves mid-reveal.
				const e = easeOutCubic(Math.min(1, p.age / p.travel))
				p.x = p.x0 + (p.tx - p.x0) * e
				p.y = p.y0 + (p.ty - p.y0) * e
				// Shrink as it lands: the "focus" beat the brief asks for.
				const size = p.size * (1 - (1 - p.settle) * e)
				ctx.globalAlpha = 0.9
				ctx.fillStyle = p.fill
				ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size)
			} else {
				p.vx *= 1 - p.drag * dt
				p.vy *= 1 - p.drag * dt
				p.x += p.vx * dt
				p.y += p.vy * dt
				ctx.globalAlpha = 1 - p.age / p.life
				ctx.fillStyle = p.fill
				ctx.fillRect(p.x, p.y, p.size, p.size)
			}
		}

		// Retire in place, forward-compacted so `pool.length` IS the live count: a
		// finished burst cannot leave dead objects to iterate (or leak) across the
		// page's many bursts. The pass only runs on frames where something died.
		if (dead) {
			let keep = 0
			for (const p of pool) {
				if (p.age < p.life) {
					pool[keep] = p
					keep++
				}
			}
			pool.length = keep
		}

		ctx.globalAlpha = 1
		if (pool.length > 0) raf = requestAnimationFrame(step)
		else raf = 0
	}

	const spawn = (x: number, y: number, opts: ParticleSpawn = {}) => {
		if (pool.length >= max) return
		const mode = opts.mode ?? 'spray'
		const x0 = opts.x ?? x
		const y0 = opts.y ?? y
		const ci = opts.color ?? (Math.random() * colors.length) | 0
		const fill = colors[ci] ?? FALLBACK_COLOR
		pool.push({
			x0,
			y0,
			x: x0,
			y: y0,
			tx: opts.targetX ?? x,
			ty: opts.targetY ?? y,
			vx: opts.vx ?? 0,
			vy: opts.vy ?? 0,
			drag: opts.drag ?? 3,
			size: opts.size ?? 3,
			age: -(opts.delay ?? 0),
			life: opts.life ?? 0.3,
			travel: opts.travel ?? opts.life ?? 0.3,
			settle: opts.settle ?? 0.5,
			fill,
			mode
		})
		if (!raf) {
			last = performance.now()
			raf = requestAnimationFrame(step)
		}
	}

	const onResize = () => resize()
	window.addEventListener('resize', onResize, { passive: true })

	return {
		spawn,
		live: () => pool.length,
		resize,
		destroy: () => {
			window.removeEventListener('resize', onResize)
			if (raf) cancelAnimationFrame(raf)
			raf = 0
			pool.length = 0
			ctx.clearRect(0, 0, w, h)
		}
	}
}
