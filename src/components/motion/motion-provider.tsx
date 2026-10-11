'use client'
import { SmoothScrollProvider } from '@/components/motion/smooth-scroll-provider'

// Composes the site-wide motion foundation: the Lenis+ScrollTrigger smooth-scroll
// engine. Mounted once in the locale layout so every surface inherits it; it
// no-ops under reduced motion / touch.
export function MotionProvider({ children }: { children: React.ReactNode }) {
	return <SmoothScrollProvider>{children}</SmoothScrollProvider>
}
