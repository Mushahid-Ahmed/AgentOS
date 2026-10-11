import { MODEL_LABELS, isModelLabel, type ModelLabel } from '@/lib/models'
import type { DashboardStats, ModelShare, RecentTurn } from '@/lib/dashboard'

// Pure dashboard statistics — no 'server-only', no database, no I/O, so the whole
// thing is unit-testable under `node --test` (see dashboard-stats.test.mts). The
// store (dashboard-store.ts) hands it a JSON-safe aggregate it read from
// route_events; this turns that into the honest DashboardStats the client charts.
// Every figure is derived from the measured rows — nothing here invents a
// latency, a share, or a cost.

// The JSON-safe raw aggregate the store produces. BigInt sums are already
// converted to `number` (micro-USD totals are far below 2^53) and Dates to ISO
// strings at the store boundary, so this module never touches Prisma types.
export type RouteAggregateRaw = {
	totalTurns: number
	jevLatencySum: number
	jevLatencyMin: number | null
	jevLatencyMax: number | null
	fallbackCount: number
	// One entry per distinct chosenModel value present in route_events.
	modelCounts: Array<{ chosenModel: string; count: number }>
	promptTokensSum: number
	completionTokensSum: number
	// Sum of cost_micro_usd over priced turns, or null when none were priced.
	costMicroSum: number | null
	pricedTurns: number
	// Newest-first, already capped by the store.
	recent: Array<{
		at: string
		chosenModel: string
		jevLatencyMs: number
		totalLatencyMs: number | null
		costMicroUsd: number | null
	}>
}

const MICRO_PER_USD = 1_000_000

function round4(value: number): number {
	return Number(value.toFixed(4))
}

function microToUsd(micro: number): number {
	return Number((micro / MICRO_PER_USD).toFixed(6))
}

// The three model slices, always in MODEL_LABELS order and always present, so the
// donut layout never shifts when a model has zero turns. Any chosenModel value
// outside the known label set is ignored rather than invented into a slice.
function distribution(modelCounts: RouteAggregateRaw['modelCounts'], totalTurns: number): ModelShare[] {
	const counts = new Map<string, number>()
	for (const entry of modelCounts) {
		counts.set(entry.chosenModel, entry.count)
	}
	return MODEL_LABELS.map((label) => {
		const count = counts.get(label) ?? 0
		return {
			label,
			count,
			share: totalTurns > 0 ? round4(count / totalTurns) : 0
		}
	})
}

function shapeRecent(rows: RouteAggregateRaw['recent']): RecentTurn[] {
	const shaped: RecentTurn[] = []
	for (const row of rows) {
		// chosenModel is constrained to the label set by the write path, but guard
		// anyway: an out-of-vocab value is dropped rather than coerced into a
		// model the router never chose.
		if (!isModelLabel(row.chosenModel)) continue
		shaped.push({
			at: row.at,
			chosenModel: row.chosenModel as ModelLabel,
			jevLatencyMs: row.jevLatencyMs,
			totalLatencyMs: row.totalLatencyMs,
			costUsd: row.costMicroUsd == null ? null : microToUsd(row.costMicroUsd)
		})
	}
	return shaped
}

export function buildDashboardStats(raw: RouteAggregateRaw): DashboardStats {
	const { totalTurns } = raw
	const recent = shapeRecent(raw.recent)

	return {
		totalTurns,
		avgJevLatencyMs: totalTurns > 0 ? Math.round(raw.jevLatencySum / totalTurns) : 0,
		minJevLatencyMs: raw.jevLatencyMin,
		maxJevLatencyMs: raw.jevLatencyMax,
		latestJevLatencyMs: recent[0]?.jevLatencyMs ?? null,
		fallbackCount: raw.fallbackCount,
		fallbackRate: totalTurns > 0 ? round4(raw.fallbackCount / totalTurns) : 0,
		modelDistribution: distribution(raw.modelCounts, totalTurns),
		totalPromptTokens: raw.promptTokensSum,
		totalCompletionTokens: raw.completionTokensSum,
		totalCostUsd: raw.costMicroSum == null ? 0 : microToUsd(raw.costMicroSum),
		pricedTurns: raw.pricedTurns,
		recent
	}
}
