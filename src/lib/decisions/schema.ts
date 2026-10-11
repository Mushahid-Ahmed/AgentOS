// Decision Bus output validation (§11: "Validate every output against a schema.
// On invalid output/timeout/error: use a documented fallback, flag it,
// continue."). Each helper turns a raw Jev answer into a validated, typed output
// or returns null — null is the bus's signal to fall back to policy for THAT
// decision. Nothing here throws; an out-of-vocab label is a normal, expected
// outcome (Jev is free-tier and its labels are only as good as the criteria we
// send), not an error.

import { z } from 'zod'
import { COMPLEXITY_TIERS, TASK_TYPES, type JevAnswerView } from './types'

export const taskTypeSchema = z.enum(TASK_TYPES)
export const complexityTierSchema = z.enum(COMPLEXITY_TIERS)
export const yesNoSchema = z.enum(['yes', 'no'])
export const booleanFlagSchema = z.boolean()

// Parse a Jev `choice` answer against a schema. Returns the typed value, or null
// when the answer is missing, not a choice, or its label fails the schema. The
// confidence is validated separately (finite 0..1) by the bus, not here.
function parseChoice<T>(answer: JevAnswerView | undefined, schema: z.ZodType<T>): T | null {
	if (!answer || typeof answer.choice !== 'string') return null
	const parsed = schema.safeParse(answer.choice)
	return parsed.success ? parsed.data : null
}

export function parseTaskType(answer: JevAnswerView | undefined): z.infer<typeof taskTypeSchema> | null {
	return parseChoice(answer, taskTypeSchema)
}

export function parseComplexityTier(
	answer: JevAnswerView | undefined
): z.infer<typeof complexityTierSchema> | null {
	return parseChoice(answer, complexityTierSchema)
}

// A yes/no needs_* answer -> boolean. null when invalid so the caller can apply
// its own default rather than silently reading a malformed answer as "no".
export function parseYesNo(answer: JevAnswerView | undefined): boolean | null {
	const value = parseChoice(answer, yesNoSchema)
	if (value === null) return null
	return value === 'yes'
}

// A gate answer over {yes,no} / {enough,insufficient} / {valid,invalid} /
// {pass,rework}. Jev's label vocabulary for a gate is whatever criteria we send,
// so each gate has its own two-label schema; the positive label maps to true.
export function parseBinaryGate(
	answer: JevAnswerView | undefined,
	positive: string,
	negative: string
): boolean | null {
	const schema = z.enum([positive, negative] as [string, string])
	const value = parseChoice(answer, schema)
	if (value === null) return null
	return value === positive
}

// Confidence coercion: a finite number clamped to 0..1, else null (so the record
// stores null rather than a fabricated 0 that looks like a real measurement).
export function parseConfidence(answer: JevAnswerView | undefined): number | null {
	if (!answer) return null
	const c = answer.confidence
	if (typeof c !== 'number' || !Number.isFinite(c)) return null
	return Math.min(1, Math.max(0, c))
}
