# UI/UX Take 6 — verification report (§15)

**Brief:** `AGENTOS_UIUX_PROMPT_V6.md` — karma.business Line System, Faithful Observed
Edition, executed in this repo.
**Owner rulings in force:** "Execute V6 in the repo myself"; on the deletion conflict,
"V6 governs — replace it"; "DO IT FAST N QUICK"; the permanent §1.1 rule ("do not remove
any animation … only ADD animations, more and more, non-basic ones").
**Artifact measured:** production build in `.next-t6`
(`NEXT_DIST_DIR=.next-t6 npx --no-install next build`) served by
`next start -p 3400`. Controls: `:3300` frozen V5 artifact (labelled BEFORE),
`:3100` V4 build (no V5/V6 code at all). `:3000` is the owner's dev server and was never
touched by this run.
**Git state:** nothing committed by V6. HEAD is `a92779b`
("docs(uiux): confirm the wheel fix on the owner's dev server and recount the bundle");
`git status --porcelain` is 54 paths (20 `M`, 34 `??`). No commit or push was authorised.
**Spend:** $0. Zero paid-model requests across every sweep (§11.4 gate in
`_lh/harnesses6/t6-m10-inventory.json` → "0 of 0 matched requests"). Localhost only: the
three sweeps made 128 requests, all to `localhost:3100/3300/3400`.

---

## 1. Headline numbers

| Requirement (§11) | Budget | Measured on the V6 artifact | Where |
|---|---|---|---|
| 60fps | no dropped frames | unthrottled scroll, 2 arms: **60.0 / 59.7 fps mean**, p95 16.9ms both, worst frame 17.1ms and 50.0ms, frames over 2ms 0% and 0.2% | `_lh/t6-m9-fps.json` (`arms.free_v6`) |
| 4× CPU throttle band fps | must beat the V5 overlay it replaces | **V6 31.0 fps vs V5 22.4 fps** (Δ +8.6, 3/3 interleaved rounds) | `_lh/t6-m9-fps.json` (`medians`) |
| LCP | < 2.5s | **368ms** on :3400 (vs 480ms on :3300, Δ −112ms) on a 20695px document | `_lh/t6-m9.json` |
| added bundle | ≤ 50KB gz | **25,457 bytes gz** across 11 V6 files (49.7% of the 51,200B budget) | `_lh/t6-m9.json` (`addedGz`) |
| wire delta | reported | **+6,721 bytes** encoded (19 assets, 526.3KB vs 519.7KB): 17 byte-identical (467.0KB), 2 V6-only (59.2KB: the landing CSS chunk 16,738B + one JS chunk 43,922B) against 2 V5-only (52.7KB) | `_lh/t6-m9.json` (`v6`/`v5`) |
| new heavy deps | none | **0** — `git diff HEAD -- package.json pnpm-lock.yaml` is empty | repo |
| reduced motion | static terminal state, no rAF | verified per job: M3 g21 (no sticky pin, 5/5 steps readable in flow, static canvas ink 50146, docH 14375 vs 20695), M4 g14 (comet offsets 1546/1546/1534 already at the terminal shape, transition seconds 1e-06, band PNGs 900ms apart **byte-identical**), M5 g14 (dashoffset travel 0.000px across 22 strands / 181 frames), M6 g16 (19 rays offset 0, 1 distinct hub matrix over 79 frames), M7a g11 (0 travel / 55 frames), M7b g12 (blob matrix held across 3 wheel steps, wordmark rect 0/1) | `_lh/t6-m*.json` |
| hardcoded text | none | decorative layers carry no copy; the pinned stage renders the section's own data (`src/components/landing/pipeline-stage.tsx:32`, labels at `:168`, `:214`) | repo |
| token consistency | AgentOS tokens only | 187 painted colours sampled → 6 distinct, **0 outside the token set**; 11 karma palette values scanned across 275 source files and 259 built files → **0 hits**; repo's own token lint exits 0 | `_lh/t6-m8.json` g1/g2/g3/g7 |

Per-file gzipped additions (`_lh/t6-m9.json` → `addedGz`):
`line-engine.tsx 3293`, `line-shapes.ts 2626`, `pipeline-stage.tsx 3864`,
`hr-band.tsx 2493`, `cable-bundle.tsx 1934`, `ray-burst.tsx 2930`,
`blueprint-marks.tsx 3291`, `karaoke-fill.tsx 1352`, `thermal-blob.tsx 1620`,
`use-idle-pause.ts 768`, `use-scrub.ts 1286`.

---

## 2. Gate scoreboard

| Job | Harness | Gates | Log / evidence |
|---|---|---|---|
| M1 baseline + karma ground truth | `_lh/harnesses6/t6-karma-truth.mjs`, `t6-karma-truth2.mjs` | 14 + 7 observational | `_lh/t6-karma-truth.json`, `_lh/t6-karma-truth2.json`, `docs/uiux-take6-m1-ground-truth.md` |
| M2 line engine | `node --experimental-strip-types --test src/lib/motion/line-shapes.test.mts` | **13/13** | this run (re-run command in §7) |
| M3 pinned carousel + authorised overlay removal | `_lh/harnesses6/t6-m3-pipeline.mjs` | **22/22** | `_lh/t6-m3-rerun.log`, `_lh/t6-m3/` |
| M4 hr-band dividers | `_lh/harnesses6/t6-m4-hrband.mjs` | **17/17** | `_lh/t6-m4-rerun.log`, `_lh/t6-m4/` |
| M5 cable bundle | `_lh/harnesses6/t6-m5-cable.mjs` | **15/15** | `_lh/t6-m5.json`, `_lh/t6-m5/` |
| M6 ray hub burst | `_lh/harnesses6/t6-m6-ray.mjs` | **17/17** | `_lh/t6-m6.json`, `_lh/t6-m6/` |
| M7a blueprint ornaments | `_lh/harnesses6/t6-m7a-blueprint.mjs` | **12/12** | `_lh/t6-m7a.json`, `_lh/t6-m7a/` |
| M7b karaoke + blob + wordmark | `_lh/harnesses6/t6-m7b-karaoke.mjs` | **13/13** | `_lh/t6-m7b.json`, `_lh/t6-m7b/` |
| M8 consistency audit | `_lh/harnesses6/t6-m8-tokens.mjs` | **11/11** | `_lh/t6-m8.json` |
| M9 perf hardening | `_lh/harnesses6/t6-m9-perf.mjs`, `t6-m9-fps.mjs`, `t6-m9-scrubcost.mjs` | **13/13 + 7/7 + 1/1** | `_lh/t6-m9.json`, `_lh/t6-m9-fps.json`, `_lh/t6-m9-scrubcost.json` |
| M10 no-deletions | `_lh/harnesses6/t6-m10-inventory.mjs`, `t6-m10-cursor-apps.mjs`, `_lh/harnesses4/t5-m11-functional.mjs` | **13/13 + 5/5 + 17/17** | `_lh/t6-m10-inventory.log`, `_lh/t6-m10-cursor-apps.log`, `_lh/t6-m10-functional.log` |
| M11 before/after media | `_lh/harnesses6/t6-m11-media.mjs` | **PASS** (21/21 pairs, 0 orphans, 33 PNGs per build) | `_lh/t6-m11-media.log`, `_lh/t6-m11/manifest.json` |

Two of those logs are **labelled re-grades** of a saved walk, not fresh walks
(`_lh/t6-m10-cursor-apps.log` ends with "(re-graded from the saved walk)",
`_lh/t6-m10-inventory.log` says the same): they re-score `_lh/harnesses6/t6-m10-*.json`
after harness fixes so a bug fix is never presented as new evidence. The underlying walks
are the ones taken against :3400 / :3300 / :3100.

---

## 3. §1.2 protected-animation checklist — item by item (§14 M10)

The 42 "keep" rows below are the machine-readable inventory in
`_lh/harnesses6/t6-m10-inventory.json` (`builds.v6.rows`, `g:"keep"`), walked on three
builds (`v6` :3400, `v5` :3300, `v4` :3100) with a 27-position, trusted-wheel traversal.
**Every one of the 42 reads alive on V6, and row-by-row V6-alive == V5-alive (42/42).**
The detector was proven non-blind against the V4 build (30/31 pre-V5 rows light up there;
the one exception is the documented V4 strand-trail case).

### Row 1 — WebGL fluid hero background (V2) — PROTECTED, alive
| Item | Status on V6 | Evidence |
|---|---|---|
| fluid hero canvas present | alive (`main canvas` matched) | `t6-m10-inventory.json` row "WebGL fluid hero canvas" |
| hero canvas count parity | V6 4 canvases vs V5 3 — the extra canvas is §4's line engine, nothing was lost | `t6-m10-inventory.log` "path ledger" gate |

### Row 2 — Native cursor, no replacement (V3) — PROTECTED, alive
| Item | Status on V6 | Evidence |
|---|---|---|
| no `cursor: none/hidden/text-*` declaration anywhere | alive — 6 cursor declarations in the served CSS, all `{not-allowed:3, pointer:3}`, **0 `none`** | `_lh/harnesses6/t6-m10-cursor-apps.json`, gate "native cursor" |
| computed cursor census | landing 1719 nodes `{auto:1585, pointer:114, default:20}`; `/dashboard` 11769 `{auto:11723, pointer:46}`; `/agentos` 474 | same |
| nothing tracks the pointer | alive — 37 candidate overlay nodes, **0 followed the cursor** under trusted `page.mouse.wheel`/`mouse.move` (strict pointer-delta ±30px and loose ≥40px same-sign tests) | same |
| detector self-checks | the scanner was validated on a synthetic sheet (caught `none`, `pointer`, `not-allowed`, `col-resize`); an injected `cursor:none` `<p>` was counted then removed; an injected follower was caught **5/5** by the same code that reported 0 for the product; 0 probe leftovers | `t6-m10-cursor-apps.mjs` `SCAN_SELFTEST`, follower control |

### Row 3 — V4 hero glyph flight / particle-to-text / 3D flip-in — PROTECTED, alive
| Item | Status | Evidence |
|---|---|---|
| hero glyph flight + trails | alive — an element under `main` carries the `_gsap` tween expando | `t6-m10-inventory.json` row "hero glyph flight + trails" |
| hero text choreography still animates | 13 `@keyframes`-free GSAP tweens + `caret-blink`/`nav-*` CSS names survive; V6 keyframe set ⊇ V5 minus the two authorised | `t6-m10-inventory.log` keyframes gate (V5 54 → V6 55) |

### Row 4 — all "impossible" scroll animations (V4) — PROTECTED, alive
| Item | Status | Selector / channel |
|---|---|---|
| diagonal clip-path reveal | alive | `[style*="clip-path"]` |
| architecture self-assembly | alive | `@keyframes dot-rise` (+ `.tilt-depth`, `.edge-glow`, `.sheen`) |
| card-shuffle grid | alive | `.deal-grid` |
| slot-machine counters | alive | `@keyframes slot-land`, `slot-ping` |
| animated routing diagram | alive | `@keyframes route-shot`, `route-breathe` |
| benchmark overshoot bars | alive | `@keyframes bar-grow` |
| paper-fold FAQ | alive | `#faq` row in inventory |
| "The Gathering" word fly-in | alive | gsap state channel |
| parallax layers | alive | `[style*="--sy"]` |
| horizontal showcase pin | alive | `#surfaces` (geometry unchanged: `t6-m7a.json` g8 — 4 cell rects identical with and without V6 ornaments, band 145.5 → 145.5, doc 20695 → 20695) |

### Row 5 — micro-interactions (V4) — PROTECTED, alive
logo stroke-draw (`@keyframes nav-logo-in`), per-letter hover wave (`nav-wave`),
smooth scroll (Lenis `window.__lenis` present, gsap trigger count true), preloader
(`[data-t4="preloader"]` veil + count), curtain-reveal, footer stagger, grain overlay
(`svg feTurbulence`), sweep reveal, pipeline edge draw (`stroke-dasharray` in
`section:has(#pipeline)`), pipeline rework packet (`@keyframes shimmer`) — all alive.

### Row 6 — V5 Job 2 additions — PROTECTED, 11/11 alive
section wipes / text spotlight / background grid (`v5-grid-drift`) / x-ray hover
(`.v5-xray`) / button energy pulse (`v5-pulse`, `v5-shock`, `.energy`) / scroll-progress
thread (`.v5-thread`, `.v5-thread-mark`) — all alive on V6 and on V5.

### Row 7 — Dashboard / Chat / AgentOS app surfaces — PROTECTED, alive
| Item | Status | Evidence |
|---|---|---|
| app motion not thinned | V6 `@keyframes` per route ⊇ V4 (51 vs 43 on `/dashboard`); every animation/transition name ever started on V4 is also seen on V6 (first-frame `animationstart`/`transitionstart` log + name union, not an instantaneous count); **0 paused** animations | `t6-m10-cursor-apps.json`, gate "app surfaces keep their motion" |
| recorder is not blind | an off-screen replay of a V4-only keyframe (`arch-node`, `aurora-a`) was caught **5/5** by the same probe | same |
| data still real | `/dashboard` table settled at **736 rows on V6 == 736 on V5** (polled ≥12 samples, last 4 equal) | same |
| functionality | **17/17** functional gates on :3400 against the :3100 control (chat streaming, dashboard data, run view SSE + replay, auth flows) | `_lh/harnesses4/t5-m11-functional.mjs`, `_lh/t6-m10-functional.log` |

### Row 8 — product functionality — PROTECTED
Covered by the 17/17 functional harness, plus: anonymous `/login → /login`,
authenticated `/login → /app` on both builds (redirect is the session proof), 0 page
errors on :3400, 0 off-localhost requests.

### The one authorised deletion (§1.2) — performed, and provable
| Item | V5 | V6 |
|---|---|---|
| `§3 flow lanes` chunked layer | alive | **gone** (`[data-flow-chunk]` 0 matches) — authorised |
| `§3 halo + core twins` | alive | **gone** (`[data-flow-core]` 0 matches) — authorised |
| `§3 idle pulse` | `@keyframes flow-pulse` | **gone** — authorised |
| `§3 section-enter brighten` | `@keyframes flow-lit` | **gone** — authorised |
| svg path ledger | 73 at peak | 73 − 48 (overlay) + 24 + 23 + 19 + 24 = **115** |

Nothing else vanished: keyframes V5 54 → V6 55, added `v6-hub-pulse`, `v6-march`,
`v6-marquee`. The four dropped rows are the *only* §1.1 exception in the whole walk
(`t6-m10-inventory.log`, gate "§1.2 the one authorised deletion really happened").
Note: the deleted V5 overlay files were **untracked** in git, so the deletion produces no
`D` row in `git status`; the evidence is the harness + the keyframe diff, not git.

### V6's own additions — 16/16 alive, and genuinely new
pinned stage marquee (`.v6-marquee` + `@keyframes v6-marquee`), off-screen pause hosts
(`[data-v6-idle]`), marching cable dashes (`.v6-march` + `v6-march`), breathing ray hub
(`.v6-hub` + `v6-hub-pulse`), hr-band draw-on svg, cable svg, ray svg, blueprint frame +
card corners (`data-t6="blueprint-frame|card"`), karaoke word fill, thermal blob, footer
wordmark outline + fill. Each reads **0 matches on both older builds**
(`t6-m10-inventory.log`, gate "V6's own layers are present and are genuinely new").

---

## 4. Measured-motion evidence (§12 — deltas, not "I wrote the code")

| Job | Measured motion (from the harness JSON) |
|---|---|
| M2 | 13 unit tests: four waypoint families, head glide phases the three lines apart, tail alpha = 1 at head and decays behind it (longer when scrolling fast), morph never writes through the cached buffer |
| M3 | wrapper 5400px = 6×vh, stage sticky `top:0 h:900 overflow:hidden`; stage tops read 0,0,0,0,0 across the pin while the wrapper travelled **3575px**; per-step canvas ink 2035/2222/1802/3095/2213 px; velocity proof — slow arm (peak 380-405px/s) ink 3105 vs fast arm (610-671px/s) ink 3777, **ratio 1.216, fast > slow in 3/3 rounds** (a velocity-blind renderer gives 1.00 and 0/3); diagram edges spread 57.5px (frozen diagram → 0); off-screen canvas ink 7402 with 31 rAF frames in 500ms |
| M4 | 6 bands, authored `d` heads (`M -60 …`), `stroke-dasharray 54px,1600px` ×3, `stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)`; mid-flight **23 samples, max lane spread 1276px** (a shared offset would be 0); heights 108px = 0.12vh, widths 1440, `aria-hidden` on all 4 sampled bands |
| M5 | trunk `stroke-dashoffset` 1 → 0 while scrollY moved 16380 → 19739 over 188 frames, 0 backwards steps; stillness test: 0px scrollY spread over 3.0s yet per-group dashoffset travel **2690.0 / 385.6 / 176.0px** (all-zero ⇒ dead loop) while the scrub-driven trunk moved 0.00px in the same window (⇒ the loops are self-running, not scroll echoes) |
| M6 | 19 rays, distinct ray widths 10/9/7/6 and 4 gradient ids; lit on IntersectionObserver 0.3 threshold: wheel 14688 → 15789, host visibility 0 → 0.762, offsets unlit 1/1/1 → lit 19/19 at 0, **max mid-flight spread across the 19 rays 0.997** (0 ⇒ one shared draw); hub `v6-hub-pulse` 5.5s animating opacity+transform, matrix 1.03998 → 1.00302, opacity 0.9999 → 0.7412, hub rect 220.6 → 212.8 |
| M7a | ornaments drawn in 9 verticals / 176px / 22px pitch; approach settled at scrollY 14216 with band top 1115.7px ⇒ visibility 0 ⇒ unlit 1/1/1/1, then lit 0/0/0/0 over 154 frames, per-path travel 1.000 each; **0 of 8 cards overlap the ornaments**, worst clearance 124.3-144.4px vs 20px padding; layout untouched (cell rects byte-identical with/without ornaments) |
| M7b | karaoke: 21/43 words full at mid, 2 caught in the ramp, first 1 / last 0.25, order preserved, **58 distinct opacity levels over 139 frames**, head range 0.750; word boxes 529.92×96 unchanged during the sweep (Δ0/0 vs :3300), 43 word spans + 42 whitespace spans, `computed == inline` true; thermal blob: 3 layers, sheet 260×260, `blur(34px)`, matrix 1.949 → 2.501 → 2.632 with cross-fading opacities (0.62/0/0 → 0/0.4024/0.2176 → 0/0.0567/0.5633); footer wordmark: rise rect 1/0 → 0.2999/0.7001 → 0/1 across scrollY 19137/19698/19739, wipe `inset(0 100% 0 0)` → 14.11% → 0%, glyph box 1152×136.8 unmoved |
| M9 | pause hosts y 2425 (h5400) / 15589 (h839) / 17345 (h1057) all read `paused` with 0px on screen; counter proof: in-band 106 draws / 27 writes vs off-band **0 draws / 0 writes** with the same control armed; teardown restored (`restored:true`) |

---

## 5. Before/after media set (§12, §15)

Produced by one harness over two builds so a BEFORE and an AFTER frame can only come from
the same code path (`_lh/harnesses6/t6-m11-media.mjs`). Directories are named after the
build — there is no mode flag to forget.

- `_lh/t6-m11/BEFORE-v5-3300/` — frozen V5 artifact, **labelled BEFORE**
- `_lh/t6-m11/AFTER-v6-3400/` — V6 artifact, **labelled AFTER**
- `_lh/t6-m11/manifest.json` — per-frame `scrollY`, document height, section count, page errors, pairing result

Frame set (identical names in both builds): `00-hero-viewport`, `section-NN-<id>`
viewport frame + `clip-NN-<id>` element shot for each of the 12 `<main section>` blocks,
`98-footer`, `99-top-with-nav`, `app-login-anon`, `app-dashboard-top`, `app-app-top`,
`app-agentos-top`, `reduced-motion-hero`, `reduced-motion-mid`.

Landing frames are taken in an **anonymous** context (a signed-in visitor is redirected off
`/` onto `/app`; the first run of this harness shot nine frames of `/app` under landing
filenames, so the contexts are now split and a tripwire aborts the run if `path !== "/"`,
`sections < 11` or the document is shorter than 13000px BEFORE / 19000px AFTER). Sections
are reached with trusted `page.mouse.wheel` in ≤900px chunks because Lenis smooths wheel
input and `scrollTo` would jump past the scroll-linked controllers.

Result: **PASS — 21 BEFORE frames, 21 AFTER twins, 0 orphans**, 33 PNGs per build
(21 viewport frames + the 12 element clips). Measured landing geometry in the run:
BEFORE **14863px / 12 sections**, AFTER **20695px / 12 sections**, 0 page errors on both.

Every pair was audited by eye, not just by filename. The pairs that carry the story:

| Frame | BEFORE (:3300) | AFTER (:3400) |
|---|---|---|
| `section-07-section-7` (Models & routing) | the section with no hub art | the §7 ray burst firing: 19 rays fanned from a breathing hub, purple→orange→yellow hue journey, over the same five route rows |
| `section-02-section-2` (Pipeline) | the plain 5-card diagram | the §4 pinned stage: `STAGE 5 OF 5 / Judge` counter, the rework arc, and the LineEngine canvas mid-morph (concentric loops with a fading tail) |
| `00-hero-viewport` | fluid hero | fluid hero **plus** the §8 blueprint frame (dotted grid, corner ticks, crosshair) and the surviving V5 progress thread |
| `clip-10-faq` | FAQ list | **byte-identical** (46,843 = 46,843 bytes) — V6 adds no art to FAQ, so a zero delta here is "untouched", not "broken" |
| `app-app-top` | chat workspace | byte-identical — app routes were not in V6's scope |
| `reduced-motion-hero` / `-mid` | static states | static states; the mid frames differ a lot (−182KB) because the fixed 12000px wheel lands on a different section of a 20695px document than of a 14863px one — the loop-stop itself is proven by the per-job reduced gates in §1, not by these two frames |

Earlier baseline captures for the same run live in `_lh/t6-before/`
(24 PNGs, `before-00000.png…`, taken before any V6 code landed) and per-job evidence in
`_lh/t6-m3/`, `_lh/t6-m4/`, `_lh/t6-m5/`, `_lh/t6-m6/`, `_lh/t6-m7a/`, `_lh/t6-m7b/`.

---

## 6. Modified files (V6-scoped)

New files (this run): `src/components/motion/line-engine.tsx` (297 lines),
`src/lib/motion/line-shapes.ts` (167) + `src/lib/motion/line-shapes.test.mts` (213),
`src/components/landing/pipeline-stage.tsx` (243), `hr-band.tsx` (153),
`cable-bundle.tsx` (122), `ray-burst.tsx` (187), `blueprint-marks.tsx` (313),
`karaoke-fill.tsx` (81), `thermal-blob.tsx` (81), `src/lib/motion/use-idle-pause.ts` (28).

Modified files (V6 edits; mtimes 2026-10-11 03:11→10:20):
- `src/components/landing/landing-page.tsx` — mounts every V6 layer (`:10-16` imports;
  `:78` KaraokeFill, `:216`/`:408` BlueprintFrame, `:296`/`:397`/`:460`/`:534` HrBand,
  `:327` PipelineStage, `:344` BlueprintCorners, `:435` RayBurst, `:481` CableBundle,
  `:554` ThermalBlob)
- `src/components/landing/pipeline.tsx` — the section keeps its own content and hands the
  stage its data (V6 §4 wiring)
- `src/components/landing/horizontal-showcase.tsx` — §1.2 overlay unwired, V5 layers kept
- `src/components/landing/landing-footer.tsx` — wordmark outline + fill passes
- `src/app/globals.css` — V6 keyframes (`v6-march`, `v6-hub-pulse`, `v6-marquee`) and the
  single off-screen pause declaration at `:1666-1673`
  (`[data-v6-idle='paused'] .v6-march, .v6-hub, .v6-marquee { animation-play-state: paused }`)
- `src/components/motion/cursor-field.tsx:84-86`, `src/lib/motion/hero-shared.ts:10-13` —
  M8 token-fallback removal (colours now resolved from tokens in the browser)
- `tsconfig.json` — `include` gains the artifact type dirs (`.next-t6/*` is this run's
  addition; the `.next-t5`/`.next-devprobe` rows are uncommitted leftovers of Take 5)
- `docs/uiux-take6-m1-ground-truth.md` (new doc), `docs/uiux-decisions-log.md`
  (11 `[V6][Job N]` blocks appended), `docs/uiux-take6-verification-report.md` (this file)

Harnesses and evidence (outside the repo, in the workspace):
`_lh/harnesses6/t6-m3-pipeline.mjs` … `_lh/harnesses6/t6-m11-media.mjs`, their
`*.json`/`*.log` results, `_lh/t6-m11/`, `_lh/t6-before/`, `_lh/t6-m*/`.

---

## 7. Reproduce

```bash
# artifact (never :3000, which is the owner's dev server)
cd repo
NEXT_DIST_DIR=.next-t6 npx --no-install next build
NEXT_DIST_DIR=.next-t6 npx --no-install next start -p 3400

# M2 unit tests
node --experimental-strip-types --test src/lib/motion/line-shapes.test.mts

# verification suite (from the workspace root; :3100 and :3300 must be serving)
node _lh/harnesses6/t6-m3-pipeline.mjs   http://localhost:3400 http://localhost:3100
node _lh/harnesses6/t6-m4-hrband.mjs     http://localhost:3400 http://localhost:3100
node _lh/harnesses6/t6-m5-cable.mjs      http://localhost:3400
node _lh/harnesses6/t6-m6-ray.mjs        http://localhost:3400
node _lh/harnesses6/t6-m7a-blueprint.mjs http://localhost:3400 http://localhost:3300
node _lh/harnesses6/t6-m7b-karaoke.mjs   http://localhost:3400 http://localhost:3300
node _lh/harnesses6/t6-m8-tokens.mjs     http://localhost:3400
node _lh/harnesses6/t6-m9-perf.mjs       http://localhost:3400 http://localhost:3300
node _lh/harnesses6/t6-m9-fps.mjs        http://localhost:3400 http://localhost:3300   # run alone
node _lh/harnesses6/t6-m10-inventory.mjs http://localhost:3400 http://localhost:3300 http://localhost:3100
node _lh/harnesses6/t6-m10-cursor-apps.mjs http://localhost:3400 http://localhost:3100
node _lh/harnesses4/t5-m11-functional.mjs  http://localhost:3400 http://localhost:3100
node _lh/harnesses6/t6-m11-media.mjs
```

---

## 8. Failures and open items — reported, not hidden (§12)

1. **Scroll-listener cost (open since Job 9).** 11 `useScrub` listeners perform
   **14.63 `getBoundingClientRect` reads per frame** in the tail band versus 14.34 inside
   the pinned band, i.e. **86.2% / 93.9% of the reads happen while the layer is
   off-screen**. The §11.1 fps gate passes anyway, and the pause hosts are off-screen with
   0 draws, so the cost was left alone rather than "fixed" by deleting an animation.
   Fixing it properly means rewriting the NEW scrub code to read geometry once per
   rAF batch — not touching old layers.
2. **The tail-arm pause fps delta is unresolvable.** In the 4×-throttled tail arms,
   `v6_far_paused` and `v6_far_free` both mediate **25.8 fps** — the off-screen loops cost
   nothing measurable at that throttle level, so the pause is justified by the draw/write
   counters (106/27 → 0/0), not by fps. Logged as an inconclusive arm.
3. **4×-throttled band p95 frame times are 50–83ms.** At 4× CPU the pinned band does not
   hold 60fps on either build (V6 31 vs V5 22.4 mean fps). On an unthrottled machine both
   arms are 60fps. §11.1 is met on real hardware; the throttled figure is reported because
   the brief demands the ceiling not be able to fake a pass.
4. **LCP run-to-run spread is ±100ms**, so 368ms vs 480ms is a direction, not a precise
   delta. The budget (2.5s) is met with >2s of margin.
5. **Cross-build DOM parity is not a gate.** The computed-census element counts differ
   (11769 on V6 `/dashboard` vs 10816 on V4) because the table has more rows of real data,
   so the gate compares motion *names*, not counts, and the count difference is reported
   only.
6. **The §1.2 deletion is not visible in `git status`.** The removed V5 overlay files were
   untracked, so the ledger evidence is the harness (`[data-flow-chunk]`/`[data-flow-core]`
   0 matches, `flow-pulse`/`flow-lit` absent) plus the keyframe diff.
7. **V4 strand-trail exception.** On the :3100 control build 30/31 protected rows light
   up; the strand trail is the documented exception from Take 5 and is not a V6 regression.
8. **The §4 canvas art crosses the section's own copy (open, visual quality).** The
   before/after audit of `_lh/t6-m11/AFTER-v6-3400/section-02-section-2.png` shows the
   LineEngine loops sweeping through the "THE PIPELINE / Plan. Assemble. Verify. Judge."
   heading block and the first lines of the paragraph at stage 1. The text stays legible
   (the canvas is `pointer-events:none` and the copy is painted above it), and no M3 gate
   measures ink-over-text, so this passed the suite and is reported from the eye check
   instead. Fixing it means re-routing the **new** waypoints (§11.8: adapt the new code) —
   not touching the heading, the paragraph, or any older layer. Owner's call.
9. **Nothing is deployed.** This run is localhost-only by §11.4; no site was published and
   no commit or push was made.

---

## 9. Decision log

`docs/uiux-decisions-log.md` now carries eleven `[V6][Job N]` blocks in the §13 format
(Where / Why / Evidence / Failures / Protected / Still open), appended after the V1–V5
history at lines 891, 938, 997, 1078, 1208, 1357, 1490, 1644, 1764, 1919 and 2060
(Job 11). The file is 2123 lines with 30 balanced fences. The eleven V6 blocks wrap at
≤100 characters (Jobs 1–9) and ≤80 (Jobs 10–11).
