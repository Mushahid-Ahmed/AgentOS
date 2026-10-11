import test from 'node:test'
import assert from 'node:assert/strict'
import {
	AGENTOS_BENCHMARK_SETUPS,
	buildAgentosBenchmarkReport,
	formatRate,
	formatScore,
	summarizeSetup,
	type JudgeVerdict,
	type SetupTaskResult
} from './stats'

function result(over: Partial<SetupTaskResult> & { taskId: string; setup: SetupTaskResult['setup'] }): SetupTaskResult {
	return {
		ok: true,
		answer: 'a',
		error: null,
		citations: 0,
		verifiedClaims: 0,
		contestedClaims: 0,
		refutedClaims: 0,
		costMicroUsd: 0,
		latencyMs: 0,
		modelCalls: 0,
		toolCalls: 0,
		replans: 0,
		...over
	}
}

function verdict(taskId: string, setup: JudgeVerdict['setup'], score: number, unsupported = 0): JudgeVerdict {
	return { taskId, setup, score, unsupportedClaims: unsupported, notes: '', judgeModel: 'gpt-4.1' }
}

const META = {
	runId: '1',
	label: 'pilot',
	judgeModel: 'gpt-4.1',
	generatorModel: 'gemini-2.5-flash',
	startedAt: '2026-10-01T00:00:00.000Z',
	finishedAt: '2026-10-01T00:01:00.000Z',
	taskCount: 2
}

test('summarizeSetup computes success rate over attempted rows', () => {
	const rows = [
		result({ taskId: 't1', setup: 'agentos', ok: true, costMicroUsd: 100, latencyMs: 10 }),
		result({ taskId: 't2', setup: 'agentos', ok: false, error: 'boom', costMicroUsd: 0, latencyMs: 0 })
	]
	const s = summarizeSetup('agentos', rows, [])
	assert.equal(s.attempted, 2)
	assert.equal(s.completed, 1)
	assert.equal(s.successRate, 0.5)
	// Cost/latency means are over successful runs only.
	assert.equal(s.meanCostMicroUsd, 100)
	assert.equal(s.meanLatencyMs, 10)
	assert.equal(s.meanJudgeScore, null)
})

test('summarizeSetup averages judge scores only for judged successful rows', () => {
	const rows = [
		result({ taskId: 't1', setup: 'baseline_a' }),
		result({ taskId: 't2', setup: 'baseline_a' }),
		result({ taskId: 't3', setup: 'baseline_a', ok: false })
	]
	const verdicts = [verdict('t1', 'baseline_a', 0.8), verdict('t2', 'baseline_a', 0.6)]
	const s = summarizeSetup('baseline_a', rows, verdicts)
	assert.equal(s.judged, 2)
	assert.equal(s.meanJudgeScore, 0.7)
	assert.equal(s.meanUnsupportedClaims, 0)
})

test('summarizeSetup sums replans and averages citations', () => {
	const rows = [
		result({ taskId: 't1', setup: 'agentos', citations: 4, verifiedClaims: 2, contestedClaims: 1, replans: 1 }),
		result({ taskId: 't2', setup: 'agentos', citations: 2, verifiedClaims: 0, contestedClaims: 0, replans: 2 })
	]
	const s = summarizeSetup('agentos', rows, [])
	assert.equal(s.totalReplans, 3)
	assert.equal(s.meanCitations, 3)
	assert.equal(s.meanVerifiedClaims, 1)
	assert.equal(s.meanContestedClaims, 0.5)
})

test('summarizeSetup returns an empty summary for a setup with no rows', () => {
	const s = summarizeSetup('baseline_b', [], [])
	assert.equal(s.attempted, 0)
	assert.equal(s.successRate, 0)
	assert.equal(s.meanJudgeScore, null)
	assert.equal(s.meanCostMicroUsd, null)
})

test('buildAgentosBenchmarkReport reports per-task winners and AgentOS best/never-best', () => {
	const rows = [
		result({ taskId: 't1', setup: 'baseline_a' }),
		result({ taskId: 't1', setup: 'agentos' }),
		result({ taskId: 't2', setup: 'baseline_a' }),
		result({ taskId: 't2', setup: 'agentos' })
	]
	const verdicts = [
		verdict('t1', 'baseline_a', 0.4),
		verdict('t1', 'agentos', 0.9),
		verdict('t2', 'baseline_a', 0.8),
		verdict('t2', 'agentos', 0.5)
	]
	const report = buildAgentosBenchmarkReport(META, rows, verdicts)
	assert.equal(report.setups.length, AGENTOS_BENCHMARK_SETUPS.length)
	assert.equal(report.agentosBestCount, 1) // t1
	assert.equal(report.agentosNeverBestCount, 1) // t2
	const t1 = report.perTaskWinners.find((w) => w.taskId === 't1')
	assert.deepEqual(t1?.winners, ['agentos'])
	assert.equal(t1?.bestScore, 0.9)
})

test('buildAgentosBenchmarkReport lists ties as joint winners', () => {
	const rows = [
		result({ taskId: 't1', setup: 'baseline_a' }),
		result({ taskId: 't1', setup: 'agentos' })
	]
	const verdicts = [verdict('t1', 'baseline_a', 0.7), verdict('t1', 'agentos', 0.7)]
	const report = buildAgentosBenchmarkReport(META, rows, verdicts)
	const t1 = report.perTaskWinners.find((w) => w.taskId === 't1')
	assert.deepEqual(t1?.winners, ['baseline_a', 'agentos'])
	// A tie counts as AgentOS being (joint-)best.
	assert.equal(report.agentosBestCount, 1)
	assert.equal(report.agentosNeverBestCount, 0)
})

test('buildAgentosBenchmarkReport skips tasks with no judged successful row', () => {
	const rows = [result({ taskId: 't1', setup: 'baseline_a', ok: false })]
	const report = buildAgentosBenchmarkReport(META, rows, [])
	assert.equal(report.perTaskWinners.length, 0)
	assert.equal(report.agentosBestCount, 0)
	assert.equal(report.agentosNeverBestCount, 0)
})

test('format helpers are honest about null', () => {
	assert.equal(formatScore(null), '—')
	assert.equal(formatScore(0.8333), '0.83')
	assert.equal(formatRate(null), '—')
	assert.equal(formatRate(0.5), '50%')
})
