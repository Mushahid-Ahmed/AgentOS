'use client'

import { useState, type CSSProperties, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { Link, useRouter } from '@/i18n/routing'
import { cn } from '@/lib/cn'
import { MOTION_MS } from '@/lib/design-tokens'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'
import { provisionCurrentUser } from '@/server/auth/session-actions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DoorIllustration } from '@/components/marketing/door-illustration'
import { MarketingShell } from '@/components/marketing/marketing-shell'
import { useReducedMotion } from '@/lib/motion/use-reduced-motion'
import { RippleLayer } from '@/components/motion/ripple'

// Email/password sign-in and sign-up on the same dark system as the landing
// (UI/UX run M5, brief 15.3). Supabase owns the session (docs/rules/auth.md);
// the browser client here is auth-only, so there is no path to application data
// from the client. Strings are hardcoded English, matching the rest of the app
// until the i18n pass. Validation and redirect-safety rules live in
// @/lib/auth-form-rules (unit-tested) — this file is paint + wiring only.
//
// Take 2 (§7.2) adds the motion: a staggered entrance that slides in from the
// side the user came from, focus glow + underline draw on the fields, a lifting
// CTA with a click ripple, one short shake on a failed submit, and a checkmark
// that draws itself while the door swings open. Auth logic is untouched.
import {
	loginFailureMessage,
	safeNext,
	signupFailureMessage,
	validateEmail,
	validatePassword
} from '@/lib/auth-form-rules'

type Mode = 'login' | 'signup'
type FieldErrors = { email?: string; password?: string }

const inputClasses =
	'border-border bg-bg text-text placeholder:text-text-faint hover:border-border-strong focus-visible:outline-accent field-input h-11 w-full rounded-control border px-3.5 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2'

// One entrance step: opacity + a short slide, staggered by index, so the whole
// card reads as one surface arriving rather than eight independent fades. The
// animation lives in CSS (.auth-rise) — all this carries is how far in from the
// side the step starts and when it begins, which is why no `shown`/`reduced`
// flag has to reach render: the first painted frame is already the start state
// and the reduced-motion guard settles it on the spot.
function Rise({
	step,
	x,
	className,
	children
}: {
	step: number
	x: number
	className?: string
	children: React.ReactNode
}) {
	return (
		<div
			data-t2-m5="rise"
			className={cn('auth-rise', className)}
			style={
				{
					'--rise-x': `${(x * (1 + step * 0.12)).toFixed(1)}px`,
					animationDelay: `${step * 60}ms`
				} as CSSProperties
			}
		>
			{children}
		</div>
	)
}

export function AuthForm({ mode }: { mode: Mode }) {
	const router = useRouter()
	const searchParams = useSearchParams()
	const reduced = useReducedMotion()
	const isSignup = mode === 'signup'

	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
	const [submitting, setSubmitting] = useState(false)
	const [succeeded, setSucceeded] = useState(false)
	const [door, setDoor] = useState<'closed' | 'nudge' | 'open'>('closed')
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [shake, setShake] = useState(false)

	// The pair enters from opposite sides (§7.2-8), which is the only cue that
	// distinguishes the two routes visually.
	const dir = isSignup ? 22 : -22

	const fail = () => {
		if (reduced) return
		setShake(false)
		requestAnimationFrame(() => setShake(true))
	}

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (submitting) return

		const nextErrors: FieldErrors = {
			email: validateEmail(email),
			password: validatePassword(password, isSignup)
		}
		setFieldErrors(nextErrors)
		if (nextErrors.email || nextErrors.password) {
			fail()
			return
		}

		setError(null)
		setNotice(null)
		setSubmitting(true)

		const supabase = createBrowserSupabaseClient()
		const { error: authError, data } = isSignup
			? await supabase.auth.signUp({
					email,
					password,
					options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
				})
			: await supabase.auth.signInWithPassword({ email, password })

		if (authError) {
			setError(isSignup ? signupFailureMessage(authError.message) : loginFailureMessage())
			setSubmitting(false)
			fail()
			return
		}

		// Sign-up with email confirmation ON returns no session yet — the user must
		// click the link in their inbox, which lands on /auth/callback. Tell them so
		// instead of silently doing nothing.
		if (isSignup && !data.session) {
			setNotice('Check your email to confirm your account, then sign in.')
			setSubmitting(false)
			return
		}

		// Session exists (login, or sign-up with confirmation off). Provision the
		// User row server-side as a best effort, then always continue — a failed
		// upsert must never strand the user on the form (the session is already
		// valid, and provisioning is retried on the next sign-in).
		try {
			await provisionCurrentUser()
		} catch {
			// Non-fatal: proceed to the redirect regardless.
		}

		// Small delight: the door swings open before we leave. Skipped entirely
		// (instant redirect) for reduced-motion users, and never longer than the
		// one swing.
		setSucceeded(true)
		if (!reduced) {
			setDoor('open')
			await new Promise((resolve) => setTimeout(resolve, MOTION_MS.door))
		}
		router.replace(safeNext(searchParams.get('next')))
		router.refresh()
	}

	return (
		<MarketingShell
			brand={
				<Link
					href="/"
					className="font-display text-text focus-visible:outline-accent inline-flex min-h-11 items-center text-[19px] leading-none font-semibold tracking-tight no-underline focus-visible:outline-2 focus-visible:outline-offset-4"
				>
					AgentOS
				</Link>
			}
			topRight={
				// Same pairing as the landing nav, keyed on the destination: Sign up is
				// the accent pill, Login the outline.
				<Button
					asChild
					variant={isSignup ? 'outline' : 'primary'}
					size="controlSm"
					className="auth-cta"
				>
					<Link href={isSignup ? '/login' : '/signup'}>{isSignup ? 'Login' : 'Sign up'}</Link>
				</Button>
			}
		>
			<div
				data-t2-m5="stage"
				className="auth-stage relative flex flex-1 flex-col items-center justify-center px-6 pt-2 pb-16"
			>
				{/* §7.2-8: the pair slides in from opposite sides, so switching between
				    them reads as one surface moving rather than a page swap. */}
				<Rise step={0} x={dir}>
					<div className="door-stage">
						<DoorIllustration
							open={isSignup ? 'wide' : 'ajar'}
							className={cn(
								'h-[150px] w-[170px] transition-transform ease-out',
								door === 'nudge' && 'door-nudge duration-300',
								door === 'open' && 'door-swing duration-500'
							)}
						/>
					</div>
				</Rise>

				<Rise step={1} x={dir}>
					<h1 className="hero-editorial text-text mt-1">
						{isSignup ? 'Create your account' : 'Welcome back'}
					</h1>
				</Rise>
				<Rise step={2} x={dir}>
					<p className="text-text-muted mt-3 text-[15px] leading-[1.55]">
						{isSignup
							? 'Sign up with your email to start using AgentOS.'
							: 'Sign in to continue to AgentOS.'}
					</p>
				</Rise>

				<form
					onSubmit={onSubmit}
					noValidate
					className={cn(
						'relative mt-8 flex w-full max-w-[380px] flex-col gap-4',
						shake && 'auth-shake'
					)}
					onAnimationEnd={(e) => {
						if (e.animationName === 'auth-shake') setShake(false)
					}}
				>
					<Rise step={3} x={dir}>
						<div className="field-shell flex flex-col gap-1.5">
							<Label htmlFor="email" className="text-text-muted text-[13px] font-medium">
								Email
							</Label>
							<div className="relative">
								<input
									id="email"
									name="email"
									type="email"
									autoComplete="email"
									autoFocus
									required
									aria-invalid={fieldErrors.email ? true : undefined}
									aria-describedby={fieldErrors.email ? 'email-error' : undefined}
									className={cn(inputClasses, fieldErrors.email && 'border-danger')}
									value={email}
									onChange={(e) => {
										setEmail(e.target.value)
										if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }))
									}}
									onBlur={() => setFieldErrors((f) => ({ ...f, email: validateEmail(email) }))}
									placeholder="you@example.com"
								/>
								<span aria-hidden className="field-underline" />
							</div>
							{fieldErrors.email ? (
								<p id="email-error" role="alert" className="text-danger text-[13px]">
									{fieldErrors.email}
								</p>
							) : null}
						</div>
					</Rise>

					<Rise step={4} x={dir}>
						<div className="field-shell flex flex-col gap-1.5">
							<Label htmlFor="password" className="text-text-muted text-[13px] font-medium">
								Password
							</Label>
							<div className="relative">
								<input
									id="password"
									name="password"
									type={showPassword ? 'text' : 'password'}
									autoComplete={isSignup ? 'new-password' : 'current-password'}
									required
									minLength={isSignup ? 8 : undefined}
									aria-invalid={fieldErrors.password ? true : undefined}
									aria-describedby={fieldErrors.password ? 'password-error' : undefined}
									className={cn(inputClasses, 'pr-11', fieldErrors.password && 'border-danger')}
									value={password}
									onChange={(e) => {
										setPassword(e.target.value)
										if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }))
									}}
									onBlur={() =>
										setFieldErrors((f) => ({
											...f,
											password: validatePassword(password, isSignup)
										}))
									}
									placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
								/>
								<span aria-hidden className="field-underline" />
								<button
									type="button"
									onClick={() => setShowPassword((v) => !v)}
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									className="text-text-faint hover:text-text focus-visible:outline-accent rounded-control absolute top-0 right-0 grid h-11 w-11 place-items-center text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
								>
									{showPassword ? 'Hide' : 'Show'}
								</button>
							</div>
							{fieldErrors.password ? (
								<p id="password-error" role="alert" className="text-danger text-[13px]">
									{fieldErrors.password}
								</p>
							) : null}
						</div>
					</Rise>

					{/* One live region for both failure and success messaging. */}
					<div aria-live="polite">
						{error ? (
							<p role="alert" className="text-danger text-[13px]">
								{error}{' '}
								<button
									type="submit"
									className="text-accent hover:text-accent-hover px-1 py-1 underline underline-offset-2 disabled:opacity-50"
									disabled={submitting}
								>
									Try again
								</button>
							</p>
						) : null}
						{notice ? (
							<p role="status" className="text-text-muted flex items-center gap-2 text-[13px]">
								<span className="auth-check inline-flex">
									<svg viewBox="0 0 24 24" className="size-4" aria-hidden>
										<circle
											cx="12"
											cy="12"
											r="10.5"
											fill="none"
											stroke="var(--accent)"
											strokeOpacity="0.45"
											strokeWidth="1"
										/>
										<path
											d="M7.5 12.5l3 3 6-6.5"
											fill="none"
											stroke="var(--accent)"
											strokeWidth="1.8"
											strokeLinecap="round"
											strokeLinejoin="round"
											pathLength={1}
										/>
									</svg>
								</span>
								{notice}
							</p>
						) : null}
					</div>

					<Rise step={5} x={dir}>
						<Button
							type="submit"
							variant="primary"
							size="control"
							disabled={submitting}
							className="auth-cta mt-1 w-full"
							onMouseEnter={() => setDoor('nudge')}
							onMouseLeave={() => {
								if (!succeeded) setDoor('closed')
							}}
						>
							<RippleLayer />
							{submitting
								? succeeded
									? 'Opening the door…'
									: 'Please wait…'
								: isSignup
									? 'Create account'
									: 'Sign in'}
						</Button>
					</Rise>

					{/* §7.2-7: the check draws itself over the form while the door swings.
					    Decorative — the button label and the live region already say it. */}
					{succeeded ? (
						<div
							data-t2-m5="check"
							aria-hidden
							className="auth-check bg-bg/70 absolute inset-0 z-20 grid place-items-center rounded-xl"
						>
							<svg viewBox="0 0 64 64" className="size-20">
								<circle
									className="auth-check-ring"
									cx="32"
									cy="32"
									r="27"
									fill="none"
									stroke="var(--accent)"
									strokeOpacity="0.5"
									strokeWidth="1.5"
								/>
								<path
									d="M19 33l9 9 17-19"
									fill="none"
									stroke="var(--accent)"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
									pathLength={1}
								/>
							</svg>
						</div>
					) : null}
				</form>

				<Rise step={6} x={dir}>
					<p className="text-text-muted mt-6 text-center text-[14px]">
						{isSignup ? (
							<>
								Already have an account?{' '}
								<Link
									href="/login"
									className="text-accent hover:text-accent-hover px-1 py-1.5 underline underline-offset-2"
								>
									Log in
								</Link>
							</>
						) : (
							<>
								Don’t have an account?{' '}
								<Link
									href="/signup"
									className="text-accent hover:text-accent-hover px-1 py-1.5 underline underline-offset-2"
								>
									Sign up
								</Link>
							</>
						)}
					</p>
				</Rise>
			</div>
		</MarketingShell>
	)
}
