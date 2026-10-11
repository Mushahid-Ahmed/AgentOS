// Model Pool core vocabulary — the types shared by the registry (M1), the
// selection policy (M2), failover/circuit/limiter (M3), output validation (M4),
// and the degradation ladder (M5). Pure TypeScript on purpose: no 'server-only',
// no Prisma, no fetch. Everything side-effectful (the real catalog fetch, the
// wall clock, health persistence, the completion call) is injected, so the whole
// pool is unit-testable with mocked deps under `node --test` before a single real
// model is called — the same discipline as src/lib/orchestra/.
//
// Naming follows the Model Pool brief: a PoolModel is a runtime-discovered,
// capability-verified entry; a CapabilityRequest is what an agent step needs; the
// policy returns an ordered CandidateChain (never one model); every attempt is
// classified so failover, the circuit breaker and the degradation ladder stay
// honest. Capability tags come ONLY from verified metadata or measured probes —
// never inferred from a model's name (brief §1).

// ---- Tier + capability tags ---------------------------------------------

// `free` = the `:free` variant or a zero-priced listing. `premium` = anything
// the key pays for (the three Jev routing targets stay the preferred premium
// tier). Drives the Free/Premium badge, the privacy note, and the daily-quota
// limiter (free models are capped at 20 RPM / 50-or-1000 RPD; premium has no
// platform cap).
export type ModelTier = 'premium' | 'free'

// Structural tags are derived from the model's real metadata
// (supported_parameters / architecture.input_modalities / context_length).
// Measured tags (`fast`, `strong-reasoning`) are only ever set from a real probe
// result, never from a name — see registry.assignTags.
export type CapabilityTag =
	| 'long-context'
	| 'structured-output'
	| 'tool-capable'
	| 'vision'
	| 'fast'
	| 'strong-reasoning'

// Verified boolean capabilities the selection policy filters on. `advertised`
// means the catalog lists the parameter; `verified` means a real probe confirmed
// it works. The pool only *trusts* native structured output when verified
// (brief §4) — advertised-but-unverified falls back to instruct-JSON + repair.
export type ModelCapabilities = {
	tools: boolean
	structuredOutputAdvertised: boolean
	structuredOutputVerified: boolean
	vision: boolean
}

// ---- Health / circuit breaker (M3) --------------------------------------

export type CircuitState = 'closed' | 'open' | 'half-open'

export type ModelHealth = {
	circuit: CircuitState
	consecutiveFailures: number
	// Epoch ms the circuit opened (null when closed). A probe is allowed again
	// once now - openedAt >= cooldownMs (half-open).
	openedAt: number | null
	cooldownMs: number
	lastSuccessAt: number | null
	lastFailureAt: number | null
}

// Real measurements, populated by probes. `samples` is 0 until a model has been
// exercised, so the UI can show an honest "no data yet" instead of a fake 100%.
export type ModelMeasurements = {
	latencyMs: number | null
	successRate: number | null
	samples: number
	successes: number
	failures: number
}

// ---- The registry entry (M1) --------------------------------------------

export type PoolModel = {
	// NanoGPT id, e.g. `openai/gpt-4.1` or `gemini-2.5-flash` (the publisher
	// prefix is not uniform across the catalog).
	slug: string
	displayName: string
	// Provider family parsed from the slug prefix (`qwen`, `google`, ...) — used
	// for the badge, never for a capability guess.
	family: string
	tier: ModelTier
	contextLength: number | null
	// USD per 1M tokens from the live catalog pricing (null when absent). Real
	// per-request cost is derived at call time from token usage × the curated
	// per-1M prices (NanoGPT's usage carries no cost field).
	promptPricePer1M: number | null
	completionPricePer1M: number | null
	capabilities: ModelCapabilities
	tags: CapabilityTag[]
	health: ModelHealth
	measurements: ModelMeasurements
	// Epoch ms this entry was last refreshed from the catalog.
	refreshedAt: number
}

// ---- Capability request + candidate chain (M2) ---------------------------

