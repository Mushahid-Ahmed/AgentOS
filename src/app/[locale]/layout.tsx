import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { notFound } from 'next/navigation'
import { IBM_Plex_Mono, Inter } from 'next/font/google'
import { routing } from '@/i18n/routing'
import { QueryProvider } from '@/components/query-provider'
import { AnalyticsProvider } from '@/lib/analytics/analytics-provider'
import { GrainOverlay } from '@/components/motion/grain-overlay'
import { MotionProvider } from '@/components/motion/motion-provider'
import { Toaster } from '@/components/ui/toaster'
import '../globals.css'

// Real type pairing, self-hosted by next/font (no runtime Google request, no
// layout shift). ONE neo-grotesque family (Inter, variable 100-900) is the
// display AND text face for the whole site; IBM Plex Mono is the mono face for
// terminal/code/measured numbers. The former editorial serif (EB Garamond) is
// retired (UI/UX run UX-D2): the owner re-aimed the look at the Lusion/DownBeat
// neo-grotesque character. Each exposes a --font-* variable that globals.css
// @theme reads to build --font-sans / --font-mono / --font-display.
const sans = Inter({
	subsets: ['latin'],
	variable: '--font-inter',
	display: 'swap'
})
// IBM Plex Mono ships static faces, so weights must be listed explicitly.
const mono = IBM_Plex_Mono({
	subsets: ['latin'],
	weight: ['400', '500', '600'],
	variable: '--font-ibm-plex-mono',
	display: 'swap'
})

export const metadata: Metadata = {
	title: 'AgentOS',
	description:
		'A multi-model chat workspace where a sub-second router (Jev) picks the best-fit model per query, with real routing telemetry and a Jev-vs-judge benchmark dashboard.'
}

export const viewport: Viewport = {
	// One dark system across all six surfaces (UX-D1), so the browser chrome is
	// pinned to dark instead of advertising a light scheme that no longer exists.
	colorScheme: 'dark',
	themeColor: '#0a0a0b'
}

export default async function LocaleLayout({
	children,
	params
}: {
	children: React.ReactNode
	params: Promise<{ locale: string }>
}) {
	const { locale } = await params
	if (!hasLocale(routing.locales, locale)) {
		notFound()
	}

	return (
		<html lang={locale} className={`${sans.variable} ${mono.variable}`}>
			<body>
				{/* Keyboard users skip straight to the content on first Tab. Parked
				    off-screen with a transform rather than `sr-only`: a 1px clipped box
				    reads as "not focusable" to automated a11y audits, and the slide-in
				    keeps it visibly anchored the moment it takes focus. */}
				<a
					href="#main-content"
					className="ease-expo focus:bg-accent focus:text-accent-ink fixed top-4 left-4 z-70 -translate-y-[200%] rounded px-4 py-2 transition-transform duration-[var(--motion-base)] focus:translate-y-0 focus:outline focus:outline-2"
				>
					Skip to content
				</a>
				<AnalyticsProvider />
				<MotionProvider>
					<NextIntlClientProvider>
						<QueryProvider>{children}</QueryProvider>
					</NextIntlClientProvider>
				</MotionProvider>
				<Toaster />
				{/* Shell-level ambience: a fixed grain overlay every route inherits. */}
				<GrainOverlay />
			</body>
		</html>
	)
}
