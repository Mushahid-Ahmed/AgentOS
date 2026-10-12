// Scalability gates for the sequential-round-trip cuts (AGENTOS_SCALE_SECURITY
// follow-on phase).
//
// The measured finding this whole phase rests on: the app is LATENCY-bound, not
// query-bound. Every hot query plans in under 4 ms inside Postgres and costs ~1.8 s of
// wall clock, because Vercel `iad1` and the Supabase primary in `ap-southeast-2` are an
// ocean apart. So the only thing worth cutting is the number of SEQUENTIAL round trips,
// and the only honest way to see whether two statements are sequential is to watch
// their starts against each other's finishes: if B starts before A's response lands,
// they share one round trip of latency; if B starts after, the code pays two.
//
// Nothing here is simulated. The server modules are put on an instrumented Prisma
// client (src/server/db/client.ts caches its singleton on globalThis, which is exactly
// how it survives `next dev` hot-reload — so setting it before the import puts the REAL
// code path on the record), and the row writes land in the real database and are
// deleted at the end. No model or provider call is made: $0.
//
// Non-vacuity, stated before any gate runs: G1 (the shipped save) and G2 (its positive
// control) measure the SAME two statements, the second time with the await barrier put
// back. G2 must come out at ~2 round trips and G1 at ~1. If they printed the same
// ratio, the ratio would be measuring nothing and G1 would be a false pass.
//
// Usage: node --import ./scripts/register-ts.mjs --import ./scripts/register-no-server-only.mjs scripts/verify-roundtrip-cuts.mts
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// .env.local holds quoted values; load the ones this process needs before Prisma reads them.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
	const m = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line.trim())
	if (!m || process.env[m[1]]) continue
	process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}

type Row = { label: string; start: number; end: number }
let rows: Row[] = []
function mark(label: string): void {
	rows.push({ label, start: Date.now(), end: 0 })
}
function settle(label: string): void {
	for (let i = rows.length - 1; i >= 0; i--) {
		const row = rows[i]!
		if (row.label === label && row.end === 0) {
			row.end = Date.now()
			return
		}
	}
}
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
	mark(label)
	try {
		return await fn()
	} finally {
		settle(label)
	}
}

// Time every statement a module issues, without changing what any of them do.
function instrument(target: object, prefix: string): unknown {
	return new Proxy(target, {
		get(obj, prop) {
			if (typeof prop !== 'string') return Reflect.get(obj, prop)
			// A Prisma delegate is not a promise; leaking `then` would make every
			// awaited model call look thenable and hang the harness.
			if (prop === 'then') return undefined
			const value = Reflect.get(obj, prop)
			const label = prefix ? `${prefix}.${prop}` : prop
			if (typeof value === 'function') {
				return (...args: unknown[]) => {
					mark(label)
					const out = (value as (...a: unknown[]) => unknown).apply(obj, args)
					// NOT `instanceof Promise`: Prisma returns a PrismaPromise, a thenable
					// that is not a Promise. Testing for the class would settle every
					// statement at call time, make all durations ~0ms, and turn the
					// overlap gates into a false pass.
					if (out && typeof (out as Promise<unknown>).then === 'function') {
						return (out as Promise<unknown>).then(
							(v) => (settle(label), v),
							(e) => {
								settle(label)
								// Best-effort modules swallow their own errors, which is
								// exactly what makes a harness-blind failure look like a
								// crash in Sentry. Print the statement that failed first.
								console.log(
									`  ! ${label} rejected: ${e?.constructor?.name} ${(e as Error).message.slice(0, 120).replace(/\s+/g, ' ')}`
								)
								return Promise.reject(e)
							}
						)
					}
					settle(label)
					return out
				}
			}
			if (value && typeof value === 'object') return instrument(value as object, label)
			return value
		}
	})
}

const real = new PrismaClient()
;(globalThis as unknown as { prisma: unknown }).prisma = instrument(real, '')

const store = await import('./../src/server/agentos/store.ts')
const chatStore = await import('./../src/server/api/chat-store.ts')
const replay = await import('./../src/server/agentos/replay.ts')

