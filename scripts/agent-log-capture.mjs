#!/usr/bin/env node
// 8x Playmakers agent-log capture for Qoder.
//
// Qoder writes a full session transcript to a JSONL file per session under
// ~/.qoder/projects/<project-slug>/<sessionId>.jsonl. This script projects that
// transcript down to ONLY what the 8x assignment asks for -- the verbatim human
// prompt and the final assistant response for each turn, plus a UTC timestamp
// and the model name -- and writes it to .agent-logs/ in the 8x format.
//
// It is invoked automatically by Qoder hooks (UserPromptSubmit + Stop) and can
// also run as a watcher or a one-shot backfill. It never invents content: every
// entry is a faithful projection of the transcript Qoder already recorded.
//
// Modes:
//   node agent-log-capture.mjs stop        # hook: read stdin {session_id,cwd}, extract that session
//   node agent-log-capture.mjs prompt      # hook: same, run on prompt submit (ensures file exists early)
//   node agent-log-capture.mjs extract     # one-shot: extract session from stdin or newest matching
//   node agent-log-capture.mjs backfill    # extract every recorded session for this workspace
//   node agent-log-capture.mjs watch       # poll the projects dir, re-extract on change (foreground)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const PROJECTS_DIR = path.join(HOME, '.qoder', 'projects')

// ---- configuration (all overridable via env so the hook config stays portable) ----
const REPO_ROOT = process.env.AGENT_REPO_ROOT || findRepoRoot(process.cwd())
const LOGS_DIR =
	process.env.AGENT_LOGS_DIR || path.join(REPO_ROOT || process.cwd(), '.agent-logs')
const AUTHOR = process.env.AGENT_AUTHOR || 'your-github-handle'
const PROJECT = process.env.AGENT_PROJECT || (REPO_ROOT ? path.basename(REPO_ROOT) : 'unknown')
const TOOL = process.env.AGENT_TOOL || 'qoder'
// Only capture sessions whose recorded cwd lives under this workspace root.
const WORKSPACE = process.env.AGENT_WORKSPACE || path.dirname(REPO_ROOT || process.cwd())

