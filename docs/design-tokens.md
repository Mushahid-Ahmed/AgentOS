# Design tokens — Phase 0 audit extract

Source of truth: the **real code** (`src/app/globals.css`, `src/lib/design-tokens.ts`,
`src/app/[locale]/layout.tsx`, `src/components/marketing/*`, `src/components/auth/auth-form.tsx`)
and the two attached screenshots (landing + `/login`). Nothing here is invented; every value
is quoted from a file with a line reference.

The product currently ships **two disjoint token sets**, which is the root of the style break:

- **A. Marketing/auth (light editorial)** — static `@theme` colours, EB Garamond serif. Used by
  `/`, `/login`, `/signup`. This is the reference language the brief wants everywhere.
- **B. In-app (swappable dawn/dusk)** — `:root` / `[data-surface]` colours, a **blue `--accent`
  (#2454b8)**, Inter + IBM Plex Mono. Used by `/app` (chat), `/dashboard`, `/agentos`, error/404.

---

## A. Marketing / auth tokens (the target language)

### Colour (`globals.css` `@theme`, lines 32–38 — static, never theme-swapped)
| Token | Value | Role |
|---|---|---|
| `--color-paper` | `#f7f8fa` | page canvas |
| `--color-paper-card` | `#eef0f2` | subtle surface / hover fill |
| `--color-ink` | `#141414` | near-black primary text + solid primary button |
| `--color-ink-soft` | `#3d4349` | softened ink (button hover) |
| `--color-sub` | `#5b6472` | secondary/gray text (~5.0:1 on paper — AA) |
| `--color-hairline` | `#e4e7ea` | 1px borders + dividers |
| input bg | `#ffffff` (`bg-white`, auth-form.tsx:32) | field fill |

No gradients, no glows, no shadows on these surfaces. Semantic colour (danger) appears only as a
1px `border-danger` on an invalid field (auth-form.tsx:162).

### Typography
| Face | Family | Where | Sizes seen |
|---|---|---|---|
| Serif (headings) | **EB Garamond** (`--font-eb-garamond`, weights 400/500/600; `font-serif`) | landing H1/H2, auth H1, brand | H1 44px/1.12/-0.015em (desktop), 32px/1.15/-0.01em (mobile); auth H1 30px/1.15; section H2 19px/1.25; brand 19px |
| Sans (body/UI) | **Inter** (`--font-inter`; `font-sans`, `body` default) | body copy, labels, inputs | body 16px/1.6; small 14px/1.55; auth body 15px/1.55; label 13px |

`display: 'swap'`, self-hosted by `next/font`, size-adjusted fallback → no layout shift.

### Geometry (`design-tokens.ts`, mirrored into `globals.css` `@theme` lines 21–25)
| Token | Value |
|---|---|
| `RADIUS_PX` | sm 6 · control 8 · md 10 · lg 16 · xl 24 |
| `CONTROL_HEIGHT_PX` | buttonSm 36 · button 40 · input 44 |
| `FOCUS_RING` | 2px, offset 2px, light `rgba(20,20,20,0.9)` |
| `SPACE_PX` | 4·8·12·16·24·32·48·64·96 |
| `HAIRLINE_PX` | 1 |
| `TYPE_SCALE` | display 44/1.12/-0.015 · displayMobile 32/1.15/-0.01 · h2 28/1.2/-0.01 · body 16/1.6 · small 14/1.5 |

### Buttons (`button.tsx` marketing variants)
- `ink` (primary): `rounded-control bg-ink text-paper hover:bg-ink-soft` — near-black solid, 8px radius.
- `inkOutline` (secondary): `rounded-control border border-hairline bg-paper text-ink hover:bg-paper-card`
  + a small `<ArrowRightIcon className="size-3.5">` (landing.tsx:74–77).
- Control sizes: `control` h-11 px-5 (→ sm:h-10); `controlSm` h-11 px-4 (→ sm:h-9). 44px touch min below `sm`.

### Inputs (`auth-form.tsx:31–32`)
`border-hairline text-ink placeholder:text-sub h-11 w-full rounded-control border bg-white px-3.5 text-[15px]
focus-visible:outline-ink focus-visible:outline-2 focus-visible:outline-offset-2 transition-shadow`
— 1px hairline border, 8px radius, 44px height, **near-black focus ring** (not blue).

### Illustration
Line-art monochrome **door** (`door-illustration.tsx`, original SVG): near-black interior (`#0c0d10`),
white stars, `twinkle` + door-swing motion. Reused on landing (ajar, 240×270) and auth (ajar/wide, 150×170).

---

## B. In-app tokens (current — to be reconciled onto A)

### Colour (`globals.css` `:root` dawn 61–84 / `[data-surface='dusk']` 90–110)
| Token | dawn | dusk | Note |
|---|---|---|---|
| `--bg` | `#fafafa` | `#0b0d11` | |
| `--surface` | `#ffffff` | `#14161b` | |
| `--surface-hover` | `#f0f1f3` | `#1d2027` | |
| `--border` | `#e5e7eb` | `#282c34` | |
| `--border-strong` | `#cbd2db` | `#3a3f4a` | |
| `--text` | `#16181d` | `#f2f3f5` | |
| `--text-muted` | `#5b6472` | `#aeb6c2` | |
| `--text-faint` | `#6b7482` | `#8b93a1` | bumped for AA |
| **`--accent`** | **`#2454b8`** | **`#6ea1ee`** | **BLUE — primary buttons, user chat bubble, charts, progress, links, theme toggle active** |
| `--accent-hover` | `#1c4292` | `#8fb7f3` | |
| `--accent-ink` | `#ffffff` | `#08111f` | |
| `--success` | `#1a7f4b` | `#35c37f` | |
| `--warning` | `#a5580a` | `#e2a03f` | |
| `--danger` | `#b3261e` | `#e5675f` | |

Plus decorative tunables `--sheen-opacity`, `--grain-opacity`, `--ring-color` (accent mix).

### Typography in-app
- `body` = Inter (`globals.css:158`). In-app headings are **Inter semibold**, NOT serif.
- `--font-display` (Space Grotesk) is **loaded but never applied** (dead weight).
- AgentOS run view uses **IBM Plex Mono** with wide tracking (`tracking-[0.18em]`) for a "terminal" look.
- `.font-numeric` = IBM Plex Mono + tabular-nums for measured numbers.

### Dark theme
**Yes — a full "dusk" theme exists** (`theme-store.ts` `Surface='dawn'|'dusk'`, persisted in
`localStorage['jev-theme']`, three-state System/Light/Dark toggle). SSR default is **dawn (light)**
(`THEME_SERVER_SNAPSHOT='system:dawn'`); OS-dark users get dusk via `system`. The landing palette (A)
is static and unaffected by the toggle.

### Components present
`src/components/ui/`: badge, button, card (`shadow-sm`), icons (Phosphor), input, label, textarea,
toast, toaster. **Missing:** dialog, tabs, tooltip, table primitives (tables hand-rolled).

### Motion layer (decorative, in-app)
`GrainOverlay` (fixed feTurbulence grain on every route), `Sheen` (pointer-follow accent radial),
`Magnetic` (spring pull on buttons), keyframes route-pulse/fade-rise/shimmer.

### Provider brand hexes (`models.ts:44/53/62`, sanctioned literals)
Claude `#d97757` · GPT `#10a37f` · Gemini `#4285f4` — used in donut, legend, routing bars, ModelPill.

### Hard-coded values outside token files
- `global-error.tsx:51–77` — hex literals (documented deliberate exception; its own `<html>`).
- `layout.tsx:56–57` — themeColor `#fafafa`/`#0b0d11`.
- `models.ts` provider hexes; `door-illustration.tsx` SVG fills (marketing).
- Arbitrary Tailwind in run-view.tsx (`text-[10/11px]`, `tracking-[…]`, `max-h-[28rem]`,
  `lg:grid-cols-[1fr_18rem]`), markdown/charts/message-bubble/pool-health-panel; one-off inline
  `style={{backgroundColor}}` for provider hexes and meter widths.

---

## Confirmed decisions (user, this session)
1. **Dark theme:** keep the System/Light/Dark toggle, but the dark surface is a **refined dark-editorial**
   palette derived from the same neutral ink family — NOT the old blue terminal scheme.
2. **Motion layer:** **keep** grain / sheen / magnetic, recoloured to fit (sheen ring now derives from the
   neutral accent; opacity lowered for calm).
3. **Charts:** **muted neutral accents** — near-black + grays base, ≤2 muted series colours, series
   distinguished by labels/patterns (not colour alone). Provider brand hexes are no longer the primary
   series identity (muted/relabeled in M6).
4. **Scope defaults:** exclude `/admin` (no page exists) and `/analytics-demo` (scratch page). Authenticated
   before/after screenshots are captured in the user's logged-in browser (the permission classifier blocks
   agent navigation to gated screens) — honest gap, not faked.

