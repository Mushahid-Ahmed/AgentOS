'use client'
import { useQuery } from '@tanstack/react-query'
import type { SpendAndUsage } from '@/lib/spend'

// TanStack Query data layer for the Spend + Model-usage panels (V3 §15, milestone 10).
// One read-only GET. The fetcher is module-level (not an inline arrow) so a `throw`
// never sits inside the hook body — the same React Compiler constraint the other
// dashboard hooks follow.

export const SPEND_QUERY_KEY = ['spend'] as const

async function fetchSpendAndUsage(): Promise<SpendAndUsage> {
	const response = await fetch('/api/spend')
	if (!response.ok) throw new Error(`Failed to load spend (${response.status})`)
	return (await response.json()) as SpendAndUsage
}

// Refetch on a slow interval so spend accrued by a running benchmark or chat turn shows
// up during a demo without a manual reload. Stale-while-revalidate keeps it calm.
export function useSpendAndUsage() {
	return useQuery({
		queryKey: SPEND_QUERY_KEY,
		queryFn: fetchSpendAndUsage,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false
	})
}
