'use client'

import { Link } from '@/i18n/routing'
import { scrubSlice, useScrub } from '@/lib/motion/use-scrub'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// Footer (brief §6.2-12, then V4 §5.6): the link columns cascade in on view from one
// running index — a single sweep across the three lists, not three independent fades —
// on §5.6's own numbers (30px of rise, 100ms apart), the whole section rises into place
// on the spring curve so it overshoots by a few pixels before it settles, and the giant
// AGENTOS wordmark wipes open from the left as the section travels through the viewport.
// The wordmark stays aria-hidden: pure ornament, no accessible text, no contrast
// obligation.
//
// §5.6 also asks each social icon to jiggle on hover. This footer has no social links —
// the product has no social profiles — and inventing three handles to animate would put
// fabricated product facts on the page for the sake of one gesture (§7). The jiggle is
// therefore not implemented, and `Tilt`'s cards and the nav's character wave carry the
// hover personality instead.

const EXPLORE = [
	{ href: '#pipeline', label: 'Pipeline' },
	{ href: '#capabilities', label: 'Capabilities' },
	{ href: '#surfaces', label: 'Product' },
	{ href: '#benchmarks', label: 'Benchmarks' },
	{ href: '#faq', label: 'FAQ' }
]

// One source of truth for the giant wordmark: three paint passes in the footer's svg
// (10% fill, outline, rising accent fill) render the same string, so no pass can ever
// drift from the others (§11's no-hardcoded-copy rule).
const WORDMARK = 'AGENTOS'

const SECTION = 'mx-auto w-[89%] max-w-6xl'

const LINK =
	'text-text-muted hover:text-text link-center ease-expo inline-flex min-h-11 items-center text-[13px] no-underline transition-colors duration-200'

function Cascade({
	order,
	shown,
	reduced,
	className,
	children
}: {
	order: number
	shown: boolean
	reduced: boolean
	className?: string
	children: React.ReactNode
}) {
	const d = 120 + order * 100
	return (
		<li
			className={className}
			style={{
				opacity: shown ? 1 : 0,
				transform: shown ? 'none' : 'translateY(30px)',
				transition: reduced
					? 'none'
					: `opacity 700ms var(--ease-expo) ${d}ms, transform 700ms var(--ease-expo) ${d}ms`
			}}
		>
			{children}
		</li>
	)
}

export function LandingFooter() {
	const reduced = useReducedMotion()
	const [wordRef, p] = useScrub<HTMLDivElement>(1.2)
	const [ref, inView] = useInView<HTMLDivElement>(0.12)
	const shown = reduced || inView
	const wipe = scrubSlice(p, 0, 0.85)
	// §10's second pass travels the other way: the accent rises from the baseline.
	const rise = scrubSlice(p, 0.24, 0.7)

	const props = { shown, reduced }

	return (
		<footer
			ref={ref}
			data-t4="footer"
			// §5.6's entrance: the whole section rises from below its own position and
			// the spring curve carries it a few pixels past 0 before it settles.
			// Transform only — the footer's box never moves, so the document height and
			// every anchor below it stay exactly where they were.
			className="footer-rise bg-[var(--surface)] pt-20 pb-10"
			style={{ transform: shown ? 'none' : 'translateY(56px)' }}
		>
			<div className={SECTION}>
				<div className="grid gap-12 sm:grid-cols-[1fr_auto] lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
					<div>
						<span className="font-display text-text text-[20px] font-bold tracking-[-0.02em]">
							AgentOS
						</span>
						<p className="text-text-faint mt-3 max-w-[34ch] text-[13px] leading-[1.55]">
							Adaptive multi-agent intelligence. Jev decides, the orchestra works, the record proves
							it.
						</p>
					</div>
					<div>
						<span className="label-uppercase text-text-faint">Explore</span>
						<ul className="mt-3 flex list-none flex-col gap-0.5 p-0">
							{EXPLORE.map((l, i) => (
								<Cascade key={l.href} order={i} {...props}>
									<a href={l.href} className={LINK}>
										{l.label}
									</a>
								</Cascade>
							))}
						</ul>
					</div>
					<div>
						<span className="label-uppercase text-text-faint">Account</span>
						<ul className="mt-3 flex list-none flex-col gap-0.5 p-0">
							<Cascade order={5} {...props}>
								<Link href="/login" className={LINK}>
									Login
								</Link>
							</Cascade>
							<Cascade order={6} {...props}>
								<Link href="/signup" className={LINK}>
									Sign up
								</Link>
							</Cascade>
						</ul>
					</div>
					<div>
						<span className="label-uppercase text-text-faint">Build</span>
						<ul className="mt-4 flex list-none flex-col gap-2.5 p-0">
							<Cascade order={7} {...props} className="text-text-muted text-[13px]">
								Development build · 8x Playmakers trial
							</Cascade>
							<Cascade order={8} {...props} className="text-text-muted text-[13px]">
								Models via NanoGPT
							</Cascade>
							<Cascade order={9} {...props} className="text-text-muted text-[13px]">
								Localhost deployment · Supabase Postgres
							</Cascade>
						</ul>
					</div>
				</div>

				{/* Wordmark wipe: the glyph box is clipped left→right with the scroll and
				    slides a few pixels behind the reveal edge.
				    V6 §10 adds two passes to the same glyphs rather than changing that:
				    an outline (the page had no stroked giant wordmark yet — the existing
				    layer is a 10% fill) and an accent fill that rises from the baseline
				    on the same scrub, clipped in objectBoundingBox units so it travels
				    with the type whatever size the fluid heading resolves to. */}
				<div
					ref={wordRef}
					data-t2="wordmark"
					className="display-huge mt-20 overflow-hidden select-none"
					aria-hidden
				>
					<svg
						className="block h-[0.95em] w-full"
						style={{
							clipPath: `inset(0 ${((1 - wipe) * 100).toFixed(2)}% 0 0)`,
							transform: `translateX(${((1 - p) * -24).toFixed(2)}px)`
						}}
					>
						<defs>
							<clipPath id="v6-wordmark-rise" clipPathUnits="objectBoundingBox">
								<rect x="0" y={(1 - rise).toFixed(4)} width="1" height={rise.toFixed(4)} />
							</clipPath>
						</defs>
						<text x="0" y="0.72em" fill="var(--text)" fillOpacity="0.1">
							{WORDMARK}
						</text>
						<text
							data-t6="wordmark-outline"
							x="0"
							y="0.72em"
							fill="none"
							stroke="var(--text)"
							strokeOpacity="0.28"
							strokeWidth="1"
						>
							{WORDMARK}
						</text>
						<text
							data-t6="wordmark-fill"
							x="0"
							y="0.72em"
							fill="var(--accent)"
							fillOpacity="0.2"
							clipPath="url(#v6-wordmark-rise)"
						>
							{WORDMARK}
						</text>
					</svg>
				</div>
				<div className="border-border text-text-faint mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-6 font-mono text-[11px]">
					<span>© 2026 AgentOS</span>
				</div>
			</div>
		</footer>
	)
}
