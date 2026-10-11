// Isomorphic types for the AgentOS run-replay API (M7 / D6). Pure types only — no
// 'server-only', no Prisma — so both the server replay builder and the client hook
// import the same shapes. The replay endpoint reconstructs the SAME wire-event list
// the live SSE stream produced, so the client folds it through the one pure reducer
// in run-view.ts and a replayed run is pixel-identical to the live one (§13).

// One reconstructed wire frame: the SSE event name + its JSON payload. This is
// exactly what `reduceRunViewEvents` consumes.
export type RunViewWireEvent = {
	name: string
	data: unknown
}

// A run as shown in the replay picker (the agent_runs row, BigInts stringified,
// money kept as integer millionths of a USD or null — never fabricated as 0).
export type RunSummary = {
	id: string
	query: string
	status: string
	taskType: string
	tier: string
	executionMode: string
	costMicroUsd: number | null
	modelCalls: number
	toolCalls: number
	replans: number
	// Whether a final answer was persisted, so the list can flag runs that finished
	// vs. failed/budget-stopped without shipping the whole answer text.
	hasFinalAnswer: boolean
	error: string | null
	createdAt: string
	finishedAt: string | null
	eventCount: number
}

export type ListRunsResponse = {
	runs: RunSummary[]
}

export type RunReplayResponse = {
	run: RunSummary
	// The time-ordered wire events: the reconstructed `run` init, every persisted
	// decision record, and every agent_event (seq order), merged by timestamp so a
	// gate decision lands just before the replan it triggered.
	events: RunViewWireEvent[]
}
