import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DecisionBus } from './bus'
import { PLAN_QUESTION } from './questions'
import {
	SUFFICIENCY_QUESTION,
	VALIDITY_QUESTION,
	CONTRADICTION_QUESTION,
	FINALIZATION_QUESTION
} from './questions'
import type { DecisionRecord, JevAnswerView, JevAskOutcome, JevQuestionsSpec } from './types'

// The Decision Bus is pure: the Jev transport is injected, so every test below
// runs against a MOCKED ask and costs $0. This is the §10 requirement (unit test
// the decision logic before wiring the real model) applied to §11.

// Build a successful Jev outcome from a map of question-key -> choice/confidence.
function jevOk(
	choices: Record<string, { choice: string; confidence?: number }>,
	latencyMs = 560
): JevAskOutcome {
	const answers: Record<string, JevAnswerView> = {}
	for (const [key, value] of Object.entries(choices)) {
		answers[key] = {
			type: 'choice',
			choice: value.choice,
			confidence: value.confidence ?? 0.5,
			probabilities: { [value.choice]: 1 }
		}
	}
	return { ok: true, answers, latencyMs, attempts: 1 }
}

function jevFail(error = 'jev_http_429', latencyMs = 120): JevAskOutcome {
	return { ok: false, error, latencyMs, attempts: 9 }
}

// A mock ask that returns a fixed outcome and records the calls it received.
function mockAsk(outcome: JevAskOutcome | ((state: string, q: JevQuestionsSpec) => JevAskOutcome)) {
	const calls: Array<{ state: string; questions: JevQuestionsSpec }> = []
	const ask = async (state: string, questions: JevQuestionsSpec): Promise<JevAskOutcome> => {
		calls.push({ state, questions })
		return typeof outcome === 'function' ? outcome(state, questions) : outcome
	}
	return { ask, calls }
}

// Capture persisted records so we can assert the sink fires per decision.
function recorder() {
	const records: DecisionRecord[] = []
	return { records, sink: (r: DecisionRecord) => void records.push(r) }
}

const fixedClock = () => 1_700_000_000_000

test('planRun: a full valid Jev batch yields jev-decided task/complexity/team/model', async () => {
	const { ask, calls } = mockAsk(
		jevOk({
			[PLAN_QUESTION.taskType]: { choice: 'research', confidence: 0.58 },
			[PLAN_QUESTION.complexity]: { choice: 'hard', confidence: 0.74 },
			[PLAN_QUESTION.needsResearch]: { choice: 'yes', confidence: 0.9 },
			[PLAN_QUESTION.needsCode]: { choice: 'no', confidence: 0.8 },
			[PLAN_QUESTION.needsCritic]: { choice: 'yes', confidence: 0.6 },
			[PLAN_QUESTION.bestModel]: { choice: 'claude', confidence: 0.5 }
		})
	)
	const { records, sink } = recorder()
	const bus = new DecisionBus({ ask, now: fixedClock, record: sink })

	const plan = await bus.planRun({ runId: 'r1', query: 'Investigate why signup conversion dropped.' })

	// ONE batched call for the whole planning pass (throttle discipline, §1b).
	assert.equal(calls.length, 1)
	assert.equal(plan.taskType, 'research')
	assert.equal(plan.complexityTier, 'hard')
	// research -> researcher, needsCritic/hard -> critic, plus the synthesizer lead.
	assert.deepEqual(plan.agents, ['researcher', 'critic', 'synthesizer'])
	// Lead model is Jev's best_model; non-lead agents use role defaults.
	assert.equal(plan.modelByAgent.synthesizer, 'claude')
	assert.equal(plan.modelByAgent.researcher, 'gemini')
	assert.equal(plan.modelByAgent.critic, 'claude')

	// Five planning records, each decided_by jev except execution_mode (a
	// deterministic function of the DAG shape -> honestly policy).
	assert.equal(plan.records.length, 5)
	const byKind = Object.fromEntries(plan.records.map((r) => [r.kind, r]))
	assert.equal(byKind.task_type.decidedBy, 'jev')
	assert.equal(byKind.complexity.decidedBy, 'jev')
	assert.equal(byKind.required_agents.decidedBy, 'jev')
	assert.equal(byKind.model_selection.decidedBy, 'jev')
	assert.equal(byKind.execution_mode.decidedBy, 'policy')
	// 2 independent work agents -> parallel fan-out.
	assert.equal(byKind.execution_mode.output, 'parallel')

	// The sink fired once per record.
	assert.equal(records.length, 5)
	// Every record carries the batch latency, run id, and a timestamp.
	for (const r of plan.records) {
		assert.equal(r.runId, 'r1')
		assert.equal(r.at, fixedClock())
	}
	assert.equal(byKind.task_type.latencyMs, 560)
	// execution_mode is a local rule, not a Jev hop -> 0 latency, null confidence.
	assert.equal(byKind.execution_mode.latencyMs, 0)
	assert.equal(byKind.execution_mode.confidence, null)
	// Jev confidence is preserved for jev decisions.
	assert.equal(byKind.complexity.confidence, 0.74)
})

