// Model Pool registry (M1) — PURE. Turns the raw NanoGPT catalog into
// capability-verified PoolModel entries and holds them behind a TTL cache with a
// manual refresh. The catalog fetch and the clock are injected, so the whole
// thing is unit-tested with a fake catalog and a fake clock at $0 (no network).
//
// Rules enforced here (brief §1):
//  - Capability tags come ONLY from real metadata (the `capabilities` object /
//    architecture.output_modalities / context_length) or from measured probes.
//    Never from a model's name.
//  - `fast` and `strong-reasoning` are measured tags: the catalog transform never
//    sets them (it has no measurements). They are added by recordProbe once a
//    real probe exists.
//  - structured output is tracked as advertised vs verified separately; the pool
//    only *trusts* native structured output when verified (brief §4).
//  - Prices/context that are absent stay null — never fabricated, never 0.

import type {
	CapabilityTag,
	ModelCapabilities,
	ModelHealth,
	ModelMeasurements,
	ModelTier,
	PoolModel
} from './types'

// ---- The raw NanoGPT catalog shape (subset we actually read) ----------------

// Mirrors GET /v1/models?detailed=true `data[]`. Kept loose (unknown-ish) because
// the upstream shape is not ours to type strictly; toPoolModel narrows defensively
// and never throws on a malformed entry (it is skipped by the caller).
//
// NanoGPT differs from the old OpenRouter catalog in two load-bearing ways (V3,
// integration notes §8a): `pricing.prompt/completion` are NUMBERS already in USD
// per 1M tokens (not per-token decimal strings), and capabilities are a boolean
// `capabilities` object (not a `supported_parameters` string array).
export type RawCatalogModel = {
	id?: unknown
	name?: unknown
	context_length?: unknown
	max_output_tokens?: unknown
	pricing?: { prompt?: unknown; completion?: unknown; unit?: unknown } | null
	architecture?: { input_modalities?: unknown; output_modalities?: unknown } | null
	capabilities?: {
		vision?: unknown
		reasoning?: unknown
		tool_calling?: unknown
		structured_output?: unknown
	} | null
}

// NanoGPT's only zero-priced entries are routing/meta helpers, not general chat
// LLMs. They still emit text, so without an explicit block they would pass the
// text-generation gate and pollute selection (and the boot probe). Excluded from
// the pool entirely (integration notes §8e, decision D-44).
export const POOL_BLOCKLIST: ReadonlySet<string> = new Set(['nano-gpt-help', 'auto-model'])

// Context length at/above which a model earns the `long-context` tag. 128k is the
// common "big enough for a full research bundle + evidence" threshold; below it a
// step that needs more must chunk/summarise or pick a larger model (brief §2).
export const LONG_CONTEXT_THRESHOLD = 128_000

// Measured-latency threshold for the `fast` tag (ms). Set from probe data only.
export const FAST_LATENCY_MS = 1_200

// ---- Tier + family -------------------------------------------------------

// NanoGPT has NO usable free LLM tier (V3 Phase 0: the only 0/0-priced ids are the
// two POOL_BLOCKLIST meta-helpers, which never enter the pool). So every
// pool-eligible model is `premium` and the free rung of the degradation ladder is
// gone (decision D-44). This price test is kept as the single place that would
// change if NanoGPT ever ships a real free model — it is not name-based.
export function isFreeModel(raw: RawCatalogModel): boolean {
	const p = raw.pricing
	if (!p) return false
	const prompt = toNumber(p.prompt)
	const completion = toNumber(p.completion)
	return prompt === 0 && completion === 0
}

export function tierOf(raw: RawCatalogModel): ModelTier {
	return isFreeModel(raw) ? 'free' : 'premium'
}

// Provider family = the slug prefix before the first '/'. Used for the badge and
// for "different family" cross-checks (M4) — never for a capability guess. NanoGPT
// is not uniformly prefixed (`gemini-2.5-flash`, `deepseek-r1` carry no publisher),
// so a prefix-less slug's family is the whole id.
export function familyOf(slug: string): string {
	const slash = slug.indexOf('/')
	const base = slash === -1 ? slug : slug.slice(0, slash)
	// Strip a `:free` / `:batch` style suffix from the family token if present.
	const colon = base.indexOf(':')
	return colon === -1 ? base : base.slice(0, colon)
}

// ---- Numeric coercion (honest: absent/NaN -> null, never 0) --------------

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value)
		if (Number.isFinite(n)) return n
	}
	return null
}

// NanoGPT `pricing` is already USD per 1M tokens as a plain number, so it is read
// directly. This is the OPPOSITE of the old OpenRouter path, which multiplied a
// per-token decimal string by 1e6 — reusing that here would over-price by 1e12
// (integration notes §8a). Absent/NaN stays null, never 0.
function per1M(value: unknown): number | null {
	return toNumber(value)
}

// ---- Capability extraction (from real metadata only) ---------------------

