import 'server-only'
import type { PoolHealthResponse } from '@/lib/model-pool-health'
import { buildPoolHealth } from '@/lib/model-pool-health'
import { getModelRegistry } from '@/server/model-pool/registry'

// Orchestration for GET /api/model-pool (MP-M6): read the process-wide registry's
// live PoolModel[] + cache state, then run the pure, unit-tested builder over it.
// The registry singleton is the SAME instance the chat route and boot warm-up use
// (hung off globalThis, see src/server/model-pool/registry.ts), so this reports the
// real measured health — which free models were verified-serving at boot, which are
// gated, which circuits are open — not a re-fetch from scratch.
//
// getModels() returns the cache when fresh and only re-fetches the (slow-changing,
// public) catalog when past TTL, so the panel refresh is cheap in the common case.
export async function getModelPoolHealth(): Promise<PoolHealthResponse> {
	const registry = getModelRegistry()
	const models = await registry.getModels()
	// Read cache state AFTER getModels resolves so a just-completed refresh reports
	// its own timestamp rather than the pre-fetch staleness.
	return buildPoolHealth(models, {
		stale: registry.isStale(),
		lastRefreshedAt: registry.lastRefreshedAt()
	})
}
