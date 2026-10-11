'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentosBenchmarkReport } from '@/lib/agentos-benchmark/stats'
import type {
	AgentosBenchmarkSetupOutcome,
	AgentosBenchmarkStreamEvent
} from '@/lib/agentos-benchmark/wire'

// Client trigger for POST /api/agentos-benchmark (milestone 8). That endpoint streams
// SSE progress (start | progress | done | error), so — exactly like the M4 benchmark and
// the chat stream — this is a hand-rolled fetch+reader loop, not TanStack Query (which
// buffers). The loop lives in the module-level `executeAgentosBenchmark` below so the
// try/catch that can `throw` stays OUT of the hook body: babel-plugin-react-compiler
// (panicThreshold 'all_errors') cannot lower a try/catch with throws inside a hook and
// would fail the build. The hook body stays straight-line.

export type AgentosBenchmarkMode = 'pilot' | 'full'

export type AgentosBenchmarkRunState = {
	isRunning: boolean
	// Which run was started ('pilot' = 3 tasks, 'full' = all 24), null before any run.
	mode: AgentosBenchmarkMode | null
	// Tasks this run will execute, learned from the `start` event.
	total: number
	// Tasks fully completed so far (all four setups + judge).
	completed: number
	currentTaskId: string | null
	currentCategory: string | null
	// Cumulative REAL spend so far this run, in integer millionths of a USD, streamed
	// on every progress event so the UI shows the cap being respected, never exceeded.
	spentMicroUsd: number
	// The spend ceiling this run is enforcing, in USD (from the `start` event).
	capUsd: number
	// The four setup outcomes for the most recently completed task, for a live readout.
	lastOutcomes: AgentosBenchmarkSetupOutcome[]
	report: AgentosBenchmarkReport | null
	error: string | null
	errorCode: string | null
}

const INITIAL_STATE: AgentosBenchmarkRunState = {
	isRunning: false,
	mode: null,
	total: 0,
	completed: 0,
	currentTaskId: null,
	currentCategory: null,
	spentMicroUsd: 0,
	capUsd: 0,
	lastOutcomes: [],
	report: null,
	error: null,
	errorCode: null
}

// Parse one SSE frame (`event: X\ndata: {...}`) into its JSON payload. The payload is
// self-describing (it carries `type`), so the event name is ignored — same as the M4 hook.
function parseFrameData(frame: string): AgentosBenchmarkStreamEvent | null {
	const dataLines: string[] = []
	for (const line of frame.split('\n')) {
		if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
	}
	if (dataLines.length === 0) return null
	try {
		return JSON.parse(dataLines.join('\n')) as AgentosBenchmarkStreamEvent
	} catch {
		return null
	}
}

type RunHandlers = {
	onStart: (total: number, capUsd: number) => void
	onProgress: (
		index: number,
		total: number,
		taskId: string,
		category: string,
		spentMicroUsd: number,
		outcomes: AgentosBenchmarkSetupOutcome[]
	) => void
	onDone: (report: AgentosBenchmarkReport) => void
	onError: (message: string, code: string | null) => void
	onAbort: () => void
}

async function executeAgentosBenchmark(
	controller: AbortController,
	mode: AgentosBenchmarkMode,
	handlers: RunHandlers
): Promise<void> {
	const { onStart, onProgress, onDone, onError, onAbort } = handlers
	try {
		const response = await fetch('/api/agentos-benchmark', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			// pilot:true is the safe 3-task default; full runs the whole 24-task set.
			body: JSON.stringify({ pilot: mode === 'pilot' }),
			signal: controller.signal
		})

		if (!response.ok || !response.body) {
			let detail = `Benchmark request failed (${response.status})`
			let code: string | null = null
			try {
				const body = (await response.json()) as { error?: string }
				if (body.error) detail = body.error
			} catch {
				// non-JSON error body; keep the status detail
			}
			// A 409 is the nightly-cap refusal (the engine throws AppError status 409).
			if (response.status === 409) code = 'nightly_cap'
			onError(detail, code)
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
						onStart(event.taskCount, event.capUsd)
						break
					case 'progress':
						onProgress(
							event.index,
							event.total,
							event.taskId,
							event.category,
							event.spentMicroUsd,
							event.outcomes
						)
						break
					case 'done':
						onDone(event.report)
						break
					case 'error':
						onError(event.message, event.code ?? null)
						break
				}
			}
		}
	} catch (err) {
		if (controller.signal.aborted) {
			onAbort()
		} else {
			onError(err instanceof Error ? err.message : 'Something went wrong.', 'internal')
		}
	}
}

export type UseAgentosBenchmarkRunOptions = {
	// Fired with the finished report after a successful `done`, so the caller can select
	// that run and invalidate the history/report queries — fresh numbers without a reload.
	onDone?: (report: AgentosBenchmarkReport) => void
}

export type UseAgentosBenchmarkRun = AgentosBenchmarkRunState & {
	start: (mode: AgentosBenchmarkMode) => void
	cancel: () => void
}

export function useAgentosBenchmarkRun(
	options?: UseAgentosBenchmarkRunOptions
): UseAgentosBenchmarkRun {
	const [state, setState] = useState<AgentosBenchmarkRunState>(INITIAL_STATE)
	const abortRef = useRef<AbortController | null>(null)

	// Keep the latest callback without making it a dependency of start().
	const onDoneRef = useRef(options?.onDone)
	useEffect(() => {
		onDoneRef.current = options?.onDone
	})

	// Cancel an in-flight run if the panel unmounts mid-benchmark.
	useEffect(() => () => abortRef.current?.abort(), [])

	const start = useCallback((mode: AgentosBenchmarkMode) => {
		// Ignore a second click while a run is streaming.
		if (abortRef.current) return
		const controller = new AbortController()
		abortRef.current = controller
		setState({ ...INITIAL_STATE, isRunning: true, mode })

		void executeAgentosBenchmark(controller, mode, {
			onStart: (total, capUsd) => setState((s) => ({ ...s, total, capUsd })),
			onProgress: (index, total, taskId, category, spentMicroUsd, outcomes) =>
				setState((s) => ({
					...s,
					completed: index,
					total,
					currentTaskId: taskId,
					currentCategory: category,
					spentMicroUsd,
					lastOutcomes: outcomes
				})),
			onDone: (report) => {
				setState((s) => ({
					...s,
					isRunning: false,
					report,
					currentTaskId: null,
					currentCategory: null
				}))
				abortRef.current = null
				onDoneRef.current?.(report)
			},
			onError: (message, code) => {
				setState((s) => ({ ...s, isRunning: false, error: message, errorCode: code }))
				abortRef.current = null
			},
			onAbort: () => {
				setState((s) => ({ ...s, isRunning: false }))
				abortRef.current = null
			}
		})
	}, [])

	const cancel = useCallback(() => {
		abortRef.current?.abort()
	}, [])

	return { ...state, start, cancel }
}
