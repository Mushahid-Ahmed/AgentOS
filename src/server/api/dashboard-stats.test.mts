import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDashboardStats, type RouteAggregateRaw } from './dashboard-stats'

// The dashboard aggregate is the arithmetic behind every cumulative number the
// executive dashboard shows, so it is tested directly rather than through a live
// run: an averaging or share bug here would produce plausible, self-consistent,
// wrong figures — the hardest kind to notice.

function close(actual: number, expected: number, eps = 1e-9): void {
	assert.ok(Math.abs(actual - expected) <= eps, `expected ~${expected}, got ${actual}`)
}

function raw(partial: Partial<RouteAggregateRaw>): RouteAggregateRaw {
	return {
		totalTurns: 0,
		jevLatencySum: 0,
		jevLatencyMin: null,
		jevLatencyMax: null,
		fallbackCount: 0,
		modelCounts: [],
		promptTokensSum: 0,
		completionTokensSum: 0,
		costMicroSum: null,
		pricedTurns: 0,
		recent: [],
		...partial
	}
}

test('empty aggregate yields zeros and all three model slices, never a divide by zero', () => {
	const stats = buildDashboardStats(raw({}))
	assert.equal(stats.totalTurns, 0)
	assert.equal(stats.avgJevLatencyMs, 0)
	assert.equal(stats.latestJevLatencyMs, null)
	assert.equal(stats.fallbackRate, 0)
	assert.equal(stats.totalCostUsd, 0)
	assert.equal(stats.pricedTurns, 0)
	// The donut layout is stable: claude, gpt, gemini always present, share 0.
	assert.deepEqual(
		stats.modelDistribution.map((slice) => [slice.label, slice.count, slice.share]),
		[
			['claude', 0, 0],
			['gpt', 0, 0],
			['gemini', 0, 0]
		]
	)
	assert.deepEqual(stats.recent, [])
})

test('averages, min/max and fallback rate come from the measured sums', () => {
	const stats = buildDashboardStats(
		raw({
			totalTurns: 4,
			jevLatencySum: 1000,
			jevLatencyMin: 150,
			jevLatencyMax: 400,
			fallbackCount: 1
		})
	)
	assert.equal(stats.avgJevLatencyMs, 250)
	assert.equal(stats.minJevLatencyMs, 150)
	assert.equal(stats.maxJevLatencyMs, 400)
	assert.equal(stats.fallbackCount, 1)
	close(stats.fallbackRate, 0.25)
})

test('model distribution keeps MODEL_LABELS order and computes shares over total turns', () => {
	const stats = buildDashboardStats(
		raw({
			totalTurns: 10,
			// Deliberately out of order and missing gpt, to prove the output is
			// always claude, gpt, gemini with a zero slice for the absent one.
			modelCounts: [
				{ chosenModel: 'gemini', count: 5 },
				{ chosenModel: 'claude', count: 5 }
			]
		})
	)
	assert.deepEqual(
		stats.modelDistribution.map((slice) => [slice.label, slice.count, slice.share]),
		[
			['claude', 5, 0.5],
			['gpt', 0, 0],
			['gemini', 5, 0.5]
		]
	)
})

test('cost converts micro-USD to USD; null sum stays 0 and pricedTurns tells it apart', () => {
	const stats = buildDashboardStats(
		raw({ totalTurns: 2, costMicroSum: 123456, pricedTurns: 2 })
	)
	close(stats.totalCostUsd, 0.123456, 1e-9)
	assert.equal(stats.pricedTurns, 2)

	const unpriced = buildDashboardStats(raw({ totalTurns: 3, costMicroSum: null, pricedTurns: 0 }))
	assert.equal(unpriced.totalCostUsd, 0)
	assert.equal(unpriced.pricedTurns, 0)
})

test('latest Jev latency is the newest recent turn; per-turn cost stays null when unpriced', () => {
	const stats = buildDashboardStats(
		raw({
			totalTurns: 2,
			recent: [
				{
					at: '2026-09-30T12:00:01.000Z',
					chosenModel: 'claude',
					jevLatencyMs: 620,
					totalLatencyMs: 1800,
					costMicroUsd: 2500
				},
				{
					at: '2026-09-30T12:00:00.000Z',
					chosenModel: 'gpt',
					jevLatencyMs: 540,
					totalLatencyMs: null,
					costMicroUsd: null
				}
			]
		})
	)
	assert.equal(stats.latestJevLatencyMs, 620)
	assert.equal(stats.recent.length, 2)
	assert.equal(stats.recent[0]?.chosenModel, 'claude')
	close(stats.recent[0]?.costUsd ?? NaN, 0.0025, 1e-9)
	assert.equal(stats.recent[1]?.costUsd, null)
	assert.equal(stats.recent[1]?.totalLatencyMs, null)
})

test('an out-of-vocab chosenModel is dropped from recent rather than coerced', () => {
	const stats = buildDashboardStats(
		raw({
			totalTurns: 1,
			recent: [
				{
					at: '2026-09-30T12:00:00.000Z',
					chosenModel: 'llama',
					jevLatencyMs: 100,
					totalLatencyMs: null,
					costMicroUsd: null
				}
			]
		})
	)
	assert.deepEqual(stats.recent, [])
	// With the only recent row dropped, there is no honest "live" gauge value.
	assert.equal(stats.latestJevLatencyMs, null)
})
