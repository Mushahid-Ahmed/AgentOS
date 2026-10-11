import type { ModelLabel } from '@/lib/models'

// Shared, isomorphic types for the executive dashboard (milestone 5). No
// 'server-only': the client view consumes this exact shape from
// GET /api/dashboard, and the server builds it in src/server/api/dashboard*.ts.
// Every figure is aggregated from real persisted `route_events` rows — nothing
// here invents a latency, a share, or a cost (docs/jev-integration-notes.md §4).

// One model's slice of the routing distribution. `share` is count / totalTurns
// (0 when there are no turns), so the donut never divides by zero.
export type ModelShare = {
	label: ModelLabel
	count: number
	share: number
}

// A single recent routed turn, newest-first, for the live gauge's sparkline and
// the activity list. costUsd is null when no cost could be derived for that
// turn — kept null (never 0) so an unpriced turn is distinguishable from a free
// one, matching route_events.cost_micro_usd.
export type RecentTurn = {
	at: string
	chosenModel: ModelLabel
	jevLatencyMs: number
	totalLatencyMs: number | null
	costUsd: number | null
}

// The cumulative, honest picture of every chat turn routed so far. Latency is
// the Jev hop only (the headline "Jev is fast" number); the benchmark suite owns
// the Jev-vs-judge p50/p95 comparison, which the dashboard reads separately from
// GET /api/benchmark/runs/[id].
export type DashboardStats = {
	totalTurns: number
	avgJevLatencyMs: number
	minJevLatencyMs: number | null
	maxJevLatencyMs: number | null
	// Most recent turn's Jev latency — the "live" gauge value. Null until the
	// first turn is routed.
	latestJevLatencyMs: number | null
	fallbackCount: number
	fallbackRate: number
	// Always three entries, ordered claude, gpt, gemini, so the donut is stable
	// even when a model has never been chosen (count 0, share 0).
	modelDistribution: ModelShare[]
	totalPromptTokens: number
	totalCompletionTokens: number
	// Sum of the turns whose cost could be derived, in USD. 0 when nothing has been priced
	// yet; pricedTurns tells the two apart.
	totalCostUsd: number
	pricedTurns: number
	// Newest-first, capped server-side. recent[0] drives latestJevLatencyMs.
	recent: RecentTurn[]
}
