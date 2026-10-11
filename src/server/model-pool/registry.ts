import 'server-only'
import { env } from '@/lib/env'
import { classifyStatus } from '@/lib/model-pool/classify'
import { createModelRegistry, type ModelRegistry } from '@/lib/model-pool/registry'
import { scoreInTier } from '@/lib/model-pool/select'
import type { CapabilityRequest, FailureKind, PoolModel } from '@/lib/model-pool/types'
import { MODELS } from '@/lib/models'
import { completeOnce, NanoGPTError, type ChatMessage } from '@/server/ai/nanogpt'
import { log } from '@/server/lib/logger'

// The server side of the Model Pool registry (M1). The pure cache/transform lives
// in src/lib/model-pool/registry.ts and is unit-tested at $0; this file owns the
// one real network call — GET /v1/models?detailed=true with the server-side key —
// and a process-wide singleton so every agent shares one TTL cache instead of each
// fetching the catalog.
//
// This file owns no secret beyond reading env.NANOGPT_API_KEY (same boundary as
// src/server/ai/nanogpt.ts): the key never leaves the server, is never logged,
// and is never sent to the browser.

// `?detailed=true` is REQUIRED: the bare /v1/models omits `pricing`, and the pool
// needs the per-1M numbers to rank and to price a failover (integration notes §8).
const NANOGPT_MODELS_URL = 'https://api.nano-gpt.com/v1/models?detailed=true'

// The three Jev routing targets are always kept in the pool as the preferred
// premium tier, even if a catalog refresh momentarily omits one (see the pure
// registry's pinnedPremium handling).
const PINNED_PREMIUM = Object.values(MODELS).map((m) => m.slug)

