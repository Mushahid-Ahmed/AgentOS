// Pure builders for the dashboard's Spend and Model-usage views (V3 §15, milestone
// 10). Isomorphic and side-effect free: the server loader (src/server/api/spend.ts)
// does the Prisma reads and hands plain rows in; these functions only reshape and
// total them, so every figure is unit-testable without a database.
//
// The honesty rules the whole codebase follows apply here verbatim:
//   - money is summed from the REAL per-call ledger (ai_usage.cost_micro_usd). A NULL
//     cost is skipped, never counted as 0 — and the rows it belongs to are surfaced as
//     "unpriced" with their token counts, so an unpublished price is visibly unknown
//     rather than silently free (§15: "mark USD 'unknown' — never a made-up number").
//   - the ledger total is the ONLY cumulative figure. agent_runs and benchmark runs are
//     *subsets* of it (their calls are also in ai_usage), so they are shown as
//     breakdowns and never added into the total — that would double-count.
//   - NanoGPT exposes no verified balance endpoint, so remaining credit is reported as
//     unknown (verifiable:false), not guessed.

import { NANOGPT_CATALOG, type ModelFamily } from './models'

// The four spend buckets the brief asks for: Claude / GPT / Gemini / other. The
// catalog's finer families (llama, deepseek) collapse into 'other'.
export type SpendFamily = 'claude' | 'gpt' | 'gemini' | 'other'
export const SPEND_FAMILIES: readonly SpendFamily[] = ['claude', 'gpt', 'gemini', 'other'] as const

function collapseFamily(family: ModelFamily): SpendFamily {
	return family === 'claude' || family === 'gpt' || family === 'gemini' ? family : 'other'
}

// Infer a family for a slug that is NOT in the curated catalog (an unmapped model that
// priced NULL). Prefix/substring inference only — it never invents a price, just a
// bucket so the breakdown still accounts for the row.
function inferFamily(slug: string): ModelFamily {
	const s = slug.toLowerCase()
	if (s.startsWith('anthropic/') || s.includes('claude')) return 'claude'
	if (s.startsWith('openai/') || s.includes('gpt')) return 'gpt'
	if (s.startsWith('gemini') || s.startsWith('google/') || s.includes('gemini')) return 'gemini'
	if (s.startsWith('meta-llama/') || s.includes('llama')) return 'llama'
	if (s.includes('deepseek')) return 'deepseek'
	return 'other'
}

// The spend bucket for any slug: the curated catalog's family when known, else inferred.
export function spendFamilyOfSlug(slug: string): SpendFamily {
	const entry = NANOGPT_CATALOG[slug]
	return collapseFamily(entry ? entry.family : inferFamily(slug))
}

// --- Raw rows the server loader supplies (BigInt already widened to number micro) ---

export type UsageRow = {
	model: string
	feature: string
	inputTokens: number
	outputTokens: number
	// NULL when the model is not in the curated catalog — never coerced to 0.
	costMicroUsd: number | null
	status: string
	createdAt: string
}

export type AgentRunRow = {
	id: string
	query: string
	status: string
	taskType: string
	costMicroUsd: number | null
	modelCalls: number
	toolCalls: number
	createdAt: string
}

export type BenchmarkRunRow = {
	id: string
	label: string
	status: string
	taskCount: number
	// Sum of the run's per-setup AgentosBenchmarkResult costs (0 when it recorded none).
	setupCostMicroUsd: number
	// The run's own judge spend, stored separately because it is not derivable from the
	// result rows. NULL when the run recorded no judge cost.
	judgeCostMicroUsd: number | null
	createdAt: string
}

export type RouteEventRow = {
	chosenModel: string
	fallback: boolean
}

export type SpendCaps = {
	perRunUsd: number
	nightlyUsd: number
	benchmarkUsd: number
}

export type SpendRaw = {
	usage: UsageRow[]
	agentRuns: AgentRunRow[]
	benchmarkRuns: BenchmarkRunRow[]
	routeEvents: RouteEventRow[]
	caps: SpendCaps
	// The figure the nightly cap actually enforces against (sum of AgentRun spend since
	// UTC midnight, per nightlySpendMicroUsd()). Reported as-is so the dashboard shows
	// the same number the gate uses, not a re-derived one.
	spentTonightMicroUsd: number
}

// --- View shapes ---

export type FamilySpend = {
	family: SpendFamily
	costMicroUsd: number
	calls: number
	// Fraction of priced spend; 0 when nothing is priced.
	share: number
}

export type CapUtilization = {
	name: 'per_run' | 'nightly' | 'benchmark'
	label: string
	capUsd: number
	spentUsd: number
	// spent / cap; null when the cap is 0 (nothing to divide by).
	utilization: number | null
	// What `spentUsd` actually measures, so the figure is never misread.
	basis: string
}

export type SpendOverTimePoint = {
	// UTC calendar day, YYYY-MM-DD.
	day: string
	costMicroUsd: number
	calls: number
}

