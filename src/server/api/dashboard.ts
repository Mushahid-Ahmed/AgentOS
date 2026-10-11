import 'server-only'
import type { DashboardStats } from '@/lib/dashboard'
import { loadRouteAggregate } from './dashboard-store'
import { buildDashboardStats } from './dashboard-stats'

// Orchestration for GET /api/dashboard (milestone 5): read the cumulative
// route_events aggregate, then run the pure, unit-tested stats over it. Kept in
// its own module so the route.ts stays a zero-logic adapter and the arithmetic
// stays testable without a database.
export async function getDashboard(): Promise<DashboardStats> {
	const raw = await loadRouteAggregate()
	return buildDashboardStats(raw)
}
