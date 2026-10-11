// Pure replan helpers (AgentOS M6): the D4 gate INPUT builder, the D5 plan-delta
// builders, and the §12 escalation rule. No I/O — no 'server-only', no Prisma, no
// fetch. The server-side ReplanPolicy (src/server/agentos/replan-policy.ts) calls
// the Decision Bus gates and uses these builders to turn a gate verdict into a
// valid PlanDelta. Kept pure so the escalation logic and the delta shapes (unique
// ids, sound dependsOn, correct tool grants) are unit-tested at $0 before a single
// live gate fires — a malformed delta is rejected by validatePlan and silently
// wastes a replan, so getting the shape right here matters.

import { DEFAULT_LABEL, type ModelLabel } from '@/lib/models'
import { policyModelForRole } from '@/lib/decisions/policy'
import type { ComplexityTier } from '@/lib/decisions/types'
import type { EvidenceView } from '@/lib/evidence'
import type { PlanStep } from '@/lib/orchestra/types'
import { TOOLS_BY_ROLE } from './plan'

function truncate(value: string, max: number): string {
	const trimmed = value.trim().replace(/\s+/g, ' ')
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

// ---- §12 escalation tiers --------------------------------------------------

// The D4 verification gates (evidence sufficiency -> validity) and the D5 replan
// loop only fire at the harder tiers. This mirrors the complexity criteria the
// Decision Bus routes on: `hard` = "a sufficiency check with possible replan",
// `very_hard` = "evidence verification, and a judging pass". A `simple`/`medium`
// run still gets any in-plan critic pass, but never spends Jev gate calls or a
// replan — escalating verification with complexity is the whole point of the tiers,
// and gating here keeps a cheap query cheap.
export function shouldRunGates(tier: ComplexityTier): boolean {
	return tier === 'hard' || tier === 'very_hard'
}

// ---- D4 gate input ---------------------------------------------------------

// Build the `state` string handed to the sufficiency/validity gates. It is a
// bounded, non-secret summary of the evidence hub: the query, the claim counts by
// verification status, whether any contradiction was flagged, and a short sample of
// claims with their real sources. Jev decides "enough?"/"valid?" from THIS, so it
// must reflect what was actually gathered — never padded, never invented (§8).
export function summarizeEvidenceState(input: {
	query: string
	rows: readonly EvidenceView[]
	maxClaims?: number
}): string {
	const max = input.maxClaims ?? 6
	const rows = input.rows
	const counts = { verified: 0, contested: 0, refuted: 0, unverified: 0 }
	for (const row of rows) {
		if (row.verificationStatus in counts) counts[row.verificationStatus] += 1
	}
	const contradictions = rows.filter((r) => r.relation === 'contradicts').length

	const lines: string[] = []
	lines.push(`Query: ${truncate(input.query, 200)}`)
	lines.push(
		`Evidence claims: ${rows.length} (verified ${counts.verified}, contested ${counts.contested}, refuted ${counts.refuted}, unverified ${counts.unverified}).`
	)
	if (contradictions > 0) lines.push(`Contradictions flagged: ${contradictions}.`)

	if (rows.length === 0) {
		lines.push('No evidence recorded yet.')
	} else {
		lines.push('Claims:')
		for (const [i, row] of rows.slice(0, max).entries()) {
			const src = row.source ? ` (source: ${row.source})` : ' (no source)'
			lines.push(`${i + 1}. [${row.verificationStatus}] ${truncate(row.claim, 140)}${src}`)
		}
	}
	return lines.join('\n')
}

// ---- D5 refined research query --------------------------------------------

// A follow-up research step must target the GAP, not repeat the first pass verbatim
// (that would burn a paid sonar call to retrieve the same sources). Deterministic and
// bounded: it names what the first pass already covered and instructs the tool to find
// additional, corroborating or correcting sources. With no evidence yet it simply asks
// for authoritative sources.
export function refineResearchQuery(input: { query: string; rows: readonly EvidenceView[] }): string {
	const base = truncate(input.query, 300)
	if (input.rows.length === 0) {
		return `${base} (find authoritative primary sources; no evidence gathered yet)`
	}
	// De-duplicate: the researcher's no-span fallback writes the SAME coarse claim once
	// per unique source URL, so the raw rows can repeat a claim many times. Listing each
	// distinct claim once keeps the refined query short and useful.
	const seen = new Set<string>()
	const covered: string[] = []
	for (const row of input.rows) {
		if (covered.length >= 5) break
		const claim = truncate(row.claim, 80)
		if (seen.has(claim)) continue
		seen.add(claim)
		covered.push(claim)
	}
	return `${base} — the first pass covered: ${covered.join('; ')}. Find ADDITIONAL authoritative sources that fill the gaps, corroborate or correct these claims, and address anything left unanswered.`
}

// ---- D5 plan-delta builders ------------------------------------------------

export type DeltaInput = {
	// 1-based replan counter; makes every delta step id unique across replans.
	replanIndex: number
	// The run's current merged plan steps (originals + any prior delta steps).
	existing: readonly PlanStep[]
	// Model for the new lead step. Defaults to DEFAULT_LABEL when the caller has no
	// Jev-routed lead model to carry forward.
	leadModel?: ModelLabel
}

// Ids of every worker step (researcher/code/critic) in a plan — the steps whose text
// output a synthesizer reads. Used to wire a follow-up synthesizer's workerIds so it
// re-synthesizes from ALL gathered findings, not just the newest.
function workerIds(steps: readonly PlanStep[], extra: string[] = []): string[] {
	const ids = steps.filter((s) => s.agent !== 'synthesizer' && s.agent !== 'answerer').map((s) => s.id)
	return [...ids, ...extra]
}

function researcherIds(steps: readonly PlanStep[]): string[] {
	return steps.filter((s) => s.agent === 'researcher').map((s) => s.id)
}

// Gate 1 said "insufficient evidence" -> gather more. Adds one follow-up researcher
// (granted the research tool, carrying the refined query in its inputs so the server
// researcher targets the gap) and a fresh synthesizer that depends on it and re-reads
// every worker's findings. The new synthesizer is the lead and is critical, matching
// buildAgentPlan's contract.
export function buildResearchDelta(input: DeltaInput & { refinedQuery: string }): PlanStep[] {
	const suffix = `_r${input.replanIndex}`
	const researchId = `researcher${suffix}`
	const synthId = `synthesizer${suffix}`
	const leadModel = input.leadModel ?? DEFAULT_LABEL

	const researcher: PlanStep = {
		id: researchId,
		agent: 'researcher',
		model: policyModelForRole('researcher'),
		toolsAllowed: [...TOOLS_BY_ROLE.researcher],
		// The server researcher prefers inputs.query over ctx.query, so the follow-up
		// targets the gap rather than repeating the original query.
		inputs: { query: input.refinedQuery },
		dependsOn: [],
		critical: false
	}
	const synthesizer: PlanStep = {
		id: synthId,
		agent: 'synthesizer',
		model: leadModel,
		toolsAllowed: [...TOOLS_BY_ROLE.synthesizer],
		inputs: { workerIds: workerIds(input.existing, [researchId]) },
		dependsOn: [researchId],
		critical: true
	}
	return [researcher, synthesizer]
}

// Gate 2 said "evidence invalid" -> rework. Adds an adversarial critic pass over the
// (now larger) evidence hub and a fresh synthesizer that depends on it. A critic is
// added even if the original team had one: a rework is a NEW verification pass over
// evidence that may have changed since the first critic ran. Bounded by maxReplans.
export function buildReworkDelta(input: DeltaInput): PlanStep[] {
	const suffix = `_r${input.replanIndex}`
	const criticId = `critic${suffix}`
	const synthId = `synthesizer${suffix}`
	const leadModel = input.leadModel ?? DEFAULT_LABEL

	const critic: PlanStep = {
		id: criticId,
		agent: 'critic',
		model: policyModelForRole('critic'),
		toolsAllowed: [...TOOLS_BY_ROLE.critic],
		inputs: {},
		// Run after the evidence exists. If no researcher ran, this is empty and the
		// critic simply examines whatever claims are in the hub.
		dependsOn: researcherIds(input.existing),
		critical: false
	}
	const synthesizer: PlanStep = {
		id: synthId,
		agent: 'synthesizer',
		model: leadModel,
		toolsAllowed: [...TOOLS_BY_ROLE.synthesizer],
		inputs: { workerIds: workerIds(input.existing, [criticId]) },
		dependsOn: [criticId],
		critical: true
	}
	return [critic, synthesizer]
}
