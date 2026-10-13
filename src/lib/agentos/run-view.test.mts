import test from 'node:test'
import assert from 'node:assert/strict'
import {
	applyRunViewEvent,
	applyTerminalStatus,
	reduceRunViewEvents,
	initialRunViewState,
	isReplanStepId,
	renderGateQuote,
	renderDecisionAction,
	formatMicroUsd,
	formatMs,
	modelBadge,
	type RunViewState
} from './run-view'

// Fold a list of [name, data] frames from a starting state.
function fold(
	frames: ReadonlyArray<[string, unknown]>,
	initial: RunViewState = initialRunViewState()
): RunViewState {
	let state = initial
	for (const [name, data] of frames) state = applyRunViewEvent(state, name, data)
	return state
}

const RUN_INIT = {
	runId: '16',
	taskType: 'research',
	tier: 'very_hard',
	executionMode: 'parallel',
	agents: ['researcher', 'critic', 'synthesizer'],
	modelByAgent: { researcher: 'gemini', critic: 'claude', synthesizer: 'claude' },
	deferred: []
}

test('initial state is idle with zeroed counters', () => {
	const s = initialRunViewState()
	assert.equal(s.phase, 'idle')
	assert.equal(s.costMicroUsd, 0)
	assert.equal(s.evidence.claims, 0)
	assert.deepEqual(s.roster, [])
	assert.equal(s.latestGate, null)
})

test('run init seeds the D6 checklist (task / tier / agents / model routing)', () => {
	const s = fold([['run', RUN_INIT]])
	assert.equal(s.checklist.taskType, 'research')
	assert.equal(s.checklist.tier, 'very_hard')
	assert.equal(s.checklist.agentsSelected, 3)
	// gemini + claude + claude = 2 DISTINCT models.
	assert.equal(s.checklist.modelRouting, 2)
	assert.equal(s.tier, 'very_hard')
})

test('planning decisions refine the checklist with Jev confidence', () => {
	const s = fold([
		['run', RUN_INIT],
		['decision', { kind: 'complexity', output: 'very_hard', decidedBy: 'jev', confidence: 0.87, latencyMs: 700, at: 10 }],
		['decision', { kind: 'task_type', output: 'research', decidedBy: 'jev', confidence: 0.49, latencyMs: 700, at: 11 }]
	])
	assert.equal(s.checklist.complexityConfidence, 0.87)
	assert.equal(s.checklist.taskType, 'research')
	assert.equal(s.decisions.length, 2)
	// A planning decision is NOT a gate.
	assert.equal(s.latestGate, null)
})

test('plan_created seeds the whole roster as WAITING', () => {
	const s = fold([
		['run', RUN_INIT],
		['plan_created', { plan: { steps: [
			{ id: 'researcher', agent: 'researcher', model: 'gemini', toolsAllowed: ['research'], inputs: {}, dependsOn: [] },
			{ id: 'critic', agent: 'critic', model: 'claude', toolsAllowed: [], inputs: {}, dependsOn: ['researcher'] },
			{ id: 'synthesizer', agent: 'synthesizer', model: 'claude', toolsAllowed: [], inputs: {}, dependsOn: ['critic'], critical: true }
		] }, at: 20 }]
	])
	assert.equal(s.roster.length, 3)
	assert.deepEqual(s.roster.map((r) => r.status), ['waiting', 'waiting', 'waiting'])
	assert.equal(s.roster[0].model, 'gemini')
	assert.equal(s.roster.every((r) => r.replan === false), true)
})

test('agent_started → running, agent_finished → complete with real latency', () => {
	const s = fold([
		['plan_created', { plan: { steps: [{ id: 'researcher', agent: 'researcher', model: 'gemini', toolsAllowed: [], inputs: {}, dependsOn: [] }] }, at: 100 }],
		['agent_started', { stepId: 'researcher', agent: 'researcher', model: 'gemini', at: 1000 }],
		['agent_finished', { stepId: 'researcher', status: 'succeeded', result: { ok: true }, at: 1500 }]
	])
	const row = s.roster.find((r) => r.stepId === 'researcher')
	assert.equal(row?.status, 'complete')
	assert.equal(row?.latencyMs, 500)
})

test('a failed / skipped step maps to the right roster status', () => {
	const s = fold([
		['agent_started', { stepId: 'critic', agent: 'critic', model: 'claude', at: 1 }],
		['agent_finished', { stepId: 'critic', status: 'failed', result: null, at: 2 }],
		['agent_finished', { stepId: 'synth', status: 'skipped', result: null, at: 3 }]
	])
	assert.equal(s.roster.find((r) => r.stepId === 'critic')?.status, 'failed')
	assert.equal(s.roster.find((r) => r.stepId === 'synth')?.status, 'skipped')
})

