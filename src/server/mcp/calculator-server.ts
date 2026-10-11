import 'server-only'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CALCULATOR_TOOL, evaluate } from '@/lib/mcp/calculator'

// The first AgentOS MCP tool (§13 / D3, priority 1: "calculator/data tool for the
// Code agent — pure code, keyless"). A real MCP server built on the official SDK
// (@modelcontextprotocol/sdk, verified 1.31.0), exposing ONE tool with a clear
// JSON-schema'd input and a structured output. All arithmetic is the pure
// evaluator in lib/mcp/calculator.ts — a recursive-descent parser, never eval —
// so an exact number never depends on a model computing it in its head.
//
// Failure is reported honestly: a bad/unsafe/impossible expression returns
// `{ isError: true, content: [{ text: <reason> }] }` (the SDK surfaces tool errors
// as an isError result, not a throw), which the registry maps to `{ ok: false }`
// and the agent reports rather than inventing a value (§13).

export { CALCULATOR_TOOL }

export function createCalculatorServer(): McpServer {
	const server = new McpServer({ name: 'agentos-calculator', version: '1.0.0' })

	server.registerTool(
		CALCULATOR_TOOL,
		{
			title: 'Calculate',
			description:
				'Evaluate an arithmetic expression and return the exact numeric result. ' +
				'Operators: + - * / % (modulo) ^ (power); parentheses and decimals allowed. ' +
				'Write percentages as decimals (15% of 240 -> "240*0.15").',
			inputSchema: { expression: z.string().min(1).max(500) },
			outputSchema: { expression: z.string(), value: z.number() }
		},
		async ({ expression }) => {
			const result = evaluate(expression)
			if (!result.ok) {
				return { content: [{ type: 'text', text: result.error }], isError: true }
			}
			return {
				content: [{ type: 'text', text: `${result.expression} = ${result.value}` }],
				structuredContent: { expression: result.expression, value: result.value }
			}
		}
	)

	return server
}
