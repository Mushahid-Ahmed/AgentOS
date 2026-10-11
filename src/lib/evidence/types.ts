// The evidence hub's pure vocabulary (AgentOS M5, §10.4 / §13). An EvidencePort is
// the narrow read/write surface agents use to record and check claims; the executor
// injects one per run into every AgentContext. Kept pure — no 'server-only', no
// Prisma — so the hub's contract (and an in-memory implementation) is unit testable
// at $0, and the core engine never imports the DB. The Prisma-backed store lives in
// src/server/agentos/evidence-store.ts and satisfies this same interface.
//
// Why a hub and not just step outputs: §13 wants the final answer to disclose which
// claims are VERIFIED vs CONTESTED and to cite real sources. That needs claims to be
// first-class rows a fact-checker can mark and relate, not free text buried in a
// step's output blob.

// The lifecycle of a claim's trustworthiness. `unverified` is the honest default a
// researcher writes; the critic (Skeptic/Fact-Checker) moves it to `verified`,
// `contested` (weak/conflicting support) or `refuted` (contradicted).
export type VerificationStatus = 'unverified' | 'verified' | 'contested' | 'refuted'

// How one evidence row relates to the row it references. `supports` is the default
// (a source backing a claim); `contradicts` is written by the fact-checker when two
// claims cannot both hold.
export type EvidenceRelation = 'supports' | 'contradicts'

export type EvidenceInput = {
	// The distilled claim. One claim per record so a fact-checker can mark it.
	claim: string
	// The real source URL the claim was drawn from, when there is one. Null rather
	// than invented when the researcher had no citation (§8).
	source?: string | null
	// The retrieved text supporting the claim (the sonar answer / snippet). Optional.
	retrievedText?: string | null
	// Which agent wrote this (e.g. 'researcher') — the D6 roster shows provenance.
	discoveredByAgent: string
	verificationStatus?: VerificationStatus
	relation?: EvidenceRelation
	// The evidence id this row supports/contradicts, when it refers to another.
	referencesEvidenceId?: string | null
}

// A contradiction as the fact-checker reports it: two EXISTING evidence rows that
// cannot both hold. Recording it is an UPDATE, not a new row — the schema carries the
// relationship on the row itself (`relation` + `referencesEvidenceId`), so the
// offending claim's row is flipped to `contradicts` pointing at the row it conflicts
// with. Both claim STRINGS are carried so the executor can emit
// `contradiction_found {claim, againstClaim}` without a second lookup.
export type ContradictionInput = {
	// The row asserting the conflict (flipped to relation 'contradicts').
	claimId: string
	// The row it conflicts with (becomes referencesEvidenceId).
	againstId: string
	claim: string
	againstClaim: string
	discoveredByAgent: string
	source?: string | null
}

// The read view returned by list(). Ids are strings on the wire (JSON has no BigInt);
// the Prisma store stringifies its BigInt id, the memory store uses a counter.
export type EvidenceView = {
	id: string
	claim: string
	source: string | null
	retrievedText: string | null
	discoveredByAgent: string
	verificationStatus: VerificationStatus
	relation: EvidenceRelation
	referencesEvidenceId: string | null
}

// The port every implementation satisfies. All methods are best-effort at the
// server layer: a DB failure must cost an evidence row, never the agent's step, so
// the Prisma store swallows+reports errors and `add`/`flagContradiction` return ''
// when nothing was persisted (the executor then emits no evidence event rather than
// one pointing at a row that does not exist).
export type EvidencePort = {
	// Record a claim; returns its id ('' if the write failed).
	add(input: EvidenceInput): Promise<string>
	// Every claim recorded for the run, in insertion order.
	list(): Promise<EvidenceView[]>
	// Move a claim's verification status (fact-checker verdict).
	markVerification(id: string, status: VerificationStatus): Promise<void>
	// Flip an existing row to `contradicts` against another row; returns the updated
	// row's id ('' if either id is unknown, so the executor emits no phantom event).
	flagContradiction(input: ContradictionInput): Promise<string>
}
