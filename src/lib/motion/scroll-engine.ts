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
