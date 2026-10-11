// The Decision Bus (§11) — the one module that makes AND records every bounded
// decision in a run. Pure and injectable: the Jev transport (`ask`), the clock,
// and the persistence sink are all constructor deps, so the entire bus is unit
// tested with a mocked ask before a real Jev hop (mirrors the Orchestra core).
//
// Contract per §11: validate every output against a schema; on invalid output /
// timeout / error, use a documented policy fallback, FLAG it (`decided_by:
// 'policy'`), and continue. Never crash a run silently, and never label a
// rule-based decision as Jev's (§6).
//
// NOTE ON LATENCY: the whole planning pass is ONE batched Jev call (the free
// tier bills `state` once and throttles per call — §1b). Every planning record
// therefore carries the SAME batch latencyMs; callers must not sum them as if
// they were independent hops. Gate calls are single-question and timed on their
// own.

import {
	PLAN_QUESTION,
	planningQuestions,
	sufficiencyQuestions,
	validityQuestions,
	contradictionQuestions,
	finalizationQuestions,
	SUFFICIENCY_QUESTION,
	VALIDITY_QUESTION,
	CONTRADICTION_QUESTION,
	FINALIZATION_QUESTION
} from './questions'
import {
	parseComplexityTier,
	parseConfidence,
	parseBinaryGate,
	parseTaskType,
	parseYesNo
} from './schema'
import {
	assembleTeam,
	policyComplexity,
	policyExecutionMode,
	policyModelForRole,
	policyModelRouting,
	policyTaskType,
	POLICY_GATE_DEFAULTS
} from './policy'
import type { ModelLabel } from '@/lib/models'
import { isModelLabel } from '@/lib/models'
import type {
	AgentRole,
	ComplexityTier,
	ContradictionDecision,
	DecisionBusDeps,
	DecisionRecord,
	FinalizationDecision,
	JevAnswerView,
	PlanDecision,
	SufficiencyDecision,
	TaskType,
	ValidityDecision
} from './types'

