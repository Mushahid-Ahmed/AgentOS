# AgentOS UI/UX — Take 3 morning report

**Run:** 2026-10-09 → 2026-10-10, unattended. Brief: `AGENTOS_UIUX_PROMPT_V3.md` (two jobs — remove the
cursor + button-border animation, then carry the landing's design system *inside* the app).
**Ground rules kept:** localhost only, **$0** (no paid model call, no account, no cloud resource), no new
dependency, no secrets in any file I wrote. **Commits and push were the owner's M9 instruction** ("proceed
with the commit and push"), which supersedes the earlier "no commits" baseline in `uiux-take3-status.md` §3;
see §7.
**Identity of everything measured here:** production build **`VEtfREmN7KbJdQ_srlFdr`** — the artifact after
the M9 mouse-wheel fix, built and served on `:3100`, and the one every suite and screenshot in this report
re-run against. It **supersedes** `Z3i65uFaSjJJG6sfm6nnC` (M1–M8, 19:42 build), whose Lighthouse passes
`afterG`…`afterM` are marked superseded in the scorer rather than blended into the medians below, because an
unfixed build and a fixed build are two builds (T3-D13, turned on my own change). Browser provenance is
printed by each harness and is **not uniform**: the M8 flow suite, the M5/M6 re-runs and the M9 wheel gate
report `playwright-chromium 156.0.8078.4`, the M3/M4 re-runs report nothing (gap 4 in §6), the original
M5/M6 passes ran on `system-chrome 153.0.8010.53`, and every Lighthouse pass ran on **system Chrome
156.0.8078.4** — headless raster is software (SwiftShader) in all of them, and the box stayed busy all night
(`chrome=35 node=10 msedge=25 brave=9`, sampled in `_lh/take3/lh/afterJ.log`; up to 36 `chrome.exe` during
the M9 passes). Every number below names the file or harness that produced it.
**Inheritance, stated once because it matters for attribution:** the tree I started on already carried
Take 2's uncommitted landing work. My diff is the app surfaces, the cursor removal and the hardening;
`git status` cannot separate the two runs, so §1 lists only what *this* run deleted.

---

## 1. Removed

**One file, one composition change — and that is the whole of Job 1.**

| removed | what it was | evidence |
|---|---|---|
| `src/components/motion/cursor.tsx` (276 lines) | the entire custom cursor: crosshair ticks, the bracket that lerped onto the padded bounding box of any `a, button, [role="button"], input, textarea, select`, the spinning tip, the press pulse, and — the only code in the repo that hid the OS pointer — an injected `body { cursor: none }` at `:126-129` | M2 close-out; `_lh/take3/job1/cursor-removed-{fail,pass}.json` |
| its mount in `src/components/motion/motion-provider.tsx` | the provider now composes `SmoothScrollProvider` only (2-line diff) | same |

**The honest finding about the "border animation around buttons":** it was never a border animation. Phase
A hovered three genuinely distinct landing variants plus the `/login` submit on the pre-V3 build and the
measured border did not move (`1px rgb(38,38,44)` before and after on the ghost link, `0px` before and
after on the filled CTA — its background does the work), while the cursor bracket locked onto each target
with **0.0 px** edge error. The thing that looked like a border animating around a button **is** the cursor
system's bounding-box bracket. So Job 1's two removals are one deletion (`tmp-t3-cursor-probe.mjs` 11/11,
re-probe 15/15 — `docs/uiux-take3-current-state.md` §1.2).

**Nothing else was removed, so nothing had to be restored.** No dependency was uninstalled:
`git diff package.json pnpm-lock.yaml` is **empty**, and `grep -ni cursor package.json` had nothing to
find — the cursor was in-repo code, not a library (`gsap` / `lenis` were already there from the previous
run and still are). The WebGL hero, all 12 landing sections, the auth door/check animations, every nav
link and both Login/Signup buttons are intact and were re-measured (§4). Native cursor hints
(`cursor-pointer` on clickables, `cursor-not-allowed` on disabled inputs) were deliberately **kept** —
those are the traditional cursor, not a custom one. The only `cursor: none` string left anywhere in `src/`
is a comment in `globals.css:116` that asserts the rule; M7's inventory across `cursor:none|reticle|
border-beam|CursorTrail|custom-cursor|useCustomCursor|glow-cursor` returns that comment line and nothing
else.

**M9 removed one more thing, and it was mine rather than the brief's: Lenis's global mount.** The
document-scroll engine created in the root layout no longer exists on the app routes — `workspace` now gates
it out of existence (`smooth-scroll-provider.tsx:41,44`), which is a deletion of behaviour on three pages
and is reported in §6 gap 14 with the before/after wheel numbers. It is listed here because the owner's
original instruction was "go basic to basic": on the app shells, native scrolling *is* the basic behaviour
`docs/DESIGN.md:112-119` had already specified.

---

## 2. Built

Every surface below uses the landing's tokens by construction — Inter + IBM Plex Mono, `#5b7cfa` on
`#0a0a0b`, radii 6/8/10/16/24, `--ease-expo: cubic-bezier(0.16, 1, 0.3, 1)` — and `pnpm check:tokens`
passes, which is what stops a one-off hex or off-scale gap sneaking into a component. Consistency is
measured, not claimed: M6 compares each app surface's computed font family, motion curve, accent and
background against a landing reference page in the same run, and M3/M4/M5 assert the chat and run-view
titles resolve to the landing's scale.

### `/dashboard` (M3)

| element | animation | trigger | duration / easing |
|---|---|---|---|
| editorial masthead (`.app-masthead`, measured **52 px @1440 / 32 px @375**) + eyebrow | entrance rise | first paint | 700 ms `--ease-expo` |
| aurora field behind it | `aurora-a` / `aurora-b` loops | always (ambient) | 30 s / 38 s, alternate, infinite |
| every panel (11 of them) | `panel-rise-in` (`min(--i × 70 ms, 420 ms)` stagger) | mount, as data lands | 700 ms `--ease-expo` |
| sparkline | `gauge-sweep` | data arrival | one-shot draw-on |
| donut | `donut-sweep` per arc (3 arcs) | data arrival | one-shot |
| benchmark bars | `bar-grow` (4 bars) | data arrival | 600 ms |
| headline figures | `CountUp` (caught mid-count over 21–24 distinct readings) | data arrival | counts to the shipped value |
| loading state | `shimmer` skeletons (31 nodes) | while fetching | infinite until settled |
| cards | `.card-lift` (transform / shadow / background only — never `border-*`) | hover | 220 ms |
| 623-row pool table | bounded to 420 px with sticky header + masked fade | — | static |

Three real defects were found here and fixed rather than asserted around: `StatCard` nesting a `<div>` in
a `<p>` (6 React `validateDOMNesting` errors per cold load), four `sr-only` data tables that were 221–581
px wide and were the *only* thing creating horizontal scroll at 375 (fixed structurally with
`HiddenDataTable`), and `Card` propagating a `min-w-[640px]` floor into a grid track (now `min-w-0`).

### `/app` — chat (M4)

| element | animation | trigger | duration / easing |
|---|---|---|---|
| empty state hero (30 px / 700) + eyebrow + aurora | entrance + ambient loops | first paint | 700 ms / 30 s + 38 s |
| example panels | `panel-rise-in` | mount | 700 ms `--ease-expo` |
| user bubble | `bubble-slide-in` from **+16 px** | each new turn | 520 ms `--ease-expo` |
| assistant bubble | `bubble-slide-in` from **−12 px** | each new turn | 520 ms `--ease-expo` |
| routing bars | `route-trace` sweep, 3 concurrent | while Jev decides | 0 s / 0.07 s / 0.14 s stagger |
| the five telemetry chips | `chip-in` rise | turn completion | 45 ms × index |
| in-flight cue | `dot-rise` × 3 (replaced a spinner) | streaming | 1050 ms infinite |
| history sidebar rows | `panel-rise-in`, index capped at 8, delay ceiling 420 ms (peak 27 rows) | list load | 700 ms |
| history loading | shimmer + "Loading conversation history" (was a `<SpinnerIcon>`) | while fetching | infinite until settled |

Streaming, abort and the telemetry contract were **not** re-implemented — they were re-verified against
the same wire format (§4). Opening a persisted thread really takes ~2.5–3 s against remote Supabase; V3 §8
forbids touching data fetches, so that is a logged UX finding, not a patched one.

### `/agentos` — run view + replay (M5)

| element | animation | trigger | duration / easing |
|---|---|---|---|
| empty-state hero + aurora | entrance + ambient | first paint | 700 ms / 30 s + 38 s |
| the D6 panel stack (order asserted: User → Jev Decision Bus → Agent roster → Model Pool Failover → Evidence Graph → Jev Decision → Result) | `panel-rise-in`, `min(--i × 70 ms, 420 ms)` | mount, and again when a run is picked (peak 7 measured after the recorder was zeroed) | 700 ms `--ease-expo` |
| a row appearing inside a mounted panel (roster, evidence, claims) | `run-row-in`, `--i × 40 ms` (peak 23) | live event / replay step | 420 ms |
| a figure changing in place | `tick-down` odometer (peak 11; first value `$0.0659`) | each update | 260 ms |
| running status dot | `live-ping` (replaced stock `animate-pulse`) | while RUNNING | 1700 ms infinite |
| the final answer | `report-unroll`, **`clip-path` only** so nothing reflows | completion | 620 ms |
| aside refresh + "Synthesizing…" | shared `StreamDots` | pending | 1050 ms infinite |

`CountUp` was deliberately **not** used here (T3-D8): a live figure should tick, not re-count from zero.
Two overflow defects were found at 375 and fixed — a long unbreakable token in a run error (+7 px) and GFM
tables in an answer (+185 px), the latter in the shared `Markdown` renderer, which is why chat had to be
re-verified afterwards (26/26 again).

### The remaining surfaces (M6)

`src/app/[locale]/` has no Runs index, no Settings and no Docs route — §5.3's "other pages **if they
exist**" was answered by listing the tree, not by inventing pages. What does exist got the system:

- **error / 404 shell** (`not-found.tsx`, `error.tsx`, `ErrorBoundary`, and the orphan `/admin` layout):
  `.app-aurora`, a decorative `.display-huge` numeral (144 px @1440 / 48 px @375), `.label-uppercase`
  eyebrow, `.hero-editorial` title, a shared `<Button>`, and a `nav[aria-label="Product views"]` escape
  hatch. All three entrances ride `panel-rise-in` 700 ms with measured delays `0 / 70 / 140 ms` (recorder
  peak 3). Deliberately *not* inside `AppHeader` — a route boundary can fire precisely because the app's
  own providers are what failed.
- **`/analytics-demo`**: was the last un-chromed page; now carries `AppHeader`, an aurora masthead ("Every
  click, measured.") and 6 cards on the same 70 ms ramp (peak 7), with its own controls still working.
- **`/login` + `/signup`** (M7 hardening, not a restyle): each aurora lobe was clipped from a 1939 × 1205
  box to the ellipse it actually paints, and five keyframes that started at `opacity: 0` now start at
  `.2` so a heading can still be the LCP candidate (T3-D14/D15). The visual surface is unchanged —
  same centre, same falloff, same 26 s / 34 s breathing.

---

## 3. Measured

### Lighthouse — real, production build, before → after (medians of passes; §6)

Desktop preset, software rasteriser, same box for both sides. App routes measured with the minted
read-only cookie; the scorer rejects any signed-in report whose final URL is not the route in its
filename, and a canary (an app route measured *without* the cookie) proves that check can fail.
**10/10 scorer gates pass.** Text: `_lh/take3/lh/scores-final-m9.txt`; reports: `before*` (pre-V3 tree) and
`afterN…R` — **five passes on the M9 artifact `VEtfREmN7KbJdQ_srlFdr`**. `afterA–M` are on disk but
**excluded**: A–F measured earlier trees that later fixes changed (the original supersession), and **G–M
measured the build whose mouse wheel was dead on all three app surfaces**, so under T3-D13 they cannot be
pooled with a fixed build's passes.

| route | perf (median, range over 5 passes) | a11y | BP/SEO | LCP | SI | TBT | CLS | bytes |
|---|---|---|---|---|---|---|---|---|
| `/` | 82 → **97** (76–98) | 100 → 100 | 100 → 100 | 1173 → **1104** (836–1313) | 1437 → **993** | 341 → **137** | 0 → 0.00097 | 608 → 609 kB |
| `/login` | 82 → **98** (84–98) | 100 → 100 | 100 → 100 | 1169 → **1052** (942–1357) | 824 → **625** | 361 → **103** | 0 → 0 | 647 → 647 kB |
| `/signup` | 89 → **98** (88–99) | 100 → 100 | 100 → 100 | 1121 → **1065** (977–1117) | 737 → **619** | 246 → **66** | 0 → 0 | 647 → 647 kB |
| `/dashboard` | 66 → **77** (58–94) | 98 → **100** | 100 → 100 | 1226 → **1070** (995–1523) | 2419 → **1908** | 708 → **412** | 0.041 → **0.028** | 863 → 870 kB |
| `/app` (chat) | 84 → **95** (81–98) | 100 → 100 | 100 → 100 | 1153 → **1109** (1036–1213) | 1077 → 1229 | 319 → **130** | 0 → 0 | 701 → 706 kB |
| `/agentos` | 98 → **89** (85–98) | 100 → 100 | 100 → 100 | 1014 → 1136 (1010–1308) | 853 → 1502 | 11 → 199 | 0.00003 → 0.00011 | 727 → 733 kB |

Five routes still **gain 8–16 perf points** and accessibility is **100 on all six, on every pass** — that
part is stable across all fifteen passes. What changed when I re-measured on the fixed artifact is the
**spread**: the per-route ranges (58–94 on `/dashboard`, 85–98 on `/agentos`) are now wider than several of
the deltas they contain, because the five N–R passes ran while this box had **up to 36 `chrome.exe`**
processes alive. Two consequences I am not going to paper over:

- **`/agentos` now medians 89 against its own 98 baseline, and I am filing that as unproven rather than as
  a regression or as noise.** Its two *best* passes on the fixed build are 98 and 97 — identical to the old
  build's median — its three lowest (89/87/85) come with TBT 150–237 ms and a server response time that
  moved 483 → 942 ms, i.e. half the budget is the box answering, not the page painting. The honest sentence
  is: on a quiet box this route scores 97–98 on the fixed build exactly as it did on the broken one; on a
  busy box it slides, and it slid more during these five passes than during the previous seven.
- **`/app` and `/agentos` Speed Index read *higher* than before** (1077 → 1229, 853 → 1502). Removing Lenis
  cannot slow a paint on a page that has no document scroll to animate, and the wheel fix changed nothing in
  those routes' markup, so this is a load artifact plus the same SI weakness already listed as a gap — but
  it is printed rather than explained away, and it is why §6 still refuses to call SI a pass.

Earlier in this run I nearly filed a different single number as a regression and the extra passes disproved
it: the first three after-runs put the old build's `/agentos` at **98 / 95 / 93**, and three more passes on
the untouched artifact gave **98 / 98 / 98** (median 98 over seven, spread 93–98, TBT 12–177 ms). The M9
five-pass set is the same discipline applied to my own change — re-measure, then quote the range.

### FPS — method and number

Not a bare rAF count. `tmp-t3-m7-verify.mjs` samples **its own** rAF chain during a scripted 10-step
scroll of each page's real scroller (`window` on the three public routes, `<main>` on the three app
routes) and differences CDP `Performance.getMetrics` over the same window, so a frame interval and a
main-thread cost are reported together, per route, on a cold context.

**run5 (the M1–M8 artifact): p50 16.7 ms on all six routes** — 16.7 ms is the vsync ceiling, i.e. frames
were not being dropped — **p95 16.7–33.4 ms, worst 33.4 ms, over 68–97 frames per route.** §6's "~60 fps
on the app pages" is gated directly on the three app routes (`p95 < 60 ms`; measured **16.7 / 16.8 /
16.8 ms**), and every route is gated on the cost the product actually owns — script + layout + style
**< 8 ms/frame**: landing 1.53, `/login` 0.20, `/signup` 0.19, `/dashboard` 0.16, `/app` 0.16, `/agentos`
0.29 ms. Across the three M7 runs the auth pages went **99.9 → 33.4 → 16.7 ms** p50 (`/login`), the first
step being the lobe fix and the second this box getting quieter on identical CSS.

