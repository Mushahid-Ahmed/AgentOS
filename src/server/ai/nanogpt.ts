import 'server-only'
import { env } from '@/lib/env'

// NanoGPT completion client — the ONE place that knows the base URL and the auth
// header (AGENTOS_FINAL_PROMPT_V3 §5.0 "One client module"). Raw `fetch` + manual
// SSE parsing, not an SDK: we stream over fetch so we control the exact event shape
// handed to the chat route, and there is no NanoGPT SDK dependency to justify.
// NanoGPT speaks the OpenAI chat-completions wire format.
//
// Migrated from OpenRouter (V3 Workstream 0). Differences that matter:
//  - Base URL `https://api.nano-gpt.com/v1` (verified live 2026-10-08).
//  - Auth is `Authorization: Bearer <NANOGPT_API_KEY>` ONLY. The OpenRouter-specific
//    `HTTP-Referer` / `X-Title` attribution headers are GONE (V3 §5.0 req 3).
//  - `usage` carries token counts but NO monetary `cost` field (verified). Cost is
//    therefore computed downstream from tokens × the curated per-1M price table in
//    src/lib/models.ts (see src/server/lib/ai-usage/pricing.ts) — never read here.
//
// This file owns the NANOGPT_API_KEY; it never leaves the server and is never logged.

const NANOGPT_URL = 'https://api.nano-gpt.com/v1/chat/completions'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type StreamUsage = {
	promptTokens: number
	completionTokens: number
	totalTokens: number
}

export type StreamEvent =
	| { type: 'token'; text: string }
	| { type: 'usage'; usage: StreamUsage }
	// `status` is the HTTP status when the failure came from a non-2xx response or
	// an in-body error code, so a caller can classify (e.g. fail over on 402/429)
	// without string-matching the message. Undefined for transport-level errors.
	| { type: 'error'; message: string; status?: number }

// Thrown by completeOnce on a non-2xx response. Carries the HTTP status so the
// caller (the benchmark judge) can retry 429/5xx and fail fast on 4xx — a
// plain Error would force it to string-match the message.
export class NanoGPTError extends Error {
	readonly status: number
	constructor(status: number, message: string) {
		super(message)
		this.name = 'NanoGPTError'
		this.status = status
	}
}

// The raw non-streaming chat-completions response, OpenAI wire format. Returned
// whole (not pre-digested) so it can be handed straight to trackAiCall, whose
// `openai` extractor already knows how to read id/model/usage/finish_reason out of
// exactly this shape.
export type NanoGPTCompletion = {
	id?: string
	model?: string
	choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>
	usage?: NanoGPTUsage
	error?: { message?: string; code?: number }
}

// NanoGPT normalizes every upstream provider into ONE OpenAI-shaped `usage` object
// (verified live): OpenAI-style `prompt_tokens`/`completion_tokens` plus a superset
// of detail fields. There is deliberately NO `cost` — NanoGPT does not return a
// monetary figure, so cost is derived from tokens × the curated price table.
type NanoGPTUsage = {
	prompt_tokens?: number
	completion_tokens?: number
	total_tokens?: number
	input_tokens?: number
	prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
	completion_tokens_details?: { reasoning_tokens?: number }
	cache_creation_input_tokens?: number
	cache_read_input_tokens?: number
	reasoning_tokens?: number
	citation_tokens?: number
	num_search_queries?: number
}

type NanoGPTChunk = {
	choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>
	usage?: NanoGPTUsage
	error?: { message?: string; code?: number }
}

function toStreamUsage(usage: NanoGPTUsage): StreamUsage {
	return {
		promptTokens: usage.prompt_tokens ?? 0,
		completionTokens: usage.completion_tokens ?? 0,
		totalTokens: usage.total_tokens ?? 0
	}
}

function authHeaders(): Record<string, string> {
	return {
		Authorization: `Bearer ${env.NANOGPT_API_KEY}`,
		'Content-Type': 'application/json'
	}
}

