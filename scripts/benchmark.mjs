#!/usr/bin/env node
// Benchmark CLI (milestone 4). Drives POST /api/benchmark over HTTP and prints
// the streamed progress + final report.
//
// Why HTTP and not a direct import: the engine (src/server/api/benchmark.ts) and
// everything it touches are 'server-only' modules that import the Prisma client
// and next/server — they cannot be loaded by a plain node script. Driving the
// endpoint means the CLI runs the exact same code path the dashboard button will,
// against whatever environment the server already has. Start the dev server
// first (`pnpm dev`), then `pnpm benchmark`.
//
// Usage:
//   node scripts/benchmark.mjs [--url http://localhost:3000] [--limit N]
//                              [--label "name"] [--notes "text"]
//   --limit N   run only the first N prompts (a cheap, fast smoke subset)

function parseArgs(argv) {
	const out = {
		url: process.env.BENCHMARK_URL ?? 'http://localhost:3000',
		limit: undefined,
		label: undefined,
		notes: undefined
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		const next = () => argv[++i]
		if (arg === '--url') out.url = next()
		else if (arg === '--limit') out.limit = Number.parseInt(next(), 10)
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
	console.log('Usage: node scripts/benchmark.mjs [--url URL] [--limit N] [--label NAME] [--notes TEXT]')
}

// Split an SSE chunk buffer into complete frames (separated by a blank line),
// carrying any incomplete tail back to the caller.
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

function pct(value) {
	return `${(value * 100).toFixed(1)}%`
}

function ms(value) {
	return `${value}ms`
}

function printLatencyLine(name, latency) {
	console.log(
		`    ${name.padEnd(6)} p50 ${ms(latency.p50).padEnd(8)} p95 ${ms(latency.p95).padEnd(8)} ` +
			`mean ${ms(latency.mean).padEnd(9)} min ${ms(latency.min).padEnd(8)} max ${ms(latency.max).padEnd(8)} ` +
			`(n=${latency.count})`
	)
}

function printReport(report) {
	console.log('\n================ BENCHMARK REPORT ================')
	console.log(`run #${report.runId}  "${report.label}"`)
	console.log(
		`judge model: ${report.judgeModel}   concurrency: ${report.concurrency}   prompts: ${report.promptCount}`
	)
	console.log(`started: ${report.startedAt}   finished: ${report.finishedAt ?? '(incomplete)'}`)

	console.log('\n  Latency (successful routing hops only):')
	printLatencyLine('Jev', report.jev.latency)
	printLatencyLine('judge', report.judge.latency)

	console.log('\n  Accuracy vs dataset labels (over successful calls):')
	console.log(`    Jev    ${pct(report.jev.accuracy)}  (${report.jev.agreed}/${report.jev.ok} correct)`)
	console.log(`    judge  ${pct(report.judge.accuracy)}  (${report.judge.agreed}/${report.judge.ok} correct)`)

	console.log('\n  Reliability:')
	console.log(
		`    Jev    ${report.jev.errors}/${report.jev.total} failed  (failure rate ${pct(report.jev.failureRate)})`
	)
	console.log(
		`    judge  ${report.judge.errors}/${report.judge.total} failed  (failure rate ${pct(report.judge.failureRate)})`
	)

	console.log('\n  Head-to-head:')
	console.log(`    router agreement (same label on both-ok prompts): ${pct(report.routerAgreement)}  (n=${report.bothOk})`)
	const speed = report.speedUpFactor == null ? 'n/a (no successful Jev latency)' : `${report.speedUpFactor}x`
	console.log(`    measured speed-up (judge p50 / Jev p50): ${speed}`)

	console.log('\n  Routing cost (real, this run):')
	console.log(`    Jev    $${report.jevRoutingCostUsd.toFixed(6)}  (free BeatAPI capability)`)
	console.log(`    judge  $${report.judgeRoutingCostUsd.toFixed(6)}  (tokens × curated NanoGPT price)`)
	console.log('==================================================\n')
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const body = {}
	if (options.limit != null) body.limit = options.limit
	if (options.label != null) body.label = options.label
	if (options.notes != null) body.notes = options.notes

	const endpoint = `${options.url.replace(/\/$/, '')}/api/benchmark`
	console.log(`POST ${endpoint}${options.limit != null ? `  (limit ${options.limit})` : ''}`)
	console.log('Running every prompt through Jev and the LLM-as-judge baseline at concurrency 1.')
	console.log('Free-tier Jev is throttled, so this honors Retry-After and may take a while.\n')

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
				console.log(`[start] run #${event.runId} — ${event.total} prompts, judge ${event.judgeModel}`)
				break
			case 'wait':
				console.log(
					`[wait]  ${event.promptId} (${event.router}) throttled — waiting ${Math.round(event.waitMs / 1000)}s [${event.reason}]`
				)
				break
			case 'progress': {
				const jev = event.jev.ok ? `${event.jev.label} ${event.jev.latencyMs}ms` : `ERR ${event.jev.error}`
				const judge = event.judge.ok
					? `${event.judge.label} ${event.judge.latencyMs}ms`
					: `ERR ${event.judge.error}`
				const flag = event.jev.ok && event.judge.ok && event.jev.label === event.judge.label ? '=' : ' '
				console.log(
					`[${String(event.index).padStart(3)}/${event.total}] ${event.promptId.padEnd(16)} ` +
						`exp:${event.expected.padEnd(6)} jev:${jev.padEnd(20)} judge:${judge.padEnd(20)} ${flag}`
				)
				break
			}
			case 'done':
				printReport(event.report)
				break
			case 'error':
				console.error(`[error] ${event.message}`)
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
	// Flush any trailing frame that didn't end with a blank line.
	if (buffer.trim()) drainFrames(`${buffer}\n\n`, onFrame)

	process.exit(exitCode)
}

main().catch((error) => {
	console.error(`Benchmark CLI failed: ${error.stack ?? error.message}`)
	process.exit(1)
})