const results: { gate: string; pass: boolean; detail: string }[] = []
function check(gate: string, pass: boolean, detail: string): void {
	results.push({ gate, pass, detail })
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${gate} — ${detail}`)
}

// Statements issued, wall clock across them, the slowest single statement, the sum of
// them, and whether every start landed strictly before every finish.
// Two numbers, because one is not enough: a sequential pair pays `summed` (wall = A + B)
// and a concurrent pair pays `single` (wall = max(A, B)). Comparing the wall to the
// SLOWEST statement alone (which the first version of this file did) reads a sequential
// pair as ~1.5x rather than ~2x whenever the two statements are unequal - here
// 1682ms + 3179ms - so the control appeared to fail its own threshold. The start/finish
// ordering is the exact test; the wall/summed and wall/single comparisons are the
// magnitude that has to agree with it.
// The strict ordering matters: two serially awaited statements settle and re-start in the
// same millisecond, so `<=` would read the sequential control as concurrent.
function read(label: string) {
	const picked = rows.filter((r) => r.end > 0)
	const single = Math.max(...picked.map((r) => r.end - r.start), 1)
	const summed = picked.reduce((acc, r) => acc + (r.end - r.start), 0)
	const wall = Math.max(...picked.map((r) => r.end)) - Math.min(...picked.map((r) => r.start))
	const minEnd = Math.min(...picked.map((r) => r.end))
	return {
		label,
		picked,
		single,
		summed,
		wall,
		ratio: wall / single,
		concurrent: picked.every((r) => r.start < minEnd),
		names: picked.map((r) => r.label)
	}
}
// Odd sample counts, so the middle value is well defined; with 2 it was the larger one,
// which is how the first run of this file talked itself out of a real result.
function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b)
	return s[Math.floor((s.length - 1) / 2)]!
}

const RUN = `rtcuts-${Date.now()}`

// A 3-step plan is enough to be the real shape: upsertStepsBatch is one statement
// whatever N is, so the statement COUNT - which is the whole subject - matches a
// production save.
const STEPS = ['s1', 's2', 's3'].map((key) => ({
	key,
	agent: 'research',
	model: 'gemini-2.5-flash',
	toolsAllowed: [],
	dependsOn: [],
	status: 'completed',
	attempts: 1,
	startedAt: null,
	finishedAt: null,
	promptTokens: 1,
	completionTokens: 1,
	costMicroUsd: null,
	outputSummary: null,
	error: null
}))
function fakeRun(query: string): unknown {
	return {
		id: '0',
		query,
		status: 'running',
		usage: { costMicroUsd: 0, modelCalls: 0, toolCalls: 0, replans: 0 },
		finalAnswer: null,
		error: null,
		finishedAt: null,
		plan: { steps: STEPS.map((s) => ({ ...s, id: s.key })) },
		stepStates: Object.fromEntries(STEPS.map((s) => [s.key, { status: 'completed', attempts: 1 }]))
	}
}

// The pool's first statement pays connect + DNS + TLS (measured ~4.4s on this link), so
// it is discarded before either arm is timed. Two connections are warmed, not one: a
// concurrent save needs two where the sequential pair needed one, and on a cold pool
// that difference is connection setup (~2.5s), not the code under test. A warm Vercel
// function holds several, so this is the production condition, not a convenience.
await Promise.all([real.$queryRaw`SELECT 1`, real.$queryRaw`SELECT 1`, real.$queryRaw`SELECT 1`])

const runId = await store.createAgentRun(RUN)

// ---- arms, paired and interleaved: within each pair the link is in the same mood, so
// the DIFFERENCE between the two walls is the code, not the network. Three pairs.
const concWalls: number[] = []
const serialWalls: number[] = []
const concReads: ReturnType<typeof read>[] = []
const serialReads: ReturnType<typeof read>[] = []
for (let rep = 1; rep <= 3; rep++) {
	rows = []
	const a = Date.now()
	await store.createRunStore(runId).save(fakeRun(RUN))
	concWalls.push(Date.now() - a)
	concReads.push(read(`concurrent save #${rep}`))

	rows = []
	const b = Date.now()
	// The pre-change save(), statement for statement, with the barrier restored.
	await timed('agentRun.update', () =>
		real.agentRun.update({ where: { id: runId }, data: { status: 'running' } })
	)
	await timed('$executeRaw', () => store.upsertStepsBatch(real as never, runId, STEPS))
	serialWalls.push(Date.now() - b)
	serialReads.push(read(`sequential control #${rep}`))
}

