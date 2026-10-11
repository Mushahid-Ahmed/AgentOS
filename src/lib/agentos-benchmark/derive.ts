// Pure derivation of the AgentOS setup's benchmark metrics from the SSE frames the
// production run stream emits (milestone 8). The benchmark's `agentos` setup runs the
// REAL production path — it consumes agentRunStreamResponse(query) in-process and reads
// the same `event:/data:` frames the browser does — so its measured cost, citations,
// evidence counts and replans are derived by folding those frames through the SAME
// pure reducer the D6 run view uses (reduceRunViewEvents). One protocol, one reducer,
// no parallel reimplementation that could drift from what the UI shows (§13).
//
// Pure: no React, no fetch, no 'server-only'. The wire is a boundary, so this never
// throws — reduceRunViewEvents already ignores malformed frames.

import { reduceRunViewEvents, type RunViewState } from '@/lib/agentos/run-view'
import type { RunFrame } from '@/lib/agentos/sse'

// Everything the benchmark needs from one AgentOS run, minus the taskId/setup the
// runner stamps on and the wall-clock latency it measures around the stream.
export type AgentosOutcome = {
	// True only when the run reached `completed` with a non-empty final answer. A
	// budget_stopped or failed run is NOT ok — its partial/error is recorded honestly
	// rather than counted as a success (§8: never claim a completion that didn't happen).
	ok: boolean
	answer: string | null
	error: string | null
	// Distinct real source URLs the finalizer cited (from the `final` event).
	citations: number
	verifiedClaims: number
	contestedClaims: number
	refutedClaims: number
	// Real spend in integer millionths of a USD (last cost_update), never fabricated.
	costMicroUsd: number
	modelCalls: number
	toolCalls: number
	replans: number
	// True when the stream refused the run because tonight's spend cap was already
	// reached. The engine treats this as a HARD STOP for the whole benchmark, not a
	// per-task failure — continuing would hammer runs that are all being refused.
	nightlyCap: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

// Scan the raw frames for the run.ts nightly-cap refusal (an `error` event whose
// payload carries code 'nightly_cap'). The run-view reducer folds that into a generic
// failed phase, losing the code, so it is read here directly off the wire.
function detectNightlyCap(frames: ReadonlyArray<RunFrame>): boolean {
	return frames.some(
		(frame) => frame.name === 'error' && isRecord(frame.data) && frame.data.code === 'nightly_cap'
	)
}

/**
 * Fold one AgentOS run's SSE frames into its benchmark metrics.
 *
 * `ok` requires a completed phase AND a non-empty answer: a run that streamed a
 * `final` but never reached the terminal `completed` status (or produced no prose) is
 * recorded as a failure with its real error, never as a silent success.
 */
export function deriveAgentosOutcome(frames: ReadonlyArray<RunFrame>): AgentosOutcome {
	const nightlyCap = detectNightlyCap(frames)
	const state: RunViewState = reduceRunViewEvents(frames)
	const answer = typeof state.finalAnswer === 'string' && state.finalAnswer.trim().length > 0
		? state.finalAnswer
		: null
	const ok = state.phase === 'complete' && state.status === 'completed' && answer != null

	return {
		ok,
		answer,
		error: ok ? null : (state.error ?? (nightlyCap ? 'nightly_cap' : 'run did not complete')),
		citations: state.citations.length,
		verifiedClaims: state.evidence.verified,
		contestedClaims: state.evidence.contested,
		refutedClaims: state.evidence.refuted,
		costMicroUsd: state.costMicroUsd,
		modelCalls: state.modelCalls,
		toolCalls: state.toolCalls,
		replans: state.replans.length,
		nightlyCap
	}
}
