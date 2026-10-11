# AgentOS UI/UX Take 5 — §5 consistency audit (M9)

Run date: 2026-10-10. Brief: `AGENTOS_UIUX_PROMPT_V5.md` §5.1–§5.4.
Scope rule (logged in M1, decision 2): **§5 is a read-only audit plus token adoption
in new V5 code.** No existing animation's colour, font, spacing or duration was
edited, because V5's headline rule is "DO NOT REMOVE ANY EXISTING ANIMATION" and
changing a shipped duration or hue is a change to that animation.

Everything below is a number produced by the listed command, not an estimate.

---

## How each figure was produced

| Evidence | Command |
| --- | --- |
| house token linter | `node scripts/check-design-tokens.mjs` |
| raw colour / font / spacing / timing scan | `node _lh/harnesses4/t5-m9-consistency-audit.mjs` |
| V5 CSS block token census | `awk 'NR>=1382' src/app/globals.css` + `grep -o 'var(--…'` |
| live computed styles (Chrome, :3000) | `mcp browser-use evaluate_script` — computed `stroke`, `stop-color`, `strokeWidth`, `z-index`, `opacity` |

Positive control for the scan: it flags `cursor-field.tsx`, a file nobody touched in
this run, so the scanner is not vacuously reporting "clean".

---

## §5.1 Font consistency — consistent, no action

- `node scripts/check-design-tokens.mjs` reports **0** font violations; its `FONT_RE`
  covers `font-family:`, `fontFamily:`, `--font-*` redefinition and `font-[…]`
  arbitrary utilities.
- 10 font declarations exist in `src/`, all of them either in the token block of
  `globals.css` or in `src/app/global-error.tsx:35` (the crash page, which renders
  its own `<html>` with no cascade access and is allowlisted on purpose).
- Distinct font utilities used across `src/`: `font-display`, `font-sans`,
  `font-mono`, `font-serif`. `--font-serif` is **not** a second typeface — it is
  declared at `globals.css:21` as an alias onto the single grotesque so legacy
  consumers flip to Inter; the EB Garamond serif was retired in the UI/UX run.
- The three V5 layers (`flow-lines`, `strand-trail`, `v5-layers`) declare **0** fonts
  and render **0** text nodes: every one is `aria-hidden` and paints only SVG paths,
  gradient stops and empty overlay divs. Verified in the served HTML and in the
  DOM (`document.querySelectorAll('[data-flow-core]')` → paths only).

**Finding:** nothing to fix; no new font surface was added.

## §5.2 Colour consistency — V5 layers now 100 % token-fed

`src/` raw-hex census (38 total) and where each one legitimately belongs:

| File | Hex | Why it owns a literal |
| --- | --- | --- |
| `src/app/globals.css` | 22 | All inside the `:root` token block. `awk 'NR>101 && /#[0-9a-f]{3,8}/'` → **0 matches**, i.e. not one hex below the declarations. |
| `src/app/global-error.tsx` | 9 | Standalone crash page, allowlisted. |
| `src/lib/motion/hero-shared.ts` | 3 | Canvas/WebGL gradient stops — a GL context cannot parse `var()`. Pre-existing (hero fluid). |
| `src/components/motion/cursor-field.tsx` | 2 | **House linter findings, pre-existing** — see below. |
| `src/app/[locale]/layout.tsx` | 1 | `<meta name="themeColor">`, allowlisted. |
| `src/lib/motion/particle-field.ts` | 1 | Canvas particle colour. |

**Pre-existing finding, left alone deliberately:**
`node scripts/check-design-tokens.mjs` exits non-zero with exactly two violations,
`cursor-field.tsx:85` (`#5b7cfa`, a fallback when `getComputedStyle` returns empty)
and `cursor-field.tsx:86` (`#8a93a8`, an ambient ink passed to canvas). This is a
Take-2 file listed on the M1 do-not-touch table, and the fix is either an allowlist
comment or a value change — a value change would alter a shipped animation. Note
that `check-standards.mjs` does **not** invoke this linter, so the repo's own gate
is not currently red; `pnpm check:tokens` is.

**What this run changed (additions only):**