export type SpendView = {
	// Cumulative real spend from the funded key: the sum of every priced ai_usage row.
	totalCostMicroUsd: number
	// Ledger rows with a real price vs rows priced NULL (unpublished slug).
	pricedRows: number
	unpricedRows: number
	// Tokens consumed by the unpriced rows — shown so "USD unknown" still carries the
	// real volume behind it.
	unpricedTokens: number
	perFamily: FamilySpend[]
	perRun: AgentRunRow[]
	benchmarkRuns: Array<BenchmarkRunRow & { totalCostMicroUsd: number }>
	overTime: SpendOverTimePoint[]
	caps: CapUtilization[]
	balance: {
		microUsd: number | null
		verifiable: boolean
		note: string
	}
}

export type ModelUsage = {
	model: string
	family: SpendFamily
	calls: number
	inputTokens: number
	outputTokens: number
	costMicroUsd: number | null
	// Fraction of all calls; 0 when there are none.
	share: number
}

export type FeatureUsage = {
	feature: string
	calls: number
	costMicroUsd: number
}

export type ChatLabelUsage = {
	label: string
	count: number
	share: number
}

export type ModelUsageView = {
	// Total priced+unpriced provider calls in the ledger.
	totalCalls: number
	perModel: ModelUsage[]
	perFamily: FamilySpend[]
	byFeature: FeatureUsage[]
	chat: {
		turns: number
		perLabel: ChatLabelUsage[]
		// The honest NanoGPT analog of "free-fallback": NanoGPT has no free tier, so the
		// fallback that matters is Jev erroring/timing-out and the DEFAULT_LABEL being
		// used instead. Counted from persisted route_events, never estimated.
		jevFallbacks: number
		fallbackRate: number
	}
	agentRuns: {
		count: number
		totalModelCalls: number
		totalToolCalls: number
	}
}

// The GET /api/spend response: both views built from one set of persisted rows. Lives
// here (isomorphic) so the client hook can import the type without touching a
// 'server-only' module.
export type SpendAndUsage = {
	spend: SpendView
	usage: ModelUsageView
}

function share(part: number, whole: number): number {
	return whole > 0 ? part / whole : 0
}

function sumCost(rows: Array<{ costMicroUsd: number | null }>): number {
	let total = 0
	for (const row of rows) if (row.costMicroUsd != null) total += row.costMicroUsd
	return total
}

function emptyFamilyTotals(): Record<SpendFamily, { cost: number; calls: number }> {
	return {
		claude: { cost: 0, calls: 0 },
		gpt: { cost: 0, calls: 0 },
		gemini: { cost: 0, calls: 0 },
		other: { cost: 0, calls: 0 }
	}
}

function familyList(
	totals: Record<SpendFamily, { cost: number; calls: number }>,
	costWhole: number
): FamilySpend[] {
	return SPEND_FAMILIES.map((family) => ({
		family,
		costMicroUsd: totals[family].cost,
		calls: totals[family].calls,
		share: share(totals[family].cost, costWhole)
	}))
}

function utilization(spentUsd: number, capUsd: number): number | null {
	return capUsd > 0 ? spentUsd / capUsd : null
}

export function buildSpendView(raw: SpendRaw): SpendView {
	const priced = raw.usage.filter((row) => row.costMicroUsd != null)
	const unpriced = raw.usage.filter((row) => row.costMicroUsd == null)
	const totalCostMicroUsd = sumCost(raw.usage)

	const famTotals = emptyFamilyTotals()
	for (const row of raw.usage) {
		const family = spendFamilyOfSlug(row.model)
		famTotals[family].calls += 1
		if (row.costMicroUsd != null) famTotals[family].cost += row.costMicroUsd
	}

	const dayMap = new Map<string, SpendOverTimePoint>()
	for (const row of raw.usage) {
		const day = row.createdAt.slice(0, 10)
		const bucket = dayMap.get(day) ?? { day, costMicroUsd: 0, calls: 0 }
		bucket.calls += 1
		if (row.costMicroUsd != null) bucket.costMicroUsd += row.costMicroUsd
		dayMap.set(day, bucket)
	}
	const overTime = [...dayMap.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))

	const unpricedTokens = unpriced.reduce(
		(acc, row) => acc + (row.inputTokens || 0) + (row.outputTokens || 0),
		0
	)

	// Per-run breakdown from agent_runs (a subset of the ledger, newest first). A
	// truncated query keeps the row readable without a separate fetch.
	const perRun = [...raw.agentRuns]
		.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
		.slice(0, 20)

	const benchmarkRuns = [...raw.benchmarkRuns]
		.map((run) => ({
			...run,
			totalCostMicroUsd: run.setupCostMicroUsd + (run.judgeCostMicroUsd ?? 0)
		}))
		.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

	// Cap utilization, each against the SAME figure its gate enforces on.
	const maxRunMicro = raw.agentRuns.reduce(
		(max, run) => (run.costMicroUsd != null && run.costMicroUsd > max ? run.costMicroUsd : max),
		0
	)
	const maxBenchMicro = benchmarkRuns.reduce(
		(max, run) => (run.totalCostMicroUsd > max ? run.totalCostMicroUsd : max),
		0
	)
	const caps: CapUtilization[] = [
		{
			name: 'per_run',
			label: 'Per run',
			capUsd: raw.caps.perRunUsd,
			spentUsd: maxRunMicro / 1_000_000,
			utilization: utilization(maxRunMicro / 1_000_000, raw.caps.perRunUsd),
			basis: 'largest single AgentOS run'
		},
		{
			name: 'nightly',
			label: 'Nightly',
			capUsd: raw.caps.nightlyUsd,
			spentUsd: raw.spentTonightMicroUsd / 1_000_000,
			utilization: utilization(raw.spentTonightMicroUsd / 1_000_000, raw.caps.nightlyUsd),
			basis: 'AgentOS runs since UTC midnight (the enforced figure)'
		},
		{
			name: 'benchmark',
			label: 'Benchmark',
			capUsd: raw.caps.benchmarkUsd,
			spentUsd: maxBenchMicro / 1_000_000,
			utilization: utilization(maxBenchMicro / 1_000_000, raw.caps.benchmarkUsd),
			basis: 'largest single benchmark run (setups + judge)'
		}
	]

	return {
		totalCostMicroUsd,
		pricedRows: priced.length,
		unpricedRows: unpriced.length,
		unpricedTokens,
		perFamily: familyList(famTotals, totalCostMicroUsd),
		perRun,
		benchmarkRuns,
		overTime,
		caps,
		balance: {
			microUsd: null,
			verifiable: false,
			note: 'NanoGPT exposes no verified balance endpoint, so remaining credit is unknown — not guessed.'
		}
	}
}

