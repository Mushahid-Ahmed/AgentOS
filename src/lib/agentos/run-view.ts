// The AgentOS run-view model (D6). A PURE reducer that folds the SSE wire events
// the client receives into the exact shape the D6 terminal panels render, so the
// live stream and a replayed run produce an identical view from identical code
// (§13: one protocol, streamed live and persisted for replay).
//
// Pure on purpose — no React, no fetch, no 'server-only'. The client SSE hook and
// the replay hook both call `applyRunViewEvent`; the only difference is where the
// events come from (a live ReadableStream vs. a GET of persisted agent_events).
// Because the wire is a system boundary, the reducer NEVER throws: a malformed or
// unknown frame is ignored (state returned unchanged) rather than crashing the view.

import type { VerificationStatus } from '@/lib/evidence/types'
import { isModelLabel, MODELS } from '@/lib/models'
import type { RunStatus } from '@/lib/orchestra/types'

// ---- Wire inputs ----------------------------------------------------------

// The custom `run` init event run.ts sends first (NOT an OrchestrationEvent): the
// Decision Bus planning result the D6 header + checklist render.
export type RunInitPayload = {
	runId: string
	taskType: string
	tier: string
	executionMode: string
	agents: string[]
	modelByAgent: Record<string, string>
	deferred: string[]
}

// The decision kinds that are D4/D1 verification GATES (vs. the planning kinds).
// The JEV DECISION panel quotes the latest gate; a run with none is an honest
// §12-escalation signal (gates fire only at hard/very_hard), surfaced in the UI.
const GATE_KINDS = new Set([
	'evidence_sufficiency',
	'evidence_validity',
	'contradiction',
	'finalization'
])

// ---- View model -----------------------------------------------------------

export type RosterStatus = 'waiting' | 'running' | 'complete' | 'failed' | 'skipped'

export type RosterRow = {
	stepId: string
	agent: string
	model: string
	status: RosterStatus
	// Wall-clock ms for this step once finished (finishedAt - startedAt), else null.
	latencyMs: number | null
	// True when the step was added by a replan (id suffixed `_r{n}`) — the roster
	// marks these so a spawned-mid-run agent is visibly distinct from the original team.
	replan: boolean
	// True when this step's routed model failed and the pool served it from a later
	// candidate (a model_failover arrived for this stepId) — the roster flags the
	// degrade so a free-model failover is visible per agent, not just in the timeline.
	degraded: boolean
	startedAt: number | null
	finishedAt: number | null
}

export type DecisionView = {
	kind: string
	output: unknown
	decidedBy: 'jev' | 'policy'
	confidence: number | null
	latencyMs: number
	at: number
	rationale: string | null
}

export type ReplanMarker = {
	index: number
	reason: string
	addedSteps: string[]
	at: number
}

export type ContradictionMarker = {
	claim: string
	againstClaim: string
	at: number
}

// Model Pool failover/circuit events surfaced mid-run (MP-M6). One timeline the run
// view renders so a degrade is visible live AND on replay — never hidden. `failover`
// is a step's head model failing and a later candidate serving it; `unhealthy` is the
// circuit breaker tripping a model open after consecutive failures.
export type PoolEventMarker =
	| {
			kind: 'failover'
			stepId: string | null
			fromSlug: string
			toSlug: string
			reason: string
			attempt: number
			at: number
	  }
	| {
			kind: 'unhealthy'
			slug: string
			circuit: string
			consecutiveFailures: number
			at: number
	  }

// The D6 EVIDENCE GRAPH counters, derived from the per-row map (never incremented
// blind, so a re-verification can't double-count).
export type EvidenceGraph = {
	claims: number
	sources: number
	verified: number
	contested: number
	refuted: number
	unverified: number
	contradictions: number
}

type EvidenceRow = { source: string | null; status: VerificationStatus }

export type RunViewPhase = 'idle' | 'streaming' | 'complete' | 'failed' | 'budget_stopped'

