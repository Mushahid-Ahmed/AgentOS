import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	shouldRunGates,
	summarizeEvidenceState,
	refineResearchQuery,
	buildResearchDelta,
	buildReworkDelta
} from './replan'
import { buildAgentPlan } from './plan'
import { validatePlan } from '@/lib/orchestra/plan'
import { RESEARCH_TOOL } from '@/lib/mcp/research'
import { CALCULATOR_TOOL } from '@/lib/mcp/calculator'
import type { EvidenceView } from '@/lib/evidence'
import type { PlanDecision } from '@/lib/decisions/types'
import type { Plan, PlanStep } from '@/lib/orchestra/types'

// The replan helpers are pure; these tests pin the §12 escalation rule, the D4 gate
// input shape (it must reflect what was actually gathered, never invent claims), and
// the D5 delta shapes — unique ids, sound dependsOn, correct tool grants — proven
// well-formed by running each merged plan through the SAME validatePlan the executor
// uses before adopting a delta.

// A registry mirroring the real one (src/server/agents/index.ts) so validatePlan
// accepts every role/model/tool a delta can name.
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

function evidence(overrides: Partial<EvidenceView> = {}): EvidenceView {
	return {
		id: 'e1',
		claim: 'a claim',
		source: 'https://a.example',
		retrievedText: 'text',
		discoveredByAgent: 'researcher',
		verificationStatus: 'unverified',
		relation: 'supports',
		referencesEvidenceId: null,
		...overrides
	}
}

function hardResearchPlan(): PlanStep[] {
	const decision: PlanDecision = {
		taskType: 'research',
		complexityTier: 'hard',
		agents: ['researcher', 'critic', 'synthesizer'],
		executionMode: 'parallel',
		modelByAgent: { researcher: 'gemini', critic: 'claude', synthesizer: 'gpt' },
		records: []
	}
	return buildAgentPlan({ decision, registered: ['researcher', 'critic', 'synthesizer'] }).plan.steps
}

// ---- §12 escalation --------------------------------------------------------

test('shouldRunGates fires only at the hard tiers', () => {
	assert.equal(shouldRunGates('simple'), false)
	assert.equal(shouldRunGates('medium'), false)
	assert.equal(shouldRunGates('hard'), true)
	assert.equal(shouldRunGates('very_hard'), true)
})

// ---- D4 gate input ---------------------------------------------------------

test('summarizeEvidenceState reports real counts and never invents claims', () => {
	const state = summarizeEvidenceState({
		query: 'What caused the 2008 crisis?',
		rows: [
			evidence({ id: 'e1', claim: 'Subprime lending collapsed.', verificationStatus: 'verified', source: 'https://a.example' }),
			evidence({ id: 'e2', claim: 'Ratings were inflated.', verificationStatus: 'contested', relation: 'contradicts', source: null })
		]
	})
	assert.match(state, /Query: What caused the 2008 crisis\?/)
	assert.match(state, /Evidence claims: 2 \(verified 1, contested 1, refuted 0, unverified 0\)/)
	assert.match(state, /Contradictions flagged: 1/)
	assert.match(state, /\[verified\] Subprime lending collapsed\. \(source: https:\/\/a\.example\)/)
	assert.match(state, /\[contested\] Ratings were inflated\. \(no source\)/)
})

test('summarizeEvidenceState is honest when nothing was gathered', () => {
	const state = summarizeEvidenceState({ query: 'q', rows: [] })
	assert.match(state, /Evidence claims: 0/)
	assert.match(state, /No evidence recorded yet\./)
})

test('summarizeEvidenceState caps the claim sample', () => {
	const rows = Array.from({ length: 12 }, (_, i) => evidence({ id: `e${i}`, claim: `claim ${i}` }))
	const state = summarizeEvidenceState({ query: 'q', rows, maxClaims: 3 })
	assert.match(state, /Evidence claims: 12/)
	assert.match(state, /1\. \[unverified\] claim 0/)
	assert.match(state, /3\. \[unverified\] claim 2/)
	assert.doesNotMatch(state, /claim 3/)
})

// ---- D5 refined query ------------------------------------------------------

test('refineResearchQuery names prior coverage to target the gap', () => {
	const refined = refineResearchQuery({
		query: 'Best practices for index sharding?',
		rows: [evidence({ claim: 'Shard by hash key.' })]
	})
	assert.match(refined, /Best practices for index sharding\?/)
	assert.match(refined, /first pass covered: Shard by hash key\./)
	assert.match(refined, /ADDITIONAL authoritative sources/)
})

