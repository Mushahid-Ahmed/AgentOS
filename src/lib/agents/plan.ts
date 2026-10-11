// Agent role metadata + the pure plan builder (D1/D5). Turns a Decision Bus
// PlanDecision into an Orchestra Plan DAG. Pure and injectable — the caller
// passes the set of agent roles that are actually REGISTERED (have a real
// implementation), so a role Jev selected but this milestone hasn't built yet is
// reported as `deferred` rather than silently dropped or crashing validation.
//
// This file has no I/O: no 'server-only', no Prisma, no fetch. It is unit tested
// under `node --test`.

import { DEFAULT_LABEL, type ModelLabel } from '@/lib/models'
import { CALCULATOR_TOOL } from '@/lib/mcp/calculator'
import { RESEARCH_TOOL } from '@/lib/mcp/research'
import type { Plan, PlanStep } from '@/lib/orchestra/types'
import type { AgentRole, PlanDecision } from '@/lib/decisions/types'

// The lead role produces the final answer and depends on every worker; a run
// without it has no answer, so its step is critical. Exactly one of these is the
// last element of an assembled team (see policy.assembleTeam).
const LEAD_ROLES: readonly AgentRole[] = ['synthesizer', 'answerer']

// Verifier roles run AFTER the primary workers and before the lead: the critic
// fact-checks the evidence the researcher gathered, so it must depend on those steps
// (a parallel critic would read an empty hub). It is not a "primary" worker itself —
// the lead depends on it, but it depends on the primaries.
const VERIFIER_ROLES: readonly AgentRole[] = ['critic']

export function isLeadRole(role: AgentRole): boolean {
	return LEAD_ROLES.includes(role)
}

// Tools each role may call (§13/D3). The `code` agent gets the calculator MCP tool
// (M4, keyless); the `researcher` gets research-sonar (M5, paid web retrieval). This
// is the one place a role's tool grant changes. The executor enforces this list before
// every tool call, so an unlisted tool can never be reached — and validatePlan rejects
// a plan whose toolsAllowed names a tool the registry lacks. The critic reads the
// evidence hub directly, so it needs no tool.
export const TOOLS_BY_ROLE: Record<AgentRole, readonly string[]> = {
	answerer: [],
	researcher: [RESEARCH_TOOL],
	code: [CALCULATOR_TOOL],
	critic: [],
	synthesizer: []
}

export type BuildPlanInput = {
	decision: PlanDecision
	// The agent roles with a real implementation in the registry this run uses.
	registered: readonly string[]
}

export type BuiltPlan = {
	plan: Plan
	// Roles Jev selected that are not yet registered — disclosed to the caller so
	// the run can report the gap honestly instead of pretending the team was full.
	deferred: AgentRole[]
}

/**
 * Build the Plan DAG from a planning decision.
 *
 * Three tiers, defined by SETS (not array position, so the DAG is stable regardless
 * of the order the team was assembled in):
 *   - primary workers (researcher, code) fan out in one parallel level, no deps;
 *   - a verifier (critic) depends on every primary worker, so it fact-checks evidence
 *     that has actually been gathered rather than reading an empty hub;
 *   - the lead depends on every worker (primaries + verifier) and is marked critical.
 *
 * Steps are keyed by role name (unique within a team). A role with no registered agent
 * is deferred and excluded from the DAG and from every dependency set, so the run still
 * executes on the agents that exist.
 */
export function buildAgentPlan({ decision, registered }: BuildPlanInput): BuiltPlan {
	const lead = decision.agents[decision.agents.length - 1]
	const steps: PlanStep[] = []
	const deferred: AgentRole[] = []

	const executable = decision.agents.filter((role) => registered.includes(role))
	// Every non-lead role the lead waits on; primaries are the subset a verifier waits on.
	const allWorkerIds = executable.filter((role) => role !== lead)
	const primaryWorkerIds = allWorkerIds.filter((role) => !VERIFIER_ROLES.includes(role))

	for (const role of decision.agents) {
		if (!registered.includes(role)) {
			deferred.push(role)
			continue
		}
		const isLead = role === lead
		const isVerifier = VERIFIER_ROLES.includes(role)
		const model: ModelLabel = decision.modelByAgent[role] ?? DEFAULT_LABEL
		// The lead reads its workers' text from the shared context (keyed by step id) and
		// is handed the exact ids so it never guesses. A verifier reads the EVIDENCE hub
		// (ctx.evidence), not worker text, so it needs no worker ids — only the ordering
		// guarantee that the primaries have run.
		const dependsOn = isLead ? [...allWorkerIds] : isVerifier ? [...primaryWorkerIds] : []
		steps.push({
			id: role,
			agent: role,
			model,
			toolsAllowed: [...TOOLS_BY_ROLE[role]],
			inputs: isLead ? { workerIds: [...allWorkerIds] } : {},
			dependsOn,
			critical: isLead
		})
	}

	return { plan: { steps }, deferred }
}
