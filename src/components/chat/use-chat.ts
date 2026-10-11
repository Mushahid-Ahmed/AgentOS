'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	ConversationEventPayload,
	DoneEventPayload,
	ErrorEventPayload,
	GetConversationResponse,
	RouteEventPayload,
	TokenEventPayload
} from '@/lib/chat-stream'

// Client-side chat state machine. Owns the POST to /api/chat, parses the SSE
// stream (conversation -> route -> token* -> done | error), and exposes the
// messages plus the per-turn routing/telemetry the workspace renders. TanStack
// Query is the template's data layer, but it buffers a response — this endpoint
// streams, so a hand-rolled fetch+reader loop is the right tool (same reason the
// server route bypasses createApiRoute).
//
// IMPORTANT (React Compiler): the streaming + loading loops live in the
// module-level `executeChatStream` / `executeLoadConversation` below, NOT inside
// the hook. babel-plugin-react-compiler only transforms component/hook
// functions, and this version cannot lower a try/catch that contains throw
// statements or value blocks (conditionals, logical/optional-chaining). With
// panicThreshold 'all_errors' such a bailout fails the build. Keeping the
// try/catch in plain module functions sidesteps that entirely — the hook stays
// straight-line and compiles cleanly.

export type ChatMessage = {
	id: string
	role: 'user' | 'assistant'
	content: string
	// Assistant turns only, filled in as the stream progresses:
	route?: RouteEventPayload
	telemetry?: DoneEventPayload
	// Set when this turn failed (or was stopped) — the bubble shows it inline.
	error?: string
	// True from send until `done`/`error`: drives the routing/streaming spinner.
	pending?: boolean
	// True when the user aborted mid-stream.
	stopped?: boolean
}

type WireMessage = { role: 'user' | 'assistant'; content: string }

function newId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Parse one SSE frame (`event: X\ndata: {...}`) into a typed event.
function parseFrame(frame: string): { event: string; data: unknown } | null {
	let event = 'message'
	const dataLines: string[] = []
	for (const line of frame.split('\n')) {
		if (line.startsWith('event:')) {
			event = line.slice(6).trim()
		} else if (line.startsWith('data:')) {
			dataLines.push(line.slice(5).trim())
		}
	}
	if (dataLines.length === 0) return null
	try {
		return { event, data: JSON.parse(dataLines.join('\n')) }
	} catch {
		return null
	}
}

// The callbacks the stream loop uses to push state back into the hook. Passed
// in (rather than closing over the hook) so this function stays module-level
// and outside the React Compiler's reach.
type StreamHandlers = {
	patch: (id: string, patch: Partial<ChatMessage>) => void
	setError: (message: string | null) => void
	getMessages: () => ChatMessage[]
	// Persisted thread id, learned from the `conversation` event. The ref is
	// updated synchronously so getConversationId reads it later in the same run.
	setConversationId: (id: string) => void
	getConversationId: () => string | null
	// Fired after a successful `done`, so the history sidebar can refresh.
	onTurnPersisted: (conversationId: string) => void
}

async function executeChatStream(
	history: WireMessage[],
	assistantId: string,
	conversationId: string | null,
	controller: AbortController,
	handlers: StreamHandlers
): Promise<void> {
	const { patch, setError, getMessages, setConversationId, getConversationId, onTurnPersisted } =
		handlers
	try {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messages: history, conversationId: conversationId ?? undefined }),
			signal: controller.signal
		})

		if (!response.ok || !response.body) {
			let detail = `Request failed (${response.status})`
			try {
				const body = (await response.json()) as { error?: string }
				if (body.error) detail = body.error
			} catch {
				// non-JSON error body; keep the status detail
			}
			patch(assistantId, { error: detail, pending: false })
			setError(detail)
			return
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''
		let accumulated = ''

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })

			let separator: number
			while ((separator = buffer.indexOf('\n\n')) !== -1) {
				const frame = buffer.slice(0, separator)
				buffer = buffer.slice(separator + 2)
				const parsed = parseFrame(frame)
				if (!parsed) continue

				switch (parsed.event) {
					case 'conversation': {
						const { conversationId: cid } = parsed.data as ConversationEventPayload
						setConversationId(cid)
						break
					}
					case 'route': {
						const route = parsed.data as RouteEventPayload
						patch(assistantId, { route })
						break
					}
					case 'token': {
						const { text } = parsed.data as TokenEventPayload
						accumulated += text
						// Snapshot in a local so the patch never races a stale value.
						const snapshot = accumulated
						patch(assistantId, { content: snapshot })
						break
					}
					case 'done': {
						const telemetry = parsed.data as DoneEventPayload
						patch(assistantId, { telemetry, pending: false })
						const cid = getConversationId()
						if (cid) onTurnPersisted(cid)
						break
					}
					case 'error': {
						const { message } = parsed.data as ErrorEventPayload
						patch(assistantId, { error: message, pending: false })
						break
					}
				}
			}
		}

		// Stream ended without a done/error event (e.g. connection dropped).
		const final = getMessages().find((m) => m.id === assistantId)
		if (final?.pending) {
			patch(assistantId, {
				pending: false,
				error: final.content ? undefined : 'Stream ended before a response arrived.'
			})
		}
	} catch (err) {
		if (controller.signal.aborted) {
			patch(assistantId, { pending: false, stopped: true })
		} else {
			const message = err instanceof Error ? err.message : 'Something went wrong.'
			patch(assistantId, { error: message, pending: false })
			setError(message)
		}
	}
}

type LoadHandlers = {
	setMessages: (messages: ChatMessage[]) => void
	setConversationId: (id: string) => void
	setError: (message: string | null) => void
	setLoading: (loading: boolean) => void
}

