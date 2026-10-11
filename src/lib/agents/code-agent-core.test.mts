import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	readCalcOutput,
	runCodeStep,
	sanitizeExpression,
	type CodeCompleter
} from './code-agent-core'
import { CALCULATOR_TOOL } from '../mcp/calculator'
import type { ToolResult } from '../orchestra/types'

// The Code/Data agent's honesty contract, proven at $0 with a mocked model
// completer and a mocked calculator tool (§13: "an agent must report a tool
// failed rather than invent output"). Nothing here touches the network — the
// whole point is that the never-invent-a-number logic is verified before a real
// model or a real MCP call is wired.

const TOKENS = { input: 10, output: 5 }

const okTool = (output: unknown, summary?: string): ToolResult => ({ ok: true, output, summary })
const errTool = (error: string): ToolResult => ({ ok: false, error })
const neverTool = (): Promise<ToolResult> => {
	throw new Error('callTool should not have been invoked')
}

// ---- sanitizeExpression --------------------------------------------------

test('sanitizeExpression strips model decoration and detects NONE', () => {
	assert.equal(sanitizeExpression('240*0.15'), '240*0.15')
	assert.equal(sanitizeExpression('  2+2  '), '2+2')
	assert.equal(sanitizeExpression('240*0.15 = 36'), '240*0.15')
	assert.equal(sanitizeExpression('```2+2```'), '2+2')
	assert.equal(sanitizeExpression('```js\n2+2\n```'), '2+2')
	assert.equal(sanitizeExpression('"2+2"'), '2+2')
	assert.equal(sanitizeExpression("'2+2'"), '2+2')
	assert.equal(sanitizeExpression('2+2.'), '2+2')
	assert.equal(sanitizeExpression('NONE'), '')
	assert.equal(sanitizeExpression('none'), '')
	assert.equal(sanitizeExpression('  None  '), '')
	assert.equal(sanitizeExpression(''), '')
	assert.equal(sanitizeExpression('   '), '')
})

// ---- readCalcOutput ------------------------------------------------------

test('readCalcOutput narrows the structured calculator result and rejects junk', () => {
	assert.deepEqual(readCalcOutput({ expression: '2+2', value: 4 }, 'fb'), { expression: '2+2', value: 4 })
	// A present value with no expression falls back to the one we sent.
	assert.deepEqual(readCalcOutput({ value: 4 }, 'fallback'), { expression: 'fallback', value: 4 })
	assert.equal(readCalcOutput({ expression: '2+2' }, 'fb'), null)
	assert.equal(readCalcOutput({ value: Number.NaN }, 'fb'), null)
	assert.equal(readCalcOutput({ value: Number.POSITIVE_INFINITY }, 'fb'), null)
	assert.equal(readCalcOutput('4', 'fb'), null)
	assert.equal(readCalcOutput(42, 'fb'), null)
	assert.equal(readCalcOutput(null, 'fb'), null)
	assert.equal(readCalcOutput(undefined, 'fb'), null)
})

// ---- runCodeStep: happy path --------------------------------------------

test('runCodeStep evaluates a model expression via the calculator tool', async () => {
	const toolCalls: Array<{ name: string; args: unknown }> = []
	const completer: CodeCompleter = async () => ({ text: '240*0.15', tokens: TOKENS, costMicroUsd: 1234 })
	const callTool = async (name: string, args: unknown): Promise<ToolResult> => {
		toolCalls.push({ name, args })
		return okTool({ expression: '240*0.15', value: 36 }, '240*0.15 = 36')
	}

	const result = await runCodeStep({ query: 'What is 15% of 240?', model: 'gpt', completer, callTool })

	assert.equal(result.ok, true)
	assert.deepEqual(toolCalls, [{ name: CALCULATOR_TOOL, args: { expression: '240*0.15' } }])
	if (result.ok) {
		assert.equal(result.output?.text, '240*0.15 = 36')
		assert.equal(result.output?.value, 36)
		assert.equal(result.output?.expression, '240*0.15')
		assert.equal(result.output?.tool, CALCULATOR_TOOL)
	}
	assert.equal(result.costMicroUsd, 1234)
	assert.deepEqual(result.tokens, TOKENS)
})

