# UI/UX Take 2 — running status log

Append-only working log for the unattended run (§11: decide, log, continue).
Final numbers are summarised in `docs/uiux-take2-morning-report.md`.

Environment: `pnpm dev` (Turbopack) on `http://localhost:3000`, Playwright against
pinned `chrome-headless_shell-1248`, **software WebGL (SwiftShader)** — no GPU in
this environment, so no frame rate measured here is GPU-verified.

---

## 2026-10-08

**M1 — Phase A study: DONE.**
- Before-captures taken first, with the mode argument passed explicitly:
  `docs/uiux-take2-before/` (landing/login/signup at 1440 and 375, landing fulls,
  `manifest.json` recording hero canvas kind `2d`, 12 sections, `hScroll: 0`,
  console `[]`).
- Lusion about page studied live: 94 shaders / 47 programs / 47 textures / 25
  FBOs, one fixed 1440×900 WebGL2 canvas, `EXT_color_buffer_float` present,
  document scroll height 900px, 159 unique uniforms. Findings + the honest
  UNKNOWNs (0-frame rAF sample, all-zero readPixels) in
  `docs/uiux-take2-reference-study.md`.
- npm candidates verified present (`three@0.186.1`, `@react-three/fiber@9.8.1`,
  `@react-three/drei@10.7.9`, `ogl@1.0.11`) and deliberately not installed.

**M2 — WebGL fluid hero: DONE.**
- `src/lib/motion/fluid-layer.ts` (engine) + `src/components/landing/hero-fluid.tsx`
  (mount only); `hero-canvas.tsx` (the old 2D dot field) deleted; landing imports
  `HeroFluid`.
- Blocked twice, both found by measurement rather than reading:
  1. React Compiler rejected `gl.useProgram()` as a hook → engine moved out of the
     component (bracket notation does not bypass it).
  2. Hero rendered its fallback with `no-float-render` while a probe canvas on the
     same page supported float. Cause: our own `stop()` called `loseContext()`
     during the StrictMode double-invoke and `getContext()` handed the remount the
     same dead object. Proved by `scripts/tmp-t2-lostprobe.mjs`
     (`sameIdentityAfterLoss: true, remountFloatSupport: false`); fixed by only
     losing the context once the canvas has left the document.
- Added the adaptive resolution controller (T2-D3). Software-rasterisation effect:
  median frame **216.7 ms → 66.6 ms** at `scale 0.40`.
- Verified (`_lh/take2/fluid-check.json`, `_lh/take2/hero-*.png`): hero holds a
  live `webgl2` context, `contextLost: false`, exactly one canvas in the document;
  pointer sweep changes **44.1 %** of hero pixels (mean luminance delta 11.45)
  against a **5.1 %** / 0.85 short-interval floor; idle drift without input
  **33.7 %**; headline band 5.1→242.2 with the bright dye confined to an outer
  band at 9.1→27.7; navigating to `/login` leaves `canvases: 0` and returning
  re-creates a healthy context; reduced-motion control renders the static
  fallback (`fallbackAttr: "reduced-motion"`, `h1` intact, no cursor layer);
  375px touch control renders the shader with `hOverflowPx: 0`; zero console
  errors.
- Method note: `drawImage(glCanvas)` read back `[0,0,0]` on a visibly rendering
  hero, so all pixel evidence comes from composited screenshots.

**M3 — Cursor system: DONE.**
- `src/components/motion/cursor.tsx` rewritten as a targeting reticle: crosshair
  ticks + four-corner bracket that lerps onto the hovered element + press pulse.
- Frame-rate-independent easing added after the harness measured a real defect
  (`snapErrPx` 37.2 / 454.1 at 15 fps). Final: **`snapErrPx: 0`** on the hero CTA
  and on a nav link, `refit: true`, ticks dim to 0.10 when locked and restore to
  0.55, press pulse reaches r 37.8.
- Removed on visual evidence: the decaying polyline trail (read as a stray
  diagonal across the hero) and the full-viewport hairline cross.
