import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createVerificationReplanPolicy, type GateDecider } from './replan-policy'
import { createMemoryEvidence } from '@/lib/evidence'
import { validatePlan } from '@/lib/orchestra/plan'
import { RESEARCH_TOOL } from '@/lib/mcp/research'
import { CALCULATOR_TOOL } from '@/lib/mcp/calculator'
import type { DecisionRecord, SufficiencyDecision, ValidityDecision } from '@/lib/decisions/types'
import type { Plan, PlanStep, ReplanContext } from '@/lib/orchestra/types'

// The verification replan policy is pure (the bus + hub are injected); these tests
// prove the D4 gate sequencing, the §12 escalation skip, the D5 delta selection, and
// that every delta it emits is a well-formed merged plan (the same validatePlan the
// executor runs before adopting a delta). No live Jev, no DB, $0.

const REGISTRIES = {
	agents: {
		answerer: { name: 'answerer', run: async () => ({ ok: true }) },
		researcher: { name: 'researcher', run: async () => ({ ok: true }) },
		code: { name: 'code', run: async () => ({ ok: true }) },
		critic: { name: 'critic', run: async () => ({ ok: true }) },
		synthesizer: { name: 'synthesizer', run: async () => ({ ok: true }) }
	},
	models: { has: (m: string) => ['claude', 'gpt', 'gemini'].includes(m) },
	tools: {
		has: (t: string) => t === RESEARCH_TOOL || t === CALCULATOR_TOOL,
		call: async () => ({ ok: true, output: null })
	}
}

function record<T>(kind: DecisionRecord['kind'], output: T): DecisionRecord<T> {
	return {
		kind,
		runId: 'run-1',
		inputSummary: 'summary',
		output,
		decidedBy: 'jev',
		confidence: 0.9,
		latencyMs: 10,
		at: 0,
		rationale: 'test'
	}
}

// A mock gate decider with programmable verdicts + call tracking.
function mockGates(opts: { enough: boolean; valid?: boolean }): GateDecider & {
	sufficiencyCalls: string[]
	validityCalls: string[]
} {
	const sufficiencyCalls: string[] = []
	const validityCalls: string[] = []
	return {
		sufficiencyCalls,
		validityCalls,
		async decideEvidenceSufficiency(input): Promise<SufficiencyDecision> {
			sufficiencyCalls.push(input.state)
			return { enough: opts.enough, record: record('evidence_sufficiency', { enough: opts.enough }) }
		},
		async decideEvidenceValidity(input): Promise<ValidityDecision> {
			validityCalls.push(input.state)
			const valid = opts.valid ?? true
			return { valid, record: record('evidence_validity', { valid }) }
		}
	}
}

// A minimal ReplanContext: the policy only reads ctx.run.plan.steps.
function ctxWith(steps: PlanStep[]): ReplanContext {
	const run = {
		id: 'run-1',
		query: 'q',
		status: 'running' as const,
		plan: { steps } as Plan,
		stepStates: {},
		shared: {},
		usage: { costMicroUsd: 0, modelCalls: 0, toolCalls: 0, replans: 0, startedAt: 0 },
		startedAt: 0,
		finishedAt: null,
		finalAnswer: null,
		error: null
	}
	return { run, completedSteps: steps, failedSteps: [] }
}

function basePlan(): PlanStep[] {
	return [
		{ id: 'researcher', agent: 'researcher', model: 'gemini', toolsAllowed: [RESEARCH_TOOL], inputs: {}, dependsOn: [], critical: false },
		{ id: 'critic', agent: 'critic', model: 'claude', toolsAllowed: [], inputs: {}, dependsOn: ['researcher'], critical: false },
		{ id: 'synthesizer', agent: 'synthesizer', model: 'gpt', toolsAllowed: [], inputs: { workerIds: ['researcher', 'critic'] }, dependsOn: ['researcher', 'critic'], critical: true }
	]
}

test('§12 escalation: a medium-tier run never calls a gate and never replans', async () => {
	const gates = mockGates({ enough: false })
	const policy = createVerificationReplanPolicy({
		gates,
		evidence: createMemoryEvidence(),
		runId: 'run-1',
		query: 'q',
		complexityTier: 'medium'
	})
	const delta = await policy(ctxWith(basePlan()))
	assert.equal(delta, null)
	assert.equal(gates.sufficiencyCalls.length, 0)
	assert.equal(gates.validityCalls.length, 0)
})

