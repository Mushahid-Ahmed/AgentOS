import 'server-only'
import { db } from '@/server/db/client'
import { captureError } from '@/lib/observability/capture-error'
import type {
	ContradictionInput,
	EvidenceInput,
	EvidencePort,
	EvidenceRelation,
	EvidenceView,
	VerificationStatus
} from '@/lib/evidence'

// The Prisma-backed evidence hub (AgentOS M5). One instance per run, created alongside
// the RunStore in run.ts and injected into the executor, which wraps it so writes emit
// the §13 evidence events. Satisfies the same EvidencePort the pure in-memory hub does,
// so the agents and the core are identical whether or not a DB is present.
//
// Best-effort by design, exactly like the run store: a DB failure must cost an evidence
// row, never the agent's step or the user's answer. Errors are reported to Sentry and
// swallowed; add/flagContradiction return '' when nothing persisted so the executor
// emits no event pointing at a row that doesn't exist, and list() degrades to empty.
//
// Ids are BigInt in the DB and cross the port as strings (JSON has no BigInt). Writes
// are scoped by runId as well as id, so one run's critic can never touch another run's
// evidence.

// Structural match for the Prisma row we read back (avoids importing the generated
// client type; extra columns on the real row are simply ignored).
type EvidenceRow = {
	id: bigint
	claim: string
	source: string | null
	retrievedText: string | null
	discoveredByAgent: string
	verificationStatus: string
	relation: string
	referencesEvidenceId: bigint | null
}

function toView(row: EvidenceRow): EvidenceView {
	return {
		id: row.id.toString(),
		claim: row.claim,
		source: row.source,
		retrievedText: row.retrievedText,
		discoveredByAgent: row.discoveredByAgent,
		// The DB stores these as plain strings (see the schema comment); narrow to the
		// union. A value outside the union would be a data bug, not a runtime input —
		// cast rather than re-validate on every read.
		verificationStatus: row.verificationStatus as VerificationStatus,
		relation: row.relation as EvidenceRelation,
		referencesEvidenceId: row.referencesEvidenceId != null ? row.referencesEvidenceId.toString() : null
	}
}

export function createEvidenceStore(id: bigint): EvidencePort {
	return {
		async add(input: EvidenceInput): Promise<string> {
			try {
				const row = await db.evidenceRecord.create({
					data: {
						runId: id,
						claim: input.claim,
						source: input.source ?? null,
						retrievedText: input.retrievedText ?? null,
						discoveredByAgent: input.discoveredByAgent,
						verificationStatus: input.verificationStatus ?? 'unverified',
						relation: input.relation ?? 'supports',
						referencesEvidenceId: input.referencesEvidenceId != null ? BigInt(input.referencesEvidenceId) : null
					},
					select: { id: true }
				})
				return row.id.toString()
			} catch (error) {
				captureError(error, { feature: 'agentos_evidence_add' })
				return ''
			}
		},

		async list(): Promise<EvidenceView[]> {
			try {
				const rows = await db.evidenceRecord.findMany({
					where: { runId: id },
					orderBy: { id: 'asc' }
				})
				return rows.map(toView)
			} catch (error) {
				captureError(error, { feature: 'agentos_evidence_list' })
				return []
			}
		},

		async markVerification(evidenceId: string, status: VerificationStatus): Promise<void> {
			try {
				await db.evidenceRecord.updateMany({
					where: { id: BigInt(evidenceId), runId: id },
					data: { verificationStatus: status }
				})
			} catch (error) {
				// A non-numeric id would throw in BigInt(); scope+catch keeps it best-effort.
				captureError(error, { feature: 'agentos_evidence_verify' })
			}
		},

		async flagContradiction(input: ContradictionInput): Promise<string> {
			try {
				// Update, don't insert: the relationship lives on the offending row
				// (relation + referencesEvidenceId), matching the pure hub's semantics.
				const result = await db.evidenceRecord.updateMany({
					where: { id: BigInt(input.claimId), runId: id },
					data: { relation: 'contradicts', referencesEvidenceId: BigInt(input.againstId) }
				})
				// updateMany reports how many rows matched; 0 means the id wasn't in this
				// run, so return '' and let the executor skip the event.
				return result.count > 0 ? input.claimId : ''
			} catch (error) {
				captureError(error, { feature: 'agentos_evidence_contradiction' })
				return ''
			}
		}
	}
}
