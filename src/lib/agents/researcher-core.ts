// The Researcher agent's pure core (§11 "Researcher (RAG/web)" + §13 MCP tool
// priority 2). Split from the server wrapper so the evidence-construction logic —
// the part that must NEVER invent a claim or a source — is unit-testable at $0 with
// a mocked tool call and an in-memory evidence hub, exactly like the code agent core.
//
// Flow: call the research MCP tool (ctx.callTool), read its structured
// {text, citations}, turn each citation into an evidence record, and return the
// findings for the synthesizer. Under V3 the tool runs in NO-SEARCH mode (D-45), so
// it grounds an answer in a general model's knowledge and returns NO citations — the
// common case here is the coarse null-source record below. The span logic is kept for
// a backend that DOES cite: when a citation carries a start/end span the claim is the
// exact slice of the answer that source backs (a REAL claim<->source link, not a
// guess); when a citation carries no usable span we do NOT fabricate a per-source
// claim — we keep each real returned URL as a source for the whole finding, and only
// when the tool returns no URLs at all do we record one coarse null-source row (§8).
//
// The researcher makes NO model call of its own: the "intelligence" is the model
// inside the tool, whose real cost the executor already records against the run
// budget from ToolResult.costMicroUsd. So this step's costMicroUsd is deliberately
// left undefined — setting it would double-count the tool spend.
//
// Pure: no 'server-only', no fetch, no Prisma, no SDK. The real tool call and the
// real evidence store live behind the injected `callTool` and `evidence`.

import { RESEARCH_TOOL, type ResearchCitation } from '@/lib/mcp/research'
import type { EvidenceInput, EvidencePort } from '@/lib/evidence'
import type { StepResult, ToolResult } from '@/lib/orchestra/types'

export const RESEARCHER_AGENT = 'researcher'

// Bound the evidence rows one research step writes, so a source-heavy answer can't
// fan out into dozens of records (mirrors the parser's MAX_CITATIONS, enforced here
// too because the tool output is read defensively rather than trusted).
const MAX_EVIDENCE = 8
// Truncate the coarse-fallback claim so a long sonar answer doesn't become one
// enormous claim row; the full text is still kept in retrievedText.
const COARSE_CLAIM_CHARS = 400

export type ResearchStepDeps = {
	query: string
	// Passed to the tool so its ai_usage row is attributable to this run (the
	// process-wide MCP server can't close over a per-run id — see research-server.ts).
	runId: string
	callTool: (name: string, args: unknown) => Promise<ToolResult>
	evidence: EvidencePort
	// Free-form step note (the server wrapper passes the routed model's display name).
	notes?: string
}

type ResearchOutput = { text: string; citations: ResearchCitation[] }

// Read the research tool's structured output defensively. The registry returns the
// server's structuredContent {text, citations}; a bare-string summary (no structured
// output) degrades to text-only, and anything unreadable degrades to empty — never
// throws, never invents a citation.
export function readResearchOutput(output: unknown): ResearchOutput {
	if (typeof output === 'string') return { text: output, citations: [] }
	if (output == null || typeof output !== 'object') return { text: '', citations: [] }
	const rec = output as Record<string, unknown>
	const text = typeof rec.text === 'string' ? rec.text : ''
	const raw = Array.isArray(rec.citations) ? rec.citations : []
	const citations: ResearchCitation[] = []
	for (const item of raw) {
		if (item == null || typeof item !== 'object') continue
		const c = item as Record<string, unknown>
		if (typeof c.url !== 'string' || c.url.length === 0) continue
		const citation: ResearchCitation = { url: c.url }
		if (typeof c.title === 'string' && c.title.length > 0) citation.title = c.title
		if (typeof c.startIndex === 'number') citation.startIndex = c.startIndex
		if (typeof c.endIndex === 'number') citation.endIndex = c.endIndex
		citations.push(citation)
	}
	return { text, citations }
}

// The slice of `text` a citation backs, or null when the span is missing/degenerate/
// out of range. A null means "no honest claim<->source link" and triggers the coarse
// fallback rather than a fabricated one.
function sliceSpan(text: string, citation: ResearchCitation): string | null {
	const { startIndex, endIndex } = citation
	if (typeof startIndex !== 'number' || typeof endIndex !== 'number') return null
	if (endIndex <= startIndex || startIndex < 0 || startIndex >= text.length) return null
	const end = Math.min(endIndex, text.length)
	if (end <= startIndex) return null
	return text.slice(startIndex, end)
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
}