const conc = concReads[0]!
const serial = serialReads[0]!
// One round trip, robustly: the median duration of a single statement across every arm,
// all of which are latency-bound and all plans under 4ms.
const RT = median(
	[...concReads, ...serialReads].flatMap((r) => r.picked.map((p) => p.end - p.start))
)
check(
	'G0 save() issues exactly the two statements it owns',
	concReads.every(
		(r) =>
			r.names.length === 2 && r.names.includes('agentRun.update') && r.names.includes('$executeRaw')
	),
	`all ${concReads.length} reps: ${conc.names.join(', ')}`
)
check(
	'G1 save() overlaps them - the wall pays one statement, not the sum of two',
	concReads.every((r) => r.concurrent && r.wall <= r.single * 1.15),
	`walls ${concReads.map((r) => `${r.wall}ms`).join('/')} vs single ${concReads.map((r) => `${r.single}ms`).join('/')} and summed ${concReads.map((r) => `${r.summed}ms`).join('/')}`
)
check(
	'G2 CONTROL the same statement pair awaited in series pays the sum of both',
	serialReads.every((r) => !r.concurrent && r.wall >= r.summed * 0.85),
	`walls ${serialReads.map((r) => `${r.wall}ms`).join('/')} vs summed ${serialReads.map((r) => `${r.summed}ms`).join('/')} (single ${serialReads.map((r) => `${r.single}ms`).join('/')})`
)
const pairedDeltas = concWalls.map((w, i) => serialWalls[i]! - w)
check(
	'G3 every paired sample got faster, by at least half a round trip',
	pairedDeltas.every((d) => d > 0) && median(pairedDeltas) >= RT * 0.5,
	`paired before-minus-after ${pairedDeltas.join('/')}ms, median ${median(pairedDeltas)}ms against one round trip of ${RT}ms`
)

// ---- one chat turn, end to end: the two writes the user waits for.
const conversation = await real.conversation.create({
	data: { title: RUN, messages: { create: [{ role: 'user', content: `${RUN} seed` }] } },
	select: { id: true }
})

rows = []
const userTurnId = await chatStore.persistUserTurn({
	conversationId: conversation.id.toString(),
	messages: [{ role: 'user', content: `${RUN} turn` }]
})
const userTurn = read('user turn')
check(
	'G4 user turn writes without reading the thread back first',
	userTurn.names.length === 1 &&
		userTurn.names[0] === 'message.create' &&
		userTurnId === conversation.id,
	`${userTurn.names.join(', ')} (${userTurn.wall}ms) on the existing-thread branch; the deleted-thread branch is G9`
)

rows = []
await chatStore.persistAssistantTurn({
	conversationId: conversation.id,
	content: `${RUN} answer`,
	route: {
		chosenModel: 'gemini-2.5-flash' as never,
		jevLatencyMs: 1,
		confidence: null,
		probabilities: null,
		fallback: false,
		fallbackReason: null,
		ttftMs: null,
		totalLatencyMs: null,
		promptTokens: 1,
		completionTokens: 1,
		costMicroUsd: null
	}
})
const assistantTurn = read('assistant turn')
check(
	'G5 assistant turn issues both writes and overlaps them',
	assistantTurn.names.length === 2 &&
		assistantTurn.concurrent &&
		assistantTurn.wall <= assistantTurn.single * 1.15 &&
		assistantTurn.names.includes('message.create') &&
		assistantTurn.names.includes('conversation.update'),
	`${assistantTurn.picked.map((r) => `${r.label}=${r.end - r.start}ms`).join(', ')}; wall ${assistantTurn.wall}ms, ratio ${assistantTurn.ratio.toFixed(2)}x`
)

