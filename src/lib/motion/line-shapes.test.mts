import test from 'node:test'
import assert from 'node:assert/strict'
import {
	LINE_COUNT,
	SAMPLES,
	SHAPE_IDS,
	headAt,
	morphSamples,
	sampleShape,
	shapeForStep,
	tailAlpha
} from './line-shapes.ts'

const at = (buf: Float32Array, i: number) => [buf[i * 2], buf[i * 2 + 1]] as const
const finite = (buf: Float32Array) => buf.every((v) => Number.isFinite(v))
const maxDeviation = (a: Float32Array, b: Float32Array) => {
	let m = 0
	for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
	return m
}

test('every shape samples a fixed count of finite normalized points per line', () => {
	for (const id of SHAPE_IDS) {
		for (let line = 0; line < LINE_COUNT; line++) {
			const s = sampleShape(id, line)
			assert.equal(s.length, SAMPLES * 2, `${id}/${line} sample count`)
			assert.ok(finite(s), `${id}/${line} has non-finite coords`)
			for (let i = 0; i < SAMPLES; i++) {
				const [x, y] = at(s, i)
				assert.ok(x > -0.5 && x < 1.6, `${id}/${line} x out of bleed range: ${x}`)
				assert.ok(y > -0.5 && y < 1.6, `${id}/${line} y out of bleed range: ${y}`)
			}
		}
	}
})

test('sampling is pure: the same shape+line returns identical geometry', () => {
	for (const id of SHAPE_IDS) {
		assert.equal(maxDeviation(sampleShape(id, 0), sampleShape(id, 0)), 0, `${id} not pure`)
	}
})

test('the four shape families are geometrically distinct', () => {
	for (let a = 0; a < SHAPE_IDS.length; a++) {
		for (let b = a + 1; b < SHAPE_IDS.length; b++) {
			const d = maxDeviation(sampleShape(SHAPE_IDS[a], 0), sampleShape(SHAPE_IDS[b], 0))
			assert.ok(d > 0.15, `${SHAPE_IDS[a]} vs ${SHAPE_IDS[b]} only ${d.toFixed(3)} apart`)
		}
	}
})

test('steps map onto the shape families cyclically (§5, N steps ≠ 4)', () => {
	assert.deepEqual([0, 1, 2, 3].map(shapeForStep), ['sweep', 'arcs', 'orbit', 'cables'])
	assert.equal(shapeForStep(4), 'sweep', 'step 4 must reuse family 1')
	assert.equal(shapeForStep(9), 'arcs', 'step 9 must reuse family 2')
	assert.equal(shapeForStep(-3), 'sweep', 'negative step must not index backwards')
	assert.equal(shapeForStep(Number.NaN), 'sweep', 'NaN step must not throw')
	// Negative control: the cyclic map is not constant.
	assert.equal(new Set([0, 1, 2, 3, 4, 5].map(shapeForStep)).size, 4)
})

test('morph endpoints are exact and mid-morph geometry is genuinely in between', () => {
	const from = sampleShape('sweep', 0)
	const to = sampleShape('arcs', 0)
	const out = new Float32Array(SAMPLES * 2)

	morphSamples(out, from, to, 0)
	assert.equal(maxDeviation(out, from), 0, 't=0 must equal the source shape exactly')

	morphSamples(out, from, to, 1)
	assert.equal(maxDeviation(out, to), 0, 't=1 must equal the target shape exactly')

	morphSamples(out, from, to, 0.5)
	const devFrom = maxDeviation(out, from)
	const devTo = maxDeviation(out, to)
	assert.ok(devFrom > 0.05, `t=0.5 did not move away from source (${devFrom})`)
	assert.ok(devTo > 0.05, `t=0.5 did not approach target (${devTo})`)

	// Out-of-range morph times clamp instead of extrapolating past the target.
	morphSamples(out, from, to, 4)
	assert.equal(maxDeviation(out, to), 0, 't>1 must clamp to the target')
	morphSamples(out, from, to, -2)
	assert.equal(maxDeviation(out, from), 0, 't<0 must clamp to the source')
})

test('the morph is staggered: leading samples arrive before trailing ones', () => {
	const from = sampleShape('orbit', 1)
	const to = sampleShape('cables', 1)
	const out = new Float32Array(SAMPLES * 2)
	morphSamples(out, from, to, 0.5)

	const arrival = (i: number) => {
		const [fx, fy] = at(from, i)
		const [tx, ty] = at(to, i)
		const [ox, oy] = at(out, i)
		const total = Math.hypot(tx - fx, ty - fy) || 1
		return Math.hypot(ox - fx, oy - fy) / total
	}
	const head = arrival(0)
	const mid = arrival(Math.floor(SAMPLES / 2))
	const tail = arrival(SAMPLES - 1)
	assert.ok(head > tail + 0.15, `no stagger: head ${head.toFixed(3)} vs tail ${tail.toFixed(3)}`)
	assert.ok(mid > 0.02 && mid < 0.98, `mid-morph snapped instead of interpolating (${mid})`)
	assert.ok(tail >= 0 && tail < mid, `arrival must decay along the path (${tail} vs ${mid})`)

	// Negative control proving the stagger assertion above can fail: with
	// stagger=0 interpolation is uniform, so every sample is at the midpoint.
	morphSamples(out, from, to, 0.5, 0)
	assert.ok(Math.abs(arrival(0) - 0.5) < 1e-6, 'stagger=0 must interpolate uniformly')
	assert.ok(Math.abs(arrival(SAMPLES - 1) - 0.5) < 1e-6, 'stagger=0 must interpolate uniformly')
})

