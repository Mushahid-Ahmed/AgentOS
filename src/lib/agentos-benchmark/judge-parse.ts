// Pure parsing of the LLM judge's verdict (milestone 8). The rubric judge
// (src/server/ai/rubric-judge.ts) asks a model for ONLY a JSON object
// {score, unsupportedClaims, notes}; small/decorating models still wrap it in prose
// or code fences, so the extraction is defensive and total. Split out pure so the
// "never invent a score" logic is unit-tested at $0 with fixed strings, exactly like
// the M4 judge's parseLabel.
//
// Honesty rules:
//  - A missing/unparsable score yields null (the engine records the verdict as a
//    judge failure and the task simply isn't judged) — never a fabricated 0 or 0.5.
//  - `score` is clamped to [0,1]; `unsupportedClaims` to a non-negative integer.
//  - `unsupportedClaims` is the JUDGE'S ESTIMATE, labelled as such wherever shown.

export type ParsedVerdict = {
	// 0..1 rubric score.
	score: number
	// Judge-estimated count of claims in the answer with no supporting evidence.
	unsupportedClaims: number
	notes: string
}

function clamp01(value: number): number {
	if (value < 0) return 0
	if (value > 1) return 1
	return value
}

function tryParseObject(slice: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(slice)
		return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

// Pull a JSON object out of a string that may carry prose or a ```json fence around
// it. Two strategies, most-robust first: (1) the greedy slice from the first '{' to
// the last '}' — correct for a single object even when a brace sits inside a string
// value (e.g. notes); (2) a balanced-brace scan — correct for an object followed by
// trailing prose that itself contains a '}'. Returns null when neither parses.
function extractJsonObject(text: string): Record<string, unknown> | null {
	const first = text.indexOf('{')
	if (first === -1) return null
	const last = text.lastIndexOf('}')
	if (last > first) {
		const greedy = tryParseObject(text.slice(first, last + 1))
		if (greedy) return greedy
	}

	let depth = 0
	for (let i = first; i < text.length; i++) {
		const ch = text[i]
		if (ch === '{') depth++
		else if (ch === '}') {
			depth--
			if (depth === 0) {
				const balanced = tryParseObject(text.slice(first, i + 1))
				if (balanced) return balanced
			}
		}
	}
	return null
}

/**
 * Parse the judge's raw completion text into a verdict, or null when it carries no
 * usable score. A null is an honest "the judge did not produce a scorable verdict",
 * which the engine records as a judge failure rather than guessing a number.
 */
export function parseJudgeVerdict(text: string): ParsedVerdict | null {
	if (typeof text !== 'string' || text.trim().length === 0) return null
	const obj = extractJsonObject(text)
	if (!obj) return null

	const rawScore = obj.score
	if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return null

	const rawUnsupported = obj.unsupportedClaims
	const unsupportedClaims =
		typeof rawUnsupported === 'number' && Number.isFinite(rawUnsupported)
			? Math.max(0, Math.round(rawUnsupported))
			: 0

	const notes = typeof obj.notes === 'string' ? obj.notes.trim() : ''

	return { score: clamp01(rawScore), unsupportedClaims, notes }
}
