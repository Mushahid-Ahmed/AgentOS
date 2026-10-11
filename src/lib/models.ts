// The single source of truth for which model each Jev label maps to, how the UI
// renders it, and — since the V3 NanoGPT migration — the verified per-1M USD price
// of every model the codebase can call (AGENTOS_FINAL_PROMPT_V3 §5.2 "one config
// file"). Isomorphic (no 'server-only'): the NanoGPT slug and prices are read
// server-side (chat, ledger, pool), but displayName / shortName / color are read by
// client components for the badge and routing visualizer. Nothing here is secret —
// NanoGPT slugs and list prices are public (GET /v1/models?detailed=true, no key).
//
// EVERY price/context/capability below was read from the live NanoGPT catalog on
// 2026-10-08 (docs/agentos-integration-notes.md §8c). NanoGPT prices are USD **per
// 1M tokens as numbers** — NOT OpenRouter's per-token decimal strings. Do not apply
// any ×1e6 conversion to these. An unlisted slug prices NULL, never 0 (§5.2).
//
// Jev returns one of `claude | gpt | gemini` (see docs/jev-integration-notes.md
// §7 — verified against the live capability). Anything else is treated as a
// router miss and falls back to DEFAULT_LABEL in src/server/ai/jev.ts.

export const MODEL_LABELS = ['claude', 'gpt', 'gemini'] as const
export type ModelLabel = (typeof MODEL_LABELS)[number]

// The fallback when Jev errors, times out, or returns a label outside
// MODEL_LABELS. gpt-4.1 is the general-purpose middle of the three.
export const DEFAULT_LABEL: ModelLabel = 'gpt'

// --- The verified NanoGPT catalog (§5.2) -----------------------------------

export type ModelFamily = 'claude' | 'gpt' | 'gemini' | 'llama' | 'deepseek' | 'other'
export type ModelTier = 'free' | 'cheap' | 'flagship'

export type CatalogCapabilities = {
	vision: boolean
	reasoning: boolean
	toolCalling: boolean
	structuredOutput: boolean
}

export type CatalogModel = {
	slug: string
	family: ModelFamily
	tier: ModelTier
	// USD per 1M tokens, exactly as NanoGPT publishes (numbers, not per-token strings).
	priceInPer1M: number
	priceOutPer1M: number
	contextWindow: number
	maxOutputTokens: number
	capabilities: CatalogCapabilities
	// Verified: NanoGPT lists NO search-capable and NO embedding models (0 of 632,
	// notes §8e). Both are false for every entry; kept as explicit fields so §5.2's
	// catalog shape is complete and a future capability is a visible change.
	onlineSearch: false
	embedding: false
	strengths: string
}

// NanoGPT has no usable free LLM tier (only `nano-gpt-help` / `auto-model`, which
// are meta-helpers, not answer models — excluded from the pool). So the §5.3
// degradation chain is flagship → cheaper PAID sibling → this cheapest reliable
// PAID model. `meta-llama/llama-3.3-70b-instruct` is the strongest at $0.05/0.23.
export const CHEAP_FLOOR_SLUG = 'meta-llama/llama-3.3-70b-instruct'