// Fetch a persisted conversation and hydrate it into the same ChatMessage shape
// the live stream produces, so a reloaded thread renders identically (routing
// visualizer, telemetry chips and all). Module-level for the React Compiler
// reason noted at the top.
async function executeLoadConversation(id: string, handlers: LoadHandlers): Promise<void> {
	const { setMessages, setConversationId, setError, setLoading } = handlers
	try {
		setLoading(true)
		setError(null)
		const response = await fetch(`/api/conversations/${id}`)
		if (!response.ok) {
			let detail = `Failed to load conversation (${response.status})`
			try {
				const body = (await response.json()) as { error?: string }
				if (body.error) detail = body.error
			} catch {
				// keep the status detail
			}
			setError(detail)
			return
		}
		const data = (await response.json()) as GetConversationResponse
		const messages: ChatMessage[] = data.messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			route: m.route ?? undefined,
			telemetry: m.telemetry ?? undefined
		}))
		setConversationId(id)
		setMessages(messages)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load conversation.'
		setError(message)
	} finally {
		setLoading(false)
	}
}

export type UseChatOptions = {
	// Called after a turn is persisted, with its conversation id — the workspace
	// uses it to invalidate the history-sidebar query.
	onTurnPersisted?: (conversationId: string) => void
}

export type UseChat = {
	messages: ChatMessage[]
	conversationId: string | null
	isStreaming: boolean
	isLoadingConversation: boolean
	// Top-level error (e.g. the request never opened) — distinct from a
	// per-message error, which lives on the message itself.
	error: string | null
	send: (content: string) => void
	stop: () => void
	retry: () => void
	reset: () => void
	loadConversation: (id: string) => void
}

export function useChat(options?: UseChatOptions): UseChat {
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [conversationId, setConversationIdState] = useState<string | null>(null)
	const [isStreaming, setIsStreaming] = useState(false)
	const [isLoadingConversation, setIsLoadingConversation] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Mirrors `messages` so send()/retry() can read the latest history without a
	// stale closure, and so the stream loop can look up a message by id.
	const messagesRef = useRef<ChatMessage[]>([])
	useEffect(() => {
		messagesRef.current = messages
	}, [messages])

	// Mirrors `conversationId` for the same reason; updated synchronously so the
	// stream loop can read the id it just learned from the `conversation` event.
	const conversationIdRef = useRef<string | null>(null)
	const setConversationId = useCallback((id: string | null) => {
		conversationIdRef.current = id
		setConversationIdState(id)
	}, [])

	// Keep the latest callback without making it a dependency of the stream run.
	const onTurnPersistedRef = useRef(options?.onTurnPersisted)
	useEffect(() => {
		onTurnPersistedRef.current = options?.onTurnPersisted
	})

	const abortRef = useRef<AbortController | null>(null)

	// Clean up an in-flight stream if the component unmounts mid-turn.
	useEffect(() => () => abortRef.current?.abort(), [])

	const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
		setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
	}, [])

	const runStream = useCallback(
		async (history: WireMessage[], assistantId: string) => {
			const controller = new AbortController()
			abortRef.current = controller
			setIsStreaming(true)
			setError(null)

			// All try/catch + branching lives in the module-level function so this
			// hook body stays compiler-friendly (see the note at the top).
			await executeChatStream(history, assistantId, conversationIdRef.current, controller, {
				patch: patchMessage,
				setError,
				getMessages: () => messagesRef.current,
				setConversationId,
				getConversationId: () => conversationIdRef.current,
				onTurnPersisted: (id) => onTurnPersistedRef.current?.(id)
			})

			setIsStreaming(false)
			abortRef.current = null
		},
		[patchMessage, setConversationId]
	)

	const send = useCallback(
		(content: string) => {
			const trimmed = content.trim()
			if (!trimmed || isStreaming) return

			const history: WireMessage[] = [
				...messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
				{ role: 'user', content: trimmed }
			]

			const userMessage: ChatMessage = { id: newId(), role: 'user', content: trimmed }
			const assistantId = newId()
			const assistantMessage: ChatMessage = {
				id: assistantId,
				role: 'assistant',
				content: '',
				pending: true
			}

			setMessages((prev) => [...prev, userMessage, assistantMessage])
			void runStream(history, assistantId)
		},
		[isStreaming, runStream]
	)

	const stop = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	const retry = useCallback(() => {
		if (isStreaming) return
		// Drop trailing assistant turns (failed or stopped), keeping the history
		// through the last user message, then re-run that same turn.
		const current = messagesRef.current
		let end = current.length
		while (end > 0 && current[end - 1]?.role === 'assistant') end--
		// The turn we keep must end on a user message, or there's nothing to retry.
		if (end === 0 || current[end - 1]?.role !== 'user') return
		const kept = current.slice(0, end)

		const history: WireMessage[] = kept.map((m) => ({ role: m.role, content: m.content }))
		const assistantId = newId()
		setMessages([...kept, { id: assistantId, role: 'assistant', content: '', pending: true }])
		void runStream(history, assistantId)
	}, [isStreaming, runStream])

	const reset = useCallback(() => {
		abortRef.current?.abort()
		setMessages([])
		setConversationId(null)
		setError(null)
	}, [setConversationId])

	const loadConversation = useCallback(
		(id: string) => {
			if (isStreaming || id === conversationIdRef.current) return
			abortRef.current?.abort()
			void executeLoadConversation(id, {
				setMessages,
				setConversationId,
				setError,
				setLoading: setIsLoadingConversation
			})
		},
		[isStreaming, setConversationId]
	)

	return {
		messages,
		conversationId,
		isStreaming,
		isLoadingConversation,
		error,
		send,
		stop,
		retry,
		reset,
		loadConversation
	}
}
