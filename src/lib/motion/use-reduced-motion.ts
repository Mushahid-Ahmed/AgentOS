'use client'
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

// Authoritative synchronous read, for effects that must not create a resource
// (a WebGL context, an rAF loop) before the hook's mount-time sync has landed.
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return false
	return window.matchMedia(QUERY).matches
}

// Single source of truth for "the user asked for less motion". Every motion
// primitive (smooth scroll, cursor, proximity glow, scroll-scrub scenes,
// char-splits) reads this and collapses to a static, fully-visible layout.
// SSR-safe: starts false on the server and syncs on mount, so server HTML and
// the first client paint agree (no hydration mismatch); the CSS reduced-motion
// guard in globals.css backstops the window before hydration.
export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false)

	useEffect(() => {
		const mql = window.matchMedia(QUERY)
		const onChange = () => setReduced(mql.matches)
		onChange()
		mql.addEventListener('change', onChange)
		return () => mql.removeEventListener('change', onChange)
	}, [])

	return reduced
}

// Fine-pointer (mouse/trackpad) detection: the custom cursor + proximity glow
// are desktop-only; touch devices keep the native cursor and static text.
export function useFinePointer(): boolean {
	const [fine, setFine] = useState(false)

	useEffect(() => {
		const mql = window.matchMedia('(pointer: fine)')
		const onChange = () => setFine(mql.matches)
		onChange()
		mql.addEventListener('change', onChange)
		return () => mql.removeEventListener('change', onChange)
	}, [])

	return fine
}
