// Orchestra core types — the vocabulary shared by the plan validator, the
// budget guard, the event bus, and the executor. Pure TypeScript on purpose:
// no 'server-only', no Prisma, no fetch. Everything side-effectful (persistence,
// real model calls, real tools, the wall clock, backoff sleeps) is injected via
// the registries and options in orchestrator.ts, so the whole engine is unit
// testable with MOCKED agents under `node --test` before a single real model is
// wired (AGENTOS_UPGRADE_PROMPT §10).
//
// Naming follows §10/§13 of the upgrade brief: a Run drives a Plan (a DAG of
// PlanSteps); each step is executed by an Agent under a BudgetGuard; every state
// change emits an OrchestrationEvent that is both streamed to the UI and
// persisted for replay.

import type { EvidencePort, VerificationStatus } from '@/lib/evidence'
import type { ModelFailoverEvent, ModelUnhealthyEvent } from '@/lib/model-pool/types'

// ---- Run lifecycle -------------------------------------------------------

export type RunStatus =
	| 'planning'
	| 'running'
	| 'verifying'
	| 'replanning'
	| 'finalizing'
	| 'completed'
	| 'failed'
	| 'budget_stopped'

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

// A plan is a DAG. `dependsOn` are step ids that must reach a terminal state
// before this step may start. `critical` steps gate the run: a failed critical
// step forces a replan (or an honest failure); a failed non-critical step is
// recorded and the run continues (§10.5).
export type PlanStep = {
	id: string
	agent: string
	model: string
	toolsAllowed: string[]
	inputs: Record<string, unknown>
	dependsOn: string[]
	critical?: boolean
}

export type Plan = { steps: PlanStep[] }

// A plan delta from the replan loop (§10.6 / D5): new steps appended to the
// live plan. Deltas MAY introduce agents that were not in the original team.
export type PlanDelta = { add: PlanStep[]; reason: string }

// ---- Step execution ------------------------------------------------------

export type StepResult = {
	ok: boolean
	// Structured output, merged into the run's shared context under the step id
	// so downstream steps can read it (§10.4). Evidence records are a separate
	// concern that lands with the hub in M5.
	output?: Record<string, unknown>
	confidence?: number
	notes?: string
	tokens?: { input: number; output: number }
	// Real cost for this step in integer millionths of a USD, derived from NanoGPT
	// token usage where available (NULL/absent when unknown — never fabricated).
	costMicroUsd?: number
	error?: string
	// Hints the executor should retry rather than fail fast. Absent = not
	// retryable for an ok:false result; thrown errors/timeouts are always
	// treated as retryable up to the retry cap.
	retryable?: boolean
}

export type StepState = {
	status: StepStatus
	attempts: number
	startedAt: number | null
	finishedAt: number | null
	result: StepResult | null
	error: string | null
}

// ---- Budget (§10.7 / §12) ------------------------------------------------

export type BudgetLimits = {
	maxCostMicroUsd: number
	maxModelCalls: number
	maxToolCalls: number
	maxReplans: number
	maxWallClockMs: number
}

export type BudgetUsage = {
	costMicroUsd: number
	modelCalls: number
	toolCalls: number
	replans: number
	// Epoch ms the run started; the wall-clock cap is measured against it.
	startedAt: number
}

export type BudgetSnapshot = BudgetUsage & {
	elapsedMs: number
	limits: BudgetLimits
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: string }

// ---- Tools (D3 / §13) ----------------------------------------------------

export type ToolResult =
	| {
			ok: true
			output: unknown
			summary?: string
			latencyMs?: number
			// Real spend the tool itself incurred, in integer millionths of a USD,
			// from its own provider usage — e.g. the research-sonar tool's paid web
			// model call. Absent when the tool is free (the keyless calculator) or
			// returned no price; never fabricated, never 0. The executor adds it to
			// the run budget so a tool's cost is not silently dropped from the cap.
			costMicroUsd?: number
	  }
	| { ok: false; error: string }

export type ToolRegistry = {
	has(tool: string): boolean
	call(name: string, args: unknown): Promise<ToolResult>
}

// ---- Agents (§10.4) ------------------------------------------------------

// Everything an agent may touch during one step. The evidence hub (read/write
// claims) joined this context in M5: the researcher writes sourced claims to it,
// the fact-checker reads them back and marks verification, and the finalizer cites
// them. The executor injects a per-run port (Prisma-backed in production, in-memory
// as the fallback) and wraps it so evidence writes emit the §13 events.
export type AgentContext = {
	runId: string
	query: string
	// The model the Decision Bus routed to this step (PlanStep.model). The agent
	// calls exactly this model — per-agent routing is a decision, not the agent's
	// choice. A ModelLabel string for AgentOS; opaque here so the core stays pure.
	model: string
	// Read view of the run's shared context: prior step outputs (keyed by step
	// id) plus any planner-seeded values.
	shared: Readonly<Record<string, unknown>>
	budget: BudgetSnapshot
	emit: (event: OrchestrationEvent) => void
	callTool: (name: string, args: unknown) => Promise<ToolResult>
	// The run's evidence hub. Always present: the executor supplies an in-memory
	// port when no store is injected, so an agent can record a claim unconditionally.
	evidence: EvidencePort
}

