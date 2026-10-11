import type {
	ContradictionInput,
	EvidenceInput,
	EvidencePort,
	EvidenceView,
	VerificationStatus
} from './types'

// An in-memory EvidencePort. Two jobs: (1) the executor's fallback when a run has no
// Prisma store (core tests, or a run that never touches the DB), so AgentContext
// always exposes a WORKING hub rather than a no-op that silently loses claims; and
// (2) the reference implementation the pure unit tests assert against at $0. It is
// deliberately simple and synchronous under the hood — an array plus a counter.

export function createMemoryEvidence(): EvidencePort {
	const rows: EvidenceView[] = []
	let nextId = 1

	function push(input: EvidenceInput, relation: EvidenceInput['relation']): EvidenceView {
		const row: EvidenceView = {
			id: String(nextId++),
			claim: input.claim,
			source: input.source ?? null,
			retrievedText: input.retrievedText ?? null,
			discoveredByAgent: input.discoveredByAgent,
			verificationStatus: input.verificationStatus ?? 'unverified',
			relation: relation ?? 'supports',
			referencesEvidenceId: input.referencesEvidenceId ?? null
		}
		rows.push(row)
		return row
	}

	return {
		async add(input: EvidenceInput): Promise<string> {
			return push(input, input.relation).id
		},
		async list(): Promise<EvidenceView[]> {
			// Copy so a caller can't mutate the hub's own array.
			return rows.map((row) => ({ ...row }))
		},
		async markVerification(id: string, status: VerificationStatus): Promise<void> {
			const row = rows.find((r) => r.id === id)
			if (row) row.verificationStatus = status
		},
		async flagContradiction(input: ContradictionInput): Promise<string> {
			// Update, don't insert: the relationship lives on the offending row. Unknown
			// ids are refused ('') rather than creating a phantom row, so the executor
			// emits no contradiction event for a pair that isn't really in the hub.
			const row = rows.find((r) => r.id === input.claimId)
			const against = rows.find((r) => r.id === input.againstId)
			if (!row || !against) return ''
			row.relation = 'contradicts'
			row.referencesEvidenceId = input.againstId
			return row.id
		}
	}
}