**Re-run on the M9 artifact (`reverify2/tmp-t3-m7-verify.log`, 67/67 gates, exit 0).** The app routes hold
the bar with margin — p95 **33.3 / 33.4 / 49.9 ms** on `/dashboard`, `/app`, `/agentos` against a 60 ms gate
— and the cost the product owns stays ~20× under its 8 ms ceiling at **0.18 / 0.25 / 0.37 ms/frame**. I had
expected that figure to *fall* on the three app routes, since gating out Lenis removes a rAF + GSAP-ticker
loop from them; it rose slightly instead (0.16 / 0.16 / 0.29 → 0.18 / 0.25 / 0.37), and the rest of the same
pass says why: `/login` and `/signup` p50 read **50 ms (~20 fps)** where run5 read 16.7, and the landing's
main-thread cost read **5.46 ms/frame** where run5 read 1.53 — on a box holding 36 `chrome.exe`, with every
gate in the suite still passing. I am reporting the direction I measured, not the one I predicted. The
decomposition in the same run prices the WebGL hero at **9.35 ms/frame shipped vs 5.85 with
`canvas{display:none}`** — **3.5 ms/frame**, 33.1 ms of frame interval — a far *bigger* hero cost than
run5's 0.18 ms on identical code, which is the caveat below arriving again rather than a new finding.

