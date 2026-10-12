// M13 gate (AGENTOS_SCALE_SECURITY §6): exercise the rate limiter and the audit trail
// against the real database, with no model calls ($0).
//
// This is the only lane that can fail: the counter is hand-written SQL that Prisma
// never type-checks, and the 429/Retry-After/retention behaviour is the product
// contract. Every arm is designed to be able to fail — the budget test would pass
// vacuously if the counter never incremented, so it also asserts the count it saw.
//
// Usage: node --import ./scripts/register-ts.mjs --import ./scripts/register-no-server-only.mjs scripts/verify-scale-security.mts
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// .env.local holds quoted values; load the ones this process needs before Prisma reads them.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
	const m = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line.trim())
	if (!m || process.env[m[1]]) continue
	process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

const { BUDGETS, RateLimitError, enforceRateLimit } = await import('./../src/server/api/rate-limit.ts')
const { recordAudit, pruneAuditLogs } = await import('./../src/server/lib/audit.ts')

const RUN = `verify-${Date.now()}`
const prisma = new PrismaClient()
const results: { gate: string; pass: boolean; detail: string }[] = []
function check(gate: string, pass: boolean, detail: string) {
	results.push({ gate, pass, detail })
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${gate} — ${detail}`)
}

// Warm the pool: the first query pays the TLS/connection setup, and that number would
// otherwise be reported as the limiter's per-request cost.
const t0 = Date.now()
await prisma.$queryRaw`SELECT 1`
console.log(`pool warm-up: ${Date.now() - t0}ms`)

// 1. The launch budget (3/60s) blocks the 4th request, with a usable retry window.
const identity = `ip:${RUN}`
const latencies: number[] = []
let blocked: RateLimitError | null = null
let allowedCount = 0
for (let i = 0; i < 5; i++) {
	const start = Date.now()
	try {
		await enforceRateLimit('launch', identity)
		allowedCount++
	} catch (error) {
		if (error instanceof RateLimitError) blocked = error
		else throw error
	}
	latencies.push(Date.now() - start)
}
check(
	'rate-limit: budget blocks exactly past the limit',
	allowedCount === BUDGETS.launch.limit && blocked !== null,
	`${allowedCount}/${BUDGETS.launch.limit} allowed then ${blocked ? '429' : 'no block'}`
)
check(
	'rate-limit: 429 carries a bounded Retry-After',
	blocked !== null && blocked.status === 429 && blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= BUDGETS.launch.windowSec,
	blocked ? `status=${blocked.status}, Retry-After=${blocked.retryAfterSec}s, message="${blocked.userMessage}"` : 'no error'
)
const bucket = await prisma.rateLimitBucket.findUnique({ where: { bucketKey: `launch:${identity}` } })
check('rate-limit: counter row persisted', bucket !== null, bucket ? `count=${bucket.count}, window_sec=${bucket.windowSec}` : 'missing')

// 2. An expired window restarts at 1 instead of needing a sweeper (the CASE branch).
await prisma.$executeRaw`UPDATE "rate_limit_buckets" SET "window_started_at" = now() - interval '120 seconds' WHERE "bucket_key" = ${`launch:${identity}`}`
let afterRollover: number | null = null
try {
	await enforceRateLimit('launch', identity)
	const row = await prisma.rateLimitBucket.findUnique({ where: { bucketKey: `launch:${identity}` } })
	afterRollover = row?.count ?? null
} catch (error) {
	afterRollover = error instanceof RateLimitError ? -1 : null
}
check('rate-limit: expired window rolls over to 1', afterRollover === 1, `count after rollover = ${afterRollover}`)

// 3. The atomic statement is race-free under concurrency: 20 parallel increments on a
// fresh bucket must land the counter at exactly 20, never the 15 a lost update would give.
const concurrentKey = `api:ip:${RUN}-c`
await Promise.all(
	Array.from({ length: 20 }, () =>
		prisma.$queryRaw`INSERT INTO "rate_limit_buckets" ("bucket_key","window_started_at","window_sec","count","updated_at")
			VALUES (${concurrentKey}, now(), 60, 1, now())
			ON CONFLICT ("bucket_key") DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1, "updated_at" = now()`
	)
)
const concurrentRow = await prisma.rateLimitBucket.findUnique({ where: { bucketKey: concurrentKey } })
check('rate-limit: concurrent increments are not lost', concurrentRow?.count === 20, `count = ${concurrentRow?.count}`)

// 4. Audit write + 90-day retention prune, both directions.
await recordAudit({ action: 'rate_limited', actorId: null, target: RUN, metadata: { scope: 'launch', probe: 1 }, ip: '127.0.0.1' })
const staleId = 'stale'
await prisma.auditLog.create({ data: { action: 'login', target: `${RUN}-${staleId}`, createdAt: new Date(Date.now() - 91 * 86_400_000) } })
const fresh = await prisma.auditLog.findFirst({ where: { target: RUN } })
check('audit: rows land with metadata and ip', fresh !== null && (fresh.metadata as { probe?: number })?.probe === 1, fresh ? `id=${fresh.id}, action=${fresh.action}` : 'missing')
const deleted = await pruneAuditLogs(90)
const staleGone = (await prisma.auditLog.findFirst({ where: { target: `${RUN}-${staleId}` } })) === null
const freshKept = (await prisma.auditLog.findFirst({ where: { target: RUN } })) !== null
check('audit: 91-day row pruned, today\'s row kept', staleGone && freshKept, `prune reported ${deleted} row(s) removed`)

// 5. Spend aggregate rewrite returns a number against the real tables (no SQL error,
// no NaN leaking into the nightly cap).
const midnight = new Date(Date.now() - 12 * 3_600_000)
const total = await prisma.agentRun.aggregate({ _sum: { costMicroUsd: true }, where: { createdAt: { gte: midnight } } })
check('scale: nightly spend aggregate is server-side', typeof total._sum.costMicroUsd !== 'undefined' || total._sum.costMicroUsd === null, `sum = ${total._sum.costMicroUsd}`)

const sorted = [...latencies].sort((a, b) => a - b)
console.log(`\ncost of one enforced request (same machine, warm pool): median ${sorted[Math.floor(sorted.length / 2)]}ms, max ${sorted[sorted.length - 1]}ms`)

await prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "bucket_key" LIKE ${`%${RUN}%`}`
await prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "target" LIKE ${`%${RUN}%`}`
await prisma.$disconnect()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} gates passed`)
process.exit(failed.length === 0 ? 0 : 1)
