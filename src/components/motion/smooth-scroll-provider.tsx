'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion, useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { setScrollEngine } from '@/lib/motion/scroll-engine'

gsap.registerPlugin(ScrollTrigger)

// Global smooth-scroll + scroll-engine provider (UI/UX run M3). Lenis drives
// inertial scrolling; GSAP's ticker pumps Lenis and ScrollTrigger reads the
// resulting scroll position, so every scroll-scrubbed scene / pin stays in sync
// with the smoothed value. Mounted once at the app shell.
//
// Reduced motion: Lenis is never created (native scrolling) and ScrollTrigger
// scenes are expected to render their static end-state (each primitive checks
// useReducedMotion itself).
//
// Workspace routes: Lenis is never created there either. Those three shells are
// `h-dvh` with their own `overflow-y-auto` <main>, so the DOCUMENT does not
// scroll at all (measured: scrollHeight == innerHeight == 900 on /dashboard).
// Lenis's wheel handler calls preventDefault() on the window and animates
// document scroll instead, so on an inner-scroller page it swallows every mouse
// wheel and nothing moves anywhere on the screen. Native scrolling is the only
// behaviour that works with that layout. See docs/uiux-take3-status.md, M9.
//
// Cleanup: on unmount we destroy Lenis and detach the ticker callback, so no
// scroll engine or RAF loop leaks across route changes (a hard defect per the
// brief). ScrollTriggers are NOT killed globally: each scene component owns
// its own trigger's lifecycle, and a global kill here would destroy other
// components' triggers during React StrictMode's dev double-mount.
const WORKSPACE_ROUTES = ['/app', '/dashboard', '/agentos', '/admin']

const isWorkspaceRoute = (pathname: string) =>
	WORKSPACE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))

export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
	const reduced = useReducedMotion()
	const pathname = usePathname()
	const workspace = isWorkspaceRoute(pathname)

	useEffect(() => {
		// `reduced` is the hook value, which starts false for SSR parity, so the first
		// client render of a reduced-motion visitor still says "not reduced". Reading
		// the media query synchronously here closes that window: without it the effect
		// constructs a Lenis instance, the library writes its `window.lenis` global in
		// the constructor, and the next render tears it down again — a live wheel
		// handler for a few milliseconds on a page whose user asked for no motion, and
		// a global that outlives the instance (measured: reduced-motion landing showed
		// `window.lenis` present with no `lenis` class on <html>).
		if (reduced || workspace || prefersReducedMotion()) return

		// anchors: true lets Lenis intercept same-page `href="#…"` clicks (nav
		// links, hero buttons). Without it the browser's instant jump is snapped
		// straight back to Lenis's animated value, so anchor nav is dead. Lenis
		// honours each target's scroll-margin-top for the header offset.
		const lenis = new Lenis({ duration: 1.1, smoothWheel: true, anchors: true })
		setScrollEngine(lenis)
		const onScroll = () => ScrollTrigger.update()
		lenis.on('scroll', onScroll)

		const tick = (time: number) => lenis.raf(time * 1000)
		gsap.ticker.add(tick)
		gsap.ticker.lagSmoothing(0)

		return () => {
			gsap.ticker.remove(tick)
			lenis.off('scroll', onScroll)
			setScrollEngine(null)
			lenis.destroy()
		}
	}, [reduced, workspace])

	return <>{children}</>
}
