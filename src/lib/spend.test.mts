import test from 'node:test'
import assert from 'node:assert/strict'
import {
	buildModelUsageView,
	buildSpendView,
	spendFamilyOfSlug,
	type SpendRaw,
	type UsageRow
} from './spend.ts'

// Minimal fixtures; override only what a case cares about.
function usage(overrides: Partial<UsageRow> & { model: string }): UsageRow {
	return {
		feature: 'chat_completion',
		inputTokens: 100,
		outputTokens: 50,
		costMicroUsd: 1000,
		status: 'ok',
		createdAt: '2026-10-08T12:00:00.000Z',
		...overrides
	}
}

function raw(overrides: Partial<SpendRaw> = {}): SpendRaw {
	return {
		usage: [],
		agentRuns: [],
		benchmarkRuns: [],
		routeEvents: [],
		caps: { perRunUsd: 0.5, nightlyUsd: 10, benchmarkUsd: 15 },
		spentTonightMicroUsd: 0,
		...overrides
	}
}

test('spendFamilyOfSlug reads the curated catalog family', () => {
	assert.equal(spendFamilyOfSlug('anthropic/claude-sonnet-4.5'), 'claude')
	assert.equal(spendFamilyOfSlug('openai/gpt-4.1'), 'gpt')
	assert.equal(spendFamilyOfSlug('gemini-2.5-flash'), 'gemini')
})

test('spendFamilyOfSlug collapses llama/deepseek into other', () => {
	assert.equal(spendFamilyOfSlug('meta-llama/llama-3.3-70b-instruct'), 'other')
	assert.equal(spendFamilyOfSlug('deepseek-r1'), 'other')
})

test('spendFamilyOfSlug infers a bucket for an unmapped slug', () => {
	assert.equal(spendFamilyOfSlug('anthropic/claude-opus-9'), 'claude')
	assert.equal(spendFamilyOfSlug('openai/gpt-9'), 'gpt')
	assert.equal(spendFamilyOfSlug('google/gemini-9'), 'gemini')
	assert.equal(spendFamilyOfSlug('mistral/mistral-large'), 'other')
})

test('total spend sums priced ledger rows and skips NULL, never counting it as 0', () => {
	const view = buildSpendView(
		raw({
			usage: [
				usage({ model: 'openai/gpt-4.1', costMicroUsd: 2000 }),
				usage({ model: 'openai/gpt-4.1', costMicroUsd: 3000 }),
				// An unpriced row: NULL cost, but real tokens that must be surfaced.
				usage({ model: 'some/unmapped', costMicroUsd: null, inputTokens: 500, outputTokens: 250 })
			]
		})
	)
	assert.equal(view.totalCostMicroUsd, 5000)
	assert.equal(view.pricedRows, 2)
	assert.equal(view.unpricedRows, 1)
	assert.equal(view.unpricedTokens, 750)
})

test('the ledger total never double-counts agent_runs or benchmark runs', () => {
	// agent_runs / benchmark rows are subsets of the ledger; the total must equal the
	// ai_usage sum alone.
	const view = buildSpendView(
		raw({
			usage: [usage({ model: 'openai/gpt-4.1', costMicroUsd: 4000 })],
			agentRuns: [
				{
					id: '1',
					query: 'q',
					status: 'completed',
					taskType: 'research',
					costMicroUsd: 4000,
					modelCalls: 2,
					toolCalls: 1,
					createdAt: '2026-10-08T12:00:00.000Z'
				}
			],
			benchmarkRuns: [
				{
					id: '9',
					label: 'b',
					status: 'completed',
					taskCount: 3,
					setupCostMicroUsd: 1500,
					judgeCostMicroUsd: 500,
					createdAt: '2026-10-08T12:00:00.000Z'
				}
			]
		})
	)
	assert.equal(view.totalCostMicroUsd, 4000)
	assert.equal(view.benchmarkRuns[0]?.totalCostMicroUsd, 2000)
})

test('per-family shares are fractions of priced spend', () => {
	const view = buildSpendView(
		raw({
			usage: [
				usage({ model: 'openai/gpt-4.1', costMicroUsd: 3000 }),
				usage({ model: 'anthropic/claude-sonnet-4.5', costMicroUsd: 1000 })
			]
		})
	)
	const gpt = view.perFamily.find((f) => f.family === 'gpt')
	const claude = view.perFamily.find((f) => f.family === 'claude')
	assert.equal(gpt?.costMicroUsd, 3000)
	assert.equal(gpt?.share, 0.75)
	assert.equal(claude?.share, 0.25)
})

test('over-time buckets by UTC day and sorts ascending', () => {
	const view = buildSpendView(
		raw({
			usage: [
				usage({
					model: 'openai/gpt-4.1',
					costMicroUsd: 1000,
					createdAt: '2026-10-08T09:00:00.000Z'
				}),
				usage({
					model: 'openai/gpt-4.1',
					costMicroUsd: 2000,
					createdAt: '2026-10-07T09:00:00.000Z'
				}),
				usage({ model: 'openai/gpt-4.1', costMicroUsd: 500, createdAt: '2026-10-08T22:00:00.000Z' })
			]
		})
	)
	assert.deepEqual(
		view.overTime.map((d) => d.day),
		['2026-10-07', '2026-10-08']
	)
	assert.equal(view.overTime[1]?.costMicroUsd, 1500)
	assert.equal(view.overTime[1]?.calls, 2)
})

