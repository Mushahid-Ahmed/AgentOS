import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	assessDegradation,
	degradationLabel,
	isDegraded,
	stepLevel,
	uncertaintyNote,
	type RunDegradationInput,
	type StepDegradation
} from './degradation'

// Pure degradation-ladder tests ($0, fixed inputs).

function step(over: Partial<StepDegradation> & { stepId: string }): StepDegradation {
	return {
		preferredTier: 'premium',
		servedTier: 'premium',
		served: true,
		failoverHops: 0,
		...over
	}
}

function base(over: Partial<RunDegradationInput> = {}): RunDegradationInput {
	return {
		steps: [],
		teamReduced: false,
		verificationReduced: false,
		partialAnswer: false,
		honestFailure: false,
		...over
	}
}

test('stepLevel: clean premium step -> L0', () => {
	assert.equal(stepLevel(step({ stepId: 'a' })), 0)
})

test('stepLevel: same-tier failover -> L1', () => {
	assert.equal(stepLevel(step({ stepId: 'a', failoverHops: 2 })), 1)
})

test('stepLevel: premium replaced by free -> L2 (dominates hops)', () => {
	assert.equal(stepLevel(step({ stepId: 'a', servedTier: 'free', failoverHops: 1 })), 2)
})

test('stepLevel: a free-preferred step served by free is NOT degraded -> L0', () => {
	assert.equal(stepLevel(step({ stepId: 'a', preferredTier: 'free', servedTier: 'free' })), 0)
})

test('stepLevel: an upgrade (free preferred, premium served) is not degraded -> L0', () => {
	assert.equal(stepLevel(step({ stepId: 'a', preferredTier: 'free', servedTier: 'premium' })), 0)
})

test('stepLevel: unserved step -> L4 (a gap)', () => {
	assert.equal(stepLevel(step({ stepId: 'a', served: false, servedTier: null })), 4)
})

test('assessDegradation: a clean run is L0 with no uncertainty note', () => {
	const a = assessDegradation(base({ steps: [step({ stepId: 'a' }), step({ stepId: 'b' })] }))
	assert.equal(a.level, 0)
	assert.equal(a.mostlyDegraded, false)
	assert.equal(uncertaintyNote(a), '')
})

test('assessDegradation: one same-tier failover -> L1', () => {
	const a = assessDegradation(
		base({ steps: [step({ stepId: 'a' }), step({ stepId: 'b', failoverHops: 1 })] })
	)
	assert.equal(a.level, 1)
	assert.ok(a.reason.includes('L1'))
	assert.ok(isDegraded(a.level))
})

test('assessDegradation: premium->free downgrade -> L2', () => {
	const a = assessDegradation(
		base({ steps: [step({ stepId: 'a' }), step({ stepId: 'b', servedTier: 'free' })] })
	)
	assert.equal(a.level, 2)
	assert.equal(a.mostlyDegraded, false, '1 of 2 served is not "mostly"')
})

test('assessDegradation: worst signal wins (L1 + L2 -> L2)', () => {
	const a = assessDegradation(
		base({
			steps: [step({ stepId: 'a', failoverHops: 1 }), step({ stepId: 'b', servedTier: 'free' })]
		})
	)
	assert.equal(a.level, 2)
})

test('assessDegradation: team reduction -> L3 even when every step is clean', () => {
	const a = assessDegradation(base({ steps: [step({ stepId: 'a' })], teamReduced: true }))
	assert.equal(a.level, 3)
	assert.ok(a.reason.includes('reduced team'))
})

test('assessDegradation: reduced verification -> L3', () => {
	const a = assessDegradation(base({ steps: [step({ stepId: 'a' })], verificationReduced: true }))
	assert.equal(a.level, 3)
	assert.ok(uncertaintyNote(a).includes('verification was reduced'))
})

test('assessDegradation: an unserved step (gap) -> L4', () => {
	const a = assessDegradation(
		base({ steps: [step({ stepId: 'a' }), step({ stepId: 'b', served: false, servedTier: null })] })
	)
	assert.equal(a.level, 4)
	assert.ok(uncertaintyNote(a).includes('explicit gaps'))
})

test('assessDegradation: partialAnswer flag -> at least L4', () => {
	const a = assessDegradation(base({ steps: [step({ stepId: 'a' })], partialAnswer: true }))
	assert.equal(a.level, 4)
})

test('assessDegradation: honestFailure dominates everything -> L5', () => {
	const a = assessDegradation(
		base({
			steps: [step({ stepId: 'a', served: false, servedTier: null })],
			partialAnswer: true,
			teamReduced: true,
			honestFailure: true,
			tried: ['claude-sonnet-4.5 (402)', 'gpt-4.1 (402)', 'qwen3:free (empty-output)']
		})
	)
	assert.equal(a.level, 5)
	assert.ok(a.reason.includes('no trustworthy answer'))
	assert.ok(a.reason.includes('qwen3:free'))
	assert.ok(uncertaintyNote(a).includes('could not be answered trustworthily'))
})

test('assessDegradation: mostlyDegraded when >=half of served steps were downgraded', () => {
	const a = assessDegradation(
		base({
			steps: [
				step({ stepId: 'a', servedTier: 'free' }),
				step({ stepId: 'b', servedTier: 'free' }),
				step({ stepId: 'c', servedTier: 'premium' })
			]
		})
	)
	assert.equal(a.level, 2)
	assert.equal(a.mostlyDegraded, true)
	assert.ok(uncertaintyNote(a).includes('weaker free models'))
})

test('assessDegradation: empty steps with no signals is L0', () => {
	assert.equal(assessDegradation(base()).level, 0)
})

test('degradationLabel: every level has a human label', () => {
	assert.equal(degradationLabel(0), 'L0: preferred models available')
	assert.equal(degradationLabel(5), 'L5: failure with the reason stated')
})

test('isDegraded: L0 is clean, L1+ is degraded', () => {
	assert.equal(isDegraded(0), false)
	assert.equal(isDegraded(1), true)
	assert.equal(isDegraded(5), true)
})
