import type { ReactNode } from 'react'
import { Link } from '@/i18n/routing'

// Shared shell for every "something went wrong" screen (error.tsx,
// not-found.tsx) so the copy/actions differ but the layout, spacing, and
// tone don't drift between them. global-error.tsx can't use this — it may
// render before globals.css loads, so it duplicates a minimal inline-styled
// version instead (see the comment there). Never render error.message or
// a raw error object here — only copy written for the person reading it
// (see docs/rules/error-handling.md).
//
// Take 3 M6: this screen IS an app surface, so it carries the same identity as
// Dashboard/Chat/AgentOS — the `.app-aurora` field, the `.label-uppercase`
// eyebrow, the grotesque display voice, and the `.panel-in` mount stagger with
// its `--i` ramp. It used to be a bare centred card, which made a wrong URL or
// a render failure look like a different product.
//
// It is not wrapped in AppHeader/ViewNav on purpose: a boundary can replace a
// page while the app's own data providers are the thing that failed, so this
// shell stays dependency-free (one exception: `Link`, which needs only the
// locale provider that the [locale] layout keeps rendering around it).
const VIEWS = [
	{ href: '/app', label: 'Chat' },
	{ href: '/dashboard', label: 'Dashboard' },
	{ href: '/agentos', label: 'AgentOS' }
] as const

export function ErrorPage({
	code,
	kicker,
	title,
	description,
	digest,
	action,
	inline
}: {
	// Decorative-but-real status numeral, e.g. '404'. Omit when there is no
	// truthful number to show — a client render error is not a status code.
	code?: string
	kicker: string
	title: string
	description: string
	digest?: string
	action?: ReactNode
	// Section-scope: render just the card, for the subtree boundary in
	// `error-boundary.tsx` that replaces one widget inside a page that already
	// owns the <main> and the viewport. Without this, a component-level fallback
	// would nest a second <main> and take the full screen.
	inline?: boolean
}) {
	const card = (
		<div
			className="border-border bg-surface panel-in relative flex w-full max-w-md flex-col items-center gap-4 rounded-lg border p-8 text-center"
			style={{ '--i': 1 } as React.CSSProperties}
		>
			<p className="label-uppercase text-text-faint">{kicker}</p>
			<h1 className="hero-editorial text-text">{title}</h1>
			<p className="text-text-muted text-sm leading-relaxed">{description}</p>
			{action}
			{digest && (
				<p className="text-text-faint font-numeric text-xs">
					Reference: <code>{digest}</code>
				</p>
			)}
		</div>
	)

	if (inline) return card

	return (
		// <main> carries only the identity the layout's skip link needs. The clip
		// lives one level down, exactly as on the dashboard and run view: a section
		// owns its own aurora and hides it. If <main> were the clipper instead, the
		// lobes (inset -10% sideways) would still count toward `main`'s scrollWidth,
		// and the overflow check that catches real breakouts would be permanently
		// noisy on the one page nobody expects to overflow.
		<main id="main-content" tabIndex={-1} className="bg-bg text-text flex min-h-dvh flex-col">
			<div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-16">
				<div className="app-aurora" aria-hidden="true" />

				{code ? (
					<p
						// The landing's biggest display voice, at 25% accent so it reads as
						// ambience rather than competing with the h1 for the page's meaning.
						// Deliberately NOT `font-numeric`: both `.display-huge` and
						// `.font-numeric` set `font-family` at the same specificity, so the
						// winner is decided by stylesheet order and the mono face silently
						// loses — measured, not assumed (browser reported Inter).
						className="display-huge text-accent/25 panel-in relative select-none"
						// The digits are duplicated by the eyebrow copy for assistive tech
						// that would otherwise read a bare "404" as a quantity.
						aria-hidden="true"
						style={{ '--i': 0 } as React.CSSProperties}
					>
						{code}
					</p>
				) : null}

				{card}

				<nav
					aria-label="Product views"
					className="panel-in relative mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
					style={{ '--i': 2 } as React.CSSProperties}
				>
					{VIEWS.map((view) => (
						<Link
							key={view.href}
							href={view.href}
							className="text-text-muted hover:text-text focus-visible:outline-accent text-sm font-medium underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2"
						>
							{view.label}
						</Link>
					))}
				</nav>
			</div>
		</main>
	)
}