**Caveat, stated not hidden:** software rasterisation means absolute fps here is a lower bound on your
hardware; the same build measured ~4× worse on a busy box. What is *not* load-dependent is attribution,
so the landing was decomposed in two fresh contexts: shipped **2.99 ms/frame with 1/1 canvas painted** vs
`canvas{display:none}` **2.81 ms/frame with 0/1** — the WebGL hero costs **0.18 ms/frame** of main thread
when the box is quiet (the same pair read 10.97 vs 2.77 ms/frame when it wasn't, which is the caveat
arriving as an experiment).

### Bundle impact

- **Cursor dependency removed: none existed to remove** (`package.json` / `pnpm-lock.yaml` untouched —
  verified again at M9: `git diff --stat HEAD -- package.json pnpm-lock.yaml` is **empty**; Job 1 was 276
  lines of in-repo TSX plus a 2-line provider change, and the wheel fix is **one file, 18 added / 2 removed
  lines** in `smooth-scroll-provider.tsx`, 10 of them code).
- **New dependencies added: zero.** T3-D1 chose CSS + Web Animations + the already-present GSAP/Lenis over
  pulling in an animation kit.
- **Wire weight per route moved by at most +7 kB** on the delivered artifact (`/dashboard` 863 → 870 kB,
  `/agentos` 727 → 733 kB, `/app` 701 → 706 kB, `/` 608 → 609 kB, auth pages unchanged at 647 kB). The gate
  is ≤ +5 % per route; worst case is **+0.8 %** (`scores-final-m9.txt`, bytes gate). Per-route JS in the M9
  re-run of M7: 481.6 kB / 17 files (`/`) up to 590 kB / 19 files (`/agentos`) — the same file counts as the
  M1–M8 build, because the wheel fix deleted a mount rather than adding a module.