test('evidence_added counts claims and DISTINCT sources (null source not counted)', () => {
	const s = fold([
		['evidence_added', { evidenceId: 'e1', source: 'https://a.example', discoveredByAgent: 'researcher', at: 1 }],
		['evidence_added', { evidenceId: 'e2', source: 'https://a.example', discoveredByAgent: 'researcher', at: 2 }],
		['evidence_added', { evidenceId: 'e3', source: 'https://b.example', discoveredByAgent: 'researcher', at: 3 }],
		['evidence_added', { evidenceId: 'e4', source: null, discoveredByAgent: 'researcher', at: 4 }]
	])
	assert.equal(s.evidence.claims, 4)
	assert.equal(s.evidence.sources, 2) // a.example + b.example; null is not a source
	assert.equal(s.evidence.unverified, 4)
})

test('evidence_verified moves a row and never double-counts on re-verification', () => {
	const s = fold([
		['evidence_added', { evidenceId: 'e1', source: 'https://a', discoveredByAgent: 'researcher', at: 1 }],
		['evidence_verified', { evidenceId: 'e1', status: 'verified', at: 2 }],
		['evidence_verified', { evidenceId: 'e1', status: 'contested', at: 3 }]
	])
	assert.equal(s.evidence.verified, 0)
	assert.equal(s.evidence.contested, 1)
	assert.equal(s.evidence.claims, 1)
})

test('evidence_verified for an unknown id is ignored (never invents a row)', () => {
	const s = fold([['evidence_verified', { evidenceId: 'ghost', status: 'verified', at: 1 }]])
	assert.equal(s.evidence.claims, 0)
	assert.equal(s.evidence.verified, 0)
})

test('contradiction_found increments the counter and records the marker', () => {
	const s = fold([
		['contradiction_found', { claim: 'A is true', againstClaim: 'A is false', at: 5 }]
	])
	assert.equal(s.evidence.contradictions, 1)
	assert.equal(s.contradictions.length, 1)
	assert.equal(s.contradictions[0].claim, 'A is true')
})

test('replan records the marker and surfaces spawned steps as WAITING replan rows', () => {
	const s = fold([
		['plan_created', { plan: { steps: [{ id: 'researcher', agent: 'researcher', model: 'gemini', toolsAllowed: [], inputs: {}, dependsOn: [] }] }, at: 1 }],
		['replan', { reason: 'evidence_insufficient: gate 1 asked for more research (replan 1).', addedSteps: ['researcher_r1', 'synthesizer_r1'], replans: 1, at: 9 }]
	])
	assert.equal(s.replans.length, 1)
	assert.equal(s.replans[0].index, 1)
	assert.deepEqual(s.replans[0].addedSteps, ['researcher_r1', 'synthesizer_r1'])
	const r1 = s.roster.find((r) => r.stepId === 'researcher_r1')
	assert.equal(r1?.status, 'waiting')
	assert.equal(r1?.replan, true)
	// The original step is NOT flagged as a replan row.
	assert.equal(s.roster.find((r) => r.stepId === 'researcher')?.replan, false)
})

test('cost_update threads real spend + call counts', () => {
	const s = fold([['cost_update', { costMicroUsd: 43300, modelCalls: 3, toolCalls: 2, at: 1 }]])
	assert.equal(s.costMicroUsd, 43300)
	assert.equal(s.modelCalls, 3)
	assert.equal(s.toolCalls, 2)
})

test('final sets phase complete with the answer + citations', () => {
	const s = fold([['final', { answer: '# Result', citations: ['https://a', 'https://b'], at: 1 }]])
	assert.equal(s.phase, 'complete')
	assert.equal(s.finalAnswer, '# Result')
	assert.deepEqual(s.citations, ['https://a', 'https://b'])
})

test('error sets phase failed; a budget_stopped status wins over the error phase', () => {
	const failed = fold([['error', { message: 'boom', at: 1 }]])
	assert.equal(failed.phase, 'failed')
	assert.equal(failed.error, 'boom')

	const budget = fold([
		['status', { status: 'budget_stopped', at: 1 }],
		['error', { message: 'budget_stopped: max_cost', at: 2 }]
	])
	assert.equal(budget.phase, 'budget_stopped')
})

test('elapsedMs is measured from run_started.at to the latest event at', () => {
	const s = fold([
		['run_started', { runId: '16', query: 'q', at: 1_000 }],
		['cost_update', { costMicroUsd: 1, modelCalls: 1, toolCalls: 0, at: 4_200 }]
	])
	assert.equal(s.startedAt, 1_000)
	assert.equal(s.elapsedMs, 3_200)
	assert.equal(s.query, 'q')
	assert.equal(s.phase, 'streaming')
})

