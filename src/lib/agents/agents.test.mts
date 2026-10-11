import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildAgentPlan, isLeadRole } from './plan'
import { CALCULATOR_TOOL } from '@/lib/mcp/calculator'
import { RESEARCH_TOOL } from '@/lib/mcp/research'
import type { PlanDecision } from '@/lib/decisions/types'

// The plan builder is pure; these tests pin the DAG shape the executor relies on
// (workers fan out, the lead depends on all created workers and is critical) and
// the honest-deferral rule for roles Jev picked but this milestone hasn't built.

function decision(overrides: Partial<PlanDecision> = {}): PlanDecision {
	return {
		taskType: 'research',
		complexityTier: 'hard',
		agents: ['researcher', 'critic', 'synthesizer'],
		executionMode: 'parallel',
		modelByAgent: { researcher: 'gemini', critic: 'claude', synthesizer: 'gpt' },
		records: [],
		...overrides
	}
}

test('simple path: a lone answerer is one non-dependent critical step', () => {
	const { plan, deferred } = buildAgentPlan({
		decision: decision({
			taskType: 'simple',
			complexityTier: 'simple',
			agents: ['answerer'],
			executionMode: 'sequential',
			modelByAgent: { answerer: 'gemini' }
		}),
		registered: ['answerer', 'synthesizer']
	})

	assert.equal(deferred.length, 0)
	assert.equal(plan.steps.length, 1)
	const step = plan.steps[0]!
	assert.equal(step.id, 'answerer')
	assert.equal(step.model, 'gemini')
	assert.deepEqual(step.dependsOn, [])
	assert.equal(step.critical, true)
	assert.deepEqual(step.toolsAllowed, [])
})

test('team path: primaries fan out, the verifier waits on them, the lead waits on all', () => {
	const { plan, deferred } = buildAgentPlan({
		decision: decision(),
		registered: ['researcher', 'critic', 'synthesizer']
	})

	assert.equal(deferred.length, 0)
	const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s]))
	// The researcher is a primary worker: no deps, and it carries the research-sonar grant.
	assert.deepEqual(byId.researcher!.dependsOn, [])
	assert.deepEqual(byId.researcher!.toolsAllowed, [RESEARCH_TOOL])
	assert.equal(byId.researcher!.critical, false)
	// The critic is a VERIFIER: it depends on the primary workers so it fact-checks
	// evidence that has actually been gathered, and it needs no tool (it reads the hub).
	assert.deepEqual(byId.critic!.dependsOn, ['researcher'])
	assert.deepEqual(byId.critic!.toolsAllowed, [])
	// The lead waits on every worker (primaries + verifier) and is critical.
	assert.deepEqual(byId.synthesizer!.dependsOn, ['researcher', 'critic'])
	assert.equal(byId.synthesizer!.critical, true)
	// The lead is handed the exact worker ids to read from shared context.
	assert.deepEqual(byId.synthesizer!.inputs, { workerIds: ['researcher', 'critic'] })
	// Per-agent model routing is preserved onto each step.
	assert.equal(byId.researcher!.model, 'gemini')
	assert.equal(byId.critic!.model, 'claude')
	assert.equal(byId.synthesizer!.model, 'gpt')
})

test('unregistered roles are deferred and excluded from the lead dependencies', () => {
	// M3 registers only the lead roles; researcher + critic are not built yet.
	const { plan, deferred } = buildAgentPlan({
		decision: decision(),
		registered: ['synthesizer']
	})

	assert.deepEqual(deferred, ['researcher', 'critic'])
	assert.equal(plan.steps.length, 1)
	const synth = plan.steps[0]!
	assert.equal(synth.id, 'synthesizer')
	// No workers were created, so the lead waits on nothing.
	assert.deepEqual(synth.dependsOn, [])
	assert.deepEqual(synth.inputs, { workerIds: [] })
})

test('data path: a code worker is granted the calculator tool, the lead depends on it', () => {
	const { plan, deferred } = buildAgentPlan({
		decision: decision({
			taskType: 'data',
			complexityTier: 'medium',
			agents: ['code', 'synthesizer'],
			executionMode: 'sequential',
			modelByAgent: { code: 'gpt', synthesizer: 'gpt' }
		}),
		registered: ['code', 'synthesizer']
	})

	assert.equal(deferred.length, 0)
	const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s]))
	// The code worker carries the calculator grant; the lead carries none.
	assert.deepEqual(byId.code!.toolsAllowed, [CALCULATOR_TOOL])
	assert.deepEqual(byId.synthesizer!.toolsAllowed, [])
	// The worker fans out first (no deps); the lead waits on it and is critical.
	assert.deepEqual(byId.code!.dependsOn, [])
	assert.equal(byId.code!.critical, false)
	assert.deepEqual(byId.synthesizer!.dependsOn, ['code'])
	assert.equal(byId.synthesizer!.critical, true)
})

test('isLeadRole distinguishes leads from workers', () => {
	assert.equal(isLeadRole('synthesizer'), true)
	assert.equal(isLeadRole('answerer'), true)
	assert.equal(isLeadRole('researcher'), false)
	assert.equal(isLeadRole('code'), false)
	assert.equal(isLeadRole('critic'), false)
})
