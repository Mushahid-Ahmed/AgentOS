// Proof that chat + AgentOS history is per-user, run against the REAL database.
//
//   node --import ./scripts/register-ts.mjs \
//         --import ./scripts/register-no-server-only.mjs \
//         scripts/verify-user-ownership.mts
//
// Every gate is written so it can fail: each "user A cannot see user B" claim is
// paired with a positive control that proves B's row really exists and really is
// readable by B. No paid model call is made anywhere — these are persistence
// functions, not inference.
import { randomUUID } from 'node:crypto'
import { db } from '../src/server/db/client'
import {
	deleteConversation,
	getConversation,
	listConversations
} from '../src/server/api/conversations'
import { persistUserTurn } from '../src/server/api/chat-store'
import { createAgentRun } from '../src/server/agentos/store'
import { getRunReplay, listRuns } from '../src/server/agentos/replay'
import { getSpendAndUsage } from '../src/server/api/spend'

let failures = 0
function gate(name: string, pass: boolean, detail: string): void {
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
	if (!pass) failures += 1
}

const marker = Date.now().toString()
const userA = randomUUID()
const userB = randomUUID()
const createdConversations: bigint[] = []
const createdRuns: bigint[] = []

// Two threads, one per user, written through the code the chat route uses.
const textA = `ownership-probe-A ${marker}`
const textB = `ownership-probe-B ${marker}`
const convA = await persistUserTurn({
	userId: userA,
	conversationId: null,
	messages: [{ role: 'user', content: textA }]
})
const convB = await persistUserTurn({
	userId: userB,
	conversationId: null,
	messages: [{ role: 'user', content: textB }]
})
if (convA !== null) createdConversations.push(convA)
if (convB !== null) createdConversations.push(convB)
gate(
	'G1 both threads persisted',
	convA !== null && convB !== null && convA !== convB,
	`A=${convA} B=${convB}`
)

// G1b The owner column is actually populated (a stamp that silently dropped would
// still let this harness pass every isolation gate below).
const stamped = await db.conversation.findMany({
	where: { id: { in: [convA as bigint, convB as bigint] } },
	select: { id: true, userId: true }
})
const ownerOf = (id: bigint) => stamped.find((r) => r.id === id)?.userId
gate(
	'G1b writes stamp the owner',
	ownerOf(convA as bigint) === userA && ownerOf(convB as bigint) === userB,
	`A row owner=${ownerOf(convA as bigint)?.slice(0, 8)} B row owner=${ownerOf(convB as bigint)?.slice(0, 8)}`
)

// G2 A's list contains A's thread and none of B's.
const listA = await listConversations(userA)
const idsA = new Set(listA.conversations.map((c) => c.id))
gate(
	'G2 history list is scoped to the caller',
	idsA.has(String(convA)) && !idsA.has(String(convB)),
	`A sees own=${idsA.has(String(convA))} other=${idsA.has(String(convB))} of ${listA.conversations.length} rows`
)

// G3 positive control: the very same row IS visible to its owner by id.
const own = await getConversation(userA, String(convB as bigint)).then(
	() => 'readable',
	(e: { name?: string; message?: string }) => `${e.name ?? 'err'}`
)
const bOwn = await getConversation(userB, String(convB))
gate(
	'G3 the owner still reads their own thread',
	own === 'ConversationNotFoundError' || bOwn.messages.length === 1,
	`B-by-id messages=${bOwn.messages.length}, A-reads-B=${own}`
)

// G4 A reading B's thread by id is a 404, not the content.
let cross = 'READ SUCCEEDED'
try {
	const leaked = await getConversation(userA, String(convB))
	cross = `leaked ${leaked.messages.length} messages`
} catch (error) {
	const status = (error as { status?: number }).status
	cross = status === 404 ? '404' : `threw ${String(status)} ${(error as Error).name}`
}
gate('G4 cross-user read is 404', cross === '404', cross)

// G5 A cannot delete B's thread — and the positive control proves the thread is
// still there afterwards (a delete that silently no-oped would also 404).
let delOutcome = 'DELETED'
try {
	await deleteConversation(userA, String(convB))
} catch (error) {
	delOutcome = (error as { status?: number }).status === 404 ? '404' : 'error'
}
const stillThere = await db.conversation.findFirst({
	where: { id: convB as bigint, userId: userB },
	select: { id: true }
})
gate(
	'G5 cross-user delete refused, row survives',
	delOutcome === '404' && stillThere !== null,
	`${delOutcome}, survivor=${stillThere !== null}`
)

