// Pure validation + redirect-safety rules for the email/password form, split out
// of auth-form.tsx so they are unit-testable without rendering React.

// Only ever redirect to a same-origin relative path. Rejects protocol-relative
// ("//evil.com") and backslash tricks so the ?next= param can't be used for an
// open redirect.
export function safeNext(value: string | null): string {
	if (!value) return '/'
	if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
	return value
}

export function validateEmail(value: string): string | undefined {
	if (!value.trim()) return 'Enter your email address.'
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'That doesn’t look like a valid email address.'
	return undefined
}

export function validatePassword(value: string, isSignup: boolean): string | undefined {
	if (!value) return 'Enter your password.'
	if (isSignup && value.length < 8) return 'Use at least 8 characters.'
	return undefined
}

// Plain-language, and never reveals whether an email exists on login.
export function loginFailureMessage(): string {
	return 'We couldn’t sign you in with that email and password.'
}

export function signupFailureMessage(raw: string): string {
	if (/already registered|already been registered/i.test(raw)) {
		return 'An account with that email already exists. Try signing in instead.'
	}
	if (/rate limit/i.test(raw)) return 'Too many attempts. Wait a couple of minutes and try again.'
	if (/password/i.test(raw) && /short|weak|least/i.test(raw)) return 'Use at least 8 characters.'
	if (/invalid email|email address/i.test(raw)) return 'That doesn’t look like a valid email address.'
	return raw
}