test('a very_hard run with a gate + replan drives the JEV DECISION panel', () => {
	const s = fold([
		['run', RUN_INIT],
		['run_started', { runId: '16', query: 'compare things', at: 0 }],
		['decision', { kind: 'evidence_sufficiency', output: { enough: false }, decidedBy: 'jev', confidence: 0.77, latencyMs: 650, at: 5_000, rationale: 'only two primary sources' }],
		['replan', { reason: 'evidence_insufficient: Jev gate 1 asked for more research (replan 1).', addedSteps: ['researcher_r1', 'synthesizer_r1'], replans: 1, at: 5_100 }],
		['final', { answer: 'done', citations: [], at: 9_000 }]
	])
	assert.equal(s.latestGate?.kind, 'evidence_sufficiency')
	assert.equal(s.latestGate?.decidedBy, 'jev')
	assert.equal(renderGateQuote(s.latestGate), 'Enough evidence? NO: only two primary sources')
	const action = renderDecisionAction(s)
	assert.match(action, /spawn researcher_r1, synthesizer_r1/)
	assert.equal(s.phase, 'complete')
})

test('a medium run with no gates surfaces the §12 escalation honestly', () => {
	const s = fold([
		['run', { ...RUN_INIT, tier: 'medium' }],
		['decision', { kind: 'complexity', output: 'medium', decidedBy: 'jev', confidence: 0.53, latencyMs: 600, at: 1 }],
		['final', { answer: 'done', citations: [], at: 2 }]
	])
	assert.equal(s.latestGate, null)
	assert.match(renderDecisionAction(s), /below hard/)
	assert.match(renderDecisionAction(s), /medium/)
})

test('gate quote renders YES for a passing gate and omits a missing rationale', () => {
	const s = fold([
		['decision', { kind: 'evidence_validity', output: { valid: true }, decidedBy: 'jev', confidence: 0.9, latencyMs: 1, at: 1 }]
	])
	assert.equal(renderGateQuote(s.latestGate), 'Evidence valid? YES')
})

test('unknown and malformed frames never throw and leave state unchanged', () => {
	const base = fold([['run', RUN_INIT]])
	const same1 = applyRunViewEvent(base, 'totally_unknown_event', { at: 1 })
	assert.equal(same1.checklist.agentsSelected, base.checklist.agentsSelected)
	// A known event with a garbage payload is ignored, not crashed on.
	const same2 = applyRunViewEvent(base, 'evidence_added', { nonsense: true })
	assert.equal(same2.evidence.claims, 0)
	// A non-record payload is ignored.
	const same3 = applyRunViewEvent(base, 'final', null)
	assert.equal(same3.phase, base.phase)
})

test('reduceRunViewEvents folds a batch and counts events', () => {
	const s = reduceRunViewEvents([
		{ name: 'run', data: RUN_INIT },
		{ name: 'run_started', data: { runId: '16', query: 'q', at: 0 } },
		{ name: 'final', data: { answer: 'a', citations: [], at: 5 } }
	])
	assert.equal(s.eventCount, 3)
	assert.equal(s.phase, 'complete')
	assert.equal(s.query, 'q')
})

test('isReplanStepId recognises the _r{n} suffix only', () => {
	assert.equal(isReplanStepId('researcher_r1'), true)
	assert.equal(isReplanStepId('synthesizer_r12'), true)
	assert.equal(isReplanStepId('researcher'), false)
	assert.equal(isReplanStepId('critic_r'), false)
})

test('format helpers are honest about zero / null', () => {
	assert.equal(formatMicroUsd(0), '$0')
	assert.equal(formatMicroUsd(43300), '$0.0433')
	assert.equal(formatMicroUsd(-5), '$0')
	assert.equal(formatMs(null), 'n/a')
	assert.equal(formatMs(500), '500ms')
	assert.equal(formatMs(3200), '3.2s')
})

test('modelBadge uses the registry short name for known labels, raw text otherwise', () => {
	assert.equal(modelBadge('claude').label, 'Claude')
	assert.ok(modelBadge('claude').color) // a brand colour
	assert.equal(modelBadge('mistral-large').label, 'mistral-large')
	assert.equal(modelBadge('mistral-large').color, null)
	assert.equal(modelBadge('').label, 'n/a')
})

// applyTerminalStatus reconciles a replayed view with the stored run row.

test('applyTerminalStatus fixes a run that died before persisting a terminal frame', () => {
	// Folded from events only, a killed run still looks like it is streaming.
	const streaming = applyRunViewEvent(initialRunViewState(), 'run_started', {
		runId: '16',
		query: 'q',
		at: 1000
	})
	assert.equal(streaming.phase, 'streaming')

	const fixed = applyTerminalStatus(streaming, 'failed', 'client disconnected')
	assert.equal(fixed.phase, 'failed')
	assert.equal(fixed.status, 'failed')
	assert.equal(fixed.error, 'client disconnected')
})

