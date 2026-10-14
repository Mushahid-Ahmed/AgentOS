'use client'
import type Lenis from 'lenis'

// The live scroll engine, published for the handful of components that must move the
// document themselves (today: the §4.6 progress thread's click-to-jump).
//
// Why a module instead of the global: Lenis 1.3.26 writes `window.lenis = { version }` from
// its constructor — a flags object, not the instance — so `window.lenis.scrollTo(y)` throws
// `TypeError: i.scrollTo is not a function` and the click does nothing. Take-5 M11 caught
// exactly that by clicking the thread with a real mouse and watching scrollY stay at 0
// (docs/uiux-take5-decisions-log.md). The instance only ever exists inside the provider, so
// the provider hands it over here and takes it back on cleanup.
let engine: Lenis | null = null

export function setScrollEngine(lenis: Lenis | null) {
	engine = lenis
}

/**
 * Animate the document to `y`, through Lenis when it owns the scroll and natively when it
 * does not (workspace routes and reduced motion never construct an engine, and a landing
 * overlay is gone before either of those matters).
 */
export function scrollDocument(y: number) {
	if (engine) engine.scrollTo(y)
	else window.scrollTo({ top: y, behavior: 'smooth' })
}

/**
 * Freeze scrolling for a moment so a one-shot, scroll-triggered sequence can play in
 * front of a reader who would otherwise scroll straight past it (V22's proof gate).
 *
 * Stopping Lenis is only half of it: `stop()` parks the engine's own animation, it does
 * not cancel the wheel event, so a native scroll still moves the document underneath.
 * The blockers take the other half — capture-phase, so they run before anything that
 * listens on the way up — and they only ever exist for the length of the hold.
 *
 * Without an engine (workspace routes, reduced motion) this is a no-op, because there
 * is no smooth scroller to park and holding a native scroll would be a defect.
 */
const SCROLL_KEYS = new Set([
	'ArrowUp',
	'ArrowDown',
	'PageUp',
	'PageDown',
	'Home',
	'End',
	' ',
	'Spacebar'
])

let stopBlockers: (() => void) | null = null
let releaseTimer = 0

export function releaseScroll() {
	if (releaseTimer) {
		window.clearTimeout(releaseTimer)
		releaseTimer = 0
	}
	if (stopBlockers) {
		stopBlockers()
		stopBlockers = null
	}
	engine?.start()
}

export function holdScroll(ms: number) {
	if (!engine) return
	releaseScroll()
	engine.stop()

	const block = (e: Event) => e.preventDefault()
	const blockKeys = (e: KeyboardEvent) => {
		if (SCROLL_KEYS.has(e.key)) e.preventDefault()
	}
	window.addEventListener('wheel', block, { capture: true, passive: false })
	window.addEventListener('touchmove', block, { capture: true, passive: false })
	window.addEventListener('keydown', blockKeys, { capture: true })
	stopBlockers = () => {
		window.removeEventListener('wheel', block, { capture: true })
		window.removeEventListener('touchmove', block, { capture: true })
		window.removeEventListener('keydown', blockKeys, { capture: true })
	}

	// The caller says when the show ends; this is only the fuse that makes sure a
	// component that never gets to say it cannot lock the page forever.
	releaseTimer = window.setTimeout(releaseScroll, Math.max(ms, 0) + 400)
}
