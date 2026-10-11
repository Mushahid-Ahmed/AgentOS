// Model Pool selection policy (M2) — PURE and deterministic. Given the registry's
// models and a step's CapabilityRequest, it returns an ORDERED candidate chain
// (best-first, never a single model) that the failover loop (M3) walks. The
// Decision Bus still makes the bounded Jev decisions; this maps Jev's family/
// style choice onto concrete free/premium models and records who decided.
//
// Rules enforced here (brief §2):
//  - Hard constraints first: a candidate MUST satisfy every `needs` tag and the
//    `min_context`. A model that cannot fit the context is never selected to be
//    silently truncated — it is dropped (the caller chunks/summarises instead).
//  - Premium where quality matters (high-stakes / quality:high): premium tier
//    leads, free is the fallback tail. Free leads only for quality:fast /
//    low-risk steps.
//  - Jev's preferred slug, when it satisfies the request and is healthy, is the
//    head and the choice is `decidedBy: 'jev'`. Any substitution is
//    `decidedBy: 'pool-policy'` — never mislabelled.
//  - Health-aware: an `open` circuit is excluded (M3 owns the transitions).
//  - Deterministic tie-breaks so the same input always yields the same chain.

import type { CandidateChain, CapabilityRequest, ModelTier, PoolModel } from './types'

export type SelectOptions = {
	// Cap on chain length. A longer tail costs more failover attempts; the budget
	// guard (M3) also bounds total attempts. Default 4.
	maxChainLength?: number
	// Allow a model with an UNKNOWN context length as a last resort when nothing
	// with a known large-enough context is available. Default false (safer: an
	// unknown context cannot be proven to fit, so it is not selected to avoid a
	// silent truncation).
	allowUnknownContext?: boolean
}

// Does the model advertise every hard-required capability? `long-context` is a
// soft/measured tag driven by minContext instead, so it is not checked here; the
// structural needs are.
export function satisfiesNeeds(model: PoolModel, needs: CapabilityRequest['needs']): boolean {
	for (const need of needs) {
		switch (need) {
			case 'tool-capable':
				if (!model.capabilities.tools) return false
				break
			case 'structured-output':
				// Advertised is enough to be a candidate; verified is preferred in
				// ordering. Trusting native structured output happens at call time
				// (M4), which re-checks `structuredOutputVerified`.
				if (!model.capabilities.structuredOutputAdvertised) return false
				break
			case 'vision':
				if (!model.capabilities.vision) return false
				break
			case 'long-context':
			case 'fast':
			case 'strong-reasoning':
				// Soft/measured — handled by minContext and ordering, not a hard gate.
				break
		}
	}
	return true
}

// Context fit. A known context must be >= minContext. An unknown context is only
// acceptable when explicitly allowed AND minContext is 0 (nothing to fit).
export function fitsContext(
	model: PoolModel,
	minContext: number,
	allowUnknownContext: boolean
): boolean {
	if (model.contextLength === null) {
		return allowUnknownContext && minContext === 0
	}
	return model.contextLength >= minContext
}

// An `open` circuit is not selectable; `half-open` is (M3 uses it to probe).
export function isSelectable(model: PoolModel): boolean {
	return model.health.circuit !== 'open'
}

// Ordering score WITHIN a tier — higher is better. Prefers verified structured
// output (when needed), then measured reliability, then low latency, then larger
// context. Deterministic: falls back to slug so ties never depend on array order.
export function scoreInTier(model: PoolModel, request: CapabilityRequest): number {
	let score = 0
	if (request.needs.includes('structured-output') && model.capabilities.structuredOutputVerified) {
		score += 1000
	}
	if (model.measurements.successRate !== null) {
		// Centred at 0.5 so a MEASURED failure record actively demotes a model below
		// an unprobed one (null -> 0), and a measured success lifts it above. Without
		// the centre, "proven bad" (0) and "never tried" (null) tie, and a model that
		// 403s as app-restricted would keep leading the free tail run after run.
		score += (model.measurements.successRate - 0.5) * 500
	}
	// Only reward measured speed for a fast/balanced request; a high-stakes step
	// should not pick a weak-but-fast model over a strong slow one.
	if (request.quality !== 'high' && model.measurements.latencyMs !== null) {
		score += Math.max(0, 200 - model.measurements.latencyMs / 20)
	}
	if (model.contextLength !== null) {
		score += Math.min(100, model.contextLength / 20_000)
	}
	return score
}

// Sort comparator for a single tier: score desc, then slug asc for determinism.
function byScoreDesc(a: PoolModel, b: PoolModel, request: CapabilityRequest): number {
	const diff = scoreInTier(b, request) - scoreInTier(a, request)
	if (diff !== 0) return diff
	return a.slug.localeCompare(b.slug)
}

function partitionByTier(models: PoolModel[]): { premium: PoolModel[]; free: PoolModel[] } {
	const premium: PoolModel[] = []
	const free: PoolModel[] = []
	for (const m of models) {
		if (m.tier === 'premium') premium.push(m)
		else free.push(m)
	}
	return { premium, free }
}

// Should free models be allowed to LEAD the chain? Only for low-risk, speed-first
// steps. High-stakes and quality:high always lead with premium.
function freeLeads(request: CapabilityRequest): boolean {
	if (request.highStakes) return false
	return request.quality === 'fast'
}

