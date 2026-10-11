# Jev-Swarm design system

The visual and interaction language for Jev-Swarm. It is an **instrument panel**:
calm slate surfaces, a single signal accent, hairline rules, and every measured
number set in tabular monospace so telemetry reads like gauge output — the
product's whole claim is "real, fast, measured," so the UI looks like an
instrument, not a marketing page. On top of that sits a **cinematic interaction
layer** (pointer sheen, film grain, magnetic CTAs) for feel.
Nothing here is a stock gradient card.

Everything is expressed as tokens in `src/app/globals.css` and reusable
providers/primitives, so a new page (login, signup, settings…) inherits the whole
system by rendering inside the shell layout and composing `src/components/ui/*`.
See **Adding a page** at the end.

---

## 1. Color

Color lives as swappable CSS custom properties on `:root` (dawn) and
`[data-surface="dusk"]` (dusk), re-exposed to Tailwind via `@theme inline` so
utilities like `bg-surface` / `text-text-muted` resolve live. **Components never
hardcode hex** — they use the semantic utilities. The one sanctioned exception is
per-provider identity color (`MODELS[label].color` in `src/lib/models.ts`), which
must stay constant across themes to keep model identity stable.

| Token | Utility | Dawn | Dusk | Role |
| --- | --- | --- | --- | --- |
| `--bg` | `bg-bg` | `#fafafa` | `#0b0d11` | app background |
| `--surface` | `bg-surface` | `#ffffff` | `#14161b` | cards, header |
| `--surface-hover` | `bg-surface-hover` | `#f0f1f3` | `#1d2027` | hover / track fills |
| `--border` | `border-border` | `#e5e7eb` | `#282c34` | hairline rules |
| `--border-strong` | `border-border-strong` | `#cbd2db` | `#3a3f4a` | emphasis rules |
| `--text` | `text-text` | `#16181d` | `#f2f3f5` | primary text |
| `--text-muted` | `text-text-muted` | `#5b6472` | `#aeb6c2` | secondary text |
| `--text-faint` | `text-text-faint` | `#6b7482` | `#8b93a1` | tertiary text (AA on surface) |
| `--accent` | `bg-accent`/`text-accent` | `#2454b8` | `#6ea1ee` | the one signal color |
| `--accent-hover` | `hover:bg-accent-hover` | `#1c4292` | `#8fb7f3` | accent hover |
| `--accent-ink` | `text-accent-ink` | `#ffffff` | `#08111f` | text on accent |
| `--success` | `text-success` | `#1a7f4b` | `#35c37f` | ok / judge series |
| `--warning` | `text-warning` | `#a5580a` | `#e2a03f` | degraded / over-max |
| `--danger` | `text-danger` | `#b3261e` | `#e5675f` | errors |

Derived (not raw palette):
- `--ring-color` = accent mixed 55–60% toward transparent — used for the cursor
  ring and the sheen highlight so they tint with the theme automatically.
- `--sheen-opacity` / `--grain-opacity` — intensity of the pointer highlight and
  film grain per surface.

**Contrast:** `--text-faint` was raised from `#8891a0` (~3.2:1, failed AA for body
text) to `#6b7482` (~5.0:1). Keep any new faint text ≥ 4.5:1 on its surface.

### Theming mechanism

Three-state preference — `system` | `dawn` | `dusk` — persisted in `localStorage`
under `jev-theme`, applied as `<html data-surface="dawn|dusk">`.

- `src/components/theme/theme-store.ts` — the external store (read/write/subscribe
  + resolve). Snapshot is `"${preference}:${surface}"`.
- `theme-provider.tsx` — subscribes via `useSyncExternalStore` (hydration-safe),
  keeps `data-surface` in sync, exposes `useTheme()`.
- `theme-toggle.tsx` — accessible segmented control (`aria-pressed` per state,
  icon-only buttons carry their own `aria-label`).
- `NO_FOUC_SCRIPT` — inlined in `<head>` before first paint so the correct surface
  is on `<html>` immediately (no flash). `<html>` carries
  `suppressHydrationWarning` because that attribute is set pre-hydration by design.

There is **no `next-themes` dependency** and no `dark:` variant anywhere — because
components consume semantic tokens, swapping `data-surface` re-colors the entire
app with zero component changes. A `prefers-color-scheme` block remains as the
no-JS / pre-hydration fallback (an explicit `data-surface="dawn"` always wins).

---

## 2. Typography

A real pairing, self-hosted by `next/font` in `src/app/[locale]/layout.tsx`
(no runtime Google request, no layout shift). Each face exposes a `--font-*`
variable that `@theme` maps to a role token:

