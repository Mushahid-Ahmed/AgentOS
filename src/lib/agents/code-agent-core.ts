// The Code/Data agent's pure core (§11 "Code/Data agent (calculator/code)" + §13
// MCP tool priority 1). Split from the server wrapper so the honesty logic — the
// part that must NEVER invent a number — is unit-testable at $0 with a mocked
// model completer and a mocked tool call, exactly like the orchestra core.
//
// Flow: ask the routed model to translate the user's request into ONE arithmetic
// expression (or NONE), hand that expression to the calculator MCP tool via
// ctx.callTool, and return the tool's exact value. If the model declines, the tool
// fails, or the tool's output can't be read, the step reports that honestly and
// produces NO number (§13: "an agent must report a tool failed rather than invent
// output").
//
// Pure: no 'server-only', no fetch, no Prisma, no SDK. The real model call and the
// real MCP tool live behind the injected `completer` and `callTool`.

import { isModelLabel } from '@/lib/models'
import { CALCULATOR_TOOL } from '@/lib/mcp/calculator'
import type { StepResult, ToolResult } from '@/lib/orchestra/types'

// Tight, single-purpose system prompt. The model's ONLY job is natural language ->
// one arithmetic expression the calculator can evaluate; keeping the output narrow
// is what makes the tool call reliable and the exact number tool-verified rather
// than model-guessed.
export const EXPRESSION_SYSTEM_PROMPT =
	'You are the Code/Data agent inside AgentOS, an adaptive multi-agent system. ' +
	'Your ONLY job is to turn the user request into a single exact arithmetic expression that a calculator will evaluate. ' +
	'Output ONLY the expression itself — no words, no explanation, no equals sign, no code fences, no units. ' +
	'Use only digits, decimal points, and the operators + - * / % (modulo) ^ (power), with parentheses where needed. ' +
	'Write percentages as decimals: "15% of 240" becomes 240*0.15. ' +
	'If the request needs no calculation, or cannot be expressed as pure arithmetic, output exactly: NONE'

export type CodeMessage = { role: 'system' | 'user'; content: string }

export type CodeModelCompletion = {
	text: string
	tokens: { input: number; output: number }
	// Real cost for the model call in integer millionths of a USD, or undefined
	// when the provider returned none (never fabricated, never 0).
	costMicroUsd?: number
}

// Injected so the core never imports the server-only NanoGPT/trackAiCall path.
// Throws on a failed call, carrying an optional HTTP `status` so runCodeStep can
// decide retryability (429/5xx transient, 4xx not) — the same contract the
// generating agents rely on from completeOnce/NanoGPTError.
export type CodeCompleter = (messages: CodeMessage[], maxTokens: number) => Promise<CodeModelCompletion>

export type CalcOutput = { expression: string; value: number }

export type CodeStepDeps = {
	query: string
	// The model the Decision Bus routed to this step (ctx.model). Opaque string so
	// the core stays decoupled; validated with isModelLabel.
	model: string
	completer: CodeCompleter
	callTool: (name: string, args: unknown) => Promise<ToolResult>
	maxTokens?: number
	// Free-form step note (the server wrapper passes the model's display name).
	notes?: string
}

// The model outputs only a short expression, so a small cap keeps NanoGPT's
// credit reserve tiny (same 402 rationale as the generating agents) and is ample.
const DEFAULT_CODE_MAX_TOKENS = 64

// Normalize a model's raw text into a bare arithmetic expression, or '' when there
// is nothing to calculate. Models don't always obey "output ONLY the expression",
// so strip the common decorations rather than failing the step: a wrapping code
// fence, a trailing "= value", surrounding quotes, and a trailing sentence period.
// "NONE" (any case) or empty means no calculation.
export function sanitizeExpression(text: string): string {
	let s = text.trim()
	// Unwrap a code fence (```lang\n expr \n``` or inline ```expr```). The language
	// tag is alphabetic only: an arithmetic expression never starts with a letter,
	// so matching digits here would eat the first operand of an inline-fenced
	// expression like ```2+2```.
	s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
	// Keep only the left-hand side if the model showed "expr = value".
	const eq = s.indexOf('=')
	if (eq !== -1) s = s.slice(0, eq).trim()
	// Strip one layer of surrounding quotes.
	if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
		s = s.slice(1, -1).trim()
	}
	// Strip a single trailing period (sentence punctuation). A valid expression
	// never ends in a decimal point, so this can't corrupt a number.
	s = s.replace(/\.$/, '').trim()
	if (s.length === 0 || s.toUpperCase() === 'NONE') return ''
	return s
}

