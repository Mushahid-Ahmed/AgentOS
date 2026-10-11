// Shared helpers for the Take 4 hero variants.

// The fluid shader's palette is the site's own accent tokens, so the particles
// are the same blue/purple the background already mixes — read live, so a theme
// change is picked up without a rebuild.
//
// No fallback literals: they used to disagree with the tokens they named (the
// sky and violet left over from an earlier palette), so a missing token would
// have painted colours this file cannot see. globals.css owns every value.
export function heroPalette(): string[] {
	const style = getComputedStyle(document.documentElement)
	const read = (token: string) => style.getPropertyValue(token).trim()
	return [read('--accent'), read('--series-2'), read('--series-3')]
}

// SplitText wraps whitespace in its own elements; those are layout glue, not
// glyphs, so choreography (and the character budget) counts visible marks only.
export function isGlyph(el: HTMLElement): boolean {
	return /\S/.test(el.textContent ?? '')
}

export const glyphsOf = (els: HTMLElement[]) => els.filter(isGlyph)
