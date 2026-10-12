// M1/M2 database audit: index inventory + EXPLAIN ANALYZE on the app's real query
// shapes, straight against the Supabase pooler (DATABASE_URL). Read-only: SELECT and
// EXPLAIN only, no DDL — the index changes themselves go through a migration.
//
// Usage: DATABASE_URL=... node scripts/audit-db.mjs
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const prisma = new PrismaClient()

// The query shapes as the server modules issue them (src/server/agentos/replay.ts,
// src/server/api/conversations.ts, src/server/api/spend.ts, src/server/lib/spend.ts,
// src/server/api/dashboard-store.ts, src/server/agentos/store.ts).
const QUERIES = [
	{
		id: 'agentos-run-list',
		sql: `SELECT "id", "created_at", "query", "status", "task_type", "tier", "cost_micro_usd", "model_calls"
			FROM "agent_runs" ORDER BY "created_at" DESC LIMIT 50`
	},
	{
		id: 'agentos-run-steps',
		sql: `SELECT * FROM "agent_steps" WHERE "run_id" = 1 ORDER BY "id" ASC`
	},
	{
		id: 'agentos-run-events',
		sql: `SELECT * FROM "agent_events" WHERE "run_id" = 1 ORDER BY "seq" ASC`
	},
	{
		id: 'conversation-list',
		sql: `SELECT * FROM "conversations" ORDER BY "updated_at" DESC LIMIT 50`
	},
	{
		id: 'conversation-messages',
		sql: `SELECT * FROM "messages" WHERE "conversation_id" = 1 ORDER BY "created_at" ASC`
	},
	{
		id: 'nightly-spend',
		sql: `SELECT "cost_micro_usd" FROM "ai_usage" WHERE "created_at" >= now() - interval '12 hours'`
	},
	{
		id: 'spend-by-model',
		sql: `SELECT "model", sum("cost_micro_usd") AS cost, count(*) AS n
			FROM "ai_usage" WHERE "created_at" >= now() - interval '30 days'
			GROUP BY "model" ORDER BY cost DESC NULLS LAST LIMIT 20`
	},
	{
		id: 'dashboard-route-events',
		sql: `SELECT "chosen_model", count(*) AS n, avg("jev_latency_ms") AS lat
			FROM "route_events" WHERE "created_at" >= now() - interval '30 days'
			GROUP BY "chosen_model"`
	},
	{
		id: 'benchmark-results-by-run',
		sql: `SELECT * FROM "benchmark_results" WHERE "run_id" = 1`
	}
]

const out = { generatedAt: new Date().toISOString(), indexes: [], rowCounts: [], plans: [] }

const idx = await prisma.$queryRawUnsafe(
	`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`
)
out.indexes = idx

const counts = await prisma.$queryRawUnsafe(`
	SELECT 'agent_runs' AS t, count(*)::int AS n FROM agent_runs
	UNION ALL SELECT 'agent_steps', count(*)::int FROM agent_steps
	UNION ALL SELECT 'agent_events', count(*)::int FROM agent_events
	UNION ALL SELECT 'conversations', count(*)::int FROM conversations
	UNION ALL SELECT 'messages', count(*)::int FROM messages
	UNION ALL SELECT 'route_events', count(*)::int FROM route_events
	UNION ALL SELECT 'ai_usage', count(*)::int FROM ai_usage
	UNION ALL SELECT 'benchmark_results', count(*)::int FROM benchmark_results
	UNION ALL SELECT 'agentos_benchmark_results', count(*)::int FROM agentos_benchmark_results
`)
out.rowCounts = counts

for (const q of QUERIES) {
	try {
		const started = Date.now()
		const rows = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${q.sql}`)
		out.plans.push({
			id: q.id,
			ms: Date.now() - started,
			plan: rows.map((r) => Object.values(r)[0]).join('\n')
		})
	} catch (error) {
		out.plans.push({ id: q.id, error: String(error).slice(0, 300) })
	}
}

writeFileSync(new URL('audit-db.json', import.meta.url), JSON.stringify(out, null, 1))

for (const p of out.plans) {
	const scan = p.plan ? (/Seq Scan|Index Scan|Index Only Scan|Bitmap/.exec(p.plan)?.[0] ?? '-') : 'ERROR'
	console.log(`${p.id.padEnd(24)} ${(`${p.ms ?? '-'}ms`).padEnd(10)} ${scan}${p.error ? ' — ' + p.error : ''}`)
}
console.log(`\ntables: ${counts.map((c) => `${c.t}=${c.n}`).join('  ')}`)
console.log(`indexes: ${idx.length}`)

await prisma.$disconnect()
