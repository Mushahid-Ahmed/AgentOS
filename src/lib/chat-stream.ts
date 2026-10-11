import type { ModelLabel } from '@/lib/models'

// The /api/chat Server-Sent Events wire protocol, shared by the server route
// that emits it and the client hook that parses it. Isomorphic (no
// 'server-only') so both sides import the same types and the contract can't
// drift. Every frame is `event: <type>\ndata: <json>\n\n`.
//
// Event order for a healthy turn:
//   conversation -> route -> token* -> done
// `conversation` is emitted first, as soon as the user turn is persisted, so
// the client learns the thread id even if routing or the answer stream later
// fails (an errored turn still belongs to a real conversation). A degraded
// turn still starts with `route` (Jev fell back), and any failure emits
// `error` instead of `done`.

export type ChatStreamEvent = 'conversation' | 'route' | 'token' | 'done' | 'error'

// Sent first, once the conversation + user message are persisted. Carries the
// thread id the client uses to continue the conversation and to refresh the
// history sidebar. Ids are BigInt in the database, serialized as strings here
// (JSON has no BigInt).
export type ConversationEventPayload = {
	conversationId: string
}

// Sent first, as soon as Jev has decided — before any answer text. Lets the UI
// light up the routing visualizer and model badge while tokens are still
// streaming in.
export type RouteEventPayload = {
	label: ModelLabel
	displayName: string
	shortName: string
	color: string
	// Jev's calibrated certainty (0..1).
	confidence: number
	// Per-label distribution (0..1 each) for the visualizer bars.
	probabilities: Record<ModelLabel, number>
	// Milliseconds in the Jev hop only, measured server-side. The honest number
	// the UI shows — never the brief's un-reproduced "~30-50ms".
	jevLatencyMs: number
	// True when Jev errored/timed-out/returned an out-of-vocab label and we used
	// the default. Surfaced to the user, not hidden.
	fallback: boolean
	fallbackReason?: string
}

export type TokenEventPayload = { text: string }

export type UsagePayload = {
	promptTokens: number
	completionTokens: number
	totalTokens: number
	// Cost for this request, USD, derived from NanoGPT token usage × the curated
	// per-1M catalog (NanoGPT's usage carries no cost field). Null when it can't
	// be priced; estimatedCost is always present as a fallback.
	cost: number | null
	// List-price estimate from lib/models.ts, USD. Shown when cost is null, and
	// used by the benchmark suite where a real cost isn't always captured.
	estimatedCost: number
}

// Terminal event on success. Carries the telemetry the chips and dashboard
// render: which model actually answered, and the latency/cost breakdown.
export type DoneEventPayload = {
	model: { label: ModelLabel; slug: string; displayName: string }
	// True when the answer was served by a pool failover model rather than Jev's
	// routed label (e.g. a premium 402 degraded to a verified `:free` model).
	// `model` above is always the model that ACTUALLY answered.
	degraded?: boolean
	jevLatencyMs: number
	// Wall-clock from request start to stream end, server-measured.
	totalLatencyMs: number
	usage: UsagePayload
}

export type ErrorEventPayload = { message: string }

// The request body the client POSTs.
export type ChatRequest = {
	messages: Array<{ role: 'user' | 'assistant'; content: string }>
	// Omit to start a new conversation; pass the id from a prior `conversation`
	// event to continue that thread. String form of the BigInt id.
	conversationId?: string
}

// Conversation-history endpoint contracts (GET /api/conversations and
// GET /api/conversations/[id]). Isomorphic so the server handlers and the
// client hook share one shape and can't drift. A StoredMessage reuses the same
// RouteEventPayload / DoneEventPayload the live SSE stream emits, so a reloaded
// conversation renders identically to a fresh one. BigInt ids arrive as strings.

export type ConversationSummary = {
	id: string
	title: string
	updatedAt: string
	messageCount: number
}

export type StoredMessage = {
	id: string
	role: 'user' | 'assistant'
	content: string
	createdAt: string
	route: RouteEventPayload | null
	telemetry: DoneEventPayload | null
}

export type ConversationDetail = {
	id: string
	title: string
	createdAt: string
	updatedAt: string
	messages: StoredMessage[]
}

export type ListConversationsResponse = { conversations: ConversationSummary[] }
export type GetConversationResponse = ConversationDetail