// What an agent step needs. The Decision Bus still makes the bounded Jev
// decisions (task type, complexity, which model *family/style*); the pool maps
// that to concrete models. `quality` biases premium-vs-free.
export type QualityTier = 'high' | 'balanced' | 'fast'

export type CapabilityRequest = {
	needs: CapabilityTag[]
	minContext: number
	quality: QualityTier
	// True for steps whose output must be trustworthy enough to gate the run
	// (final synthesis on hard tasks, high-stakes verification). Biases toward
	// premium and refuses to end on an unverified free model.
	highStakes?: boolean
	// The premium slug Jev routed this step to (from the closed ModelLabel set),
	// when the choice originated from a Jev decision. If it satisfies the request
	// and is healthy it becomes the head of the chain and the choice is recorded
	// `decidedBy: 'jev'`; otherwise the pool substitutes and records
	// `'pool-policy'`. Never present a pool choice as a Jev choice (brief §2).
	preferredSlug?: string | null
}

// An ordered chain, best-first. The pool ALWAYS returns a chain (possibly of
// length 1), never a single model, so the caller can fail over. `decidedBy`
// records whether the head choice came from Jev or from pool policy — a policy
// choice is NEVER presented as a Jev choice (brief §2).
export type CandidateChain = {
	candidates: PoolModel[]
	request: CapabilityRequest
	decidedBy: 'jev' | 'pool-policy'
	// Human-readable reason for the ordering (shown in the run view).
	rationale: string
}

// ---- Failure classification + failover (M3) -----------------------------

// Why an attempt failed. Drives backoff-vs-cooldown-vs-retry and which failover
// event is emitted. `empty-output` and `unparseable` are the free-model traps
// found in Phase 0 (200-with-blank-content) — a 200 is NOT success unless content
// is usable.
export type FailureKind =
	| 'rate-limit' // HTTP 429
	| 'server-error' // HTTP 5xx
	| 'timeout'
	| 'unavailable' // HTTP 404 / model removed / data-policy exclusion
	| 'insufficient-credits' // HTTP 402
	| 'empty-output'
	| 'context-overflow'
	| 'unparseable'
	| 'tool-call-failed'
	| 'bad-request' // other 4xx
	| 'unknown'

export type AttemptFailure = {
	kind: FailureKind
	slug: string
	status: number | null
	message: string
	// Honour Retry-After when the provider sent one (rate-limit backoff).
	retryAfterMs: number | null
}

// One attempt outcome as the failover loop sees it.
export type AttemptOutcome =
	| {
			ok: true
			slug: string
			content: string
			costMicroUsd?: number
			latencyMs: number
			// The provider's token counts when it reported them (null-ish -> omitted).
			// Display/budget detail only; the ai_usage ledger gets its own counts from
			// the tracked response inside the transport.
			tokens?: { input: number; output: number }
	  }
	| { ok: false; failure: AttemptFailure }

// ---- Degradation ladder (M5) --------------------------------------------

// L0 preferred available · L1 same-tier failover · L2 free replaces premium ·
// L3 reduced team/verification · L4 partial answer with explicit gaps ·
// L5 honest failure with what was tried. Recorded per run, streamed, shown in UI.
export type DegradationLevel = 0 | 1 | 2 | 3 | 4 | 5

// ---- Events the pool adds to the §13 SSE protocol (M6) --------------------

// Kept as data shapes here (pure); the OrchestrationEvent union in
// src/lib/orchestra/types.ts gains matching members so the run view and replay
// render failovers identically live and from the persisted log.
export type ModelFailoverEvent = {
	type: 'model_failover'
	runId: string
	stepId: string
	fromSlug: string
	toSlug: string
	reason: FailureKind
	attempt: number
	at: number
}

export type ModelUnhealthyEvent = {
	type: 'model_unhealthy'
	runId: string
	slug: string
	circuit: CircuitState
	consecutiveFailures: number
	at: number
}

export type DegradationLevelEvent = {
	type: 'degradation_level'
	runId: string
	level: DegradationLevel
	reason: string
	at: number
}