| Role | Token | Face | Use |
| --- | --- | --- | --- |
| Display | `--font-display` (`font-display`) | Space Grotesk | headings, big numbers, CTAs |
| Sans | `--font-sans` (`font-sans`, body default) | Inter | body, UI labels |
| Mono | `--font-mono` (`font-mono`) | IBM Plex Mono | code, any measured figure |

**`.font-numeric`** = mono + `tabular-nums` + `tnum`. Use it for *every* measured
number (latency, cost, tokens, percentages, chart values) so digits don't jitter
as values change. Don't hand-roll `font-mono tabular-nums` — use `.font-numeric`.

---

## 3. Motion

Motion tokens live on `:root`: durations `--motion-fast` 120ms, `--motion-base`
220ms, `--motion-slow` 420ms; easings `--ease-out-soft`,
`--ease-spring`, `--ease-in-out` (these generate `ease-*` utilities). Keyframes
defined once in `globals.css`: `route-pulse`, `gauge-sweep`, `bar-grow`,
`shimmer`, `fade-rise`.

### Interaction layer (`src/components/motion/`)

Mounted once in the shell layout, so every route inherits it:

- **`grain-overlay.tsx`** — fixed inline-SVG `feTurbulence` film grain, soft-light
  blended at `--grain-opacity`.
- **`sheen.tsx`** — pointer-follow specular highlight; sets `--mx/--my` on a panel
  and `.sheen::after` paints an accent radial. Apply to *hero* panels, not every
  card (each instance adds a pointermove listener).
- **`magnetic.tsx`** — eases a CTA toward the pointer and springs back on leave.
  Skipped for touch (`pointerType !== 'mouse'`).

> **No smooth-scroll library.** Every view is a fixed `h-dvh` shell whose content
> scrolls inside an inner `<main overflow-y-auto>` (sticky headers by design), so
> the document itself never scrolls. A root-level smooth-scroll interceptor
> (Lenis) was tried and **removed**: it `preventDefault`s wheel events globally and
> drives the *window*, which cannot scroll here, so the inner `<main>` never
> received the wheel and the page froze. Native scrolling on the inner container is
> the correct behavior — do not re-add a root scroll-interception library unless a
> view is converted to document-scroll.

### Non-negotiable guards

Every decorative motion is disabled under **both**:
- `prefers-reduced-motion: reduce` — component `motion-reduce:*` classes plus a
  global kill-switch in `globals.css`.
- **Coarse pointers (touch)** — the remaining pointer effects opt out on their
  own: `magnetic.tsx` ignores non-mouse pointers and `sheen.tsx` is hover-gated,
  so touch gets a still, calm UI with nothing chasing the finger.

When you add motion: use a token duration/easing (never a magic number), animate
only `transform`/`opacity`, and ship the `motion-reduce:` fallback in the same
edit.

---

## 4. Accessibility baseline

- **Icons** render `aria-hidden` (see `ui/icons.tsx`); an icon-only control labels
  the *control* (`aria-label`), never the glyph.
- **Charts** render the graphic `aria-hidden` and pair it with a visually-hidden
  `<table>` (`sr-only`) carrying the same real numbers, inside a labelled region.
- **Skip link** — first focusable in the shell, targets `#main-content` (each
  view's `<main id="main-content" tabIndex={-1}>`).
- **Focus** — `focus-visible` outline in `--accent` on every interactive control.
- **State** — `aria-current` on nav, `aria-pressed` on the theme toggle, `role` +
  `aria-value*` on the benchmark progress bar.
- **Contrast** — text ≥ 4.5:1 (AA); see the `--text-faint` note above.
- **Targets** — ≥ 24px (WCAG 2.2 AA); header controls are 32px.

---

## 5. Adding a page (the scalability contract)

A new route (e.g. `/login`, `/signup`) gets theming, fonts, grain,
and the skip link **for free** by rendering inside `src/app/[locale]/`.
To match the system:

1. Compose from `src/components/ui/*` (Button, Card, Input, Label, Badge…) — don't
   add a new dependency or a one-off control.
2. Use semantic color utilities and `.font-numeric` for numbers — never raw hex.
3. Wrap the primary CTA in `<Magnetic>` and, if it's a hero panel, `<Sheen>`.
4. Give the page `<main id="main-content" tabIndex={-1}>` so the skip link lands.
5. Guard any new motion with `motion-reduce:` and keep it off `pointer: coarse`.
6. Put the view link in `src/components/nav/view-nav.tsx` so it appears in the
   shell nav on every page.

If a change can't be expressed with the existing tokens/primitives, extend the
token set here first — don't fork the pattern inside one page.
