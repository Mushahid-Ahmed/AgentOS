import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePlan } from './plan'
import { OrchestraExecutor } from './executor'
import type {
	Agent,
	AgentRegistry,
	ModelRegistry,
	OrchestrationEvent,
	Plan,
	PlanStep,
	RunStore,
	StepResult
} from './types'

// §10 closing requirement: unit-test plan validation, parallel/sequential
// ordering, retries, budget stopping, and replan limits using MOCKED agents,
// BEFORE wiring real models. Nothing here touches the network, Prisma, or the
// real clock — a fake clock + a no-op sleeper make ordering and budget assertions
// deterministic, and mock agents let each test drive the exact success/failure/
// retry behaviour it is proving.

// ---- Test doubles --------------------------------------------------------

const MODELS: ModelRegistry = { has: (m) => ['m-fast', 'm-balanced', 'm-deep'].includes(m) }

function step(partial: Partial<PlanStep> & { id: string; agent: string }): PlanStep {
	return {
		model: 'm-fast',
		toolsAllowed: [],
		inputs: {},
		dependsOn: [],
		...partial
	}
}

// A mock agent whose behaviour is scripted per call: return a fixed result,
// throw, or hang. Records the order it was invoked so tests can assert
// parallel-vs-sequential execution.
type Script = (callIndex: number) => StepResult | Promise<StepResult>
function mockAgent(name: string, script: Script, log: string[]): Agent {
	let calls = 0
	return {
		name,
		async run() {
			const index = calls++
			log.push(`${name}:${index}`)
			return script(index)
		}
	}
}

const ok = (output: Record<string, unknown> = {}, costMicroUsd = 0): StepResult => ({
	ok: true,
	output,
	costMicroUsd
})

function inMemoryStore(): RunStore & { saved: number; events: OrchestrationEvent[] } {
	const events: OrchestrationEvent[] = []
	let saved = 0
	return {
		events,
		get saved() {
			return saved
		},
		async save() {
			saved++
		},
		async appendEvent(_runId, event) {
			events.push(event)
		}
	}
}

// A fake clock the test advances by hand, so wall-clock budget caps are testable
// without real time passing.
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
	let t = start
	return {
		now: () => t,
		advance: (ms) => {
			t += ms
		}
	}
}

const noSleep = async () => {}
const limits = {
	maxCostMicroUsd: 1_000_000,
	maxModelCalls: 100,
	maxToolCalls: 100,
	maxReplans: 2,
	maxWallClockMs: 60_000
}

// ---- Plan validation -----------------------------------------------------

test('validatePlan accepts a well-formed DAG and returns parallel levels', () => {
	const plan: Plan = {
		steps: [
			step({ id: 'a', agent: 'research' }),
			step({ id: 'b', agent: 'research' }),
			step({ id: 'c', agent: 'synth', dependsOn: ['a', 'b'] })
		]
	}
	const agents: AgentRegistry = { research: mockAgent('research', () => ok(), []), synth: mockAgent('synth', () => ok(), []) }
	const result = validatePlan(plan, { agents, models: MODELS })
	assert.equal(result.ok, true)
	if (result.ok) {
		// Level 0 = {a,b} (parallel), level 1 = {c}.
		assert.deepEqual(result.order, [['a', 'b'], ['c']])
	}
})

test('validatePlan rejects empty plans, unknown agents/models, cycles, and bad deps', () => {
	const agents: AgentRegistry = { research: mockAgent('research', () => ok(), []) }

	const empty = validatePlan({ steps: [] }, { agents, models: MODELS })
	assert.equal(empty.ok, false)
	if (!empty.ok) assert.ok(empty.issues.some((i) => i.code === 'empty_plan'))

	const unknownAgent = validatePlan({ steps: [step({ id: 'a', agent: 'ghost' })] }, { agents, models: MODELS })
	if (!unknownAgent.ok) assert.ok(unknownAgent.issues.some((i) => i.code === 'unknown_agent'))
	else assert.fail('expected failure')

	const unknownModel = validatePlan({ steps: [step({ id: 'a', agent: 'research', model: 'nope' })] }, { agents, models: MODELS })
	if (!unknownModel.ok) assert.ok(unknownModel.issues.some((i) => i.code === 'unknown_model'))
	else assert.fail('expected failure')

	const cyclic: Plan = {
		steps: [
			step({ id: 'a', agent: 'research', dependsOn: ['b'] }),
			step({ id: 'b', agent: 'research', dependsOn: ['a'] })
		]
	}
	const cycleResult = validatePlan(cyclic, { agents, models: MODELS })
	if (!cycleResult.ok) assert.ok(cycleResult.issues.some((i) => i.code === 'cycle'))
	else assert.fail('expected failure')

	const badDep = validatePlan({ steps: [step({ id: 'a', agent: 'research', dependsOn: ['missing'] })] }, { agents, models: MODELS })
	if (!badDep.ok) assert.ok(badDep.issues.some((i) => i.code === 'unknown_dependency'))
	else assert.fail('expected failure')
})

