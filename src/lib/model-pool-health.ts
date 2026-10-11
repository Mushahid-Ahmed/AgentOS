// Pool-health view model (MP-M6) — PURE. Turns the registry's runtime PoolModel[]
// into the wire shape the dashboard "Model Pool health" panel renders, plus an
// honest summary. No fetch, no clock, no 'server-only': the registry read lives in
// src/server/api/model-pool.ts and the wall clock/staleness is passed in, so this
// is unit-tested at $0 with a fixture — the same discipline as the rest of the pool.
//
// Every number here is a real measurement (or an explicit "no data yet" null):
// successRate/latencyMs/samples come from recordProbe, circuit from the breaker.
// Nothing is estimated, and an unprobed model reports null — never a fake 100%.

import type { CapabilityTag, CircuitState, ModelTier, PoolModel } from '@/lib/model-pool/types'

export type PoolModelHealth = {
	slug: string
	displayName: string
	family: string
	tier: ModelTier
	contextLength: number | null
	circuit: CircuitState
	consecutiveFailures: number
	// null until the model has been exercised — the panel shows "no data yet".
	successRate: number | null
	latencyMs: number | null
	samples: number
	tags: CapabilityTag[]
}

export type PoolHealthSummary = {
	total: number
	free: number
	premium: number
	// Models with at least one real probe/attempt recorded.
	probed: number
	// Circuit closed (selectable right now).
	healthy: number
	// Circuit open (tripped after consecutive failures; not selectable).
	openCircuits: number
	// Free tier, measured: verified-serving vs structurally gated (403/404/402
	// recorded as failures by the boot warm-up) vs never successfully probed.
	freeWorking: number
	freeGated: number
	freeUnprobed: number
}

export type PoolHealthResponse = {
	models: PoolModelHealth[]
	summary: PoolHealthSummary
	// Registry cache state, so the panel can show an honest "stale"/"last refresh".
	stale: boolean
	lastRefreshedAt: number | null
}

// Presentation order: the free tier is what actually serves on a $0 key, so it
// leads; within a tier, measured-working models lead, then unprobed, then proven-
// gated last. Deterministic (slug tie-break) so the panel never reorders on reload.
function healthRank(m: PoolModelHealth): number {
	const tierRank = m.tier === 'free' ? 0 : 1
	if (m.samples === 0) return tierRank * 100 + 10
	// successRate > 0 => working (0), successRate === 0 => gated (20).
	return tierRank * 100 + ((m.successRate ?? 0) > 0 ? 0 : 20)
}

function toHealth(m: PoolModel): PoolModelHealth {
	return {
		slug: m.slug,
		displayName: m.displayName,
		family: m.family,
		tier: m.tier,
		contextLength: m.contextLength,
		circuit: m.health.circuit,
		consecutiveFailures: m.health.consecutiveFailures,
		successRate: m.measurements.successRate,
		latencyMs: m.measurements.latencyMs,
		samples: m.measurements.samples,
		tags: m.tags
	}
}

export function buildPoolHealth(
	models: PoolModel[],
	state: { stale: boolean; lastRefreshedAt: number | null }
): PoolHealthResponse {
	const mapped = models.map(toHealth)
	const summary: PoolHealthSummary = {
		total: mapped.length,
		free: 0,
		premium: 0,
		probed: 0,
		healthy: 0,
		openCircuits: 0,
		freeWorking: 0,
		freeGated: 0,
		freeUnprobed: 0
	}
	for (const m of mapped) {
		if (m.tier === 'free') summary.free += 1
		else summary.premium += 1
		if (m.samples > 0) summary.probed += 1
		if (m.circuit === 'open') summary.openCircuits += 1
		else if (m.circuit === 'closed') summary.healthy += 1
		if (m.tier === 'free') {
			if (m.samples === 0) summary.freeUnprobed += 1
			else if ((m.successRate ?? 0) > 0) summary.freeWorking += 1
			else summary.freeGated += 1
		}
	}
	const sorted = [...mapped].sort(
		(a, b) =>
			healthRank(a) - healthRank(b) ||
			(b.samples ?? 0) - (a.samples ?? 0) ||
			a.slug.localeCompare(b.slug)
	)
	return { models: sorted, summary, stale: state.stale, lastRefreshedAt: state.lastRefreshedAt }
}