// Trim a query to a short, non-secret summary for the persisted record. Bounded
// so a huge prompt can't bloat every decision row; never contains a key.
function summarize(query: string, max = 200): string {
	const trimmed = query.trim().replace(/\s+/g, ' ')
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

export class DecisionBus {
	private readonly ask: DecisionBusDeps['ask']
	private readonly now: () => number
	private readonly sink?: (record: DecisionRecord) => void | Promise<void>

	constructor(deps: DecisionBusDeps) {
		this.ask = deps.ask
		this.now = deps.now ?? (() => Date.now())
		this.sink = deps.record
	}

	// Persist one record best-effort: a failed write must never fail a decision
	// (§11 "continue"). Errors are swallowed by design; the record is still
	// returned so the caller can stream/persist it through the run's own path.
	private record<T>(record: DecisionRecord<T>): DecisionRecord<T> {
		if (this.sink) {
			try {
				const result = this.sink(record)
				if (result && typeof result.catch === 'function') {
					result.catch(() => {})
				}
			} catch {
				// never let a persistence failure break a decision
			}
		}
		return record
	}

	/**
	 * The planning pass (D1 "What is needed?"): ONE batched Jev call decides task
	 * type, complexity, the team, per-agent model routing, and execution mode.
	 * Each answer is validated; any that Jev didn't return in-vocab falls back to
	 * policy for THAT decision only. Always resolves to a usable PlanDecision —
	 * even a total Jev outage yields a full policy plan, so a run never stalls at
	 * planning.
	 */
	async planRun(input: { runId: string; query: string }): Promise<PlanDecision> {
		const { runId, query } = input
		const inputSummary = summarize(query)
		const at = this.now()

		const outcome = await this.ask(query, planningQuestions())
		const jevOk = outcome.ok
		// The batch latency is attributed to every planning record (see file note).
		const latencyMs = outcome.latencyMs
		const answers: Record<string, JevAnswerView> = jevOk ? outcome.answers : {}
		const askError = jevOk ? null : outcome.error

		// --- task_type ---
		const jevTaskType = jevOk ? parseTaskType(answers[PLAN_QUESTION.taskType]) : null
		const taskType: TaskType = jevTaskType ?? policyTaskType(query)
		const taskTypeRecord = this.record<TaskType>({
			kind: 'task_type',
			runId,
			inputSummary,
			output: taskType,
			decidedBy: jevTaskType ? 'jev' : 'policy',
			confidence: jevTaskType ? parseConfidence(answers[PLAN_QUESTION.taskType]) : null,
			latencyMs,
			at,
			rationale: jevTaskType
				? `Jev classified the query as ${taskType} (batched 6-question plan call).`
				: `Policy fallback (${askError ?? 'invalid Jev label'}): keyword classifier -> ${taskType}.`
		})

		// --- complexity ---
		const jevComplexity = jevOk ? parseComplexityTier(answers[PLAN_QUESTION.complexity]) : null
		const complexityTier: ComplexityTier = jevComplexity ?? policyComplexity(taskType)
		const complexityRecord = this.record<ComplexityTier>({
			kind: 'complexity',
			runId,
			inputSummary,
			output: complexityTier,
			decidedBy: jevComplexity ? 'jev' : 'policy',
			confidence: jevComplexity ? parseConfidence(answers[PLAN_QUESTION.complexity]) : null,
			latencyMs,
			at,
			rationale: jevComplexity
				? `Jev tiered the query as ${complexityTier}.`
				: `Policy fallback (${askError ?? 'invalid Jev label'}): tier derived from task_type=${taskType}.`
		})

		// --- required_agents (team) ---
		// The needs_* answers drive the team. If Jev answered all three in-vocab,
		// the composition is genuinely Jev's; otherwise the whole team is policy.
		const jevResearch = jevOk ? parseYesNo(answers[PLAN_QUESTION.needsResearch]) : null
		const jevCode = jevOk ? parseYesNo(answers[PLAN_QUESTION.needsCode]) : null
		const jevCritic = jevOk ? parseYesNo(answers[PLAN_QUESTION.needsCritic]) : null
		const teamFromJev = jevResearch !== null && jevCode !== null && jevCritic !== null
		const needsResearch = teamFromJev ? (jevResearch as boolean) : taskType === 'research' || taskType === 'comparison'
		const needsCode = teamFromJev ? (jevCode as boolean) : taskType === 'data' || taskType === 'coding'
		const needsCritic = teamFromJev
			? (jevCritic as boolean)
			: complexityTier === 'hard' || complexityTier === 'very_hard'
		const agents = assembleTeam({ taskType, complexityTier, needsResearch, needsCode, needsCritic })
		const requiredAgentsRecord = this.record<AgentRole[]>({
			kind: 'required_agents',
			runId,
			inputSummary,
			output: agents,
			decidedBy: teamFromJev ? 'jev' : 'policy',
			// A set has no single confidence; report the lowest of the three needs_*
			// confidences when Jev drove it, else null (a rule has no confidence).
			confidence: teamFromJev
				? Math.min(
						parseConfidence(answers[PLAN_QUESTION.needsResearch]) ?? 0,
						parseConfidence(answers[PLAN_QUESTION.needsCode]) ?? 0,
						parseConfidence(answers[PLAN_QUESTION.needsCritic]) ?? 0
					)
				: null,
			latencyMs,
			at,
			rationale: teamFromJev
				? `Jev needs_* -> research=${needsResearch}, code=${needsCode}, critic=${needsCritic}; assembled [${agents.join(', ')}].`
				: `Policy fallback (${askError ?? 'partial/invalid needs_* answers'}): team from task_type+complexity -> [${agents.join(', ')}].`
		})

		// --- model_selection (per agent) ---
		// The LEAD model comes from Jev's best_model when valid; the non-lead
		// agents use role defaults (a documented deterministic extension). The
		// record is marked 'jev' only when Jev supplied the lead model, and the
		// rationale states exactly which parts are Jev vs policy so the aggregate
		// is never mistaken for a fully-Jev decision (§6).
		const rawBestModel = jevOk ? answers[PLAN_QUESTION.bestModel]?.choice : undefined
		const jevLeadModel: ModelLabel | null = isModelLabel(rawBestModel) ? rawBestModel : null
		const lead = agents[agents.length - 1] ?? 'synthesizer'
		const modelByAgent = policyModelRouting(agents, jevLeadModel)
		const modelSelectionRecord = this.record<Record<string, ModelLabel>>({
			kind: 'model_selection',
			runId,
			inputSummary,
			output: modelByAgent,
			decidedBy: jevLeadModel ? 'jev' : 'policy',
			confidence: jevLeadModel ? parseConfidence(answers[PLAN_QUESTION.bestModel]) : null,
			latencyMs,
			at,
			rationale: jevLeadModel
				? `Jev best_model=${jevLeadModel} routes the lead (${lead}); non-lead agents use role defaults (${agents
						.filter((a) => a !== lead)
						.map((a) => `${a}->${modelByAgent[a]}`)
						.join(', ') || 'none'}).`
				: `Policy fallback (${askError ?? 'invalid best_model'}): all agents by role default; lead (${lead}) -> ${policyModelForRole(lead)}.`
		})

		// --- execution_mode (deterministic from the DAG shape) ---
		const executionMode = policyExecutionMode(agents)
		const executionModeRecord = this.record<typeof executionMode>({
			kind: 'execution_mode',
			runId,
			inputSummary,
			output: executionMode,
			// Always policy: the fan-out shape is a deterministic function of the
			// team, not a Jev judgement. Marking it policy is the honest label.
			decidedBy: 'policy',
			confidence: null,
			latencyMs: 0,
			at,
			rationale: `${agents.length > 2 ? 'Multiple independent work agents' : 'A single work agent'} -> ${executionMode}.`
		})

		return {
			taskType,
			complexityTier,
			agents,
			executionMode,
			modelByAgent,
			records: [taskTypeRecord, complexityRecord, requiredAgentsRecord, modelSelectionRecord, executionModeRecord]
		}
	}

	// ---- D4 / D1 gates (single-question Jev calls, own timing) -------------

	/**
	 * Gate 1 (D4): "Enough evidence?" YES -> run the critic; NO -> plan delta with
	 * more research. Policy fallback defaults to `enough` (proceed) so a Jev
	 * outage can't trap a run in an endless research loop; the policy flag is what
	 * tells the UI verification was degraded.
	 */
	async decideEvidenceSufficiency(input: { runId: string; state: string }): Promise<SufficiencyDecision> {
		const decision = await this.binaryGate({
			kind: 'evidence_sufficiency',
			runId: input.runId,
			state: input.state,
			questions: sufficiencyQuestions(),
			questionKey: SUFFICIENCY_QUESTION,
			positive: 'enough',
			negative: 'insufficient',
			policyDefault: POLICY_GATE_DEFAULTS.enough,
			summarizeAs: 'evidence gathered so far'
		})
		return {
			enough: decision.value,
			record: decision.record as DecisionRecord<{ enough: boolean }>
		}
	}

	/**
	 * Gate 2 (D4): "Evidence valid?" YES -> finalize; NO -> rework plan delta.
	 * Policy fallback defaults to `valid` (proceed).
	 */
	async decideEvidenceValidity(input: { runId: string; state: string }): Promise<ValidityDecision> {
		const decision = await this.binaryGate({
			kind: 'evidence_validity',
			runId: input.runId,
			state: input.state,
			questions: validityQuestions(),
			questionKey: VALIDITY_QUESTION,
			positive: 'valid',
			negative: 'invalid',
			policyDefault: POLICY_GATE_DEFAULTS.valid,
			summarizeAs: 'critic-reviewed evidence'
		})
		return { valid: decision.value, record: decision.record as DecisionRecord<{ valid: boolean }> }
	}

	/** Contradiction detection feeding the skeptic (D2 relation graph). */
	async decideContradiction(input: { runId: string; state: string }): Promise<ContradictionDecision> {
		const decision = await this.binaryGate({
			kind: 'contradiction',
			runId: input.runId,
			state: input.state,
			questions: contradictionQuestions(),
			questionKey: CONTRADICTION_QUESTION,
			positive: 'yes',
			negative: 'no',
			policyDefault: POLICY_GATE_DEFAULTS.contradiction,
			summarizeAs: 'gathered claims'
		})
		return {
			contradiction: decision.value,
			record: decision.record as DecisionRecord<{ contradiction: boolean }>
		}
	}

	/** Finalization (D1 PASS/REWORK). Policy fallback defaults to `pass`. */
	async decideFinalization(input: { runId: string; state: string }): Promise<FinalizationDecision> {
		const decision = await this.binaryGate({
			kind: 'finalization',
			runId: input.runId,
			state: input.state,
			questions: finalizationQuestions(),
			questionKey: FINALIZATION_QUESTION,
			positive: 'pass',
			negative: 'rework',
			policyDefault: POLICY_GATE_DEFAULTS.pass,
			summarizeAs: 'verified answer'
		})
		return { pass: decision.value, record: decision.record as DecisionRecord<{ pass: boolean }> }
	}

	// One shared implementation for the four two-label gate decisions: ask, parse
	// the positive/negative label, fall back to the documented default on any
	// failure, and emit exactly one record. `value` is the boolean in the
	// decision's own terms (enough/valid/contradiction/pass).
	private async binaryGate(spec: {
		kind: DecisionRecord['kind']
		runId: string
		state: string
		questions: ReturnType<typeof sufficiencyQuestions>
		questionKey: string
		positive: string
		negative: string
		policyDefault: boolean
		summarizeAs: string
	}): Promise<{ value: boolean; record: DecisionRecord<Record<string, boolean>> }> {
		const at = this.now()
		const outcome = await this.ask(spec.state, spec.questions)
		const latencyMs = outcome.latencyMs
		const inputSummary = summarize(`${spec.summarizeAs}: ${spec.state}`)

		if (!outcome.ok) {
			const output = { [gateOutputKey(spec.kind)]: spec.policyDefault }
			const record = this.record({
				kind: spec.kind,
				runId: spec.runId,
				inputSummary,
				output,
				decidedBy: 'policy',
				confidence: null,
				latencyMs,
				at,
				rationale: `Policy fallback (Jev ${outcome.error}): defaulted to ${spec.policyDefault ? spec.positive : spec.negative}.`
			})
			return { value: spec.policyDefault, record }
		}

		const answer = outcome.answers[spec.questionKey]
		const parsed = parseBinaryGate(answer, spec.positive, spec.negative)
		if (parsed === null) {
			const output = { [gateOutputKey(spec.kind)]: spec.policyDefault }
			const record = this.record({
				kind: spec.kind,
				runId: spec.runId,
				inputSummary,
				output,
				decidedBy: 'policy',
				confidence: null,
				latencyMs,
				at,
				rationale: `Policy fallback (invalid Jev label ${JSON.stringify(answer?.choice)}): defaulted to ${
					spec.policyDefault ? spec.positive : spec.negative
				}.`
			})
			return { value: spec.policyDefault, record }
		}

		const output = { [gateOutputKey(spec.kind)]: parsed }
		const record = this.record({
			kind: spec.kind,
			runId: spec.runId,
			inputSummary,
			output,
			decidedBy: 'jev',
			confidence: parseConfidence(answer),
			latencyMs,
			at,
			rationale: `Jev answered ${answer?.choice} (confidence ${parseConfidence(answer) ?? 'n/a'}).`
		})
		return { value: parsed, record }
	}
}

// The single boolean key each gate's output object uses, so the persisted output
// reads naturally (e.g. { enough: true }) and matches the typed *Decision shapes.
function gateOutputKey(kind: DecisionRecord['kind']): string {
	switch (kind) {
		case 'evidence_sufficiency':
			return 'enough'
		case 'evidence_validity':
			return 'valid'
		case 'contradiction':
			return 'contradiction'
		case 'finalization':
			return 'pass'
		default:
			return 'value'
	}
}
