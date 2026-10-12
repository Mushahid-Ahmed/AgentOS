import test from 'node:test'
import assert from 'node:assert/strict'
import {
	isSeen,
	V7_DEFAULTS,
	V7_HANDOFF,
	V7_TALL,
	depthCoveringCentre,
	depthOf,
	ownsPage,
	pageOpacity,
	pageTransform,
	pageU,
	sceneDepth
} from './page-depth.ts'

const VH = 800

test('pageU is the overlap fraction, not a raw pixel offset', () => {
	// A page spanning [0, 1000] with a 800px viewport: the two boxes stop
	// overlapping exactly when the viewport centre is 500 + 400 below the page
	// centre, and that is where u must read 1.
	const u0 = pageU(500, 1000, 500, VH)
	const u1 = pageU(500, 1000, 1400, VH)
	const um1 = pageU(500, 1000, -400, VH)
	assert.equal(u0, 0)
	assert.equal(u1, 1)
	assert.equal(um1, -1)
	// A tall page reaches the handoff later than a short one, in its own units.
	assert.ok(pageU(0, 6000, 3200, VH) < pageU(0, 600, 3200, VH))
})

test('depth holds at exactly zero across the whole readable body of a page', () => {
	assert.equal(depthOf(0), 0)
	assert.equal(depthOf(-VH / 2000), 0)
	// The regression this gate exists for: the first curve put depth at 0.5 right
	// on the handoff edge, which would have started a page receding while it still
	// filled the screen.
	assert.equal(depthOf(V7_HANDOFF), 0)
	assert.equal(depthOf(-V7_HANDOFF), 0)
	assert.equal(depthOf(0.55), 0)
})

test('depth reaches 1 exactly where the page has fully left the viewport', () => {
	assert.equal(depthOf(1), 1)
	assert.equal(depthOf(-1), 1)
	assert.equal(depthOf(1.9), 1, 'clamped, so a page can never over-recede')
	assert.equal(depthOf(-1.9), 1)
})

test('depth is symmetric and monotone on both sides of the handoff', () => {
	let prev = 0
	for (let u = V7_HANDOFF; u <= 1.0001; u += 0.01) {
		const d = depthOf(u)
		assert.ok(d >= prev - 1e-12, `not monotone at ${u}`)
		assert.equal(d, depthOf(-u), `asymmetric at ${u}`)
		prev = d
	}
	// Zero velocity at the edge: the page must not snap out of identity.
	assert.ok(depthOf(V7_HANDOFF + 0.01) < 0.01)
})

test('a settled page gets no transform at all, not an identity matrix', () => {
	// 'none' is the load-bearing value: an identity transform would still make the
	// page a containing block for its own fixed descendants and leave will-change
	// switched on.
	for (let u = -V7_HANDOFF; u <= V7_HANDOFF; u += 0.05) {
		assert.equal(pageTransform(u, VH, 3), 'none')
		assert.equal(pageOpacity(u), 1)
	}
	// Positive control: outside the band it really does move.
	assert.notEqual(pageTransform(1, VH, 3), 'none')
	assert.notEqual(pageTransform(-1, VH, 3), 'none')
	assert.ok(pageOpacity(1) < 0.15)
})

test('the transform recedes in Z and tilts opposite ways on the two sides', () => {
	const arriving = pageTransform(1, VH, 0)
	const departing = pageTransform(-1, VH, 0)
	assert.match(arriving, /^perspective\(/)
	assert.ok(!/NaN|Infinity/.test(arriving), arriving)
	assert.ok(!/NaN|Infinity/.test(departing), departing)

	// parseFloat, not a character-class strip: a class that allows exponents keeps
	// the "e" out of "deg", which parses as NaN and silently voids every assertion
	// that reads it. Each part is then asserted finite for the same reason.
	const triple = (s: string) =>
		(s.match(/translate3d\(([^)]*)\)/)?.[1] ?? '').split(',').map((p) => parseFloat(p))
	const rot = (s: string, axis: string) =>
		parseFloat(s.match(new RegExp(`rotate${axis}\\(([^)]*)\\)`))?.[1] ?? '')

	const [ax, ay, az] = triple(arriving)
	const [bx, by, bz] = triple(departing)
	const [rxA, ryA, rxD, ryD] = [
		rot(arriving, 'X'),
		rot(arriving, 'Y'),
		rot(departing, 'X'),
		rot(departing, 'Y')
	]
	for (const v of [ax, ay, az, bx, by, bz, rxA, ryA, rxD, ryD]) {
		assert.ok(Number.isFinite(v), arriving)
	}

	assert.equal(ax, 0, 'the camera never pans sideways')
	assert.equal(az, bz, 'depth is symmetric')
	assert.ok(az < 0, 'pages recede away from the camera, never through it')
	assert.equal(az, -V7_DEFAULTS.depth)
	assert.equal(ay, -by, 'the two pages travel in opposite Y')
	assert.ok(rxA > 0)
	assert.equal(rxA, -rxD)
	assert.equal(ryA, ryD, 'yaw follows parity, not travel side')
})

test('yaw alternates by page parity, which is the book-settling language', () => {
	const ry = (s: string) => parseFloat(s.match(/rotateY\(([^)]*)\)/)?.[1] ?? '')
	const even = pageTransform(1, VH, 0)
	const odd = pageTransform(1, VH, 1)
	assert.ok(Number.isFinite(ry(even)) && Number.isFinite(ry(odd)), even)
	assert.equal(ry(even), -ry(odd))
	assert.equal(Math.abs(ry(even)), V7_DEFAULTS.tiltY)
})