export function buildModelUsageView(raw: SpendRaw): ModelUsageView {
	const totalCalls = raw.usage.length

	const perModelMap = new Map<
		string,
		{ calls: number; inputTokens: number; outputTokens: number; costMicroUsd: number | null }
	>()
	const famTotals = emptyFamilyTotals()
	let famCostWhole = 0
	for (const row of raw.usage) {
		const entry = perModelMap.get(row.model) ?? {
			calls: 0,
			inputTokens: 0,
			outputTokens: 0,
			costMicroUsd: null
		}
		entry.calls += 1
		entry.inputTokens += row.inputTokens || 0
		entry.outputTokens += row.outputTokens || 0
		if (row.costMicroUsd != null) entry.costMicroUsd = (entry.costMicroUsd ?? 0) + row.costMicroUsd
		perModelMap.set(row.model, entry)

		const family = spendFamilyOfSlug(row.model)
		famTotals[family].calls += 1
		if (row.costMicroUsd != null) {
			famTotals[family].cost += row.costMicroUsd
			famCostWhole += row.costMicroUsd
		}
	}

	const perModel: ModelUsage[] = [...perModelMap.entries()]
		.map(([model, entry]) => ({
			model,
			family: spendFamilyOfSlug(model),
			calls: entry.calls,
			inputTokens: entry.inputTokens,
			outputTokens: entry.outputTokens,
			costMicroUsd: entry.costMicroUsd,
			share: share(entry.calls, totalCalls)
		}))
		.sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model))

	const featureMap = new Map<string, FeatureUsage>()
	for (const row of raw.usage) {
		const entry = featureMap.get(row.feature) ?? { feature: row.feature, calls: 0, costMicroUsd: 0 }
		entry.calls += 1
		if (row.costMicroUsd != null) entry.costMicroUsd += row.costMicroUsd
		featureMap.set(row.feature, entry)
	}
	const byFeature = [...featureMap.values()].sort(
		(a, b) => b.calls - a.calls || a.feature.localeCompare(b.feature)
	)

	// Chat routing telemetry (route_events): which label actually answered each turn and
	// how often Jev fell back to the default. The honest "fallback" figure on NanoGPT,
	// which has no free tier to fall back to.
	const turns = raw.routeEvents.length
	const jevFallbacks = raw.routeEvents.filter((row) => row.fallback).length
	const labelMap = new Map<string, number>()
	for (const row of raw.routeEvents) {
		labelMap.set(row.chosenModel, (labelMap.get(row.chosenModel) ?? 0) + 1)
	}
	const perLabel: ChatLabelUsage[] = [...labelMap.entries()]
		.map(([label, count]) => ({ label, count, share: share(count, turns) }))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

	return {
		totalCalls,
		perModel,
		perFamily: familyList(famTotals, famCostWhole),
		byFeature,
		chat: {
			turns,
			perLabel,
			jevFallbacks,
			fallbackRate: share(jevFallbacks, turns)
		},
		agentRuns: {
			count: raw.agentRuns.length,
			totalModelCalls: raw.agentRuns.reduce((acc, run) => acc + (run.modelCalls || 0), 0),
			totalToolCalls: raw.agentRuns.reduce((acc, run) => acc + (run.toolCalls || 0), 0)
		}
	}
}