// Narrow the calculator tool's output to {expression, value}. The MCP calculator
// returns structuredContent {expression, value}; anything else (a bare string, a
// missing or non-finite value) yields null so the caller reports an unreadable
// result rather than guessing a number.
export function readCalcOutput(output: unknown, fallbackExpression: string): CalcOutput | null {
	if (output == null || typeof output !== 'object') return null
	const rec = output as Record<string, unknown>
	const value = rec.value
	if (typeof value !== 'number' || !Number.isFinite(value)) return null
	const expression =
		typeof rec.expression === 'string' && rec.expression.trim().length > 0 ? rec.expression : fallbackExpression
	return { expression, value }
}

/**
 * Run one Code/Data step: model -> expression -> calculator tool -> exact value.
 *
 * Every non-happy path returns an honest StepResult and NEVER a fabricated number:
 * an unknown routed model or a thrown model call fails the step (the completer is
 * not even called for an unknown model); a "NONE"/empty expression, a failed tool
 * call, or an unreadable tool result all fail the step with a specific error while
 * still reporting the real model spend (costMicroUsd) so the budget guard records
 * true cost. Retryability mirrors the generating agents: a thrown call is
 * retryable on 429/5xx/unknown status, everything else here is a hard failure.
 */
export async function runCodeStep(deps: CodeStepDeps): Promise<StepResult> {
	const maxTokens = deps.maxTokens ?? DEFAULT_CODE_MAX_TOKENS

	// The model is the routing decision, not the agent's choice. A malformed plan
	// that named a non-label model fails honestly rather than substituting a default
	// — and the (paid) completer is never called.
	if (!isModelLabel(deps.model)) {
		return { ok: false, error: `unknown_model:${deps.model}`, retryable: false }
	}

	const messages: CodeMessage[] = [
		{ role: 'system', content: EXPRESSION_SYSTEM_PROMPT },
		{ role: 'user', content: deps.query }
	]

	let completion: CodeModelCompletion
	try {
		completion = await deps.completer(messages, maxTokens)
	} catch (error) {
		const status = (error as { status?: number } | null)?.status
		const retryable = status == null || status === 429 || status >= 500
		const message = error instanceof Error ? error.message : 'model_call_failed'
		return { ok: false, error: message, retryable }
	}

	const tokens = completion.tokens
	const costMicroUsd = completion.costMicroUsd
	const expression = sanitizeExpression(completion.text)

	// The model declined (NONE) or produced nothing calculable. This is NOT an
	// error: the Decision Bus also routes `coding`/open-ended tasks here, and those
	// legitimately do not reduce to exact arithmetic. Contribute an honest "no
	// calculation" note so the lead can still answer from its own knowledge, and
	// NEVER invent a number. The tool is not called. (A genuine arithmetic request
	// yields an expression, so this path does not mask a real data-task result.)
	if (expression.length === 0) {
		return {
			ok: true,
			output: { text: 'No exact calculation was needed or derivable for this request; answered without the calculator.' },
			notes: deps.notes ?? 'code agent produced no calculation',
			tokens,
			costMicroUsd
		}
	}

	const tool = await deps.callTool(CALCULATOR_TOOL, { expression })
	if (!tool.ok) {
		// §13: report the tool failed rather than invent output. The model call was
		// still real spend, so pass its cost through for honest budget accounting.
		return { ok: false, error: `calculator_failed: ${tool.error}`, retryable: false, tokens, costMicroUsd }
	}

	const calc = readCalcOutput(tool.output, expression)
	if (!calc) {
		return { ok: false, error: 'calculator_returned_unreadable_output', retryable: false, tokens, costMicroUsd }
	}

	return {
		ok: true,
		output: {
			// The synthesizer reads output.text for its findings block; keep it a
			// plain "expr = value" so the exact result is quotable and auditable.
			text: `${calc.expression} = ${calc.value}`,
			value: calc.value,
			expression: calc.expression,
			tool: CALCULATOR_TOOL
		},
		notes: deps.notes ?? `calculated via ${CALCULATOR_TOOL}`,
		tokens,
		costMicroUsd
	}
}
