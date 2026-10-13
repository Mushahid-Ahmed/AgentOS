'use client'

import { useEffect, useRef, useState } from 'react'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useIntroReady } from '@/lib/motion/intro-gate'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Fixed marketing nav (brief §6.2-2, then V4 §5.1): transparent over the hero, solid
// once scrolled, and while solid it shrinks, gets a backdrop-blur, hides on a
// scroll-down past the threshold and slides back in on the first pixel of scroll-up.
// The logo draws its own mark and springs in after the preloader leaves, and the desktop
// links run a character wave on hover.
//
// Owner ruling 2026-10-13 (V15): the reading position is marked by the word alone. The
// travelling accent underline that used to sit under the active link is removed on every
// surface, so a page name is highlighted, never ruled.
//
// What §5.1 asks for and what §6.2 allows are not the same gesture. "Nav bar shrinks
// smoothly (height transition)" would animate `height` on a fixed header, which is a
// layout read plus a re-layout of everything below it on every frame of a scroll —
// exactly the property list §6.2 bans and the thrash §6.10 bans. The shrink is
// therefore a `transform: scale()` on the row, so the bar reads as getting smaller
// while its box never changes. Same reason the hide/show is `translateY`.
//
// All three scroll-driven behaviours are written from one rAF-throttled passive
// listener. Section offsets are measured once per resize rather than per frame: a
// scroll frame then costs one `scrollY` read and a handful of style writes, and no
// layout read at all.

const ANCHORS = [
	{ href: '#pipeline', label: 'Pipeline' },
	{ href: '#capabilities', label: 'Capabilities' },
	{ href: '#surfaces', label: 'Product' },
	{ href: '#benchmarks', label: 'Benchmarks' },
	{ href: '#faq', label: 'FAQ' }
]

// Past the hero's first screenful the bar is free to hide; hiding any earlier means a
// single trackpad nudge at the top of the page makes the nav vanish.
const HIDE_AFTER = 320
const EPS = 4

function WaveLabel({ label }: { label: string }) {
	const reduced = useReducedMotion()
	// Reduced motion renders the plain word: per-letter spans exist only to be moved,
	// and they would put the same word through the accessibility tree as five
	// fragments. The labels here are single words, so the concatenated letters are
	// the accessible name exactly — asserted by the M5 gate, because a two-word label
	// would need a space element the way HeroSubhead does.
	if (reduced) return <>{label}</>
	return (
		<span className="nav-wave">
			{Array.from(label).map((ch, i) => (
				<span key={i} style={{ '--i': i } as React.CSSProperties}>
					{ch}
				</span>
			))}
		</span>
	)
}

