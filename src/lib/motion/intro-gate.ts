'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'

// The hero entrance should not compete with the percentage preloader (V4 §5.3:
// "then the hero text animation begins"). The preloader reports completion here
// and display type starts on that signal instead of on mount.
//
// It is a module singleton because the two components are siblings in a server
// tree; the timeout is a deadlock guard — if a surface renders the display type
// without ever mounting a preloader, the animation still starts.

let introDone = false
const listeners = new Set<() => void>()

export function notifyIntroDone(): void {
	if (introDone) return
	introDone = true
	for (const fn of Array.from(listeners)) fn()
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

const getSnapshot = () => introDone
// Server renders "not done" so server and client markup agree; nothing animates
// before hydration anyway.
const getServerSnapshot = () => false

export function useIntroDone(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useIntroReady(timeoutMs = 1800): boolean {
	const done = useIntroDone()
	const [forced, setForced] = useState(false)

	useEffect(() => {
		if (done || forced) return
		const timer = setTimeout(() => setForced(true), timeoutMs)
		return () => clearTimeout(timer)
	}, [done, forced, timeoutMs])

	return done || forced
}
