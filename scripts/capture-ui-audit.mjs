// UI-audit screenshot harness (UIUX M10). Captures every audited screen at
// 1440 and 390 CSS px against a given base URL, into docs/ui-audit/<label>/.
//
// Sign-in reuses the live demo session: the browser relays its own auth cookie
// to a local collector (_scratch/live-session.json, untracked) so this harness
// never needs the demo password and the token never reaches logs or stdout.

// Usage: node scripts/capture-ui-audit.mjs --base http://localhost:3000 --label after
//        node scripts/capture-ui-audit.mjs --base http://localhost:3000 --label after --public-only

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`)
	return i === -1 ? fallback : process.argv[i + 1]
}

const BASE = arg('base', 'http://localhost:3000')
const LABEL = arg('label', 'after')
const OUT = join(ROOT, 'docs', 'ui-audit', LABEL)
const WIDTHS = [
	{ width: 1440, height: 900 },
	{ width: 390, height: 844 }
]

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

const manifest = []
const consoleErrors = []

async function shoot(page, name, width, opts = {}) {
	const file = join(OUT, `${name}-${width.width}.png`)
	await page.screenshot({ path: file, fullPage: opts.fullPage ?? false })
	manifest.push({ name, width: width.width, file: `docs/ui-audit/${LABEL}/${name}-${width.width}.png`, url: page.url() })
	console.log(`  shot ${name} @${width.width}`)
}

async function settle(page, ms = 700) {
	await page.evaluate(() => document.fonts.ready)
	await page.waitForTimeout(ms)
}

async function openSidebarIfMobile(page, width) {
	if (width.width >= 768) return
	if (await page.locator('div.fixed.inset-0.z-40.md\\:hidden').count()) return
	const toggle = page.locator('button[aria-label="Open conversation history"]')
	if (await toggle.count()) await toggle.first().click()
	await page.waitForTimeout(300)
}

async function closeSidebarIfMobile(page, width) {
	if (width.width >= 768) return
	const scrim = page.locator('div.fixed.inset-0.z-40.md\\:hidden > div[aria-hidden="true"]')
	if (await scrim.count()) await scrim.first().click({ force: true })
	await page.waitForTimeout(300)
}

async function waitHistorySettled(page) {
	await page
		.waitForFunction(() => !document.body.innerText.includes('Loading history'), null, { timeout: 8000 })
		.catch(() => {})
}

async function run() {
	mkdirSync(OUT, { recursive: true })
	console.log(`base=${BASE} label=${LABEL}`)

	const browser = await chromium.launch({ channel: 'chrome', headless: true })

	// ---- logged-out surfaces -------------------------------------------------
	for (const width of WIDTHS) {
		const ctx = await browser.newContext({ viewport: width })
		const page = await ctx.newPage()
		page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`[anon ${width.width}] ${m.text()}`))
		for (const [name, path, full] of [
			['landing', '/', true],
			['login', '/login', true],
			['signup', '/signup', true]
		]) {
			await page.goto(BASE + path, { waitUntil: 'load' })
			await settle(page)
			await shoot(page, name, width, { fullPage: full })
		}
		// Protected-route redirect, logged out.
		await page.goto(BASE + '/app', { waitUntil: 'load' })
		await settle(page, 400)
		const landed = new URL(page.url()).pathname
		manifest.push({ name: 'protected-redirect', width: width.width, url: page.url(), redirected: landed.includes('login') })
		console.log(`  protected /app -> ${landed} (expect /login)`)
		await shoot(page, 'protected-redirect', width)
		await ctx.close()
	}

	// --public-only: capture just the logged-out surfaces (landing/login/signup/
	// protected-redirect). Used to refresh those shots when no live session is
	// available for the authenticated surfaces.
	if (process.argv.includes('--public-only')) {
		await browser.close()
		writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ base: BASE, label: LABEL, capturedAt: new Date().toISOString(), consoleErrors, manifest }, null, 2))
		console.log(`DONE ${manifest.length} captures (public only) -> ${OUT}`)
		return
	}

	// ---- authenticated surfaces ---------------------------------------------
	const ctx = await browser.newContext({ viewport: WIDTHS[0] })
	await ctx.addCookies(sessionCookies())
	const page = await ctx.newPage()
	page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`[auth] ${m.text()}`))
	await page.goto(BASE + '/app', { waitUntil: 'load' })
	await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 30_000 })
	await settle(page)
	console.log('  session cookie sign-in ok')

	for (const width of WIDTHS) {
		await page.setViewportSize(width)
		await settle(page, 400)

		await page.goto(BASE + '/app', { waitUntil: 'load' })
		await settle(page)
		await waitHistorySettled(page)
		await shoot(page, 'chat', width)

		// A persisted conversation that contains an inline code block.
		await openSidebarIfMobile(page, width)
		const items = page.locator('li button:visible:not([aria-label^="Delete"])')
		const n = Math.min(await items.count(), 8)
		let codeFound = false
		for (let i = 0; i < n; i++) {
			await items.nth(i).click()
			await page.waitForTimeout(800)
			if (await page.locator('main pre').count()) {
				codeFound = true
				break
			}
		}
		await closeSidebarIfMobile(page, width)
		if (codeFound) {
			await settle(page, 400)
			await shoot(page, 'chat-code', width)
		} else {
			console.log('  note: no persisted conversation with a code block found')
		}

		// Fresh-thread empty state.
		await openSidebarIfMobile(page, width)
		const newBtn = page.locator('button:visible').filter({ hasText: 'New' }).first()
		if (await newBtn.count()) {
			await newBtn.click()
			await settle(page, 400)
			await shoot(page, 'chat-empty', width)
		}

		await page.goto(BASE + '/dashboard', { waitUntil: 'load' })
		await settle(page)
		await shoot(page, 'dashboard', width, { fullPage: true })

		await page.goto(BASE + '/agentos', { waitUntil: 'load' })
		await settle(page)
		await shoot(page, 'runview', width)

		await page.waitForSelector('aside[aria-label="Run replay"] button', { timeout: 15_000 }).catch(() => {})
		const completed = page.locator('aside[aria-label="Run replay"] button:visible').filter({ hasText: 'completed' })
		const runRows = page.locator('aside[aria-label="Run replay"] button:visible').filter({ hasText: /#\d+/ })
		const pick = (await completed.count()) ? completed.first() : runRows.first()
		if (await runRows.count()) {
			await pick.click()
			await settle(page, 1500)
			await shoot(page, 'replay', width)
			if (await page.locator('main pre').count()) await shoot(page, 'runview-code', width)
		} else {
			console.log('  note: no replayable run in picker')
		}

		await page.goto(BASE + '/this-route-does-not-exist', { waitUntil: 'load' })
		await settle(page, 400)
		await shoot(page, 'notfound', width, { fullPage: true })
	}

	await browser.close()
	writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ base: BASE, label: LABEL, capturedAt: new Date().toISOString(), consoleErrors, manifest }, null, 2))
	console.log(`DONE ${manifest.length} captures -> ${OUT}`)
	if (consoleErrors.length) console.log(`console errors: ${consoleErrors.length}`)
}

run().catch((e) => {
	console.error('CAPTURE_FAILED', e.message)
	process.exit(1)
})
