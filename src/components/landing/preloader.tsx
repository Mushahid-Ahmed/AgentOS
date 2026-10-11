'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { notifyIntroDone } from '@/lib/motion/intro-gate'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Percentage preloader (brief §6.2-1, Lusion pattern): counts 0→100 in 0.9s,
// fades out, then unmounts entirely. Clicking anywhere or Escape skips it.
// Reduced motion: no overlay at all — the page is simply there. The overlay
// never gates content: it unmounts ~1.3s after mount at the latest.

const DURATION_MS = 900
// Brief §9 asks about a "preloader flash on repeat visits": within one session a
// juror leaves for /login and comes back, which remounts this component and would
// replay the full cinematic. One entry per session, no content gated.
const SEEN_KEY = 'agentos.preloader.seen'

// Read through an external store so server HTML and the first client paint agree
// (getServerSnapshot is always false) — no hydration mismatch, and no
// setState-in-effect cascade to skip the replay.
const subscribeNoop = () => () => {}
function readSeen(): boolean {
	try {
		return sessionStorage.getItem(SEEN_KEY) === '1'
	} catch {
		// Storage blocked (private mode / embedded frame): play the intro once.
		return false
	}
}

export function Preloader() {
	const reduced = useReducedMotion()
	const seen = useSyncExternalStore(subscribeNoop, readSeen, () => false)
	const [pct, setPct] = useState(0)
	const [phase, setPhase] = useState<'showing' | 'leaving' | 'gone'>('showing')

	// Take 4 §5.3 asks for the hero entrance to begin *after* the preloader
	// leaves. Announce the exit (or the preloader's absence) on the gate so the
	// display type is not animating blind underneath an opaque overlay.
	useEffect(() => {
		if (reduced || seen || phase !== 'showing') notifyIntroDone()
	}, [reduced, seen, phase])

	useEffect(() => {
		// Reduced motion or an already-seen session: nothing animates.
		if (reduced || seen) return
		let raf = 0
		const start = performance.now()
		const step = (now: number) => {
			const t = Math.min(1, Math.max(0, (now - start) / DURATION_MS)) // rAF `now` can precede the effect's stamp
			setPct(Math.round(t * 100))
			if (t < 1) raf = requestAnimationFrame(step)
			else setPhase('leaving')
		}
		raf = requestAnimationFrame(step)
		const skip = () => setPhase('gone')
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') skip()
		}
		window.addEventListener('keydown', onKey)
		return () => {
			cancelAnimationFrame(raf)
			window.removeEventListener('keydown', onKey)
		}
	}, [reduced, seen])

	// Safety net: unmount shortly after the exit begins even if transitionend never
	// fires (reduced motion / disabled transitions would otherwise leave a
	// full-screen panel over the page). It is longer than the 600 ms slide so the
	// timer can never cut the sweep it is meant to be protecting.
	useEffect(() => {
		if (phase !== 'leaving') return
		try {
			sessionStorage.setItem(SEEN_KEY, '1')
		} catch {
			// Storage blocked: nothing to persist, the intro still plays once.
		}
		const timer = setTimeout(() => setPhase('gone'), 720)
		return () => clearTimeout(timer)
	}, [phase])

	if (phase === 'gone' || reduced || seen) return null

	return (
		<div
			role="status"
			aria-label="Loading AgentOS"
			onClick={() => setPhase('gone')}
			// §5.3: the panel leaves by sliding up and away, so the hero is uncovered
			// from the top down instead of blinking into existence. `pointer-events:
			// none` during the exit because a panel on its way out must not swallow a
			// click meant for the page beneath it.
			data-t4="preloader"
			className="preloader-veil bg-bg fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center gap-6"
			style={{
				transform: phase === 'leaving' ? 'translateY(-100%)' : 'translateY(0)',
				opacity: phase === 'leaving' ? 0 : 1,
				pointerEvents: phase === 'leaving' ? 'none' : 'auto'
			}}
			onTransitionEnd={(e) => {
				if (phase === 'leaving' && e.propertyName === 'transform') setPhase('gone')
			}}
		>
			<span className="text-text-faint font-mono text-[11px] tracking-[0.2em] uppercase">
				AgentOS
			</span>
			<div className="font-display text-text text-[64px] leading-none font-bold tracking-[-0.04em] tabular-nums sm:text-[96px]">
				{pct}
				<span className="text-accent">%</span>
			</div>
			{/* §6.2: the bar is a 100%-wide track scaled on X, not a div whose `width`
			    is re-set 60 times a second. Same picture, no layout on any frame. */}
			<div className="bg-border h-px w-[160px] overflow-hidden">
				<div className="bg-accent h-px origin-left" style={{ transform: `scaleX(${pct / 100})` }} />
			</div>
			<span className="text-text-faint font-mono text-[10px]">click anywhere to skip</span>
		</div>
	)
}
