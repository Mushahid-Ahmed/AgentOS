import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gateDecision, isPublicPath, stripLocale, type GateDecision } from './route-gate'

const LOCALES = ['en'] as const

function decide(input: {
	pathname: string
	hasUser?: boolean
	configured?: boolean
	method?: string
	search?: string
}): GateDecision {
	return gateDecision({
		normalized: stripLocale(input.pathname, LOCALES),
		pathname: input.pathname,
		search: input.search ?? '',
		hasUser: input.hasUser ?? false,
		configured: input.configured ?? true,
		isGet: (input.method ?? 'GET') === 'GET'
	})
}

test('public allowlist covers exactly the marketing + auth surfaces', () => {
	for (const path of ['/', '/login', '/signup', '/auth/callback', '/auth/anything']) {
		assert.equal(isPublicPath(path), true, path)
	}
	for (const path of ['/app', '/dashboard', '/agentos', '/admin', '/api/chat']) {
		assert.equal(isPublicPath(path), false, path)
	}
})

test('stripLocale normalizes hand-typed locale prefixes', () => {
	assert.equal(stripLocale('/en/login', LOCALES), '/login')
	assert.equal(stripLocale('/en', LOCALES), '/')
	assert.equal(stripLocale('/dashboard', LOCALES), '/dashboard')
	assert.equal(stripLocale('/endpoint', LOCALES), '/endpoint')
})

test('anonymous visitors are gated to /login with next preserved', () => {
	const decision = decide({ pathname: '/dashboard', search: '?x=1' })
	assert.deepEqual(decision, { kind: 'login', next: '/dashboard?x=1' })
	assert.deepEqual(decide({ pathname: '/app' }), { kind: 'login', next: '/app' })
	assert.deepEqual(decide({ pathname: '/agentos' }), { kind: 'login', next: '/agentos' })
})

test('anonymous visitors reach public paths untouched', () => {
	assert.deepEqual(decide({ pathname: '/' }), { kind: 'allow' })
	assert.deepEqual(decide({ pathname: '/login' }), { kind: 'allow' })
	assert.deepEqual(decide({ pathname: '/signup' }), { kind: 'allow' })
	assert.deepEqual(decide({ pathname: '/auth/callback' }), { kind: 'allow' })
})

test('signed-in visitors are bounced off marketing and auth pages into /app', () => {
	for (const pathname of ['/', '/login', '/signup']) {
		assert.deepEqual(decide({ pathname, hasUser: true }), { kind: 'app' }, pathname)
	}
	assert.deepEqual(decide({ pathname: '/dashboard', hasUser: true }), { kind: 'allow' })
})

test('gate fails open when Supabase is unconfigured', () => {
	assert.deepEqual(decide({ pathname: '/dashboard', configured: false }), { kind: 'allow' })
	assert.deepEqual(decide({ pathname: '/', hasUser: true, configured: false }), { kind: 'allow' })
})

test('gate never redirects non-GET requests (server actions POST to the current URL)', () => {
	assert.deepEqual(decide({ pathname: '/dashboard', method: 'POST' }), { kind: 'allow' })
	assert.deepEqual(decide({ pathname: '/login', hasUser: true, method: 'POST' }), { kind: 'allow' })
})
