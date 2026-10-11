import { test } from 'node:test'
import assert from 'node:assert/strict'

import { familyDegradationChain } from './chat-model-chain'
import { CHEAP_FLOOR_SLUG, NANOGPT_CATALOG } from '@/lib/models'

// Pure §5.3 degradation-chain tests, built from the real curated catalog ($0).

function slugs(chain: ReturnType<typeof familyDegradationChain>): string[] {
	return chain.map((l) => l.slug)
}

test('claude flagship steps down to the cheaper claude sibling, then the paid floor', () => {
	const chain = familyDegradationChain('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5')
	assert.deepEqual(slugs(chain), [
		'anthropic/claude-sonnet-4.5',
		'anthropic/claude-haiku-4.5',
		CHEAP_FLOOR_SLUG
	])
})

test('gpt flagship steps down through both cheaper gpt siblings, nearest-cheaper first', () => {
	const chain = familyDegradationChain('openai/gpt-4.1', 'GPT-4.1')
	// gpt-4o ($2.5/$10) is MORE expensive than gpt-4.1 ($2/$8) so it is excluded;
	// gpt-4o-mini ($0.75 total) then gpt-4.1-nano ($0.5 total) are the cheaper rungs.
	assert.deepEqual(slugs(chain), [
		'openai/gpt-4.1',
		'openai/gpt-4o-mini',
		'openai/gpt-4.1-nano',
		CHEAP_FLOOR_SLUG
	])
})

test('a cheaper-routed model never inserts a pricier same-family upgrade', () => {
	// gemini routes to gemini-2.5-flash; gemini-2.5-pro is the same family but an
	// UPGRADE, so the chain goes straight to the floor.
	const chain = familyDegradationChain('gemini-2.5-flash', 'Gemini 2.5 Flash')
	assert.deepEqual(slugs(chain), ['gemini-2.5-flash', CHEAP_FLOOR_SLUG])
})

test('the head keeps its curated displayName; rungs show the bare NanoGPT id', () => {
	const chain = familyDegradationChain('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5')
	assert.equal(chain[0]?.displayName, 'Claude Sonnet 4.5')
	// Publisher prefix stripped for the degradation rungs.
	assert.equal(chain[1]?.displayName, 'claude-haiku-4.5')
	assert.equal(chain[2]?.displayName, 'llama-3.3-70b-instruct')
})

test('every rung carries a known price (never null) so each can be costed', () => {
	for (const label of ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1', 'gemini-2.5-flash']) {
		for (const link of familyDegradationChain(label, label)) {
			assert.notEqual(link.promptPricePer1M, null, `${link.slug} prompt price`)
			assert.notEqual(link.completionPricePer1M, null, `${link.slug} completion price`)
		}
	}
})

test('the paid floor is always the last rung and appears exactly once', () => {
	const chain = familyDegradationChain('openai/gpt-4.1', 'GPT-4.1')
	assert.equal(chain[chain.length - 1]?.slug, CHEAP_FLOOR_SLUG)
	assert.equal(chain.filter((l) => l.slug === CHEAP_FLOOR_SLUG).length, 1)
})

test('routing the floor model itself yields a single-link chain (no duplicate)', () => {
	const chain = familyDegradationChain(CHEAP_FLOOR_SLUG, 'Llama 3.3 70B')
	assert.deepEqual(slugs(chain), [CHEAP_FLOOR_SLUG])
})

test('an uncurated head still leads (null prices) and is backed by the floor', () => {
	const chain = familyDegradationChain('some/unknown-model', 'Unknown')
	assert.equal(chain[0]?.slug, 'some/unknown-model')
	assert.equal(chain[0]?.promptPricePer1M, null)
	assert.equal(chain[chain.length - 1]?.slug, CHEAP_FLOOR_SLUG)
})

test('the chain never contains a slug absent from the curated catalog', () => {
	for (const label of ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1', 'gemini-2.5-flash']) {
		for (const link of familyDegradationChain(label, label)) {
			assert.ok(link.slug in NANOGPT_CATALOG, `${link.slug} must be curated`)
		}
	}
})