test('runCodeStep sanitizes model decoration before calling the tool', async () => {
	let seenArgs: unknown = null
	const completer: CodeCompleter = async () => ({ text: '```\n240 * 0.15 = 36\n```', tokens: TOKENS })
	const callTool = async (_name: string, args: unknown): Promise<ToolResult> => {
		seenArgs = args
		return okTool({ expression: '240 * 0.15', value: 36 })
	}

	const result = await runCodeStep({ query: 'q', model: 'gpt', completer, callTool })

	assert.deepEqual(seenArgs, { expression: '240 * 0.15' })
	assert.equal(result.ok, true)
})

// ---- runCodeStep: honesty on failure ------------------------------------

test('runCodeStep reports a calculator failure and invents no number', async () => {
	const completer: CodeCompleter = async () => ({ text: '1/0', tokens: TOKENS, costMicroUsd: 999 })
	const callTool = async (): Promise<ToolResult> => errTool('division by zero')

	const result = await runCodeStep({ query: 'q', model: 'gpt', completer, callTool })

	assert.equal(result.ok, false)
	if (!result.ok) assert.equal(result.error, 'calculator_failed: division by zero')
	assert.equal(result.output, undefined, 'must not fabricate a value when the tool fails')
	assert.equal(result.retryable, false)
	// The model call was real spend even though the step failed.
	assert.equal(result.costMicroUsd, 999)
})

test('runCodeStep fails honestly on an unreadable calculator result', async () => {
	const completer: CodeCompleter = async () => ({ text: '2+2', tokens: TOKENS, costMicroUsd: 7 })
	// A bare string, not the {expression, value} the calculator server returns.
	const callTool = async (): Promise<ToolResult> => okTool('4')

	const result = await runCodeStep({ query: 'q', model: 'gpt', completer, callTool })

	assert.equal(result.ok, false)
	if (!result.ok) assert.equal(result.error, 'calculator_returned_unreadable_output')
	assert.equal(result.output, undefined)
	assert.equal(result.costMicroUsd, 7)
})

test('runCodeStep degrades gracefully when the model returns NONE (no invented number)', async () => {
	let toolCalled = false
	const completer: CodeCompleter = async () => ({ text: 'NONE', tokens: TOKENS, costMicroUsd: 5 })
	const callTool = async (): Promise<ToolResult> => {
		toolCalled = true
		return okTool({ value: 0 })
	}

	const result = await runCodeStep({ query: 'hello there', model: 'gemini', completer, callTool })

	// NONE is a legitimate "no arithmetic applies" determination, not an error: the
	// step succeeds so the lead can still answer, and the calculator is never called.
	assert.equal(toolCalled, false)
	assert.equal(result.ok, true)
	if (result.ok) {
		// Never fabricate a number when there was nothing to calculate.
		assert.equal(result.output?.value, undefined)
		assert.equal(typeof result.output?.text, 'string')
	}
	// The model call was real spend even though no calculation happened.
	assert.equal(result.costMicroUsd, 5)
})

// ---- runCodeStep: model routing + transient errors ----------------------

test('runCodeStep rejects an unknown routed model without calling the model', async () => {
	let completerCalled = false
	const completer: CodeCompleter = async () => {
		completerCalled = true
		return { text: '1+1', tokens: TOKENS }
	}

	const result = await runCodeStep({ query: 'q', model: 'opus', completer, callTool: neverTool })

	assert.equal(completerCalled, false)
	assert.equal(result.ok, false)
	if (!result.ok) assert.equal(result.error, 'unknown_model:opus')
	assert.equal(result.retryable, false)
})

test('runCodeStep treats a 429/5xx model error as retryable', async () => {
	const completer: CodeCompleter = async () => {
		throw Object.assign(new Error('rate limited'), { status: 429 })
	}

	const result = await runCodeStep({ query: 'q', model: 'gpt', completer, callTool: neverTool })

	assert.equal(result.ok, false)
	assert.equal(result.retryable, true)
	if (!result.ok) assert.equal(result.error, 'rate limited')
})

test('runCodeStep treats a 4xx model error as non-retryable', async () => {
	const completer: CodeCompleter = async () => {
		throw Object.assign(new Error('bad request'), { status: 400 })
	}

	const result = await runCodeStep({ query: 'q', model: 'gpt', completer, callTool: neverTool })

	assert.equal(result.ok, false)
	assert.equal(result.retryable, false)
})

test('runCodeStep treats a status-less throw as retryable', async () => {
	const completer: CodeCompleter = async () => {
		throw new Error('network dropped')
	}

	const result = await runCodeStep({ query: 'q', model: 'claude', completer, callTool: neverTool })

	assert.equal(result.ok, false)
	assert.equal(result.retryable, true)
})