test('depth scales with the viewport height only in the travel axis', () => {
	const small = pageTransform(1, 400, 0)
	const large = pageTransform(1, 1200, 0)
	const yOf = (s: string) => parseFloat(s.match(/translate3d\(([^)]*)\)/)?.[1].split(',')[1] ?? '')
	assert.ok(Number.isFinite(yOf(small)) && Number.isFinite(yOf(large)), small)
	assert.equal(Math.abs(yOf(small)) * 3, Math.abs(yOf(large)))
})

test('sceneDepth reports the nearest handoff, which is what the backdrop reads', () => {
	assert.equal(sceneDepth([0, 0.2, -0.4]), 0)
	assert.equal(sceneDepth([0, 1, 0.2]), 1)
	assert.equal(sceneDepth([0.8, -0.3]), depthOf(0.8))
	assert.equal(sceneDepth([]), 0)
})

test('isSeen is the viewport overlap, inclusive at a sliver and exclusive at the edge', () => {
	assert.ok(isSeen(0, 900, 0, VH))
	assert.ok(isSeen(VH - 1, 900, 0, VH), 'a page one pixel past the fold still shows a sliver')
	assert.ok(!isSeen(VH, 900, 0, VH), 'a page whose top sits exactly on the fold is not on screen')
	assert.ok(
		!isSeen(-900, 900, 0, VH),
		'a page whose bottom sits exactly on the scroll edge has left'
	)
	assert.ok(isSeen(3000, 4000, 4000, VH), 'a tall page that starts under the centre is still seen')
})

test('the scene the backdrop reads is only as deep as the pages on screen', () => {
	// A reader inside a settled page, with a page fully receded above and another not
	// yet reached below. The scene is flat here — nothing the reader can see is leaving.
	const sy = 4000
	const doc = [
		{ top: 0, h: 900 },
		{ top: 3600, h: 900 },
		{ top: 18000, h: 900 }
	]
	const u = (p: { top: number; h: number }) => pageU(p.top + p.h / 2, p.h, sy + VH / 2, VH)
	const seen = doc.filter((p) => isSeen(p.top, p.h, sy, VH))
	assert.equal(seen.length, 1, 'exactly the page covering the centre is on screen')
	assert.equal(sceneDepth(seen.map(u)), 0)
	// Positive control: the same document unfiltered is at the ceiling, which is the
	// bug this rule exists to stop — a max over every page in the document is always 1.
	assert.equal(sceneDepth(doc.map(u)), 1)
})

test('a page taller than the camera can protect is not owned by it', () => {
	// The limit is derived from the worst case below, not chosen for feel.
	assert.equal(ownsPage(VH * V7_TALL, VH), true)
	assert.equal(ownsPage(VH * V7_TALL + 1, VH), false)
	// Every measured section of the landing is owned even on a short window, so the
	// guard costs nothing today: the tallest is 1058px and 620 * 1.75 is 1085.
	assert.equal(ownsPage(1058, 620), true)
	assert.equal(ownsPage(1058, 600), false)
})

test('ownership is exactly what keeps the readable page flat', () => {
	// A page that covers the viewport centre can be at most this deep, and the whole
	// additive argument rests on that staying small.
	assert.ok(Math.abs(depthCoveringCentre(VH * V7_TALL, VH) - 0.0965) < 0.001)
	for (const h of [200, 500, 800, 1000, 1400]) {
		assert.ok(
			depthCoveringCentre(h, VH) <= 0.1,
			`${h}px must stay under a tenth of the recede, saw ${depthCoveringCentre(h, VH)}`
		)
	}
	// Positive control: the bound is not vacuous. Past ownership the same measure
	// is a projection strong enough to move a section's own rect reads.
	assert.ok(depthCoveringCentre(VH * 3, VH) > 0.25)
	// And monotone, so ownership can never exclude a page a shorter one survives.
	assert.ok(depthCoveringCentre(1400, VH) > depthCoveringCentre(900, VH))
})

test('an unseen page is already at the ceiling, so not writing it changes nothing drawn', () => {
	// The rig holds no transform for a page the reader cannot see. That is only visually
	// neutral because depth clamps: u is unbounded past the fold (a page eight sections
	// away sits at -9), while depthOf saturates at 1, so the first frame a page overlaps
	// the viewport draws the recession it was already assigned while off screen.
	const top = 4000
	const h = 900
	// u = -1 is the fold edge exactly: the viewport bottom sits on the page's top edge,
	// which is the same instant `isSeen` turns false — the two rules cannot disagree.
	const edge = top - VH
	assert.equal(pageU(top + h / 2, h, edge + VH / 2, VH), -1)
	assert.equal(isSeen(top, h, edge, VH), false)
	const far = pageU(top + h / 2, h, edge - 4000 + VH / 2, VH)
	assert.ok(far < -5, `a page four thousand pixels below the fold reads ${far}`)
	assert.equal(pageTransform(far, VH, 3), pageTransform(-1, VH, 3))
	assert.equal(pageOpacity(far), pageOpacity(-1))
	assert.equal(depthOf(far), 1)
	// One pixel inside the fold the page is seen, and the value it is drawn with is the
	// ceiling to three decimals: the write starts where the held layer would have been.
	assert.equal(isSeen(top, h, edge + 1, VH), true)
	assert.ok(Math.abs(depthOf(pageU(top + h / 2, h, edge + 1 + VH / 2, VH)) - 1) < 0.001)
	// Positive control: inside the handoff the same function is not at the ceiling, so the
	// clamp above is a fact about far pages and not a stub that returns 1 always.
	assert.ok(depthOf(-0.7) < 0.4)
})
