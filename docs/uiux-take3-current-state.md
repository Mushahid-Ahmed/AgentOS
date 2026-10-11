# UI/UX Take 3 — Phase A: current state

Deliverable of V3 §3.3 / §11 milestone 1. Everything below is either a file:line citation or a number
produced by a named harness. No product code was changed to produce this document.

Harness family for this run: `../_lh/harnesses3/` (outside the repo, same rule as Take 2 — a harness
that cannot be re-run is a screenshot, not evidence). Artifacts: `../_lh/take3/`.

Baseline snapshot (V3 §10 forbids commits; HEAD stays `5cdba16`):
- `../_lh/take3/baseline/take2-tracked.diff` — 97,932 B, the 12 modified + 1 deleted tracked paths.
- `../_lh/take3/baseline/untracked/` — 54 files copied from the 18 untracked paths (Take 2's new
  sources and docs, plus this run's own log).
That pair is the "before" tree of Take 3: the code exactly as it runs today, uncommitted.

---

## 1. Job 1 inventory — what the cursor system actually is

### 1.1 The custom cursor

One component, one mount point, zero dependencies.

| What | Where | Note |
| ---- | ----- | ---- |
| The reticle implementation | `src/components/motion/cursor.tsx` (276 lines) | Take 2, §5 of that brief. SVG with four layers: crosshair ticks (`g[data-ticks]`), bracket (`path[data-bracket]`), tip (`rect[data-tip]`), press pulse (`circle[data-pulse]`). One rAF loop, direct attribute writes, no per-frame React render. |
| Where it is mounted | `src/components/motion/motion-provider.tsx:3` (import) and `:11` (`<Cursor />`) | `MotionProvider` composes `SmoothScrollProvider` (Lenis) + `Cursor`; the provider is mounted once in `src/app/[locale]/layout.tsx`. **The smooth-scroll provider stays.** |
| The only `cursor: none` rule in the codebase | `cursor.tsx:126-129` — a `<style>` node appended to `document.head` at mount, `@media (hover: hover) and (pointer: fine){ body{cursor:none} input,textarea,select{cursor:auto} }`, and removed by the effect cleanup at `:225` | It is injected by the component itself, so deleting the file deletes the rule. `grep -rn "cursor:none\|cursor-none\|cursor: url" src/` returns this one line and nothing else. |
| npm dependency | none | `grep -ni cursor package.json` → no match. No `react-cursor`, no `custom-cursor`, nothing to uninstall (V3 §4.1 step 4 is a no-op here). |
| Other files that reference the cursor | `src/components/motion/proximity-text.tsx:7` — the word "cursor" in a comment only | `data-cursor-target` (the cursor's own opt-in selector, `cursor.tsx:27`) has **no other consumer** in `src/` — grep confirms the only hit is inside that selector string. |

Native-cursor hints that are **not** part of the system and must survive (they are the "traditional
cursor" the owner asked to go back to): `cursor-pointer` on the FAQ `<summary>`
(`src/components/landing/faq.tsx:44`) and the preloader overlay
(`src/components/landing/preloader.tsx:80`), `disabled:cursor-not-allowed` on
`src/components/ui/input.tsx:10`, `ui/label.tsx:10`, `ui/textarea.tsx:10`, and the inline
`cursor: 'pointer'` in `src/app/global-error.tsx:80`.

Also deliberately **kept** although it is pointer-reactive: `src/components/motion/proximity-text.tsx`
(glyphs near the pointer scale and glow) and `src/components/motion/sheen.tsx` (pointer-follow specular
highlight on hero panels, `globals.css:306-333`). Neither draws a cursor and neither is in the brief's
removal list.

### 1.2 The "button border hover animation" — measured finding

**There is no button border animation.** The effect the owner sees is the cursor's own bracket snapping
onto the button's bounding box — i.e. it is part of the same system as the "2 intercepting lines".
Proved on the live page, not asserted:

```
node ../_lh/harnesses3/tmp-t3-cursor-probe.mjs http://localhost:3000   →  11/11 checks passed
artifact: ../_lh/take3/phaseA/cursor-probe.json (+ 3 PNGs)
```

| Check | Result |
| ----- | ------ |
| cursor system mounts on the landing (fine pointer, no reduced motion) | PASS — `[data-t2-cursor]` present |
| native cursor suppressed while it is live | PASS — `getComputedStyle(body).cursor === "none"` |
| bracket converges onto the padded bounding box of the control under the pointer | PASS — nav "Log in": target box `[1126.5, 8, 1209.5, 56]`, locked bracket box identical, **maxEdgeErr 0.0 px** (idle bracket was `[1413, 863, 1427, 877]` on the tip) |
| crosshair ticks fade when the bracket locks | PASS — opacity `0.55 → 0.106` |
| the button itself draws/animates no border on hover | PASS — border color `rgb(38, 38, 44)`, width `1px`, box-shadow `none`, `animation-name: none`, `::before`/`::after` computed values and `getAnimations()` all identical idle vs hover; **no running animation touches border/outline/box-shadow** |
| positive control (the check can fail) | PASS — the same hover changes `background-color` `rgba(0,0,0,0) → rgb(28,28,23)`, so "border unchanged" is a real measurement, not a probe that never fired |
| `/login` submit button | PASS — border `rgb(10,10,11) 0px` before and after hover, zero border-class animations, while the bracket locks onto `[524, 630.1, 916, 682.1]` = the button box + the 6 px pad from `cursor.tsx:93` |

Honest limitation of this first probe, and its correction: my two landing selectors
(`header a[href*="login"]` and `main a[href*="signup"]`) resolved to the **same element** (identical
bounding boxes), so the landing really contributed one distinct control plus `/login`. Re-scoped to
`main section:has(h1) a[href="/signup"]` and `main section:has(h1) a[href="/login"]` and re-run against
the pre-V3 production build on `:3100`: **15/15 checks passed** over three genuinely distinct landing
variants (nav ghost link, hero filled CTA, hero ghost link) + the `/login` submit. Bracket lock error
was **0.0 px on every one of them**, and the border stayed static on every one: ghost
`1px rgb(38,38,44)` idle and hovered, filled CTA `0px` idle and hovered while its background moved
`rgb(91,124,250) → rgb(117,144,255)`. So §1.2's finding is measured across variants, not one variant
twice — and the same three variants are re-checked post-removal by `tmp-t3-cursor-removed.mjs` (13/13).

Corroboration from the source, before the measurement: `src/components/ui/button.tsx:7-18` defines
hovers as `transition-colors` + background/border-colour *states* (`hover:bg-accent-hover`,
`hover:bg-surface-hover`, `hover:opacity-90`) — no keyframes, no pseudo-element, no SVG. And the whole
of `src/` contains no gradient-border implementation: greps for `conic-gradient`, `border-beam`,
`gradient-border`, `--border-angle`, `mask-composite` return nothing. The keyframe list in
`globals.css` (16 `@keyframes`, §3.4 below) contains no border-drawing animation either.

**Consequence for Job 1:** one deletion (`cursor.tsx` + its two lines in `motion-provider.tsx`) removes
both symptoms the owner described. If any button variant still shows a border-side effect after that,
M2's after-check must catch it — that check is written, and it is the one that can fail.

---

## 2. Landing design system — the target the app must match

All six surfaces already draw from one token source; the app's problem is not the palette, it is the
motion quality bar (§4 below).

### 2.1 Type

`src/app/globals.css:16-21` (`@theme`) — a single neo-grotesque: **Inter** variable (100-900) is both
display and text face, **IBM Plex Mono** for measured numbers (`--font-mono`), and `--font-serif` kept
only as an alias that resolves to Inter. `body` binds `var(--font-sans)` (`:102-108`). Shared voices:
`.font-numeric` (mono + tabular-nums, `:112-116`), `.title-editorial` (19 px / 600 / -0.01em, `:123`),
`.hero-editorial` (`:131`), `.display-huge` (`:141`), `.label-uppercase` (`:150`).
Static scale in `src/lib/design-tokens.ts:43-49`: `display 88px/0.95/-0.04em`,
`displayMobile 44px`, `h2 32px/1.1/-0.02`, `body 16px/1.6`, `small 14px/1.5`.

### 2.2 Colour

`src/app/globals.css:57-83` — one dark system, no light theme and no toggle (UX-D1): `--bg #0a0a0b`,
`--surface #131316`, `--surface-hover #1c1c21`, `--border #26262c`, `--border-strong #3a3a42`,
`--text #f2f2f5` (17.7:1), `--text-muted #b9b9c2` (10.2:1), `--text-faint #8b8b96` (5.9:1),
`--accent #5b7cfa`, `--accent-hover #7590ff`, `--accent-ink #0a0a0b`, `--success #46b37d`,
`--warning #d9a441`, `--danger #e0706a`, chart identity `--series-1..3`, and
`--sheen-opacity 0.16 / --grain-opacity 0.05 / --ring-color`. `@theme inline` (`:85-100`) mirrors each
into a Tailwind colour so `bg-surface-hover`, `text-text`, `border-border` etc. are token-generated,
not literal.

### 2.3 Geometry

`src/lib/design-tokens.ts:13-38` + `globals.css:23-27`: radii `6 / 8 (control) / 10 / 16 / 24`;
control heights `36 / 40 / 44` px; focus ring `2 px` width, `2 px` offset, light `rgba(20,20,20,.9)` /
dark `rgba(242,243,245,.9)`; spacing ramp `[4,8,12,16,24,32,48,64,96]`; hairline `1 px`.

### 2.4 Motion

Easings `globals.css:33-36` — `--ease-expo cubic-bezier(0.16,1,0.3,1)` is the **signature** ease,
plus `out-soft`, `spring`, `in-out`. Durations `:44-47` / `design-tokens.ts:54-60` — fast 120 ms,
base 220 ms, slow 420 ms, scene 1200 ms, door 500 ms. Kill-switch at `globals.css:363+`
(`prefers-reduced-motion: reduce` neutralises the decorative loops; `useReducedMotion()` at
`src/lib/motion/use-reduced-motion.ts` is the JS-side single source, and `useFinePointer()` is what
gates the cursor to desktop).

Keyframes available for reuse (`globals.css`, 16 total): `route-pulse` (:163), `gauge-sweep` (:178),
`bar-grow` (:184), `shimmer` (:193), `fade-rise` (:202), `twinkle` (:215), `caret-blink` (:233),
`scroll-dot` (:250), `aurora-a` (:415), `aurora-b` (:421), `auth-stage-in` (:437), `auth-rise-in`
(:448), `check-draw` (:570), `check-ring` (:581), plus `.skeleton` (:290), `.sheen` (:306),
`.tilt-depth` (:338), `.door-*` (:275-288) and the `<details>` height transition (:342).

JS motion primitives: `src/components/motion/` — `motion-provider.tsx`, `smooth-scroll-provider.tsx`,
`cursor.tsx` *(to delete)*, `sheen.tsx`, `tilt.tsx`, `ripple.tsx`, `grain-overlay.tsx`,
`magnetic.tsx`, `proximity-text.tsx`, `reveal.tsx`; `src/lib/motion/` — `use-scrub.ts`,
`use-reduced-motion.ts`, `fluid-layer.ts`. `pnpm check:tokens` is the lint that keeps the TS mirror and
`globals.css @theme` in sync.

### 2.5 Landing before-state, measured (this run)

`docs/uiux-take3-before/manifest-before.json` — 6 captures on 3 routes × 2 widths:

| route | vp | `<section>` in `main` | page height | h-overflow | canvas | body font | cursor mounted |
| ----- | -- | --------------------- | ----------- | ---------- | ------ | --------- | -------------- |
| `/` | 1440 | 12 | 15,057 px | 0 px | `webgl2 1224×765` (fluid hero) | Inter | yes |
| `/` | 375 | 12 | 14,359 px | 0 px | `webgl2 150×324` | Inter | yes (headless is still `pointer: fine`) |
| `/login` | 1440 / 375 | 0 | 900 / 812 px | 0 px | none | Inter | yes |
| `/signup` | 1440 / 375 | 0 | 900 / 812 px | 0 px | none | Inter | yes |

Console: 4 warnings, all `[.WebGL-…] GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High):
GPU stall due to ReadPixels` on `/` — this box has no usable GPU path (software rasteriser), same
signature as Take 2; zero page errors, zero hydration errors.

Caveat recorded up front: the "375" captures are **narrow desktop viewports in headless Chromium**, not
emulated touch devices. `pointer: fine` is still true there, which is why the cursor shows as mounted.
The real touch path is gated by `useFinePointer()` and is verified separately in M7 with
`hasTouch`/`isMobile` contexts, exactly as Take 2 did.

## 3. App surfaces inventory (what is really behind auth)

Route map — every app page is a thin **server** component mounting one client view, all wrapped by the
same `AppHeader` → `ViewNav` (`src/components/nav/app-header.tsx:18,47`,
`src/components/nav/view-nav.tsx:13-25,27`):

| Route | Page file | Mounts |
| ----- | --------- | ------ |
| `/app` — the chat workspace | `src/app/[locale]/app/page.tsx:11-13` | `<ChatWorkspace />` |
| `/dashboard` | `src/app/[locale]/dashboard/page.tsx:6-8` | `<DashboardView />` |
| `/agentos` — run view + replay | `src/app/[locale]/agentos/page.tsx:7-9` | `<AgentOSView />` (`src/components/agentos/run-view.tsx:468`) |
| `/analytics-demo` | `src/app/[locale]/analytics-demo/page.tsx:5-15` | instrumentation reference page (its own comment marks it deletable) |
| unmatched URLs | `src/app/[locale]/[...rest]/page.tsx:9-11` | `notFound()` → `src/app/[locale]/not-found.tsx` |
| `/admin/**` | `src/app/[locale]/admin/layout.tsx:17-53` | authz + flag providers only — **no admin page exists** (verified: the directory holds just `layout.tsx`) |

Auth is enforced outside these files: `src/proxy.ts` + `src/lib/route-gate.ts:36`, public set =
`/`, `/login`, `/signup`, `/auth/*` (`route-gate.ts:4-12`), signed-in users on `/` → `/app`.

### 3.1 Dashboard (`src/components/dashboard/**`)

- `dashboard-view.tsx:121-498` is **one vertical scroll stack**, not a tabbed view: cumulative stat cards
  (200-234) → gauge + donut (237-293) → benchmark run + report (296-423) → run history (426-474) →
  `AgentosBenchmarkPanel` (478) → Spend + Model-usage (483-494) → `PoolHealthPanel` (498). Its only
  local state is `selectedRunId` (123). Data via TanStack Query (`use-dashboard-data.ts` →
  `/api/dashboard`, `/api/benchmark/runs`, `/api/benchmark/runs/[id]`; `use-spend.ts:20-27` polls
  `/api/spend` every 15 s; `use-model-pool-health.ts:21-28` polls `/api/model-pool` every 15 s), plus
  hand-rolled SSE triggers in `use-benchmark-run.ts:5-11` and `use-agentos-benchmark-run.ts:9-15`.
- Charts (`charts.tsx`) are dependency-free SVG: `LatencyGauge` (33-92) already animates
  (`animate-[fade-rise…]` 41, `transition-[stroke-dashoffset] duration-500` 67); `BarChart` (285-346)
  animates its widths (292, 307); **`Sparkline` (103-161) and `Donut` (181-263) do not animate at all**.
  Every chart pairs an `aria-hidden` graphic with an `sr-only` table (contract comment 7-9) — that
  pairing must survive any restyle.
- `meter-bar.tsx:9-55` is the shared meter (`transition-[width] duration-500`, 47).
- Loading today = `SpinnerIcon` + text (`dashboard-view.tsx:410-413,436-439`, `spend-panel.tsx:330-333`,
  `model-usage-panel.tsx:235-238`, `pool-health-panel.tsx:196-199`). Empty = `EmptyState`
  (`ui/empty-state.tsx:9-39`, used at `spend-panel.tsx:340-345`, `model-usage-panel.tsx:245-250`,
  `pool-health-panel.tsx:206-211`).
- **`ui/skeleton.tsx` (`Skeleton`, `SkeletonLines`) has zero importers** — the `.skeleton` shimmer CSS
  already exists (`globals.css:290-299`) and is unused. Verified by grep. §5.3's "shimmer skeletons, not
  a spinner" is therefore a wiring job, not a build job.
- `pool-health-panel.tsx:192` renders `data.models` with **no pagination or virtualisation** (86-121);
  that array is the whole live NanoGPT catalog (`src/lib/model-pool/registry.ts:28` →
  `src/lib/model-pool-health.ts:79`). Take 2 measured it at 625 rows / 71,136 chars of text on one
  route. The exact row count is network-dependent and not verifiable from the repo.

### 3.2 Chat (`src/components/chat/**`) — the breakage-prone surface

- `chat-workspace.tsx:94-169`: sidebar + `AppHeader` + scrollable `main` transcript (`messages.map`,
  133-139 keyed by `message.id`) + error banner + `ChatInput`. Auto-scroll is
  `bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })` in an effect on
  `[messages]` (75-77) — i.e. **it already smooth-scrolls per token**; §5.3's "smooth scroll, not instant
  jump" is already met and only needs to not regress.
- Transport (`use-chat.ts`): **`fetch` POST `/api/chat` + `response.body.getReader()` manual frame
  parsing — not EventSource** (95-129), events `conversation → route → token* → done | error`
  (132-163). Every token calls `patchMessage` → `setMessages(prev => prev.map(...))` (286-288), so the
  **whole messages array is replaced per token**, which re-renders the list, the `scrollIntoView`, and
  `ReactMarkdown` (`markdown.tsx:70-71` re-parses the full string every token).
- Per message: `message-bubble.tsx` renders routing (46-48), "model is answering" spinner (50-55),
  streamed markdown (57-61), error + Retry (67-82) and `TelemetryChips` (84) — model, `jev` ms, total
  ms, tokens, and the estimated **cost** chip (38-47, 79). `routing-visualizer.tsx` already animates
  (`fade-rise` 27, `route-pulse` dot 32, width transitions 66-76).
- Constraints that must not be violated: no `React.memo` exists on the list, and `executeChatStream`
  (85-184) / `executeLoadConversation` (197-230) are module-level **because the React Compiler
  (`panicThreshold: 'all_errors'`) fails the build on a throwing try/catch inside a hook** (warning at
  19-26, mirrored in `use-dashboard-data.ts:8-10`, `use-benchmark-run.ts:8-11`, `use-agent-run.ts:13-18`).
  ⇒ Animation must not be React state per frame, must not remount the list (would reset `CodeBlock`'s
  `copied` state and kill the sentinel ref), and must not conditionally mount the workspace (unmount
  aborts the in-flight stream — `useEffect(() => () => abortRef.current?.abort(), [])`, 284). Safe
  shape: per-bubble CSS entrance keyed on mount, which fires once because React reuses the keyed node.
- `chat-input.tsx`: autosize (26-34), Enter-to-send (45-50), send ⇄ Stop swap while streaming (72-90),
  already wrapped in `Magnetic` (77).

### 3.3 AgentOS run view (`src/components/agentos/**`)

D6 panel order as rendered by `RunViewPanels` (`run-view.tsx:451-464`), verbatim:

1. `HeaderPanel` — untitled status bar, "AGENTOS" wordmark (133), phase Badge
   `IDLE / RUNNING / COMPLETE / FAILED / BUDGET STOPPED` (119-129, 144-157), counters
   cost / elapsed / models / tools / run (159-165)
2. **"User"** (172)
3. **"Jev Decision Bus"** (188)
4. **"Agent roster · N"** (216)
5. **"Model Pool Failover"** — conditional, `null` when no pool events (302-305)
6. **"Evidence Graph"** (324)
7. **"Jev Decision"** (351)
8. **"Result"** — error / pending / final variants (385, 395, 410)

- Live events: `use-agent-run.ts` = POST `/api/agentos` + manual reader over
  `splitFrames`/`parseRunFrame` (`src/lib/agentos/sse.ts:14-53`), folded through the pure reducer
  `applyRunViewEvent` (`src/lib/agentos/run-view.ts:300+`) via `setView` (111-115). Event names it
  handles: `run`, `decision`, `run_started`, `plan_created`, `status`, `model_selected`,
  `model_failover`, `model_unhealthy`, `agent_started`, `agent_finished`, `evidence_added`,
  `evidence_verified`, `contradiction_found`, `replan`, `cost_update`, `final`, `error`.
- Status indication: per-agent dot `DOT_CLASS` (40-46) where **running already pulses**
  (`animate-pulse` + `motion-reduce:animate-none`), rendered 226-229; text labels WAITING/RUNNING/
  COMPLETE/FAILED/SKIPPED (48-54, 249-262); SR live region 574-580.
- **There are no play/pause/step controls.** Replay is `use-run-replay.ts` = two TanStack queries
  (`GET /api/agentos/runs`, `GET /api/agentos/runs/[id]`) + a run picker in
  `<aside aria-label="Run replay">` (`run-view.tsx:586-677`), and the selected run is folded
  **instantly** by `reduceRunViewEvents` in a `useMemo` (488-498, swapped in at 502-503). §5.3's
  "Replay controls: play/pause/step hover states" has nothing to style — building those controls would
  be new product functionality, which §1/§8 forbid. Logged as a brief/reality mismatch, decision T3-D2.

### 3.4 How the app is styled today — and why Job 2 is a motion job, not a palette job

- Already tokenised Tailwind v4: 243 matches for token utilities (`rounded-control`, `text-text`,
  `bg-surface*`, `border-border`, `var(--…)`) across 17 files in the four component dirs, and **zero**
  hard-coded hex or `gray-*` classes (verified by grep). `rounded-lg` is itself the `--radius-lg: 16px`
  token.
- 40 arbitrary-value usages across 9 files; worst is `run-view.tsx` with 24 (`text-[11px]`,
  `max-h-[28rem]` 624, `min-w-[720px]`-style widths in the tables), then `spend-panel.tsx` (5),
  `model-usage-panel.tsx` (3), `pool-health-panel.tsx` (2).
- Typography gap, not a font gap: both surfaces get **the same** Inter + IBM Plex Mono from
  `src/app/[locale]/layout.tsx:20-31`, but the app's display voice stops at `.title-editorial`
  19 px/600 (used by `app-header.tsx:40`, `ui/card.tsx:22`, `ui/empty-state.tsx:32`) while the landing
  goes to `.display-huge` `clamp(3rem,11vw,9rem)`/800. `run-view.tsx` is deliberately all-mono
  (its own comment 28-36).
- `src/lib/design-tokens.ts` is imported **nowhere** in the app surfaces (only `auth-form.tsx:7` and
  `door-illustration.tsx:2`), even though its header comment (1-11) claims both halves of the product
  draw geometry from it.
- Motion present in the app today: **`Magnetic` only** (run-view 9, chat-input 6,
  agentos-benchmark-panel 8, dashboard-view 12) plus **one `Sheen`** (dashboard-view 11, wrapping a
  single card at 238) and a few CSS keyframes (`fade-rise`, `route-pulse`, width/dashoffset
  transitions). `FadeUp`, `LineMaskReveal`, `CountUp`, `Tilt`, `ProximityText`, `Typewriter`,
  `useScrub` are **landing-only — zero app usage**. `Ripple` is auth-only. `GrainOverlay`, `Cursor` and
  Lenis smooth scroll run on every route via the layout (`layout.tsx:71-79`).
  - **M9 correction (2026-10-10), and the line I should have followed up on the day I wrote it:** that
    last clause is the sentence that documents the bug the owner later reported. `docs/DESIGN.md:112-119`
    already states that a root-level Lenis *freezes* these views — "it `preventDefault`s wheel events
    globally and drives the *window*, which cannot scroll here, so the inner `<main>` never received the
    wheel" — and forbids re-adding it on a non-document-scroll view. I recorded the mount as an inventory
    fact, checked the `Cursor` half of the sentence for Job 1, and never tested the Lenis half. It is now
    gated (`_lh/harnesses3/tmp-t3-m9-wheel.mjs`) and the provider skips the workspace routes
    (`smooth-scroll-provider.tsx:31-41`).
- Libraries: **no `framer-motion`/`motion`, no chart lib** (verified in `package.json`); `gsap ^3.15.0`
  and `lenis ^1.3.26` exist but are used only by `smooth-scroll-provider.tsx:3-5` and
  `landing/horizontal-showcase.tsx:4-5`; `src/lib/motion/*` is rAF/IntersectionObserver-based.
  ⇒ the animation approach for Job 2 is existing CSS keyframes + existing rAF primitives, **zero new
  dependencies** (decision T3-D1).

### 3.5 Falsification attempt on §1.2's "no button border animation"

The button half survives: `ui/button.tsx:6` is `transition-colors`, variants hover on
`bg`/`opacity` only (10-14), and no `hover:border-*` exists on a Button anywhere. Border **colour**
transitions do exist on non-buttons, which is the closest thing to the owner's description and is worth
showing them: `landing/arch-grid.tsx:69` (`transition-[border-color,background-color]` +
`hover:border-[var(--border-strong)]` on a card) and `auth/auth-form.tsx:40`
(`hover:border-border-strong` on an input). Neither is in chat/dashboard/agentos. The only
border-*drawing* animations are `.field-underline` (`globals.css:463-479`, an accent line that scales in
under auth inputs on focus), `check-draw`/`check-ring` (564-593, auth success), and `drawProps`
(`use-scrub.ts:67-74`, landing SVG strokes). **None of them is a button-hover border.**
Decision: those card/input hover borders are standard hover states (§4.2 keeps them); they are not the
effect described, and the measurement in §1.2 shows the reticle bracket is.

## 3.6 App before-state, measured (signed in, this run)

`docs/uiux-take3-before/manifest-before-app.json` — 6 captures, the real demo session, `/app` +
`/dashboard` + `/agentos` at 1440 and 375 (full-page at 1440 too). Login went through the actual
`/login` form and landed on `/app`; **0 console errors and 0 warnings across all six captures**, and
`hScrollOverflowPx = 0` on every route at both widths.

| route | vp | visible chars in `main` | chart/table SVGs | `tbody tr` | page height | `h1` | radius | reticle | body cursor |
| ----- | -- | ----------------------- | ---------------- | ---------- | ----------- | ---- | ------ | ------- | ----------- |
| `/app` | 1440 | 383 | 31 | 0 | 900 px | 19px/600 | 8px | false | auto |
| `/app` | 375 | 383 | 31 | 0 | 812 px | 19px/600 | 8px | false | auto |
| `/dashboard` | 1440 | 79,189 | 6 | **721** | 5,565 px | 19px/600 | 8px | false | auto |
| `/dashboard` | 375 | 79,189 | 6 | 721 | 9,905 px | 19px/600 | 8px | false | auto |
| `/agentos` | 1440 | 9,929 | 1 | 0 | 900 px | 19px/600 | 8px | false | auto |
| `/agentos` | 375 | 9,893 | 1 | 0 | 812 px | 19px/600 | 8px | false | auto |

Three things this proves. (1) The data is real: 79k characters and 721 table rows on `/dashboard` is a
populated database, not a loading shell — the settle wait exists precisely so this claim is not a
screenshot of a spinner. (2) `/agentos` renders the full D6 stack (headings captured: `User`,
`Jev Decision Bus`, `Agent roster`) against stored run `#81`-onwards in the replay rail, so M5 has real
content to work on. (3) `/app` at 383 chars is the **empty** conversation state — no model was called
(the $0 rule), so a streamed turn remains an honest gap for M4 and M8.

The visual audit of those six PNGs is what defines Job 2, and it is a *voice* gap, not a colour gap:

- **`/agentos` reads as a different product.** It is 100% IBM Plex Mono, including prose sentences,
  with uppercase letterspaced panel labels — while the landing is Inter at 800 weight up to a
  `clamp(3rem,11vw,9rem)` display. Nothing on the page references the landing's hierarchy.
- **Type ceiling is 19 px everywhere.** All three app `h1`s compute to `19px / 600` (`.title-editorial`),
  so no app surface ever establishes a focal point the way the landing hero does.
- **Motion is nearly absent.** Only `Magnetic` on three buttons, one `Sheen` on one dashboard card, and
  `fade-rise`/`route-pulse`/width transitions inside charts. The landing's `FadeUp`, `CountUp`,
  `LineMaskReveal`, `Tilt`, `useScrub` have zero app usage; nothing reveals in sequence on load.
- **Static loading affordance.** Four dashboard panels show a spinner + text while `ui/skeleton.tsx`
  (and the `.skeleton` shimmer CSS) sit unused with zero importers.
- **Layout rhythm.** `/dashboard` is 5,565 px of uniform flat `#131316` cards with dead space (the
  "Run benchmark" card's left column and the band right of the sparkline), and the Model Pool table's
  721 rows are unpaginated, which is why the page is 9,905 px tall at 375.

## 4. Deliverable: files Job 1 / Job 2 will change

Job 1 (M2) — 2 files, 1 deletion, 0 dependency changes:

| File | Change |
| ---- | ------ |
| `src/components/motion/cursor.tsx` | **delete** (276 lines; owns the only `cursor:none`, the bracket, ticks, tip and press pulse) |
| `src/components/motion/motion-provider.tsx` | remove the import (`:3`) and `<Cursor />` (`:11`); keep `SmoothScrollProvider` and the `children` |
| `src/app/[locale]/layout.tsx` | no change (mounts `MotionProvider`, which stays) |
| `package.json` | no change (nothing to uninstall) |

Job 2 (M3–M6) — the surfaces and their animation gaps:

- Dashboard: wire the existing `Skeleton`/`SkeletonLines` into the four spinner sites, animate
  `Sparkline` + `Donut` (the two that don't move), stagger the seven sections with `FadeUp`, add
  card hover depth (`tilt`/`.sheen`), animate the run-report swap, add scroll-driven reveals with
  `useScrub` for below-fold panels.
- Chat: per-bubble CSS entrance (mount-keyed, never state-per-frame), animated streaming indicator in
  place of the plain spinner (50-55), input focus treatment, model-badge/cost-chip entrance, and keep
  the existing smooth `scrollIntoView`.
- Run view: panel stagger on the 8 D6 panels in exact order, evidence counter `CountUp`, smooth
  transitions on live event application, contradiction/replan marker animation, styled run picker +
  replay-swap transition (no new controls).
- Others: `/app` empty state, `not-found.tsx`, `/analytics-demo` (restyle or log), admin (no pages —
  log as absent).

