'use client'
import { useQuery } from '@tanstack/react-query'
import type { ListRunsResponse, RunReplayResponse } from '@/lib/agentos/replay'

// TanStack Query data layer for the D6 replay picker (M7). Two read-only GETs: the
// run history and one run's reconstructed wire-event stream. The component folds the
// returned events through the same pure reducer the live stream uses, so replay and
// live render identically. Fetchers are module-level (not inline arrows) so a `throw`
// never sits inside the hook body — the same React Compiler constraint as the chat
// and benchmark hooks.

export const AGENT_RUNS_QUERY_KEY = ['agentos-runs'] as const
export const agentRunReplayKey = (id: string) => ['agentos-run', id] as const

async function fetchRuns(): Promise<ListRunsResponse> {
	const response = await fetch('/api/agentos/runs')
	if (!response.ok) throw new Error(`Failed to load AgentOS runs (${response.status})`)
	return (await response.json()) as ListRunsResponse
}

async function fetchReplay(id: string): Promise<RunReplayResponse> {
	const response = await fetch(`/api/agentos/runs/${id}`)
	if (!response.ok) throw new Error(`Failed to load run ${id} (${response.status})`)
	return (await response.json()) as RunReplayResponse
}

export function useAgentRuns() {
	return useQuery({ queryKey: AGENT_RUNS_QUERY_KEY, queryFn: fetchRuns })
}

// One run's replay. `id === null` (nothing selected) disables the query so it never
// fires a request for an empty key.
export function useRunReplay(id: string | null) {
	return useQuery({
		queryKey: agentRunReplayKey(id ?? ''),
		enabled: id !== null,
		queryFn: () => fetchReplay(id ?? '')
	})
}
