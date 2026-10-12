'use client'

import { useEffect, useRef, useState } from 'react'
import { STAGES } from '@/components/landing/pipeline'
import { useIdlePause } from '@/lib/motion/use-idle-pause'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// V6 Job 2: the pinned pipeline carousel, in karma's architecture rather than
// V5's page-wide overlay. A tall wrapper scrolls; a sticky 100svh stage holds
// the step copy, the dots, the counter and a marquee of the section heading.
// Scroll distance through the wrapper IS the animation:
//
//   p    = clamp(-wrapperRect.top / (wrapperHeight - viewportHeight), 0, 1)
//   step = floor(p * steps)
//
// §2.1 measured karma at four such stages with wrappers of 200-500vh; this one
// is (steps + 1) * 100svh = 600svh for the five real D1 stages, per §5.
//
// A protected animation decided the placement. `useScrub` derives progress
// from `y + rect.top - vh*0.9`, which is CONSTANT inside a sticky box, so the
// scrubbed PipelineDiagram can never live in the stage. It stays in section 5
// above, untouched, and this carousel is a sibling block
// (§5: adapt the NEW code, never disable the V4 animation).
//
// The scroll handler only calls setState when the step index actually changes,
// so a wheel event costs one layout read and no React render. Marquee speed is
// changed in four buckets, never per frame, and by playback rate rather than by
// re-timing the animation (see write() below).
//
// All copy is the pipeline's own: the five stage labels/subs come from
// STAGES in landing/pipeline (one source of truth) and the marquee text is the
// section heading passed down from the landing page. Nothing here is new copy.

const STEPS = STAGES.length
const WRAP_SVH = (STEPS + 1) * 100
// Four wheel-speed buckets, expressed as the strip's travel period. They are
// applied as playback RATES on the running animation, never as animation-duration:
// re-timing a loop re-bases its phase, (currentTime mod d) / d, and snaps the strip
// to an earlier point of its travel — the "it starts again from Plan" the owner
// reported, measured at 25 backward jumps up to 1,954px in 17s of wheeling.
// playbackRate keeps currentTime and changes only how fast it advances.
const MARQUEE_SECONDS = [34, 22, 14, 9]
const MARQUEE_BASE = MARQUEE_SECONDS[0] ?? 34

type Props = { heading: string }

