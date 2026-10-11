'use client'
import { useQuery } from '@tanstack/react-query'
import type { AgentosBenchmarkReport } from '@/lib/agentos-benchmark/stats'
import type { ListAgentosBenchmarkRunsResponse } from '@/lib/agentos-benchmark/wire'

// TanStack Query data layer for the AgentOS four-setup benchmark panel (milestone 8).
// Two read-only GETs: the run history and one run's recomputed report. Fetchers are
// module-level (not inline arrows) so a `throw` never sits inside the hook body — the
// same React Compiler constraint that keeps the streaming loop out of the run hook.

export const AGENTOS_BENCHMARK_RUNS_QUERY_KEY = ['agentos-benchmark-runs'] as const
export const agentosRunReportQueryKey = (id: string) => ['agentos-benchmark-run', id] as const

async function fetchAgentosRuns(): Promise<ListAgentosBenchmarkRunsResponse> {
	const response = await fetch('/api/agentos-benchmark/runs')
	if (!response.ok) throw new Error(`Failed to load AgentOS benchmark runs (${response.status})`)
	return (await response.json()) as ListAgentosBenchmarkRunsResponse
}

async function fetchAgentosRunReport(id: string): Promise<AgentosBenchmarkReport> {
	const response = await fetch(`/api/agentos-benchmark/runs/${id}`)
	if (!response.ok) throw new Error(`Failed to load AgentOS benchmark report (${response.status})`)
	return (await response.json()) as AgentosBenchmarkReport
}

export function useAgentosBenchmarkRuns() {
	return useQuery({ queryKey: AGENTOS_BENCHMARK_RUNS_QUERY_KEY, queryFn: fetchAgentosRuns })
}

// Report for one run. `id === null` (nothing selected / no runs yet) disables the query
// so it never fires a request for an empty key.
export function useAgentosRunReport(id: string | null) {
	return useQuery({
		queryKey: agentosRunReportQueryKey(id ?? ''),
		enabled: id !== null,
		queryFn: () => fetchAgentosRunReport(id ?? '')
	})
}
