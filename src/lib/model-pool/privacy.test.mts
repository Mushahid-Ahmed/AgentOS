import { test } from 'node:test'
import assert from 'node:assert/strict'

import { containsSecrets, detectSecrets, guardForTier } from './privacy'

// Pure privacy-guard tests with SYNTHETIC secret-shaped fixtures (never real keys).

const FAKE = {
	nanogpt: `sk-${'a'.repeat(30)}`,
	anthropic: `sk-ant-api03-${'b'.repeat(24)}`,
	openai: `sk-proj-${'c'.repeat(24)}`,
	github: `ghp_${'D'.repeat(30)}`,
	slack: `xoxb-${'1'.repeat(12)}-${'e'.repeat(12)}`,
	google: `AIza${'F'.repeat(30)}`,
	aws: `AKIA${'G'.repeat(14)}`,
	jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyMzQ1Njc4.em9kZS10ZXN0LWp3dC1zaWc', // allowlist secret (synthetic fixture, decodes to "emode-test-jwt-sig")
	privkey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEfake\n-----END RSA PRIVATE KEY-----', // allowlist secret (synthetic "MIIEfake" fixture)
	conn: 'postgres://user:sup3rs3cretpass@db.example.com:5432/app', // allowlist secret (synthetic example.com fixture)
	bearer: `Bearer ${'j'.repeat(30)}`,
	pwAssign: 'api_key = "kkkkkkkkkkkkkkkk"'
}

test('detectSecrets: recognises each secret family', () => {
	const cases: Array<[string, string]> = [
		[FAKE.nanogpt, 'generic-secret-key'],
		[FAKE.anthropic, 'anthropic-key'],
		[FAKE.openai, 'openai-key'],
		[FAKE.github, 'github-token'],
		[FAKE.slack, 'slack-token'],
		[FAKE.google, 'google-api-key'],
		[FAKE.aws, 'aws-access-key'],
		[FAKE.privkey, 'private-key-block'],
		[FAKE.conn, 'db-connection-string'],
		[FAKE.bearer, 'bearer-token'],
		[FAKE.pwAssign, 'password-assignment']
	]
	for (const [text, kind] of cases) {
		const found = detectSecrets(text).map((m) => m.kind)
		assert.ok(found.includes(kind as never), `expected ${kind} in ${JSON.stringify(found)} for ${text.slice(0, 12)}…`)
	}
})

test('detectSecrets: a JWT is caught', () => {
	assert.ok(detectSecrets(`token: ${FAKE.jwt}`).some((m) => m.kind === 'jwt'))
})

test('detectSecrets: never returns the raw secret (masked prefix + length only)', () => {
	const matches = detectSecrets(`key=${FAKE.nanogpt}`)
	assert.ok(matches.length > 0)
	for (const m of matches) {
		assert.ok(!m.masked.includes(FAKE.nanogpt), 'masked value must not contain the secret')
		assert.ok(m.masked.includes('chars'), 'masked value reports a length')
		assert.ok(m.masked.length <= 16, 'masked value is short')
	}
})

test('detectSecrets: ordinary prose has no false positives', () => {
	const clean =
		'The model pool fails over from premium to free models when a rate limit is hit, and records a degradation level.'
	assert.deepEqual(detectSecrets(clean), [])
	assert.equal(containsSecrets(clean), false)
})

test('detectSecrets: multiple secrets in one prompt are all found, sorted by index', () => {
	const text = `first ${FAKE.aws} then ${FAKE.google} finally ${FAKE.github}`
	const matches = detectSecrets(text)
	assert.ok(matches.length >= 3)
	const idx = matches.map((m) => m.index)
	assert.deepEqual(idx, [...idx].sort((a, b) => a - b))
})

test('guardForTier: free tier + a secret -> not allowed, route-premium', () => {
	const d = guardForTier(`my key is ${FAKE.anthropic}`, 'free')
	assert.equal(d.allowed, false)
	assert.equal(d.action, 'route-premium')
	assert.ok(d.matches.length > 0)
	assert.ok(d.reason.includes('must not be sent to a free model'))
})

test('guardForTier: free tier + clean text -> allowed', () => {
	const d = guardForTier('Summarise the evidence about rate limits.', 'free')
	assert.equal(d.allowed, true)
	assert.equal(d.action, 'send')
	assert.equal(d.matches.length, 0)
})

test('guardForTier: premium tier + a secret -> allowed but matches surfaced', () => {
	const d = guardForTier(`conn ${FAKE.conn}`, 'premium')
	assert.equal(d.allowed, true)
	assert.equal(d.action, 'send')
	assert.ok(d.matches.length > 0, 'still reports the secret so the caller can avoid echoing it')
	assert.ok(d.reason.includes('premium'))
})

test('guardForTier: a connection string with a password is caught before a free call', () => {
	const d = guardForTier(FAKE.conn, 'free')
	assert.equal(d.allowed, false)
	assert.ok(d.matches.some((m) => m.kind === 'db-connection-string'))
})