// ---- deleted-thread branch, which the old existence probe used to serve.
await real.conversation.delete({ where: { id: conversation.id } })
rows = []
const freshId = await chatStore.persistUserTurn({
	conversationId: conversation.id.toString(),
	messages: [{ role: 'user', content: `${RUN} resurrect` }]
})
const resurrect = read('deleted-thread turn')
check(
	'G9 a dead thread id still starts a fresh conversation (the P2003 path)',
	freshId != null && freshId !== conversation.id && resurrect.names.includes('conversation.create'),
	`statements: ${resurrect.names.join(', ')}; new conversation ${freshId?.toString() ?? 'null'}`
)
if (freshId != null) await real.conversation.delete({ where: { id: freshId } })

// ---- replay read path
rows = []
const replayOut = await replay.getRunReplay(runId)
const rep = read('replay')
check(
	'G6 replay reads the run row in the same batch as its three child tables',
	rep.names.length === 4 &&
		rep.concurrent &&
		rep.wall <= rep.single * 1.15 &&
		rep.names.includes('agentRun.findUnique'),
	`${rep.names.join(', ')} - wall ${rep.wall}ms, ratio ${rep.ratio.toFixed(2)}x, ${replayOut ? 'run rebuilt' : 'NO RUN (would fail the cut)'}`
)

// ---- the benchmark engine. Its saving is DERIVED (one RT x up to 8 writes per task x
// tasks), not measurable here: running the loop means running the four paid setups, and
// the zero-paid-call rule forbids that. So this pair of gates is structural, and it can
// fail - put `await persistResult(` back and G7 goes red.
const engineSrc = readFileSync(
	new URL('../src/server/agentos-benchmark/engine.ts', import.meta.url),
	'utf8'
)
const inlineAwaits = (engineSrc.match(/await persist(Result|Verdict)\(/g) ?? []).length
const trackCalls = (engineSrc.match(/trackWrite\(persist(Result|Verdict)/g) ?? []).length
check(
	'G7 benchmark engine awaits no row write inside the paid setup loop (structural)',
	inlineAwaits === 0 && trackCalls === 2,
	`${inlineAwaits} inline await(s) left, ${trackCalls}/2 writes issued through trackWrite`
)
const taskBoundary = engineSrc.indexOf('await drainWrites()')
const beforeProgress = engineSrc.indexOf('executedTasks += 1')
const beforeFinish = engineSrc.indexOf('await finishRun(')
check(
	'G8 writes are drained at the task boundary and before the run goes terminal',
	taskBoundary !== -1 &&
		taskBoundary < beforeProgress &&
		(engineSrc.lastIndexOf('await drainWrites()') < beforeFinish || beforeFinish === -1) &&
		(engineSrc.match(/await drainWrites\(\)/g) ?? []).length >= 2,
	`drain #1 at ${taskBoundary} < task counter at ${beforeProgress}; final drain at ${engineSrc.lastIndexOf('await drainWrites()')} < finishRun at ${beforeFinish}`
)

// ---- record
console.log('\nstatement record (ms, real cross-region latency):')
for (const r of [
	...conc.picked,
	...serial.picked,
	...userTurn.picked,
	...assistantTurn.picked,
	...rep.picked
]) {
	console.log(`  ${r.label.padEnd(24)} dur=${r.end - r.start}`)
}
console.log(
	`\none round trip on this link: ${RT}ms (median single statement, all arms; plans are <4ms so this is pure network).`
)
console.log(
	'A 6-step AgentOS run awaits ~8 saves (executor.ts:304 per step start, :583 per transition): ' +
		`~${((8 * RT) / 1000).toFixed(1)}s removed from its critical path, plus ${(2 * RT) / 1000}s per chat turn.`
)

// ---- teardown: only the rows this file created.
await real.message.deleteMany({ where: { content: { startsWith: RUN } } })
await real.conversation.deleteMany({ where: { title: RUN } })
await real.agentStep.deleteMany({ where: { runId } })
await real.agentEvent.deleteMany({ where: { runId } })
await real.agentRun.delete({ where: { id: runId } })
await real.$disconnect()

const fails = results.filter((r) => !r.pass)
console.log(`\n${results.length - fails.length}/${results.length} round-trip gates passed`)
if (fails.length) console.log('FAILED: ' + fails.map((f) => f.gate).join(' | '))
process.exit(fails.length ? 1 : 0)
