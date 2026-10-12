// V7 — the pure half of the 3D zoom-out camera (lusion-style, but mapped onto the
// landing's own section stack). Kept free of DOM reads so the mapping between a
// page's scroll position and its depth is testable in isolation.
//
// The one rule every other file in this run obeys: a page that the visitor is
// reading is rendered at EXACTLY identity. Depth only exists in the handoff band
// between two pages, because the V4/V5/V6 systems that live inside a section
// (useScrub, IntersectionObserver thresholds, the canvas engines) measure
// getBoundingClientRect, and an ancestor transform makes those rects projected.
// Keeping identity through the body of a page is what makes this additive. Ownership
// (V7_TALL) is the half of that rule which stays true on a short window, where a tall
// section can cover the viewport centre while its own u already says it has left.

/** A page holds no depth at all until it is this far past the viewport handoff. */
export const V7_HANDOFF = 0.55

/**
 * Signed progress of the viewport through one page: 0 when the viewport centre
 * sits on the page centre, -1 when the page is entirely below the viewport (not
 * reached yet), +1 when it is entirely above (already read). Denominator is the
 * half-height of the page plus half a viewport, which is exactly the centre
 * offset at which the two boxes stop overlapping.
 * A page spans exactly -1..1 in u whatever its height, but not uniformly in *screen
 * coverage*: for a page taller than 1.22 viewports, a u beyond the handoff can still
 * leave it covering the viewport centre. `depthCoveringCentre` bounds that case and
 * `ownsPage` refuses it.
 */
export function pageU(center: number, height: number, viewportCenter: number, vh: number) {
	const span = Math.max(1, height / 2 + vh / 2)
	return (viewportCenter - center) / span
}

/** How deep a page at `u` has receded: 0 across the whole readable body, 1 at the extremes. */
export function depthOf(u: number) {
	const a = Math.min(1, Math.abs(u))
	const x = Math.min(1, Math.max(0, (a - V7_HANDOFF) / (1 - V7_HANDOFF)))
	// smoothstep, so a page starts moving with zero velocity at the handoff edge
	// instead of snapping out of identity.
	return x * x * (3 - 2 * x)
}

/** A page taller than this many viewports can never leave the screen, so the camera
    stands down on it. The number is derived, not picked: see `depthCoveringCentre`. */
export const V7_TALL = 1.75

export function ownsPage(height: number, vh: number) {
	return height <= vh * V7_TALL
}

/**
 * The deepest a page can be while it still covers the viewport centre — which is the
 * whole protection rule in one number. A page whose top edge has reached the centre is
 * at u = height / (height + vh), the largest value any centre-covering page reaches, so
 * `depthCoveringCentre` is the worst projection error the sections inside it can see
 * while the visitor is reading them. At V7_TALL = 1.75 that is 0.096: under a tenth of
 * the recede, which is why a taller section is excluded outright instead of tolerated.
 */
export function depthCoveringCentre(height: number, vh: number) {
	return depthOf(height / (height + vh))
}

export type V7CameraParams = {
	perspective?: number
	depth?: number
	lift?: number
	tiltX?: number
	tiltY?: number
}

export const V7_DEFAULTS: Required<V7CameraParams> = {
	perspective: 1300,
	depth: 1500,
	lift: 0.07,
	tiltX: 15,
	tiltY: 6
}

/**
 * The page's transform for one frame. Returns `'none'` — not an identity matrix —
 * below the handoff, so a settled page keeps no containing block of its own and
 * every `position: fixed` or rect measurement inside it behaves exactly as it did
 * before V7 existed.
 */
export function pageTransform(
	u: number,
	vh: number,
	parity: number,
	params: V7CameraParams = {}
): string {
	const p = { ...V7_DEFAULTS, ...params }
	const t = depthOf(u)
	if (t <= 0.0001) return 'none'
	// u < 0 is a page the reader has not reached yet, u > 0 one they have passed.
	// The lift follows that: an unread page waits high in the scene and settles down
	// into place, a read one sinks away behind the camera.
	const side = u < 0 ? -1 : 1
	const z = -p.depth * t
	const y = side * -vh * p.lift * t
	const rx = side * p.tiltX * t
	// Alternating yaw is the V4 "pages settling into a book" language, one page
	// tilting left and the next right as it recedes.
	const ry = (parity % 2 === 0 ? 1 : -1) * p.tiltY * t
	return `perspective(${p.perspective}px) translate3d(0, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`
}

/** Opacity that tracks depth, but never below the point where a page is still readable. */
export function pageOpacity(u: number) {
	return 1 - 0.92 * depthOf(u)
}

/** The rig's own eased travel, shared by the backdrop tint and the scroll indicator. */
export function sceneDepth(us: number[]) {
	let max = 0
	for (const u of us) max = Math.max(max, depthOf(u))
	return max
}

/**
 * Can the reader see this page at all? Two of the rig's decisions read it. `sceneDepth`
 * answers a question about the scene on screen, so an off-screen page must not contribute
 * to its max: every page in the document does, and a page two sections away is always
 * fully receded, which would hold the tint at its ceiling at every scroll position — rest
 * included. And a page with no overlap has nothing to draw, so the rig writes no transform
 * for it either: `depthOf` clamps at 1, so the recession an unseen page is given is the
 * same value it already held at the fold edge, and the layer is bought for a pixel nobody
 * sees.
 */
export function isSeen(top: number, height: number, scrollY: number, vh: number) {
	return top < scrollY + vh && top + height > scrollY
}
