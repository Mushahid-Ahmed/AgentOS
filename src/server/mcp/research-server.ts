import 'server-only'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { RESEARCH_TOOL, parseResearchCompletion } from '@/lib/mcp/research'
import { getModel, costUsdFor } from '@/lib/models'
import { completeOnce, type ChatMessage } from '@/server/ai/nanogpt'
import { trackAiCall } from '@/server/lib/ai-usage/sink'

// The second AgentOS MCP tool (§13 / D3, priority 2: "research"). Same shape as
// the calculator server — one McpServer, one registered tool, tool errors returned
// as `{ isError: true }` not thrown.
//
// **No-search mode (V3, decision D-45).** NanoGPT has NO web-search-capable model
// and NO `perplexity/sonar` (0 of 632 — integration notes §8e), so this tool can no
// longer do a live retrieval. It now grounds an answer in a strong general model's
// own knowledge instead. Two honesty rules are unchanged and now load-bearing:
//  1. Citations are PARSED from the provider response (parseResearchCompletion),
//     never invented. A grounded answer carries no `annotations`, so the citation
//     list is EMPTY — an honest "no live sources", never a fabricated URL. The
//     system prompt forbids inventing one.
//  2. The call goes through trackAiCall (ledger) AND returns the real token×price
//     cost as `costMicroUsd` in structuredContent, so the registry threads true
//     spend into the run's budget guard — the per-run cap is never under-counted.
//
// `runId` is an optional tool argument, not a closure: the registry links ONE
// process-wide server instance (see registry.ts), so it cannot close over a per-run
// id. Passing it in keeps the ai_usage row attributable to the run that spent it.

// The grounded backend. A strong general model (gpt-4.1) answers from its own
// knowledge; there is no retrieval step to fund. Tracked under its short id so the
// ledger prices it from the curated table.
const RESEARCH_LABEL = 'gpt' as const
const RESEARCH_FEATURE = 'agentos_research'
// Ample for a grounded, sourced-style answer while bounding the completion cost.
const RESEARCH_MAX_TOKENS = 1024

const SYSTEM_PROMPT =
	'You are a research assistant. You have NO live web access, so answer strictly ' +
	'from your own knowledge and be explicit about uncertainty. Never invent a URL, ' +
	'a citation, or a fact; if you cannot reliably support a claim, say so plainly ' +
	'rather than guessing.'

export { RESEARCH_TOOL }

// Cost in integer millionths of a USD from the response token counts × the curated
// per-1M price for the slug (costUsdFor, src/lib/models.ts). NanoGPT returns no
// monetary cost, so this is the real spend. Undefined when the slug is uncataloged
// or no tokens were reported — never fabricated, never 0-by-accident. Mirrors the
// generating agents so a paid tool and a paid model call report cost identically.
function toCostMicroUsd(
	slug: string,
	completion: { usage?: { prompt_tokens?: number; completion_tokens?: number } }
): number | undefined {
	const usd = costUsdFor(slug, completion.usage?.prompt_tokens, completion.usage?.completion_tokens)
	return usd == null ? undefined : Math.round(usd * 1_000_000)
}

export function createResearchServer(): McpServer {
	const server = new McpServer({ name: 'agentos-research', version: '1.0.0' })

	server.registerTool(
		RESEARCH_TOOL,
		{
			title: 'Research',
			description:
				'Return a concise, knowledge-grounded answer to a research question. This tool has ' +
				'no live web access, so it returns real source URLs only when the response actually ' +
				'carries them (typically none); it never invents a citation. Use for a claim that ' +
				'needs a reasoned, sourced-as-available answer.',
			inputSchema: {
				query: z.string().min(1).max(2000),
				runId: z.string().optional()
			},
			outputSchema: {
				text: z.string(),
				// Declare every field we send: the SDK validates structuredContent against
				// this schema, so an undeclared key (the span bounds) would be stripped and
				// the researcher would lose its real claim<->source mapping.
				citations: z.array(
					z.object({
						url: z.string(),
						title: z.string().optional(),
						startIndex: z.number().optional(),
						endIndex: z.number().optional()
					})
				),
				costMicroUsd: z.number().optional()
			}
		},
		async ({ query, runId }) => {
			const slug = getModel(RESEARCH_LABEL).slug
			const messages: ChatMessage[] = [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: query }
			]
			try {
				const completion = await trackAiCall(
					{
						provider: 'openai',
						model: 'gpt-4.1',
						feature: RESEARCH_FEATURE,
						// meta is ids/enums only (docs/rules/analytics.md rule 5): no query text.
						meta: runId ? { tool: RESEARCH_TOOL, run_id: runId } : { tool: RESEARCH_TOOL }
					},
					() => completeOnce(slug, messages, RESEARCH_MAX_TOKENS)
				)

				const result = parseResearchCompletion(completion)
				const costMicroUsd = toCostMicroUsd(slug, completion)
				return {
					// The text block is what a human/agent reads when structured output is
					// ignored; keep it the real answer, or an honest empty marker.
					content: [{ type: 'text', text: result.text || 'research_returned_no_content' }],
					structuredContent: {
						text: result.text,
						citations: result.citations,
						costMicroUsd
					}
				}
			} catch (error) {
				// NanoGPTError (non-2xx / in-body error) or a transport failure. Report it
				// as a tool error rather than inventing sources — the researcher agent will
				// surface the failure honestly (§8, §13).
				const message = error instanceof Error ? error.message : 'research_call_failed'
				return { content: [{ type: 'text', text: message }], isError: true }
			}
		}
	)

	return server
}
