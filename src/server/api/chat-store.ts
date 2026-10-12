import 'server-only'
import { db, Prisma } from '@/server/db/client'
import { captureError } from '@/lib/observability/capture-error'
import type { ModelLabel } from '@/lib/models'

// Persistence for the chat pipeline, split out of src/server/api/chat.ts so the
// streaming orchestration stays readable. Every function here is best-effort by
// design: a database failure costs a saved transcript, never the user's answer,
// so each swallows its own errors (reported to Sentry) and returns null. This
// mirrors the ai-usage sink's "a failed row never breaks the call" rule.
//
// Ids are BigInt in the database and cross the wire as strings (JSON has no
// BigInt); the conversions live at this boundary.

const TITLE_MAX = 60

function deriveTitle(content: string): string {
	const line = content.trim().split('\n')[0]?.trim() || 'New chat'
	return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

// P2003 is a failed foreign-key check. `messages` has exactly one FK
// (conversation_id), so on a message insert it can only mean the parent
// conversation row is gone.
function isMissingConversation(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
}

export type PersistedRoute = {
	chosenModel: ModelLabel
	jevLatencyMs: number
	confidence: number | null
	probabilities: Record<ModelLabel, number> | null
	fallback: boolean
	fallbackReason: string | null
	ttftMs: number | null
	totalLatencyMs: number | null
	promptTokens: number
	completionTokens: number
	costMicroUsd: bigint | null
}

/**
 * Resolve the conversation for this turn and persist the new user message(s).
 *
 * With a known `conversationId`, only the newest user turn is written (earlier
 * turns were persisted on their own requests). Without one — or when the id no
 * longer exists (deleted thread) — a new conversation is created and the whole
 * input history is written, titled from its first user turn.
 *
 * Returns the conversation id, or null if persistence failed (the turn still
 * streams; it just isn't saved).
 */
export async function persistUserTurn(input: {
	conversationId: string | null
	messages: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<bigint | null> {
	try {
		const lastUser = [...input.messages].reverse().find((m) => m.role === 'user')
		if (!lastUser) return null

		if (input.conversationId) {
			const id = BigInt(input.conversationId)
			// Write first, don't ask permission. The previous shape read the
			// conversation back before inserting, which put a full cross-region
			// round trip (~1.8s) in front of every chat turn just to find out whether
			// the thread still exists. `messages.conversation_id` carries a real FK
			// (20260930135431_add_jev_swarm_persistence), so Postgres already knows: a
			// deleted thread rejects the insert with P2003, which is the same signal
			// the probe returned as `existing === null`. Any other failure rethrows to
			// the catch below.
			try {
				await db.message.create({
					data: { conversationId: id, role: 'user', content: lastUser.content }
				})
				return id
			} catch (error) {
				if (!isMissingConversation(error)) throw error
				// The client pointed at a thread that no longer exists; start a fresh
				// one rather than failing the turn.
			}
		}

		const firstUser = input.messages.find((m) => m.role === 'user')
		const conversation = await db.conversation.create({
			data: {
				title: deriveTitle(firstUser?.content ?? lastUser.content),
				messages: {
					create: input.messages.map((m) => ({ role: m.role, content: m.content }))
				}
			}
		})
		return conversation.id
	} catch (error) {
		captureError(error, { feature: 'chat_persistence', op: 'persistUserTurn' })
		return null
	}
}

/**
 * Persist the completed assistant turn plus its routing/telemetry record, and
 * bump the conversation's updatedAt so the history sidebar reorders. Best-effort:
 * returns null on failure.
 */
export async function persistAssistantTurn(input: {
	conversationId: bigint
	content: string
	route: PersistedRoute
}): Promise<bigint | null> {
	try {
		// Both writes in one round trip of wall clock. They touch different tables
		// and neither reads the other's result — the message row references the
		// conversation by the id the caller already holds — so running them in
		// series put a second cross-region RTT (~1.8s) on the tail of every reply,
		// after the last token had already streamed. On failure the message insert
		// simply returns no id, matching the previous behaviour where a rejected
		// turn propagated to the catch below.
		const [message] = await Promise.all([
			db.message.create({
				data: {
					conversationId: input.conversationId,
					role: 'assistant',
					content: input.content,
					routeEvent: {
						create: {
							chosenModel: input.route.chosenModel,
							jevLatencyMs: input.route.jevLatencyMs,
							confidence: input.route.confidence,
							probabilities:
								input.route.probabilities == null
									? Prisma.DbNull
									: (input.route.probabilities as Prisma.InputJsonValue),
							fallback: input.route.fallback,
							fallbackReason: input.route.fallbackReason,
							ttftMs: input.route.ttftMs,
							totalLatencyMs: input.route.totalLatencyMs,
							promptTokens: input.route.promptTokens,
							completionTokens: input.route.completionTokens,
							costMicroUsd: input.route.costMicroUsd
						}
					}
				}
			}),
			db.conversation.update({
				where: { id: input.conversationId },
				data: { updatedAt: new Date() }
			})
		])
		return message.id
	} catch (error) {
		captureError(error, { feature: 'chat_persistence', op: 'persistAssistantTurn' })
		return null
	}
}