test('refineResearchQuery with no evidence asks for primary sources', () => {
	const refined = refineResearchQuery({ query: 'q', rows: [] })
	assert.match(refined, /^q \(find authoritative primary sources; no evidence gathered yet\)$/)
})

test('refineResearchQuery de-duplicates repeated coarse claims', () => {
	// The researcher's no-span fallback writes the same coarse claim once per URL,
	// so the raw rows repeat it; the refined query must list it once, not five times.
	const rows = [
		evidence({ id: 'e1', claim: 'Remote work has no single productivity effect.', source: 'https://a.example' }),
		evidence({ id: 'e2', claim: 'Remote work has no single productivity effect.', source: 'https://b.example' }),
		evidence({ id: 'e3', claim: 'Remote work has no single productivity effect.', source: 'https://c.example' }),
		evidence({ id: 'e4', claim: 'Hybrid schedules help retention.', source: 'https://d.example' })
	]
	const refined = refineResearchQuery({ query: 'q', rows })
	const occurrences = refined.split('Remote work has no single productivity effect.').length - 1
	assert.equal(occurrences, 1, 'the repeated claim appears once')
	assert.match(refined, /Hybrid schedules help retention\./)
})

// ---- D5 delta shapes -------------------------------------------------------

test('buildResearchDelta produces a valid merged plan with unique ids', () => {
	const existing = hardResearchPlan()
	const delta = buildResearchDelta({ replanIndex: 1, existing, leadModel: 'gpt', refinedQuery: 'dig deeper' })
	assert.deepEqual(
		delta.map((s) => s.id),
		['researcher_r1', 'synthesizer_r1']
	)
	const researcher = delta[0]!
	assert.equal(researcher.agent, 'researcher')
	assert.deepEqual(researcher.toolsAllowed, [RESEARCH_TOOL])
	assert.deepEqual(researcher.inputs, { query: 'dig deeper' })
	assert.deepEqual(researcher.dependsOn, [])
	const synth = delta[1]!
	assert.equal(synth.critical, true)
	assert.deepEqual(synth.dependsOn, ['researcher_r1'])
	// The follow-up synthesizer re-reads every worker, original + new.
	assert.deepEqual(synth.inputs, { workerIds: ['researcher', 'critic', 'researcher_r1'] })

	const merged: Plan = { steps: [...existing, ...delta] }
	const validation = validatePlan(merged, REGISTRIES)
	assert.equal(validation.ok, true, JSON.stringify(validation.ok ? validation.order : validation.issues))
})

test('buildReworkDelta adds a critic pass + synthesizer and validates', () => {
	const existing = hardResearchPlan()
	const delta = buildReworkDelta({ replanIndex: 1, existing, leadModel: 'claude' })
	assert.deepEqual(
		delta.map((s) => s.id),
		['critic_r1', 'synthesizer_r1']
	)
	const critic = delta[0]!
	assert.equal(critic.agent, 'critic')
	assert.equal(critic.model, 'claude')
	assert.deepEqual(critic.toolsAllowed, [])
	// Runs after the evidence exists.
	assert.deepEqual(critic.dependsOn, ['researcher'])
	const synth = delta[1]!
	assert.equal(synth.model, 'claude')
	assert.equal(synth.critical, true)
	assert.deepEqual(synth.dependsOn, ['critic_r1'])

	const merged: Plan = { steps: [...existing, ...delta] }
	assert.equal(validatePlan(merged, REGISTRIES).ok, true)
})

test('successive replans keep step ids unique across indexes', () => {
	const existing = hardResearchPlan()
	const first = buildResearchDelta({ replanIndex: 1, existing, refinedQuery: 'q1' })
	const afterFirst = [...existing, ...first]
	const second = buildResearchDelta({ replanIndex: 2, existing: afterFirst, refinedQuery: 'q2' })
	const merged: Plan = { steps: [...afterFirst, ...second] }
	const ids = merged.steps.map((s) => s.id)
	assert.equal(new Set(ids).size, ids.length, 'all step ids unique')
	assert.deepEqual(
		second.map((s) => s.id),
		['researcher_r2', 'synthesizer_r2']
	)
	assert.equal(validatePlan(merged, REGISTRIES).ok, true)
})

test('buildResearchDelta defaults the lead model when none is carried forward', () => {
	const delta = buildResearchDelta({ replanIndex: 1, existing: hardResearchPlan(), refinedQuery: 'q' })
	assert.equal(delta[1]!.model, 'gpt') // DEFAULT_LABEL
})
