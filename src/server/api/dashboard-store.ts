import 'server-only'
import { db } from '@/server/db/client'
import type { RouteAggregateRaw } from './dashboard-stats'

// Persistence for the executive dashboard (milestone 5): reads the cumulative
// routing telemetry out of route_events and shapes it into the JSON-safe raw
// aggregate the pure stats module (dashboard-stats.ts) turns into DashboardStats.
// Mirrors the benchmark-store split — this file owns the Prisma reads and the
// BigInt/Date -> number/ISO boundary conversions; it does no arithmetic.
//
// Everything is aggregated in the database (aggregate/groupBy/count) rather than
// pulling every row into memory, so the dashboard stays O(1) in the number of
// chat turns. Only the small newest-first `recent` window is fetched as rows.

const RECENT_LIMIT = 30

export async function loadRouteAggregate(): Promise<RouteAggregateRaw> {
	const [agg, fallbackCount, pricedTurns, grouped, recent] = await Promise.all([
		db.routeEvent.aggregate({
			_count: { _all: true },
			_sum: {
				jevLatencyMs: true,
				promptTokens: true,
				completionTokens: true,
				costMicroUsd: true
			},
			_min: { jevLatencyMs: true },
			_max: { jevLatencyMs: true }
		}),
		db.routeEvent.count({ where: { fallback: true } }),
		db.routeEvent.count({ where: { costMicroUsd: { not: null } } }),
		db.routeEvent.groupBy({
			by: ['chosenModel'],
			_count: { _all: true }
		}),
		db.routeEvent.findMany({
			orderBy: { createdAt: 'desc' },
			take: RECENT_LIMIT,
			select: {
				createdAt: true,
				chosenModel: true,
				jevLatencyMs: true,
				totalLatencyMs: true,
				costMicroUsd: true
			}
		})
	])

	// A BigInt micro-USD sum is far below 2^53 for any realistic trial volume, so
	// Number() is exact here; null (nothing priced) stays null, never 0.
	const costMicroSum = agg._sum.costMicroUsd == null ? null : Number(agg._sum.costMicroUsd)

	return {
		totalTurns: agg._count._all,
		jevLatencySum: agg._sum.jevLatencyMs ?? 0,
		jevLatencyMin: agg._min.jevLatencyMs ?? null,
		jevLatencyMax: agg._max.jevLatencyMs ?? null,
		fallbackCount,
		modelCounts: grouped.map((group) => ({
			chosenModel: group.chosenModel,
			count: group._count._all
		})),
		promptTokensSum: agg._sum.promptTokens ?? 0,
		completionTokensSum: agg._sum.completionTokens ?? 0,
		costMicroSum,
		pricedTurns,
		recent: recent.map((row) => ({
			at: row.createdAt.toISOString(),
			chosenModel: row.chosenModel,
			jevLatencyMs: row.jevLatencyMs,
			totalLatencyMs: row.totalLatencyMs ?? null,
			costMicroUsd: row.costMicroUsd == null ? null : Number(row.costMicroUsd)
		}))
	}
}
