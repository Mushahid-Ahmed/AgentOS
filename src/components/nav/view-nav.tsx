'use client'
import { Link, usePathname } from '@/i18n/routing'
import { SignOutButton } from '@/components/nav/sign-out-button'
import { cn } from '@/lib/cn'

// View switcher between the three product views: the chat workspace, the executive
// dashboard, and the AgentOS run view (D6). Uses the locale-aware Link/usePathname
// from @/i18n/routing (NOT next/navigation) so the locale prefix is preserved —
// localePrefix is 'as-needed', so the canonical product paths are '/app',
// '/dashboard', '/agentos' — '/' is the public marketing landing.
// Mounted in every view header so any can reach the others.

const VIEWS = [
	{ href: '/app', label: 'Chat', isActive: (pathname: string) => pathname === '/app' },
	{
		href: '/dashboard',
		label: 'Dashboard',
		isActive: (pathname: string) => pathname.startsWith('/dashboard')
	},
	{
		href: '/agentos',
		label: 'AgentOS',
		isActive: (pathname: string) => pathname.startsWith('/agentos')
	}
]

export function ViewNav({ className }: { className?: string }) {
	const pathname = usePathname()
	return (
		<div className={cn('flex flex-wrap items-center gap-2', className)}>
			<nav aria-label="Views" className="flex flex-wrap items-center gap-1">
				{VIEWS.map((view) => {
					const active = view.isActive(pathname)
					return (
						<Link
							key={view.href}
							href={view.href}
							aria-current={active ? 'page' : undefined}
							className={cn(
								'focus-visible:outline-accent rounded-control px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2',
								'max-md:inline-flex max-md:min-h-11 max-md:items-center',
								active
									? 'bg-surface-hover text-text'
									: 'text-text-muted hover:bg-surface-hover hover:text-text'
							)}
						>
							{view.label}
						</Link>
					)
				})}
			</nav>
			<SignOutButton />
		</div>
	)
}