test('validatePlan flags a tool the plan is not allowed to use', () => {
	const agents: AgentRegistry = { research: mockAgent('research', () => ok(), []) }
	const plan: Plan = { steps: [step({ id: 'a', agent: 'research', toolsAllowed: ['calculator'] })] }
	// No tools registry => any tool reference is disallowed.
	const result = validatePlan(plan, { agents, models: MODELS })
	assert.equal(result.ok, false)
	if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'disallowed_tool'))
})

// ---- Executor: ordering --------------------------------------------------

test('executor runs independent steps and resolves a dependent step from shared context', async () => {
	const log: string[] = []
	const agents: AgentRegistry = {
		research: mockAgent('research', () => ok({ fact: 'x' }), log),
		synth: {
			name: 'synth',
			async run(_input, ctx) {
				log.push('synth')
				// The dependent step reads its parent's output from shared context.
				assert.deepEqual(ctx.shared['a'], { fact: 'x' })
				return ok({ answer: 'done' })
			}
		}
	}
	const plan: Plan = {
		steps: [step({ id: 'a', agent: 'research' }), step({ id: 'b', agent: 'synth', dependsOn: ['a'] })]
	}
	const ex = new OrchestraExecutor({ agents, models: MODELS }, { limits, sleep: noSleep })
	const run = await ex.execute('r1', 'q', plan)

	assert.equal(run.status, 'completed')
	assert.equal(run.stepStates['a'].status, 'succeeded')
	assert.equal(run.stepStates['b'].status, 'succeeded')
	// 'a' (attempt 0) ran before 'synth'.
	assert.deepEqual(log, ['research:0', 'synth'])
})

test('a step whose dependency failed is skipped, and a critical failure fails the run', async () => {
	const log: string[] = []
	const agents: AgentRegistry = {
		// First (only) call fails, non-retryable.
		research: mockAgent('research', () => ({ ok: false, error: 'nope' }), log),
		synth: mockAgent('synth', () => ok(), log)
	}
	const plan: Plan = {
		steps: [
			step({ id: 'a', agent: 'research', critical: true }),
			step({ id: 'b', agent: 'synth', dependsOn: ['a'] })
		]
	}
	const ex = new OrchestraExecutor({ agents, models: MODELS }, { limits, sleep: noSleep, maxRetries: 0 })
	const run = await ex.execute('r2', 'q', plan)

	assert.equal(run.stepStates['a'].status, 'failed')
	assert.equal(run.stepStates['b'].status, 'skipped')
	// 'a' was critical and never resolved => honest failure, not completion. The
	// message keeps the greppable token AND names the real cause (step + its error).
	assert.equal(run.status, 'failed')
	assert.equal(run.error, 'critical_step_failed: a failed: nope')
})

test('a non-critical failed step does not kill the run', async () => {
	const agents: AgentRegistry = {
		research: mockAgent('research', () => ({ ok: false, error: 'nope' }), []),
		synth: mockAgent('synth', () => ok({ answer: 'partial' }), [])
	}
	const plan: Plan = {
		steps: [step({ id: 'a', agent: 'research' }), step({ id: 'b', agent: 'synth' })]
	}
	const ex = new OrchestraExecutor({ agents, models: MODELS }, { limits, sleep: noSleep, maxRetries: 0 })
	const run = await ex.execute('r3', 'q', plan)
	assert.equal(run.stepStates['a'].status, 'failed')
	assert.equal(run.stepStates['b'].status, 'succeeded')
	assert.equal(run.status, 'completed')
})

// ---- Executor: retries ---------------------------------------------------

test('executor retries a throwing step up to the cap, then succeeds', async () => {
	const log: string[] = []
	const agents: AgentRegistry = {
		flaky: mockAgent(
			'flaky',
			(i) => {
				if (i < 2) throw new Error('transient')
				return ok({ recovered: true })
			},
			log
		)
	}
	const plan: Plan = { steps: [step({ id: 'a', agent: 'flaky' })] }
	const ex = new OrchestraExecutor({ agents, models: MODELS }, { limits, sleep: noSleep, maxRetries: 3 })
	const run = await ex.execute('r4', 'q', plan)

	assert.equal(run.status, 'completed')
	assert.equal(run.stepStates['a'].status, 'succeeded')
	assert.equal(run.stepStates['a'].attempts, 3)
	assert.deepEqual(log, ['flaky:0', 'flaky:1', 'flaky:2'])
})