test('applyTerminalStatus supplies an honest default message when the row has no error', () => {
	const fixed = applyTerminalStatus(initialRunViewState(), 'failed', null)
	assert.equal(fixed.phase, 'failed')
	assert.equal(fixed.error, 'The run stopped before producing a final answer.')
})

test('applyTerminalStatus marks a completed row complete', () => {
	const fixed = applyTerminalStatus(initialRunViewState(), 'completed', null)
	assert.equal(fixed.phase, 'complete')
	assert.equal(fixed.status, 'completed')
	assert.equal(fixed.error, null)
})

test('applyTerminalStatus leaves a still-running run untouched', () => {
	const streaming = applyRunViewEvent(initialRunViewState(), 'run_started', { at: 1 })
	const same = applyTerminalStatus(streaming, 'running', null)
	assert.equal(same.phase, 'streaming')
	assert.equal(same.error, null)
})

// ---- Model Pool failover events (MP-M6) ----------------------------------

test('model_failover records a timeline marker and flags the running step degraded', () => {
	const s = fold([
		['run_started', { runId: '16', query: 'q', at: 1000 }],
		['plan_created', { plan: { steps: [{ id: 'synthesizer', agent: 'synthesizer', model: 'claude' }] }, at: 1001 }],
		['agent_started', { runId: '16', stepId: 'synthesizer', agent: 'synthesizer', model: 'claude', at: 1002 }],
		[
			'model_failover',
			{
				runId: '16',
				stepId: 'synthesizer',
				fromSlug: 'anthropic/claude-3.7-sonnet',
				toSlug: 'stealth/space-bunny-alpha',
				reason: 'insufficient-credits',
				attempt: 2,
				at: 1500
			}
		]
	])
	assert.equal(s.poolEvents.length, 1)
	const marker = s.poolEvents[0]
	assert.ok(marker)
	assert.equal(marker.kind, 'failover')
	if (marker.kind === 'failover') {
		assert.equal(marker.fromSlug, 'anthropic/claude-3.7-sonnet')
		assert.equal(marker.toSlug, 'stealth/space-bunny-alpha')
		assert.equal(marker.reason, 'insufficient-credits')
		assert.equal(marker.attempt, 2)
	}
	// The roster row for the running step is flagged degraded.
	const row = s.roster.find((r) => r.stepId === 'synthesizer')
	assert.ok(row)
	assert.equal(row.degraded, true)
	// The clock advanced to the failover event.
	assert.equal(s.elapsedMs, 500)
})

test('model_failover for an unseen step does not create a phantom roster row', () => {
	const s = fold([
		['run_started', { runId: '16', query: 'q', at: 1000 }],
		[
			'model_failover',
			{ runId: '16', stepId: 'ghost', fromSlug: 'a/b', toSlug: 'c/d', reason: 'timeout', attempt: 1, at: 1100 }
		]
	])
	// The timeline still records it, but no roster row is invented.
	assert.equal(s.poolEvents.length, 1)
	assert.equal(s.roster.length, 0)
})

test('model_unhealthy records a circuit-trip marker without touching the roster', () => {
	const s = fold([
		['run_started', { runId: '16', query: 'q', at: 1000 }],
		[
			'model_unhealthy',
			{ runId: '16', slug: 'thinkingmachines/inkling:free', circuit: 'open', consecutiveFailures: 3, at: 1200 }
		]
	])
	assert.equal(s.poolEvents.length, 1)
	const marker = s.poolEvents[0]
	assert.ok(marker)
	assert.equal(marker.kind, 'unhealthy')
	if (marker.kind === 'unhealthy') {
		assert.equal(marker.slug, 'thinkingmachines/inkling:free')
		assert.equal(marker.circuit, 'open')
		assert.equal(marker.consecutiveFailures, 3)
	}
	assert.equal(s.roster.length, 0)
	assert.equal(s.elapsedMs, 200)
})

test('failover markers survive a replay fold in arrival order', () => {
	const s = reduceRunViewEvents([
		{ name: 'run_started', data: { runId: '16', query: 'q', at: 1000 } },
		{ name: 'model_unhealthy', data: { runId: '16', slug: 'x/y:free', circuit: 'open', consecutiveFailures: 2, at: 1050 } },
		{
			name: 'model_failover',
			data: { runId: '16', stepId: 'code', fromSlug: 'x/y:free', toSlug: 'a/b:free', reason: 'unavailable', attempt: 1, at: 1100 }
		}
	])
	assert.equal(s.poolEvents.length, 2)
	assert.equal(s.poolEvents[0]?.kind, 'unhealthy')
	assert.equal(s.poolEvents[1]?.kind, 'failover')
})

