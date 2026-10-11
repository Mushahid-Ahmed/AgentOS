import 'server-only'
import { getModel, isModelLabel, type ModelLabel } from '@/lib/models'
import type { Agent, AgentContext, StepResult } from '@/lib/orchestra/types'
import { runCodeStep, type CodeCompleter } from '@/lib/agents/code-agent-core'
import type { PoolMessage } from '@/lib/model-pool/transport'
import { runPoolStep } from '@/server/model-pool/runner'

// The Code/Data agent (§11 "Code/Data agent (calculator/code)") — the first agent
// that calls a real MCP tool. All the honesty logic (translate -> evaluate ->
// never invent a number) lives in the pure core (lib/agents/code-agent-core.ts),
// unit-tested at $0. This thin server wrapper injects the two side effects the
// core can't have: the real model call — now via the Model Pool failover runner so a
// premium 402 degrades to a verified free model (each attempt tracked in ai_usage by
// the runner's transport) — and the real calculator tool (ctx.callTool, which the
// executor gates against the step's toolsAllowed and the MCP tool registry).

export type CodeAgentOptions = {
	// The ai_usage `feature` axis this agent's spend is recorded under.
	feature: string
	// The model outputs only a short expression, so the cap stays small.
	maxTokens?: number
}

export function createCodeAgent(options: CodeAgentOptions): Agent {
	const maxTokens = options.maxTokens ?? 64
	return {
		name: 'code',
		async run(_input: Record<string, unknown>, ctx: AgentContext): Promise<StepResult> {
			// Narrow the routed model before building the completer: getModel is keyed by
			// ModelLabel. A non-label fails the step honestly (the pure core guards this
			// too) and never reaches a paid call.
			if (!isModelLabel(ctx.model)) {
				return { ok: false, error: `unknown_model:${ctx.model}`, retryable: false }
			}
			const label: ModelLabel = ctx.model
			const model = getModel(label)

			// One model call per step, via the pool runner so its tokens/cost are recorded
			// under this agent's feature axis and a premium 402 fails over to free.
			const completer: CodeCompleter = async (messages) => {
				const outcome = await runPoolStep({
					// CodeMessage[] roles are a subset of the pool's message roles.
					messages: messages as PoolMessage[],
					feature: options.feature,
					preferredSlug: model.slug,
					runId: ctx.runId,
					stepId: 'code',
					maxTokens,
					// Surface mid-step pool failovers/circuit trips onto the Orchestra bus
					// so the run view shows the degrade live and on replay (MP-M6).
					onEvent: (event) => ctx.emit(event)
				})
				// The pure core catches a throwing completer and turns it into an honest
				// failed StepResult, so a pool exhaustion surfaces as a step failure.
				if (!outcome.ok) throw new Error(outcome.message)
				return {
					text: outcome.content,
					tokens: outcome.tokens ?? { input: 0, output: 0 },
					costMicroUsd: outcome.costMicroUsd
				}
			}

			// ctx.callTool is the executor's gated bridge to the MCP tool registry: it
			// enforces toolsAllowed, reserves the tool-call budget slot, and emits the
			// tool_call/tool_result events, so the agent just calls it.
			return runCodeStep({
				query: ctx.query,
				model: ctx.model,
				completer,
				callTool: ctx.callTool,
				maxTokens,
				notes: model.displayName
			})
		}
	}
}
