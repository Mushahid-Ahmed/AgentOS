import 'server-only'
import { getModel, isModelLabel, type ModelLabel } from '@/lib/models'
import type { Agent, AgentContext, StepResult } from '@/lib/orchestra/types'
import type { PoolMessage } from '@/lib/model-pool/transport'
import { runPoolStep } from '@/server/model-pool/runner'

// The generating agents (answerer, synthesizer) — the only agents that produce
// prose. Each calls the model through the Model Pool failover runner
// (src/server/model-pool/runner.ts): the Decision-Bus-routed slug is the chain head,
// cheaper paid siblings are the failover tail (floor: the cheapest paid model), so a
// premium 402 (the credit wall) degrades to a paid fallback instead of failing this
// critical step. Every attempt is still recorded in ai_usage — the runner's transport
// wraps each call in trackAiCall, priced from token usage × the curated per-1M
// catalog (decision D-36).
//
// Researcher / code / critic agents: the researcher needs the research MCP tool
// (M5, no-search knowledge grounding per D-45), the code agent needs the calculator
// (M4), the critic needs the evidence hub (M5/M6); all three route their model calls
// through the same pool runner.

// Read a worker's contributed text out of the shared context. The lead agent is
// handed the exact worker step ids (inputs.workerIds) so it never guesses.
function readWorkerOutputs(ctx: AgentContext, input: Record<string, unknown>): string {
	const ids = Array.isArray(input.workerIds) ? (input.workerIds as string[]) : []
	if (ids.length === 0) return ''
	const blocks: string[] = []
	for (const id of ids) {
		const out = ctx.shared[id] as { text?: unknown } | undefined
		const text = typeof out?.text === 'string' ? out.text : null
		if (text) blocks.push(`[${id}]\n${text}`)
	}
	return blocks.join('\n\n')
}

export type GeneratingAgentOptions = {
	systemPrompt: string
	// Ample for a full answer. The pool's free tail does not reserve credits the way
	// a premium call does, so this no longer 402s a $0 key on its own.
	maxTokens?: number
	// The ai_usage `feature` axis this agent's spend is recorded under.
	feature: string
}

export function createGeneratingAgent(name: string, options: GeneratingAgentOptions): Agent {
	const maxTokens = options.maxTokens ?? 1024
	return {
		name,
		async run(input: Record<string, unknown>, ctx: AgentContext): Promise<StepResult> {
			// The model is the routing decision, not the agent's choice. If it isn't a
			// real label (a malformed plan that somehow passed validation), fail the
			// step honestly rather than silently substituting a default.
			if (!isModelLabel(ctx.model)) {
				return { ok: false, error: `unknown_model:${ctx.model}`, retryable: false }
			}
			const label: ModelLabel = ctx.model
			const model = getModel(label)

			const workerOutput = readWorkerOutputs(ctx, input)
			const userContent = workerOutput
				? `User query:\n${ctx.query}\n\nWorker findings:\n${workerOutput}`
				: ctx.query

			const messages: PoolMessage[] = [
				{ role: 'system', content: options.systemPrompt },
				{ role: 'user', content: userContent }
			]

			// The lead/synthesizer is high-stakes: premium leads the chain, but free
			// models remain the failover tail — which is exactly what rescues a run on
			// an unfunded key. Spend is bounded by the executor's BudgetGuard (it
			// reserves the step's model call and adds result.costMicroUsd), so the pool
			// needs no separate gate here.
			const outcome = await runPoolStep({
				messages,
				feature: options.feature,
				preferredSlug: model.slug,
				runId: ctx.runId,
				stepId: name,
				maxTokens,
				highStakes: true,
				// Surface mid-step pool failovers/circuit trips onto the Orchestra bus so
				// the run view shows the degrade live and on replay (MP-M6).
				onEvent: (event) => ctx.emit(event)
			})

			if (!outcome.ok) {
				// The pool already did its bounded retries/failover internally, so the
				// executor must not retry the whole step on top of that.
				return { ok: false, error: outcome.message, retryable: false }
			}

			return {
				ok: true,
				output: { text: outcome.content },
				// Name the model that ACTUALLY served the step (may be a free failover
				// target, not the routed label) so the run view is honest about it.
				notes: outcome.slug,
				tokens: outcome.tokens
					? { input: outcome.tokens.input, output: outcome.tokens.output }
					: undefined,
				costMicroUsd: outcome.costMicroUsd
			}
		}
	}
}