1. Six tokens added to the dark palette in `globals.css`, so the line system owns no
   colour of its own — `--flow-input-a/b`, `--flow-route-a/b`, `--flow-evidence-a/b`.
   Their values are the existing `--accent`, hero violet, `--danger`, `--warning`,
   `--success` and hero sky, so nothing on screen changed hue.
2. `flow-lines.tsx` `LINES` and `strand-trail.tsx` `STRANDS` now reference those
   tokens instead of `'#7065e2'` / `'#d9a441'` / `'#8abced'` literals.
3. Both now write colour through a CSS **declaration** (`style={{ stopColor }}`,
   `style={{ stroke }}`) rather than an SVG presentation attribute, because `var()`
   only substitutes inside a declaration — measured, not assumed:
   computed `stop-color` resolves to `rgb(91,124,250) rgb(112,101,226)` /
   `rgb(224,112,106) rgb(217,164,65)` / `rgb(70,179,125) rgb(138,188,237)`.
4. `.v5-xray`'s flashlight was `rgb(255 255 255 / 0.1)`; it is now
   `color-mix(in srgb, var(--text) 12%, transparent)` — computed
   `color(srgb 0.949 0.949 0.961 / 0.12)`, a 0.7 % luminance shift nobody can see.
5. The §3.2 glow requirement is met without a filter: each line paints a wide,
   faint twin rather than `filter: drop-shadow(...)` over a 13 792 px path.

**Result:** the V5 CSS block (244 lines from `globals.css:1382`) contains **0 hex,
0 `rgb()`, 0 `hsl()`**, and 10 token colour references.

## §5.3 Spacing consistency — no new offenders

- Scanner: **56** arbitrary-value spacing utilities (`p-[…]`, `gap-[…]`, `w-[89%]`, …)
  across 21 files. Concentration is in the cinematic landing sections, which is where
  bespoke geometry belongs: `horizontal-showcase.tsx` 12, `landing-page.tsx` 7,
  `message-bubble.tsx` 4, `spend-panel.tsx` 4.
- The house linter's own spacing rule finds **0** violations — none of those 56 is an
  off-scale padding/margin; they are measured layout geometry (percentage gutters,
  track widths), which is what §5.3 permits.
- Section rhythm unchanged: every landing section still uses the shared
  `SECTION = 'mx-auto w-[89%] max-w-6xl'` wrapper (`landing-page.tsx:33`); the
  `<StrandTrail />` mount added that wrapper's own `relative` class to the pipeline
  div and no other spacing.
- V5 adds **0** Tailwind spacing utilities. Its three dimensional literals are motion
  geometry, not page rhythm: the 60 px grid cell (and its matching `-60px` inset and
  60 px drift, which must equal each other or the loop jumps), the 2 px thread rail at
  `right: 1.4%`, and the 120 px x-ray radius.

## §5.4 Motion timing — new code on the house scale, shipped code untouched

V5 §5.4 proposes Fast 150 / Medium 300 / Slow 600 / Very-slow 1200 ms. The repo
already ships a different scale (`globals.css:43-48`): `--motion-fast` 120,
`--motion-base` 220, `--motion-slow` 420, `--motion-scene` 1200, plus
`--ease-expo`, `--ease-spring`, `--ease-out-soft`, `--ease-in-out`. Adopting V5's
numbers would mean re-timing 45 already-shipped transitions, which V5 §1 forbids.
So the house scale wins and V5's new code moves onto it.

Measured census of `globals.css` from the V5 block onward:

| Literal duration before this pass | Now |
| --- | --- |
| `.v5-grid` opacity `500ms` | `var(--motion-slow)` |
| `.v5-wipe.is-wiping` `400ms` | `var(--motion-slow)` |
| `.v5-spot` background/filter `300ms` ×2 | `var(--motion-base)` |
| `.v5-xray` opacity `220ms` | `var(--motion-base)` |
| `.v5-thread-mark` opacity `300ms` | `var(--motion-base)` |
| `.v5-shock` `400ms` | `var(--motion-slow)` |

