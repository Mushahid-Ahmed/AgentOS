// M13 load probe (AGENTOS_SCALE_SECURITY §6.1): fire N concurrent requests at a running
// server and report p50/p95/max and the error count, per URL.
//
// This is a local single-box measurement, which is what is honest here: the deployment
// target is Vercel serverless, where per-user concurrency is spread across lambdas, and
// hammering the live URL from a laptop measures the laptop's uplink, not the app. The
// numbers below bound the app's own work (SSR render, proxy auth, route guard), and only
// URLs that cost $0 are probed — no route here reaches a model.
//
// Usage: node scripts/load-probe.mjs <baseUrl> <concurrency> <totalPerUrl> /url1 /url2
const [base, concurrencyArg, totalArg, ...urls] = process.argv.slice(2)
if (!base || urls.length === 0) {
	console.error('usage: node scripts/load-probe.mjs <baseUrl> <concurrency> <total> /path …')
	process.exit(2)
}
const concurrency = Number(concurrencyArg || 50)
const total = Number(totalArg || 200)

// Keep-alive off the Node default pool: 100 concurrent sockets want a pool that big, or
// the queue time is reported as server latency. undici is a transitive dependency, so
// the pool widening is best-effort — the probe still runs without it.
try {
	const { Agent, setGlobalDispatcher } = await import('undici')
	setGlobalDispatcher(new Agent({ connections: concurrency, keepAliveTimeout: 5_000, bodyTimeout: 60_000, headersTimeout: 60_000 }))
} catch {
	console.log('(undici not resolvable — using Node’s default connection pool)')
}

function pct(sorted, p) {
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

for (const path of urls) {
	const latencies = []
	const statuses = new Map()
	let errors = 0
	const queue = Array.from({ length: total }, (_, i) => i)
	await Promise.all(
		Array.from({ length: Math.min(concurrency, total) }, async () => {
			for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
				const started = performance.now()
				try {
					const res = await fetch(base + path, { cache: 'no-store', redirect: 'manual' })
					await res.body?.cancel().catch(() => {})
					statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1)
					// A redirect and a 200 are both successes; anything 5xx is an error.
					if (res.status >= 500) errors++
				} catch {
					errors++
					statuses.set('network-error', (statuses.get('network-error') ?? 0) + 1)
				}
				latencies.push(performance.now() - started)
			}
		})
	)
	const sorted = latencies.sort((a, b) => a - b)
	console.log(
		`${path.padEnd(22)} n=${total} conc=${concurrency} p50=${pct(sorted, 0.5).toFixed(0)}ms p95=${pct(sorted, 0.95).toFixed(0)}ms max=${sorted[sorted.length - 1].toFixed(0)}ms errors=${errors} statuses=${[...statuses].map(([s, n]) => `${s}:${n}`).join(' ')}`
	)
}
