import 'server-only'
import type { Agent, AgentContext, StepResult } from '@/lib/orchestra/types'
import { runResearchStep } from '@/lib/agents/researcher-core'

// The Researcher agent (§11 "Researcher (RAG/web)"). A thin server wrapper: all the
// evidence-construction honesty lives in the pure core (lib/agents/researcher-core.ts),
// unit-tested at $0. Unlike the other agents it makes NO model call of its own — its
// intelligence is the research MCP tool reached through ctx.callTool (which the
// executor gates against toolsAllowed and the tool registry, and whose real cost it
// records against the run budget). So there is no trackAiCall here; the tool's own
// server tracks the spend under the `agentos_research` feature axis.
//
// **No-search mode (V3, decision D-45).** NanoGPT has no web-search model and no
// `perplexity/sonar`, so the tool now grounds an answer in a strong general model's
// own knowledge and returns citations ONLY when the response actually carries them
// (typically none). The step note below says so plainly — it must never claim a live
// "web retrieval" that did not happen.
//
// The routed model label (gemini, per ROLE_MODEL) is therefore unused by this agent —
// the executor still emits model_selected for the step, but the spend is the tool's,
// not a gemini call. That is deliberate and logged (docs/agentos-decisions-log.md D-20).

export function createResearcherAgent(): Agent {
	return {
		name: 'researcher',
		async run(input: Record<string, unknown>, ctx: AgentContext): Promise<StepResult> {
			// A replan follow-up step carries a REFINED query in its inputs so it targets
			// the evidence gap rather than repeating the original verbatim (M6/D5). The
			// first-pass researcher has no inputs.query and uses the run's query.
			const refined = typeof input.query === 'string' && input.query.trim().length > 0 ? input.query : ctx.query
			// ctx.callTool is the executor's gated bridge to the MCP tool registry; ctx.evidence
			// is the run's hub (wrapped by the executor so writes emit evidence_added events).
			return runResearchStep({
				query: refined,
				runId: ctx.runId,
				callTool: ctx.callTool,
				evidence: ctx.evidence,
				notes: refined === ctx.query ? 'knowledge-grounded research (no live web search)' : 'knowledge-grounded research (no live web search, follow-up)'
			})
		}
	}
}
