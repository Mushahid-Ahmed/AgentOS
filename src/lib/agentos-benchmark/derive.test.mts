import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveAgentosOutcome } from './derive'
import type { RunFrame } from '@/lib/agentos/sse'

// deriveAgentosOutcome folds the production AgentOS SSE frames into the benchmark's
// measured metrics via the SAME reducer the D6 run view uses. These tests assert the
// honesty rules: a success requires a completed phase AND a non-empty answer; a
// budget-stop or failure is recorded with its real error, never counted as ok; the
// nightly-cap refusal is flagged so the engine can hard-stop; evidence counts reflect
// each claim's FINAL status (no double-count).

const f = (name: string, data: unknown): RunFrame => ({ name, data })

// A full, happy research run: two evidence rows (one verified, one contested), a
// replan, real cost, a final answer with two citations, then the terminal status.
function completedFrames(): RunFrame[] {
	return [
		f('run', { runId: '90', taskType: 'research', tier: 'hard', executionMode: 'multi_agent', agents: ['researcher', 'synthesizer'], modelByAgent: { researcher: 'gemini', synthesizer: 'claude' }, deferred: [] }),
		f('run_started', { runId: '90', query: 'q', at: 1000 }),
		f('plan_created', { runId: '90', plan: { steps: [{ id: 'researcher' }, { id: 'synthesizer' }] }, at: 1001 }),
		f('status', { runId: '90', status: 'running', at: 1002 }),
		f('evidence_added', { runId: '90', evidenceId: '1', source: 'https://a.example', discoveredByAgent: 'researcher', at: 1003 }),
		f('evidence_added', { runId: '90', evidenceId: '2', source: 'https://b.example', discoveredByAgent: 'researcher', at: 1004 }),
		f('evidence_verified', { runId: '90', evidenceId: '1', status: 'verified', at: 1005 }),
		f('evidence_verified', { runId: '90', evidenceId: '2', status: 'contested', at: 1006 }),
		f('cost_update', { runId: '90', costMicroUsd: 12000, modelCalls: 2, toolCalls: 1, at: 1007 }),
		f('replan', { runId: '90', reason: 'evidence gap', addedSteps: ['researcher_r1'], replans: 1, at: 1008 }),
		f('cost_update', { runId: '90', costMicroUsd: 43300, modelCalls: 4, toolCalls: 2, at: 1009 }),
		f('final', { runId: '90', answer: 'The answer, with sources.', citations: ['https://a.example', 'https://b.example'], at: 1010 }),
		f('status', { runId: '90', status: 'completed', at: 1011 })
	]
}

test('deriveAgentosOutcome: a completed run yields ok with real measured metrics', () => {
	const out = deriveAgentosOutcome(completedFrames())
	assert.equal(out.ok, true)
	assert.equal(out.nightlyCap, false)
	assert.equal(out.answer, 'The answer, with sources.')
	assert.equal(out.error, null)
	assert.equal(out.citations, 2)
	assert.equal(out.verifiedClaims, 1)
	assert.equal(out.contestedClaims, 1)
	assert.equal(out.refutedClaims, 0)
	// The LAST cost_update wins (cumulative), not the first.
	assert.equal(out.costMicroUsd, 43300)
	assert.equal(out.modelCalls, 4)
	assert.equal(out.toolCalls, 2)
	assert.equal(out.replans, 1)
})

test('deriveAgentosOutcome: a re-verified claim counts its FINAL status once', () => {
	const frames = [
		...completedFrames().slice(0, 8),
		// Claim 1 moves verified -> refuted; it must be counted refuted, not both.
		f('evidence_verified', { runId: '90', evidenceId: '1', status: 'refuted', at: 1020 }),
		...completedFrames().slice(9)
	]
	const out = deriveAgentosOutcome(frames)
	assert.equal(out.verifiedClaims, 0)
	assert.equal(out.contestedClaims, 1)
	assert.equal(out.refutedClaims, 1)
})

test('deriveAgentosOutcome: a failed run is not ok and keeps its real error', () => {
	const frames = [
		f('run_started', { runId: '91', query: 'q', at: 1 }),
		f('status', { runId: '91', status: 'running', at: 2 }),
		f('error', { runId: '91', message: 'critical_step_failed', at: 3 }),
		f('status', { runId: '91', status: 'failed', at: 4 })
	]
	const out = deriveAgentosOutcome(frames)
	assert.equal(out.ok, false)
	assert.equal(out.answer, null)
	assert.equal(out.error, 'critical_step_failed')
	assert.equal(out.nightlyCap, false)
})

test('deriveAgentosOutcome: a budget_stopped run with a partial answer is NOT ok', () => {
	const frames = [
		f('run_started', { runId: '92', query: 'q', at: 1 }),
		f('status', { runId: '92', status: 'running', at: 2 }),
		f('cost_update', { runId: '92', costMicroUsd: 500000, modelCalls: 9, toolCalls: 3, at: 3 }),
		f('final', { runId: '92', answer: 'Partial answer before the cap.', citations: [], at: 4 }),
		f('error', { runId: '92', message: 'budget_stopped: max_cost', at: 5 }),
		f('status', { runId: '92', status: 'budget_stopped', at: 6 })
	]
	const out = deriveAgentosOutcome(frames)
	assert.equal(out.ok, false)
	assert.equal(out.answer, 'Partial answer before the cap.')
	assert.match(out.error ?? '', /budget_stopped/)
	// The real spend is still recorded even though the run did not complete.
	assert.equal(out.costMicroUsd, 500000)
})

test('deriveAgentosOutcome: a final answer with no terminal completed status is not ok', () => {
	// The stream emitted `final` but the connection ended before `status: completed`.
	const frames = [
		f('run_started', { runId: '93', query: 'q', at: 1 }),
		f('final', { runId: '93', answer: 'An answer.', citations: [], at: 2 })
	]
	const out = deriveAgentosOutcome(frames)
	assert.equal(out.ok, false)
	assert.equal(out.nightlyCap, false)
})

test('deriveAgentosOutcome: the nightly-cap refusal is flagged for a hard stop', () => {
	const frames = [f('error', { message: 'Nightly spend cap reached (10 USD).', code: 'nightly_cap' })]
	const out = deriveAgentosOutcome(frames)
	assert.equal(out.nightlyCap, true)
	assert.equal(out.ok, false)
	assert.equal(out.answer, null)
})

test('deriveAgentosOutcome: empty frames are an honest non-completion, never a throw', () => {
	const out = deriveAgentosOutcome([])
	assert.equal(out.ok, false)
	assert.equal(out.answer, null)
	assert.equal(out.citations, 0)
	assert.equal(out.costMicroUsd, 0)
	assert.equal(out.nightlyCap, false)
	assert.ok(typeof out.error === 'string')
})

test('deriveAgentosOutcome: a completed run with an empty answer is not ok', () => {
	const frames = [
		f('run_started', { runId: '94', query: 'q', at: 1 }),
		f('final', { runId: '94', answer: '   ', citations: [], at: 2 }),
		f('status', { runId: '94', status: 'completed', at: 3 })
	]
	const out = deriveAgentosOutcome(frames)
	assert.equal(out.ok, false)
	assert.equal(out.answer, null)
})
