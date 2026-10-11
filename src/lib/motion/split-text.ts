// Pure text-splitting helpers for the reveal + proximity-glow primitives
// (UI/UX run UX-D5: a local util instead of the `split-type` dependency).
// They return plain data (arrays of strings) so the React components own the
// DOM and can add the accessibility twins (sr-only full text + aria-hidden
// split spans) themselves.

// Split into words, preserving the spaces as separate entries so re-joining is
// lossless: ["Cut"," ","to"," ","the"," ","song."]
export function splitWords(text: string): string[] {
	return text.split(/(\s+)/).filter((part) => part.length > 0)
}

// Split into lines is not knowable without layout, so line-mask reveals take
// explicit lines from the caller (the author controls where lines break), and
// the proximity glow splits into words first so a line break can never land
// mid-word.

// Distance falloff for the proximity glow: 1 at the cursor, 0 at `radius`.
// Smoothstep so glyphs ease in/out rather than popping at the radius edge.
export function proximityFactor(distance: number, radius: number): number {
	if (radius <= 0) return 0
	const t = Math.min(1, Math.max(0, distance / radius))
	const inv = 1 - t
	return inv * inv * (3 - 2 * inv)
}
