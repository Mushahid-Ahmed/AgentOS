// Model Pool quality safeguards (M4) — PURE. Free models are weaker, so the brief
// (§5) requires two gates before an answer is trusted:
//   1. An ANSWER-QUALITY / citation gate: every claim is either cited to real
//      evidence or explicitly marked as model knowledge. A claim with neither — or
//      one citing an evidence id that does not exist (a fabricated citation, which is
//      worse than none) — is `unsupported`, and the answer does not pass the gate.
//   2. CROSS-CHECKING for verification: the same sub-question answered by two models
//      must AGREE and both be EVIDENCE-GROUNDED (cite >=1 real evidence id). A
//      disagreement is flagged `contested`; an ungrounded verdict is flagged so weak
//      reasoning cannot invent a verification it did not actually ground.
//
// Nothing here calls a model or touches the DB — it audits structures the caller
// already has, so it is unit-tested at $0 with fixed inputs.

export type ClaimInput = {
	text: string
	// Evidence ids the model claims support this claim.
	evidenceIds?: string[]
	// The model explicitly labelled this as its own knowledge, not retrieved evidence.
	markedModelKnowledge?: boolean
}

export type ClaimStatus = 'cited' | 'model-knowledge' | 'unsupported'

export type ClaimAuditItem = { text: string; status: ClaimStatus; missingIds: string[] }

export type ClaimAudit = {
	items: ClaimAuditItem[]
	total: number
	cited: number
	modelKnowledge: number
	unsupported: number
	// The gate passes only when no claim is unsupported.
	ok: boolean
}

function idSet(known: Set<string> | readonly string[]): Set<string> {
	return known instanceof Set ? known : new Set(known)
}

// Audit a list of claims against the set of evidence ids that actually exist.
export function auditClaims(
	claims: readonly ClaimInput[],
	knownEvidenceIds: Set<string> | readonly string[]
): ClaimAudit {
	const known = idSet(knownEvidenceIds)
	const items: ClaimAuditItem[] = []
	let cited = 0
	let modelKnowledge = 0
	let unsupported = 0

	for (const claim of claims) {
		const ids = claim.evidenceIds ?? []
		const valid = ids.filter((id) => known.has(id))
		const missing = ids.filter((id) => !known.has(id))
		let status: ClaimStatus
		if (valid.length > 0) {
			status = 'cited'
			cited++
		} else if (claim.markedModelKnowledge) {
			// No valid citation, but honestly labelled as model knowledge. A claim that
			// cited ONLY non-existent ids is not "model knowledge" — it is a fabricated
			// citation, which we count as unsupported.
			status = missing.length > 0 ? 'unsupported' : 'model-knowledge'
			if (status === 'model-knowledge') modelKnowledge++
			else unsupported++
		} else {
			status = 'unsupported'
			unsupported++
		}
		items.push({ text: claim.text, status, missingIds: missing })
	}

	return {
		items,
		total: claims.length,
		cited,
		modelKnowledge,
		unsupported,
		ok: unsupported === 0
	}
}

// ---- Cross-checking verification verdicts ----------------------------------

export type GroundedVerdict = {
	modelSlug: string
	// Free-text verdict from the model; normalized before comparison.
	verdict: string
	citedEvidenceIds?: string[]
}

export type NormalizedVerdict = 'supported' | 'refuted' | 'uncertain' | 'unknown'

// Collapse a free-text verdict to a small canonical label so two models phrasing the
// same conclusion differently still compare equal. Conservative: anything not clearly
// supported/refuted/uncertain is `unknown` (never guessed into agreement). Refuted is
// checked BEFORE supported so a stem like "incorrect" is never read as "correct".
// Limitation (documented, not hidden): this is label matching, not negation parsing —
// callers should emit canonical labels; "not supported" is not disambiguated here.
export function normalizeVerdict(verdict: string): NormalizedVerdict {
	const v = (verdict ?? '').toLowerCase().trim()
	if (/\b(refut\w*|false|reject\w*|contradict\w*|debunk\w*|incorrect|wrong|invalid)\b/.test(v)) {
		return 'refuted'
	}
	if (/\b(support\w*|uphold\w*|true|verif\w*|correct|confirm\w*|accurate)\b/.test(v)) {
		return 'supported'
	}
	if (/\b(uncertain|unclear|inconclusive|mixed|ambiguous)\b/.test(v)) return 'uncertain'
	return 'unknown'
}

export type CrossCheck = {
	agree: boolean
	// A disagreement between the two models — surfaced as contested evidence.
	contested: boolean
	// Both verdicts cite >=1 evidence id that actually exists.
	bothGrounded: boolean
	a: { slug: string; normalized: NormalizedVerdict; grounded: boolean }
	b: { slug: string; normalized: NormalizedVerdict; grounded: boolean }
	reason: string
	// The cross-check is trustworthy enough to gate on only if the models agree AND
	// both are grounded. Otherwise the caller must escalate or mark contested.
	ok: boolean
}

export function crossCheckVerdicts(
	a: GroundedVerdict,
	b: GroundedVerdict,
	knownEvidenceIds: Set<string> | readonly string[]
): CrossCheck {
	const known = idSet(knownEvidenceIds)
	const aNorm = normalizeVerdict(a.verdict)
	const bNorm = normalizeVerdict(b.verdict)
	const aGrounded = (a.citedEvidenceIds ?? []).some((id) => known.has(id))
	const bGrounded = (b.citedEvidenceIds ?? []).some((id) => known.has(id))
	const agree = aNorm === bNorm && aNorm !== 'unknown'
	const contested = !agree
	const bothGrounded = aGrounded && bGrounded

	let reason: string
	if (!agree) {
		reason = `models disagree (${a.modelSlug}=${aNorm} vs ${b.modelSlug}=${bNorm}) — contested`
	} else if (!bothGrounded) {
		reason = `models agree (${aNorm}) but not both evidence-grounded — verification not trusted`
	} else {
		reason = `models agree (${aNorm}) and both cite real evidence — cross-check passed`
	}

	return {
		agree,
		contested,
		bothGrounded,
		a: { slug: a.modelSlug, normalized: aNorm, grounded: aGrounded },
		b: { slug: b.modelSlug, normalized: bNorm, grounded: bGrounded },
		reason,
		ok: agree && bothGrounded
	}
}