test('planRun: a trivially simple question uses ONE agent and ONE model, no team', async () => {
	const { ask } = mockAsk(
		jevOk({
			[PLAN_QUESTION.taskType]: { choice: 'simple' },
			[PLAN_QUESTION.complexity]: { choice: 'simple' },
			[PLAN_QUESTION.needsResearch]: { choice: 'no' },
			[PLAN_QUESTION.needsCode]: { choice: 'no' },
			[PLAN_QUESTION.needsCritic]: { choice: 'no' },
			[PLAN_QUESTION.bestModel]: { choice: 'gemini' }
		})
	)
	const bus = new DecisionBus({ ask, now: fixedClock })

	const plan = await bus.planRun({ runId: 'r2', query: 'What is the capital of France?' })

	assert.deepEqual(plan.agents, ['answerer'])
	assert.deepEqual(Object.keys(plan.modelByAgent), ['answerer'])
	assert.equal(plan.modelByAgent.answerer, 'gemini')
	assert.equal(plan.executionMode, 'sequential')
})

test('planRun: a total Jev outage falls back to policy for every decision', async () => {
	const { ask } = mockAsk(jevFail('timeout'))
	const { records, sink } = recorder()
	const bus = new DecisionBus({ ask, now: fixedClock, record: sink })

	// A coding-shaped query the keyword classifier catches.
	const plan = await bus.planRun({ runId: 'r3', query: 'Fix the bug in my TypeScript function that throws.' })

	const byKind = Object.fromEntries(plan.records.map((r) => [r.kind, r]))
	assert.equal(byKind.task_type.decidedBy, 'policy')
	assert.equal(byKind.task_type.output, 'coding')
	assert.equal(byKind.complexity.decidedBy, 'policy')
	assert.equal(byKind.required_agents.decidedBy, 'policy')
	assert.equal(byKind.model_selection.decidedBy, 'policy')
	// Policy still produces a runnable plan (never stalls at planning).
	assert.ok(plan.agents.includes('code'))
	assert.equal(plan.agents[plan.agents.length - 1], 'synthesizer')
	// Rationale names the failure so the UI/benchmark can see why it degraded.
	assert.match(byKind.task_type.rationale ?? '', /timeout/)
	assert.equal(records.length, 5)
})

test('planRun: partial invalid answers fall back to policy per-decision only', async () => {
	const { ask } = mockAsk(
		jevOk({
			// Valid task_type + best_model...
			[PLAN_QUESTION.taskType]: { choice: 'comparison', confidence: 0.6 },
			[PLAN_QUESTION.bestModel]: { choice: 'gpt', confidence: 0.55 },
			// ...but an OUT-OF-VOCAB complexity label and a missing needs_* answer.
			[PLAN_QUESTION.complexity]: { choice: 'impossible_tier' },
			[PLAN_QUESTION.needsResearch]: { choice: 'yes' }
			// needsCode + needsCritic absent entirely.
		})
	)
	const bus = new DecisionBus({ ask, now: fixedClock })

	const plan = await bus.planRun({ runId: 'r4', query: 'Compare Postgres and MySQL for our workload.' })

	const byKind = Object.fromEntries(plan.records.map((r) => [r.kind, r]))
	// task_type + model_selection came from Jev...
	assert.equal(byKind.task_type.decidedBy, 'jev')
	assert.equal(byKind.model_selection.decidedBy, 'jev')
	// ...complexity fell back (invalid label)...
	assert.equal(byKind.complexity.decidedBy, 'policy')
	// ...and the team is policy because not all three needs_* were in-vocab.
	assert.equal(byKind.required_agents.decidedBy, 'policy')
	// comparison forces a researcher even though the team is policy-assembled.
	assert.ok(plan.agents.includes('researcher'))
})

