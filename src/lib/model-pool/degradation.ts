// Model Pool degradation ladder (M5) — PURE. Turns what actually happened during a
// run into a single honest level L0–L5 plus a human reason, so the UI can show it
// and the answer can carry an uncertainty note (brief §6). The ladder is monotonic:
// a run's level is the WORST signal reached across its steps and its team/verification
// reductions — never an average that would hide a failure.
//
//   L0 preferred models available (no failover, no tier downgrade)
//   L1 some failover WITHIN the same tier (a premium step still served by premium)
//   L2 free models REPLACED premium for some steps (tier downgrade)
//   L3 reduced team and/or reduced verification due to limits
//   L4 partial answer with explicit gaps (some step never served)
//   L5 honest failure — no trustworthy answer, with what was tried
//
// Nothing here calls a model; it assesses structures the executor already has, so it
// is unit-tested at $0.

import type { DegradationLevel, ModelTier } from './types'

export type StepDegradation = {
	stepId: string
	// The tier the chain head wanted (Jev's premium target, or pool policy's pick).
	// null when the step had no tier preference.
	preferredTier: ModelTier | null
	// The tier that actually served the step; null when the step never succeeded.
	servedTier: ModelTier | null
	// Whether the step produced a usable output at all.
	served: boolean
	// Number of model_failover hops this step took (0 = the head candidate served).
	failoverHops: number
}

export type RunDegradationInput = {
	steps: readonly StepDegradation[]
	// Fewer agents ran than the plan called for (a limit forced a smaller team).
	teamReduced: boolean
	// Cross-check / verification was skipped or weakened because of limits.
	verificationReduced: boolean
	// The final answer was produced but carries explicit gaps.
	partialAnswer: boolean
	// No trustworthy answer could be produced at all.
	honestFailure: boolean
	// What was attempted, for the L5 message (slugs tried, failure kinds).
	tried?: readonly string[]
}

export type StepLevel = { stepId: string; level: DegradationLevel }

export type DegradationAssessment = {
	level: DegradationLevel
	reason: string
	steps: StepLevel[]
	// True when most served steps were downgraded to free — drives the answer's
	// uncertainty note ("produced mostly by degraded models").
	mostlyDegraded: boolean
}

// The level a single step contributes.
export function stepLevel(step: StepDegradation): DegradationLevel {
	if (!step.served) {
		// An unserved step is a gap in the answer: L4. (Whether the whole run is an
		// honest L5 failure is decided at the run level from `honestFailure`.)
		return 4
	}
	// A premium step served by a free model is a tier downgrade -> L2, regardless of
	// how many hops it took (the downgrade dominates the same-tier failover signal).
	if (step.preferredTier === 'premium' && step.servedTier === 'free') return 2
	// Otherwise, any failover within the same tier -> L1.
	if (step.failoverHops > 0) return 1
	return 0
}

// True when a step was served by a weaker model than it preferred (the "degraded"
// set used for the mostly-degraded uncertainty note).
function isStepDegraded(step: StepDegradation): boolean {
	return step.served && step.preferredTier === 'premium' && step.servedTier === 'free'
}

const LEVEL_LABELS: Record<DegradationLevel, string> = {
	0: 'L0: preferred models available',
	1: 'L1: same-tier failover',
	2: 'L2: free models replaced premium',
	3: 'L3: reduced team / verification',
	4: 'L4: partial answer with gaps',
	5: 'L5: failure with the reason stated'
}

export function degradationLabel(level: DegradationLevel): string {
	return LEVEL_LABELS[level]
}

export function isDegraded(level: DegradationLevel): boolean {
	return level > 0
}

// Assess a whole run. The level is the MAX of every signal, so the worst thing that
// happened is what is reported — a single L4 gap is never averaged away by ten L0
// steps, and an honest failure is always L5.
export function assessDegradation(input: RunDegradationInput): DegradationAssessment {
	const stepLevels: StepLevel[] = input.steps.map((s) => ({
		stepId: s.stepId,
		level: stepLevel(s)
	}))

	// An honest failure dominates everything: L5.
	if (input.honestFailure) {
		const tried = input.tried && input.tried.length > 0 ? input.tried.join(', ') : 'no candidates'
		return {
			level: 5,
			reason: `L5: no trustworthy answer produced. Tried: ${tried}.`,
			steps: stepLevels,
			mostlyDegraded: false
		}
	}

	let level: DegradationLevel = 0
	const reasons: string[] = []

	function raise(to: DegradationLevel, why: string): void {
		if (to > level) level = to
		reasons.push(why)
	}

	// Step-derived signals (L1/L2/L4).
	let downgraded = 0
	let servedCount = 0
	for (const step of input.steps) {
		if (step.served) servedCount++
		if (isStepDegraded(step)) downgraded++
		const sl = stepLevel(step)
		if (sl === 4) raise(4, `${step.stepId} never served (gap)`)
		else if (sl === 2) raise(2, `${step.stepId} served by a free model instead of premium`)
		else if (sl === 1) raise(1, `${step.stepId} failed over within its tier`)
	}

	// Team / verification reductions (L3). A reduction is a real degradation even if
	// every step that DID run was fine.
	if (input.teamReduced) raise(3, 'reduced team (fewer agents than planned)')
	if (input.verificationReduced) raise(3, 'reduced verification (cross-check skipped/weakened)')

	// A partial answer is at least L4.
	if (input.partialAnswer) raise(4, 'partial answer with explicit gaps')

	const mostlyDegraded = servedCount > 0 && downgraded * 2 > servedCount

	if (level === 0) {
		return {
			level: 0,
			reason: 'L0: every step served by its preferred model, no failover.',
			steps: stepLevels,
			mostlyDegraded: false
		}
	}

	// Build a concise reason: lead with the level label, then the contributing signals
	// (deduped, capped so a big run does not produce a paragraph).
	const unique = [...new Set(reasons)].slice(0, 4)
	const suffix = mostlyDegraded ? ' Answer produced mostly by degraded (free) models.' : ''
	return {
		level,
		reason: `${LEVEL_LABELS[level]}: ${unique.join('; ')}.${suffix}`,
		steps: stepLevels,
		mostlyDegraded
	}
}

// The uncertainty note appended to a final answer when it was produced under
// degradation. Honest and specific; empty when the run was clean (L0).
export function uncertaintyNote(assessment: DegradationAssessment): string {
	if (assessment.level === 0) return ''
	if (assessment.level === 5) {
		return 'This query could not be answered trustworthily with the models available. Nothing was fabricated; see what was tried above.'
	}
	const parts: string[] = [`Degradation ${LEVEL_LABELS[assessment.level]}.`]
	if (assessment.mostlyDegraded) {
		parts.push(
			'Most of this answer was produced by weaker free models after premium models were unavailable or rate-limited, so treat it with extra scrutiny.'
		)
	}
	if (assessment.level === 4) {
		parts.push(
			'Some steps could not be served, so this answer has explicit gaps rather than being complete.'
		)
	}
	if (assessment.level === 3) {
		parts.push(
			'The team and/or verification was reduced due to model limits, so cross-checking was weaker than normal.'
		)
	}
	return parts.join(' ')
}
