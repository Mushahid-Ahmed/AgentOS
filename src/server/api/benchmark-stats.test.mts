import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	quantile,
	latencyStats,
	routerStats,
	routerAgreement,
	speedUpFactor,
	buildReport,
	type BenchmarkResultRow
} from './benchmark-stats'

// The stats module is the arithmetic behind every number the dashboard shows,
// so it is tested directly rather than through a live run: a percentile or
// accuracy bug here would produce plausible, self-consistent, wrong figures —
// the hardest kind to notice.

function close(actual: number, expected: number, eps = 1e-9): void {
	assert.ok(Math.abs(actual - expected) <= eps, `expected ~${expected}, got ${actual}`)
}

function row(partial: Partial<BenchmarkResultRow> & { promptId: string }): BenchmarkResultRow {
	return {
		router: 'jev',
		latencyMs: 0,
		label: '',
		expectedLabel: 'gpt',
		agreed: false,
		error: null,
		...partial
	}
}

test('quantile interpolates between closest ranks', () => {
	assert.equal(quantile([], 0.5), 0)
	assert.equal(quantile([5], 0.5), 5)
	assert.equal(quantile([5], 0.95), 5)
	close(quantile([1, 2, 3, 4], 0.5), 2.5)
	close(quantile([1, 2, 3, 4], 0.95), 3.85, 1e-6)
	// Odd count: the median is the middle element exactly.
	assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3)
	assert.equal(quantile([10, 20, 30], 0), 10)
	assert.equal(quantile([10, 20, 30], 1), 30)
})

test('latencyStats summarizes and rounds, and is all-zero when empty', () => {
	const empty = latencyStats([])
	assert.deepEqual(empty, { count: 0, p50: 0, p95: 0, mean: 0, min: 0, max: 0 })

	const stats = latencyStats([300, 100, 200])
	assert.equal(stats.count, 3)
	assert.equal(stats.min, 100)
	assert.equal(stats.max, 300)
	assert.equal(stats.mean, 200)
	assert.equal(stats.p50, 200)
	assert.equal(stats.p95, 290)
})

test('routerStats measures accuracy and latency over successes, failure rate over all', () => {
	const rows = [
		row({ promptId: 'a', latencyMs: 700, label: 'claude', expectedLabel: 'claude', agreed: true }),
		row({ promptId: 'b', latencyMs: 900, label: 'gpt', expectedLabel: 'gemini', agreed: false }),
		row({ promptId: 'c', latencyMs: 0, label: '', error: 'jev_http_429' })
	]
	const stats = routerStats('jev', rows)
	assert.equal(stats.router, 'jev')
	assert.equal(stats.total, 3)
	assert.equal(stats.ok, 2)
	assert.equal(stats.errors, 1)
	close(stats.failureRate, 0.3333, 1e-4)
	// Accuracy is over the 2 successes: 1 agreed / 2 = 0.5, not 1/3.
	close(stats.accuracy, 0.5)
	assert.equal(stats.agreed, 1)
	// Latency excludes the failed row, so it spans only 700 and 900.
	assert.equal(stats.latency.count, 2)
	assert.equal(stats.latency.min, 700)
	assert.equal(stats.latency.max, 900)
	assert.equal(stats.latency.p50, 800)
})

test('routerStats handles all-error and empty inputs without dividing by zero', () => {
	const allErrors = routerStats('judge', [
		row({ promptId: 'a', router: 'judge', error: 'timeout' }),
		row({ promptId: 'b', router: 'judge', error: 'timeout' })
	])
	assert.equal(allErrors.ok, 0)
	assert.equal(allErrors.errors, 2)
	close(allErrors.failureRate, 1)
	assert.equal(allErrors.accuracy, 0)
	assert.equal(allErrors.latency.count, 0)

	const empty = routerStats('jev', [])
	assert.equal(empty.total, 0)
	assert.equal(empty.failureRate, 0)
	assert.equal(empty.accuracy, 0)
})

test('routerAgreement matches by promptId over prompts both routers completed', () => {
	const jev = [
		row({ promptId: 'a', label: 'claude' }),
		row({ promptId: 'b', label: 'gpt' }),
		row({ promptId: 'c', label: 'gemini' }),
		row({ promptId: 'd', label: '', error: 'timeout' })
	]
	const judge = [
		row({ promptId: 'a', router: 'judge', label: 'claude' }), // same
		row({ promptId: 'b', router: 'judge', label: 'gemini' }), // different
		row({ promptId: 'c', router: 'judge', label: '', error: 'invalid_label' }), // judge failed
		row({ promptId: 'd', router: 'judge', label: 'gpt' }) // jev failed
	]
	// Only 'a' and 'b' have both routers ok; they agree on 'a' only => 1/2.
	const { bothOk, agreement } = routerAgreement(jev, judge)
	assert.equal(bothOk, 2)
	close(agreement, 0.5)
})

test('speedUpFactor is judge p50 over jev p50, and null when either side has no latency', () => {
	const jev = latencyStats([700])
	const judge = latencyStats([1400])
	close(speedUpFactor(jev, judge) ?? NaN, 2)

	// No successful Jev latency => no honest speed-up, never a fabricated 1.
	assert.equal(speedUpFactor(latencyStats([]), judge), null)
	assert.equal(speedUpFactor(jev, latencyStats([])), null)
})

test('buildReport assembles the honest report with a free Jev side', () => {
	const jev = [row({ promptId: 'a', latencyMs: 700, label: 'claude', expectedLabel: 'claude', agreed: true })]
	const judge = [
		row({ promptId: 'a', router: 'judge', latencyMs: 1400, label: 'claude', expectedLabel: 'claude', agreed: true })
	]
	const report = buildReport(
		{
			runId: '42',
			label: 'smoke',
			judgeModel: 'openai/gpt-4.1-nano',
			concurrency: 1,
			startedAt: '2026-09-30T00:00:00.000Z',
			finishedAt: '2026-09-30T00:01:00.000Z',
			promptCount: 1,
			judgeRoutingCostUsd: 0.000123456789
		},
		jev,
		judge
	)
	assert.equal(report.runId, '42')
	assert.equal(report.promptCount, 1)
	assert.equal(report.jevRoutingCostUsd, 0)
	close(report.judgeRoutingCostUsd, 0.00012346, 1e-8)
	assert.equal(report.bothOk, 1)
	close(report.routerAgreement, 1)
	close(report.speedUpFactor ?? NaN, 2)
	assert.equal(report.jev.accuracy, 1)
	assert.equal(report.judge.accuracy, 1)
})
