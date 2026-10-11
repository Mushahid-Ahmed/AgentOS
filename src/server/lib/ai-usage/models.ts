// The model id -> NanoGPT slug map, and nothing else. This file is the one
// place a new model gets registered; AGENTS.md's "Adding a model or a new AI
// call" section is the checklist that points here.
//
// Nothing below is derived, on purpose. A normalizer clever enough to bridge
// the short id we call a model by (`gpt-4.1`) and the slug NanoGPT routes on
// (`openai/gpt-4.1`) is also clever enough to resolve a new model to the wrong
// row and mis-price it in silence. An explicit map fails loudly instead: an
// unmapped model prices as NULL, never 0, so every such row is one
// `where cost_micro_usd is null` away from being counted on the dashboard.
//
// Migrated from OpenRouter (V3 Workstream 0). NanoGPT is the single aggregator
// now; every slug below is a real NanoGPT model id verified against the live
// catalog and priced from the curated table in src/lib/models.ts (§5.2). There
// is no `cost` in a NanoGPT `usage` object, so the slug's ONLY job is to key
// that curated price table — see pricing.ts.

import { NANOGPT_CATALOG } from '@/lib/models'

export const AI_PROVIDERS = ['anthropic', 'openai', 'google'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export const SERVICE_TIERS = ['standard', 'fast', 'batch'] as const
export type ServiceTier = (typeof SERVICE_TIERS)[number]

export const AI_CALL_STATUSES = ['ok', 'error', 'refusal'] as const
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number]

// Keyed by the SHORT id a call site asks for (the same form Jev/AgentOS route
// on and src/lib/models.ts catalogs). Trim this to the models the project
// actually calls — a speculative entry for a model you never call is a stale
// price waiting to mislead. Every value is a real NanoGPT slug verified against
// the live catalog and present in NANOGPT_CATALOG (src/lib/models.ts), so it
// resolves to a curated price rather than NULL.
//
// NanoGPT slugs are NOT uniform: Anthropic/OpenAI models carry a publisher
// prefix (`openai/gpt-4.1`) while the Google and Meta families do not
// (`gemini-2.5-flash`, `meta-llama/llama-3.3-70b-instruct` does). Never infer a
// slug from a `/` — resolve it through this map or the curated catalog.
export const NANOGPT_SLUGS = {
	// Jev-Swarm's three routing targets (src/lib/models.ts). Each label Jev can
	// return maps to one of these; registered so the chat completion calls are
	// tracked and priced rather than landing unpriced.
	'claude-sonnet-4.5': 'anthropic/claude-sonnet-4.5',
	'gpt-4.1': 'openai/gpt-4.1',
	'gemini-2.5-flash': 'gemini-2.5-flash',
	// The LLM-as-judge baseline (JUDGE_MODEL in src/lib/models.ts), used only by
	// the benchmark suite to prove Jev's speed/accuracy advantage — never on the
	// live chat path. Registered so each judge classification call is priced; its
	// real spend is the "routing cost" half of the Jev-vs-judge comparison.
	'gpt-4.1-nano': 'openai/gpt-4.1-nano'
} satisfies Record<string, string>

// The model ids a call site is allowed to ask for. `satisfies` above keeps
// the keys as literals so this type exists at all, which turns "someone
// added an AI call for a model nobody mapped" from a production discovery
// into a `pnpm typecheck` failure. The model a provider *reports* is still
// an open string — that one is caught at runtime, unpriced and loud.
export type TrackedModel = keyof typeof NANOGPT_SLUGS

// Indexed through a widened alias rather than a cast: the map's literal keys
// are what TrackedModel is built from, but a lookup here takes whatever the
// provider actually said.
const slugsByModel: Record<string, string | undefined> = NANOGPT_SLUGS

// Resolve a model id to the NanoGPT slug the curated price table keys on.
//
// Three cases, in order:
//  1. A registered SHORT id (`gpt-4.1`) maps through NANOGPT_SLUGS.
//  2. An already-canonical slug passes through verbatim so the Model Pool can
//     price a runtime-discovered model (decision D-36). A slug is "canonical"
//     when it is a curated NANOGPT_CATALOG key OR carries a publisher prefix
//     (`…/…`); NanoGPT slugs are not uniformly prefixed, so the catalog check is
//     what catches the prefix-less ones (`gemini-2.5-flash`, `deepseek-r1`).
//  3. Anything else is unmapped -> null, which prices the row NULL (never 0) and
//     fires the deduped unmapped-model alert in sink.ts.
//
// NanoGPT has no `:batch` variant, so the service tier never alters the slug and
// is not a parameter here. (The ledger still STORES `service_tier` on the row; it
// simply has no bearing on which slug prices it.)
export function nanoGptSlug(model: string): string | null {
	const mapped = slugsByModel[model]
	if (mapped != null) return mapped
	if (model in NANOGPT_CATALOG || model.includes('/')) return model
	return null
}
