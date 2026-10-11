// Decision Bus types (AGENTOS_UPGRADE_PROMPT §11) — the vocabulary for every
// bounded decision AgentOS makes. Pure TypeScript on purpose: no 'server-only',
// no Prisma, no fetch. The Jev transport is INJECTED (see `JevAsk`) so the whole
// bus is unit-testable with a mocked ask before a single real Jev hop, exactly
// like the Orchestra core.
//
// The bus NEVER generates prose/code — it only makes bounded choices (task type,
// complexity, which agents, which model per agent, the D4 gates). Jev is the
// preferred decider; when Jev is throttled/invalid/timed-out the bus falls back
// to a deterministic POLICY and marks the record `decided_by: 'policy'` so the
// UI can surface the distinction honestly (§6: never label a rule-based decision
// as a Jev decision).

import type { ModelLabel } from '@/lib/models'

// ---- Jev transport (injected; structurally mirrors src/server/ai/jev.ts) ----
//
// Kept as local structural types so this pure module does not import the
// 'server-only' jev.ts. The server-side adapter (src/server/ai/decision-bus.ts)
// passes `askJev` straight through — the shapes are identical by construction.

export type JevQuestionSpec =
	| { type: 'choice'; instructions?: string; criteria: Record<string, string> }
	| { type: 'score'; instructions?: string; criteria: string[] }

export type JevQuestionsSpec = Record<string, JevQuestionSpec>

export type JevAnswerView = {
	type: string
	choice?: string
	score?: number
	confidence: number
	probabilities?: Record<string, number>
}

export type JevAskOutcome =
	| { ok: true; answers: Record<string, JevAnswerView>; latencyMs: number; attempts: number }
	| { ok: false; error: string; latencyMs: number; attempts: number }

export type JevAsk = (state: string, questions: JevQuestionsSpec) => Promise<JevAskOutcome>

// ---- Decision records (§11) ------------------------------------------------

export type DecidedBy = 'jev' | 'policy'

// The bounded decision kinds the bus owns. The planning kinds (task_type …
// execution_mode) drive team assembly; the gate kinds (evidence_sufficiency,
// evidence_validity, contradiction, finalization) implement D4/D1 and are used
// by the replan loop (wired in M6, defined + tested here because the bus is the
// one module that makes and records them).
export type DecisionKind =
	| 'task_type'
	| 'complexity'
	| 'required_agents'
	| 'model_selection'
	| 'execution_mode'
	| 'evidence_sufficiency'
	| 'evidence_validity'
	| 'contradiction'
	| 'finalization'

// One persisted decision. Everything §11 requires: an input summary, the output,
// who decided it, latency, a timestamp, the run id, and the rationale.
export type DecisionRecord<T = unknown> = {
	kind: DecisionKind
	runId: string
	// Short, non-secret description of the input the decision was made from
	// (never the full prompt if long, never a key). Persisted for replay/UI.
	inputSummary: string
	output: T
	decidedBy: DecidedBy
	// Jev's calibrated certainty for this decision, or null when policy decided
	// (a rule has no confidence). Distinct from the top probability.
	confidence: number | null
	latencyMs: number
	// Epoch ms.
	at: number
	rationale: string | null
}

// ---- Decision outputs (each validated by schema.ts) -----------------------

// The task shapes the bus is tested against (§11): research/comparison/
// recommendation, bug fixing, data/calculation, document question, and a
// trivially simple question that must use ONE model and no extra agents.
export const TASK_TYPES = ['research', 'comparison', 'coding', 'data', 'document_qa', 'simple'] as const
export type TaskType = (typeof TASK_TYPES)[number]

// Escalation tiers (§12). Verified as Jev `choice` labels in
// docs/agentos-integration-notes.md §1a.
export const COMPLEXITY_TIERS = ['simple', 'medium', 'hard', 'very_hard'] as const
export type ComplexityTier = (typeof COMPLEXITY_TIERS)[number]

export type ExecutionMode = 'parallel' | 'sequential'

// The agent roles the bus may select (§11). The team is never a fixed list —
// it is assembled per query from the task type, complexity, and Jev's needs_*
// answers. Kept as string literals so the orchestra's agent registry keys match.
export const AGENT_ROLES = ['answerer', 'researcher', 'code', 'critic', 'synthesizer'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

// The assembled planning decision the executor turns into a Plan DAG.
export type PlanDecision = {
	taskType: TaskType
	complexityTier: ComplexityTier
	// Ordered: work agents first, the synthesizer/answerer last.
	agents: AgentRole[]
	executionMode: ExecutionMode
	// Per-agent model routing (D6 "Model routing"). Every selected agent has one.
	modelByAgent: Record<string, ModelLabel>
	// The full record set produced by this planning pass, in decision order.
	records: DecisionRecord[]
}

// ---- Gate outputs (D4 / D1) ------------------------------------------------

export type SufficiencyDecision = { enough: boolean; record: DecisionRecord<{ enough: boolean }> }
export type ValidityDecision = { valid: boolean; record: DecisionRecord<{ valid: boolean }> }
export type ContradictionDecision = {
	contradiction: boolean
	record: DecisionRecord<{ contradiction: boolean }>
}
export type FinalizationDecision = { pass: boolean; record: DecisionRecord<{ pass: boolean }> }

// ---- Bus dependencies (injected) ------------------------------------------

export type DecisionBusDeps = {
	// The Jev transport. Real wiring passes askJev; tests pass a mock.
	ask: JevAsk
	// Wall clock, injectable for deterministic timestamps in tests.
	now?: () => number
	// Optional persistence sink, called once per record (best-effort — the bus
	// never fails a decision because a write failed). Real wiring persists to
	// DecisionRecord rows; tests capture into an array.
	record?: (record: DecisionRecord) => void | Promise<void>
}
