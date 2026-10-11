import { test } from 'node:test'
import assert from 'node:assert/strict'

import { OrchestraExecutor } from '@/lib/orchestra'
import { buildAgentPlan, createVerificationReplanPolicy, type GateDecider } from '@/lib/agents'
import { runResearchStep } from '@/lib/agents/researcher-core'
import { runCodeStep, type CodeCompleter } from '@/lib/agents/code-agent-core'
import { runCriticStep, type CriticCompleter, type CriticMessage } from '@/lib/agents/critic-core'
import { createMemoryEvidence, type EvidencePort } from '@/lib/evidence'
import { evaluate, CALCULATOR_TOOL } from '@/lib/mcp/calculator'
import { parseResearchCompletion, RESEARCH_TOOL } from '@/lib/mcp/research'
import { isModelLabel } from '@/lib/models'
import type {
	Agent,
	AgentContext,
	AgentRegistry,
	BudgetLimits,
	Finalizer,
	ModelRegistry,
	OrchestrationEvent,
	Run,
	RunStore,
	StepResult,
	ToolRegistry,
	ToolResult
} from '@/lib/orchestra/types'
import type {
	AgentRole,
	DecisionRecord,
	PlanDecision,
	SufficiencyDecision,
	ValidityDecision
} from '@/lib/decisions/types'

// FULL-PIPELINE integration test (the "does the whole agent actually work" check).
//
// Unlike orchestra.test.mts (mocked agents) and agents.test.mts (just buildAgentPlan),
// this wires the REAL production pipeline end to end and runs it at $0:
//   REAL buildAgentPlan  -> REAL OrchestraExecutor (DAG levels, retries, budget, events)
//   REAL researcher core -> REAL research-sonar parser + evidence hub writes
//   REAL code core       -> REAL calculator (evaluate) through the gated tool bridge
//   REAL critic core     -> evidence verdicts + contradiction flagging
//   REAL verification replan policy (D4 gates + D5 deltas) with a mock GateDecider
//   REAL finalizer shape (lead text + distinct evidence citations)
//
// The ONLY things stubbed are the two side effects that cost money / hit the network,
// exactly as the production server wrappers inject them:
//   - the model completer (answerer/synthesizer/code/critic) — a deterministic stub;
//   - the research-sonar transport — a fixed sonar completion, parsed by the REAL parser.
// No live model call, no OpenRouter key, no Prisma, no MCP subprocess: $0, offline.
// A LIVE end-to-end run is a separate step that needs a funded key.

const REGISTERED: readonly AgentRole[] = ['researcher', 'code', 'critic', 'answerer', 'synthesizer']

const MODELS: ModelRegistry = { has: (m) => isModelLabel(m) }

const LIMITS: BudgetLimits = {
	maxCostMicroUsd: 1_000_000,
	maxModelCalls: 40,
	maxToolCalls: 40,
	maxReplans: 3,
	maxWallClockMs: 600_000
}

// ---- Stubbed model transport (the only non-real seam besides sonar) --------

// The generating agents (answerer/synthesizer) call completeOnce directly in
// production (server-only), so they are reproduced here faithfully: read the exact
// worker ids the plan builder handed them out of the shared context and synthesize.
// `fail` drives the honest-critical-failure scenario.
function stubLead(name: string, opts: { fail?: boolean } = {}): Agent {
	return {
		name,
		async run(input: Record<string, unknown>, ctx: AgentContext): Promise<StepResult> {
			if (opts.fail) {
				return { ok: false, error: `${name}_model_402`, retryable: false }
			}
			const ids = Array.isArray(input.workerIds) ? (input.workerIds as string[]) : []
			const blocks: string[] = []
			for (const id of ids) {
				const out = ctx.shared[id] as { text?: unknown } | undefined
				const text = typeof out?.text === 'string' ? out.text : null
				if (text) blocks.push(`[${id}] ${text}`)
			}
			const text = blocks.length
				? `Synthesized answer for "${ctx.query}" from ${blocks.length} worker finding(s):\n${blocks.join('\n')}`
				: `Direct answer for "${ctx.query}".`
			return { ok: true, output: { text }, notes: name, tokens: { input: 20, output: 40 }, costMicroUsd: 300 }
		}
	}
}

// The code agent's model translates the request into one arithmetic expression.
// Stubbed to a fixed, exactly-representable expression so the REAL calculator's
// value is deterministic (240*15/100 = 36, integer-exact — no float noise).
const codeCompleter: CodeCompleter = async () => ({
	text: '240*15/100',
	tokens: { input: 8, output: 4 },
	costMicroUsd: 100
})

