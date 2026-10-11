import 'server-only'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolRegistry, ToolResult } from '@/lib/orchestra/types'
import { log } from '@/server/lib/logger'
import { createCalculatorServer } from './calculator-server'
import { createResearchServer } from './research-server'

// The Orchestra's tool layer (D3 / §13): a real MCP client speaking to real MCP
// servers over an in-process transport. `ToolRegistry` is the narrow interface the
// executor already consumes ({ has, call }); this adapts the MCP client to it, so
// the core engine stays pure and never imports the SDK.
//
// Each server is linked to its own client lazily and reused across runs, and the
// tool NAME is mapped to the client that serves it, so `call` routes to the right
// server and `has` is the union of every linked server's tools. Both servers are
// stateless, so a single linked pair each safely serves concurrent calls (the MCP
// client multiplexes by request id); caching the connect promise means parallel runs
// don't each spin up a pair. In-memory transport = zero new keys, zero network for
// the calculator; the research tool's own paid web call happens inside its server.

// The MCP `callTool` result shape we rely on (verified against SDK 1.31.0): a
// content array, optional structuredContent, and an isError flag for tool-level
// failures (which are returned, not thrown).
type McpCallResult = {
	content?: Array<{ type?: string; text?: string }>
	structuredContent?: unknown
	isError?: boolean
}

let registryPromise: Promise<ToolRegistry> | null = null

/** Get the process-wide MCP-backed tool registry, connecting on first use. */
export function getToolRegistry(): Promise<ToolRegistry> {
	if (!registryPromise) {
		registryPromise = initRegistry().catch((error) => {
			// Don't cache a failed connect: a later run should be able to retry
			// rather than inherit a permanently broken registry.
			registryPromise = null
			throw error
		})
	}
	return registryPromise
}

// Link one server to a fresh client over an in-memory transport and report the tool
// names it actually exposes (discovered, never hard-coded, so `has` reflects exactly
// what is callable and grows as tools are added).
async function link(server: McpServer): Promise<{ client: Client; names: string[] }> {
	const client = new Client({ name: 'agentos-orchestra', version: '1.0.0' })
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
	const listed = await client.listTools()
	return { client, names: listed.tools.map((tool) => tool.name) }
}

// A paid tool (research) reports its real spend as `costMicroUsd` inside
// structuredContent; the keyless calculator reports none. Lift it to the ToolResult
// so the executor can record true cost against the run budget (addCost ignores an
// absent value, so the calculator stays a no-op).
function readCostMicroUsd(structured: unknown): number | undefined {
	if (structured == null || typeof structured !== 'object') return undefined
	const value = (structured as { costMicroUsd?: unknown }).costMicroUsd
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function initRegistry(): Promise<ToolRegistry> {
	const clientByTool = new Map<string, Client>()
	for (const server of [createCalculatorServer(), createResearchServer()]) {
		const { client, names } = await link(server)
		for (const name of names) clientByTool.set(name, client)
	}
	log.info('mcp tool registry connected', { tools: [...clientByTool.keys()] })

	return {
		has: (tool: string) => clientByTool.has(tool),
		async call(name: string, args: unknown): Promise<ToolResult> {
			const client = clientByTool.get(name)
			if (!client) return { ok: false, error: `tool_not_found:${name}` }
			try {
				const result = (await client.callTool({
					name,
					arguments: (args ?? {}) as Record<string, unknown>
				})) as McpCallResult

				const summary = (result.content ?? [])
					.map((part) => (typeof part.text === 'string' ? part.text : ''))
					.join('\n')
					.trim()

				// A tool-level failure is returned as isError (the SDK does not throw):
				// surface it honestly so the agent reports the failure instead of
				// inventing output (§13).
				if (result.isError) {
					return { ok: false, error: summary || `tool_failed:${name}` }
				}
				const structured = result.structuredContent
				const costMicroUsd = readCostMicroUsd(structured)
				return {
					ok: true,
					// Prefer the machine-readable structured value; fall back to text.
					output: structured ?? summary,
					summary: summary || name,
					...(costMicroUsd == null ? {} : { costMicroUsd })
				}
			} catch (error) {
				// Transport/protocol-level failure (distinct from an isError result).
				const message = error instanceof Error ? error.message : 'tool_call_failed'
				log.error('mcp tool call threw', { tool: name, error })
				return { ok: false, error: message }
			}
		}
	}
}