export type RunViewState = {
	phase: RunViewPhase
	runId: string | null
	query: string | null
	taskType: string | null
	tier: string | null
	executionMode: string | null
	status: RunStatus | null
	agents: string[]
	modelByAgent: Record<string, string>
	// Roles Jev picked that aren't implemented yet — disclosed, never silently dropped.
	deferred: string[]
	// Every decision record in arrival order (planning + gates).
	decisions: DecisionView[]
	// The D6 JEV DECISION BUS checklist, assembled from the run init + planning decisions.
	checklist: {
		taskType: string | null
		tier: string | null
		complexityConfidence: number | null
		agentsSelected: number
		modelRouting: number
	}
	roster: RosterRow[]
	// Internal per-row evidence state; the EVIDENCE GRAPH counters are derived from it.
	evidenceRows: Record<string, EvidenceRow>
	evidence: EvidenceGraph
	// The latest gate decision, for the JEV DECISION quote panel (null below hard tier).
	latestGate: DecisionView | null
	replans: ReplanMarker[]
	contradictions: ContradictionMarker[]
	// Model Pool failover/circuit timeline (MP-M6), in arrival order.
	poolEvents: PoolEventMarker[]
	costMicroUsd: number
	modelCalls: number
	toolCalls: number
	// Wall-clock elapsed since run_started, from the last event's `at` (a real
	// measurement, never a fabricated "~30-50ms").
	elapsedMs: number | null
	finalAnswer: string | null
	citations: string[]
	error: string | null
	startedAt: number | null
	lastEventAt: number | null
	eventCount: number
}

export function initialRunViewState(): RunViewState {
	return {
		phase: 'idle',
		runId: null,
		query: null,
		taskType: null,
		tier: null,
		executionMode: null,
		status: null,
		agents: [],
		modelByAgent: {},
		deferred: [],
		decisions: [],
		checklist: {
			taskType: null,
			tier: null,
			complexityConfidence: null,
			agentsSelected: 0,
			modelRouting: 0
		},
		roster: [],
		evidenceRows: {},
		evidence: {
			claims: 0,
			sources: 0,
			verified: 0,
			contested: 0,
			refuted: 0,
			unverified: 0,
			contradictions: 0
		},
		latestGate: null,
		replans: [],
		contradictions: [],
		poolEvents: [],
		costMicroUsd: 0,
		modelCalls: 0,
		toolCalls: 0,
		elapsedMs: null,
		finalAnswer: null,
		citations: [],
		error: null,
		startedAt: null,
		lastEventAt: null,
		eventCount: 0
	}
}

