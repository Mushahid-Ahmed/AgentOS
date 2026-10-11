'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	applyRunViewEvent,
	initialRunViewState,
	type RunViewState
} from '@/lib/agentos/run-view'
import { parseRunFrame, splitFrames } from '@/lib/agentos/sse'

// Client trigger for POST /api/agentos (M7 / D6). That endpoint streams the AgentOS
// run as SSE — a `run` init frame, `decision` frames, then the executor's typed
// orchestration events, ending with `final` or `error`. Like the chat and benchmark
// streams this is a hand-rolled fetch+reader loop (TanStack Query buffers), and the
// loop lives in the module-level `executeAgentRun` below so the try/catch that can
// `throw` stays OUT of the hook body: babel-plugin-react-compiler (panicThreshold
// 'all_errors') cannot lower a throwing try/catch inside a hook and would fail the
// build. The hook body stays straight-line; every frame is folded through the one
// pure reducer in run-view.ts, so a live run and a replay share identical logic.
// Frame parsing + splitting live in the pure @/lib/agentos/sse module (unit-tested).

type RunHandlers = {
	onFrame: (name: string, data: unknown) => void
	onEnd: () => void
	onTransportError: (message: string) => void
	onAbort: () => void
}

async function executeAgentRun(
	controller: AbortController,
	query: string,
	handlers: RunHandlers
): Promise<void> {
	const { onFrame, onEnd, onTransportError, onAbort } = handlers
	try {
		const response = await fetch('/api/agentos', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query }),
			signal: controller.signal
		})

		if (!response.ok || !response.body) {
			let detail = `Run request failed (${response.status})`
			try {
				const body = (await response.json()) as { error?: string }
				if (body.error) detail = body.error
			} catch {
				// non-JSON error body; keep the status detail
			}
			onTransportError(detail)
			return
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })

			const { frames, rest } = splitFrames(buffer)
			buffer = rest
			for (const frame of frames) {
				const parsed = parseRunFrame(frame)
				if (parsed) onFrame(parsed.name, parsed.data)
			}
		}
		onEnd()
	} catch (err) {
		if (controller.signal.aborted) {
			onAbort()
		} else {
			onTransportError(err instanceof Error ? err.message : 'Something went wrong.')
		}
	}
}

export type UseAgentRun = {
	view: RunViewState
	isStreaming: boolean
	// A transport-level failure (non-200, network) — distinct from a run-level `error`
	// event, which the reducer records on `view.error`.
	transportError: string | null
	start: (query: string) => void
	cancel: () => void
	reset: () => void
}

export function useAgentRun(): UseAgentRun {
	const [view, setView] = useState<RunViewState>(initialRunViewState)
	const [isStreaming, setIsStreaming] = useState(false)
	const [transportError, setTransportError] = useState<string | null>(null)
	const abortRef = useRef<AbortController | null>(null)

	// Cancel an in-flight run if the view unmounts mid-stream.
	useEffect(() => () => abortRef.current?.abort(), [])

	const start = useCallback((query: string) => {
		const trimmed = query.trim()
		// Ignore a second start while a run is streaming, and an empty query.
		if (abortRef.current || trimmed.length === 0) return
		const controller = new AbortController()
		abortRef.current = controller
		setView(initialRunViewState())
		setTransportError(null)
		setIsStreaming(true)

		void executeAgentRun(controller, trimmed, {
			onFrame: (name, data) =>
				setView((s) => {
					const next = applyRunViewEvent(s, name, data)
					return { ...next, eventCount: next.eventCount + 1 }
				}),
			onEnd: () => {
				setIsStreaming(false)
				abortRef.current = null
			},
			onTransportError: (message) => {
				setIsStreaming(false)
				setTransportError(message)
				abortRef.current = null
			},
			onAbort: () => {
				setIsStreaming(false)
				abortRef.current = null
			}
		})
	}, [])

	const cancel = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	const reset = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
		setIsStreaming(false)
		setTransportError(null)
		setView(initialRunViewState())
	}, [])

	return { view, isStreaming, transportError, start, cancel, reset }
}