test('executor retries a retryable ok:false result but not a non-retryable one', async () => {
	const retryLog: string[] = []
	const retryableAgents: AgentRegistry = {
		a: mockAgent('a', (i) => (i < 1 ? { ok: false, error: 'rate', retryable: true } : ok()), retryLog)
	}
	const retryRun = await new OrchestraExecutor({ agents: retryableAgents, models: MODELS }, { limits, sleep: noSleep, maxRetries: 2 }).execute(
		'r5',
		'q',
		{ steps: [step({ id: 's', agent: 'a' })] }
	)
	assert.equal(retryRun.stepStates['s'].status, 'succeeded')
	assert.equal(retryRun.stepStates['s'].attempts, 2)

	const hardLog: string[] = []
	const hardAgents: AgentRegistry = {
		a: mockAgent('a', () => ({ ok: false, error: 'bad_request' }), hardLog)
	}
	const hardRun = await new OrchestraExecutor({ agents: hardAgents, models: MODELS }, { limits, sleep: noSleep, maxRetries: 3 }).execute(
		'r6',
		'q',
		{ steps: [step({ id: 's', agent: 'a' })] }
	)
	// Non-retryable => exactly one attempt, immediate failure.
	assert.equal(hardRun.stepStates['s'].status, 'failed')
	assert.equal(hardRun.stepStates['s'].attempts, 1)
})

test('a step that exceeds its timeout fails after retries', async () => {
	const agents: AgentRegistry = {
		hang: {
			name: 'hang',
			run: () => new Promise<StepResult>(() => {}) // never resolves
		}
	}
	const plan: Plan = { steps: [step({ id: 'a', agent: 'hang', critical: true })] }
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{ limits, sleep: noSleep, maxRetries: 0, stepTimeoutMs: 5 }
	)
	const run = await ex.execute('r7', 'q', plan)
	assert.equal(run.stepStates['a'].status, 'failed')
	assert.match(run.stepStates['a'].error ?? '', /step_timeout/)
	assert.equal(run.status, 'failed')
})

// ---- Executor: budget stopping ------------------------------------------

test('executor stops and marks budget_stopped when the cost cap is hit', async () => {
	const agents: AgentRegistry = {
		// Each step reports a real cost of 400k micro-USD.
		expensive: mockAgent('expensive', () => ok({}, 400_000), [])
	}
	// Steps are CHAINED (sequential), not parallel: a call's cost is unknown until
	// it returns, so the guard can only refuse the NEXT call once prior spend has
	// crossed the cap. a(400k) -> b(800k) -> c(1.2M) each run because the check
	// happens before their own cost lands; d sees 1.2M >= 1M and is refused.
	const plan: Plan = {
		steps: [
			step({ id: 'a', agent: 'expensive' }),
			step({ id: 'b', agent: 'expensive', dependsOn: ['a'] }),
			step({ id: 'c', agent: 'expensive', dependsOn: ['b'] }),
			step({ id: 'd', agent: 'expensive', dependsOn: ['c'] })
		]
	}
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{ limits: { ...limits, maxCostMicroUsd: 1_000_000 }, sleep: noSleep }
	)
	const run = await ex.execute('r8', 'q', plan)

	assert.equal(run.status, 'budget_stopped')
	assert.match(run.error ?? '', /max_cost/)
	// The first three ran and spent; the fourth never ran (skipped on refusal).
	assert.equal(run.stepStates['a'].status, 'succeeded')
	assert.equal(run.stepStates['c'].status, 'succeeded')
	assert.equal(run.stepStates['d'].status, 'skipped')
	assert.ok(run.usage.costMicroUsd >= 1_000_000)
})

