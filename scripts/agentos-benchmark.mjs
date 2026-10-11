#!/usr/bin/env node
// AgentOS four-setup benchmark CLI (milestone 8). Drives POST /api/agentos-benchmark
// over HTTP and prints the streamed progress + the final per-setup report.
//
// Why HTTP and not a direct import: the engine (src/server/agentos-benchmark/engine.ts)
// and everything it touches are 'server-only' modules that import the Prisma client and
// next/server — a plain node script cannot load them. Driving the endpoint means the CLI
// runs the EXACT code path the dashboard button does. Start the dev server first
// (`pnpm dev`), then `pnpm benchmark:agentos`.
//
// Spend discipline (§12): the DEFAULT is a 3-task PILOT. A full 24-task run must be
// requested with --full (or an explicit --limit). The server also enforces
// BENCHMARK_CAP_USD + the nightly cap and stops honestly if either is reached.
//
// Usage:
//   node scripts/agentos-benchmark.mjs [--url http://localhost:3000]
//                                      [--pilot | --full | --limit N]
//                                      [--label "name"] [--notes "text"]

const SETUP_LABELS = {
	baseline_a: 'A · single LLM',
	baseline_b: 'B · single LLM + RAG',
	baseline_c: 'C · fixed multi-agent',
	agentos: 'AgentOS'
}

function parseArgs(argv) {
	const out = {
		url: process.env.BENCHMARK_URL ?? 'http://localhost:3000',
		limit: undefined,
		pilot: undefined,
		label: undefined,
		notes: undefined
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		const next = () => argv[++i]
		if (arg === '--url') out.url = next()
		else if (arg === '--limit') out.limit = Number.parseInt(next(), 10)
		else if (arg === '--pilot') out.pilot = true
		else if (arg === '--full') out.pilot = false
		else if (arg === '--label') out.label = next()
		else if (arg === '--notes') out.notes = next()
		else if (arg === '--help' || arg === '-h') {
			printUsage()
			process.exit(0)
		} else {
			console.error(`Unknown argument: ${arg}`)
			printUsage()
			process.exit(1)
		}
	}
	if (out.limit != null && (!Number.isFinite(out.limit) || out.limit < 1)) {
		console.error('--limit must be a positive integer')
		process.exit(1)
	}
	return out
}

function printUsage() {
	console.log(
		'Usage: node scripts/agentos-benchmark.mjs [--url URL] [--pilot | --full | --limit N] [--label NAME] [--notes TEXT]'
	)
}

function drainFrames(buffer, onFrame) {
	let rest = buffer
	let sep
	while ((sep = rest.indexOf('\n\n')) !== -1) {
		const frame = rest.slice(0, sep)
		rest = rest.slice(sep + 2)
		const dataLines = frame
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trim())
		if (dataLines.length === 0) continue
		onFrame(dataLines.join('\n'))
	}
	return rest
}

function usd(micro) {
	if (micro == null) return '—'
	return `$${(micro / 1_000_000).toFixed(6)}`
}

function score(value) {
	return value == null ? '—' : value.toFixed(2)
}

function pct(value) {
	return value == null ? '—' : `${(value * 100).toFixed(1)}%`
}

function num(value, digits = 1) {
	return value == null ? '—' : value.toFixed(digits)
}