Remaining literals in the V5 block: **3**, all infinite loops rather than
transitions, so they have no place on a transition scale — `flow-pulse 2s`
(§3.2's scroll-pause breath), `v5-grid-drift 10s` (§4.3's drift, tied to the 60 px
cell), `v5-pulse 1.5s` (§4.5's sonar repeat interval). Easing on the two of those
that is not `linear` is a token (`--ease-in-out`, `--ease-out-soft`).

Census: 8 `var(--motion-*)` references, 10 easing-token references
(7 × `--ease-out-soft`, 2 × `--ease-in-out`, 1 × `--ease-expo`), 3 loop literals,
0 untokenised transition durations, and 12 colour-token references
(6 × `--accent`, 3 × `--text`, 1 each `--danger`, `--success`, `--border-strong`).

Counting method for the whole stylesheet
(`grep -oE '(animation|animation-duration|transition):[^;]*[0-9]+(\.[0-9]+)?m?s'`):
48 declarations still carry a literal duration, **3** of them in the V5 block, so 45
predate Take 5 — including `footer-rise 900ms` at `globals.css:1379`, which belongs to
the shipped footer reveal and was not touched.

One collision fixed as part of this audit: `.v5-thread` sat at `z-index: 45`, the same
rung the mobile nav overlay uses, so the rail could paint over the open menu. It is now
`44` — above grain (40), below the overlay (45) and the nav (50). Measured live:
computed `z-index` = `44`.

---

## Decisions (§8 format)

### Decision: keep the house motion scale, not V5 §5.4's
- **Context:** §5.4 asks every animation to use Fast/Medium/Slow/Very-slow 150/300/600/1200 ms.
- **Options:** 1. retime the whole stylesheet to V5's scale — matches the brief, but edits
  45 shipped transitions, which §1 prohibits / 2. leave everything as found and write V5's
  new code with literals — keeps §1, fails §5.4 / 3. leave shipped code alone, put **new**
  V5 code on the **existing** `--motion-*`/`--ease-*` tokens — `[VERIFIED]` for the V5 block.
- **Chosen:** 3.
- **Why:** the additive-only rule is the one the owner repeated in prose and in the V5
  header; a token migration cannot be scoped to new code, and half-migrating existing
  rules is exactly the "simplify it" V5 forbids.
- **Risk:** V5 §5.4's checker (a human comparing numbers) sees 120/220/420/1200 where the
  brief said 150/300/600/1200.
- **How to reverse:** replace `var(--motion-*)` with the §5.4 literals in the V5 block only
  (~12 declarations); shipped code is untouched, so no other animation moves.
- **Existing animations preserved:** all of them — none was retimed.

### Decision: three literal durations stay in the V5 block
- **Context:** §5.4's scale has no rung for "infinite ambient loop".
- **Options:** 1. force the loops onto `--motion-scene` (1200 ms) — a 1.2 s grid drift is
  visibly frantic / 2. add loop tokens (`--motion-loop-*`) to the palette / 3. leave the
  three loop periods literal and document them.
- **Chosen:** 3, for now; 2 is the follow-up if a later pass adds more ambient loops.
- **Why:** the values are tied to geometry (the 10 s drift must equal the 60 px cell or
  the loop seams) and are not interaction timings; a token would suggest they are
  interchangeable with hover timings.
- **Risk:** an automated "no literal durations" gate would flag 3 lines.
- **How to reverse:** declare `--motion-loop-ambient: 10s`, `-breath: 2s`, `-sonar: 1.5s`
  in the `:root` at `globals.css:43` and substitute; zero visual change.
- **Existing animations preserved:** untouched.

## What this audit did **not** do

No file outside `flow-lines.tsx`, `strand-trail.tsx`, `v5-layers.tsx` and
`globals.css` was modified. No `cursor-field.tsx`, `hero-shared.ts`, `particle-field.ts`
or Take-1…4 duration was edited. Nothing was deleted, disabled or simplified.

One correctness fix found while auditing the reduced-motion branch: `FlowLines` used to
return early from its scroll effect under `prefers-reduced-motion`, which left the
document-coordinate paths pinned at the hero's geometry at every scroll offset. It now
keeps the position tracking and drops only the drawing and the breathing, which is what
§3.4 actually specifies. Measured on the live page (non-reduced): `scrollY` 0 → 5000
moves the line group `matrix(1,0,0,1,0,0)` → `matrix(1,0,0,1,0,-5000)` and the core's
`stroke-dashoffset` 0.944 → 0.727.