test('gate 1 insufficient -> research delta; gate 2 is not consulted', async () => {
	const gates = mockGates({ enough: false })
	const streamed: DecisionRecord[] = []
	const policy = createVerificationReplanPolicy({
		gates,
		evidence: createMemoryEvidence(),
		runId: 'run-1',
		query: 'Best index sharding?',
		complexityTier: 'hard',
		leadModel: 'gpt',
		onDecision: (r) => streamed.push(r)
	})
	const delta = await policy(ctxWith(basePlan()))
	assert.ok(delta)
	assert.deepEqual(
		delta.add.map((s) => s.id),
		['researcher_r1', 'synthesizer_r1']
	)
	assert.match(delta.reason, /evidence_insufficient/)
	assert.equal(gates.validityCalls.length, 0, 'validity gate skipped once sufficiency fails')
	assert.equal(streamed.length, 1)
	assert.equal(streamed[0]!.kind, 'evidence_sufficiency')
	assert.equal(validatePlan({ steps: [...basePlan(), ...delta.add] } as Plan, REGISTRIES).ok, true)
})

test('gate 1 enough + gate 2 invalid -> rework delta (critic + synthesizer)', async () => {
	const gates = mockGates({ enough: true, valid: false })
	const policy = createVerificationReplanPolicy({
		gates,
		evidence: createMemoryEvidence(),
		runId: 'run-1',
		query: 'q',
		complexityTier: 'very_hard',
		leadModel: 'claude'
	})
	const delta = await policy(ctxWith(basePlan()))
	assert.ok(delta)
	assert.deepEqual(
		delta.add.map((s) => s.id),
		['critic_r1', 'synthesizer_r1']
	)
	assert.match(delta.reason, /evidence_invalid/)
	assert.equal(gates.sufficiencyCalls.length, 1)
	assert.equal(gates.validityCalls.length, 1)
	assert.equal(validatePlan({ steps: [...basePlan(), ...delta.add] } as Plan, REGISTRIES).ok, true)
})

test('both gates pass -> null (finalize, no delta)', async () => {
	const gates = mockGates({ enough: true, valid: true })
	const policy = createVerificationReplanPolicy({
		gates,
		evidence: createMemoryEvidence(),
		runId: 'run-1',
		query: 'q',
		complexityTier: 'hard'
	})
	const delta = await policy(ctxWith(basePlan()))
	assert.equal(delta, null)
	assert.equal(gates.sufficiencyCalls.length, 1)
	assert.equal(gates.validityCalls.length, 1)
})

test('the gate state reflects the real evidence hub', async () => {
	const evidence = createMemoryEvidence()
	await evidence.add({ claim: 'Shard by hash key.', source: 'https://a.example', discoveredByAgent: 'researcher' })
	await evidence.add({ claim: 'Ranges suit time series.', source: null, discoveredByAgent: 'researcher', verificationStatus: 'contested' })
	const gates = mockGates({ enough: true, valid: true })
	const policy = createVerificationReplanPolicy({
		gates,
		evidence,
		runId: 'run-1',
		query: 'How to shard an index?',
		complexityTier: 'hard'
	})
	await policy(ctxWith(basePlan()))
	const state = gates.sufficiencyCalls[0]!
	assert.match(state, /How to shard an index\?/)
	assert.match(state, /Evidence claims: 2 \(verified 0, contested 1, refuted 0, unverified 1\)/)
	assert.match(state, /Shard by hash key\./)
})

test('successive insufficient verdicts produce unique step ids (r1, r2)', async () => {
	const gates = mockGates({ enough: false })
	const policy = createVerificationReplanPolicy({
		gates,
		evidence: createMemoryEvidence(),
		runId: 'run-1',
		query: 'q',
		complexityTier: 'hard'
	})
	const first = await policy(ctxWith(basePlan()))
	assert.ok(first)
	const afterFirst = [...basePlan(), ...first.add]
	const second = await policy(ctxWith(afterFirst))
	assert.ok(second)
	assert.deepEqual(
		second.add.map((s) => s.id),
		['researcher_r2', 'synthesizer_r2']
	)
	const merged: Plan = { steps: [...afterFirst, ...second.add] }
	const ids = merged.steps.map((s) => s.id)
	assert.equal(new Set(ids).size, ids.length)
	assert.equal(validatePlan(merged, REGISTRIES).ok, true)
})