test('cap utilization reports per-run max, nightly enforced figure, and benchmark max', () => {
	const view = buildSpendView(
		raw({
			agentRuns: [
				{
					id: '1',
					query: 'a',
					status: 'completed',
					taskType: 'research',
					costMicroUsd: 100_000,
					modelCalls: 1,
					toolCalls: 0,
					createdAt: '2026-10-08T12:00:00.000Z'
				},
				{
					id: '2',
					query: 'b',
					status: 'completed',
					taskType: 'research',
					costMicroUsd: 250_000,
					modelCalls: 1,
					toolCalls: 0,
					createdAt: '2026-10-08T13:00:00.000Z'
				}
			],
			benchmarkRuns: [
				{
					id: '9',
					label: 'b',
					status: 'completed',
					taskCount: 3,
					setupCostMicroUsd: 700_000,
					judgeCostMicroUsd: 300_000,
					createdAt: '2026-10-08T12:00:00.000Z'
				}
			],
			spentTonightMicroUsd: 2_000_000
		})
	)
	const perRun = view.caps.find((c) => c.name === 'per_run')
	const nightly = view.caps.find((c) => c.name === 'nightly')
	const bench = view.caps.find((c) => c.name === 'benchmark')
	assert.equal(perRun?.spentUsd, 0.25) // largest single run
	assert.equal(perRun?.utilization, 0.5) // 0.25 / 0.5
	assert.equal(nightly?.spentUsd, 2) // the enforced tonight figure
	assert.equal(nightly?.utilization, 0.2) // 2 / 10
	assert.equal(bench?.spentUsd, 1) // 700k + 300k = 1.0 USD
})

test('balance is reported unknown, never guessed', () => {
	const view = buildSpendView(raw())
	assert.equal(view.balance.microUsd, null)
	assert.equal(view.balance.verifiable, false)
	assert.ok(view.balance.note.length > 0)
})

test('model usage counts calls, keeps an all-unpriced model cost NULL', () => {
	const view = buildModelUsageView(
		raw({
			usage: [
				usage({ model: 'openai/gpt-4.1', costMicroUsd: 1000 }),
				usage({ model: 'openai/gpt-4.1', costMicroUsd: 2000 }),
				usage({ model: 'some/unmapped', costMicroUsd: null })
			]
		})
	)
	assert.equal(view.totalCalls, 3)
	const gpt = view.perModel.find((m) => m.model === 'openai/gpt-4.1')
	const unmapped = view.perModel.find((m) => m.model === 'some/unmapped')
	assert.equal(gpt?.calls, 2)
	assert.equal(gpt?.costMicroUsd, 3000)
	assert.equal(unmapped?.costMicroUsd, null) // never coerced to 0
	// Descending by calls.
	assert.equal(view.perModel[0]?.model, 'openai/gpt-4.1')
})

test('model usage groups calls by feature', () => {
	const view = buildModelUsageView(
		raw({
			usage: [
				usage({ model: 'openai/gpt-4.1', feature: 'chat_completion', costMicroUsd: 1000 }),
				usage({ model: 'gemini-2.5-flash', feature: 'agentos_bench_a', costMicroUsd: 500 }),
				usage({ model: 'gemini-2.5-flash', feature: 'agentos_bench_a', costMicroUsd: 500 })
			]
		})
	)
	const bench = view.byFeature.find((f) => f.feature === 'agentos_bench_a')
	assert.equal(bench?.calls, 2)
	assert.equal(bench?.costMicroUsd, 1000)
})

test('chat routing counts turns, labels and the Jev fallback rate', () => {
	const view = buildModelUsageView(
		raw({
			routeEvents: [
				{ chosenModel: 'gpt', fallback: false },
				{ chosenModel: 'gpt', fallback: false },
				{ chosenModel: 'claude', fallback: false },
				{ chosenModel: 'gpt', fallback: true }
			]
		})
	)
	assert.equal(view.chat.turns, 4)
	assert.equal(view.chat.jevFallbacks, 1)
	assert.equal(view.chat.fallbackRate, 0.25)
	const gpt = view.chat.perLabel.find((l) => l.label === 'gpt')
	assert.equal(gpt?.count, 3)
	assert.equal(gpt?.share, 0.75)
})

test('empty ledger yields zeroed views with no NaN shares', () => {
	const spend = buildSpendView(raw())
	const model = buildModelUsageView(raw())
	assert.equal(spend.totalCostMicroUsd, 0)
	assert.equal(
		spend.perFamily.every((f) => f.share === 0),
		true
	)
	assert.equal(model.totalCalls, 0)
	assert.equal(model.chat.fallbackRate, 0)
	assert.equal(model.perModel.length, 0)
})