test('budget stop still yields an honest partial answer via the finalizer (§10.7/§12)', async () => {
	const agents: AgentRegistry = {
		expensive: mockAgent('expensive', (i) => ok({ text: `partial ${i}` }, 400_000), [])
	}
	// Same chained shape as the cost-cap test: a,b,c run and spend; d is refused.
	const plan: Plan = {
		steps: [
			step({ id: 'a', agent: 'expensive' }),
			step({ id: 'b', agent: 'expensive', dependsOn: ['a'] }),
			step({ id: 'c', agent: 'expensive', dependsOn: ['b'] }),
			step({ id: 'd', agent: 'expensive', dependsOn: ['c'] })
		]
	}
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{
			limits: { ...limits, maxCostMicroUsd: 1_000_000 },
			sleep: noSleep,
			finalizer: async (run) => {
				const succeeded = Object.values(run.stepStates).filter((s) => s.status === 'succeeded').length
				return { answer: `partial answer from ${succeeded} step(s); stopped by budget`, citations: ['https://a.example'] }
			}
		}
	)
	const events: OrchestrationEvent[] = []
	ex.subscribe((e) => events.push(e))
	const run = await ex.execute('r-partial', 'q', plan)

	assert.equal(run.status, 'budget_stopped')
	assert.match(run.error ?? '', /max_cost/)
	// The finalizer ran over the succeeded steps, so the client gets a real partial
	// answer AND the honest reason — never an empty response on a budget stop.
	assert.match(run.finalAnswer ?? '', /partial answer from 3 step\(s\); stopped by budget/)
	const final = events.find((e) => e.type === 'final')
	const error = events.find((e) => e.type === 'error')
	assert.ok(final, 'a final event carries the partial answer')
	assert.ok(error, 'an error event carries the budget reason')
	assert.equal(final && final.type === 'final' ? final.citations.length : 0, 1)
})

test('executor stops when the wall-clock cap is exceeded', async () => {
	const clock = fakeClock(0)
	const agents: AgentRegistry = {
		work: {
			name: 'work',
			async run() {
				clock.advance(40_000) // each step burns 40s of the fake clock
				return ok()
			}
		}
	}
	// Chained so the clock advances between reservations: a runs at elapsed 0
	// (->40s); b's pre-check sees 40s < 50s and runs (->80s); c's pre-check sees
	// 80s >= 50s and is refused => budget_stopped.
	const plan: Plan = {
		steps: [
			step({ id: 'a', agent: 'work' }),
			step({ id: 'b', agent: 'work', dependsOn: ['a'] }),
			step({ id: 'c', agent: 'work', dependsOn: ['b'] })
		]
	}
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{ limits: { ...limits, maxWallClockMs: 50_000 }, sleep: noSleep, now: clock.now }
	)
	const run = await ex.execute('r9', 'q', plan)
	assert.equal(run.status, 'budget_stopped')
	assert.match(run.error ?? '', /max_wall_clock/)
	assert.equal(run.stepStates['a'].status, 'succeeded')
	assert.equal(run.stepStates['b'].status, 'succeeded')
	assert.equal(run.stepStates['c'].status, 'skipped')
})

test('executor refuses a paid call once the model-call cap is reached', async () => {
	const agents: AgentRegistry = { work: mockAgent('work', () => ok(), []) }
	const plan: Plan = {
		steps: [step({ id: 'a', agent: 'work' }), step({ id: 'b', agent: 'work' }), step({ id: 'c', agent: 'work' })]
	}
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{ limits: { ...limits, maxModelCalls: 2 }, sleep: noSleep }
	)
	const run = await ex.execute('r10', 'q', plan)
	assert.equal(run.status, 'budget_stopped')
	assert.equal(run.stepStates['a'].status, 'succeeded')
	assert.equal(run.stepStates['b'].status, 'succeeded')
	assert.equal(run.stepStates['c'].status, 'skipped')
})

// ---- Executor: replan loop (D5 mechanics) --------------------------------

test('replan policy can spawn a new agent, and the loop runs the added step', async () => {
	const log: string[] = []
	const agents: AgentRegistry = {
		research: mockAgent('research', () => ok({ found: false }), log),
		// The spawned agent is NOT in the original team — D5.
		experiment: mockAgent('experiment', () => ok({ answer: 'attribution' }), log)
	}
	const plan: Plan = { steps: [step({ id: 'a', agent: 'research' })] }

	let replanned = false
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{
			limits,
			sleep: noSleep,
			replanPolicy: async () => {
				if (replanned) return null
				// Only replan once, adding an experiment step.
				replanned = true
				return { add: [step({ id: 'x', agent: 'experiment' })], reason: 'missing_evidence' }
			}
		}
	)
	const run = await ex.execute('r11', 'q', plan)

	assert.equal(run.status, 'completed')
	assert.equal(run.stepStates['x'].status, 'succeeded')
	assert.equal(run.usage.replans, 1)
	assert.deepEqual(log, ['research:0', 'experiment:0'])
})

