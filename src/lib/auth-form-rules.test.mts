import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
	loginFailureMessage,
	safeNext,
	signupFailureMessage,
	validateEmail,
	validatePassword
} from './auth-form-rules'

// The ?next= param is attacker-controlled, so safeNext must only ever return a
// same-origin relative path (brief 15.4 / open-redirect prevention).
test('safeNext keeps relative same-origin paths', () => {
	assert.equal(safeNext(null), '/')
	assert.equal(safeNext('/'), '/')
	assert.equal(safeNext('/dashboard'), '/dashboard')
	assert.equal(safeNext('/agentos?run=42'), '/agentos?run=42')
})

test('safeNext rejects open-redirect shapes', () => {
	assert.equal(safeNext('//evil.com'), '/')
	assert.equal(safeNext('///evil.com'), '/')
	assert.equal(safeNext('https://evil.com'), '/')
	assert.equal(safeNext('http://localhost:3000.evil.com/x'), '/')
	assert.equal(safeNext('\\evil.com'), '/')
	assert.equal(safeNext('/\\evil.com'), '/')
	assert.equal(safeNext('javascript:alert(1)'), '/')
})

test('validateEmail accepts only plausible addresses', () => {
	assert.equal(validateEmail(''), 'Enter your email address.')
	assert.equal(validateEmail('   '), 'Enter your email address.')
	assert.equal(validateEmail('not-an-email'), 'That doesn’t look like a valid email address.')
	assert.equal(validateEmail('a@b'), 'That doesn’t look like a valid email address.')
	assert.equal(validateEmail('a b@c.co'), 'That doesn’t look like a valid email address.')
	assert.equal(validateEmail('demo@example.com'), undefined)
})

test('validatePassword enforces 8 chars on signup only', () => {
	assert.equal(validatePassword('', false), 'Enter your password.')
	assert.equal(validatePassword('short', true), 'Use at least 8 characters.')
	assert.equal(validatePassword('short1', false), undefined)
	assert.equal(validatePassword('longenough', true), undefined)
})

test('login failures never enumerate users', () => {
	const message = loginFailureMessage()
	assert.match(message, /couldn’t sign you in/i)
	// Same message regardless of which side failed upstream.
	assert.equal(loginFailureMessage(), loginFailureMessage())
})

test('signupFailureMessage maps provider errors to plain language', () => {
	assert.equal(
		signupFailureMessage('User already registered'),
		'An account with that email already exists. Try signing in instead.'
	)
	assert.equal(
		signupFailureMessage('email rate limit exceeded'),
		'Too many attempts. Wait a couple of minutes and try again.'
	)
	assert.equal(signupFailureMessage('Password should be at least 6 characters'), 'Use at least 8 characters.')
	assert.equal(
		signupFailureMessage('Unable to validate email address: invalid format'),
		'That doesn’t look like a valid email address.'
	)
	// Unknown errors pass through rather than being swallowed.
	assert.equal(signupFailureMessage('Something exploded'), 'Something exploded')
})