export function PipelineStage({ heading }: Props) {
	const reduced = useReducedMotion()
	const wrapRef = useRef<HTMLDivElement>(null)
	const marqueeRef = useRef<HTMLDivElement>(null)
	const stepRef = useRef(0)
	const [step, setStep] = useState(0)
	// The marquee loops forever, so its band is marked idle off screen; the
	// controller's own loop stops itself in measure() below.
	useIdlePause(wrapRef, '160px')

	useEffect(() => {
		if (reduced) return
		const wrap = wrapRef.current
		if (!wrap) return

		let raf = 0
		let lastY = window.scrollY
		let lastT = 0
		let speed = 0
		let bucket = 0

		const write = (b: number) => {
			if (b === bucket) return
			bucket = b
			const el = marqueeRef.current
			if (!el) return
			const rate = MARQUEE_BASE / (MARQUEE_SECONDS[b] ?? MARQUEE_BASE)
			for (const a of el.getAnimations()) {
				if ('animationName' in a && a.animationName !== 'v6-marquee') continue
				if (a.playbackRate === rate) continue
				if (typeof a.updatePlaybackRate === 'function') a.updatePlaybackRate(rate)
				else a.playbackRate = rate
			}
		}

		const measure = () => {
			raf = 0
			const rect = wrap.getBoundingClientRect()
			const vh = window.innerHeight || 1
			// §11 M9: the band is several viewports tall, so "the band does not
			// overlap the viewport at all" is an exact, no-false-positive test for
			// "nothing this loop computes can be seen". Off-screen it used to read a
			// rect, integrate wheel speed, re-rate the marquee and re-arm itself on
			// every scroll event anywhere on a 20,695px page. Here it reads the rect
			// and stops — no rate write, no self-reschedule.
			// The listener stays attached, so the first scroll after the band returns
			// picks the loop up from rest (speed and lastT reset, or a flick from three
			// sections back would otherwise re-enter at the top bucket).
			if (rect.bottom <= 0 || rect.top >= vh) {
				speed = 0
				lastT = 0
				return
			}
			const span = Math.max(1, rect.height - vh)
			const p = Math.min(1, Math.max(0, -rect.top / span))

			const next = Math.min(STEPS - 1, Math.floor(p * STEPS))
			if (next !== stepRef.current) {
				stepRef.current = next
				setStep(next)
			}

			// Wheel SPEED → marquee speed. A per-event delta cannot work here:
			// Lenis turns one wheel notch into a dozen rAF-sized increments, so the
			// velocity has to be integrated over time. Peak-hold, not a sum: an
			// accumulator that decayed AND added every frame converged to ~12x the
			// real speed and pinned every arm to the top bucket. Quantised into four
			// buckets so the rate write stays rare, and the loop keeps ticking above
			// the rest bucket so one fast flick settles back instead of leaving the
			// marquee permanently racing. Thresholds are the measured px/s of a
			// deliberate wheel (peak ~380) against a hard one (peak ~11,300).
			const now = performance.now()
			const y = window.scrollY
			if (lastT !== 0) {
				const dt = Math.min(120, Math.max(1, now - lastT))
				const inst = (Math.abs(y - lastY) / dt) * 1000
				speed = Math.max(inst, speed * Math.pow(0.9, dt / 16.7))
			}
			lastT = now
			lastY = y
			write(speed > 2600 ? 3 : speed > 1100 ? 2 : speed > 300 ? 1 : 0)
			if (bucket > 0) schedule()
		}

		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(measure)
		}

		measure()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule, { passive: true })
		return () => {
			if (raf) cancelAnimationFrame(raf)
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
		}
	}, [reduced])

	const counter = `${String(step + 1).padStart(2, '0')} / ${String(STEPS).padStart(2, '0')}`
	const marqueeHalf = (key: string) => (
		<div key={key} aria-hidden="true" className="flex shrink-0">
			{[0, 1, 2].map((i) => (
				<span
					key={i}
					className="font-display text-text-faint/15 pr-24 text-[clamp(52px,10vw,140px)] leading-[0.9] font-bold tracking-[-0.04em] whitespace-nowrap"
				>
					{heading}
				</span>
			))}
		</div>
	)

	// Reduced motion: no pin, no 600svh of scroll, every step in normal flow and
	// fully readable.
	if (reduced) {
		return (
			<section className="border-border border-t py-24 sm:py-28">
				<div className="mx-auto w-[89%] max-w-6xl">
					<ol className="mt-14 flex flex-col gap-10">
						{STAGES.map((s, i) => (
							<li key={s.id} className="border-border border-l pl-6">
								<p className="text-accent font-mono text-[11px]">
									{String(i + 1).padStart(2, '0')}
								</p>
								<h3 className="font-display text-text mt-2 text-[24px] font-semibold tracking-[-0.02em]">
									{s.label}
								</h3>
								<p className="text-text-muted mt-1 text-[14px]">{s.sub}</p>
							</li>
						))}
					</ol>
				</div>
			</section>
		)
	}

	return (
		<div
			ref={wrapRef}
			className="border-border relative border-t"
			style={{ height: `${WRAP_SVH}svh` }}
		>
			<div className="sticky top-0 h-[100svh] overflow-hidden">
				{/* Heading marquee: the section's own title, cropped by the stage edge. */}
				<div className="absolute inset-x-0 bottom-0 z-0 overflow-hidden pb-4">
					<div ref={marqueeRef} className="v6-marquee">
						{marqueeHalf('a')}
						{marqueeHalf('b')}
					</div>
				</div>

				<div className="pointer-events-none absolute inset-0 z-10 mx-auto flex w-[89%] max-w-6xl items-center">
					<ol className="relative h-[42svh] w-full">
						{STAGES.map((s, i) => {
							const active = i === step
							return (
								<li
									key={s.id}
									aria-current={active ? 'step' : undefined}
									className="ease-expo absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center text-center transition-[opacity,transform] duration-[var(--motion-slow)]"
									style={{
										opacity: active ? 1 : 0,
										transform: `translate3d(0, calc(-50% + ${active ? 0 : i < step ? -30 : 30}px), 0)`
									}}
								>
									<p className="text-accent font-mono text-[11px] tracking-[0.3em]">
										{String(i + 1).padStart(2, '0')}
									</p>
									<h3 className="font-display text-text mt-4 text-[clamp(30px,5.6vw,62px)] leading-[1.02] font-bold tracking-[-0.035em]">
										{s.label}
									</h3>
									<p className="text-text-muted mt-4 max-w-xl text-[13.5px] leading-[1.6] sm:text-[15px]">
										{s.sub}
									</p>
								</li>
							)
						})}
					</ol>
				</div>

				<div className="text-text-faint absolute top-8 left-[5.5%] z-20 font-mono text-[11px] tracking-[0.18em]">
					<span aria-hidden="true">{counter}</span>
				</div>

				<div className="absolute bottom-10 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
					{STAGES.map((s, i) => (
						<span
							key={s.id}
							aria-hidden="true"
							className={`ease-expo h-1.5 rounded-full transition-[width,background-color] duration-[var(--motion-base)] ${
								i === step ? 'bg-accent w-8' : i < step ? 'bg-accent/45 w-3' : 'bg-border w-3'
							}`}
						/>
					))}
				</div>
			</div>
		</div>
	)
}
