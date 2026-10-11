// The verification ReplanPolicy (AgentOS M6): the D4 gates + D5 replan loop wired
// into the Orchestra executor's injected `replanPolicy` slot (§10.6). PURE — no
// 'server-only', no Prisma, no fetch. The real DecisionBus (with live Jev) and the
// real evidence store are INJECTED from run.ts; tests pass a mock GateDecider and an
// in-memory hub, so the gate sequencing, escalation rule, and delta selection are
// provable at $0 before a single live Jev gate fires.
//
// Flow per replan pass (the executor calls this AFTER every step level settles and
// bounds total replans via its BudgetGuard, so this only runs while a replan is
// still allowed):
//   §12 escalation  -> cheap tiers return null immediately (no gate spend).
//   Gate 1 (D4)     -> enough evidence?  NO -> D5 research delta (gather more).
//   Gate 2 (D4)     -> evidence valid?   NO -> D5 rework delta (critic + synthesizer).
//   both pass       -> null (the executor breaks the loop and finalizes).
//
// Gate records are ALREADY persisted by the DecisionBus's own sink; `onDecision`
// exists only so the run can stream each gate verdict to the SSE panel (§13) as it
// is made — it must not persist again.

import type { ComplexityTier, DecisionRecord, SufficiencyDecision, ValidityDecision } from '@/lib/decisions/types'
import type { ModelLabel } from '@/lib/models'
import type { EvidencePort } from '@/lib/evidence'
import type { PlanDelta, ReplanContext, ReplanPolicy } from '@/lib/orchestra/types'
import {
	buildResearchDelta,
	buildReworkDelta,
	refineResearchQuery,
	shouldRunGates,
	summarizeEvidenceState
} from './replan'

// The two D4 gates this policy drives. DecisionBus satisfies this structurally; a
// test passes a mock so no live Jev call is needed to prove the loop.
export type GateDecider = {
	decideEvidenceSufficiency(input: { runId: string; state: string }): Promise<SufficiencyDecision>
	decideEvidenceValidity(input: { runId: string; state: string }): Promise<ValidityDecision>
}

export type VerificationReplanOptions = {
	gates: GateDecider
	// The run's evidence hub, read (never written) here to build the gate state.
	evidence: EvidencePort
	runId: string
	query: string
	complexityTier: ComplexityTier
	// The Jev-routed lead model carried forward to any re-synthesizer delta step.
	leadModel?: ModelLabel
	// Streams each gate decision to the client as it is made (§13). Records are
	// persisted by the bus sink, not here.
	onDecision?: (record: DecisionRecord) => void
}

export function createVerificationReplanPolicy(options: VerificationReplanOptions): ReplanPolicy {
	// Tracks how many deltas this policy has produced, so step ids stay unique across
	// replans (researcher_r1, synthesizer_r1, researcher_r2, …). The executor's own
	// maxReplans bound caps how many times this closure is invoked to produce a delta.
	let replanIndex = 0

	return async (ctx: ReplanContext): Promise<PlanDelta | null> => {
		// §12 escalation: simple/medium runs never spend Jev gate calls or a replan.
		if (!shouldRunGates(options.complexityTier)) return null

		const rows = await options.evidence.list()
		const state = summarizeEvidenceState({ query: options.query, rows })

		// Gate 1 (D4): enough evidence? NO -> gather more with a refined query so the
		// follow-up targets the gap rather than repeating the first pass.
		const sufficiency = await options.gates.decideEvidenceSufficiency({ runId: options.runId, state })
		options.onDecision?.(sufficiency.record)
		if (!sufficiency.enough) {
			replanIndex += 1
			const refinedQuery = refineResearchQuery({ query: options.query, rows })
			return {
				add: buildResearchDelta({
					replanIndex,
					existing: ctx.run.plan.steps,
					leadModel: options.leadModel,
					refinedQuery
				}),
				reason: `evidence_insufficient: Jev gate 1 asked for more research (replan ${replanIndex}).`
			}
		}

		// Gate 2 (D4): evidence valid? NO -> an adversarial rework pass + re-synthesize.
		const validity = await options.gates.decideEvidenceValidity({ runId: options.runId, state })
		options.onDecision?.(validity.record)
		if (!validity.valid) {
			replanIndex += 1
			return {
				add: buildReworkDelta({ replanIndex, existing: ctx.run.plan.steps, leadModel: options.leadModel }),
				reason: `evidence_invalid: Jev gate 2 asked for rework (replan ${replanIndex}).`
			}
		}

		// Both gates pass: finalize. Returning null breaks the executor's replan loop.
		return null
	}
}
