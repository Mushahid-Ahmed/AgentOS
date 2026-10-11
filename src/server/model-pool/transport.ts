import 'server-only'
import {
	completeOnce,
	NanoGPTError,
	type ChatMessage,
	type NanoGPTCompletion
} from '@/server/ai/nanogpt'
import { costUsdFor } from '@/lib/models'
import { trackAiCall } from '@/server/lib/ai-usage/sink'
import { getModelRegistry } from './registry'
import {
	createPoolTransport,
	PoolCallError,
	type PoolCompletion,
	type PoolMessage
} from '@/lib/model-pool/transport'
import type { CallModel } from '@/lib/model-pool/failover'

// The server side of the Model Pool transport. The pure attempt logic (privacy
// guard, empty-output trap, error classification, probe recording) lives in
// src/lib/model-pool/transport.ts and is unit-tested at $0; this file owns the
// three real seams it injects:
//   1. `completeOnce` — the NanoGPT HTTP call (src/server/ai/nanogpt.ts).
//   2. `trackAiCall` — the ai_usage ledger, so every pool attempt is one priced
//      row. Per decision D-36 a runtime slug is a legal `model`, and because
//      NanoGPT speaks the OpenAI wire format we track it as `provider: 'openai'`
//      so the openai extractor applies and the row is priced from tokens × the
//      curated per-1M table (NanoGPT returns no usage.cost — never a rate-card
//      guess, never $0-by-accident).
//   3. `recordProbe` — the process-wide registry singleton, so measured latency /
//      success rate / `fast` tags accumulate across every agent in the process.
//
// This file owns no secret beyond what nanogpt.ts already holds; the key never
// leaves the server and is never logged.

// Map NanoGPT's raw completion onto the pure transport's normalized shape.
// An in-body error on a 200 (provider-level fault) is surfaced as a PoolCallError
// so the runner classifies and fails over instead of treating it as blank content.
// costUsd is computed from the token counts × the curated per-1M price (costUsdFor,
// src/lib/models.ts): NanoGPT returns no monetary cost, so this is the only honest
// figure. Null when the slug is uncataloged — the pure transport folds null into
// the failover budget as 0, the same known gap the ledger reports as a NULL row.
function toPoolCompletion(completion: NanoGPTCompletion, slug: string): PoolCompletion {
	if (completion.error?.message) {
		throw new PoolCallError(completion.error.code ?? 502, completion.error.message)
	}
	const choice = completion.choices?.[0]
	const rawPrompt = completion.usage?.prompt_tokens
	const rawCompletion = completion.usage?.completion_tokens
	const promptTokens =
		typeof rawPrompt === 'number' && Number.isFinite(rawPrompt) ? rawPrompt : null
	const completionTokens =
		typeof rawCompletion === 'number' && Number.isFinite(rawCompletion) ? rawCompletion : null
	return {
		content: choice?.message?.content ?? null,
		costUsd: costUsdFor(slug, promptTokens, completionTokens),
		finishReason: choice?.finish_reason ?? null,
		promptTokens,
		completionTokens
	}
}

export type ServerPoolTransportOptions = {
	// The step's prompt. Cast is safe: PoolMessage and ChatMessage are the same
	// OpenAI wire shape, kept as separate types only to keep the pure core
	// server-import-free.
	messages: PoolMessage[]
	// What the spend is FOR (the ai_usage `feature` column) — e.g. 'agent_research'.
	feature: string
	// Cap the completion. Defaults to completeOnce's own default.
	maxTokens?: number
	// Override the probe sink (tests); defaults to the process-wide registry.
	recordProbe?: (slug: string, result: { ok: boolean; latencyMs: number }) => void
}

export function createServerPoolTransport(options: ServerPoolTransportOptions): CallModel {
	const registry = getModelRegistry()
	const recordProbe =
		options.recordProbe ?? ((slug, result) => registry.recordProbe(slug, result))

	return createPoolTransport({
		messages: options.messages,
		now: () => Date.now(),
		recordProbe,
		complete: async (slug, messages) => {
			try {
				const completion = await trackAiCall(
					{ provider: 'openai', model: slug, feature: options.feature },
					() => completeOnce(slug, messages as ChatMessage[], options.maxTokens)
				)
				return toPoolCompletion(completion, slug)
			} catch (error) {
				// trackAiCall has already recorded the error row by the time it rethrows.
				if (error instanceof PoolCallError) throw error
				if (error instanceof NanoGPTError) {
					throw new PoolCallError(error.status, error.message)
				}
				const message = error instanceof Error ? error.message : String(error)
				throw new PoolCallError(null, message)
			}
		}
	})
}