/**
 * Build the evidence records for a research result. One record per citation that
 * carries a usable span (claim = the cited slice, source = the real URL, retrievedText
 * = the full answer for context). De-duplicated by claim text, capped at MAX_EVIDENCE.
 *
 * When NO citation carries a usable span we cannot honestly pin a sub-claim to a
 * source, but any URLs sonar actually returned are still real sources for the finding,
 * so we keep them: one record per unique returned URL (claim = the whole truncated
 * finding, source = that URL). This is what lets the evidence-citing finalizer surface
 * real citations even when sonar omits span indices. Only when sonar returns NO citation
 * URLs at all do we fall back to a single coarse record with a null source — the honest
 * "we retrieved this but have no source to attribute" case (§8). No URL is ever invented.
 */
export function buildEvidence(text: string, citations: ResearchCitation[], agent: string): EvidenceInput[] {
	const inputs: EvidenceInput[] = []
	const seen = new Set<string>()
	const retrieved = text.trim()

	for (const citation of citations) {
		if (inputs.length >= MAX_EVIDENCE) break
		const span = sliceSpan(text, citation)
		if (span == null) continue
		const claim = span.trim()
		if (claim.length === 0 || seen.has(claim)) continue
		seen.add(claim)
		inputs.push({ claim, source: citation.url, retrievedText: retrieved || claim, discoveredByAgent: agent })
	}

	if (inputs.length === 0 && retrieved.length > 0) {
		const coarseClaim = truncate(retrieved, COARSE_CLAIM_CHARS)
		// No span-backed claim, but real source URLs may still exist. Attribute the whole
		// finding to each unique returned URL so the citations survive into the hub.
		const seenUrls = new Set<string>()
		for (const citation of citations) {
			if (inputs.length >= MAX_EVIDENCE) break
			const url = citation.url
			if (typeof url !== 'string' || url.length === 0 || seenUrls.has(url)) continue
			seenUrls.add(url)
			inputs.push({ claim: coarseClaim, source: url, retrievedText: retrieved, discoveredByAgent: agent })
		}
		// Genuinely no source to attribute: one honest coarse record with a null source.
		if (inputs.length === 0) {
			inputs.push({
				claim: coarseClaim,
				source: null,
				retrievedText: retrieved,
				discoveredByAgent: agent
			})
		}
	}

	return inputs
}

// The findings text the synthesizer reads: the answer plus a clearly-labeled source
// list, so real URLs survive into the final answer. An empty answer is reported as
// such rather than padded.
function buildFindings(text: string, citations: ResearchCitation[]): string {
	const trimmed = text.trim()
	if (trimmed.length === 0) return 'Research returned no content.'
	if (citations.length === 0) return trimmed
	const lines = citations.map((c, i) => `[${i + 1}] ${c.title ? `${c.title} — ` : ''}${c.url}`)
	return `${trimmed}\n\nSources:\n${lines.join('\n')}`
}

/**
 * Run one Researcher step: research tool -> evidence records -> findings.
 *
 * A failed tool call fails the step honestly (the researcher never invents sources).
 * A successful call with no usable content still succeeds but contributes an honest
 * "no content" finding and zero evidence, so the run continues rather than dying on a
 * thin retrieval. costMicroUsd is intentionally omitted from the result: the tool's
 * real spend is recorded by the executor from ToolResult.costMicroUsd, and echoing it
 * here would double-count against the budget.
 */
export async function runResearchStep(deps: ResearchStepDeps): Promise<StepResult> {
	const tool = await deps.callTool(RESEARCH_TOOL, { query: deps.query, runId: deps.runId })
	if (!tool.ok) {
		// §13: report the tool failed rather than invent output.
		return { ok: false, error: `research_failed: ${tool.error}`, retryable: false }
	}

	const { text, citations } = readResearchOutput(tool.output)
	const evidenceInputs = buildEvidence(text, citations, RESEARCHER_AGENT)

	const evidenceIds: string[] = []
	for (const input of evidenceInputs) {
		// A best-effort store returns '' when a write failed; only count real ids so
		// the reported evidence count never overstates what persisted.
		const id = await deps.evidence.add(input)
		if (id) evidenceIds.push(id)
	}

	return {
		ok: true,
		output: {
			text: buildFindings(text, citations),
			citations: citations.map((c) => c.url),
			evidenceIds,
			evidenceCount: evidenceIds.length
		},
		notes:
			deps.notes ??
			`research via ${RESEARCH_TOOL}: ${evidenceIds.length} claim(s), ${citations.length} source(s)`,
		// No model call in this agent; the sonar spend is the tool's, recorded already.
		tokens: { input: 0, output: 0 }
	}
}
