// The research tool's pure core (§13 MCP tool priority 2, D-04/D-05). Under V3 the
// backend runs in NO-SEARCH mode (decision D-45): NanoGPT has no web-search model and
// no `perplexity/sonar`, so src/server/mcp/research-server.ts grounds the answer in a
// strong general model's own knowledge. Such a response carries NO `annotations`, so
// the citation list this parser returns is EMPTY — an honest "no live sources", never
// a fabricated URL. The parser is deliberately provider-agnostic: if a future backend
// DOES return `choices[0].message.annotations[]` as `url_citation` objects (the shape
// the old sonar probe produced — docs/agentos-integration-notes.md §3), it extracts
// those real sources and their start/end spans unchanged.
//
// This module only PARSES that response shape. It is pure — no 'server-only', no
// fetch, no SDK — so the "extract real citations, never invent one" logic is unit
// tested at $0 against the exact probe shape before the MCP server is wired. The
// server half (the real NanoGPT call) lives in src/server/mcp/research-server.ts.

import { z } from 'zod'

export const RESEARCH_TOOL = 'research'

// Bound the sources we hand downstream: the evidence hub writes one record per
// citation, and a sonar answer can return ~30. Eight real sources is ample for a
// claim and keeps the write fan-out (and the D6 roster) small.
export const MAX_CITATIONS = 8

export type ResearchCitation = {
	url: string
	title?: string
	// The character span of `text` this source backs, when the provider supplied
	// one (sonar returns start_index/end_index per url_citation). These give the
	// researcher a REAL claim<->source mapping — the claim is the cited span, not a
	// guess. Absent/undefined when the response carried no usable indices, in which
	// case the researcher falls back to a coarse whole-answer record (§8: never
	// fabricate the link).
	startIndex?: number
	endIndex?: number
}

export type ResearchResult = {
	// The sonar answer text (may carry inline [n] markers). Empty string when the
	// provider returned no content — never fabricated.
	text: string
	// Real source URLs parsed from the response annotations, de-duplicated, capped
	// at MAX_CITATIONS. Empty when the response carried none.
	citations: ResearchCitation[]
}

// The structural slice of a NanoGPT sonar completion we read. Parsed with zod
// (docs/rules/code-style.md: an external contract is parsed, never assumed) so an
// unexpected shape degrades to "no text, no citations" instead of throwing inside
// the tool handler. `content` is nullish and `annotations` nullish because both
// were observed absent/null on real calls.
//
// Annotations are read as an array of `unknown` and each is validated separately
// (below) rather than as one strict array: a sonar answer can return ~30 citations
// and a single unexpected element must not discard the text or the other real
// sources. Per-element granularity means a malformed annotation is skipped, not
// fatal.
const sonarCompletionSchema = z.object({
	choices: z
		.array(
			z.object({
				message: z
					.object({
						content: z.string().nullish(),
						annotations: z.array(z.unknown()).nullish()
					})
					.optional()
			})
		)
		.optional()
})

// One annotation, validated individually. Only `url_citation.url` is load-bearing;
// `type` is ignored so a provider that renames or drops it still yields the source.
// start_index/end_index are optional non-negative ints — the span of the answer the
// source backs — read when present so the researcher can cite the exact claim.
const annotationSchema = z.object({
	url_citation: z
		.object({
			url: z.string(),
			title: z.string().optional(),
			start_index: z.number().int().nonnegative().optional(),
			end_index: z.number().int().nonnegative().optional()
		})
		.optional()
})

/**
 * Parse a raw sonar completion into {text, citations}. Never throws and never
 * invents a source: only `url_citation` annotations carrying a non-empty string
 * `url` become citations, de-duplicated by URL and capped at MAX_CITATIONS. A
 * response with content but no annotations yields the text with an EMPTY citation
 * list — an honest "no sources returned", not a guessed one (§8).
 */
export function parseResearchCompletion(completion: unknown): ResearchResult {
	const parsed = sonarCompletionSchema.safeParse(completion)
	if (!parsed.success) return { text: '', citations: [] }

	const message = parsed.data.choices?.[0]?.message
	const text = typeof message?.content === 'string' ? message.content.trim() : ''

	const seen = new Set<string>()
	const citations: ResearchCitation[] = []
	for (const raw of message?.annotations ?? []) {
		const annotation = annotationSchema.safeParse(raw)
		if (!annotation.success) continue
		const url = annotation.data.url_citation?.url
		// Only a real, non-empty, not-yet-seen URL counts; anything else is skipped
		// rather than turned into a placeholder source.
		if (typeof url !== 'string' || url.length === 0 || seen.has(url)) continue
		seen.add(url)
		const uc = annotation.data.url_citation
		const citation: ResearchCitation = { url }
		if (typeof uc?.title === 'string' && uc.title.length > 0) citation.title = uc.title
		// Carry the span only when both bounds are present and ordered, so a
		// half-populated or reversed pair degrades to "no span" (coarse fallback)
		// rather than a bogus slice.
		if (
			typeof uc?.start_index === 'number' &&
			typeof uc?.end_index === 'number' &&
			uc.end_index > uc.start_index
		) {
			citation.startIndex = uc.start_index
			citation.endIndex = uc.end_index
		}
		citations.push(citation)
		if (citations.length >= MAX_CITATIONS) break
	}

	return { text, citations }
}
