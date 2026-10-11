'use client'
import { cn } from '@/lib/cn'
import { useInView } from '@/components/motion/reveal'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'

// "The Gathering" (V4 §4, closing CTA): the words of the headline fly in from
// the left and right edges of the *viewport*, alternating, and meet in the
// middle. The flight starts a full half-viewport plus the line's own offset off
// to the side, so the first word genuinely enters from off-screen rather than
// sliding a few pixels; the settle uses the house spring curve, whose control
// point passes through 1.56 — that overshoot is the collision, and each landing
// nudges the type past its slot and back. One beat after the last word lands,
// the whole line takes the impact (a 1.2% scale pulse) so the meeting reads as
// an event instead of twelve independent tweens.
//
// Transform + opacity only. The words are in the DOM at their final positions
// before anything moves, so LCP and the heading outline are untouched, and the
// reduced-motion branch renders the settled line with no transform at all.
export function GatherWords({
	text,
	className,
	wordClassName,
	stagger = 90,
	reach = 62
}: {
	text: string
	className?: string
	wordClassName?: string
	stagger?: number
	// vw the words travel in from; ±(reach + the word's own offset from centre).
	reach?: number
}) {
	const reduced = useReducedMotion()
	const [ref, inView] = useInView<HTMLSpanElement>(0.4)
	const shown = reduced || inView
	const words = text.split(' ')
	const mid = (words.length - 1) / 2

	return (
		<span
			ref={ref}
			data-t4="gather"
			className={cn('inline-block', !reduced && inView && 'gather-impact', className)}
			style={
				!reduced && inView
					? { animationDelay: `${(words.length - 1) * stagger + 620}ms` }
					: undefined
			}
		>
			{words.map((w, i) => {
				// Alternate sides, and lead the outer words first so the line closes
				// from both ends toward the centre.
				const side = i % 2 === 0 ? -1 : 1
				const from = side * (reach + Math.abs(i - mid) * 6)
				const delay = Math.abs(i - mid) * stagger
				return (
					<span
						key={i}
						className={cn('ease-gather inline-block whitespace-pre', wordClassName)}
						style={{
							transform: shown ? 'none' : `translateX(${from}vw) rotate(${side * 4}deg)`,
							opacity: shown ? 1 : 0,
							transitionDuration: shown ? '980ms' : '0ms',
							transitionDelay: shown ? `${delay}ms` : '0ms'
						}}
					>
						{w}{' '}
						{/* trailing space is the word break; the line's text content has
						    to stay the sentence, not "WelcometoFirst…" */}
					</span>
				)
			})}
		</span>
	)
}