test('replan loop is bounded by maxReplans', async () => {
	let replanCalls = 0
	const agents: AgentRegistry = {
		research: mockAgent('research', () => ok(), []),
		more: mockAgent('more', () => ok(), [])
	}
	const plan: Plan = { steps: [step({ id: 'a', agent: 'research' })] }
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{
			limits: { ...limits, maxReplans: 2 },
			sleep: noSleep,
			// Always wants to replan — the guard must cut it off at 2.
			replanPolicy: async () => {
				replanCalls++
				return { add: [step({ id: `m${replanCalls}`, agent: 'more' })], reason: 'still_missing' }
			}
		}
	)
	const run = await ex.execute('r12', 'q', plan)

	assert.equal(run.status, 'completed')
	assert.equal(run.usage.replans, 2)
	// The policy is consulted, but only 2 deltas are adopted (canReplan() blocks
	// the 3rd). Added steps m1 and m2 exist; no m3.
	assert.ok(run.stepStates['m1'])
	assert.ok(run.stepStates['m2'])
	assert.equal(run.stepStates['m3'], undefined)
})

test('replan loop breaks when the wall clock is exhausted (gate calls are not reservation-gated)', async () => {
	const clock = fakeClock(0)
	let policyCalls = 0
	const agents: AgentRegistry = {
		// The first step burns the entire wall-clock budget (a slow sonar/model call).
		research: {
			name: 'research',
			async run() {
				clock.advance(70_000)
				return ok({ text: 'partial finding' })
			}
		},
		more: mockAgent('more', () => ok(), [])
	}
	const plan: Plan = { steps: [step({ id: 'a', agent: 'research' })] }
	const ex = new OrchestraExecutor(
		{ agents, models: MODELS },
		{
			limits: { ...limits, maxWallClockMs: 60_000, maxReplans: 2 },
			sleep: noSleep,
			now: clock.now,
			// Always wants to replan — but the wall clock must cut the round off BEFORE
			// the policy (and its unbounded Jev gate calls) is ever invoked.
			replanPolicy: async () => {
				policyCalls++
				return { add: [step({ id: `m${policyCalls}`, agent: 'more' })], reason: 'still_missing' }
			},
			finalizer: async () => ({ answer: 'partial answer from what was gathered', citations: [] })
		}
	)
	const run = await ex.execute('r-clock', 'q', plan)

	assert.equal(run.stepStates['a'].status, 'succeeded')
	// The round was refused on the wall clock, so the policy never ran and no delta
	// step was added — the run finalizes honestly instead of stalling in a slow gate.
	assert.equal(policyCalls, 0)
	assert.equal(run.usage.replans, 0)
	assert.equal(run.stepStates['m1'], undefined)
	assert.equal(run.status, 'completed')
	assert.equal(run.finalAnswer, 'partial answer from what was gathered')
})

// ---- Executor: events + persistence -------------------------------------

test('executor emits the typed event sequence and persists after state changes', async () => {
	const store = inMemoryStore()
	const agents: AgentRegistry = { research: mockAgent('research', () => ok({ a: 1 }), []) }
	const plan: Plan = { steps: [step({ id: 'a', agent: 'research' })] }
	const ex = new OrchestraExecutor({ agents, models: MODELS }, { limits, sleep: noSleep, store })

	const events: OrchestrationEvent[] = []
	ex.subscribe((e) => events.push(e))
	const run = await ex.execute('r13', 'q', plan)

	const types = events.map((e) => e.type)
	// Core happy-path protocol (§13 subset the engine owns).
	for (const expected of ['run_started', 'plan_created', 'model_selected', 'agent_started', 'agent_finished', 'final']) {
		assert.ok(types.includes(expected), `missing event ${expected}`)
	}
	assert.equal(run.status, 'completed')
	// The run aggregate was persisted at least at each transition.
	assert.ok(store.saved > 0)
	// Events were handed to the store for replay.
	assert.ok(store.events.some((e) => e.type === 'final'))
})

test('an invalid plan fails the run cleanly without executing any step', async () => {
	const log: string[] = []
	const agents: AgentRegistry = { research: mockAgent('research', () => ok(), log) }
	const plan: Plan = { steps: [step({ id: 'a', agent: 'research', dependsOn: ['ghost'] })] }
	const ex = new OrchestraExecutor({ agents, models: MODELS }, { limits, sleep: noSleep })
	const run = await ex.execute('r14', 'q', plan)

	assert.equal(run.status, 'failed')
	assert.match(run.error ?? '', /invalid_plan/)
	assert.deepEqual(log, [], 'no agent should have run')
})
