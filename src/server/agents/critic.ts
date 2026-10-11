import 'server-only'
import { getModel, isModelLabel, type ModelLabel } from '@/lib/models'
import type { Agent, AgentContext, StepResult } from '@/lib/orchestra/types'
import { runCriticStep, type CriticCompleter } from '@/lib/agents/critic-core'
import type { PoolMessage } from '@/lib/model-pool/transport'
import { runPoolStep } from '@/server/model-pool/runner'

// The Skeptic / Fact-Checker (§11). All the "read evidence, judge it, never invent a
// verdict for a claim that isn't there" logic lives in the pure core
// (lib/agents/critic-core.ts), unit-tested at $0. This thin wrapper injects the one
// side effect the core can't have: the real model call — now via the Model Pool
// failover runner so a premium 402 degrades to a cheaper paid sibling instead of
// failing verification. Each attempt is recorded in ai_usage by the runner's
// transport (trackAiCall, priced from token usage × the curated per-1M catalog).
// The evidence hub (ctx.evidence) is the run's, injected by the executor.

export type CriticAgentOptions = {
	// The ai_usage `feature` axis this agent's spend is recorded under.
	feature: string
	// One short JSON pass over a handful of claims; the cap stays small.
	maxTokens?: number
}

export function createCriticAgent(options: CriticAgentOptions): Agent {
	const maxTokens = options.maxTokens ?? 512
	return {
		name: 'critic',
		async run(_input: Record<string, unknown>, ctx: AgentContext): Promise<StepResult> {
			// Narrow the routed model before building the completer: getModel is keyed by
			// ModelLabel. A non-label fails the step honestly (the pure core guards this
			// too) and never reaches a paid call.
			if (!isModelLabel(ctx.model)) {
				return { ok: false, error: `unknown_model:${ctx.model}`, retryable: false }
			}
			const label: ModelLabel = ctx.model
			const model = getModel(label)

			const completer: CriticCompleter = async (messages) => {
				// Verification is high-stakes: premium leads, free is the failover tail.
				const outcome = await runPoolStep({
					// CriticMessage[] roles are a subset of the pool's message roles.
					messages: messages as PoolMessage[],
					feature: options.feature,
					preferredSlug: model.slug,
					runId: ctx.runId,
					stepId: 'critic',
					maxTokens,
					highStakes: true,
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

			return runCriticStep({
				model: ctx.model,
				evidence: ctx.evidence,
				completer,
				maxTokens,
				notes: model.displayName
			})
		}
	}
}