function outputModalities(raw: RawCatalogModel): string[] {
	const m = raw.architecture?.output_modalities
	return Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string') : []
}

// The completion pool only ever asks a model for TEXT, so a media-GENERATION model
// must never be a candidate. The catalog lists audio models (e.g. Google Lyria,
// output_modalities ["text","audio"]) and image models (["text","image"]); routed
// into a chain by failover they return a 200 with media-shaped text (timestamped
// lyric fragments, image tokens) that the transport counts as a success — a silent
// wrong-model degradation, exactly what happened in the live run that served the
// synthesizer from `google/lyria-3-clip-preview`. Gate on real metadata: a pool
// model must output text and NOTHING else. Absent output_modalities is not
// provably text, so it is excluded (conservative; the whole live catalog sets it).
export function isTextGenerationModel(raw: RawCatalogModel): boolean {
	const out = outputModalities(raw)
	if (!out.includes('text')) return false
	return out.every((m) => m === 'text')
}

export function capabilitiesOf(raw: RawCatalogModel): ModelCapabilities {
	const caps = raw.capabilities
	return {
		tools: caps?.tool_calling === true,
		structuredOutputAdvertised: caps?.structured_output === true,
		// Never verified by the catalog transform — only recordProbe can flip this.
		structuredOutputVerified: false,
		vision: caps?.vision === true
	}
}

// Structural tags from metadata. `fast` / `strong-reasoning` are measured and are
// NOT assigned here (see assignMeasuredTags).
export function structuralTags(model: {
	contextLength: number | null
	capabilities: ModelCapabilities
}): CapabilityTag[] {
	const tags: CapabilityTag[] = []
	if (model.contextLength !== null && model.contextLength >= LONG_CONTEXT_THRESHOLD) {
		tags.push('long-context')
	}
	if (model.capabilities.structuredOutputAdvertised) tags.push('structured-output')
	if (model.capabilities.tools) tags.push('tool-capable')
	if (model.capabilities.vision) tags.push('vision')
	return tags
}

// Measured tags, added only once a probe has real latency data.
export function measuredTags(measurements: ModelMeasurements): CapabilityTag[] {
	const tags: CapabilityTag[] = []
	if (
		measurements.latencyMs !== null &&
		measurements.samples > 0 &&
		measurements.latencyMs <= FAST_LATENCY_MS
	) {
		tags.push('fast')
	}
	return tags
}

// ---- Fresh sub-objects ---------------------------------------------------

export function freshHealth(cooldownMs = 60_000): ModelHealth {
	return {
		circuit: 'closed',
		consecutiveFailures: 0,
		openedAt: null,
		cooldownMs,
		lastSuccessAt: null,
		lastFailureAt: null
	}
}

export function freshMeasurements(): ModelMeasurements {
	return { latencyMs: null, successRate: null, samples: 0, successes: 0, failures: 0 }
}

// ---- The transform -------------------------------------------------------

// Returns null for an entry without a usable string id (skipped, never thrown),
// for a POOL_BLOCKLIST meta-helper (nano-gpt-help / auto-model — not chat LLMs),
// and for a media-generation model (audio/image output) that must never serve a
// text completion (see isTextGenerationModel).
export function toPoolModel(raw: RawCatalogModel, now: number): PoolModel | null {
	if (typeof raw.id !== 'string' || raw.id === '') return null
	if (POOL_BLOCKLIST.has(raw.id)) return null
	if (!isTextGenerationModel(raw)) return null
	const slug = raw.id
	const capabilities = capabilitiesOf(raw)
	const contextLength = toNumber(raw.context_length)
	const measurements = freshMeasurements()
	const base: PoolModel = {
		slug,
		displayName: typeof raw.name === 'string' && raw.name !== '' ? raw.name : slug,
		family: familyOf(slug),
		tier: tierOf(raw),
		contextLength,
		promptPricePer1M: per1M(raw.pricing?.prompt),
		completionPricePer1M: per1M(raw.pricing?.completion),
		capabilities,
		tags: [],
		health: freshHealth(),
		measurements,
		refreshedAt: now
	}
	base.tags = [...structuralTags(base), ...measuredTags(base.measurements)]
	return base
}

export function buildPoolModels(rawCatalog: unknown, now: number): PoolModel[] {
	if (!Array.isArray(rawCatalog)) return []
	const out: PoolModel[] = []
	for (const entry of rawCatalog as RawCatalogModel[]) {
		const model = toPoolModel(entry, now)
		if (model) out.push(model)
	}
	return out
}