function printReport(report) {
	console.log('\n============ AgentOS FOUR-SETUP BENCHMARK ============')
	console.log(`run #${report.runId}  "${report.label}"`)
	console.log(`generator: ${report.generatorModel}   judge: ${report.judgeModel}   tasks: ${report.taskCount}`)
	console.log(`started: ${report.startedAt}   finished: ${report.finishedAt}`)

	console.log('\n  Per-setup summary (measured):')
	console.log(
		`    ${'setup'.padEnd(26)} ${'success'.padEnd(9)} ${'score'.padEnd(7)} ${'unsup'.padEnd(7)} ` +
			`${'cites'.padEnd(7)} ${'verif'.padEnd(7)} ${'cost'.padEnd(13)} ${'latency'.padEnd(10)} ${'calls'.padEnd(9)} replans`
	)
	for (const s of report.setups) {
		const label = (SETUP_LABELS[s.setup] ?? s.setup).padEnd(26)
		console.log(
			`    ${label} ${pct(s.successRate).padEnd(9)} ${score(s.meanJudgeScore).padEnd(7)} ` +
				`${num(s.meanUnsupportedClaims, 2).padEnd(7)} ${num(s.meanCitations, 2).padEnd(7)} ` +
				`${num(s.meanVerifiedClaims, 2).padEnd(7)} ${usd(s.meanCostMicroUsd).padEnd(13)} ` +
				`${`${num(s.meanLatencyMs, 0)}ms`.padEnd(10)} ` +
				`${`${num(s.meanModelCalls, 1)}m/${num(s.meanToolCalls, 1)}t`.padEnd(9)} ${s.totalReplans}`
		)
	}

	console.log('\n  Per-task winners (highest judge score; ties listed):')
	for (const w of report.perTaskWinners) {
		const names = w.winners.map((s) => SETUP_LABELS[s] ?? s).join(' + ')
		console.log(`    ${w.taskId.padEnd(8)} best ${score(w.bestScore)}  → ${names}`)
	}

	console.log('\n  AgentOS head-to-head:')
	console.log(`    (joint-)best on ${report.agentosBestCount} task(s)`)
	console.log(`    NEVER best on  ${report.agentosNeverBestCount} task(s)  ← reported honestly, not hidden`)
	console.log('======================================================\n')
}

function printProgress(event) {
	const parts = event.outcomes.map((o) => {
		const label = o.setup.replace('baseline_', '').replace('agentos', 'D')
		if (!o.ok) return `${label}:ERR`
		return `${label}:${score(o.score)}/${usd(o.costMicroUsd)}/${o.latencyMs}ms`
	})
	console.log(
		`[${String(event.index).padStart(2)}/${event.total}] ${event.taskId.padEnd(8)} ${event.category.padEnd(13)} ` +
			`spent ${usd(event.spentMicroUsd)}  ${parts.join('  ')}`
	)
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const body = {}
	if (options.limit != null) body.limit = options.limit
	if (options.pilot != null) body.pilot = options.pilot
	if (options.label != null) body.label = options.label
	if (options.notes != null) body.notes = options.notes

	const endpoint = `${options.url.replace(/\/$/, '')}/api/agentos-benchmark`
	const mode = options.pilot === false ? 'FULL' : options.limit != null ? `limit ${options.limit}` : 'PILOT (3 tasks)'
	console.log(`POST ${endpoint}  [${mode}]`)
	console.log('Running each task through all four setups (A/B/C/AgentOS) + the gpt-4.1 rubric judge.')
	console.log('The server enforces the benchmark + nightly spend caps and stops honestly if reached.\n')

	let response
	try {
		response = await fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} catch (error) {
		console.error(`Could not reach ${endpoint} — is the dev server running? (${error.message})`)
		process.exit(1)
	}

	if (!response.ok || !response.body) {
		const text = await response.text().catch(() => '')
		console.error(`Benchmark endpoint returned ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`)
		process.exit(1)
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let exitCode = 0

	const onFrame = (data) => {
		let event
		try {
			event = JSON.parse(data)
		} catch {
			return
		}
		switch (event.type) {
			case 'start':
				console.log(
					`[start] run #${event.runId} — ${event.taskCount} task(s) × ${event.setups.length} setups, ` +
						`generator ${event.generatorModel}, judge ${event.judgeModel}, cap $${event.capUsd}`
				)
				break
			case 'progress':
				printProgress(event)
				break
			case 'heartbeat':
				// Keep-alive before each setup; also proves the run is alive during the
				// long Setup D (full AgentOS) hops. Kept on one terse line.
				console.log(
					`        · [${String(event.index).padStart(2)}/${event.total}] ${event.taskId} → ${event.setup}`
				)
				break
			case 'done':
				printReport(event.report)
				break
			case 'error':
				console.error(`[error${event.code ? ` ${event.code}` : ''}] ${event.message}`)
				exitCode = 1
				break
			default:
				break
		}
	}

	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })
		buffer = drainFrames(buffer, onFrame)
	}
	if (buffer.trim()) drainFrames(`${buffer}\n\n`, onFrame)

	process.exit(exitCode)
}

main().catch((error) => {
	console.error(`AgentOS benchmark CLI failed: ${error.stack ?? error.message}`)
	process.exit(1)
})
