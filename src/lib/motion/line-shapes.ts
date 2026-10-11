// Karma-observed line choreography, reduced to pure geometry (V6 §4).
//
// Every shape is a parametric curve sampled into a fixed-length Float32Array of
// NORMALIZED coordinates (0..1 of the stage box, y down). Fixed sample count is
// what makes morphing possible: two shapes interpolate 1:1 with no resampling,
// so a line glides instead of teleporting. Nothing here touches the DOM, which
// is why the morph can be unit-verified in node.

export const LINE_COUNT = 3
export const SAMPLES = 60

export type ShapeId = 'sweep' | 'arcs' | 'orbit' | 'cables'

/** §2.3 carousel order. Step N reuses these cyclically when N > 4 (§5). */
export const SHAPE_IDS: readonly ShapeId[] = ['sweep', 'arcs', 'orbit', 'cables']
const FIRST_SHAPE: ShapeId = 'sweep'

const TAU = Math.PI * 2
const smooth = (u: number) => u * u * (3 - 2 * u)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Step index → shape, cyclically. Negative/NaN steps collapse to the first. */
export function shapeForStep(step: number): ShapeId {
	if (!Number.isFinite(step) || step <= 0) return FIRST_SHAPE
	return SHAPE_IDS[Math.floor(step) % SHAPE_IDS.length] ?? FIRST_SHAPE
}

type Curve = (t: number, line: number) => [number, number]

// §2.3 family 1 — "requests arrive": long horizontal runs entering from the
// right and echoing leftward, each line offset so the heads do not align.
const sweep: Curve = (t, line) => {
	const x = 1.22 + line * 0.055 - (1.5 + line * 0.03) * t
	const bow = Math.sin(Math.PI * t) * (0.045 + line * 0.022)
	const y = 0.28 + line * 0.2 + (line === 1 ? -bow : bow)
	return [x, y]
}

// §2.3 family 2 — "traffic flows through the pipeline": three full-width
// stacked arcs, line 0 apexing highest, a suspension bridge under the text.
const arcs: Curve = (t, line) => {
	const x = -0.09 + 1.18 * t
	const base = 0.8 + line * 0.085
	const amp = 0.42 - line * 0.062
	return [x, base - amp * Math.sin(Math.PI * t)]
}

// §2.3 family 3 — "the pipeline circles your request": concentric C-arcs
// curling around the step headline, each opening rotated off the last.
const orbit: Curve = (t, line) => {
	const rx = 0.3 + line * 0.058
	const ry = 0.225 + line * 0.048
	const a0 = -0.62 * Math.PI + line * 0.34 * Math.PI
	const span = 1.62 * Math.PI - line * 0.11 * Math.PI
	const a = a0 + span * t
	return [0.5 + rx * Math.cos(a), 0.5 + ry * Math.sin(a)]
}

// §2.3 family 4 — "results stream out": a vertical C-hook stacked on the left,
// handing off to a parallel diagonal cable that exits through the bottom edge.
function cableArc(t: number, line: number): [number, number] {
	const rx = 0.075 + line * 0.012
	const ry = 0.165 + line * 0.024
	const a = -0.55 * Math.PI + 1.1 * Math.PI * t
	return [0.135 + line * 0.038 + rx * Math.cos(a), 0.4 + line * 0.062 + ry * Math.sin(a)]
}

const cables: Curve = (t, line) => {
	const [ex, ey] = cableArc(1, line)
	const hook = clamp01(t / 0.42)
	const run = clamp01((t - 0.42) / 0.58)
	const w = smooth(clamp01((t - 0.36) / 0.12))
	const ax = ex + (1.16 + line * 0.05 - ex) * smooth(run)
	const ay = ey + (1.34 - ey) * smooth(run)
	const [hx, hy] = cableArc(hook, line)
	return [hx + (ax - hx) * w, hy + (ay - hy) * w]
}

const CURVES: Record<ShapeId, Curve> = { sweep, arcs, orbit, cables }

const cache = new Map<string, Float32Array>()

/**
 * Sample a shape into normalized [x,y] pairs. Cached: the curves are pure, so
 * repeated calls (every morph, every frame) allocate nothing.
 */
export function sampleShape(id: ShapeId, line: number): Float32Array {
	const key = `${id}:${line}`
	const hit = cache.get(key)
	if (hit) return hit
	const out = new Float32Array(SAMPLES * 2)
	const curve = CURVES[id]
	for (let i = 0; i < SAMPLES; i++) {
		const [x, y] = curve(i / (SAMPLES - 1), line)
		out[i * 2] = x
		out[i * 2 + 1] = y
	}
	cache.set(key, out)
	return out
}

// Symmetric expo, matching the --ease-expo signature curve: samples accelerate
// out of the old shape and settle into the new one, instead of snapping 85% of
// the way there in the first third of the timeline.
const easeExpoInOut = (u: number) => {
	if (u <= 0) return 0
	if (u >= 1) return 1
	return u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, 10 - 20 * u)) / 2
}

/**
 * Write `from → to` into `out` at morph time `t`, with a per-sample stagger so
 * points do not all arrive at once (§4: "organic feel"). `stagger` is the share
 * of the timeline spent offsetting samples; 0 means uniform interpolation.
 */
export function morphSamples(
	out: Float32Array,
	from: Float32Array,
	to: Float32Array,
	t: number,
	stagger = 0.55
): void {
	const span = Math.max(1e-6, 1 - stagger)
	const tc = clamp01(t)
	for (let i = 0; i < SAMPLES; i++) {
		const k = i * 2
		const delay = stagger * (i / (SAMPLES - 1))
		const e = easeExpoInOut(clamp01((tc - delay) / span))
		const fx = from[k] ?? 0
		const fy = from[k + 1] ?? 0
		out[k] = fx + ((to[k] ?? 0) - fx) * e
		out[k + 1] = fy + ((to[k + 1] ?? 0) - fy) * e
	}
}

/**
 * Head position along the path for one line: the lines glide with scroll
 * progress (§2.2) and each line is phased so the three heads never stack.
 */
export function headAt(progress: number, line: number, travel = 2): number {
	const phase = line / LINE_COUNT
	const u = progress * travel + phase
	return u - Math.floor(u)
}

/**
 * Per-sample alpha for the fading tail: 1 at the head, ramping to `floor` one
 * tail-length behind it. `velocity` (0..1) lengthens and deepens the tail, so a
 * fast scroll reads as motion blur along the cable (§4).
 */
export function tailAlpha(
	u: number,
	head: number,
	velocity: number,
	floor = 0.05,
	minLen = 0.18,
	gain = 0.62
): number {
	const len = Math.min(0.95, minLen + clamp01(velocity) * gain)
	const behind = head - u
	const d = behind - Math.floor(behind)
	if (d >= len) return 0
	const a = 1 - smooth(d / len)
	return floor + (1 - floor) * a
}

export const __test = { TAU, smooth, clamp01, cableArc, CURVES }