export function LandingNav() {
	const reduced = useReducedMotion()
	const introReady = useIntroReady()
	const [solid, setSolid] = useState(false)
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(-1)
	const navRef = useRef<HTMLElement>(null)

	// Hide/show and the active index are deliberately *not* React state on every
	// frame: `hidden` is written straight to the header's transform, and only the
	// active index (which changes a handful of times per page) goes through setState.
	const hiddenRef = useRef(false)

	useEffect(() => {
		let raf = 0
		// Section tops in document space, measured on demand, never in the scroll
		// handler itself: a scroll frame then costs one `scrollY` read and no layout.
		let tops: number[] = []
		let vh = 0
		const remeasure = () => {
			vh = window.innerHeight || 1
			tops = ANCHORS.map((a) => {
				const el = document.getElementById(a.href.slice(1))
				return el ? el.getBoundingClientRect().top + window.scrollY : Number.POSITIVE_INFINITY
			})
		}
		const setHidden = (v: boolean) => {
			if (hiddenRef.current === v) return
			hiddenRef.current = v
			const el = navRef.current
			// §6.7: the bar never moves for a visitor who asked for no motion, so the
			// transform stays at rest instead of being written twice per gesture.
			if (!el) return
			el.dataset.navHidden = v ? '1' : '0'
			if (!reduced) el.style.transform = v ? 'translateY(-100%)' : 'translateY(0)'
		}
		let lastY = window.scrollY
		const measure = () => {
			raf = 0
			const y = window.scrollY
			// Past the hero, scrolling down puts the bar away so the reading has the
			// whole screen; the first pixel of scroll-up brings it back. Any earlier
			// threshold would make the nav vanish on one trackpad nudge at the top.
			if (!reduced) {
				if (y > lastY + EPS && y > HIDE_AFTER) setHidden(true)
				else if (y < lastY - EPS || y < HIDE_AFTER) setHidden(false)
			}
			lastY = y
			// Solidity is legibility, not decoration: the blur and the hairline are on
			// whichever route the visitor is on, reduced motion included.
			const isSolid = y > 40
			setSolid((prev) => (prev === isSolid ? prev : isSolid))

			// The section that owns the reading line — the last one whose top has
			// passed a third of the viewport.
			let next = -1
			for (let i = 0; i < tops.length; i++) {
				const top = tops[i]
				if (top !== undefined && top - vh * 0.34 <= y) next = i
			}
			setActive((prev) => (prev === next ? prev : next))
		}
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(measure)
		}
		remeasure()
		measure()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule, { passive: true })
		// The webfont swap moves every section by a few pixels; re-measure once the
		// type is final, or the marker would track the pre-swap layout.
		const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
		if (fonts && 'ready' in fonts) fonts.ready.then(remeasure)
		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
		}
	}, [reduced])

	// Opening the overlay must bring the bar back down: the close button lives in it,
	// and a hidden header over a full-screen menu is a menu nobody can dismiss.
	useEffect(() => {
		if (!open) return
		const el = navRef.current
		hiddenRef.current = false
		if (el && !reduced) el.style.transform = 'translateY(0)'
	}, [open, reduced])

	return (
		<>
			<header
				ref={navRef}
				data-t4="nav"
				data-nav-solid={solid ? '1' : '0'}
				data-nav-active={active}
				className={cn(
					// z-50, above the mobile overlay's z-[45]: the overlay covers the whole
					// viewport, so a lower bar would swallow the very button that closes it
					// and leave a touch user stuck with an open menu (Escape works, but a
					// phone has no Escape).
					'ease-expo fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter,transform] duration-[var(--motion-base)]',
					solid || open
						? 'border-border/70 bg-bg/85 border-b backdrop-blur-md'
						: 'border-transparent bg-transparent',
					// §5.1's shrink, expressed as a transform: the row gets 8% smaller
					// toward the top edge, so the bar reads as tightening without its box
					// changing height.
					solid && !open && !reduced && 'nav-shrunk'
				)}
			>
				<nav
					aria-label="Primary"
					className="mx-auto flex h-16 w-[89%] max-w-6xl items-center justify-between"
				>
					{/* WCAG 2.5.8 (AA, 24px minimum target): every nav affordance is an
					  inline-flex with a 44px box, so the tap area is honest without
					  changing the 64px bar's visual rhythm. */}
					<a
						href="#main-content"
						className="font-display text-text inline-flex min-h-11 items-center gap-2 text-[15px] font-bold tracking-[-0.01em] no-underline"
					>
						{/* §5.1's "draws itself": the house mark is a stroke, so it is drawn
						  with the dash offset the pipeline already uses — pathLength=1 makes
						  it resolution-independent — and the wordmark springs in behind it
						  once the preloader has left (§5.3's sequence). */}
						<svg
							viewBox="0 0 200 200"
							aria-hidden
							fill="none"
							stroke="currentColor"
							strokeWidth="12"
							className="text-accent size-4 shrink-0 opacity-70"
						>
							<path
								d="M100 8 18 54v92l82 46 82-46V54Z"
								pathLength={1}
								strokeDasharray={1}
								strokeDashoffset={reduced || introReady ? 0 : 1}
								className="ease-expo transition-[stroke-dashoffset] duration-[900ms]"
							/>
						</svg>
						<span data-t4="nav-logo" className={cn(!reduced && introReady && 'nav-logo-in')}>
							AgentOS
						</span>
					</a>

					<div className="hidden items-center gap-7 md:flex">
						{ANCHORS.map((a, i) => (
							<a
								key={a.href}
								href={a.href}
								data-t4="nav-link"
								aria-current={active === i ? 'true' : undefined}
								className={cn(
									'text-text-muted hover:text-text ease-expo inline-flex min-h-11 items-center px-1 text-[13px] no-underline transition-colors duration-200',
									// Owner ruling 2026-10-13: the section the visitor is reading is marked in
									// the nav itself by weight and colour only, never by a rule under the word.
									active === i && 'text-text font-bold'
								)}
							>
								<WaveLabel label={a.label} />
							</a>
						))}
					</div>

					<div className="hidden items-center gap-2.5 md:flex">
						<Button asChild className="energy" variant="outline" size="controlSm">
							<Link href="/login">Login</Link>
						</Button>
						<Button asChild className="energy" variant="primary" size="controlSm">
							<Link href="/signup">Sign up</Link>
						</Button>
					</div>

					<button
						type="button"
						aria-expanded={open}
						aria-label={open ? 'Close menu' : 'Open menu'}
						onClick={() => setOpen((v) => !v)}
						className="text-text relative z-50 flex size-11 flex-col items-center justify-center gap-1.5 md:hidden"
					>
						<span
							className={cn(
								'bg-text ease-expo h-px w-5 transition-transform duration-300',
								open && 'translate-y-[3.5px] rotate-45'
							)}
						/>
						<span
							className={cn(
								'bg-text ease-expo h-px w-5 transition-transform duration-300',
								open && '-translate-y-[3px] -rotate-45'
							)}
						/>
					</button>
				</nav>
			</header>

			{/* Mobile overlay */}
			<div
				aria-hidden={!open}
				className={cn(
					'bg-bg ease-expo fixed inset-0 z-[45] flex flex-col items-center justify-center gap-6 transition-opacity duration-300 md:hidden',
					open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
				)}
			>
				{(open ? ANCHORS : []).map((a, i) => (
					<a
						key={a.href}
						href={a.href}
						onClick={() => setOpen(false)}
						className="nav-overlay-item font-display text-text text-[28px] font-semibold tracking-[-0.02em] no-underline"
						style={{ animationDelay: `${i * 60}ms` }}
					>
						{a.label}
					</a>
				))}
				<div className="nav-overlay-item mt-4 flex gap-3" style={{ animationDelay: '300ms' }}>
					<Button asChild className="energy" variant="outline" size="control">
						<Link href="/login" onClick={() => setOpen(false)}>
							Login
						</Link>
					</Button>
					<Button asChild className="energy" variant="primary" size="control">
						<Link href="/signup" onClick={() => setOpen(false)}>
							Sign up
						</Link>
					</Button>
				</div>
			</div>

			<style>{`@keyframes nav-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
				.nav-overlay-item { animation: nav-in 500ms cubic-bezier(0.16,1,0.3,1) both; }
				@media (prefers-reduced-motion: reduce) { .nav-overlay-item { animation: none; } }`}</style>
		</>
	)
}