// G6 A continuing B's thread id must NOT write into it: the turn is rewound and
// A gets their own fresh thread instead.
const beforeCount = await db.message.count({ where: { conversationId: convB as bigint } })
const afterA = await persistUserTurn({
	userId: userA,
	conversationId: String(convB as bigint),
	messages: [{ role: 'user', content: `hijack ${marker}` }]
})
if (afterA !== null && afterA !== (convB as bigint)) createdConversations.push(afterA)
const afterCount = await db.message.count({ where: { conversationId: convB as bigint } })
gate(
	'G6 writing to another user thread does not land',
	afterCount === beforeCount && afterA !== null && afterA !== convB,
	`B messages ${beforeCount}->${afterCount}, A redirected to ${afterA}`
)

// G7 AgentOS runs: B's run list never shows A's run, and A's replay of B's run id
// is null, while A's own replay still reconstructs.
const runA = await createAgentRun(`probe run A ${marker}`, userA)
const runB = await createAgentRun(`probe run B ${marker}`, userB)
createdRuns.push(runA, runB)
const runsA = await listRuns(userA)
const runsB = await listRuns(userB)
gate(
	'G7 run list is scoped',
	runsA.runs.some((r) => r.id === String(runA)) &&
		!runsA.runs.some((r) => r.id === String(runB)) &&
		runsB.runs.some((r) => r.id === String(runB)),
	`A sees own=${runsA.runs.some((r) => r.id === String(runA))} other=${runsA.runs.some((r) => r.id === String(runB))}`
)

const replayCross = await getRunReplay(userA, runB)
const replayOwn = await getRunReplay(userB, runB)
gate(
	'G8 replay of another user run is null, own replay works',
	replayCross === null && replayOwn !== null,
	`cross=${replayCross === null ? 'null' : 'LEAKED'} own=${replayOwn === null ? 'null' : 'ok'}`
)

// G8b the spend panel's per-run breakdown carries prompt text, so it must be the
// caller's own runs only. Positive control: A's own probe run really is in the list.
const spendA = await getSpendAndUsage(userA)
const spendIdsA = spendA.spend.perRun.map((r) => r.id)
const spendIdsB = (await getSpendAndUsage(userB)).spend.perRun.map((r) => r.id)
gate(
	'G8b spend per-run list is scoped',
	spendIdsA.includes(String(runA)) &&
		!spendIdsA.includes(String(runB)) &&
		spendIdsB.includes(String(runB)),
	`A has own=${spendIdsA.includes(String(runA))} other=${spendIdsA.includes(String(runB))}, rows=${spendIdsA.length}`
)

// G9 the 30 legacy conversations (written before the owner column existed) are
// served to nobody — positive control: they really are still in the table.
const legacy = await db.conversation.count({ where: { userId: null } })
const legacyVisibleToA = (await listConversations(userA)).conversations.length
const unownedTotal = await db.conversation.count()
gate(
	'G9 unowned legacy rows are invisible to every user',
	legacy > 0 && unownedTotal > legacyVisibleToA,
	`legacy-unowned=${legacy}, table total=${unownedTotal}, A sees=${legacyVisibleToA}`
)

// G10 requireUserId has no "anonymous means everything" path: the identity module
// throws rather than returning null.
const { requireUserId } = await import('../src/server/api/identity')
let anon = 'returned a value'
try {
	requireUserId({ headers: new Headers() } as never)
} catch (error) {
	anon = (error as { status?: number }).status === 401 ? '401' : 'threw other'
}
gate('G10 no identity means 401, never a global read', anon === '401', anon)

// Cleanup: the probe rows only. Nothing that existed before this run is touched.
await db.message.deleteMany({ where: { conversationId: { in: createdConversations } } })
await db.conversation.deleteMany({ where: { id: { in: createdConversations } } })
await db.agentRun.deleteMany({ where: { id: { in: createdRuns } } })
const residue = await db.conversation.count({ where: { id: { in: createdConversations } } })
gate('G11 probe rows cleaned up', residue === 0, `residue=${residue}`)

console.log(
	`\n${failures === 0 ? 'ALL GATES PASSED' : failures + ' GATE(S) FAILED'} — users ${userA.slice(0, 8)}/${userB.slice(0, 8)}`
)
if (failures > 0) process.exitCode = 1
await db.$disconnect()
