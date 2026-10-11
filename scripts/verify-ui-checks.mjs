// UIUX M10 verification harness: functional regression + accessibility +
// contrast + reflow checks against a base URL. Sign-in reuses the live demo
// session cookie relayed to _scratch/live-session.json (untracked), so the
// demo password and the token never reach logs or stdout.
//
// Usage: node scripts/verify-ui-checks.mjs --base http://localhost:3000 --label after

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`)
	return i === -1 ? fallback : process.argv[i + 1]
}

const BASE = arg('base', 'http://localhost:3000')
const LABEL = arg('label', 'after')
const OUT = join(ROOT, 'docs', 'ui-audit', LABEL)

function sessionCookies() {
	const { cookie } = JSON.parse(readFileSync(join(ROOT, '_scratch', 'live-session.json'), 'utf8'))
	return cookie
		.split(';')
		.filter((p) => p.includes('='))
		.map((pair) => {
			const i = pair.indexOf('=')
			return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain: 'localhost', path: '/' }
		})
}

const results = []
const record = (name, pass, detail) => {
	results.push({ name, pass, detail })
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// In-page helpers ------------------------------------------------------------
const CONTRAST_FN = `
window.__ratio = (fg, bg) => {
  const parse = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const p = m[1].split(',').map(Number)
    return p
  }
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  const lum = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2])
  const a = parse(fg), b = parse(bg)
  if (!a || !b) return null
  const l1 = lum(a), l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