export const NANOGPT_CATALOG: Record<string, CatalogModel> = {
	'anthropic/claude-sonnet-4.5': {
		slug: 'anthropic/claude-sonnet-4.5',
		family: 'claude',
		tier: 'flagship',
		priceInPer1M: 3,
		priceOutPer1M: 15,
		contextWindow: 200000,
		maxOutputTokens: 64000,
		capabilities: { vision: true, reasoning: true, toolCalling: true, structuredOutput: true },
		onlineSearch: false,
		embedding: false,
		strengths: 'Long-horizon coding + agentic reasoning, nuanced analysis, careful prose.'
	},
	'anthropic/claude-haiku-4.5': {
		slug: 'anthropic/claude-haiku-4.5',
		family: 'claude',
		tier: 'cheap',
		priceInPer1M: 1,
		priceOutPer1M: 5,
		contextWindow: 200000,
		maxOutputTokens: 64000,
		capabilities: { vision: true, reasoning: false, toolCalling: true, structuredOutput: true },
		onlineSearch: false,
		embedding: false,
		strengths: 'Cheaper Claude sibling; the claude degradation rung below Sonnet.'
	},
	'openai/gpt-4.1': {
		slug: 'openai/gpt-4.1',
		family: 'gpt',
		tier: 'flagship',
		priceInPer1M: 2,
		priceOutPer1M: 8,
		contextWindow: 1047576,
		maxOutputTokens: 32768,
		capabilities: { vision: true, reasoning: false, toolCalling: true, structuredOutput: true },
		onlineSearch: false,
		embedding: false,
		strengths: 'General-purpose flagship; instruction-following, structured + technical tasks.'
	},
	'openai/gpt-4o': {
		slug: 'openai/gpt-4o',
		family: 'gpt',
		tier: 'flagship',
		priceInPer1M: 2.5,
		priceOutPer1M: 10,
		contextWindow: 128000,
		maxOutputTokens: 16384,
		capabilities: { vision: true, reasoning: false, toolCalling: true, structuredOutput: false },
		onlineSearch: false,
		embedding: false,
		strengths: 'Alternative GPT flagship; multimodal, smaller window than gpt-4.1.'
	},
	'openai/gpt-4o-mini': {
		slug: 'openai/gpt-4o-mini',
		family: 'gpt',
		tier: 'cheap',
		priceInPer1M: 0.15,
		priceOutPer1M: 0.6,
		contextWindow: 128000,
		maxOutputTokens: 16384,
		capabilities: { vision: true, reasoning: false, toolCalling: false, structuredOutput: false },
		onlineSearch: false,
		embedding: false,
		strengths: 'Simple/fast route; cheap high-volume GPT answers (no tool calling).'
	},
	'openai/gpt-4.1-nano': {
		slug: 'openai/gpt-4.1-nano',
		family: 'gpt',
		tier: 'cheap',
		priceInPer1M: 0.1,
		priceOutPer1M: 0.4,
		contextWindow: 1047576,
		maxOutputTokens: 32768,
		capabilities: { vision: true, reasoning: false, toolCalling: false, structuredOutput: false },
		onlineSearch: false,
		embedding: false,
		strengths: 'Cheapest GPT; the LLM-as-judge baseline classifier (no tool calling).'
	},
	'gemini-2.5-flash': {
		slug: 'gemini-2.5-flash',
		family: 'gemini',
		tier: 'cheap',
		priceInPer1M: 0.3,
		priceOutPer1M: 2.5,
		contextWindow: 1048576,
		maxOutputTokens: 65536,
		capabilities: { vision: true, reasoning: true, toolCalling: true, structuredOutput: false },
		onlineSearch: false,
		embedding: false,
		strengths: 'Fast factual lookups, huge window, latency-sensitive + high-volume queries.'
	},
	'gemini-2.5-pro': {
		slug: 'gemini-2.5-pro',
		family: 'gemini',
		tier: 'flagship',
		priceInPer1M: 1.25,
		priceOutPer1M: 10,
		contextWindow: 1048576,
		maxOutputTokens: 65536,
		capabilities: { vision: true, reasoning: true, toolCalling: true, structuredOutput: false },
		onlineSearch: false,
		embedding: false,
		strengths: 'Gemini flagship reasoning; the gemini upgrade rung above Flash.'
	},
	'deepseek-r1': {
		slug: 'deepseek-r1',
		family: 'deepseek',
		tier: 'cheap',
		priceInPer1M: 0.4,
		priceOutPer1M: 1.7,
		contextWindow: 128000,
		maxOutputTokens: 8192,
		capabilities: { vision: false, reasoning: true, toolCalling: true, structuredOutput: false },
		onlineSearch: false,
		embedding: false,
		strengths: 'Cheap reasoning model; a complex-route alternative with tool calling.'
	},
	'meta-llama/llama-3.3-70b-instruct': {
		slug: 'meta-llama/llama-3.3-70b-instruct',
		family: 'llama',
		tier: 'cheap',
		priceInPer1M: 0.05,
		priceOutPer1M: 0.23,
		contextWindow: 131072,
		maxOutputTokens: 16384,
		capabilities: { vision: false, reasoning: false, toolCalling: true, structuredOutput: true },
		onlineSearch: false,
		embedding: false,
		strengths: 'Cheapest reliable model; the last-resort degradation floor for any family.'
	}
}

// The per-1M USD price of a slug, or null when it is not in the curated catalog.
// This is the ledger's cost source (src/server/lib/ai-usage/pricing.ts): cost in
// micro-USD = tokens × per-1M price (the two 1e6 factors cancel), so a null here
// prices the row NULL — never a fabricated 0 (§5.2, decisions-log D-42).
export function pricePer1MFor(slug: string): { prompt: number; completion: number } | null {
	const entry = NANOGPT_CATALOG[slug]
	return entry ? { prompt: entry.priceInPer1M, completion: entry.priceOutPer1M } : null
}

