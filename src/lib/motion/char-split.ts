import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { useEffect, useLayoutEffect } from 'react'

gsap.registerPlugin(SplitText)

// Per-character splitting (Take 4, M1). GSAP 3.15 ships SplitText under its
// no-charge license and it is already in node_modules, so the brief's "do NOT
// use a paid SplitText plugin" is satisfied by the plugin itself — and its
// grapheme handling (Intl.Segmenter) is exactly the part a hand-rolled splitter
// gets wrong for emoji and combining marks. `aria: 'none'` keeps the plugin out
// of the accessibility tree; <SplitChars> owns that with an sr-only twin.

export type SplitUnit = {
	line: HTMLElement
	words: HTMLElement[]
	chars: HTMLElement[]
}

export type SplitInstance = {
	units: SplitUnit[]
	revert: () => void
}

export function splitChars(lineEls: HTMLElement[]): SplitInstance {
	const zipped = lineEls.map((line) => {
		const instance = new SplitText(line, { type: 'words,chars', aria: 'none', tag: 'span' })
		const chars = instance.chars as HTMLElement[]
		// SplitText emits plain spans, and a CSS transform does not apply to a
		// non-replaced inline box — the browser computes the matrix and moves
		// nothing, so a flight written straight to `el.style.transform` silently
		// animates only opacity. Every caller here transforms, so make the units
		// transformable once, up front. Measured: char rects are unchanged by it.
		for (const ch of chars) ch.style.display = 'inline-block'
		return {
			unit: {
				line,
				words: instance.words as HTMLElement[],
				chars
			},
			revert: () => instance.revert()
		}
	})
	return {
		units: zipped.map((entry) => entry.unit),
		revert: () => zipped.forEach((entry) => entry.revert())
	}
}

// The split and its initial transform state must land BEFORE the browser paints
// the hydrated markup, or the finished headline flashes for one frame and then
// jumps back to its start state. useLayoutEffect warns during SSR, which the
// console-clean gate would fail, so pick it per platform.
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
