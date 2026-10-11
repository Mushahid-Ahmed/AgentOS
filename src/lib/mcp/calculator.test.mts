import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate } from './calculator'

// Narrowing helpers so each assertion reads the discriminated union safely.
function val(expression: string): number {
	const r = evaluate(expression)
	assert.equal(r.ok, true, `expected "${expression}" to succeed${r.ok ? '' : `, got: ${r.error}`}`)
	return r.ok ? r.value : Number.NaN
}
function errOf(expression: string): string {
	const r = evaluate(expression)
	assert.equal(r.ok, false, `expected "${expression}" to fail`)
	return r.ok ? '' : r.error
}

test('evaluates the four operators with correct precedence', () => {
	assert.equal(val('2+2'), 4)
	assert.equal(val('2+3*4'), 14) // * before +
	assert.equal(val('(2+3)*4'), 20) // parens override
	assert.equal(val('10-2-3'), 5) // left-associative subtraction
	assert.equal(val('100/5/2'), 10) // left-associative division
	assert.equal(val('7%3'), 1) // modulo
})

test('handles decimals, unary minus, and power (right-assoc, tighter than unary)', () => {
	assert.equal(val('0.1+0.2'), 0.3) // binary-float noise cleaned
	assert.equal(val('3.5*2'), 7)
	assert.equal(val('-3+5'), 2)
	assert.equal(val('-(3+5)'), -8)
	assert.equal(val('2^3^2'), 512) // 2^(3^2), right-associative
	assert.equal(val('-2^2'), -4) // -(2^2), NOT (-2)^2
	assert.equal(val('2^-1'), 0.5) // signed exponent
	assert.equal(val('.5+.5'), 1) // leading-dot number
})

test('honours whitespace', () => {
	assert.equal(val('  12  /  4 '), 3)
	assert.equal(val('1 + 2\t*\n3'), 7)
})

test('rejects division/modulo by zero with an honest error, never Infinity', () => {
	assert.match(errOf('5/0'), /division by zero/)
	assert.match(errOf('5%0'), /modulo by zero/)
})

test('rejects malformed expressions', () => {
	for (const bad of ['2+', '*3', '(2+3', '2+3)', '', '   ', '2 3', '1..2', '2**3']) {
		assert.equal(evaluate(bad).ok, false, `expected "${bad}" to fail`)
	}
})

test('never evaluates injected code — non-arithmetic characters are rejected', () => {
	// If any of this reached eval/Function it would execute; the tokenizer must
	// reject every letter/keyword so the tool can safely take model-authored input.
	for (const attack of [
		'2+2; process.exit(1)',
		'constructor',
		'1+1 // hi',
		'require("fs")',
		'2 ** 3', // ** is not in the grammar (only ^)
		'Infinity',
		'1e5' // exponent notation is deliberately not tokenized as a number
	]) {
		assert.equal(evaluate(attack).ok, false, `expected injection "${attack}" to be rejected`)
	}
})

test('rejects an over-long expression before parsing', () => {
	assert.match(errOf('1+'.repeat(400) + '1'), /too long/)
})

test('returns the trimmed expression alongside the value', () => {
	const r = evaluate('  6*7 ')
	assert.equal(r.ok, true)
	if (r.ok) {
		assert.equal(r.value, 42)
		assert.equal(r.expression, '6*7')
	}
})
