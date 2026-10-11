// Deterministic policy fallbacks for the Decision Bus (§6/§11). These run when
// Jev is throttled, times out, or returns an out-of-vocab label. A policy
// decision is ALWAYS marked `decided_by: 'policy'` and surfaced as such in the
// UI — never passed off as Jev's. The defaults favour making progress and
// staying under budget: a Jev outage must degrade verification, not wedge a run.

import { DEFAULT_LABEL, type ModelLabel } from '@/lib/models'
import type { AgentRole, ComplexityTier, ExecutionMode, TaskType } from './types'

// ---- Task type -------------------------------------------------------------

// A conservative keyword classifier. It is intentionally coarse — it exists only
// so a throttled Jev still yields a sane team, not to rival Jev's judgement.
const TASK_KEYWORDS: Array<{ type: TaskType; words: RegExp }> = [
	{ type: 'coding', words: /\b(bug|debug|error|stack ?trace|compile|refactor|function|class|typescript|python|javascript|code|implement|fix)\b/i },
	{ type: 'data', words: /\b(calculate|compute|sum|total|average|percent|percentage|count|number|statistic|math|equation)\b/i },
	{ type: 'comparison', words: /\b(compare|versus|vs\.?|better|difference between|which is best|recommend(ation)?|choose between)\b/i },
	{ type: 'document_qa', words: /\b(according to (the|this)|in the (document|text|passage|file)|summariz(e|ing) (the|this)|based on the (text|document))\b/i },
	{ type: 'research', words: /\b(research|investigate|find out|latest|news|study|survey|sources?|evidence|why did|trend)\b/i }
]

export function policyTaskType(query: string): TaskType {
	// A very short query with no signal is treated as simple — one model, no team.
	const trimmed = query.trim()
	if (trimmed.length > 0 && trimmed.length <= 40 && !/[.?!]/.test(trimmed) && !/\s/.test(trimmed)) {
		return 'simple'
	}
	for (const { type, words } of TASK_KEYWORDS) {
		if (words.test(query)) return type
	}
	// Long, signal-free prose defaults to research (the safest "gather more"
	// posture); a short one defaults to simple.
	return trimmed.length > 120 ? 'research' : 'simple'
}

// ---- Complexity ------------------------------------------------------------

// Without Jev, assume the middle tier: enough orchestration to be useful, not so
// much that a throttled run burns the budget on a maybe-simple query.
export function policyComplexity(taskType: TaskType): ComplexityTier {
	switch (taskType) {
		case 'simple':
			return 'simple'
		case 'data':
		case 'document_qa':
			return 'medium'
		case 'coding':
		case 'comparison':
			return 'medium'
		case 'research':
			return 'hard'
		default:
			return 'medium'
	}
}

// ---- Team assembly ---------------------------------------------------------

// Turn the (task type, complexity, needs_* signals) into an ordered agent team.
// Work agents come first; the lead (synthesizer, or a lone answerer for simple
// tasks) comes last so the DAG can depend on the workers. The team is never the
// same fixed list — it is a function of the decision inputs (§11, D5).
export function assembleTeam(input: {
	taskType: TaskType
	complexityTier: ComplexityTier
	needsResearch: boolean
	needsCode: boolean
	needsCritic: boolean
}): AgentRole[] {
	// A trivially simple question must use ONE model and no extra agents (§11).
	if (input.taskType === 'simple' && input.complexityTier === 'simple') {
		return ['answerer']
	}

	const team: AgentRole[] = []
	// Task type can force a worker even if the needs_* signal was false — e.g. a
	// `data` task always needs the code/calculator agent, a `research`/
	// `comparison` task always needs retrieval.
	const research = input.needsResearch || input.taskType === 'research' || input.taskType === 'comparison'
	const code = input.needsCode || input.taskType === 'data' || input.taskType === 'coding'
	// A critic is added when asked for, or automatically at the harder tiers
	// (§12: escalate verification with complexity).
	const critic = input.needsCritic || input.complexityTier === 'hard' || input.complexityTier === 'very_hard'

	if (research) team.push('researcher')
	if (code) team.push('code')
	if (critic) team.push('critic')
	// The synthesizer merges worker output into the final cited answer. It is the
	// lead for any team with workers.
	team.push('synthesizer')
	return team
}

// ---- Model routing ---------------------------------------------------------

// Role -> model, used for the non-lead agents. Cheap/fast models for
// non-critical steps (§12): the researcher and code agents do bounded,
// high-volume work (gemini-flash), the critic needs careful reasoning (claude).
const ROLE_MODEL: Record<AgentRole, ModelLabel> = {
	researcher: 'gemini',
	code: 'gpt',
	critic: 'claude',
	// The lead's model is chosen by Jev (best_model); these are only the fallback
	// when Jev didn't provide one.
	synthesizer: DEFAULT_LABEL,
	answerer: DEFAULT_LABEL
}

export function policyModelForRole(role: AgentRole): ModelLabel {
	return ROLE_MODEL[role]
}

// Build the full per-agent model map. The lead (synthesizer/answerer) uses
// `leadModel` when Jev supplied one, else its policy default; every other agent
// uses its role default. Returns a map covering exactly the selected agents.
export function policyModelRouting(agents: AgentRole[], leadModel: ModelLabel | null): Record<string, ModelLabel> {
	const out: Record<string, ModelLabel> = {}
	const lead = agents[agents.length - 1]
	for (const role of agents) {
		out[role] = role === lead && leadModel ? leadModel : policyModelForRole(role)
	}
	return out
}

// ---- Execution mode --------------------------------------------------------

// Independent work agents fan out in parallel; a single worker (or a lone
// answerer) is sequential. The synthesizer always depends on the workers, so
// "parallel" here means the WORK-agent layer runs concurrently.
export function policyExecutionMode(agents: AgentRole[]): ExecutionMode {
	const workers = agents.filter((a) => a !== 'synthesizer' && a !== 'answerer')
	return workers.length > 1 ? 'parallel' : 'sequential'
}

// ---- Gate defaults (D4 / D1) ----------------------------------------------

// On a Jev outage the gates default to "proceed": sufficiency -> enough,
// validity -> valid, contradiction -> none, finalization -> pass. This keeps a
// throttled run moving instead of looping forever on research it can't get a
// Jev verdict for. The policy flag is what tells the UI (and the benchmark)
// that verification was degraded, not that it passed cleanly.
export const POLICY_GATE_DEFAULTS = {
	enough: true,
	valid: true,
	contradiction: false,
	pass: true
} as const
