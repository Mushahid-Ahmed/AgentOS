// The chat's per-family model degradation chain (AGENTOS_FINAL_PROMPT_V3 §5.3),
// built PURELY from the curated NanoGPT catalog (src/lib/models.ts) so it is
// deterministic, needs no network fetch, and is unit-testable at $0.
//
// Jev's routed model leads; the chain then steps DOWN to cheaper same-family
// siblings and finally to the cheapest reliable paid floor. NanoGPT has no usable
// free tier (decision D-44), so the §5.3 "free variant" rung is the cheap paid
// floor instead. The chat route (src/server/api/chat.ts) uses this as the HEAD of
// its failover chain and appends health-aware Model Pool candidates behind it for
// extra cross-family depth.
//
// "Cheaper" is the summed in+out per-1M price, so a sibling joins the chain only
// when it is a genuine step DOWN from the model above it — an UPGRADE (e.g.
// gemini-2.5-pro over the routed gemini-2.5-flash) is never inserted into a
// degradation chain. Isomorphic (no 'server-only'): it reads only the public
// catalog, and keeping it importable lets the pure unit test run without Next.

import { CHEAP_FLOOR_SLUG, NANOGPT_CATALOG, type CatalogModel } from '@/lib/models'

export type ChainLink = {
	slug: string
	// Human-readable name for the chat badge. The head keeps the routed model's
	// curated displayName; a degradation rung shows its bare NanoGPT id (the
	// publisher prefix stripped) — the honest name of the model that answered.
	displayName: string
	promptPricePer1M: number | null
	completionPricePer1M: number | null
}

// Summed per-1M price used only to ORDER the step-down. A slug missing from the
// catalog sorts as +Infinity so it never outranks a priced model as "cheaper".
function totalPrice(slug: string): number {
	const m = NANOGPT_CATALOG[slug]
	return m ? m.priceInPer1M + m.priceOutPer1M : Number.POSITIVE_INFINITY
}

// The badge name for a degradation rung: the NanoGPT id with any publisher prefix
// stripped (`anthropic/claude-haiku-4.5` -> `claude-haiku-4.5`, `gemini-2.5-flash`
// unchanged). Never derived from a '/' assumption about family — see models.ts.
function rungName(slug: string): string {
	const slash = slug.indexOf('/')
	return slash === -1 ? slug : slug.slice(slash + 1)
}

function linkFromCatalog(slug: string): ChainLink | null {
	const m: CatalogModel | undefined = NANOGPT_CATALOG[slug]
	if (!m) return null
	return {
		slug: m.slug,
		displayName: rungName(m.slug),
		promptPricePer1M: m.priceInPer1M,
		completionPricePer1M: m.priceOutPer1M
	}
}

/**
 * The ordered §5.3 degradation chain for one routed model.
 *
 * head (Jev's pick) -> cheaper same-family siblings (nearest-cheaper first) ->
 * the cheapest reliable paid floor. Every slug is a curated catalog key with a
 * known price, so each rung can be costed and never prices NULL. The head is
 * always present even if its slug is somehow not curated (prices fall back to
 * null there rather than dropping the routed model).
 */
export function familyDegradationChain(headSlug: string, headDisplayName: string): ChainLink[] {
	const headModel = NANOGPT_CATALOG[headSlug]
	const chain: ChainLink[] = [
		{
			slug: headSlug,
			displayName: headDisplayName,
			promptPricePer1M: headModel?.priceInPer1M ?? null,
			completionPricePer1M: headModel?.priceOutPer1M ?? null
		}
	]

	if (headModel) {
		const headPrice = totalPrice(headSlug)
		const siblings = Object.values(NANOGPT_CATALOG)
			.filter(
				(m) =>
					m.slug !== headSlug && m.family === headModel.family && totalPrice(m.slug) < headPrice
			)
			// Nearest-cheaper first (a gentle step-down), deterministic slug tie-break.
			.sort((a, b) => totalPrice(b.slug) - totalPrice(a.slug) || a.slug.localeCompare(b.slug))
		for (const sibling of siblings) {
			const link = linkFromCatalog(sibling.slug)
			if (link) chain.push(link)
		}
	}

	// The universal last resort. Skipped when it is already in the chain (e.g. the
	// routed model IS the floor, or a family sibling happens to be it).
	if (!chain.some((l) => l.slug === CHEAP_FLOOR_SLUG)) {
		const floor = linkFromCatalog(CHEAP_FLOOR_SLUG)
		if (floor) chain.push(floor)
	}

	return chain
}