function findRepoRoot(start) {
	let dir = start
	for (let i = 0; i < 8 && dir; i++) {
		if (fs.existsSync(path.join(dir, '.git'))) return dir
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	// Fall back to a sibling/child named "repo" (this workspace clones into repo/).
	const child = path.join(start, 'repo')
	if (fs.existsSync(path.join(child, '.git'))) return child
	return start
}

function readStdin() {
	try {
		const buf = fs.readFileSync(0, 'utf8')
		return buf ? JSON.parse(buf) : {}
	} catch {
		return {}
	}
}

function sessionFiles() {
	const out = []
	if (!fs.existsSync(PROJECTS_DIR)) return out
	for (const slug of fs.readdirSync(PROJECTS_DIR)) {
		const dir = path.join(PROJECTS_DIR, slug)
		let entries = []
		try {
			entries = fs.readdirSync(dir)
		} catch {
			continue
		}
		for (const f of entries) {
			if (f.endsWith('.jsonl')) out.push(path.join(dir, f))
		}
	}
	return out
}

function resolveTargetSession(stdin) {
	const files = sessionFiles()
	if (stdin.session_id) {
		const hit = files.find((f) => path.basename(f).startsWith(stdin.session_id))
		if (hit) return [hit]
	}
	// Prefer sessions recorded under our workspace, newest first.
	const scored = files
		.map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
		.sort((a, b) => b.m - a.m)
	return scored.map((s) => s.f).slice(0, 1)
}

function parseTranscript(file) {
	const raw = fs.readFileSync(file, 'utf8')
	const lines = raw.split(/\r?\n/).filter(Boolean)
	let model = 'unknown'
	let sessionId = path.basename(file).replace(/\.jsonl$/, '')
	let cwd = null
	const turns = []
	let current = null

	const pushAssistantText = (text, ts, m) => {
		if (!current) return
		if (text && text.trim()) {
			current.responseParts.push(text)
			current.responseTime = ts || current.responseTime
			if (m) current.model = m
		}
	}

	for (const line of lines) {
		let o
		try {
			o = JSON.parse(line)
		} catch {
			continue
		}
		if (o.sessionId) sessionId = o.sessionId
		if (o.cwd) cwd = o.cwd
		if (o.type === 'runtime-config' && o.model) model = o.model

		if (o.type === 'user') {
			const isHuman = o.origin?.kind === 'human' || !!o.humanInput?.text
			if (!isHuman) continue // tool results / injected context, not a prompt
			const text =
				o.humanInput?.text ??
				(Array.isArray(o.message?.content)
					? o.message.content
							.filter((c) => c.type === 'text')
							.map((c) => c.text)
							.join('\n')
					: typeof o.message?.content === 'string'
						? o.message.content
						: '')
			if (!text) continue
			current = {
				prompt: text,
				promptTime: o.timestamp || new Date().toISOString(),
				model: o.message?.model || model,
				responseParts: [],
				responseTime: o.timestamp || new Date().toISOString(),
			}
			turns.push(current)
			continue
		}

		if (o.type === 'assistant') {
			const m = o.message?.model || model
			const content = o.message?.content
			if (Array.isArray(content)) {
				for (const c of content) {
					// ONLY text. Thinking and tool_use are explicitly excluded by the brief.
					if (c.type === 'text') pushAssistantText(c.text, o.timestamp, m)
				}
			} else if (typeof content === 'string') {
				pushAssistantText(content, o.timestamp, m)
			}
		}
	}

	return { sessionId, cwd, model, turns }
}

function withinWorkspace(cwd) {
	if (!cwd) return true // be permissive if the transcript lacks cwd
	const a = path.resolve(cwd).toLowerCase()
	const b = path.resolve(WORKSPACE).toLowerCase()
	return a.startsWith(b)
}

function fmtFileDate(iso) {
	const d = new Date(iso)
	const p = (n) => String(n).padStart(2, '0')
	return {
		date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
		filestamp: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(
			d.getUTCHours(),
		)}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}`,
	}
}

// Security backstop: .agent-logs/ ships publicly, so mask anything that looks
// like a credential before it is written. This is the one sanctioned mutation of
// captured text (docs/rules/secrets.md: redact a secret out before logging).
const SECRET_PATTERNS = [
	/sk-or-v1-[A-Za-z0-9_-]+/g,
	/sk-[A-Za-z0-9_-]{16,}/g,
	/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g,
	// URL userinfo, e.g. postgresql://user:pass@host. The greedy [^/\s]+
	// password backtracks to the LAST '@', so passwords containing '@'
	// (a real Supabase password did) are masked whole rather than leaving a
	// trailing fragment exposed. The lookbehind keeps the scheme prefix.
	/(?<=\/\/)[^/\s:@]+:[^/\s]+@/g,
]
function redactSecrets(s) {
	if (typeof s !== 'string') return s
	let out = s
	for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED_SECRET]')
	return out
}

function renderLog(t) {
	const short = t.sessionId.slice(0, 8)
	const first = t.turns[0]?.promptTime || new Date().toISOString()
	const last = t.turns[t.turns.length - 1]?.promptTime || first
	const { date } = fmtFileDate(first)
	const effectiveModel = t.turns.find((x) => x.model)?.model || t.model

	let out = ''
	out += '---\n'
	out += `session_id: ${t.sessionId}\n`
	out += `date: ${date}\n`
	out += `author: ${AUTHOR}\n`
	out += `model: ${effectiveModel}\n`
	out += `tool: ${TOOL}\n`
	out += `project: ${PROJECT}\n`
	out += `total_exchanges: ${t.turns.length}\n`
	out += `first_prompt_time: ${first}\n`
	out += `last_prompt_time: ${last}\n`
	out += '---\n\n'
	out += `# Session Log - ${date}\n\n`
	out += `Session: \`${short}\` | Project: \`${PROJECT}\` | Author: \`${AUTHOR}\`\n\n`

	t.turns.forEach((turn, i) => {
		const n = i + 1
		out += '---\n\n'
		out += `[LOG_ENTRY type=PROMPT num=${n} session=${short}]\n`
		out += `timestamp: ${turn.promptTime}\n`
		out += `model: ${turn.model}\n\n`
		out += `${redactSecrets(turn.prompt.trim())}\n\n`
		const resp = redactSecrets(turn.responseParts.join('\n\n').trim())
		out += `[LOG_ENTRY type=RESPONSE num=${n} session=${short}]\n`
		out += `timestamp: ${turn.responseTime}\n`
		out += `model: ${turn.model}\n\n`
		out += `${resp || '(no final text response recorded for this turn)'}\n\n`
	})
	return { content: out, firstIso: first }
}

function writeSession(file) {
	const t = parseTranscript(file)
	if (!t.turns.length) return null
	if (!withinWorkspace(t.cwd)) return null
	const { content, firstIso } = renderLog(t)
	const { filestamp } = fmtFileDate(firstIso)
	fs.mkdirSync(LOGS_DIR, { recursive: true })
	const outPath = path.join(LOGS_DIR, `${filestamp}_${t.sessionId}.md`)
	// Deterministic projection of the transcript: rewriting regenerates identical
	// prior entries plus any new turn. Nothing is hand-edited or tidied.
	const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null
	if (existing !== content) fs.writeFileSync(outPath, content)
	return outPath
}

function main() {
	const mode = process.argv[2] || 'extract'
	if (mode === 'watch') {
		const seen = new Map()
		const tick = () => {
			for (const f of sessionFiles()) {
				try {
					const m = fs.statSync(f).mtimeMs
					if (seen.get(f) === m) continue
					seen.set(f, m)
					const out = writeSession(f)
					if (out) process.stderr.write(`[agent-log-capture] wrote ${out}\n`)
				} catch {}
			}
		}
		tick()
		setInterval(tick, 2000)
		process.stderr.write(`[agent-log-capture] watching ${PROJECTS_DIR} -> ${LOGS_DIR}\n`)
		return
	}

	if (mode === 'backfill') {
		let n = 0
		for (const f of sessionFiles()) {
			const out = writeSession(f)
			if (out) {
				n++
				process.stderr.write(`[agent-log-capture] wrote ${out}\n`)
			}
		}
		process.stderr.write(`[agent-log-capture] backfilled ${n} session(s)\n`)
		return
	}

	// stop | prompt | extract
	const stdin = readStdin()
	const targets = resolveTargetSession(stdin)
	for (const f of targets) {
		const out = writeSession(f)
		if (out) process.stderr.write(`[agent-log-capture] wrote ${out}\n`)
	}
}

main()