// The USD cost of one completion, computed as tokens × the curated per-1M price.
// This is the app's single cost basis for BOTH the streaming chat path (whose usage
// chunk carries NO monetary cost) and the non-streaming path (whose usage DOES carry
// `cost`+`currency` — integration notes §8b, decision D-47): using one arithmetic
// everywhere keeps the ledger, chat telemetry, pool budget and benchmark from
// drifting, per the user's explicit V3 "curated price table" choice (D-42). The
// non-streaming provider `cost` is a flagged-reversible accuracy upgrade, not read.
// Shared by every non-ledger cost figure so they can never drift from one another or
// from the ledger's own arithmetic.
//
// Null — never 0 — when the slug is not in the curated catalog or a token count is
// missing, so an unpriced call is visibly unpriced rather than silently free.
export function costUsdFor(
	slug: string,
	promptTokens: number | null | undefined,
	completionTokens: number | null | undefined
): number | null {
	const price = pricePer1MFor(slug)
	if (!price) return null
	if (promptTokens == null || completionTokens == null) return null
	if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null
	return (promptTokens * price.prompt + completionTokens * price.completion) / 1_000_000
}

// --- The Jev routing labels (UI-facing) ------------------------------------

export type ModelInfo = {
	label: ModelLabel
	// NanoGPT model id, used server-side for the completion call.
	slug: string
	// Full name for tooltips / dashboard.
	displayName: string
	// Compact name for the inline badge.
	shortName: string
	// Series identity for the badge dot, routing visualizer and dashboard donut.
	// A reference to a theme token (globals.css --series-N), NOT a provider brand
	// hex: series are distinguished by the visible legend/labels, and the token
	// flips per theme so slices stay legible on paper and on dusk. Consumers apply
	// it in an inline style, where var() resolves client-side.
	color: string
	// USD per 1M tokens, from the curated NanoGPT catalog above (single source of
	// truth). Used for the live cost figure in telemetry; NanoGPT returns no
	// usage.cost, so this × the response token counts IS the real per-request cost.
	promptPricePer1M: number
	completionPricePer1M: number
}

// Prices are pulled from NANOGPT_CATALOG so the label map and the catalog can never
// drift. `!` is safe: all three flagship slugs are curated with known prices above.
export const MODELS: Record<ModelLabel, ModelInfo> = {
	claude: {
		label: 'claude',
		slug: 'anthropic/claude-sonnet-4.5',
		displayName: 'Claude Sonnet 4.5',
		shortName: 'Claude',
		color: 'var(--series-1)',
		promptPricePer1M: NANOGPT_CATALOG['anthropic/claude-sonnet-4.5']!.priceInPer1M,
		completionPricePer1M: NANOGPT_CATALOG['anthropic/claude-sonnet-4.5']!.priceOutPer1M
	},
	gpt: {
		label: 'gpt',
		slug: 'openai/gpt-4.1',
		displayName: 'GPT-4.1',
		shortName: 'GPT',
		color: 'var(--series-2)',
		promptPricePer1M: NANOGPT_CATALOG['openai/gpt-4.1']!.priceInPer1M,
		completionPricePer1M: NANOGPT_CATALOG['openai/gpt-4.1']!.priceOutPer1M
	},
	gemini: {
		label: 'gemini',
		// NOTE: NanoGPT lists this as `gemini-2.5-flash` with NO `google/` prefix
		// (the OpenRouter id `google/gemini-2.5-flash` is absent — decisions D-43).
		slug: 'gemini-2.5-flash',
		displayName: 'Gemini 2.5 Flash',
		shortName: 'Gemini',
		color: 'var(--series-3)',
		promptPricePer1M: NANOGPT_CATALOG['gemini-2.5-flash']!.priceInPer1M,
		completionPricePer1M: NANOGPT_CATALOG['gemini-2.5-flash']!.priceOutPer1M
	}
}

// The LLM-as-a-judge router used only by the benchmark suite to prove Jev's
// speed/accuracy advantage. Never used on the live chat path. (V3 §5.4 wants a
// cross-family judge for the four-setup benchmark — handled in M10; this stays the
// cheap default judge for the Jev-vs-judge routing comparison.)
export const JUDGE_MODEL = 'openai/gpt-4.1-nano'

export function isModelLabel(value: unknown): value is ModelLabel {
	return typeof value === 'string' && (MODEL_LABELS as readonly string[]).includes(value)
}

export function getModel(label: ModelLabel): ModelInfo {
	return MODELS[label]
}

// What each label is *for* — the canonical criteria text Jev chooses between
// when routing, and the meaning the LLM-as-judge baseline and the AgentOS
// Decision Bus restate. Isomorphic and defined ONCE here so all three callers
// share one definition of each label (a fair Jev-vs-judge comparison needs the
// same wording). Kept short and behaviour-flavoured: routing is about the shape
// of the task, not brand loyalty.
export const ROUTE_CRITERIA: Record<ModelLabel, string> = {
	claude:
		'Long-form writing, careful reasoning, nuanced analysis, code that needs explanation, or tasks where a thoughtful, detailed prose answer matters most.',
	gpt:
		'General-purpose questions, structured or technical tasks, instruction-following, data transformation, and anything that needs a reliable balanced default.',
	gemini:
		'Fast factual lookups, short answers, high-volume or latency-sensitive queries, and simple classification-style requests where speed and low cost matter most.'
}
