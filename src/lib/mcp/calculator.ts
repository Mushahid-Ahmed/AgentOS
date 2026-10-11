// Safe arithmetic evaluator for the AgentOS calculator tool (§13 MCP tool
// priority 1: "calculator/data tool for the Code agent — pure code, keyless").
//
// This is a hand-written recursive-descent parser, NOT eval/Function: the input
// can originate from a model, so it is untrusted and must never reach a JS
// evaluator. Only digits, decimal points, the operators + - * / % ^ , parentheses
// and whitespace are accepted; any other character is an error. The whole point
// of the tool is that exact arithmetic never depends on a model doing math in its
// head, so a malformed or impossible expression returns an honest error rather
// than a fabricated number.
//
// Pure: no I/O, no 'server-only'. Unit-tested under `node --test`.

// A generous bound so a runaway model output can't feed the parser a megabyte.
const MAX_EXPRESSION_LENGTH = 500

// Canonical MCP tool name. Declared here (the pure module) so both the pure plan
// builder (TOOLS_BY_ROLE.code) and the server-side MCP registration import one
// source of truth — a pure module must never import a 'server-only' one.
export const CALCULATOR_TOOL = 'calculate'

export type CalcResult =
	| { ok: true; value: number; expression: string }
	| { ok: false; error: string }

type Token =
	| { kind: 'num'; value: number }
	| { kind: 'op'; op: '+' | '-' | '*' | '/' | '%' | '^' }
	| { kind: 'lparen' }
	| { kind: 'rparen' }

function isDigit(ch: string): boolean {
	return ch >= '0' && ch <= '9'
}

function tokenize(input: string): Token[] {
	const tokens: Token[] = []
	let i = 0
	while (i < input.length) {
		const ch = input[i] as string
		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
			i++
			continue
		}
		if (isDigit(ch) || (ch === '.' && isDigit(input[i + 1] as string))) {
			let j = i
			let seenDot = false
			while (j < input.length) {
				const c = input[j] as string
				if (isDigit(c)) {
					j++
				} else if (c === '.' && !seenDot) {
					seenDot = true
					j++
				} else {
					break
				}
			}
			const raw = input.slice(i, j)
			const value = Number(raw)
			if (!Number.isFinite(value)) throw new Error(`invalid number "${raw}"`)
			tokens.push({ kind: 'num', value })
			i = j
			continue
		}
		if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '^') {
			tokens.push({ kind: 'op', op: ch })
			i++
			continue
		}
		if (ch === '(') {
			tokens.push({ kind: 'lparen' })
			i++
			continue
		}
		if (ch === ')') {
			tokens.push({ kind: 'rparen' })
			i++
			continue
		}
		throw new Error(`unexpected character "${ch}"`)
	}
	return tokens
}

// Precedence (loosest to tightest): additive -> multiplicative -> unary sign ->
// power (right-associative) -> primary. Power binds tighter than unary minus so
// `-2^2 === -4` (standard maths), while an exponent may itself be signed
// (`2^-1 === 0.5`).
function parse(tokens: Token[]): number {
	let pos = 0
	const peek = (): Token | undefined => tokens[pos]
	const next = (): Token | undefined => tokens[pos++]

	function parseExpression(): number {
		let value = parseTerm()
		for (;;) {
			const t = peek()
			if (t && t.kind === 'op' && (t.op === '+' || t.op === '-')) {
				next()
				const rhs = parseTerm()
				value = t.op === '+' ? value + rhs : value - rhs
			} else {
				break
			}
		}
		return value
	}

	function parseTerm(): number {
		let value = parseUnary()
		for (;;) {
			const t = peek()
			if (t && t.kind === 'op' && (t.op === '*' || t.op === '/' || t.op === '%')) {
				next()
				const rhs = parseUnary()
				if (t.op === '*') {
					value = value * rhs
				} else if (t.op === '/') {
					if (rhs === 0) throw new Error('division by zero')
					value = value / rhs
				} else {
					if (rhs === 0) throw new Error('modulo by zero')
					value = value % rhs
				}
			} else {
				break
			}
		}
		return value
	}

	function parseUnary(): number {
		const t = peek()
		if (t && t.kind === 'op' && (t.op === '-' || t.op === '+')) {
			next()
			const v = parseUnary()
			return t.op === '-' ? -v : v
		}
		return parsePower()
	}

	function parsePower(): number {
		const base = parsePrimary()
		const t = peek()
		if (t && t.kind === 'op' && t.op === '^') {
			next()
			const exponent = parseUnary()
			return Math.pow(base, exponent)
		}
		return base
	}

	function parsePrimary(): number {
		const t = next()
		if (!t) throw new Error('unexpected end of expression')
		if (t.kind === 'num') return t.value
		if (t.kind === 'lparen') {
			const value = parseExpression()
			const close = next()
			if (!close || close.kind !== 'rparen') throw new Error('missing closing parenthesis')
			return value
		}
		if (t.kind === 'rparen') throw new Error('unexpected ")"')
		throw new Error(`unexpected "${t.op}"`)
	}

	const result = parseExpression()
	if (pos < tokens.length) throw new Error('unexpected trailing input')
	return result
}

/**
 * Evaluate an arithmetic expression. Never throws — every failure (empty, too
 * long, bad character, malformed grammar, division by zero, non-finite result)
 * comes back as `{ ok: false, error }` so the caller reports it honestly.
 */
export function evaluate(expression: string): CalcResult {
	const trimmed = expression.trim()
	if (trimmed.length === 0) return { ok: false, error: 'empty expression' }
	if (trimmed.length > MAX_EXPRESSION_LENGTH) {
		return { ok: false, error: `expression too long (max ${MAX_EXPRESSION_LENGTH} characters)` }
	}
	try {
		const tokens = tokenize(trimmed)
		if (tokens.length === 0) return { ok: false, error: 'empty expression' }
		const raw = parse(tokens)
		if (!Number.isFinite(raw)) return { ok: false, error: 'result is not a finite number' }
		// Clean binary-float noise within double precision (0.1 + 0.2 -> 0.3);
		// integers pass through exactly. This is rounding to 12 significant
		// digits, not invention — the value is the true IEEE-754 result.
		const value = Number.isInteger(raw) ? raw : Number(raw.toPrecision(12))
		return { ok: true, value, expression: trimmed }
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'invalid expression' }
	}
}