// One interface, implemented by every agent (real or mocked) — §10.4.
export type Agent = {
	readonly name: string
	run(input: Record<string, unknown>, ctx: AgentContext): Promise<StepResult>
}

// ---- Registries (injected) ----------------------------------------------

export type AgentRegistry = Readonly<Record<string, Agent>>
export type ModelRegistry = { has(model: string): boolean }

// ---- Events (§13 protocol) ----------------------------------------------

// The full typed event set from §13. The core executor emits the run/plan/agent/
// cost/status/final/replan/error members; `decision` is emitted by the Decision
// Bus (M3) and the evidence/tool members by the hub + MCP layers (M4/M5), all
// through the same bus so the UI and the replay log see one protocol.
export type OrchestrationEvent =
	| { type: 'run_started'; runId: string; query: string; at: number }
	| { type: 'plan_created'; runId: string; plan: Plan; at: number }
	| {
			type: 'decision'
			runId: string
			kind: string
			output: unknown
			decidedBy: 'jev' | 'policy'
			confidence: number | null
			latencyMs: number
			at: number
	  }
	| { type: 'status'; runId: string; status: RunStatus; at: number }
	| { type: 'agent_started'; runId: string; stepId: string; agent: string; model: string; at: number }
	| { type: 'model_selected'; runId: string; stepId: string; model: string; at: number }
	// Model Pool failover events (MP-M6). These reuse the pool's exact shapes
	// (src/lib/model-pool/types.ts) so the run view and replay render a failover
	// identically whether it arrived live from runWithFailover's onEvent or from
	// the persisted log. `model_failover` fires when a step's head model failed and
	// a later candidate served it; `model_unhealthy` fires when the circuit breaker
	// tripped a model open after consecutive failures.
	| ModelFailoverEvent
	| ModelUnhealthyEvent
	| { type: 'tool_call'; runId: string; stepId: string; tool: string; args: unknown; at: number }
	| {
			type: 'tool_result'
			runId: string
			stepId: string
			tool: string
			ok: boolean
			summary?: string
			latencyMs: number
			at: number
	  }
	| {
			type: 'agent_finished'
			runId: string
			stepId: string
			status: StepStatus
			result: StepResult | null
			at: number
	  }
	| {
			type: 'evidence_added'
			runId: string
			evidenceId: string
			// The real source URL the claim was drawn from (null when the researcher had
			// none — never invented). Carried on the event so the D6 EVIDENCE GRAPH panel
			// can count DISTINCT sources from the stream alone, identically in live and
			// replay, without a second lookup (§13).
			source: string | null
			// Which agent wrote the row (e.g. 'researcher') — the panel shows provenance.
			discoveredByAgent: string
			at: number
	  }
	| {
			// Emitted when the fact-checker (critic) moves a row's verification status, so
			// the EVIDENCE GRAPH "verified claims" counter is honest live AND on replay.
			// A bare evidence_added cannot carry this: verification happens AFTER the add.
			type: 'evidence_verified'
			runId: string
			evidenceId: string
			status: VerificationStatus
			at: number
	  }
	| { type: 'contradiction_found'; runId: string; claim: string; againstClaim: string; at: number }
	| { type: 'replan'; runId: string; reason: string; addedSteps: string[]; replans: number; at: number }
	| {
			type: 'cost_update'
			runId: string
			costMicroUsd: number
			modelCalls: number
			toolCalls: number
			at: number
	  }
	| { type: 'final'; runId: string; answer: string; citations: string[]; at: number }
	| { type: 'error'; runId: string; message: string; at: number }

// ---- Run aggregate (§10.1) ----------------------------------------------

export type Run = {
	id: string
	query: string
	status: RunStatus
	plan: Plan
	stepStates: Record<string, StepState>
	shared: Record<string, unknown>
	usage: BudgetUsage
	startedAt: number
	finishedAt: number | null
	finalAnswer: string | null
	error: string | null
}

// ---- Persistence (§10.1: persisted after every state change) -------------

// Injected so the core stays pure. The Prisma-backed store lands with the
// agentos.prisma migration; tests use an in-memory store.
export type RunStore = {
	save(run: Run): Promise<void>
	appendEvent(runId: string, event: OrchestrationEvent): Promise<void>
}

// ---- Replan policy (§10.6) ----------------------------------------------

// The core exposes the replan LOOP and its max-replans bound; the intelligence
// that decides whether to replan (the Jev D4 gates) is injected. For M2 tests
// this is a mock; M6 wires the real gates.
export type ReplanContext = {
	run: Run
	completedSteps: PlanStep[]
	failedSteps: PlanStep[]
}
export type ReplanPolicy = (ctx: ReplanContext) => Promise<PlanDelta | null>

// The synthesizer that turns a finished run into the final answer + citations.
// Injected (real one is the Final Synthesizer agent, M5); a trivial default is
// used by the core when none is supplied.
export type Finalizer = (run: Run) => Promise<{ answer: string; citations: string[] }>
