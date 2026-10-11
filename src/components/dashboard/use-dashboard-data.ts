'use client'
import { useQuery } from '@tanstack/react-query'
import type { DashboardStats } from '@/lib/dashboard'
import type { BenchmarkReport, ListRunsResponse } from '@/lib/benchmark'

// TanStack Query data layer for the executive dashboard (milestone 5). Three
// read-only GETs: the cumulative route_events aggregate, the benchmark run
// history, and one run's recomputed report. Fetchers are module-level (not inline
// arrows) so a `throw` never sits inside the hook body — the same React Compiler
// constraint that keeps the chat streaming loop out of useChat.

export const DASHBOARD_QUERY_KEY = ['dashboard'] as const
export const BENCHMARK_RUNS_QUERY_KEY = ['benchmark-runs'] as const
export const runReportQueryKey = (id: string) => ['benchmark-run', id] as const

async function fetchDashboard(): Promise<DashboardStats> {
	const response = await fetch('/api/dashboard')
	if (!response.ok) throw new Error(`Failed to load dashboard stats (${response.status})`)
	return (await response.json()) as DashboardStats
}

async function fetchRuns(): Promise<ListRunsResponse> {
	const response = await fetch('/api/benchmark/runs')
	if (!response.ok) throw new Error(`Failed to load benchmark runs (${response.status})`)
	return (await response.json()) as ListRunsResponse
}

async function fetchRunReport(id: string): Promise<BenchmarkReport> {
	const response = await fetch(`/api/benchmark/runs/${id}`)
	if (!response.ok) throw new Error(`Failed to load benchmark report (${response.status})`)
	return (await response.json()) as BenchmarkReport
}

export function useDashboardStats() {
	return useQuery({ queryKey: DASHBOARD_QUERY_KEY, queryFn: fetchDashboard })
}

export function useBenchmarkRuns() {
	return useQuery({ queryKey: BENCHMARK_RUNS_QUERY_KEY, queryFn: fetchRuns })
}

// Report for one run. `id === null` (nothing selected / no runs yet) disables the
// query so it never fires a request for an empty key.
export function useRunReport(id: string | null) {
	return useQuery({
		queryKey: runReportQueryKey(id ?? ''),
		enabled: id !== null,
		queryFn: () => fetchRunReport(id ?? '')
	})
}