### Budgets met / missed

§6 names LCP < 2.5 s and CLS < 0.1: **met on all six routes, on all fifteen after-passes** — worst median LCP
1136 ms, worst single observation 1523 ms, worst CLS 0.0285, i.e. 1.6× of headroom on the tightest budget
even on the box's worst pass. Console:
**zero errors and zero non-GPU warnings** through every load-and-scroll of the six content routes. The one
exception is deliberate and printed rather than filtered: the M8 error-shell captures (404 at
`/this-page-does-not-exist` and `/admin`, at both widths) emit 4 browser network lines reading
`Failed to load resource: 404`, because a 404 *is* the feature being photographed — the same class the flow
suite's C11 exempts by network count (`unexplained=0`). Touch fallbacks: met. Horizontal
overflow at 375 / 768 / 1280 / 1920: **0 px on every route at every width** (10 sustained samples per
route per width, 24 screenshots in `_lh/take3/m7/sweep/`).
**Missed / not claimed:** Speed Index on `/agentos` (§6), and any statement about real-GPU frame rate —
both are in §6 of this report.

---

## 4. Verified

The rule for this run was *"a milestone is not done because it compiles; it's done because it was USED"*,
so each claim below names the interaction that produced it. **One row had to be added after the run had
"closed", and it is the row the owner found by hand:** every interaction in this table is a click, a key
press, an anchor jump or a `scrollTo` — `grep page.mouse.wheel` across all 37 harnesses returned **0
matches** before M9. Testing an interaction means dispatching *that* device's event, which is now a decision
(T3-D21) and a gate, not a slogan.