- Native cursor hidden only on fine pointers, kept on form fields; nothing renders
  on touch or reduced motion (both measured in M2's controls).

**Gates so far:** `pnpm typecheck` clean, `eslint --max-warnings=0` clean on every
file touched. Production build + `check:tokens` + Lighthouse are M6 work.

**Nothing committed, nothing pushed, nothing deployed.**

---

## 2026-10-09

**M4 — per-section landing animation: DONE.**

One new primitive drives the whole pass: `src/lib/motion/use-scrub.ts` exposes
`useScrub(travel)` (rAF-throttled passive scroll+resize listener, rect read
inside the frame, band = `0.9vh → 0.9vh + max(220, height × travel)` clamped
against `scrollHeight − innerHeight` so footer elements still saturate),
`scrubSlice(p, from, span)` for stage timing and `drawProps(p)` for SVG
draw-on. Under reduced motion the hook never subscribes and returns 1, so no
section is content-gated. Every consumer reuses the same vocabulary
(`var(--ease-expo)`, `var(--motion-*)`), which is what keeps §6.3's "one
signature ease + duration variety" honest rather than decorative.

§6.2 items, as shipped:
- **3 Pipeline** (`pipeline.tsx`) — five forward edges extend by scrubbed
  `stroke-dashoffset`, nodes lift in ahead of their own edge, arrowheads land
  at q>0.98, the REWORK dash pulses and the PASS terminal closes only after the
  row is drawn, plus an accent packet that runs the 980px row once `p>0.72`.
- **4 Capability cards** — `src/components/motion/tilt.tsx` writes
  `perspective(900px) rotateX/rotateY + translateY(−6px)` straight to the DOM
  (no per-frame React state), feeding the existing `.sheen` `--mx/--my`; the
  icon lifts on `translateZ` via `.tilt-depth`. Pointer+non-reduced only.
- **6 Decision Bus** — `src/components/motion/typewriter.tsx` types the same
  real run-#81 event lines as before, scroll-scrubbed, with a blinking caret on
  the write head; the text is also the accessible content (nothing hidden).
- **9 Architecture** (`arch-grid.tsx`) — glyph paths draw on with `drawProps`,
  cards stagger in, and a lit state (accent glyph + drop-shadow + pulsing node
  dot) arrives per card at q>0.985.
- **10 Benchmark** (`bench-chart.tsx`) — the four run-#6 setups as three metric
  panels (score / cost / latency) whose bars grow on scroll; each metric scales
  to its own best and the winner is the accent bar. Same measured numbers as
  the table below it — a second reading, not a nicer story.
- **8 Models & routing** (`model-routes.tsx`) — the family list redrawn as
  routes: each row's accent hairline draws left→right with a packet riding its
  leading edge, the copy rises in behind it, and the line hands back to the
  plain hairline once the connection is made. Hover re-lights the hairline.
  (This replaced a plain `FadeUp` stagger, which §6.2 does not accept as the
  section's one significant animation.)
- **5 Horizontal showcase** — non-active panels drop to 0.4 opacity / 0.965
  scale as the pinned scrub moves, and the progress hairline thickens to 3px on
  the active segment; the vertical fallback gained `FadeUp` stagger.
- **11 FAQ** — native `<details>` height now animates through
  `interpolate-size: allow-keywords` + `details::details-content`
  (`block-size: 0 → auto`, `content-visibility … allow-discrete`). Semantics and
  keyboard behaviour untouched; degrades to instant open.
- **12 Footer** (`landing-footer.tsx`) — link columns cascade from one running
  index (90 + i×55 ms across all three lists), and the giant AGENTOS wordmark
  wipes open left→right with the scroll while sliding behind the reveal edge.
- **1 Hero / 2 Manifesto / 7 Evidence counters** — already significant from the
  M2/M3 and Take-1 work and left in place: hero `LineMaskReveal` over the fluid
  shader and the reticle cursor, the manifesto's line-mask scroll reveal, and the
  four `CountUp` statistics on first view.

Measured (`scripts/tmp-t2-m4-check.mjs` → `_lh/take2/m4/m4-check.json`),
**26/26 PASS**, dense 110px sweep, each metric asserted to move, move
monotonically and complete: pipeline / bus / arch / routes / bench / wordmark all
`Moves + Monotonic + Completes`; `tiltRespondsToPointer`
`idle "none" → centre matrix3d(… −6 …) → corner matrix3d(0.994226, …, −0.107305 …)
→ afterLeave "none"`; `faqHeightAnimates` box `0px → 139.469px` through
`77.9 → 124.3 → 136.0 → 139.0 → 139.45 → 139.47` with
`CSS.supports('selector(::details-content)') === true`; reduced-motion control
nothing-gated at scroll 0 (all hairlines, bars and dash offsets already at 1,
terminal fully typed); 375px touch control completes and reports
`hOverflow: 0` on both widths; `errors: []`.

Three defects found only by looking at the screenshots, all fixed and
re-verified: the chart printed bare `A/B/C/D` labels (anonymous, read as
placeholder) — now the full `A · single LLM … D · full AgentOS` names; a code
comment attributed the 24-task comparison to run #81, which is the single demo
run — the comparison is run #6 (`docs/MORNING_REPORT.md` §6); and the routes'
copy slid in from `translateX(−12px)`, which hung text outside the column edge
mid-animation, so it now rises on Y instead.

React Compiler-side corrections worth recording: the compiler's
`react-hooks/immutability` rule rejected the Typewriter's per-line `.map` that
mutated an outer `caret` variable (rewritten as plain loops over a `Row[]` with a
`head` reference), and `react-hooks/set-state-in-effect` rejected the
reduced-motion `setProgress(1)` (the hook now *returns* `reduced ? 1 : progress`
and the effect early-returns instead).

**Gates:** `pnpm typecheck` clean, `eslint --max-warnings=0` clean on all eleven
files touched, `pnpm check:tokens` clean, `pnpm build` compiled.

## 2026-10-09 — M5: Login / Signup motion on the existing system (§7.2)

Same canvas, same Inter pairing, same tokens — the auth surfaces were animated,
not redesigned (§7.1). Auth *logic* is untouched: validation rules, the Supabase
calls, the best-effort `provisionCurrentUser`, the door state machine, the
`safeNext` redirect and the aria-live region all behave exactly as before, so
the diff is paint and wiring.

Shipped, per §7.2 item:

- **1 entrance** — the card and its seven steps arrive on CSS keyframes
  (`.auth-stage` 820 ms, `.auth-rise` 640 ms, 60 ms apart, all on the signature
  expo-out). Deliberately CSS rather than JS-flipped inline styles (T2-D17): the
  first painted frame is already the animated start state, so nothing waits on
  hydration.
- **8 directional pairing** — `--rise-x` is −22 px on /login and +22 px on
  /signup, so switching between the two reads as one surface moving rather than
  a page swap.
- **2 background** — two accent gradient lobes on 26 s / 34 s alternating
  transform loops, CSS-only by decision (T2-D16); the harness asserts
  `canvases === 0` on both auth routes.
- **3 fields** — on focus the label lifts to primary text, an accent hairline
  draws left→right under the control and an 18 %-accent ring glows. The input's
  own `:focus-visible` outline stays: additive, never a replacement.
- **4/5 CTA** — lift + accent shadow on hover, settle on press, click ripple
  painted by `<RippleLayer />` (T2-D20), centred when the click came from the
  keyboard.
- **6 failure** — one 420 ms lateral shake on client-validation failure *and* on
  a rejected sign-in, transform-only, with the error text and `aria-describedby`
  unchanged by it (T2-D19).
- **7 success** — the check draws its own stroke (`pathLength=1`,
  `stroke-dashoffset 1 → 0`) over the dimmed form while the door swings; the
  sign-up "check your email" notice carries the same drawn check inline.

Measured (`scripts/tmp-t2-m5-check.mjs` → `_lh/take2/m5/m5-check.json`),
**24/24 PASS**: entrance sampled mid-flight at stage opacity 0.122 with 6
in-flight frames and 7 distinct stagger delays, `directionX −22` on login vs
`+22` on signup; aurora `::before` `matrix(1.11256, …) → matrix(1.12073, …)`
across 1.2 s with `canvases: 0`; underline `scaleX 0 → 1 → 0`, ring
`none → glow → none`, label colour shift; CTA
`none → matrix(1.012, 0, 0, 1.012, 0, −1)` + accent shadow → `none`; ripple
counts `1 ×23 → 0`; shake `auth-shake → none` with `aria-invalid="true"` and the
message still announced; check offsets `1 → 0.6549 → 0`, screenshotted mid-draw.

§7.4 (the routes still work) is asserted, not assumed: a **real** sign-in
against Supabase for a non-existent address returns the live copy "We couldn't
sign you in with that email and password.", and the success path is driven by a
stubbed token endpoint, so no credential of any kind is typed or logged. The
only non-2xx response in the whole run is the 400 the harness provokes on
purpose (`onlyProvokedRequestsFailed`). Reduced-motion control: first styled
frame already at opacity 1, zero in-flight frames, `directionX 0`; 375 px touch
control settles with `overflow: 0` and a 44 px CTA; type face, accent
`rgb(91, 124, 250)` and the 8 px radii match the landing exactly.

Three of the failures found here were *test* bugs masquerading as product bugs,
and are worth recording so the next reader does not trust a green run blindly:
the email field is `autoFocus`ed, so the "resting" focus measurement was taken
while already focused (blur before measuring); the checkmark poll stopped after
8 samples, i.e. inside the animation's own 90 ms delay (poll to completion and
keep the distinct values); and a `continue` skipped the loop's 30 ms wait,
collapsing the sampling window to a few hundred ms. The product-side find was
real: the stagger's `animation-delay` had to join the reduced-motion guard,
because `fill: both` held the last step invisible for 360 ms even after the
duration was zeroed — content gated behind motion, which §12 forbids.

**Gates:** `pnpm typecheck` clean, `eslint --max-warnings=0` clean on the three
files touched, `pnpm check:tokens` clean.

## 2026-10-09 — M6: Hardening (§8) — production budgets, a11y, mobile, leaks, self-critique

Everything below is measured on production builds served by `next start`: Take 2 on
`:3100`, and the **genuine pre-Take-2 tree** (a `git worktree` at `5cdba16`, `_lh/t2-before`)
on `:3200`, so every claim has a control run next to it (T2-D21). Both sides were
re-measured on a quiet box after the first pair turned out to be contention
(T2-D28); the numbers here are the quiet ones, N=3 per side, no exceptions.

### Lighthouse (§8 first bullet) — three passes before, four after

Desktop, LH 13.5.0, software GPU. Perf scores only; **accessibility, best
practices and SEO are 100 on all 21 reports**, both builds, every route. The 4th
after pass (`after4-*`) is the shipped build; the first three are earlier candidates
of the same design and are kept because the spread argument needs the sample.

| route | before (3 passes) | after (4 passes) | verdict |
| --- | --- | --- | --- |
| `/` | 72 / 93 / 94 | 71 / 94 / 85 / 94 | overlap; the same-build swing (71→94) is larger than the before/after difference |
| `/login` | 79 / 96 / 96 | 81 / 97 / 93 / 97 | parity |
| `/signup` | 79 / 96 / 96 | 80 / 96 / 97 / 93 | parity |

That is why the gate is not Lighthouse (T2-D24). Raw values worth
quoting: LCP `/` 1093–1368 ms before vs 645–1383 after; TBT `/` 148–502 vs
149–525; CLS ≤ 0.0037 everywhere, and the CDP-measured CLS is 0.0009 on all three
after runs.

### Budgets that can actually resolve the change (CDP `Performance.getMetrics`)

| measure | pre-Take-2 | Take 2 | budget |
| --- | --- | --- | --- |
| hero idle, main-thread ms/frame | 0.61–0.70 | 0.71–0.95 | ≤ 8 → **met** |
| full-page scroll, ms/frame | 0.92–1.16 | 1.80–1.95 | ≤ 8 → **met** |
| worst long task in the interaction windows | 0 ms | 57–72 ms | ≤ 200 → **met** |
| in-page LCP | 348 / 540 / 636 ms | 404 / 496 / 516 ms | no regression (after sits inside the before range) |
| CLS (in-page) | 0.0016 / 0.0009 / 0.0009 | 0.0009 ×3 | no motion-induced shift |
| JS on the wire | 483,418 B / 17 files | 493,203 B / 18 files | **+9,785 B (+2.0 %)** — the honest cost |
| total bytes | 586,969–586,975 | 597,721–597,723 | +10.7 KB |

The after column is the **shipped** build (after the a11y fixes and the rebuild), not
an earlier candidate; `RESULT: ALL PASS (50 checks)` three times over
(`_lh/take2/m6/perf-shipped.log`). The pre-fix "after" pair differed by less than
0.2 ms/frame on every row, so none of the conclusions below turned on it — but the
table now quotes the artifact being handed to M7.

No new runtime dependency was installed for this (§12): the +9.8 KB is our own
`fluid-layer.ts` + `use-scrub.ts` + section components, not a library.

**FPS / WebGL, stated honestly.** This box rasterises through SwiftShader, so
presented-frame intervals are not a GPU claim: the hero reads p50 50.1–66.6 ms/frame
after vs 16.7 ms before *under software rasterisation*, which says the shader costs
fill rate, not that it misses 60 fps on a real GPU. §8's "60 fps on integrated
graphics" therefore stays **[UNVERIFIED — no GPU in this environment]**, and the
mitigation is in the product rather than in the claim: the frame-time controller in
`fluid-layer.ts:306-329` trades display resolution for frames, and the harness
proves it fires on every shipped run — display scale walked **1.00 → 0.40** (buffer
576×360 from 1440×900 CSS px) after 5 s of sustained slow frames, asserted as
`PASS: weak-device controller fired`. If a real machine still can't hold frames, the
GL-absent path renders the static gradient, not a broken canvas.

### Leak audit across route changes (§15 DoD)

- 1 GL context per landing mount; **0 live of 1 after client nav** (`lostFlags [true]`), and the auth routes create none of their own.
- rAF chains: landing 3–4 → `/login` 3, identical to a *fresh* `/login` (3) — no loop carried over.
- Listeners: the landing now holds **47** window listeners vs the pre-Take-2 landing's 32 (per-element scroll/resize scrubbing is the cost), but every kind returns to its no-landing baseline after nav within the measured ScrollTrigger scroller-cache allowance `{wheel: +2, resize: +1}` (T2-D22), and repeat auth mounts are flat: net 44 → 44, 44 → 44.
- `pin-spacer` count 1 on both clean landing loads — no stray pinned wrappers.
- Zero hydration mismatches across load + full scroll + 4 route changes; zero console errors; zero app warnings (4 SwiftShader driver messages, counted separately); no "too many active WebGL contexts" ever reported.

### Accessibility (§8) — harness green, and run against the control build too

`scripts/tmp-t2-m6-a11y.mjs`, 3 routes × 4 widths + reduced-motion + touch
emulation: **RESULT: ALL PASS (98 checks)**
(`_lh/take2/m6/a11y-take2-final.log`). Highlights, all measured rather than
asserted:

- **Contrast from rendered pixels**, not CSS declarations: hero eyebrow "Capabilities" 13 px/400 = **9.40:1**, hero body 16 px = **10.21:1**, `/login` h1 = **16.30:1** with its body copy at 9.22:1, each taken as the worst of 3 shader frames — the fluid background does not eat the text. The method is validated by re-measuring the same crops from CSS colours and requiring agreement within 1.5 points (worst spread 0.76).
- **Focus indicators are proven twice**: every Tab stop changes its own computed paint (landing 26/26, auth 7/7), *and* stops are pixel-sampled with the decorative loops frozen — landing 2/2 (`summary.text-text` +3904 px over a 0 px floor), `/login` and `/signup` 3/3 (`#password` +3782, `button.text-text-faint` +718, `a.font-display` +572, all over a 0 floor). The positive controls are in the log: suppressing `outline`/`box-shadow` collapses the landing read 3904 → 0 px and the `#password` read 3782 → 352 px, so the gate reads a ring, not ambient repaint (T2-D27).
- Skip link painted at (16,16) on focus from a parked top of −64, and activating it lands inside `#main-content`; 26 landing stops with no repeats, traps or skips; one `h1`, no skipped heading levels; every interactive element named; no `<img>` without `alt`.
- **Reduced motion** (`prefers-reduced-motion: reduce` emulated): no main-surface text below 0.9 opacity without any scroll, every animation/transition at the 0.001 ms kill switch, native pointer not suppressed, custom cursor not mounted — and **no WebGL context created at all** (0 canvases). That last one was a real product bug found here: the hook's `useState(false)` SSR symmetry means the first effect pass always sees `reduced === false`, so `HeroFluid` was building a full GL context and destroying it a render later (T2-D23).
- **Touch (375 px, `hasTouch`/`isMobile`)**: `(pointer: fine)` false, custom cursor not painted, `body { cursor: auto }`.
- **Accordion**: the FAQ opens with Enter alone — `<details>` box 79 → 219 px with `::details-content` 0 → 139 px, so the answer was genuinely clipped before the keystroke, and the same key closes it.
- **Mobile menu one-handed**: the toggle is 44×44 with `aria-expanded false`; a real
  `page.tap` opens it (`false→true`, 10 links on screen), the open drawer adds no
  horizontal overflow (375 ≤ 375) and every target inside it is ≥24×24 CSS px, and a
  second tap closes it again — the state is symmetric, no page errors. This was a
  **real product bug found by this run**: the overlay is `z-[45]` and the header was
  `z-40`, so `elementFromPoint` at the button's own centre reported
  "…z-[45]…div intercepts pointer events" and Playwright retried the click 51 times
  against a button it could not reach. A touch user could open the menu and only
  close it with Escape — which a phone does not have. Fixed by raising the header to
  `z-50` (T2-D29), verified by `scripts/tmp-t2-m6-drawer.mjs` reading
  `hitTarget: "button.text-text"` while the drawer is up.
- No horizontal overflow at 375 / 768 / 1280 / 1920 on all three routes (12 checks).

**The control run matters more than the green run** (T2-D26): the identical harness
against the untouched pre-Take-2 build fails **8 checks — all of them the same
defect**, `a.text-accent` switch links at 50×17 / 41×17 px on `/login` and `/signup`
at every width. Take 2 fixed a bug it did not cause, with `px-1 py-1`/`py-1.5`
padding rather than a spec exemption (T2-D25), and the framing here is "fixed", not
"never existed".

### Hostile self-critique (§8)

| attack | finding | status |
| --- | --- | --- |
| shader jank on integrated graphics | Cannot be measured here (SwiftShader only); the in-product controller is proven to walk resolution 1.00 → 0.40 and the GL-absent path is a static gradient. | **Known gap: needs a real laptop.** |
| cursor stuck visible on touch | Not painted at 375 px touch; `cursor: none` lives inside `@media (hover: hover) and (pointer: fine)`. | Fixed and asserted. |
| scroll trap in the showcase | Full-page wheel traversal completes (214–223 frames/7.4–7.6 s, p50 33.3 ms), exactly 1 `pin-spacer` on clean loads, and Lenis `anchors: true` so nav links still jump. | Met. |
| animation-induced CLS | In-page CLS 0.0009 on all after runs; entrance animations are opacity/transform only; `::details-content` keeps the answer's intrinsic height while clipping, so the disclosure does not reflow neighbours. | Met. |
| unreadable muted text on dark | 9.40:1 / 10.21:1 / 16.30:1 measured from pixels over the live shader. | Met. |
| dead hover states on touch | Two hand-written rules (`.sheen:hover::after`, `.auth-cta:hover`) were **not** media-gated the way Tailwind v4 gates its own `hover:` variants, so a tap left the glow lit / the CTA lifted. Both now live in `@media (hover: hover)`; `:active` stays ungated because that *is* the tap. The one JS hover (`onMouseEnter` → door nudge) already had its `onMouseLeave` counterpart. | **Fixed here** (found by reading the built CSS against the source, not by a check that already existed). Rebuilt (`pnpm build` EXIT 0), server restarted, and both the 98-check a11y run and the drawer probe were re-run against that bundle. |
| mobile drawer you cannot dismiss | The overlay painted above its own close button; a touch user was stuck with the menu open. | **Fixed here** — see the mobile-menu bullet above. |
| form validation broken on auth pages | M5 closeout drove a real Supabase rejection and a stubbed success: copy, `aria-invalid`, `aria-describedby` and the shake all fire, auth logic untouched. | Met, and re-verified in M7. |
| tap targets | 17 px-tall inline links — pre-existing (see control run), now ≥24 px. | Fixed. |
| leaks across route changes | See the leak audit above; the allowance for third-party scroller caches is explicit, not waved through. | Met. |

**Gates on the shipped build:** `pnpm typecheck` ✓, `eslint . --max-warnings=0` ✓
(exit 0 — the two warnings were in the scratch harnesses themselves: an unused
`KEYS` array and an unused probe local, both removed rather than silenced),
`pnpm build` ✓ (EXIT 0, `_lh/take2/m6/build-m6-final.log`), `pnpm check:tokens` ✓.
M7 re-runs the same four against the final tree.

## Next

M7 only: `docs/uiux-take2-after/` captures at 1440 + 375 on every surface, the
working-feature checklist (landing → login → signup → app → chat → dashboard →
run view, with **no paid model API call**), §14 morning report and §15 DoD. The
open gaps M6 hands forward are listed in its self-critique table: GPU-frame-rate
verification (needs a real laptop) and the chat-streaming proof, which has no mock flag
in `src/` and so must be shown from stored run data / replay or logged as a gap.

## 2026-10-09 — M7: Final verification (§14, §15)

### After-captures — `docs/uiux-take2-after/`

`scripts/tmp-t2-m7-shots.mjs` against the shipped production bundle on `:3100`,
mode passed explicitly (`T2_MODE=after`): **28 captures + `manifest.json`, `RESULT:
ALL PASS`, `consoleErrors: 0`, max horizontal overflow 0 px**. Coverage: landing at
1440 (twelve per-section frames, a mid-showcase frame, the footer, and a full-page
frame), landing at 375 (idle / mid / footer / drawer open), reduced-motion hero and
section controls, `/login` and `/signup` at 1440 and 375, plus two auth states that
only exist mid-interaction (`login-1440-field-focus`, `login-1440-error`) and the
gate itself (`route-gate-app-to-login`). The pre-Take-2 pair stays in
`docs/uiux-take2-before/` (8 PNGs on 6 route×width records, taken in M1 from the
`5cdba16` tree on `:3000`).

### Working-feature checklist — `scripts/tmp-t2-m7-verify.mjs`

Public flow on the shipped bundle, **`RESULT: ALL PASS (50 checks)`**
(`_lh/take2/m7/verify-run4.log`). Landing reveals, counters, cursor bracket lock,
nav-to-anchor, login and signup forms, the *real* rejection paths (400/429 from
Supabase for `@uiux-take2.invalid`, provoked on purpose and separated from genuine
errors rather than filtered out), the shake, the ripple that paints and removes
itself, `role="alert"` announcement of field errors, and the gate. Three of its
checks were rewritten after being caught unable to fail — T2-D31.

### App surfaces (chat / dashboard / run view) without a session

The one §15 line that cannot be satisfied honestly by a signed-out browser is
"chat streams; dashboard renders real data; run view replays" — no session exists in
this tree, §12 forbids creating one or paying for a completion, and §10 puts the auth
and LLM code off-limits. What was done instead: the product's own documented
fail-open path, reached by a **second production build** of the same source whose env
carries no credential at all (`_lh/harnesses2/t2-failopen-isolated.sh`, T2-D32),
served by `next start` on `:3110` while `:3100` stays as the gated control.

`scripts/tmp-t2-m7-appsurfaces.mjs` → **`RESULT: ALL PASS (45 checks passed, 4
disclosed gap(s))`**, captures in `_lh/take2/m7/failopen-shots/` (deliberately not
in the before/after pair — they show empty and error states, not populated data):

- control: `/app` on the configured server is gated → `/login?next=%2Fapp`;
  preflight: the credential-free build serves `/app` (HTTP 200, 378 ms).
- `/app`, `/dashboard`, `/agentos` at 1440 and 375: correct URL, HTTP 200, real
  shell (composer / ≥4 sections / run-replay aside), Inter body, cursor mounted
  294–350 ms after load, 0 px horizontal overflow at 375, no unexpected console
  errors.
- `/api/dashboard`, `/api/agentos/runs`, `/api/spend` → 500 with `{"error":…}` and
  0 rows, asserted as the *expected* consequence of a placeholder database, so the
  gaps below cannot be mistaken for fixture data passing as live.
- ledger: **307 requests, 1 host (`localhost:3110`)**, no POST to `/api/chat`, no
  non-GET API call at all. **Zero model-provider traffic, and on this instance none
  was possible.**
- GAPs, stated as gaps: populated dashboard charts, run replay from stored history,
  streamed chat completion.

Three runs of this harness are logged, all kept: 41 checks/**4 failed**, then
42/**3 failed**, then the 45 above. Every failure was a harness bug, not a product
one (the pre-hydration cursor sample and a single blank-surface character budget) —
T2-D32. The request count moves across those runs (322, 325, 307) because retries
move; **the host set is `localhost:3110` in all three.**

### Final gates, on the tree as handed over

`pnpm typecheck` ✓ · `eslint . --max-warnings=0` ✓ · `pnpm check:tokens` ✓ ·
`pnpm build` ✓ — `_lh/take2/m7/final-gates.log`. The Take-2 harness family was
re-run against the rebuilt bundle after the `role="alert"` change rather than
carried over (T2-D31's obligation): fluid ✓ (one live `webgl2` context, 0 canvases
after client nav, healthy on return), cursor ✓ (`snapErrPx: 0`, ticks restore to
0.55), m4 ✓ 32/32, m5 ✓ 24/24, and the M6 a11y gate ✓ **98/98**
(`_lh/take2/m6/a11y-take2-m7.log`).

### What M7 changed in the product

One file, one line pair: `src/components/auth/auth-form.tsx` field errors now carry
`role="alert"`, because the checklist proved they were painted but never announced.
Everything else this milestone was harness work.

### Teardown — T2-D33

- All 22 `scripts/tmp-t2-*.mjs` harnesses moved out of the repo to
  `_lh/harnesses2/` (Take-1 precedent: the app ships without a second test runner).
  Docs above cite them by their pre-teardown `scripts/…` paths; the files now live at
  `_lh/harnesses2/<same name>`. The launcher resolves `@playwright/test` from the
  repo, and the six relative artifact paths plus the two capture paths were
  repointed so re-runs land in the same places.
- Proof the relocated family still runs: a launcher smoke test on the shipped bundle,
  then `tmp-t2-m7-verify.mjs` from its new path → **`RESULT: ALL PASS (50 checks)`**
  (`_lh/take2/m7/teardown/`).
- Scratch build trees deleted: the pre-Take-2 control worktree `_lh/t2-before`
  (re-creatable with `git worktree add` from `5cdba16`) and the credential-free copy
  `_lh/t2-failopen-app` (re-creatable by `_lh/harnesses2/t2-failopen-isolated.sh`).
  `git worktree remove` could not delete either tree on Windows (`Filename too
  long`); `robocopy <empty> <target> /MIR` did. `_lh` is now 93 MB.
- Servers: `:3110` (fail-open) and `:3200` (control) stopped by port lookup; the
  user's `:3000` dev server was never touched; **`:3100` still serves the shipped
  Take-2 bundle** (`/`, `/login`, `/signup` 200; `/app` 307 →
  `/login?next=%2Fapp`).
- Superseded/unusable scratch deleted after a cite-check against these docs:
  `scripts/tmp-t2-png.mjs`, `_lh/harnesses2/t2-failopen.sh`, `_lh/chk.js`,
  `_lh/chk2.js`, `_lh/harnesses2/pixel-block.txt`, `_lh/take2/m6/run5.log` (a bad
  invocation, no evidence value).
- Credential sweep: no `.env*` file remains anywhere under `_lh`, and the only
  remaining Supabase mention is variable *names* in a script. `repo/.env.local` is
  the single live copy (gitignored, untouched, never printed).
- Gates after the move (`_lh/take2/m7/teardown-gates.log`): `pnpm typecheck` ✓,
  `eslint . --max-warnings=0` ✓, `pnpm check:tokens` ✓.
- Tree as handed over: **30 uncommitted entries** (17 untracked = 7 Take-2 docs + 10
  new source files; 12 modified; 1 deleted). **Nothing committed, nothing pushed,
  nothing deployed.**

## Take 2 status: M1–M7 DONE, awaiting commit authorization
