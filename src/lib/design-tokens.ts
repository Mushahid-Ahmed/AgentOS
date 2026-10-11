// Single source of the geometry shared by the WHOLE product: the marketing/auth
// surfaces (/, /login, /signup) and the in-app surfaces (chat, run view,
// dashboard). Both draw radii, control heights, focus rings, spacing and motion
// from here so the product reads as one system.
//
// Colours are NOT here — they live in globals.css. Since the UI/UX run (UX-D1)
// there is ONE dark system: a near-black immersive palette (single electric-blue
// accent) across all six surfaces, differentiated by intensity not by theme. The
// old light-editorial palette and the dark/light toggle are retired. The CSS
// radius/height values below are mirrored into globals.css @theme so Tailwind
// generates utilities; keep the two in sync.

export const RADIUS_PX = {
	sm: 6,
	control: 8,
	md: 10,
	lg: 16,
	xl: 24
} as const

export const CONTROL_HEIGHT_PX = {
	buttonSm: 36,
	button: 40,
	input: 44
} as const

// One focus treatment everywhere: a 2px ring offset 2px from the control.
// Light surfaces ring near-black, dark surfaces ring near-white, so the
// ring always clears its background by >= 3:1.
export const FOCUS_RING = {
	widthPx: 2,
	offsetPx: 2,
	light: 'rgba(20, 20, 20, 0.9)',
	dark: 'rgba(242, 243, 245, 0.9)'
} as const

// 4px-based spacing ramp used for section rhythm and component gaps.
export const SPACE_PX = [4, 8, 12, 16, 24, 32, 48, 64, 96] as const

// Type scale for the neo-grotesque display system (UX-D2). `display` is the
// landing hero headline (huge, heavy, tight negative tracking — the Lusion/
// DownBeat cadence); it steps down on mobile. In-app titles use h2/body/small.
export const TYPE_SCALE = {
	display: { sizePx: 88, lineHeight: 0.95, trackingEm: -0.04 },
	displayMobile: { sizePx: 44, lineHeight: 1.0, trackingEm: -0.03 },
	h2: { sizePx: 32, lineHeight: 1.1, trackingEm: -0.02 },
	body: { sizePx: 16, lineHeight: 1.6, trackingEm: 0 },
	small: { sizePx: 14, lineHeight: 1.5, trackingEm: 0 }
} as const

// Motion vocabulary. `door` backs the login/signup door swing on success;
// `scene` is the long scroll-scene/reveal duration (the signature expo-out).
// Every value here is neutralized under prefers-reduced-motion.
export const MOTION_MS = {
	fast: 120,
	base: 220,
	slow: 420,
	scene: 1200,
	door: 500
} as const

// Hairline weight for the illustration + dividers. Kept at 1 CSS px so
// borders stay crisp at 1x/2x/3x DPR (brief 15.6).
export const HAIRLINE_PX = 1
