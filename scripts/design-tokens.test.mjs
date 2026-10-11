import test from 'node:test'
import assert from 'node:assert/strict'

import { scanDesignTokens } from './check-design-tokens.mjs'

// Enforced by `pnpm test` (this file) and standalone by `pnpm check:tokens`.
// Feature code must reference the token system (globals.css / design-tokens.ts)
// — never a raw hex colour, a hard-coded font family, or an off-scale arbitrary
// spacing utility. The allowlist in check-design-tokens.mjs covers only files
// that legitimately own literals.
test('design tokens: feature code carries no raw colours, hard-coded fonts or off-scale spacing', () => {
	const violations = scanDesignTokens()
	const detail = violations.map((v) => `${v.file}:${v.line}:${v.col} ${v.kind} ${v.snippet}`).join('\n')
	assert.deepEqual(violations, [], `raw token values found outside the token system:\n${detail}`)
})
