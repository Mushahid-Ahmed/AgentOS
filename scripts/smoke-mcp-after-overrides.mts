// Post-override smoke for the MCP dependency chain. The SDK validates every tool
// schema through ajv, and ajv's URI handling is the fast-uri module this run pinned to
// 3.1.8 - so a real tool round-trip over the SDK's in-memory transport proves the
// patched dependency sits on a live code path. No app modules, no network, no spend.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse } from 'node:path'

// Resolved through the SDK's own require map, not the app's - pnpm keeps transitive
// deps out of the root node_modules, so this is the only way to ask which fast-uri the
// SDK actually loads at runtime.
const sdkRequire = createRequire(import.meta.resolve('@modelcontextprotocol/sdk/client/index.js'))
function packageVersionOf(specifier: string, name: string): string {
	let dir = dirname(sdkRequire.resolve(specifier))
	while (parse(dir).root !== dir) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
				name?: string
				version?: string
			}
			if (pkg.name === name) return pkg.version ?? 'unknown'
		} catch {
			/* keep walking up */
		}
		dir = dirname(dir)
	}
	return 'unresolved'
}

const server = new McpServer({ name: 'audit-smoke', version: '1.0.0' })
server.registerTool(
	'arith',
	{
		title: 'Arith',
		description: 'multiply two numbers',
		inputSchema: { a: z.number(), b: z.number() },
		// A URI-format field makes ajv reach into fast-uri while compiling the schema.
		outputSchema: { result: z.number(), source: z.string().url().optional() }
	},
	async ({ a, b }) => ({
		content: [{ type: 'text', text: String(a * b) }],
		structuredContent: { result: a * b }
	})
)

const [clientT, serverT] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'audit-smoke-client', version: '1.0.0' })
await Promise.all([client.connect(clientT), server.connect(serverT)])

const listed = await client.listTools()
const found = listed.tools.some(
	(t) => t.name === 'arith' && t.inputSchema?.properties?.a?.type === 'number'
)
console.log(
	`GATE-M1 tools/list round-trips a zod-compiled JSON Schema: ${found ? 'PASS' : 'FAIL'} (${listed.tools.length} tools)`
)

const res = await client.callTool({ name: 'arith', arguments: { a: 6, b: 7 } })
const ok = res.isError !== true && JSON.stringify(res).includes('42')
console.log(
	`GATE-M2 callTool through ajv validation: ${ok ? 'PASS' : 'FAIL'} -> ${JSON.stringify(res).slice(0, 120)}`
)

const bad = await client.callTool({ name: 'arith', arguments: { a: 'six', b: 7 } })
console.log(
	`GATE-M3 a wrong-typed argument is rejected, not executed: ${bad.isError === true ? 'PASS' : 'FAIL'} -> ${JSON.stringify(bad).slice(0, 120)}`
)

console.log(
	`GATE-M4 runtime versions behind the SDK: fast-uri=${packageVersionOf('fast-uri', 'fast-uri')} ajv=${packageVersionOf('ajv', 'ajv')}`
)
await client.close()
process.exit(found && ok && bad.isError === true ? 0 : 1)