// The critic's model returns ONE JSON pass. It reads the real claim ids out of the
// claim list the core builds (so verdicts map to real hub rows, never invented ids),
// marks each verified, and flags a contradiction between the first two — exercising
// markVerification, flagContradiction, and the contested-on-contradiction rule.
const criticCompleter: CriticCompleter = async (messages: CriticMessage[]) => {
	const claimList = messages.find((m) => m.role === 'user')?.content ?? ''
	const ids = [...claimList.matchAll(/#(\d+)/g)].map((m) => m[1]!)
	const verdicts = ids.map((id) => ({ id, status: 'verified', reason: 'source backs it' }))
	const contradictions =
		ids.length >= 2 ? [{ claimId: ids[0]!, againstId: ids[1]!, reason: 'cannot both hold' }] : []
	return {
		text: JSON.stringify({ verdicts, contradictions }),
		tokens: { input: 30, output: 25 },
		costMicroUsd: 400
	}
}

// ---- Real agent registry built on the real pure cores ----------------------

function buildAgents(opts: { leadFail?: boolean } = {}): AgentRegistry {
	const researcher: Agent = {
		name: 'researcher',
		async run(input, ctx) {
			const refined = typeof input.query === 'string' && input.query.trim().length > 0 ? input.query : ctx.query
			return runResearchStep({
				query: refined,
				runId: ctx.runId,
				callTool: ctx.callTool,
				evidence: ctx.evidence,
				notes: refined === ctx.query ? 'research-sonar web retrieval' : 'research-sonar web retrieval (follow-up)'
			})
		}
	}
	const code: Agent = {
		name: 'code',
		async run(_input, ctx) {
			return runCodeStep({ query: ctx.query, model: ctx.model, completer: codeCompleter, callTool: ctx.callTool, notes: 'stub code model' })
		}
	}
	const critic: Agent = {
		name: 'critic',
		async run(_input, ctx) {
			return runCriticStep({ model: ctx.model, evidence: ctx.evidence, completer: criticCompleter, notes: 'stub critic model' })
		}
	}
	return {
		researcher,
		code,
		critic,
		answerer: stubLead('answerer', { fail: opts.leadFail }),
		synthesizer: stubLead('synthesizer', { fail: opts.leadFail })
	}
}

// ---- Real calculator + stubbed sonar transport behind one ToolRegistry ------

// A fixed sonar completion with three real, span-backed citations. It is run through
// the REAL parseResearchCompletion so the {text, citations} the researcher reads is
// produced by production parsing code, not hand-shaped by the test.
function sonarOutput(): { text: string; citations: ReturnType<typeof parseResearchCompletion>['citations'] } {
	const a = 'Hash sharding spreads load evenly across nodes.'
	const b = 'Range sharding keeps time-series queries fast.'
	const c = 'Directory sharding maps tenants to explicit shards.'
	const content = `${a} ${b} ${c}`
	const aEnd = a.length
	const bStart = aEnd + 1
	const bEnd = bStart + b.length
	const cStart = bEnd + 1
	const cEnd = cStart + c.length
	const fixture = {
		choices: [
			{
				message: {
					content,
					annotations: [
						{ url_citation: { url: 'https://a.example', title: 'Sharding basics', start_index: 0, end_index: aEnd } },
						{ url_citation: { url: 'https://b.example', title: 'Time series', start_index: bStart, end_index: bEnd } },
						{ url_citation: { url: 'https://c.example', title: 'Tenant maps', start_index: cStart, end_index: cEnd } }
					]
				}
			}
		]
	}
	return parseResearchCompletion(fixture)
}

function buildTools(researchLog: string[]): ToolRegistry {
	const research = sonarOutput()
	return {
		has: (t) => t === RESEARCH_TOOL || t === CALCULATOR_TOOL,
		async call(name: string, args: unknown): Promise<ToolResult> {
			if (name === CALCULATOR_TOOL) {
				const expression = (args as { expression?: unknown }).expression
				const res = evaluate(typeof expression === 'string' ? expression : '')
				return res.ok
					? { ok: true, output: { expression: res.expression, value: res.value }, summary: `${res.expression} = ${res.value}` }
					: { ok: false, error: res.error }
			}
			if (name === RESEARCH_TOOL) {
				const query = (args as { query?: unknown }).query
				researchLog.push(typeof query === 'string' ? query : '')
				// The sonar web model is a real paid call in production; its cost is recorded
				// here so the budget accounting under test is the real shape.
				return { ok: true, output: { text: research.text, citations: research.citations }, summary: 'sonar retrieval', costMicroUsd: 5000 }
			}
			return { ok: false, error: `unknown_tool:${name}` }
		}
	}
}

// ---- Gate decider mock (D4) ------------------------------------------------

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

type GateFn = boolean | ((callIndex: number) => boolean)

function mockGates(opts: { sufficiency: GateFn; validity: GateFn }): GateDecider & {
	sufficiencyCalls: string[]
	validityCalls: string[]
} {
	const sufficiencyCalls: string[] = []
	const validityCalls: string[] = []
	const resolve = (fn: GateFn, n: number): boolean => (typeof fn === 'function' ? fn(n) : fn)
	return {
		sufficiencyCalls,
		validityCalls,
		async decideEvidenceSufficiency(input): Promise<SufficiencyDecision> {
			sufficiencyCalls.push(input.state)
			const enough = resolve(opts.sufficiency, sufficiencyCalls.length)
			return { enough, record: record('evidence_sufficiency', { enough }) }
		},
		async decideEvidenceValidity(input): Promise<ValidityDecision> {
			validityCalls.push(input.state)
			const valid = resolve(opts.validity, validityCalls.length)
			return { valid, record: record('evidence_validity', { valid }) }
		}
	}
}

// ---- Finalizer (mirrors src/server/agentos/run.ts createEvidenceFinalizer) --

function extractLeadText(run: Run): string {
	for (const step of [...run.plan.steps].reverse()) {
		const state = run.stepStates[step.id]
		const text = state?.result?.ok ? state.result.output?.text : undefined
		if (typeof text === 'string' && text.trim()) return text
	}
	return 'The run finished but no agent produced an answer.'
}

function evidenceFinalizer(evidence: EvidencePort): Finalizer {
	return async (run) => {
		const answer = extractLeadText(run)
		const rows = await evidence.list()
		const seen = new Set<string>()
		const citations: string[] = []
		for (const row of rows) {
			if (row.source && !seen.has(row.source)) {
				seen.add(row.source)
				citations.push(row.source)
			}
		}
		return { answer, citations }
	}
}

// ---- Harness --------------------------------------------------------------

type Harness = {
	executor: OrchestraExecutor
	events: OrchestrationEvent[]
	evidence: EvidencePort
	researchLog: string[]
	gates: ReturnType<typeof mockGates>
	store: RunStore & { saved: number }
}

function buildPipeline(opts: {
	decision: PlanDecision
	gates: { sufficiency: GateFn; validity: GateFn }
	leadFail?: boolean
}): Harness {
	const events: OrchestrationEvent[] = []
	const researchLog: string[] = []
	const evidence = createMemoryEvidence()
	const tools = buildTools(researchLog)
	const gates = mockGates(opts.gates)

	let saved = 0
	const store: RunStore & { saved: number } = {
		get saved() {
			return saved
		},
		async save() {
			saved++
		},
		async appendEvent() {
			/* captured via subscribe instead */
		}
	}

	const lead = opts.decision.agents[opts.decision.agents.length - 1]
	const leadModel = lead ? opts.decision.modelByAgent[lead] : undefined
	const replanPolicy = createVerificationReplanPolicy({
		gates,
		evidence,
		runId: 'run-1',
		query: 'test query',
		complexityTier: opts.decision.complexityTier,
		leadModel,
		onDecision: (r) => events.push({ type: 'decision', runId: 'run-1', kind: r.kind, output: r.output, decidedBy: r.decidedBy, confidence: r.confidence, latencyMs: r.latencyMs, at: 0 })
	})

	let clock = 0
	const executor = new OrchestraExecutor(
		{ agents: buildAgents({ leadFail: opts.leadFail }), models: MODELS, tools },
		{
			limits: LIMITS,
			store,
			evidence,
			replanPolicy,
			finalizer: evidenceFinalizer(evidence),
			stepTimeoutMs: 5_000,
			now: () => (clock += 1),
			sleep: async () => {}
		}
	)
	executor.subscribe((e) => events.push(e))

	return { executor, events, evidence, researchLog, gates, store }
}

function decision(over: Partial<PlanDecision> & { agents: AgentRole[] }): PlanDecision {
	return {
		taskType: 'research',
		complexityTier: 'hard',
		executionMode: 'parallel',
		modelByAgent: { researcher: 'gemini', code: 'gpt', critic: 'claude', synthesizer: 'gpt', answerer: 'gpt' },
		records: [],
		...over
	}
}

const types = (events: OrchestrationEvent[]): string[] => events.map((e) => e.type)
const count = (events: OrchestrationEvent[], type: string): number => events.filter((e) => e.type === type).length
function first<T extends OrchestrationEvent['type']>(events: OrchestrationEvent[], type: T): Extract<OrchestrationEvent, { type: T }> {
	const found = events.find((e) => e.type === type)
	assert.ok(found, `expected a ${type} event`)
	return found as Extract<OrchestrationEvent, { type: T }>
}

const FULL_TEAM: AgentRole[] = ['researcher', 'code', 'critic', 'synthesizer']
const FULL_QUERY = 'Compare index sharding strategies and compute 15% of 240 GB.'

// ---- Scenario A: the whole team, gates pass, no replan ---------------------

test('A: full team runs every agent operation end to end (research -> code -> critique -> synthesize) at $0', async () => {
	const h = buildPipeline({
		decision: decision({ agents: FULL_TEAM, complexityTier: 'hard' }),
		gates: { sufficiency: true, validity: true }
	})
	const { plan, deferred } = buildAgentPlan({ decision: decision({ agents: FULL_TEAM }), registered: REGISTERED })
	assert.deepEqual(deferred, [], 'every selected role has a real implementation')

	const run = await h.executor.execute('run-1', FULL_QUERY, plan)
	const ev = h.events

	// Lifecycle framing.
	assert.equal(ev[0]!.type, 'run_started')
	assert.ok(types(ev).includes('plan_created'))
	assert.equal(ev[ev.length - 1]!.type, 'status')
	assert.equal(run.status, 'completed')
	assert.equal(run.error, null)

	// The DAG ran all four roles.
	const finished = ev.filter((e) => e.type === 'agent_finished')
	assert.equal(finished.length, 4)
	for (const id of ['researcher', 'code', 'critic', 'synthesizer']) {
		assert.equal(run.stepStates[id]!.status, 'succeeded', `${id} succeeded`)
	}

	// Both MCP tools were reached through the gated bridge: research (paid) + calculator (keyless).
	const toolCalls = ev.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool)
	assert.ok(toolCalls.includes(RESEARCH_TOOL), 'research tool called')
	assert.ok(toolCalls.includes(CALCULATOR_TOOL), 'calculator called')
	assert.equal(count(ev, 'tool_result'), 2)

	// Researcher wrote three real, span-backed claims to the hub.
	assert.equal(count(ev, 'evidence_added'), 3)
	const rows = await h.evidence.list()
	assert.deepEqual(rows.map((r) => r.source), ['https://a.example', 'https://b.example', 'https://c.example'])

	// Critic applied verdicts (3 verified) then flagged a contradiction (2 -> contested).
	assert.equal(count(ev, 'contradiction_found'), 1)
	assert.equal(count(ev, 'evidence_verified'), 5)
	const byId = Object.fromEntries(rows.map((r) => [r.id, r.verificationStatus]))
	assert.equal(byId['1'], 'contested')
	assert.equal(byId['2'], 'contested')
	assert.equal(byId['3'], 'verified')

	// Code agent produced the exact calculator value (never a model-guessed number).
	assert.match(String(run.stepStates['code']!.result!.output!.text), /240\*15\/100 = 36/)

	// Lead synthesized over its workers; finalizer attached the REAL evidence sources.
	const finalEv = first(ev, 'final')
	assert.deepEqual(finalEv.citations, ['https://a.example', 'https://b.example', 'https://c.example'])
	assert.match(run.finalAnswer!, /from 3 worker finding\(s\)/)
	assert.match(run.finalAnswer!, /Hash sharding/)
	assert.match(run.finalAnswer!, /240\*15\/100 = 36/)

	// Real budget accounting: sonar 5000 + code 100 + critic 400 + synth 300; 4 steps
	// each reserved a model call; 2 tool calls.
	assert.equal(run.usage.costMicroUsd, 5800)
	assert.equal(run.usage.modelCalls, 4)
	assert.equal(run.usage.toolCalls, 2)
	assert.equal(run.usage.replans, 0)

	// Gates passed on the first (and only) replan check; no delta was added.
	assert.equal(h.gates.sufficiencyCalls.length, 1)
	assert.equal(h.gates.validityCalls.length, 1)
	assert.equal(count(ev, 'replan'), 0)

	// The run was persisted after state changes (crash recovery / replay).
	assert.ok(h.store.saved > 0)
})

// ---- Scenario B: D4 gate 1 insufficient -> D5 research delta ---------------

test('B: gate 1 "insufficient" triggers a research replan with a refined follow-up query', async () => {
	const h = buildPipeline({
		decision: decision({ agents: FULL_TEAM, complexityTier: 'hard' }),
		gates: { sufficiency: (n) => n > 1, validity: true }
	})
	const { plan } = buildAgentPlan({ decision: decision({ agents: FULL_TEAM }), registered: REGISTERED })
	const run = await h.executor.execute('run-1', FULL_QUERY, plan)
	const ev = h.events

	assert.equal(run.status, 'completed')
	assert.equal(run.usage.replans, 1)

	const replanEv = first(ev, 'replan')
	assert.deepEqual(replanEv.addedSteps, ['researcher_r1', 'synthesizer_r1'])
	assert.match(replanEv.reason, /evidence_insufficient/)

	// The follow-up researcher targeted the gap (refined query), not the original verbatim.
	assert.equal(h.researchLog.length, 2)
	assert.match(h.researchLog[1]!, /first pass covered/)

	// The delta synthesizer became the lead and re-read every worker finding (4 total).
	assert.match(run.finalAnswer!, /from 4 worker finding\(s\)/)
	assert.equal(run.stepStates['researcher_r1']!.status, 'succeeded')
	assert.equal(run.stepStates['synthesizer_r1']!.status, 'succeeded')

	// Gate 1 was consulted twice (insufficient, then enough); gate 2 once.
	assert.equal(h.gates.sufficiencyCalls.length, 2)
	assert.equal(h.gates.validityCalls.length, 1)
})

// ---- Scenario C: D4 gate 2 invalid -> D5 rework delta ----------------------

test('C: gate 2 "invalid" triggers an adversarial rework replan (critic + synthesizer)', async () => {
	const h = buildPipeline({
		decision: decision({ agents: FULL_TEAM, complexityTier: 'very_hard' }),
		gates: { sufficiency: true, validity: (n) => n > 1 }
	})
	const { plan } = buildAgentPlan({ decision: decision({ agents: FULL_TEAM, complexityTier: 'very_hard' }), registered: REGISTERED })
	const run = await h.executor.execute('run-1', FULL_QUERY, plan)
	const ev = h.events

	assert.equal(run.status, 'completed')
	assert.equal(run.usage.replans, 1)

	const replanEv = first(ev, 'replan')
	assert.deepEqual(replanEv.addedSteps, ['critic_r1', 'synthesizer_r1'])
	assert.match(replanEv.reason, /evidence_invalid/)
	assert.equal(run.stepStates['critic_r1']!.status, 'succeeded')
	assert.match(run.finalAnswer!, /from 4 worker finding\(s\)/)
	assert.equal(h.gates.validityCalls.length, 2)
})

// ---- Scenario D: §12 escalation — a simple run never spends a gate ---------

test('D: a simple single-answerer run skips gates, tools and evidence entirely', async () => {
	const simpleTeam: AgentRole[] = ['answerer']
	const h = buildPipeline({
		decision: decision({ agents: simpleTeam, complexityTier: 'simple', taskType: 'simple' }),
		gates: { sufficiency: false, validity: false }
	})
	const { plan } = buildAgentPlan({ decision: decision({ agents: simpleTeam, complexityTier: 'simple' }), registered: REGISTERED })
	const run = await h.executor.execute('run-1', 'What does the executor do?', plan)
	const ev = h.events

	assert.equal(run.status, 'completed')
	assert.equal(count(ev, 'tool_call'), 0, 'no tool on the simple path')
	assert.equal(count(ev, 'evidence_added'), 0, 'no evidence gathered')
	assert.equal(count(ev, 'replan'), 0)
	assert.equal(h.gates.sufficiencyCalls.length, 0, '§12: a simple run never calls a gate')
	assert.equal(h.gates.validityCalls.length, 0)
	assert.match(run.finalAnswer!, /Direct answer for/)
	assert.deepEqual(first(ev, 'final').citations, [])
})

// ---- Scenario E: a failed critical lead is an honest failure --------------

test('E: a failed critical lead fails the run honestly (no fabricated answer)', async () => {
	const h = buildPipeline({
		decision: decision({ agents: FULL_TEAM, complexityTier: 'simple' }),
		gates: { sufficiency: true, validity: true },
		leadFail: true
	})
	const { plan } = buildAgentPlan({ decision: decision({ agents: FULL_TEAM, complexityTier: 'simple' }), registered: REGISTERED })
	const run = await h.executor.execute('run-1', FULL_QUERY, plan)
	const ev = h.events

	assert.equal(run.status, 'failed')
	assert.match(run.error!, /^critical_step_failed: synthesizer failed: synthesizer_model_402/)
	assert.equal(count(ev, 'final'), 0, 'no final answer is invented for a failed run')
	const errEv = first(ev, 'error')
	assert.match(errEv.message, /critical_step_failed/)
	// The workers still ran and gathered real evidence before the lead failed.
	assert.equal(count(ev, 'evidence_added'), 3)
})
