// Model Pool output validation (M4) — PURE. Weak/free models are the ones most
// likely to wrap JSON in prose, emit a trailing comma, or return a 200 with blank
// content (the Phase 0 trap). This module is the gate that keeps unvalidated model
// output OUT of the evidence store and the Decision Bus fallbacks (brief §4):
// extract JSON defensively, validate against a zod schema, attempt ONE bounded
// repair, and report honestly when the output is unusable so the caller retries once
// then fails over — never fabricating a value to avoid an error.
//
// Generalizes the proven defensive pattern already in
// src/lib/agentos-benchmark/judge-parse.ts (greedy + balanced extraction, honest
// null, never a fabricated 0), but schema-driven and repair-aware so any structured
// step can reuse it. Zod ^4.

import type { z } from 'zod'

export type StructuredOk<T> = { ok: true; data: T; repaired: boolean }
export type StructuredErr = { ok: false; issues: string[]; raw: string }
export type StructuredResult<T> = StructuredOk<T> | StructuredErr

function tryParse(slice: string): unknown | null {
	try {
		return JSON.parse(slice) as unknown
	} catch {
		return null
	}
}

// Index of the first JSON structural open ('{' or '['), or -1.
function firstOpen(text: string): number {
	const obj = text.indexOf('{')
	const arr = text.indexOf('[')
	if (obj === -1) return arr
	if (arr === -1) return obj
	return Math.min(obj, arr)
}

// Pull a JSON value (object or array) out of a string that may carry prose or a
// ```json fence around it. Scans from the first structural open to its matching
// close, tracking string literals + escapes so a brace inside a string value never
// breaks the match. Falls back to the greedy first-open..last-close slice. Returns
// null when nothing parses — an honest "no JSON here", never a guessed value.
export function extractJson(text: string): unknown | null {
	if (typeof text !== 'string') return null
	const trimmed = text.trim()
	if (trimmed === '') return null

	// Fast path: the whole payload is already valid JSON.
	const direct = tryParse(trimmed)
	if (direct !== null) return direct

	const start = firstOpen(trimmed)
	if (start === -1) return null
	const open = trimmed[start]
	const close = open === '{' ? '}' : ']'

	let depth = 0
	let inString = false
	let escaped = false
	for (let i = start; i < trimmed.length; i++) {
		const ch = trimmed[i]
		if (inString) {
			if (escaped) escaped = false
			else if (ch === '\\') escaped = true
			else if (ch === '"') inString = false
			continue
		}
		if (ch === '"') {
			inString = true
			continue
		}
		if (ch === open) depth++
		else if (ch === close) {
			depth--
			if (depth === 0) {
				const parsed = tryParse(trimmed.slice(start, i + 1))
				if (parsed !== null) return parsed
				// Didn't parse — keep scanning; a later balanced match may.
			}
		}
	}

	// Greedy fallback: first open to the last matching close (handles a single value
	// whose interior contains the close char inside a string).
	const last = trimmed.lastIndexOf(close)
	if (last > start) {
		const parsed = tryParse(trimmed.slice(start, last + 1))
		if (parsed !== null) return parsed
	}
	return null
}

// ONE bounded, conservative repair pass. Only fixes that cannot change a valid
// payload's meaning: strip Markdown code fences and remove trailing commas before a
// closing brace/bracket (the two most common small-model defects). Returns the
// repaired string, or null when nothing would change (so the caller knows a repair
// retry is pointless). Deliberately does NOT touch quotes, casing, or inner content
// — a "repair" that rewrites data is a fabrication.
export function repairJson(text: string): string | null {
	if (typeof text !== 'string') return null
	let s = text
	s = s.replace(/```(?:json|javascript|js)?/gi, '')
	s = s.replace(/,(\s*[}\]])/g, '$1')
	s = s.trim()
	return s === text ? null : s
}

function issuesOf(error: z.ZodError): string[] {
	return error.issues.map((issue) => {
		const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
		return `${path}${issue.message}`
	})
}

// Validate raw model text against a zod schema. Tries the text as-is first; on a
// parse or schema failure, attempts exactly one repair pass and re-validates.
// `repaired: true` on success records that the model's first output was unusable and
// only a repair saved it — surfaced so a model that constantly needs repair can be
// demoted. Never invents data: an unusable payload returns ok:false with the real
// zod issues (or "no JSON found"), so the caller retries once then fails over.
export function validateStructured<T>(
	text: string,
	schema: z.ZodType<T>
): StructuredResult<T> {
	const first = extractJson(text)
	if (first !== null) {
		const result = schema.safeParse(first)
		if (result.success) return { ok: true, data: result.data, repaired: false }
		// Parsed but failed the schema — a repair of the same text won't add missing
		// fields, so report the real issues.
		return { ok: false, issues: issuesOf(result.error), raw: text }
	}

	// No JSON extracted as-is: try the bounded repair once.
	const repairedText = repairJson(text)
	if (repairedText !== null) {
		const second = extractJson(repairedText)
		if (second !== null) {
			const result = schema.safeParse(second)
			if (result.success) return { ok: true, data: result.data, repaired: true }
			return { ok: false, issues: issuesOf(result.error), raw: text }
		}
	}

	return { ok: false, issues: ['no JSON object or array found in model output'], raw: text }
}

// Convenience for the free-model blank-content trap: a 200 whose body is empty or
// whitespace is NOT success. Callers classify this as `empty-output` and fail over.
export function isBlankOutput(text: string): boolean {
	return typeof text !== 'string' || text.trim().length === 0
}