// ---- Defensive narrowing (the wire is a boundary; never trust, never throw) --

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function str(value: unknown): string | null {
	return typeof value === 'string' ? value : null
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// A replan step id is the role suffixed `_r{n}` (e.g. `researcher_r1`).
export function isReplanStepId(stepId: string): boolean {
	return /_r\d+$/.test(stepId)
}

function deriveEvidence(
	rows: Record<string, EvidenceRow>,
	contradictions: number
): EvidenceGraph {
	const graph: EvidenceGraph = {
		claims: 0,
		sources: 0,
		verified: 0,
		contested: 0,
		refuted: 0,
		unverified: 0,
		contradictions
	}
	const seenSources = new Set<string>()
	for (const row of Object.values(rows)) {
		graph.claims += 1
		if (row.source) seenSources.add(row.source)
		if (row.status === 'verified') graph.verified += 1
		else if (row.status === 'contested') graph.contested += 1
		else if (row.status === 'refuted') graph.refuted += 1
		else graph.unverified += 1
	}
	graph.sources = seenSources.size
	return graph
}

function upsertRoster(
	roster: RosterRow[],
	stepId: string,
	patch: Partial<RosterRow>
): RosterRow[] {
	const existing = roster.find((r) => r.stepId === stepId)
	if (existing) {
		return roster.map((r) => (r.stepId === stepId ? { ...r, ...patch } : r))
	}
	return [
		...roster,
		{
			stepId,
			agent: patch.agent ?? stepId,
			model: patch.model ?? '',
			status: patch.status ?? 'waiting',
			latencyMs: patch.latencyMs ?? null,
			replan: patch.replan ?? isReplanStepId(stepId),
			degraded: patch.degraded ?? false,
			startedAt: patch.startedAt ?? null,
			finishedAt: patch.finishedAt ?? null
		}
	]
}

function withElapsed(state: RunViewState, at: number | null): Pick<RunViewState, 'elapsedMs' | 'lastEventAt'> {
	if (at == null) return { elapsedMs: state.elapsedMs, lastEventAt: state.lastEventAt }
	const elapsedMs = state.startedAt != null ? Math.max(0, at - state.startedAt) : state.elapsedMs
	return { elapsedMs, lastEventAt: at }
}

// ---- The reducer ----------------------------------------------------------

/**
 * Fold one SSE wire frame into the view state. `name` is the SSE event name
 * (`run`, `decision`, or an OrchestrationEvent type); `data` is its JSON payload.
 * Pure and total: unknown/malformed frames return `state` unchanged.
 */
export function applyRunViewEvent(state: RunViewState, name: string, data: unknown): RunViewState {
	if (!isRecord(data)) return state

	switch (name) {
		case 'run': {
			const modelByAgent: Record<string, string> = {}
			if (isRecord(data.modelByAgent)) {
				for (const [k, v] of Object.entries(data.modelByAgent)) {
					if (typeof v === 'string') modelByAgent[k] = v
				}
			}
			const agents = strArray(data.agents)
			const tier = str(data.tier)
			const taskType = str(data.taskType)
			return {
				...state,
				runId: str(data.runId) ?? state.runId,
				taskType: taskType ?? state.taskType,
				tier: tier ?? state.tier,
				executionMode: str(data.executionMode) ?? state.executionMode,
				agents: agents.length > 0 ? agents : state.agents,
				modelByAgent: Object.keys(modelByAgent).length > 0 ? modelByAgent : state.modelByAgent,
				deferred: strArray(data.deferred),
				checklist: {
					...state.checklist,
					taskType: taskType ?? state.checklist.taskType,
					tier: tier ?? state.checklist.tier,
					agentsSelected: agents.length > 0 ? agents.length : state.checklist.agentsSelected,
					modelRouting:
						Object.keys(modelByAgent).length > 0
							? new Set(Object.values(modelByAgent)).size
							: state.checklist.modelRouting
				}
			}
		}

		case 'decision': {
			const view: DecisionView = {
				kind: str(data.kind) ?? 'unknown',
				output: data.output,
				decidedBy: data.decidedBy === 'policy' ? 'policy' : 'jev',
				confidence: num(data.confidence),
				latencyMs: num(data.latencyMs) ?? 0,
				at: num(data.at) ?? state.lastEventAt ?? 0,
				rationale: str(data.rationale)
			}
			const decisions = [...state.decisions, view]
			const isGate = GATE_KINDS.has(view.kind)
			// Refine the checklist from the planning decisions (the run init already
			// seeded it; these carry the confidence + authoritative outputs).
			let checklist = state.checklist
			if (view.kind === 'complexity') {
				const label = str(view.output)
				checklist = {
					...checklist,
					tier: label ?? checklist.tier,
					complexityConfidence: view.confidence ?? checklist.complexityConfidence
				}
			} else if (view.kind === 'task_type') {
				checklist = { ...checklist, taskType: str(view.output) ?? checklist.taskType }
			} else if (view.kind === 'required_agents') {
				const picked = strArray(view.output)
				if (picked.length > 0) checklist = { ...checklist, agentsSelected: picked.length }
			} else if (view.kind === 'model_selection') {
				if (isRecord(view.output)) {
					const models = Object.values(view.output).filter((v): v is string => typeof v === 'string')
					if (models.length > 0) checklist = { ...checklist, modelRouting: new Set(models).size }
				}
			}
			return {
				...state,
				decisions,
				checklist,
				latestGate: isGate ? view : state.latestGate,
				tier: view.kind === 'complexity' ? (str(view.output) ?? state.tier) : state.tier,
				...withElapsed(state, num(data.at))
			}
		}

		case 'run_started': {
			const at = num(data.at)
			return {
				...state,
				phase: 'streaming',
				query: str(data.query) ?? state.query,
				runId: str(data.runId) ?? state.runId,
				startedAt: at ?? state.startedAt,
				...withElapsed({ ...state, startedAt: at ?? state.startedAt }, at)
			}
		}

		case 'plan_created': {
			// Seed the roster from the plan DAG so every step shows as WAITING before
			// it runs (the mockup's roster is the whole team, not just active agents).
			let roster = state.roster
			if (isRecord(data.plan) && Array.isArray(data.plan.steps)) {
				for (const step of data.plan.steps) {
					if (!isRecord(step)) continue
					const stepId = str(step.id)
					if (!stepId) continue
					roster = upsertRoster(roster, stepId, {
						agent: str(step.agent) ?? stepId,
						model: str(step.model) ?? '',
						replan: isReplanStepId(stepId)
					})
				}
			}
			return { ...state, roster, ...withElapsed(state, num(data.at)) }
		}

		case 'status': {
			const status = str(data.status) as RunStatus | null
			const phase: RunViewPhase =
				status === 'completed'
					? 'complete'
					: status === 'failed'
						? 'failed'
						: status === 'budget_stopped'
							? 'budget_stopped'
							: state.phase === 'idle'
								? 'streaming'
								: state.phase
			return { ...state, status: status ?? state.status, phase, ...withElapsed(state, num(data.at)) }
		}

		case 'model_selected': {
			const stepId = str(data.stepId)
			if (!stepId) return state
			return {
				...state,
				roster: upsertRoster(state.roster, stepId, { model: str(data.model) ?? '' }),
				...withElapsed(state, num(data.at))
			}
		}

		case 'model_failover': {
			// A step's head model failed and a later pool candidate served it. Record the
			// degrade on the timeline and flag the roster row so it's visible per agent.
			const stepId = str(data.stepId)
			const marker: PoolEventMarker = {
				kind: 'failover',
				stepId,
				fromSlug: str(data.fromSlug) ?? '',
				toSlug: str(data.toSlug) ?? '',
				reason: str(data.reason) ?? 'unknown',
				attempt: num(data.attempt) ?? 0,
				at: num(data.at) ?? state.lastEventAt ?? 0
			}
			return {
				...state,
				poolEvents: [...state.poolEvents, marker],
				// Flag the roster row only if it already exists — a failover fires mid-step
				// (after agent_started), so never create a phantom row for an unseen stepId.
				roster: stepId
					? state.roster.map((r) => (r.stepId === stepId ? { ...r, degraded: true } : r))
					: state.roster,
				...withElapsed(state, num(data.at))
			}
		}

		case 'model_unhealthy': {
			// The circuit breaker tripped a model open after consecutive failures.
			const marker: PoolEventMarker = {
				kind: 'unhealthy',
				slug: str(data.slug) ?? '',
				circuit: str(data.circuit) ?? 'open',
				consecutiveFailures: num(data.consecutiveFailures) ?? 0,
				at: num(data.at) ?? state.lastEventAt ?? 0
			}
			return {
				...state,
				poolEvents: [...state.poolEvents, marker],
				...withElapsed(state, num(data.at))
			}
		}

		case 'agent_started': {
			const stepId = str(data.stepId)
			if (!stepId) return state
			const at = num(data.at)
			return {
				...state,
				roster: upsertRoster(state.roster, stepId, {
					agent: str(data.agent) ?? stepId,
					model: str(data.model) ?? undefined,
					status: 'running',
					startedAt: at
				}),
				...withElapsed(state, at)
			}
		}

		case 'agent_finished': {
			const stepId = str(data.stepId)
			if (!stepId) return state
			const at = num(data.at)
			const raw = str(data.status)
			const status: RosterStatus =
				raw === 'succeeded' ? 'complete' : raw === 'failed' ? 'failed' : raw === 'skipped' ? 'skipped' : 'complete'
			const row = state.roster.find((r) => r.stepId === stepId)
			const latencyMs = row?.startedAt != null && at != null ? Math.max(0, at - row.startedAt) : row?.latencyMs ?? null
			return {
				...state,
				roster: upsertRoster(state.roster, stepId, { status, finishedAt: at, latencyMs }),
				...withElapsed(state, at)
			}
		}

		case 'evidence_added': {
			const evidenceId = str(data.evidenceId)
			if (!evidenceId) return state
			// A live add carries no status (defaults 'unverified'; the critic moves it later
			// via evidence_verified). A REPLAYED add is hydrated from the authoritative
			// evidence_records row with its FINAL status, so replay reproduces accurate
			// verified/contested/refuted counts even for runs logged before evidence_verified.
			const rawStatus = str(data.status)
			const status: VerificationStatus =
				rawStatus === 'verified' || rawStatus === 'contested' || rawStatus === 'refuted'
					? rawStatus
					: 'unverified'
			const rows = {
				...state.evidenceRows,
				[evidenceId]: { source: str(data.source), status }
			}
			return {
				...state,
				evidenceRows: rows,
				evidence: deriveEvidence(rows, state.evidence.contradictions),
				...withElapsed(state, num(data.at))
			}
		}

		case 'evidence_verified': {
			const evidenceId = str(data.evidenceId)
			if (!evidenceId) return state
			const status = str(data.status) as VerificationStatus | null
			const existing = state.evidenceRows[evidenceId]
			// Only update a row we know about; a verdict for an unseen id is ignored
			// rather than inventing a row (§8: never fabricate).
			if (!existing || !status) return { ...state, ...withElapsed(state, num(data.at)) }
			const rows = { ...state.evidenceRows, [evidenceId]: { ...existing, status } }
			return {
				...state,
				evidenceRows: rows,
				evidence: deriveEvidence(rows, state.evidence.contradictions),
				...withElapsed(state, num(data.at))
			}
		}

		case 'contradiction_found': {
			const marker: ContradictionMarker = {
				claim: str(data.claim) ?? '',
				againstClaim: str(data.againstClaim) ?? '',
				at: num(data.at) ?? state.lastEventAt ?? 0
			}
			const contradictions = state.evidence.contradictions + 1
			return {
				...state,
				contradictions: [...state.contradictions, marker],
				evidence: { ...state.evidence, contradictions },
				...withElapsed(state, num(data.at))
			}
		}

		case 'replan': {
			const at = num(data.at)
			const marker: ReplanMarker = {
				index: num(data.replans) ?? state.replans.length + 1,
				reason: str(data.reason) ?? '',
				addedSteps: strArray(data.addedSteps),
				at: at ?? state.lastEventAt ?? 0
			}
			// Surface the spawned steps in the roster immediately as WAITING (they fill
			// in when their model_selected/agent_started arrive).
			let roster = state.roster
			for (const stepId of marker.addedSteps) {
				roster = upsertRoster(roster, stepId, { status: 'waiting', replan: true })
			}
			return {
				...state,
				phase: 'streaming',
				replans: [...state.replans, marker],
				roster,
				...withElapsed(state, at)
			}
		}

		case 'cost_update': {
			return {
				...state,
				costMicroUsd: num(data.costMicroUsd) ?? state.costMicroUsd,
				modelCalls: num(data.modelCalls) ?? state.modelCalls,
				toolCalls: num(data.toolCalls) ?? state.toolCalls,
				...withElapsed(state, num(data.at))
			}
		}

		case 'final': {
			return {
				...state,
				phase: 'complete',
				finalAnswer: str(data.answer) ?? state.finalAnswer,
				citations: strArray(data.citations),
				...withElapsed(state, num(data.at))
			}
		}

		case 'error': {
			const message = str(data.message) ?? 'The run stopped with an unspecified error.'
			const phase: RunViewPhase = state.status === 'budget_stopped' ? 'budget_stopped' : 'failed'
			return { ...state, phase, error: message, ...withElapsed(state, num(data.at)) }
		}

		default:
			// tool_call / tool_result and any future event: advance the clock + count
			// so elapsed/latency stay live, but change no panel.
			return { ...state, ...withElapsed(state, num(data.at)) }
	}
}

// Fold a whole batch (replay) left-to-right.
export function reduceRunViewEvents(
	events: ReadonlyArray<{ name: string; data: unknown }>,
	initial: RunViewState = initialRunViewState()
): RunViewState {
	let state = initial
	for (const event of events) {
		state = applyRunViewEvent(state, event.name, event.data)
		state = { ...state, eventCount: state.eventCount + 1 }
	}
	return state
}

// Reconcile a replayed view with the authoritative stored run row. A run that died
// before it could persist a terminal `status`/`error` frame (the client disconnected
// mid-stream) folds to phase 'streaming' forever and would render a misleading
// "Synthesizing…" result; the stored row knows the truth. Non-terminal statuses (a
// run genuinely still in flight) return the state unchanged.
export function applyTerminalStatus(
	state: RunViewState,
	status: string | null,
	error: string | null
): RunViewState {
	if (status === 'completed') return { ...state, status: 'completed', phase: 'complete' }
	if (status === 'budget_stopped') {
		return { ...state, status, phase: 'budget_stopped', error: error ?? state.error }
	}
	if (status === 'failed') {
		return {
			...state,
			status: 'failed',
			phase: 'failed',
			error: error ?? state.error ?? 'The run stopped before producing a final answer.'
		}
	}
	return state
}

// ---- Render helpers (pure, exported for the UI + tests) -------------------

// The D6 JEV DECISION quote: a gate decision rendered as the question Jev answered
// plus its rationale. Never invents text — a missing rationale just omits the tail.
export function renderGateQuote(decision: DecisionView | null): string | null {
	if (!decision) return null
	const tail = decision.rationale ? ` — ${decision.rationale}` : ''
	switch (decision.kind) {
		case 'evidence_sufficiency': {
			const enough = isRecord(decision.output) ? decision.output.enough === true : false
			return `Enough evidence? ${enough ? 'YES' : 'NO'}${tail}`
		}
		case 'evidence_validity': {
			const valid = isRecord(decision.output) ? decision.output.valid === true : false
			return `Evidence valid? ${valid ? 'YES' : 'NO'}${tail}`
		}
		case 'contradiction': {
			const found = isRecord(decision.output) ? decision.output.contradiction === true : false
			return `Contradiction found? ${found ? 'YES' : 'NO'}${tail}`
		}
		case 'finalization': {
			const pass = isRecord(decision.output) ? decision.output.pass === true : false
			return `Finalize answer? ${pass ? 'YES' : 'NO'}${tail}`
		}
		default:
			return decision.rationale
	}
}

// The action line under the JEV DECISION quote: what the latest replan did, or an
// honest note that no gate fired (the §12 escalation, surfaced rather than hidden).
export function renderDecisionAction(state: RunViewState): string {
	const lastReplan = state.replans[state.replans.length - 1]
	if (lastReplan) {
		const steps = lastReplan.addedSteps.length > 0 ? ` → spawn ${lastReplan.addedSteps.join(', ')}` : ''
		return `${lastReplan.reason}${steps}`
	}
	if (state.latestGate) return 'Gates passed — finalizing on the gathered evidence.'
	if (state.tier && state.tier !== 'hard' && state.tier !== 'very_hard') {
		return `No verification gate fired — tier "${state.tier}" is below hard (§12 escalation).`
	}
	return 'No verification decision recorded.'
}

// Integer millionths of a USD → a honest display string. NULL/0 shows "$0"; never
// fabricates precision the measurement doesn't have.
export function formatMicroUsd(microUsd: number): string {
	if (!Number.isFinite(microUsd) || microUsd <= 0) return '$0'
	return `$${(microUsd / 1_000_000).toFixed(4)}`
}

export function formatMs(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms)) return '—'
	if (ms < 1000) return `${Math.round(ms)}ms`
	return `${(ms / 1000).toFixed(1)}s`
}

// The model badge: a known label renders its short name + brand colour; an unknown
// string renders as-is (honest — never forced into one of the three).
export function modelBadge(model: string): { label: string; color: string | null } {
	if (isModelLabel(model)) {
		const info = MODELS[model]
		return { label: info.shortName, color: info.color }
	}
	return { label: model.trim() || '—', color: null }
}