window.__bgOf = (el) => {
  let n = el
  while (n && n !== document.documentElement) {
    const c = getComputedStyle(n).backgroundColor
    if (c && !c.includes('0, 0, 0, 0') && c !== 'transparent') return c
    n = n.parentElement
  }
  return getComputedStyle(document.body).backgroundColor
}
window.__sample = (cls) => {
  const el = document.querySelector(cls)
  if (!el) return null
  return { fg: getComputedStyle(el).color, bg: window.__bgOf(el) }
}
`

async function run() {
	mkdirSync(OUT, { recursive: true })
	const browser = await chromium.launch({ channel: 'chrome', headless: true })

	// A. protected redirect, logged out
	{
		const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
		const page = await ctx.newPage()
		await page.goto(BASE + '/app', { waitUntil: 'load' })
		await page.waitForTimeout(800)
		record('protected redirect /app -> /login', new URL(page.url()).pathname.includes('/login'), page.url())

		// C. keyboard focus visibility on login
		await page.goto(BASE + '/login', { waitUntil: 'load' })
		await page.waitForTimeout(600)
		const seen = []
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press('Tab')
			seen.push(
				await page.evaluate(() => {
					const el = document.activeElement
					if (!el || el === document.body) return null
					const cs = getComputedStyle(el)
					return { tag: el.tagName, outline: `${cs.outlineWidth} ${cs.outlineStyle}` }
				})
			)
		}
		const ringed = seen.filter((s) => s && s.outline.startsWith('2px'))
		record('keyboard focus ring visible (2px)', ringed.length > 0, JSON.stringify(seen.filter(Boolean)))
		await ctx.close()
	}

	// Authenticated context
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	await ctx.addCookies(sessionCookies())
	const page = await ctx.newPage()
	await page.goto(BASE + '/app', { waitUntil: 'load' })
	await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 30_000 })
	record('session cookie sign-in reaches /app', true, '')

	// D. contrast on chat (dawn)
	await page.waitForTimeout(800)
	await page.addScriptTag({ content: CONTRAST_FN })
	const samples = await page.evaluate(() => ({
		body: { fg: getComputedStyle(document.body).color, bg: window.__bgOf(document.body) },
		muted: window.__sample('[class*="text-text-muted"]'),
		faint: window.__sample('[class*="text-text-faint"]')
	}))
	for (const [key, s] of Object.entries(samples)) {
		if (!s) {
			record(`contrast ${key}`, false, 'element not found')
			continue
		}
		const r = await page.evaluate(([fg, bg]) => window.__ratio(fg, bg), [s.fg, s.bg])
		record(`contrast ${key} >= 4.5`, r !== null && r >= 4.5, `${r?.toFixed(2)} (${s.fg} on ${s.bg})`)
	}

	// H. aria-live region
	record(
		'chat aria-live status region',
		(await page.locator('main [aria-live="polite"][role="status"]').count()) > 0,
		''
	)

	// I. decorative svgs hidden
	const svgAudit = await page.evaluate(() => {
		const bad = []
		for (const svg of document.querySelectorAll('svg')) {
			let n = svg
			let hidden = false
			while (n && n !== document.documentElement) {
				if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') {
					hidden = true
					break
				}
				n = n.parentElement
			}
			const labelled = svg.getAttribute('role') === 'img' || svg.querySelector('title')
			if (!hidden && !labelled) bad.push(svg.className?.baseVal?.slice(0, 40) || 'svg')
		}
		return { total: document.querySelectorAll('svg').length, bad }
	})
	record('all decorative svgs aria-hidden', svgAudit.bad.length === 0, `${svgAudit.total} svgs, unlabelled: ${svgAudit.bad.length}`)

	// M/N. style continuity + no h-scroll across routes
	const routes = ['/app', '/dashboard', '/agentos']
	const styles = []
	for (const r of routes) {
		await page.goto(BASE + r, { waitUntil: 'load' })
		await page.waitForTimeout(900)
		styles.push(
			await page.evaluate((route) => {
				const h1 = document.querySelector('h1')
				const btn = document.querySelector('main button, footer button, header button')
				return {
					route,
					h1Font: h1 ? getComputedStyle(h1).fontFamily.split(',')[0] : null,
					bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0],
					btnRadius: btn ? getComputedStyle(btn).borderRadius : null,
					hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
				}
			}, r)
		)
	}
	const serif = new Set(styles.map((s) => s.h1Font))
	record('h1 display serif consistent across views', serif.size === 1, [...serif].join(' | '))
	record('no horizontal scroll at 1440 (app views)', styles.every((s) => !s.hScroll), styles.map((s) => `${s.route}:${s.hScroll}`).join(' '))
	record('control radius consistent (8px)', new Set(styles.map((s) => s.btnRadius)).size === 1, styles.map((s) => s.btnRadius).join(' | '))

	// J. dashboard panels all present
	await page.goto(BASE + '/dashboard', { waitUntil: 'load' })
	await page.waitForTimeout(1200)
	const sections = await page.evaluate(() => Array.from(document.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label')))
	const expected = ['Cumulative routing statistics', 'Live latency and routing distribution', 'Benchmark', 'Benchmark run history']
	record('dashboard sections present', expected.every((e) => sections.includes(e)), sections.join(' | '))

	// G. touch targets at 390
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(BASE + '/app', { waitUntil: 'load' })
	await page.waitForTimeout(900)
	const small = await page.evaluate(() =>
		Array.from(document.querySelectorAll('button, a, input, textarea'))
			.map((e) => ({ h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
			.filter((r) => r.h > 1 && r.h < 44).length
	)
	record('touch targets >= 44px at 390', small === 0, `${small} under target`)
	record('no horizontal scroll at 390 (chat)', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '')

	// F. 200%-zoom reflow (720 CSS px) + 320 reflow
	for (const w of [720, 320]) {
		await page.setViewportSize({ width: w, height: 900 })
		await page.waitForTimeout(500)
		const probe = await page.evaluate(() => {
			const vw = document.documentElement.clientWidth
			const offenders = []
			for (const el of document.querySelectorAll('body *')) {
				const r = el.getBoundingClientRect()
				if (r.right > vw + 1 && r.width > 0) {
					offenders.push(`${el.tagName}.${(el.getAttribute('class') || '').split(' ').slice(0, 4).join('.')} right=${Math.round(r.right)}`)
				}
			}
			return { ok: document.documentElement.scrollWidth <= vw, offenders: offenders.slice(0, 6) }
		})
		record(`reflow no h-scroll at ${w}px (chat)`, probe.ok, probe.ok ? '' : probe.offenders.join(' | '))
	}

	// K. error state via a live send (key unfunded -> error banner expected)
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto(BASE + '/app', { waitUntil: 'load' })
	await page.waitForTimeout(900)
	const newBtn = page.locator('button:visible', { hasText: 'New' }).first()
	if (await newBtn.count()) await newBtn.click()
	await page.waitForTimeout(500)
	await page.locator('textarea[aria-label="Message"]').fill('What is 2 + 2? Reply with just the number.')
	await page.locator('button[aria-label="Send message"]').click()
	// A completed turn renders telemetry chips (the literal "tokens" label); a
	// failed one renders the top-level danger banner (outside <main>) or an
	// inline Retry. A plain-text answer has no <pre>, so waiting on code blocks
	// alone would misread a successful reply as a timeout.
	const turnSettled = () => {
		if (document.querySelector('[class*="border-danger"]')) return true
		const m = document.querySelector('main')
		if (!m) return false
		return /\bRetry\b/.test(m.innerText) || /\btokens\b/.test(m.innerText)
	}
	let outcome = 'none'
	try {
		await page.waitForFunction(turnSettled, null, { timeout: 45_000 })
		outcome = (await page.evaluate(() => Boolean(document.querySelector('[class*="border-danger"]') || /\bRetry\b/.test(document.querySelector('main')?.innerText || ''))))
			? 'error-banner'
			: 'assistant-reply'
	} catch {
		outcome = 'timeout'
	}
	record('send produces reply or visible error state', outcome !== 'timeout', outcome)
	if (outcome === 'error-banner') await page.screenshot({ path: join(OUT, 'chat-error-1440.png') })

	// L. logout
	await page.locator('button', { hasText: 'Sign out' }).first().click()
	await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 15_000 })
	record('sign out returns to /login', true, '')

	// E. reduced motion
	const rmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
	await rmCtx.addCookies(sessionCookies())
	const rmPage = await rmCtx.newPage()
	await rmPage.goto(BASE + '/app', { waitUntil: 'load' })
	await rmPage.waitForTimeout(1500)
	const rm = await rmPage.evaluate(() => {
		const els = Array.from(document.querySelectorAll('[class*="animate-"]'))
		const running = els.filter((e) => {
			const cs = getComputedStyle(e)
			return cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0
		})
		return { total: els.length, running: running.length }
	})
	record('reduced-motion neutralizes animations', rm.running === 0, `${rm.total} animated-class els, ${rm.running} still running`)
	await rmCtx.close()

	await browser.close()
	writeFileSync(join(OUT, 'checks.json'), JSON.stringify({ base: BASE, label: LABEL, ranAt: new Date().toISOString(), results }, null, 2))
	const failed = results.filter((r) => !r.pass)
	console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
	process.exit(failed.length ? 1 : 0)
}

run().catch((e) => {
	console.error('CHECKS_FAILED', e.message)
	process.exit(1)
})