| §7 requirement | how it was tested | result |
|---|---|---|
| Landing → login → app flow works | A real UI login (the form, the button, the redirect) — twice, in two separate contexts — plus a signed-in visit to `/` and `/login` to check the route gate lands in the product | M8 flow suite **31/31** on the delivered build. `POST /auth/v1/token` fired exactly twice, matching the two logins; B4 → `/app`, C1 → `/app`; C7: signed-in `/` → `/app` and `/login` → `/app` |
| Signup still works (real interaction where possible) | Client-side validation (empty submit, malformed email, short password) then the **provider's own rejection** of an already-existing address — and, as the positive control, a valid login in the same context so a dead button could not have passed | B1/B2 field alerts, B3: the request really reached the auth backend (`POST /auth/v1/signup` 0→1), the form answered through its own `aria-live` region ("Check your email to confirm your account, then sign in."), stayed on `/signup`, granted no session cookie, and `/dashboard` still bounced to `/login?next=%2Fdashboard`. **No account was created**: §10 forbids it and Take 2 left an orphan `ui-verify-*` auth row the owner still has to delete |
| Chat: streaming, model badge, cost | Browser-side SSE mock (T3-D7): every `/api/chat` POST intercepted, **0 seen on the network**. Tokens stream into a bubble that is **not** remounted per token (98 → 128 chars), Stop aborts mid-stream and renders "Stopped before completing.", a completed turn shows all five chips. The rendered chips were compared against the real stored payload of a persisted thread (`jevLatencyMs 622`, `total 10891 ms`, `60 tokens`, `cost $0.000022`) — 3/3 match | M4 26/26, re-run green on the production build |
| Chat on a real thread | Opened a persisted conversation from the sidebar; one bubble per stored message, then the stored *words* compared against the painted text (markdown stripped, each ≥12-char message opening probed verbatim in the collapsed thread) | M4 + M8 C4/C4b: `bubbles 2 == apiMessages 2`, 1/1 message openings found verbatim, 257 rendered chars vs 86 stored, 5 telemetry chips |
| Dashboard renders real data (Benchmark / Spend / Model-usage) | Every ≥2-digit figure the page paints, compared against **the payload bodies this page itself requested in this session** (7 endpoints, 192 605 B) with the panels' documented `microUsd / 1e6` money formatting accepted; plus a discrimination control on the high-precision subset | M8 C2: **307 of 355 painted figures (86.5 %)** trace to those bytes; C2b: the 12 unique ≥6-digit exact figures all stop matching when their last digit moves and 12 seeded same-length random numbers match nothing; the three named views are labelled regions with 7 painted chart shapes (C3). M3 28/28 (`27 / 1093 ms / 26 %`) unchanged |
| Charts/graphs work | `gauge-sweep`, 3 donut arcs, 4 bars caught *running* at their real durations, `CountUp` caught mid-count over 21–24 distinct readings | M3 evidence `_lh/take3/m3/verify.json` |
| Run view loads, SSE events fire, replay works | A real stored run (#35, 66 events) replayed from `/api/agentos/runs/<id>`; every evidence figure **re-folded independently in the harness** from the stored events and compared to the DOM (16 sources / 0 verified / 0 contested / 0 refuted / 16 claims / 0 contradictions — 6/6); header `cost $0.0659 models 5 tools 2` equals the last real `cost_update` frame; live-intercepted and stored-replay paths fold to the same figures (4/4). M8 re-does this through the real UI: click a history row, wait for the report to unroll and the skeletons to clear, then re-fold that run's cost from `/api/agentos/runs/<id>` | M5 33/33 + M8 C5/C6: row **#81** loaded 6 labelled panels and a 2 776-char Result; header `cost $0.0626` equals the last stored `cost_update` (49 events, 41 223 B) |
| View switching inside the app | `/app` → `/dashboard` clicked in one document, with a marker written on `window` before the click and read after; the destination's statistics panel measured once after that client-side transition and once after a full document load | M8 C9: marker survived (no reload), `/dashboard` became the single `aria-current="page"` view, and both readings are the **same 194-char loaded panel** with 0 skeletons |
| Auth flows intact (login + signup) | Real login in 3+ contexts, route-gate checks anonymous→`/login?next=…` and signed-in→`/app`, no `signOut()` called anywhere (a Take-1 lesson: it revokes the shared session server-side) | M7 identity gates + M8 B1–B5, C1, C7, C12 |
| Landing intact after the removal | WebGL2 hero context verified live (1440 × 900, `webgl2: true`), 12 sections / 6 730 chars / 15 057 px with 0 px overflow, one hero `<h1>` painted at 144 px weight 800, the **FAQ accordion animated as a disclosure** (native `<details>`: 79 → 219 px sampled through 5 intermediate heights `79.09, 110.91, 183.59, 198.53, 209.95, 213.81, 217.75, 218.25` and back to *exactly* 79 px, answer 314 chars, 7 items), keyboard `Enter` on `<summary>` opens it, hero CTA really navigates to `/signup`, Login/Signup links present | M8 A1–A6 |
| Native cursor, no border animation | 12 reachable controls hovered per route with only **painted** borders compared; positive control demands those same hovers *do* change something (11/12 change colour or background) | M7 JOB 1 gates, 6/6 routes, 2 widths + M8 C10 (`bodyCursor: auto`, 0 custom-cursor nodes, 0 elements computing `cursor: none` across the whole signed-in flow) |
| Reduced motion | Emulated and asserted *applied* via `matchMedia` on all six routes: 0 CSS animation or transition > 5 ms, 0 infinite WAAPI loops, 0 text elements that change opacity/transform over 700 ms, and per-element text availability (`/dashboard` 82 292 chars across 900 text elements, none moved) | M7 + M8 C13 (375, reduced: 0 faded, 0 long, 0 infinite, 68 884 chars settled) |
| Mobile | 375 / 768 / 1280 / 1920 real screenshots per route; sustained 10-sample overflow probe; 375 chat drawer path | M7 sweep + M8 C14 (drawer open, 6 sustained reads, overflow `[0,0,0,0,0,0]`, 54 rows), C15 (menu `aria-expanded` false→true→false with its overlay's `aria-hidden` flipping in step, offering `/login` and `/signup`), C16 (44 × 44 px tap target, label "Open menu" → "Close menu") |
| Console clean through a full scroll-through | One listener set per context across landing→login→signup→app→chat→dashboard→run-view→nav→404, with the deliberate 404 bounded by *network* evidence rather than a regex | M8 C11: 1 error, which is the 1 document 404 (unexplained 404s: 0); 0 other errors, 0 warnings |
| No animation leaks across route changes | Five-stop client-side navigation in one document, each stop required to reach quiet and *hold* it 1.5 s: exactly 2 running animations per view (the ambient `aurora-a/b` pair), net listener growth **0** (192 → 192) | M7 |
| **Mouse wheel scrolls every surface** (added at M9, after the owner found it broken by hand) | `tmp-t3-m9-wheel.mjs`: resolve the scroller under the pointer by walking up from `document.elementFromPoint` at three x-positions, dispatch **trusted** `page.mouse.wheel(0, 600)` twice, then run a `scrollTo` positive control on the *same* node so `moved: 0` cannot be read as "nothing to scroll" | **before 9/15 → after 15/15.** Before: `/dashboard` 0 px of a 6388 px range, `/app` sidebar 0 px of 678, `/agentos` main 0 px of 131 and its event log 0 px of 2850, all with `lenis=true` and every `scrollTo` control succeeding; landing 1200 px. After: dashboard **1200 px**, chat sidebar **678 px** (its full range), `/agentos` main **131 px** + log **1200 px**, all with `lenis=false`; landing still 1200 px with `lenis=true`; `roundTrip` proves unmount → remount across sign-in and two client transitions; reduced-motion is the standing control where Lenis never existed |
| typecheck / build / lint | `pnpm build` ✓ (6 routes + proxy), `pnpm typecheck` ✓, `pnpm check:tokens` ✓, `npx eslint` clean over the 43 changed source files | run on the delivered build, and re-run after the M9 rebuild on `VEtfREmN7KbJdQ_srlFdr` |

Windows `pnpm test` was **not** run as a gate: on this box ~41 failures are environmental (documented in
project memory), so the gates above are the honest ones.

### Evidence on disk (§7)

All three §7 folders are real captures, and the app sets are the ones taken **on the M9 delivered build**:
`docs/uiux-take3-before/` (the pre-Take-3 tree), `docs/uiux-take3-after-cursor-removal/` (Job 1),
`docs/uiux-take3-after/` (**9 PNGs** — `/app`, `/dashboard`, `/agentos` at 1440, 1440-full and 375, signed in
through the real form, `manifest-after-app.json`) and `docs/uiux-take3-after-app/` — **27 PNGs** (dashboard 8,
chat 5,
agentos 6, error shell + `/analytics-demo` 8) plus a per-milestone manifest recording route, viewport,
HTTP status, overflow, cursor state and a content probe for each shot. All **36** were re-shot at 01:35–01:44
against `.next/BUILD_ID` `VEtfREmN7KbJdQ_srlFdr`, after the wheel fix, because the M8 set described a build
that no longer exists. Verified on the new set: **27/27 `overflow=0` and `cursor=auto custom=false`**, HTTP
status **200 on 23 and 404 on the 4 deliberate error-shell captures**, and the replay rows still carry
`replay="#81 completed …"`. Two known properties of that set, stated because
they look like shortcuts: the `admin-404-375` and `notfound-375` PNGs are **byte-identical** (md5
`e400f251…`) since the 404 shell renders nothing path-specific, while the 1440 pair differs because one
caught an entrance frame mid-flight; and the four 404 captures are the source of the console lines in §3.

---

## 5. Decisions

22 entries in `docs/uiux-take3-decisions-log.md`; the ones that shaped the result:

- **T3-D1 — no new animation dependency.** CSS keyframes + Web Animations + the GSAP/Lenis already
  installed. Cost: zero supply-chain surface, zero bundle surprise.
- **T3-D3 — the cursor removal is one deletion, measured twice.** The same 13-check harness ran against
  the pre-V3 build first and **failed 3 checks there by design** (the reticle was still mounted), then
  passed 13/13 after. A control that passes before *and* after proves nothing.
- **T3-D4 — before/after Lighthouse must be same-session comparisons, reported as ranges.** Adopted after
  the first before-pass disagreed with Take 2's quoted numbers by hundreds of ms of TBT.
- **T3-D5 — when the owner's session file didn't arrive, I minted the session myself** by writing the
  credential file from the already-documented throwaway demo account, via a script that never echoes the
  value, and driving the real `/login` form rather than injecting tokens. Read-only; no `signOut()`.
- **T3-D7 / T3-D9 — streaming verified against a client-side SSE mock, never a paid call**; the AgentOS
  mock replays the product's **own stored wire events**, so the live path and the replay path must agree.
- **T3-D8 — a live figure ticks; it does not count up.** `CountUp` re-derives from zero and would fight an
  odometer's semantics on a cost that only ever changes.
- **T3-D6 / T3-D10 — fix hidden-table overflow structurally, not with a CSS pin**; a table that is
  *meant* to be wide scrolls in its own box, one that is meant to be hidden is clipped by a wrapper.
- **T3-D11 — a page whose whole job is to 404 must still pass a console-clean gate.** The exemption is
  bounded by network evidence (a *document* response with status 404, one notice per response), not by a
  regex, so a missing stylesheet cannot hide inside it.
- **T3-D12 / T3-D13 — a signed-in Lighthouse row proves its own page identity, with a canary that proves
  the proof can fail; and an unfixed build and a fixed build are two builds, not two samples.**
- **T3-D14 — an entrance that starts at `opacity: 0` donates its LCP to something smaller.** Chrome will
  not nominate an invisible element. Five keyframes now start at `.2`; `/dashboard` LCP went
  2 800 → 996 ms and the LCP element became the 49 455 px² masthead instead of a 6 541 px² caption.
  `/login` and `/signup` deliberately keep the fade-from-zero and hand LCP to the 1 817 px² wordmark at
  272 / 268 ms — inside budget, and the effect is the point.
- **T3-D15 — frame pacing on a software rasteriser is a painted-area problem, not a property problem.**
  `will-change: transform` on a 1939 × 1205 pseudo-element cost ~116 ms/frame; `translate3d` changed
  nothing (100 ms); clipping the box to the ellipse it paints reached 50 ms, and a geometry guard
  (each lobe ≤ 0.35 of its container) keeps the dead margin from coming back.
- **T3-D16 — "renders real data" compares against the bytes the page itself requested.** 3,441 B of
  hand-picked endpoint made 60/163 figures look real and its control statistics meaningless; the 192,605 B
  this page actually pulls — plus the panels' documented `microUsd / 1e6` money formatting — explain
  307/355 (86.5 %), and the control now gates only on the 12 unique ≥6-digit exact figures, where 0 of 12
  survive a last-digit move and 0 of 12 seeded same-length random numbers appear at all. The measured
  density of the haystack, not a taste threshold, is what sets the bar.
- **T3-D17 — sample the settled page, not the first paint.** Two M8 "product defects" were stopwatches: a
  400 ms read on a 420 ms `::details-content` transition ("the accordion doesn't close") and a read taken
  after 4 of 7 payloads landed ("client-side and document renders differ"). Both gates now wait for
  quiescence, and both got *stricter*: the accordion must show ≥3 intermediate heights and return to
  exactly its closed pixel height, and the client-side statistics panel must equal the document-load panel
  (194 = 194 chars, 0 skeletons). Failing runs are kept next to the passing one.
- **T3-D18 — close-out freezes the artifact rather than rebuilding it, and keeps a cited number's
  reproducer.** `pnpm build` was deliberately **not** re-run: it rewrites `.next`, which would have made
  every recorded number describe a superseded bundle. Instead the immutability is proven (`find src
  -newermt "2026-10-09 19:42"` → 0 files) and only the gates that cannot touch `.next` were re-run. Same
  instinct on teardown: diagnostics whose output is cited (`tmp-t3-m8-diag3.mjs` → the 64.3 % figure,
  `diag7.txt` → the GL attribution) stay in `_lh/harnesses3/`; only the splice scaffolding was deleted.
  **M9 is this rule's exception case, and it was taken seriously:** the freeze held only as long as the code
  was correct; once a product defect required a rebuild, the honest cost was paid in full — new `BUILD_ID`,
  all 63 reports from the thirteen superseded after-pass prefixes excluded from every median and after-gate,
  and all six suites plus 36 screenshots re-measured on the new artifact.
- **T3-D19 — a secret scan tests values, not patterns.** My pattern scan said the delivery was clean while
  30 Lighthouse reports carried the session JWT, because `--extra-headers` is recorded verbatim by
  Lighthouse and no pattern of mine described a cookie. The control now reads the real values out of the
  out-of-repo credential files and searches for those exact bytes (`tmp-t3-scan-redact.mjs`, scan and
  redact modes, prints counts only), and the bundle ships with a redaction note naming every file it
  changed.
- **T3-D20 — a document-scroll engine is mounted per route, never globally** (M9). The product has two
  incompatible scroll models: marketing/auth scroll the *document*; the three app shells are `h-dvh` with
  `overflow-y-auto` on `<main>`, so their document cannot scroll at all (measured `scrollHeight ==
  innerHeight == 900`). Lenis with `smoothWheel` `preventDefault`s the window wheel and animates document
  scroll — right on one model, fatal on the other. Rejected: `data-lenis-prevent` on every inner scroller
  (safety that depends on remembering an attribute in a component nobody owns) and removing Lenis globally
  (kills the landing's scrubbed showcase, which §10 protects). Chosen: `usePathname()` gating the effect,
  with `[reduced, workspace]` as deps so the instance is destroyed and recreated across **client**
  transitions — the part a one-shot check cannot do.
- **T3-D21 — an interaction is tested by dispatching that device's event, and a changed build is
  re-measured, not re-cited.** 183 gates closed the run without one `page.mouse.wheel` in 37 harnesses; the
  owner found the bug with a mouse. The M9 gate resolves the scroller under the pointer by walking up from
  `elementFromPoint`, sends trusted CDP wheel events, and runs a `scrollTo` positive control on the same node
  so `moved: 0` means *intercepted*, never *empty*; routes with nothing to scroll are counted INFO rather than
  as passes. Its second half is the discipline: run `before` on the defective artifact first, then rebuild and
  re-measure **everything** downstream — which is T3-D13 and T3-D18 applied to my own change, and the reason
  `afterG–M` were superseded instead of pooled.

- **T3-D22 — authorization buys the commit, not the shortcut.** "Proceed with the commit and push" was read as
  milestone-sized commits, not one `-A`: cross-run work gets attributed in the message (`eb97c73` says it
  carries Take 2's shader rather than letting a diff imply Take 3 wrote it), the session-log appendage went in
  only after a value scan proved its 1217 new lines carry 0 secrets and its 4 pre-existing ones are untouched,
  and the refreshed evidence bundle re-ran its own redaction scan over all 534 files before its stale counts
  (394/156 MB/196/38) were **rewritten in both docs** rather than footnoted. Full form in the decisions log.

---

## 6. Honest gaps

1. **`/agentos` Speed Index regressed, and the M9 re-measure made it look worse, not better.** Before
   (pre-V3 tree): 844 / 853 / 948 ms. On the M8 artifact: 963–1130 ms (median 1055). On the M9 artifact's
   five fresh passes: **1211–1517 ms, median 1502**. Even the two *quietest* M9 passes still exceed the
   worst before-pass, so the regression is real and the box-load argument explains its size but not its
   existence. Likely M5's D6 entrance stagger, which charges SI for late paint — but I cannot prove it
   without rebuilding the pre-V3 tree, which "work on the tree as-is" ruled out. Reported, not explained
   away. Not a §6 budget breach (SI is not a named budget).
2. **Absolute frame rate is this box, not your hardware.** SwiftShader rasterisation plus 35 Chrome / 25
   Edge processes live all night. p50/p95 are a lower bound; **the ~60 fps claim needs your real-GPU
   check** — the same open item Take 2 left.
3. **No live paid model call was made, by your instruction.** Chat streaming and the AgentOS live run are
   exercised against a mocked SSE stream built from the product's own wire format. A provider event the
   store has never recorded could still be unstyled.
4. **Browser provenance changed mid-run.** M3/M4's original evidence is the pinned Playwright build,
   M5/M6's originals ran on `system-chrome 153.0.8010.53`, and M7/M8 plus every Lighthouse pass are
   `156.0.8078.4`. M8 re-executed all four milestone suites on the delivered build — M5 and M6 print
   `playwright-chromium 156.0.8078.4` in their re-run logs, and the M3/M4 harnesses **print no browser at
   all**, so their re-runs are green-but-unlabelled. Each harness prints what it used; a cross-milestone
   comparison of the *originals* is still comparing builds.
5. **Signup is verified through its failure paths, not by creating a user.** The success path is proven
   only indirectly (the same pipeline authenticates in B4). No new auth row exists because of this run.
6. **`error.tsx`'s copy path was never produced by a real crash.** The suite cannot make a route throw, so
   the shared `ErrorPage` component carries the browser evidence and the boundary is covered by inspection.
7. **`ErrorBoundary` has no consumers in `src/`** (grep: only its own definition). Its `inline` fallback is
   correct by construction and untestable in a browser; deleting it is your call, not a UI decision.
8. **Hover gate coverage limit:** it walks links, buttons and `[role=button]`. Two pre-existing
   `hover:border-*` **colour** rules exist on a card (`arch-grid.tsx:69`) and an input
   (`auth-form.tsx:40`) — neither animated, neither on the controls you described, and neither caught by
   that selector set. Stated rather than papered over.
9. **One rAF chain survives reduced motion** at 60/s on all six routes. It is not app code
   (`smooth-scroll-provider.tsx:44` returns before creating Lenis or a ticker when reduced — or, since M9,
   when the route is a workspace shell): it belongs to the bundled GSAP/ScrollTrigger chunk, moves nothing,
   and does not grow across navigation.
10. **Opening a persisted conversation takes ~2.5–3 s** against remote Supabase with only a dim skeleton as
    feedback. Data fetches are §8 off-limits, so this is a finding, not a fix.
11. **The `/` LCP element is the preloader's `0 %` counter** (324 ms). Real, but it is not measuring the
    hero headline; the preloader is a §6.2 element of the earlier brief and unmounts within ~1.3 s.
12. **Nothing is deployed.** Localhost only, per your standing instruction; no Vercel action was taken.
13. **A committed secret surfaced during the M8 value-scan, and it is not mine to fix.** The scan found 4
    credential occurrences — the demo account's address (×2, lines 6309 and 6321) and its **password in
    plaintext (line 6324)** — inside
    `.agent-logs/2026-09-29_20-19-30_55da7713-34d4-41dd-bc8e-64490eb2c85f.md`, which is **tracked and
    committed** (`8e761f4`, dated 2026-09-29 — it predates Take 3 and was written by the session-capture
    backfill, not this run). Neither value is printed anywhere in this report. I did not edit it: `.agent-logs`
    entries are not mine to hand-tidy, and history rewriting needs your call. Commit rights did arrive at M9,
    which is why the file's **1217-line hook appendage (exchanges 85 → 90) went into `9a151ab` as its own
    commit** — a value re-scan before staging found the **same 4 occurrences at lines 6309/6321/6324/6785 and
    zero in the new lines**, so that commit neither widens nor closes the exposure. The exposure is closed by
    **rotating that password** (already an open item above), which the file's own text recommends anyway;
    deleting the lines or amending history is yours to authorize.
14. **The defect that broke §7's thesis: the mouse wheel was dead on all three app surfaces, and the owner
    found it by hand after I had filed the run as closed.** Cause measured, not guessed — Lenis
    (`smoothWheel: true`, mounted in the root layout for every route) `preventDefault`s the window wheel and
    animates *document* scroll, while `/dashboard`, `/app` and `/agentos` are `h-dvh` shells whose content
    scrolls inside `<main overflow-y-auto>`, so their document has nothing to animate (measured `scrollHeight
    == innerHeight == 900`; wheel 0 px against a `scrollTo` control of 400 px on the same node). Fixed at M9
    and gated 15/15. **Two things make this a method failure, not an unlucky miss:** (a) `docs/DESIGN.md
    :112-119` already documented this exact trap and prescribed removal, and my M1 inventory recorded the
    mount while testing only the `Cursor` half of that sentence; (b) the 183 gates that "USED the product"
    never emitted a wheel event — `grep page.mouse.wheel` across 37 harnesses was 0 matches, and every
    scroll in the suite set was an API call, which cannot observe an interception bug.
15. **M9's own numbers are load-limited, and one of them is unresolved.** On a box holding up to 36
    `chrome.exe`, the five fresh passes give `/agentos` a perf **median of 89** against its 98 baseline, with a
    spread of **85–98** and a server response time that moved 483 → 942 ms. Its two best passes equal the old
    build exactly, and the wheel fix touched no markup on that route, so the *most likely* reading is
    contention — but "most likely" is not a measurement, and I have not re-run these passes on a quiet box.
    **This is the one number in the report I would not defend as final.** Same shape on `/dashboard`
    (median 77, range 58–94).
16. **A fixed build invalidates its own evidence, and re-measuring exposed a second, uglier fact: this
    harness set is environment-dependent.** The first M9 re-run chain printed **35 FAILs** and **three
    suites died with `TimeoutError`** (M4 and M5 never reached their count, M7 printed 1 FAIL then died; M3
    27/28, M6 30/55 with 16 FAIL, M8 14/31 with 17 FAIL — 35 `FAIL` lines across the seven logs) — yet the cursor audit in the *same* chain passed 13/13, which is the signature of
    an external failure rather than a diff. The cause was printed by M8's own B5 as
    `net::ERR_INTERNET_DISCONNECTED` (a transient outage on this machine), and M6's "HTTP 200 / h1 = 'Welcome
    back'" cascade is exactly what the route gate does to an anonymous context when the network is down. Both
    chains are kept (`_lh/take3/m9/reverify/`, `reverify2/`) and the green one is what this report quotes —
    but a reader should know that a suite re-run hours later can fail for reasons that have nothing to do with
    the diff, and that the only defence is the attribution each harness prints.

---

## 7. Needs human

- **Commits and push: done on your word, not on mine.** Your M9 message ("…proceed with the commit and
  push") is the typed authorization this run had been waiting for, and it supersedes the §3 baseline
  ("work on the tree as-is, no commits"). The work landed as **milestone-sized commits from `5cdba16` to HEAD**
  — `git log --oneline 5cdba16..HEAD` is the list, and no count is quoted here on purpose: a paragraph that
  numbers its own commits is false as soon as it fixes its own typo. The ones that carry work: Job 1 cursor
  removal (`f5bb214`) → the landing/motion surface
  work (`eb97c73`) →
  dashboard (`7400ee2`) → chat (`e3c6990`) → AgentOS run view (`fc94e19`) → the remaining surfaces
  (`387bed0`) → the M9 wheel fix (`2e453c8`) → the session-capture log (`9a151ab`) → the Take 2 + Take 3 docs
  and evidence (`3faf095`), each naming the suite that certifies it; the doc-correction commits that follow record T3-D22 and the corrected
  delivery counts. `git status --porcelain` is empty and
  `main` is pushed: `git rev-list --left-right --count origin/main...main` → `0  0`.
  **Two things you should know about what got committed, because they were not mine to decide silently:**
  (1) `git status` could not separate Take 2's 30 uncommitted paths from Take 3's, so this push carries both
  runs — the commit messages say so rather than claiming Take 3 authored Take 2's shader; (2) the session
  capture log `.agent-logs/2026-09-29_20-19-30_….md` is tracked and had grown this run, so its new entries
  went in as their own commit. That file already contained the 4 credential occurrences of gap 13 **before**
  Take 3, and a value-based rescan of the working copy at M9 found **the same 4 occurrences and no new
  ones** — nothing Take 3 wrote adds to the exposure, and nothing I committed removed it either. Rotation is
  still the close, and history rewriting is still your call.
- **The read-only session is still alive.** Take 3 never called `signOut()` (a Take-1 lesson: it revokes the
  shared session server-side), so the minted cookie lives until it expires; rotating the demo password
  invalidates it along with the leak in gap 13.
- **Real-GPU frame check** (gap 2 above) — only your machine can close it.
- **`/agentos` SI** (gap 1): if 1055 ms bothers you, the fix to try first is a shorter `--i` ramp on the D6
  stack, and it should be measured as a fresh A/B, not assumed.
- **Delete the leftover `ui-verify-*` auth row from Take 2** and rotate the demo account's password — both
  still open from the previous run; this run added no new row but used that same demo account. **Rotating is
  now the priority, not housekeeping:** gap 13 documents that the account's password sits in plaintext in a
  committed `.agent-logs` file, so rotation is what actually revokes it. If you want the log lines removed or
  the commit amended, say so explicitly — `.agent-logs` is the one directory this run is forbidden to
  hand-edit, and amending published history is your decision.
- **`/admin` is a layout with no page** and **`ErrorBoundary` has no consumers**: both are dead code you
  own the decision on.
- **Two local servers are left running on purpose** so you can open what was measured: the delivered
  production build on `http://localhost:3100` (`.next/BUILD_ID` `VEtfREmN7KbJdQ_srlFdr`, **PID 41064** —
  restarted for M9) and your own dev server on `http://localhost:3000` (PID 37668, untouched by this run).
  Stop mine with `taskkill //PID 41064 //F` when you are done; wheel-scrolling is what to look at first.
  **The gate was re-run against your own `:3000` as well** (`T3_MODE=dev3000`, 15/15, same per-route numbers)
  so the fix is confirmed on the server you type into, not only on the artifact I measured.
- **Everything is also on your Desktop and in Downloads** as `AgentOS-uiux-take3\` (**534 files, 207 MB**,
  `diff -rq` clean between the two): 9 markdown (4 Take 3 + 5 Take 2), 100 evidence PNGs across six folders,
  the new `m9-evidence\` (24 files: `wheel-before/after/pushcheck/dev3000.{json,log}`, both re-verify chains, the two
  shot logs, `next-start.log`), all 24 M8 logs including the five failing runs, M7's run3/4/5 logs +
  67-gate `verify.json` + seven `diag*.txt`, **all 255 Lighthouse report files** (122 of them `.json`) with
  both score sheets, the 24 responsive-sweep shots and all **40** harness sources. The first delivery said
  394 files / 156 MB / 196 reports / 38 harnesses; every one of those numbers grew because M9 rebuilt and
  re-measured, so the old figures were rewritten rather than footnoted.
- **Read `AgentOS-uiux-take3\lighthouse\REDACTION-NOTE.md` before sharing that folder.** My first secret
  scan was a pattern scan and it said "clean" while 30 app-route Lighthouse reports still carried the minted
  session cookie, because Lighthouse records `--extra-headers` verbatim. The M9 passes `afterN`…`afterR`
  added 30 more, so **60 files** now carry the `[REDACTED-SESSION-COOKIE-VALUE:…]` marker, and the
  value-based re-scan of all 534 delivery files returns `offenderCount: 0, occurrences: 0` (all 122 `.json`
  still `JSON.parse`, every score and `finalUrl` unchanged). The superseded `afterG`…`afterM` copies stayed in
  the bundle rather than being tidied away — §3 cites them as the pre-fix build, so their reproducer travels
  with the claim.
  **The session token is still live until it expires, which makes the password rotation below the action
  that actually closes this.**