test('planRun: an out-of-vocab best_model drops model_selection to policy', async () => {
	const { ask } = mockAsk(
		jevOk({
			[PLAN_QUESTION.taskType]: { choice: 'data' },
			[PLAN_QUESTION.complexity]: { choice: 'medium' },
			[PLAN_QUESTION.needsResearch]: { choice: 'no' },
			[PLAN_QUESTION.needsCode]: { choice: 'yes' },
			[PLAN_QUESTION.needsCritic]: { choice: 'no' },
			// 'llama' is not one of claude|gpt|gemini -> not a valid lead model.
			[PLAN_QUESTION.bestModel]: { choice: 'llama' }
		})
	)
	const bus = new DecisionBus({ ask, now: fixedClock })

	const plan = await bus.planRun({ runId: 'r5', query: 'Calculate the compound interest on 5000 over 3 years.' })

	const byKind = Object.fromEntries(plan.records.map((r) => [r.kind, r]))
	assert.equal(byKind.model_selection.decidedBy, 'policy')
	// A data task always routes the code agent; the lead falls back to the default.
	assert.equal(plan.modelByAgent.code, 'gpt')
	assert.ok(['claude', 'gpt', 'gemini'].includes(plan.modelByAgent.synthesizer))
})

test('gate 1: Jev "insufficient" -> enough:false, decided_by jev', async () => {
	const { ask, calls } = mockAsk(jevOk({ [SUFFICIENCY_QUESTION]: { choice: 'insufficient', confidence: 0.95 } }))
	const bus = new DecisionBus({ ask, now: fixedClock })

	const decision = await bus.decideEvidenceSufficiency({ runId: 'g1', state: 'Only one source so far.' })

	assert.equal(calls.length, 1)
	assert.equal(decision.enough, false)
	assert.equal(decision.record.decidedBy, 'jev')
	assert.equal(decision.record.kind, 'evidence_sufficiency')
	assert.equal(decision.record.confidence, 0.95)
	assert.deepEqual(decision.record.output, { enough: false })
})

test('gate 1: Jev failure -> policy default (proceed), flagged policy', async () => {
	const { ask } = mockAsk(jevFail('jev_http_429'))
	const bus = new DecisionBus({ ask, now: fixedClock })

	const decision = await bus.decideEvidenceSufficiency({ runId: 'g2', state: 'x' })

	// A Jev outage must not trap the run in an endless research loop -> default enough.
	assert.equal(decision.enough, true)
	assert.equal(decision.record.decidedBy, 'policy')
	assert.equal(decision.record.confidence, null)
	assert.match(decision.record.rationale ?? '', /429/)
})

test('gate 2: Jev "invalid" -> valid:false; contradiction + finalization map correctly', async () => {
	const bus = new DecisionBus({
		now: fixedClock,
		ask: async (_state, questions) => {
			// Answer based on which gate question was asked.
			if (VALIDITY_QUESTION in questions) return jevOk({ [VALIDITY_QUESTION]: { choice: 'invalid', confidence: 0.7 } })
			if (CONTRADICTION_QUESTION in questions) return jevOk({ [CONTRADICTION_QUESTION]: { choice: 'yes', confidence: 0.8 } })
			if (FINALIZATION_QUESTION in questions) return jevOk({ [FINALIZATION_QUESTION]: { choice: 'rework', confidence: 0.6 } })
			return jevFail('unexpected_question')
		}
	})

	const validity = await bus.decideEvidenceValidity({ runId: 'g3', state: 'Claims conflict.' })
	assert.equal(validity.valid, false)
	assert.deepEqual(validity.record.output, { valid: false })

	const contradiction = await bus.decideContradiction({ runId: 'g3', state: 'A says up, B says down.' })
	assert.equal(contradiction.contradiction, true)
	assert.deepEqual(contradiction.record.output, { contradiction: true })

	const finalization = await bus.decideFinalization({ runId: 'g3', state: 'Weak answer.' })
	assert.equal(finalization.pass, false)
	assert.deepEqual(finalization.record.output, { pass: false })
	assert.equal(finalization.record.decidedBy, 'jev')
})

test('gate: an invalid Jev label falls back to the documented policy default', async () => {
	const { ask } = mockAsk(jevOk({ [FINALIZATION_QUESTION]: { choice: 'maybe' } }))
	const bus = new DecisionBus({ ask, now: fixedClock })

	const decision = await bus.decideFinalization({ runId: 'g4', state: 'x' })

	// 'maybe' is neither pass nor rework -> policy default (pass/proceed).
	assert.equal(decision.pass, true)
	assert.equal(decision.record.decidedBy, 'policy')
	assert.match(decision.record.rationale ?? '', /invalid Jev label/)
})

test('input summary is bounded and non-secret (long queries are truncated)', async () => {
	const { ask } = mockAsk(jevFail('network'))
	const bus = new DecisionBus({ ask, now: fixedClock })

	const long = 'x'.repeat(5000)
	const plan = await bus.planRun({ runId: 'r6', query: long })

	for (const r of plan.records) {
		assert.ok(r.inputSummary.length <= 201, `summary too long: ${r.inputSummary.length}`)
	}
})