test('family 1: horizontal runs entering from the right', () => {
	for (let line = 0; line < LINE_COUNT; line++) {
		const s = sampleShape('sweep', line)
		const [x0, y0] = at(s, 0)
		const [x1, y1] = at(s, SAMPLES - 1)
		assert.ok(x0 > 1, `line ${line} must start off the right edge, got ${x0}`)
		assert.ok(x1 < 0, `line ${line} must end off the left edge, got ${x1}`)
		assert.ok(Math.abs(y1 - y0) < 0.2, `line ${line} is not a horizontal run`)
	}
})

test('family 2: three stacked full-width arcs, line 0 apexing highest', () => {
	const apexes: number[] = []
	for (let line = 0; line < LINE_COUNT; line++) {
		const s = sampleShape('arcs', line)
		const [x0] = at(s, 0)
		const [x1] = at(s, SAMPLES - 1)
		assert.ok(x0 < 0 && x1 > 1, `line ${line} must span edge to edge`)
		let minY = Infinity
		for (let i = 0; i < SAMPLES; i++) minY = Math.min(minY, at(s, i)[1])
		apexes.push(minY)
	}
	assert.ok(
		apexes[0] < apexes[1] && apexes[1] < apexes[2],
		`arcs must stack top→bottom, got ${apexes.map((a) => a.toFixed(3)).join(', ')}`
	)
})

test('family 3: concentric C-arcs, each line a different radius and not closed', () => {
	const radii: number[] = []
	for (let line = 0; line < LINE_COUNT; line++) {
		const s = sampleShape('orbit', line)
		const [sx, sy] = at(s, 0)
		const [ex, ey] = at(s, SAMPLES - 1)
		let maxR = 0
		for (let i = 0; i < SAMPLES; i++) {
			const [x, y] = at(s, i)
			maxR = Math.max(maxR, Math.hypot(x - 0.5, y - 0.5))
		}
		radii.push(maxR)
		const gap = Math.hypot(ex - sx, ey - sy)
		assert.ok(gap > 0.05, `line ${line} closes into a full ring (gap ${gap})`)
	}
	assert.ok(
		radii[0] < radii[1] && radii[1] < radii[2],
		`arcs must be concentric outward, got ${radii.map((r) => r.toFixed(3)).join(', ')}`
	)
})

test('family 4: left-side hook then a diagonal cable exiting the bottom edge', () => {
	for (let line = 0; line < LINE_COUNT; line++) {
		const s = sampleShape('cables', line)
		const hookXs: number[] = []
		for (let i = 0; i < Math.floor(SAMPLES * 0.3); i++) hookXs.push(at(s, i)[0])
		assert.ok(
			Math.max(...hookXs) < 0.35,
			`line ${line} hook is not on the left (max x ${Math.max(...hookXs).toFixed(3)})`
		)
		const [ex, ey] = at(s, SAMPLES - 1)
		assert.ok(ey > 1, `line ${line} must exit through the bottom edge, got y ${ey}`)
		assert.ok(ex > 0.8, `line ${line} must run rightward, got x ${ex}`)
	}
})

test('head position glides with progress and phases the three lines apart', () => {
	assert.ok(Math.abs(headAt(0, 0)) < 1e-9, 'head must start at 0')
	assert.ok(headAt(0.25, 0) > headAt(0, 0), 'head must advance with progress')
	assert.ok(headAt(1.5, 0) >= 0 && headAt(1.5, 0) < 1, 'head must stay normalized')
	const heads = [0, 1, 2].map((l) => headAt(0.4, l))
	assert.equal(new Set(heads.map((h) => h.toFixed(6))).size, 3, 'heads must not stack')
	// Negative control: progress really does move the head.
	assert.ok(Math.abs(headAt(0.6, 0) - headAt(0.4, 0)) > 0.1, 'head ignores progress')
})

test('tail alpha is 1 at the head and decays behind it, longer when scrolling fast', () => {
	const head = 0.5
	assert.ok(Math.abs(tailAlpha(head, head, 0) - 1) < 1e-9, 'head must be full opacity')
	const justBehind = tailAlpha(head - 0.03, head, 0)
	const farBehind = tailAlpha(head - 0.5, head, 0)
	assert.ok(justBehind < 1 && justBehind > farBehind, 'alpha must ramp down behind the head')
	assert.equal(farBehind, 0, 'beyond the tail nothing should be painted')

	const still = tailAlpha(head - 0.12, head, 0)
	const fast = tailAlpha(head - 0.12, head, 1)
	assert.ok(fast > still, `faster scroll must keep more of the tail lit (${fast} vs ${still})`)

	// Ahead of the head the line is not yet drawn.
	assert.equal(tailAlpha(head + 0.5, head, 0), 0, 'ahead of the head must be invisible')
})

test('the shape cache hands back the same buffer and a morph never writes through it', () => {
	const cached = sampleShape('sweep', 2)
	assert.equal(sampleShape('sweep', 2), cached, 'sampleShape must cache, not re-allocate')
	const snapshot = Float32Array.from(cached)

	// Morph into a caller-owned buffer, reading the cached shape as the source.
	const out = new Float32Array(SAMPLES * 2)
	morphSamples(out, cached, sampleShape('orbit', 2), 0.5)
	assert.ok(maxDeviation(out, cached) > 0.05, 'morph produced nothing')
	assert.equal(maxDeviation(cached, snapshot), 0, 'the cached source shape was mutated')
})