## Milestone 1 — applied (tokens only, no functional change)
- **dawn** now mirrors the marketing palette: `--bg #f7f8fa`, `--surface #ffffff`, `--surface-hover #eef0f2`,
  `--border #e4e7ea`, `--text #141414`, `--text-muted #3d4349`, `--text-faint #5b6472`.
- **`--accent` = ink/paper action pair** (was blue `#2454b8`): dawn `#141414` / ink `#f7f8fa`;
  dusk `#f5f5f4` / ink `#141414`. All `bg-accent`/`text-accent` consumers flip automatically.
- **dusk = neutral dark-editorial:** `#131313` canvas, `#1a1a1a` surface, `#f5f5f4` text, no blue.
  `themeColor` meta → `#f7f8fa` / `#131313`.
- **Fonts:** Space Grotesk dropped (was loaded, never used). `--font-display` repointed to the editorial
  **serif** (EB Garamond) = the single heading face for marketing + app; `--font-serif` kept as an alias.
- **Motion:** `--sheen-opacity` 0.35 → 0.14, ring derives from the neutral accent.
- **Token lint:** `scripts/check-design-tokens.mjs` (+ `scripts/design-tokens.test.mjs`, `pnpm check:tokens`)
  fails on raw hex / hard-coded fonts in feature code; 3-file allowlist (global-error, layout themeColor,
  door-illustration SVG). Verified green: the only files with hex are exactly the allowlisted three.

### Deferred to later milestones
- Off-scale arbitrary spacing (run-view `text-[11px]`, `tracking-[…]`) — lint extends to spacing as screens
  are refactored.
- `global-error.tsx` still hard-codes a blue `#2454b8` → new palette (M7).
- `markdown.tsx` inline code `text-accent-ink` on `bg-surface-hover` is near-invisible in light
  (**pre-existing**, not an M1 regression) → fix in M4 (chat).
- Provider brand hexes in `src/lib/models.ts` → muted/relabeled in M6 (charts).