export function selectCandidates(
	models: PoolModel[],
	request: CapabilityRequest,
	options: SelectOptions = {}
): CandidateChain {
	const maxChainLength = options.maxChainLength ?? 4
	const allowUnknownContext = options.allowUnknownContext ?? false

	// 1. Hard filters.
	const eligible = models.filter(
		(m) =>
			isSelectable(m) &&
			satisfiesNeeds(m, request.needs) &&
			fitsContext(m, request.minContext, allowUnknownContext)
	)

	// 2. Jev's preferred slug wins the head when it is eligible.
	const preferred = request.preferredSlug
		? eligible.find((m) => m.slug === request.preferredSlug)
		: undefined
	let decidedBy: 'jev' | 'pool-policy' = 'jev'
	if (!preferred) {
		decidedBy = 'pool-policy'
	}

	const { premium, free } = partitionByTier(eligible)
	premium.sort((a, b) => byScoreDesc(a, b, request))
	free.sort((a, b) => byScoreDesc(a, b, request))

	// 3. Build the ordered tail.
	let ordered: PoolModel[]
	if (preferred) {
		// Head is Jev's pick; the rest is premium-first (or free-first for a
		// speed step), excluding the head to avoid a duplicate.
		const rest = freeLeads(request) ? [...free, ...premium] : [...premium, ...free]
		ordered = [preferred, ...rest.filter((m) => m.slug !== preferred.slug)]
	} else if (freeLeads(request)) {
		ordered = [...free, ...premium]
	} else {
		ordered = [...premium, ...free]
	}

	const sliced = ordered.slice(0, Math.max(1, maxChainLength))
	const candidates = guaranteeTierFallback(sliced, premium, free, maxChainLength)

	return {
		candidates,
		request,
		decidedBy,
		rationale: buildRationale(request, preferred, candidates, eligible.length)
	}
}

// A chain must be able to CROSS a tier boundary, or failover is theatre. The live
// $0-key failure mode is exactly this: the catalog holds dozens of premium models,
// so a premium-first chain of length 4 is all-premium — and when the credit wall
// (402) skips every premium candidate there is no free model left to fall to, so the
// step dies instead of degrading. Symmetrically, an all-free chain cannot escape a
// free-tier rate limit. So when both tiers are eligible and the chain has room for
// two, reserve the final slot for the best candidate of whichever tier is missing.
function guaranteeTierFallback(
	candidates: PoolModel[],
	premium: PoolModel[],
	free: PoolModel[],
	maxChainLength: number
): PoolModel[] {
	if (candidates.length < 2 || maxChainLength < 2) return candidates
	let out = candidates
	const tiers = new Set(out.map((m) => m.tier))
	if (!tiers.has('free')) {
		const bestFree = free[0]
		if (bestFree) out = [...out.slice(0, -1), bestFree]
	}
	if (!tiers.has('premium')) {
		const bestPremium = premium[0]
		if (bestPremium) out = [...out.slice(0, -1), bestPremium]
	}
	// Failover DEPTH, not just presence. On a credit wall every premium candidate is
	// skipped, so the ladder's useful depth is its free portion — and a single free
	// slot was fragile: the old OpenRouter provider gated some `:free` models to
	// approved "agentic harnesses" (a 403 at call time) and others hit the
	// account-wide free rate limit. NanoGPT has no free tier, so this reserve is
	// currently inert. Reserve a second distinct free slot (swapping a non-head
	// premium slot) so one closed free model doesn't end the run.
	if (maxChainLength >= 3 && free.length >= 2) {
		const freeCount = out.filter((m) => m.tier === 'free').length
		if (freeCount < 2) {
			const extra = free.find((m) => !out.some((o) => o.slug === m.slug))
			if (extra) {
				out = out.map((m, i) => {
					if (i === 0) return m // never displace the head / Jev's pick
					if (m.tier !== 'premium') return m
					// Swap only the LAST premium slot, keeping the strongest first.
					const isLastPremium = out.slice(i + 1).every((x) => x.tier !== 'premium')
					return isLastPremium ? extra : m
				})
			}
		}
	}
	return out
}

function buildRationale(
	request: CapabilityRequest,
	preferred: PoolModel | undefined,
	candidates: PoolModel[],
	eligibleCount: number
): string {
	if (candidates.length === 0) {
		return `No model satisfies the request (needs=${request.needs.join(',') || 'none'}, minContext=${request.minContext}); ${eligibleCount} eligible of the pool. Caller must chunk, reduce the request, or fail honestly.`
	}
	const head = preferred
		? `Jev's routed model ${preferred.slug} leads`
		: `Pool policy leads with ${candidates[0]?.slug} (${freeLeads(request) ? 'free-first: speed/low-risk step' : 'premium-first: quality step'})`
	const tail = candidates.slice(1).map((m) => `${m.slug}${m.tier === 'free' ? ' (free)' : ''}`)
	const tierMix = describeTierMix(candidates)
	return `${head}; failover order: ${tail.length ? tail.join(' → ') : '(none)'}; ${tierMix}; ${eligibleCount} eligible.`
}

function describeTierMix(candidates: PoolModel[]): string {
	const { premium, free } = partitionByTier(candidates)
	const parts: string[] = []
	if (premium.length) parts.push(`${premium.length} premium`)
	if (free.length) parts.push(`${free.length} free`)
	return parts.length ? parts.join(' + ') : 'empty chain'
}

// Convenience: the tier of the head candidate, used by the degradation ladder
// (M5) to detect L2 (a free model serving a step that preferred premium).
export function headTier(chain: CandidateChain): ModelTier | null {
	return chain.candidates[0]?.tier ?? null
}
