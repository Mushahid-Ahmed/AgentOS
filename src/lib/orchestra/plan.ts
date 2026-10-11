import type { AgentRegistry, ModelRegistry, Plan, PlanStep, ToolRegistry } from './types'

// Plan validation (§10.2): before a plan may execute it must be a well-formed
// DAG over known agents, allowed tools, and models that exist. Validation is
// pure and total — it collects EVERY problem rather than throwing on the first,
// so a bad plan from the Decision Bus is reported in full and can be repaired or
// rejected honestly instead of failing opaquely mid-run.

export type PlanIssue = {
	// Which check failed. Stable strings so callers/tests can assert on them.
	code:
		| 'empty_plan'
		| 'duplicate_step_id'
		| 'unknown_dependency'
		| 'self_dependency'
		| 'cycle'
		| 'unknown_agent'
		| 'unknown_model'
		| 'disallowed_tool'
	stepId?: string
	message: string
}

export type PlanValidation =
	| { ok: true; order: string[][] }
	| { ok: false; issues: PlanIssue[] }

export type PlanRegistries = {
	agents: AgentRegistry
	models: ModelRegistry
	// Tools are optional at the core layer: a plan may reference tools only when
	// a registry is supplied (real tools arrive in M4). When absent, any
	// toolsAllowed entry is treated as disallowed so a tool-dependent plan can't
	// silently validate against nothing.
	tools?: ToolRegistry
}

// Kahn's algorithm producing dependency LEVELS: order[i] is the set of steps
// whose dependencies are all satisfied once levels 0..i-1 are done. The executor
// runs each level's steps in parallel and levels sequentially, so returning the
// levels here (rather than a flat order) is exactly what the executor needs —
// and a graph that can't be fully leveled has a cycle.
function levels(steps: PlanStep[]): string[][] | null {
	const byId = new Map(steps.map((s) => [s.id, s]))
	const indegree = new Map<string, number>()
	const dependents = new Map<string, string[]>()
	for (const s of steps) {
		indegree.set(s.id, s.dependsOn.length)
		for (const dep of s.dependsOn) {
			const list = dependents.get(dep)
			if (list) list.push(s.id)
			else dependents.set(dep, [s.id])
		}
	}

	let frontier = steps.filter((s) => s.dependsOn.length === 0).map((s) => s.id)
	const order: string[][] = []
	let placed = 0

	while (frontier.length > 0) {
		order.push(frontier)
		placed += frontier.length
		const next: string[] = []
		for (const id of frontier) {
			for (const dep of dependents.get(id) ?? []) {
				const remaining = (indegree.get(dep) ?? 0) - 1
				indegree.set(dep, remaining)
				if (remaining === 0) next.push(dep)
			}
		}
		frontier = next
	}

	// Not every step got placed => at least one cycle. `byId` is referenced to
	// keep the intent explicit (ids are unique by the time we get here).
	void byId
	return placed === steps.length ? order : null
}

export function validatePlan(plan: Plan, registries: PlanRegistries): PlanValidation {
	const issues: PlanIssue[] = []
	const steps = plan.steps

	if (steps.length === 0) {
		issues.push({ code: 'empty_plan', message: 'plan has no steps' })
		return { ok: false, issues }
	}

	const seen = new Set<string>()
	for (const step of steps) {
		if (seen.has(step.id)) {
			issues.push({
				code: 'duplicate_step_id',
				stepId: step.id,
				message: `duplicate step id "${step.id}"`
			})
		}
		seen.add(step.id)

		if (!registries.agents[step.agent]) {
			issues.push({
				code: 'unknown_agent',
				stepId: step.id,
				message: `step "${step.id}" references unknown agent "${step.agent}"`
			})
		}

		if (!registries.models.has(step.model)) {
			issues.push({
				code: 'unknown_model',
				stepId: step.id,
				message: `step "${step.id}" references unknown model "${step.model}"`
			})
		}

		for (const tool of step.toolsAllowed) {
			if (!registries.tools?.has(tool)) {
				issues.push({
					code: 'disallowed_tool',
					stepId: step.id,
					message: `step "${step.id}" references tool "${tool}" that is not registered`
				})
			}
		}

		for (const dep of step.dependsOn) {
			if (dep === step.id) {
				issues.push({
					code: 'self_dependency',
					stepId: step.id,
					message: `step "${step.id}" depends on itself`
				})
			} else if (!seen.has(dep) && !steps.some((s) => s.id === dep)) {
				issues.push({
					code: 'unknown_dependency',
					stepId: step.id,
					message: `step "${step.id}" depends on unknown step "${dep}"`
				})
			}
		}
	}

	// Structural checks (duplicate/unknown ids) make leveling meaningless, so
	// only look for cycles once the id graph is sound.
	const structural = issues.some(
		(i) => i.code === 'duplicate_step_id' || i.code === 'unknown_dependency' || i.code === 'self_dependency'
	)
	if (!structural) {
		const order = levels(steps)
		if (order === null) {
			issues.push({ code: 'cycle', message: 'plan contains a dependency cycle' })
		} else {
			// No issues at all => hand the executor its parallel levels.
			if (issues.length === 0) return { ok: true, order }
		}
	}

	return { ok: false, issues }
}
