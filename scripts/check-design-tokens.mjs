#!/usr/bin/env node
// Design-token lint (UIUX brief Phase 1: "no raw values … add a lint or script
// check that fails on raw colours and unknown fonts outside the token file").
//
// Scans feature code (src/components, src/app — .ts/.tsx, excluding tests) for:
//   1. raw hex colour literals        (#rgb / #rgba / #rrggbb / #rrggbbaa)
//   2. hard-coded font families       (font-family / fontFamily / --font-* redefinition / font-[…] arbitrary)
//   3. off-scale spacing utilities    (p-[13px] / gap-[7px] / mt-[0.4rem] — bypass the spacing scale)
// Everything must go through the token system in globals.css + design-tokens.ts.
//
// A small allowlist covers files that legitimately own literal values (their own
// <html>, brand-identity SVG fills, the themeColor meta). Each entry is annotated
// with WHY. Extend the token file, not this allowlist, for anything new.
//
// Usage: node scripts/check-design-tokens.mjs [--json]
// Exit 0 = clean, 1 = violations found.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const SCAN_ROOTS = ['src/components', 'src/app']
const EXTENSIONS = new Set(['.ts', '.tsx'])

// Files permitted to carry literal colour/font values, with the reason.
const ALLOWLIST = new Map(
	[
		// Standalone crash page: renders its own <html>/<body> with no access to
		// the token cascade, so it inlines a copy of the dawn values on purpose.
		'src/app/global-error.tsx',
		// The themeColor <meta> must be a literal colour string (browser chrome).
		'src/app/[locale]/layout.tsx',
		// Original line-art door illustration: near-black interior + white stars
		// are intrinsic SVG art, not themeable UI colour.
		'src/components/marketing/door-illustration.tsx'
	].map((p) => [p.split('/').join(sep), p])
)

// #rgb, #rgba, #rrggbb, #rrggbbaa — bounded so we don't slice a longer token.
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g
// A hard-coded font: a CSS font-family decl, a JSX fontFamily style, a --font-*
// custom-property redefinition, or a Tailwind arbitrary font utility.
const FONT_RE = /font-family\s*:|fontFamily\s*:|--font-[a-z]|\bfont-\[/gi
// Off-scale spacing (UIUX M9): an arbitrary-value spacing utility such as
// p-[13px], gap-[7px] or mt-[0.4rem] bypasses the Tailwind spacing scale / the
// 4px SPACE_PX ramp in design-tokens.ts and lets rhythm drift per-screen.
// Spacing must use on-scale utilities (p-4, gap-6, …). Longest prefixes first.
const SPACING_RE =
	/(?:^|[\s"'`:])(?:space-x|space-y|gap-x|gap-y|gap|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|p|m)-\[[^\]]+\]/g

/** Recursively collect feature files under a root, skipping tests. */
function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		const st = statSync(full)
		if (st.isDirectory()) {
			if (entry === 'node_modules' || entry === '.next') continue
			walk(full, out)
		} else {
			const ext = entry.slice(entry.lastIndexOf('.'))
			if (!EXTENSIONS.has(ext)) continue
			if (entry.includes('.test.')) continue
			out.push(full)
		}
	}
	return out
}

/**
 * Scan the repo and return a list of violations. Exported so the node:test
 * wrapper (scripts/design-tokens.test.mjs) can assert on it without spawning.
 * @returns {{file:string,line:number,col:number,kind:string,snippet:string}[]}
 */
export function scanDesignTokens() {
	const violations = []
	for (const relRoot of SCAN_ROOTS) {
		const absRoot = join(ROOT, relRoot.split('/').join(sep))
		let files
		try {
			files = walk(absRoot)
		} catch {
			continue
		}
		for (const file of files) {
			const rel = relative(ROOT, file)
			if (ALLOWLIST.has(rel)) continue
			const text = readFileSync(file, 'utf8')
			const lines = text.split('\n')
			lines.forEach((lineText, i) => {
				// A per-line escape hatch, mirroring check-secrets' convention.
				if (lineText.includes('allowlist token')) return
				for (const m of lineText.matchAll(HEX_RE)) {
					violations.push({
						file: rel,
						line: i + 1,
						col: m.index + 1,
						kind: 'raw-hex-colour',
						snippet: m[0]
					})
				}
				const fm = FONT_RE.exec(lineText)
				if (fm) {
					violations.push({
						file: rel,
						line: i + 1,
						col: fm.index + 1,
						kind: 'hard-coded-font',
						snippet: fm[0].trim()
					})
				}
				FONT_RE.lastIndex = 0
				for (const sm of lineText.matchAll(SPACING_RE)) {
					violations.push({
						file: rel,
						line: i + 1,
						col: sm.index + 1,
						kind: 'off-scale-spacing',
						snippet: sm[0].trim()
					})
				}
			})
		}
	}
	return violations
}

function main() {
	const asJson = process.argv.includes('--json')
	const violations = scanDesignTokens()
	if (asJson) {
		process.stdout.write(JSON.stringify(violations, null, 2) + '\n')
		process.exit(violations.length ? 1 : 0)
	}
	if (violations.length === 0) {
		console.log('✓ design tokens: no raw colours, hard-coded fonts or off-scale spacing in feature code')
		process.exit(0)
	}
	console.error(`✗ design tokens: ${violations.length} raw value(s) outside the token system:\n`)
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}:${v.col}  ${v.kind}  ${v.snippet}`)
	}
	console.error(
		'\nUse a token from globals.css / design-tokens.ts instead. If a file must own a\n' +
			'literal (its own <html>, brand SVG art, themeColor meta), add it to the ALLOWLIST\n' +
			'in scripts/check-design-tokens.mjs with a reason, or put `allowlist token` on the line.'
	)
	process.exit(1)
}

// Run the CLI only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main()
}
