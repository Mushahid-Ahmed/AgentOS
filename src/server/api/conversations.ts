import 'server-only'
import { db } from '@/server/db/client'
import { AppError } from '@/lib/errors/app-error'
import { getModel, isModelLabel, type ModelLabel } from '@/lib/models'
import type {
	DoneEventPayload,
	GetConversationResponse,
	ListConversationsResponse,
	RouteEventPayload,
	StoredMessage
} from '@/lib/chat-stream'

// Read/delete side of conversation history (milestone 3). The write side lives
// in ./chat-store, driven by the streaming chat route. Handlers here return
// plain JSON-safe objects — BigInt ids become strings, Dates become ISO — so
// NextResponse.json never chokes on a BigInt, and the client receives the same
// RouteEventPayload / DoneEventPayload shapes the live SSE stream produces, so
// a reloaded conversation renders identically to a fresh one.

const LIST_LIMIT = 100

// Jev's fallback emits an all-zero distribution live; a persisted fallback
// stores null. Reconstruct the same zeros so the reloaded visualizer matches
// what the user saw in the moment, rather than inventing a distribution.
const EMPTY_PROBABILITIES: Record<ModelLabel, number> = { claude: 0, gpt: 0, gemini: 0 }

export async function listConversations(userId: string): Promise<ListConversationsResponse> {
	const rows = await db.conversation.findMany({
		// Ownership filter, not a nicety: without it every signed-in user gets
		// every other user's threads. A NULL user_id (the 30 rows written before
		// the column existed) matches no uuid, so legacy history is served to
		// nobody rather than to everyone.
		where: { userId },
		orderBy: { updatedAt: 'desc' },
		take: LIST_LIMIT,
		select: {
			id: true,
			title: true,
			updatedAt: true,
			_count: { select: { messages: true } }
		}
	})
	return {
		conversations: rows.map((row) => ({
			id: row.id.toString(),
			title: row.title,
			updatedAt: row.updatedAt.toISOString(),
			messageCount: row._count.messages
		}))
	}
}

function toProbabilities(value: unknown): Record<ModelLabel, number> {
	if (!value || typeof value !== 'object') return { ...EMPTY_PROBABILITIES }
	const raw = value as Record<string, unknown>
	const out = { ...EMPTY_PROBABILITIES }
	for (const label of Object.keys(out) as ModelLabel[]) {
		const n = raw[label]
		if (typeof n === 'number' && Number.isFinite(n)) out[label] = n
	}
	return out
}

export async function getConversation(
	userId: string,
	id: string
): Promise<GetConversationResponse> {
	// findFirst with the owner in the predicate, so another user's id answers 404
	// — a separate 403 would confirm the row exists, which is its own leak.
	const conversation = await db.conversation.findFirst({
		where: { id: BigInt(id), userId },
		include: { messages: { orderBy: { createdAt: 'asc' }, include: { routeEvent: true } } }
	})
	if (!conversation) throw new AppError('Conversation not found', { status: 404 })

	const messages: StoredMessage[] = conversation.messages.map((message) => {
		const role: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user'
		const ev = message.routeEvent
		let route: RouteEventPayload | null = null
		let telemetry: DoneEventPayload | null = null

		if (ev && isModelLabel(ev.chosenModel)) {
			const model = getModel(ev.chosenModel)
			const confidence = ev.confidence ?? 0
			route = {
				label: ev.chosenModel,
				displayName: model.displayName,
				shortName: model.shortName,
				color: model.color,
				confidence,
				probabilities: toProbabilities(ev.probabilities),
				jevLatencyMs: ev.jevLatencyMs,
				fallback: ev.fallback,
				fallbackReason: ev.fallbackReason ?? undefined
			}
			const promptTokens = ev.promptTokens
			const completionTokens = ev.completionTokens
			const cost = ev.costMicroUsd != null ? Number(ev.costMicroUsd) / 1_000_000 : null
			const estimatedCost =
				(promptTokens * model.promptPricePer1M + completionTokens * model.completionPricePer1M) /
				1_000_000
			telemetry = {
				model: { label: model.label, slug: model.slug, displayName: model.displayName },
				jevLatencyMs: ev.jevLatencyMs,
				totalLatencyMs: ev.totalLatencyMs ?? 0,
				usage: {
					promptTokens,
					completionTokens,
					totalTokens: promptTokens + completionTokens,
					cost,
					estimatedCost: Number(estimatedCost.toFixed(8))
				}
			}
		}

		return {
			id: message.id.toString(),
			role,
			content: message.content,
			createdAt: message.createdAt.toISOString(),
			route,
			telemetry
		}
	})

	return {
		id: conversation.id.toString(),
		title: conversation.title,
		createdAt: conversation.createdAt.toISOString(),
		updatedAt: conversation.updatedAt.toISOString(),
		messages
	}
}

export async function deleteConversation(userId: string, id: string): Promise<{ ok: true }> {
	// Cascade removes messages and route_events (schema onDelete: Cascade). The
	// owner is part of the delete key: count 0 means either no such row or not
	// yours, and both answer 404.
	const result = await db.conversation.deleteMany({ where: { id: BigInt(id), userId } })
	if (result.count === 0) throw new AppError('Conversation not found', { status: 404 })
	return { ok: true }
}
