'use client'
import { useQuery } from '@tanstack/react-query'
import type { PoolHealthResponse } from '@/lib/model-pool-health'

// TanStack Query data layer for the Model Pool health panel (MP-M6). One read-only
// GET. The fetcher is module-level (not an inline arrow) so a `throw` never sits
// inside the hook body — the same React Compiler constraint the other dashboard
// hooks follow.

export const MODEL_POOL_QUERY_KEY = ['model-pool-health'] as const

async function fetchModelPoolHealth(): Promise<PoolHealthResponse> {
	const response = await fetch('/api/model-pool')
	if (!response.ok) throw new Error(`Failed to load model pool health (${response.status})`)
	return (await response.json()) as PoolHealthResponse
}

// Refetch on a slow interval so a boot warm-up that finishes after the panel first
// paints (it takes ~16-38s) is picked up without a manual reload, and so circuit
// state changes during a demo stay visible. Stale-while-revalidate keeps it calm.
export function useModelPoolHealth() {
	return useQuery({
		queryKey: MODEL_POOL_QUERY_KEY,
		queryFn: fetchModelPoolHealth,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false
	})
}
