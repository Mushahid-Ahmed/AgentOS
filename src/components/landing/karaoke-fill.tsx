'use client'

import { useScrub } from '@/lib/motion/use-scrub'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { splitWords } from '@/lib/motion/split-text'

// V6 Job 7 (§10): karaoke fill. The paragraph lights up word by word in reading
// order as it travels through the viewport, so the body copy is read rather than
// scanned.
//
// The sweep is a playhead over WORD ORDINAL, not over pixels: nothing is measured
// per word, so the cost is one arithmetic expression per word inside useScrub's
// existing rAF-throttled write, and a reflow can never desynchronise the light
// from the glyph. It also leaves the paragraph's layout identical to a plain <p>
// — only opacity changes, which is why it is safe to mount on copy that other
// layers already paint (§11's no-regression rule).
//
// Space characters stay raw text nodes between the word spans (splitWords returns
// them separately for exactly this reason): wrapping, and therefore the measured
// height of the paragraph, remains the browser's normal text layout.

const DIM = 0.25
// How much of the playhead a single word takes to reach full colour, counted in
// words. 2.5 are mid-transition at any instant, which reads as a travelling
// highlight instead of a hard edge.
const SPAN = 2.5

const isGap = (s: string) => /^\s+$/.test(s)

/** Each part of the text with the ordinal of the word it belongs to (gaps: -1). */
function plan(text: string) {
	const parts = splitWords(text)
	let word = -1
	const items = parts.map((part) => (isGap(part) ? { part, at: -1 } : { part, at: ++word }))
	return { items, words: word + 1 }
}

export function KaraokeFill({
	text,
	className,
	travel = 3.2
}: {
	text: string
	className?: string
	travel?: number
}) {
	const reduced = useReducedMotion()
	const [ref, p] = useScrub<HTMLParagraphElement>(travel)

	if (reduced) return <p className={className}>{text}</p>

	const { items, words } = plan(text)
	const step = SPAN / words
	// The playhead runs from half a step before the first word to half a step past
	// the last, so the block starts fully dim and ends fully lit instead of stopping
	// mid-transition at either edge.
	const g = p * (1 + step) - step / 2

	return (
		<p ref={ref} data-t6="karaoke" className={className}>
			{items.map(({ part, at }, k) =>
				at < 0 ? (
					<span key={k}> </span>
				) : (
					<span
						key={k}
						className="inline-block"
						style={{
							opacity: (
								DIM +
								(1 - DIM) * Math.min(1, Math.max(0, (g - (at + 0.5) / words + step / 2) / step))
							).toFixed(3)
						}}
					>
						{part}
					</span>
				)
			)}
		</p>
	)
}