/**
 * Stream a chat completion from NanoGPT for the given model slug.
 *
 * An async generator so the caller can forward each token to the SSE response
 * as it arrives, and read the terminal `usage` event for telemetry. Yields
 * `{type:'error'}` (rather than throwing) for anything recoverable mid-stream
 * so the caller can emit a clean SSE error event; a failure to even start the
 * request throws and is caught by the chat route.
 */
export async function* streamCompletion(
	slug: string,
	messages: ChatMessage[]
): AsyncGenerator<StreamEvent> {
	const response = await fetch(NANOGPT_URL, {
		method: 'POST',
		headers: authHeaders(),
		body: JSON.stringify({
			model: slug,
			messages,
			// Cap the completion so a runaway answer can't blow the per-run spend
			// cap. 1024 is ample for a chat answer; cost is bounded, not reserved.
			max_tokens: 1024,
			stream: true,
			// Without this NanoGPT omits usage from the stream and we would have no
			// token counts to price the call from (there is no usage.cost to read).
			stream_options: { include_usage: true }
		})
	})

	if (!response.ok) {
		const text = await response.text().catch(() => '')
		yield {
			type: 'error',
			message: `NanoGPT ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
			status: response.status
		}
		return
	}

	if (!response.body) {
		yield { type: 'error', message: 'NanoGPT returned an empty stream body' }
		return
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	// SSE frames are separated by a blank line; a chunk boundary can land
	// mid-frame, so carry the tail between reads.
	let buffer = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })

			let separator: number
			while ((separator = buffer.indexOf('\n\n')) !== -1) {
				const frame = buffer.slice(0, separator)
				buffer = buffer.slice(separator + 2)

				// A frame may carry several `data:` lines; concatenate them.
				const dataLines = frame
					.split('\n')
					.filter((line) => line.startsWith('data:'))
					.map((line) => line.slice(5).trim())
				if (dataLines.length === 0) continue

				const data = dataLines.join('\n')
				if (data === '[DONE]') return

				let parsed: NanoGPTChunk
				try {
					parsed = JSON.parse(data) as NanoGPTChunk
				} catch {
					continue // ignore keep-alive / malformed frames
				}

				if (parsed.error?.message) {
					const code = parsed.error.code
					yield {
						type: 'error',
						message: parsed.error.message,
						status: typeof code === 'number' && Number.isFinite(code) ? code : undefined
					}
					return
				}

				const token = parsed.choices?.[0]?.delta?.content
				if (token) {
					yield { type: 'token', text: token }
				}

				// usage arrives on its own final chunk (choices empty).
				if (parsed.usage) {
					yield { type: 'usage', usage: toStreamUsage(parsed.usage) }
				}
			}
		}
	} finally {
		reader.releaseLock()
	}
}

/**
 * Single-shot (non-streaming) chat completion.
 *
 * The benchmark judge and the AgentOS agents only need one answer, so streaming
 * would just add SSE parsing for no benefit. Returns the raw OpenAI-shaped
 * response so trackAiCall's `openai` extractor reads its usage unchanged.
 * Throws NanoGPTError (carrying the HTTP status) on a non-2xx response or an
 * in-body error, so the caller can retry 429/5xx and fail fast on 4xx.
 */
export async function completeOnce(
	slug: string,
	messages: ChatMessage[],
	maxTokens = 16
): Promise<NanoGPTCompletion> {
	const response = await fetch(NANOGPT_URL, {
		method: 'POST',
		headers: authHeaders(),
		body: JSON.stringify({
			model: slug,
			messages,
			// The judge answers with a single label; 16 tokens is ample and bounds
			// the cost of every non-streaming call.
			max_tokens: maxTokens,
			stream: false
		})
	})

	if (!response.ok) {
		const text = await response.text().catch(() => '')
		throw new NanoGPTError(
			response.status,
			`NanoGPT ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
		)
	}

	const data = (await response.json()) as NanoGPTCompletion
	if (data.error?.message) {
		// A 200 that still carries an in-body error (provider-level failure).
		throw new NanoGPTError(data.error.code ?? 502, data.error.message)
	}
	return data
}
