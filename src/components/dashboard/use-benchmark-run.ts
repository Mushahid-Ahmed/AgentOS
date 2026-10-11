'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BenchmarkReport, BenchmarkStreamEvent } from '@/lib/benchmark'

// Client trigger for POST /api/benchmark (milestone 5). That endpoint streams SSE
// progress (start | wait | progress | done | error), so — exactly like the chat
// stream — this is a hand-rolled fetch+reader loop, not TanStack Query (which
// buffers). The loop lives in the module-level `executeBenchmarkRun` below so the
// try/catch that can `throw` stays out of the hook body; babel-plugin-react-compiler
// (panicThreshold 'all_errors') cannot lower a try/catch with throws inside a hook
// and would fail the build. The hook body stays straight-line.

export type BenchmarkRunState = {
	isRunning: boolean
	// Total prompts in the run, learned from the `start` event.
	total: number
	// Prompts completed so far (index of the last `progress` event).
	completed: number
	// The prompt currently being measured, for the "routing X…" line.
	currentPromptId: string | null
	currentCategory: string | null
	// Set while the engine waits out a Jev free-tier throttle, so the UI says
	// "waiting on rate limit" instead of looking hung. Cleared on next progress.
	waitNotice: string | null
	// The final report, once `done` arrives.
	report: BenchmarkReport | null
	error: string | null
}

const INITIAL_STATE: BenchmarkRunState = {
	isRunning: false,
	total: 0,
	completed: 0,
	currentPromptId: null,
	currentCategory: null,
	waitNotice: null,
	report: null,
	error: null
}

// Parse one SSE frame (`event: X\ndata: {...}`) into its JSON payload. The
// payload is self-describing (it carries `type`), so the event name is ignored.
function parseFrameData(frame: string): BenchmarkStreamEvent | null {
	const dataLines: string[] = []
	for (const line of frame.split('\n')) {
		if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
	}
	if (dataLines.length === 0) return null
	try {
		return JSON.parse(dataLines.join('\n')) as BenchmarkStreamEvent
	} catch {
		return null
	}
}

type RunHandlers = {
	onStart: (total: number) => void
	onProgress: (index: number, total: number, promptId: string, category: string) => void
	onWait: (notice: string) => void
	onDone: (report: BenchmarkReport) => void
	onError: (message: string) => void
	onAbort: () => void
}

async function executeBenchmarkRun(
	controller: AbortController,
	handlers: RunHandlers
): Promise<void> {
	const { onStart, onProgress, onWait, onDone, onError, onAbort } = handlers
	try {
		const response = await fetch('/api/benchmark', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
			signal: controller.signal
		})

		if (!response.ok || !response.body) {
			let detail = `Benchmark request failed (${response.status})`
			try {
				const body = (await response.json()) as { error?: string }
				if (body.error) detail = body.error
			} catch {
				// non-JSON error body; keep the status detail
			}
			onError(detail)
			return
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })

			let separator: number
			while ((separator = buffer.indexOf('\n\n')) !== -1) {
				const frame = buffer.slice(0, separator)
				buffer = buffer.slice(separator + 2)
				const event = parseFrameData(frame)
				if (!event) continue

				switch (event.type) {
					case 'start':
						onStart(event.total)
						break
					case 'wait': {
						const seconds = Math.max(1, Math.round(event.waitMs / 1000))
						onWait(
							`Waiting ~${seconds}s — Jev free-tier rate limit (${event.router} on ${event.promptId}).`
						)
						break
					}
					case 'progress':
						onProgress(event.index, event.total, event.promptId, event.category)
						break
					case 'done':
						onDone(event.report)
						break
					case 'error':
						onError(event.message)
						break
				}
			}
		}
	} catch (err) {
		if (controller.signal.aborted) {
			onAbort()
		} else {
			onError(err instanceof Error ? err.message : 'Something went wrong.')
		}
	}
}

export type UseBenchmarkRunOptions = {
	// Fired with the finished report after a successful `done`, so the caller can
	// select that run and invalidate the dashboard / run-history queries — the new
	// numbers appear without a manual reload.
	onDone?: (report: BenchmarkReport) => void
}

export type UseBenchmarkRun = BenchmarkRunState & {
	start: () => void
	cancel: () => void
}

export function useBenchmarkRun(options?: UseBenchmarkRunOptions): UseBenchmarkRun {
	const [state, setState] = useState<BenchmarkRunState>(INITIAL_STATE)
	const abortRef = useRef<AbortController | null>(null)

	// Keep the latest callback without making it a dependency of start().
	const onDoneRef = useRef(options?.onDone)
	useEffect(() => {
		onDoneRef.current = options?.onDone
	})

	// Cancel an in-flight run if the dashboard unmounts mid-benchmark.
	useEffect(() => () => abortRef.current?.abort(), [])

	const start = useCallback(() => {
		// Ignore a second click while a run is streaming.
		if (abortRef.current) return
		const controller = new AbortController()
		abortRef.current = controller
		setState({ ...INITIAL_STATE, isRunning: true })

		void executeBenchmarkRun(controller, {
			onStart: (total) => setState((s) => ({ ...s, total })),
			onProgress: (index, total, promptId, category) =>
				setState((s) => ({
					...s,
					completed: index,
					total,
					currentPromptId: promptId,
					currentCategory: category,
					waitNotice: null
				})),
			onWait: (notice) => setState((s) => ({ ...s, waitNotice: notice })),
			onDone: (report) => {
				setState((s) => ({
					...s,
					isRunning: false,
					report,
					waitNotice: null,
					currentPromptId: null,
					currentCategory: null
				}))
				abortRef.current = null
				onDoneRef.current?.(report)
			},
			onError: (message) => {
				setState((s) => ({ ...s, isRunning: false, error: message, waitNotice: null }))
				abortRef.current = null
			},
			onAbort: () => {
				setState((s) => ({ ...s, isRunning: false, waitNotice: null }))
				abortRef.current = null
			}
		})
	}, [])

	const cancel = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	return { ...state, start, cancel }
}