async function fetchCatalog(): Promise<unknown> {
	const response = await fetch(NANOGPT_MODELS_URL, {
		headers: {
			// NanoGPT serves /models unauthenticated, but sending the key is harmless
			// and keeps one auth path. The OpenRouter-specific HTTP-Referer / X-Title
			// attribution headers are GONE (V3 §5.0 req 3).
			Authorization: `Bearer ${env.NANOGPT_API_KEY}`
		},
		// The catalog is public and slow-changing; don't let Next cache it beyond
		// this process (the pure registry owns the TTL).
		cache: 'no-store'
	})
	if (!response.ok) {
		const text = await response.text().catch(() => '')
		throw new Error(`NanoGPT models ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
	}
	const body = (await response.json()) as { data?: unknown }
	// buildPoolModels expects the array; the raw entries are the `data` field.
	return Array.isArray(body?.data) ? body.data : []
}

// The singleton is hung off globalThis, NOT a module-level `let`. In dev,
// Turbopack evaluates instrumentation.ts and the route/agent bundles as separate
// module graphs, so a module-scoped variable would give the boot-time warm-up a
// DIFFERENT registry than the chat route reads — the warm-up's probes would be
// invisible to selection and the first chat would still walk into an app-gated
// model. globalThis is one per process, shared across bundles and surviving HMR
// (the same reason the Prisma client is cached there).
const globalForPool = globalThis as unknown as {
	__agentosModelRegistry?: ModelRegistry
	__agentosPoolWarmStarted?: boolean
}

// Lazily create the process-wide registry. The catalog is fetched on first read
// (getModels), not at import time, so a NanoGPT outage at boot doesn't crash
// the server — the first run just refreshes.
export function getModelRegistry(): ModelRegistry {
	if (!globalForPool.__agentosModelRegistry) {
		globalForPool.__agentosModelRegistry = createModelRegistry({
			fetchCatalog,
			now: () => Date.now(),
			ttlMs: 600_000,
			pinnedPremium: PINNED_PREMIUM
		})
	}
	return globalForPool.__agentosModelRegistry
}

// ---- Boot-time warm-up ---------------------------------------------------
//
// On NanoGPT there is NO usable free LLM tier (V3 Phase 0, integration notes §8e,
// decision D-44): the only 0/0-priced ids are the two POOL_BLOCKLIST meta-helpers,
// which never enter the pool. So the free-model probe march below now selects ZERO
// targets and is inert — but it is kept for two reasons: (1) it still warms the
// catalog cache at boot (registry.getModels()), so the first chat does not pay the
// cold-fetch latency, and (2) the discover-then-verify discipline is provider-
// agnostic — if a future provider ships a real free tier it resumes with no change.
// It never spends: a free target costs $0, and there are none anyway.
//
// The original OpenRouter rationale (probing `:free` models to avoid app-gated 403s
// on the first turn) no longer applies and is retained only as history in the
// decisions log. Free models cost $0, so this never spends.

// Rank probe targets the way a balanced chat step does: no hard capability
// needs, so scoreInTier orders by measured reliability then context size — the
// larger-context mainstream free models lead, which are the likeliest to serve.
const PROBE_REQUEST: CapabilityRequest = {
	needs: [],
	minContext: 0,
	quality: 'balanced',
	highStakes: false
}

// The live free set is small (Phase 0 measured ~17-22 ids); 20 covers it while
// bounding a pathological catalog. Sorted, so the cap keeps the best candidates.
const PROBE_LIMIT = 20

// A single tiny turn. Free models are $0 regardless of tokens; 16 keeps it fast
// and is enough headroom that a model isn't rejected for a too-small cap.
const PROBE_MESSAGES: ChatMessage[] = [{ role: 'user', content: 'Reply with the single word OK.' }]
const PROBE_MAX_TOKENS = 16

// Bound one probe so a single hung upstream can't stall the whole warm-up and
// leave the rest of the free tier unranked.
const PROBE_TIMEOUT_MS = 15_000

// Kinds that mean "this model structurally cannot serve this caller/key" and are
// worth recording as a failure so selection sinks it: app-gating/removed
// (`unavailable` = 403/404) and a credit wall (`insufficient-credits` = 402).
// Transient kinds (rate-limit, server-error, timeout, unknown, bad-request) are
// NOT recorded — a 429 during a boot burst, or a probe-shape 400, is not
// evidence the model is bad, and poisoning its score would hide a good one.
const STRUCTURAL_FAILURES: ReadonlySet<FailureKind> = new Set([
	'unavailable',
	'insufficient-credits'
])

function withProbeTimeout<T>(promise: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('probe-timeout')), PROBE_TIMEOUT_MS)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error: unknown) => {
				clearTimeout(timer)
				reject(error)
			}
		)
	})
}

// Kick once per process (from instrumentation register(), non-blocking). Safe to
// call repeatedly; later calls are no-ops. Never throws — a failed warm-up just
// leaves the pool unprobed and the per-request failover self-heals as before.
export async function warmFreeModelProbes(): Promise<void> {
	// globalThis flag (not module-local) so a second bundle or an HMR reload can't
	// launch a duplicate probe march against the shared registry.
	if (globalForPool.__agentosPoolWarmStarted) return
	globalForPool.__agentosPoolWarmStarted = true
	if (!env.NANOGPT_API_KEY) {
		log.warn('model-pool warm-up skipped: NANOGPT_API_KEY is unset')
		return
	}

	const registry = getModelRegistry()
	let models: PoolModel[]
	try {
		models = await registry.getModels()
	} catch (error) {
		log.warn('model-pool warm-up: catalog fetch failed', { err: error })
		return
	}

	const targets = models
		.filter((m) => m.tier === 'free' && m.measurements.samples === 0)
		.sort(
			(a, b) =>
				scoreInTier(b, PROBE_REQUEST) - scoreInTier(a, PROBE_REQUEST) ||
				a.slug.localeCompare(b.slug)
		)
		.slice(0, PROBE_LIMIT)

	const working: string[] = []
	const gated: string[] = []
	let transient = 0
	for (const model of targets) {
		const startedAt = Date.now()
		try {
			await withProbeTimeout(completeOnce(model.slug, PROBE_MESSAGES, PROBE_MAX_TOKENS))
			registry.recordProbe(model.slug, { ok: true, latencyMs: Date.now() - startedAt })
			working.push(model.slug)
		} catch (error) {
			const status = error instanceof NanoGPTError ? error.status : null
			if (STRUCTURAL_FAILURES.has(classifyStatus(status))) {
				registry.recordProbe(model.slug, { ok: false, latencyMs: Date.now() - startedAt })
				gated.push(model.slug)
			} else {
				transient += 1
			}
		}
	}

	// One measured summary line (slugs only — never the key). This is the evidence
	// for which free models the demo can actually fall back to.
	log.info('model-pool free-model warm-up complete', {
		probed: targets.length,
		working: working.length,
		gated: gated.length,
		transient,
		workingSlugs: working,
		gatedSlugs: gated
	})
}
