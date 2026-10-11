'use client'
import gsap from 'gsap'
import { splitWords } from '@/lib/motion/split-text'
import { useIntroReady } from '@/lib/motion/intro-gate'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { useEffect, useRef } from 'react'

// Subheadline choreography (V4 §3.3): the hero winner gets a per-LETTER effect,
// so the line under it must not repeat that — it sharpens word by word out of
// blur, left to right. Contrast, not repetition, which is exactly the rule §3.3
// gives for choosing it.
//
// Words (not characters) also keep the sentence readable while it assembles, and
// `splitWords` preserves the spaces as their own elements: without them the
// accessible name would read "WatchJevassemble…" (the same trap the line-mask
// reveal documents).
export function HeroSubhead({
	text,
	className,
	lead = 0
}: {
	text: string
	className?: string
	// Seconds to wait after the hero letters have landed.
	lead?: number
}) {
	const reduced = useReducedMotion()
	const ready = useIntroReady()
	const ref = useRef<HTMLParagraphElement>(null)

	useEffect(() => {
		if (reduced || !ready) return
		const host = ref.current
		if (!host) return
		const words = Array.from(host.querySelectorAll<HTMLElement>('[data-word]'))
		if (words.length === 0) return
		const tween = gsap.fromTo(
			words,
			{ opacity: 0, filter: 'blur(8px)' },
			{
				opacity: 1,
				filter: 'blur(0px)',
				duration: 0.55,
				stagger: 0.07,
				delay: lead,
				ease: 'power2.out',
				clearProps: 'filter'
			}
		)
		return () => {
			tween.kill()
			gsap.set(words, { clearProps: 'all' })
		}
	}, [reduced, ready, lead])

	const parts = splitWords(text)

	if (reduced) {
		return <p className={className}>{text}</p>
	}

	return (
		<p ref={ref} className={className}>
			{parts.map((part, i) =>
				/^\s+$/.test(part) ? (
					<span key={i}> </span>
				) : (
					<span key={i} data-word="" className="inline-block">
						{part}
					</span>
				)
			)}
		</p>
	)
}
