import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	DEFAULT_FAILURE_THRESHOLD,
	allowRequest,
	createHealthStore,
	onFailure,
	onSuccess,
	stateAt
} from './circuit'
import { freshHealth } from './registry'

// Pure circuit-breaker tests. Clock is a plain number we advance by hand ($0).

test('stateAt: closed stays closed, open before cooldown stays open', () => {
	const h = freshHealth(1_000)
	assert.equal(stateAt(h, 0), 'closed')
	const opened = onFailure(h, 'server-error', 0, { failureThreshold: 1 })
	assert.equal(opened.circuit, 'open')
	assert.equal(stateAt(opened, 500), 'open')
	assert.equal(allowRequest(opened, 500), false)
})

test('stateAt: open becomes half-open once the cooldown elapses', () => {
	const opened = onFailure(freshHealth(1_000), 'server-error', 0, { failureThreshold: 1 })
	assert.equal(stateAt(opened, 1_000), 'half-open')
	assert.equal(allowRequest(opened, 1_000), true)
})

test('onFailure: threshold kinds need N consecutive failures to open', () => {
	let h = freshHealth(1_000)
	h = onFailure(h, 'server-error', 0, { failureThreshold: DEFAULT_FAILURE_THRESHOLD })
	assert.equal(h.circuit, 'closed')
	assert.equal(h.consecutiveFailures, 1)
	h = onFailure(h, 'timeout', 1, { failureThreshold: DEFAULT_FAILURE_THRESHOLD })
	assert.equal(h.circuit, 'closed')
	assert.equal(h.consecutiveFailures, 2)
	h = onFailure(h, 'server-error', 2, { failureThreshold: DEFAULT_FAILURE_THRESHOLD })
	assert.equal(h.circuit, 'open')
	assert.equal(h.consecutiveFailures, 3)
})

test('onFailure: immediate-open kinds open on the FIRST failure', () => {
	for (const kind of ['unavailable', 'insufficient-credits'] as const) {
		const h = onFailure(freshHealth(1_000), kind, 0, { failureThreshold: 5 })
		assert.equal(h.circuit, 'open', `${kind} should open immediately`)
		assert.equal(h.consecutiveFailures, 1)
	}
})

test('onSuccess: closes the circuit and clears the failure streak', () => {
	const opened = onFailure(freshHealth(1_000), 'unavailable', 0)
	const closed = onSuccess(opened, 5_000)
	assert.equal(closed.circuit, 'closed')
	assert.equal(closed.consecutiveFailures, 0)
	assert.equal(closed.openedAt, null)
	assert.equal(closed.lastSuccessAt, 5_000)
})

test('half-open probe that fails re-opens with a fresh cooldown', () => {
	const opened = onFailure(freshHealth(1_000), 'server-error', 0, { failureThreshold: 1 })
	// Cooldown elapsed at t=1000 -> effectively half-open; a failing probe re-opens.
	const reopened = onFailure(opened, 'server-error', 1_000, { failureThreshold: 3 })
	assert.equal(reopened.circuit, 'open')
	assert.equal(reopened.openedAt, 1_000)
	assert.equal(stateAt(reopened, 1_500), 'open')
	assert.equal(stateAt(reopened, 2_000), 'half-open')
})

test('store: recordFailure reports opened only on the transition into open', () => {
	const store = createHealthStore({ now: () => 0, failureThreshold: 2, cooldownMs: 1_000 })
	const first = store.recordFailure('a', 'server-error', 0)
	assert.equal(first.opened, false)
	assert.equal(store.allow('a', 0), true)
	const second = store.recordFailure('a', 'server-error', 0)
	assert.equal(second.opened, true)
	assert.equal(store.allow('a', 0), false)
	// Failing again while still cooling is NOT a new open transition.
	const third = store.recordFailure('a', 'server-error', 10)
	assert.equal(third.opened, false)
})

test('store: half-open probe failing counts as a new open transition', () => {
	const store = createHealthStore({ now: () => 0, failureThreshold: 1, cooldownMs: 1_000 })
	store.recordFailure('a', 'server-error', 0) // opens at t=0
	assert.equal(store.allow('a', 1_000), true) // half-open
	const reopen = store.recordFailure('a', 'server-error', 1_000)
	assert.equal(reopen.opened, true)
	assert.equal(store.allow('a', 1_000), false)
})

test('store: recordSuccess restores service after an open circuit cools', () => {
	const store = createHealthStore({ now: () => 0, failureThreshold: 1, cooldownMs: 1_000 })
	store.recordFailure('a', 'unavailable', 0)
	assert.equal(store.allow('a', 500), false)
	assert.equal(store.allow('a', 1_000), true) // half-open probe allowed
	const healthy = store.recordSuccess('a', 1_000)
	assert.equal(healthy.circuit, 'closed')
	assert.equal(store.allow('a', 1_001), true)
})

test('store: onStateChange fires on every transition (Supabase persistence seam)', () => {
	const seen: Array<{ slug: string; circuit: string }> = []
	const store = createHealthStore({
		now: () => 0,
		failureThreshold: 1,
		cooldownMs: 1_000,
		onStateChange: (slug, health) => seen.push({ slug, circuit: health.circuit })
	})
	store.recordFailure('a', 'unavailable', 0)
	store.recordSuccess('a', 2_000)
	assert.deepEqual(seen, [
		{ slug: 'a', circuit: 'open' },
		{ slug: 'a', circuit: 'closed' }
	])
})

test('store: unknown slug starts fresh/closed and snapshot lists tracked health', () => {
	const store = createHealthStore({ now: () => 0, seed: { seeded: freshHealth(1_000) } })
	assert.equal(store.allow('never-seen', 0), true)
	assert.equal(store.get('never-seen').circuit, 'closed')
	assert.ok('seeded' in store.snapshot())
})