// Fold one real attempt into a model's measurements and recompute its tags.
// Latency is a rolling mean over successful+failed samples; successRate is
// successes/samples. Pure — returns a new object, never mutates.
export function applyProbe(
	model: PoolModel,
	result: { ok: boolean; latencyMs: number }
): PoolModel {
	const m = model.measurements
	const samples = m.samples + 1
	const successes = m.successes + (result.ok ? 1 : 0)
	const failures = m.failures + (result.ok ? 0 : 1)
	// Rolling mean latency; guard the first sample (m.latencyMs is null).
	const prevTotal = m.latencyMs === null ? 0 : m.latencyMs * m.samples
	const latencyMs = (prevTotal + result.latencyMs) / samples
	const measurements: ModelMeasurements = {
		latencyMs,
		successRate: samples === 0 ? null : successes / samples,
		samples,
		successes,
		failures
	}
	return {
		...model,
		measurements,
		tags: [...structuralTags(model), ...measuredTags(measurements)]
	}
}

// ---- The cached registry (pure; fetch + clock injected) ------------------

export type CatalogFetcher = () => Promise<unknown>

export type ModelRegistryOptions = {
	fetchCatalog: CatalogFetcher
	now: () => number
	// Cache lifetime. The catalog changes slowly; refresh on read when stale, or
	// force via refresh(). Default 10 minutes.
	ttlMs?: number
	// Slugs that are always kept in the pool as the preferred premium tier even if
	// a future catalog refresh omits them (the three Jev routing targets).
	pinnedPremium?: string[]
}

export type ModelRegistry = {
	// Returns the cached catalog, refreshing first if stale or never loaded.
	getModels(): Promise<PoolModel[]>
	// Force an immediate refresh (manual refresh button / startup warm).
	refresh(): Promise<PoolModel[]>
	get(slug: string): Promise<PoolModel | null>
	// Record one real probe/attempt outcome against a cached model: updates its
	// measured latency (rolling mean), success rate and sample count, and
	// recomputes measured tags (`fast`). Synchronous over the in-memory cache —
	// health persistence to Supabase is a separate concern (M3). A no-op when the
	// slug is not in the cache.
	recordProbe(slug: string, result: { ok: boolean; latencyMs: number }): void
	// True when the cache is past its TTL (used by the health panel's "last
	// refresh" + stale badge). Does not trigger a fetch.
	isStale(): boolean
	lastRefreshedAt(): number | null
}

export function createModelRegistry(options: ModelRegistryOptions): ModelRegistry {
	const ttlMs = options.ttlMs ?? 600_000
	const pinned = options.pinnedPremium ?? []
	let cache: PoolModel[] | null = null
	let loadedAt: number | null = null
	let inflight: Promise<PoolModel[]> | null = null

	async function load(): Promise<PoolModel[]> {
		const now = options.now()
		const raw = await options.fetchCatalog()
		const fresh = buildPoolModels(raw, now)
		// A catalog refresh re-reads metadata/pricing — it must NOT throw away what we
		// measured. Carry each model's health (circuit) and measurements (success rate,
		// latency, samples) forward by slug, and recompute its tags from the fresh
		// structural metadata plus the preserved measurements. Without this, every TTL
		// refresh (10 min) resets the boot warm-up's verified/gated free-tier evidence,
		// so the health panel and selection would forget which free models actually
		// serve and walk back into an app-gated 403 on the next chat.
		const prevBySlug = cache ? new Map(cache.map((m) => [m.slug, m])) : null
		const models = prevBySlug
			? fresh.map((m) => {
					const prev = prevBySlug.get(m.slug)
					if (!prev) return m
					const measurements = prev.measurements
					return {
						...m,
						health: prev.health,
						measurements,
						tags: [...structuralTags(m), ...measuredTags(measurements)]
					}
				})
			: fresh
		// Re-pin the preferred premium tier: if a pinned slug is missing from the
		// fresh catalog, keep the previously-known entry rather than dropping a
		// routing target out from under an in-flight run.
		if (cache && pinned.length > 0) {
			const bySlug = new Map(models.map((m) => [m.slug, m]))
			for (const slug of pinned) {
				if (!bySlug.has(slug)) {
					const prev = cache.find((m) => m.slug === slug)
					if (prev) models.push({ ...prev, refreshedAt: now })
				}
			}
		}
		cache = models
		loadedAt = now
		return models
	}

	function isStale(): boolean {
		if (cache === null || loadedAt === null) return true
		return options.now() - loadedAt >= ttlMs
	}

	return {
		async getModels() {
			if (!isStale() && cache) return cache
			// Coalesce concurrent refreshes into one fetch.
			if (!inflight) {
				inflight = load().finally(() => {
					inflight = null
				})
			}
			return inflight
		},
		async refresh() {
			if (!inflight) {
				inflight = load().finally(() => {
					inflight = null
				})
			}
			return inflight
		},
		async get(slug) {
			const models = await this.getModels()
			return models.find((m) => m.slug === slug) ?? null
		},
		recordProbe(slug, result) {
			if (!cache) return
			const idx = cache.findIndex((m) => m.slug === slug)
			if (idx === -1) return
			const existing = cache[idx]
			if (!existing) return
			cache[idx] = applyProbe(existing, result)
		},
		isStale,
		lastRefreshedAt() {
			return loadedAt
		}
	}
}
