# UI/UX Take 6 — ground truth (M1, 2026-10-11)

`AGENTOS_UIUX_PROMPT_V6.md` §2 makes specific numeric claims about
`https://www.karma.business/`, and §12 then requires that I verify rather than
trust them, because Jobs 3–6 are built on those numbers. Every claim below was
measured by me in a hardware-ANGLE headless Chrome (`system-chrome 153.0.8010.53
-> ANGLE (Intel Iris Xe, D3D11)`) at a 1440×900 viewport, seeking with real
`page.mouse.wheel` steps — the reference runs Lenis, so a synthetic `scrollTo` is
not the input channel a reader uses.

Instruments and evidence:

| Instrument | Gates | Evidence |
|---|---|---|
| `t6-karma-truth.mjs` — §2 claim sweep, 15 wheel-seeked stage depths + 12-depth walk | 10 PASS / 4 FAIL (of which 2 were my own instrument bugs, fixed in pass 2) | `_lh/t6-karma-truth-run1.log`, `_lh/t6-karma-truth.json`, `_lh/karma2/stage-*.png`, `_lh/karma2/walk-*.png` |
| `t6-karma-truth2.mjs` — corrected census / karaoke / stage count / paid-call scope | 6 PASS / 1 FAIL (the FAIL is the karaoke scroll-linkage, see below) | `_lh/t6-karma-truth2-run1.log`, `_lh/t6-karma-truth2.json`, `_lh/karma2/census-step*.png` |
| `t6-before.mjs` — karaoke scroll-linkage attempt + BEFORE captures of my product | 25 labelled BEFORE frames | `_lh/t6-before-run1.log`, `_lh/t6-before.json`, `_lh/t6-before/*.png` |

## §2 claims, verdict by verdict

| §2 claim | Verdict | Measured |
|---|---|---|
| 2.1 no global line layer; lines live inside their own sections | **[VERIFIED]** | 0 svgs span >50% of the 14747px document; largest svg is 6.1% of it |
| 2.1 pinned stages: tall wrapper + `sticky top-0 h-[100svh] overflow-hidden` | **[VERIFIED]** | exactly 4 such stages, all `overflow:hidden`, stage height 100svh |
| 2.1 "roughly 300–500vh" wrappers | **[CORRECTED]** | wrappers are 500 / 355 / 240 / 200vh — the range starts at 200vh, not 300vh |
| 2.1 the four stages are "hero, how-it-works, inside-karma, dark results" | **[CORRECTED]** | the hero is *not* pinned (its WebGL sheet sits in normal flow at docTop 445); the four pinned stages are HOW IT WORKS (canvas), [ INSIDE KARMA ] (21 svg paths), WHY IT WORKS (WebGL), and a fourth dark stage (WebGL) |
| 2.2 the centerpiece is a CANVAS rendering 3 thick strokes | **[VERIFIED]** | one 2D canvas 1430×900 `absolute inset-0 size-full` inside the HOW IT WORKS stage; 7 distinct 24×14 occupancy signatures across 15 wheel depths, so its content morphs with scroll |
| 2.2 three colours: peach, red-orange, violet | **[VERIFIED]** | pixel census at step 1: `rgb(255,69,0)` 37%, `rgb(107,78,255)` 34%, `rgb(255,184,153)` 29% — exactly `--color-accent-bright`, `--color-violet`, `--color-peach` |
| 2.2 strokes ≈1.2–1.8% of viewport width | **[VERIFIED, at the low end]** | per-column contiguous ink runs 13–20 CSS px at 1440 wide = 0.97–1.39% of viewport width; diagonal crossings under-read, horizontal ones land inside the claimed band |
| 2.2 gradients along the stroke + fading tails | **[VERIFIED visually]** | `_lh/karma2/stage-02-1675.png` shows each stroke's head at full colour trailing into a dotted, lower-alpha tail |
| 2.3 four per-step shape families | **[VERIFIED, two details corrected]** | family 1 horizontal sweep in from the right (`stage-02-1675.png`); family 2 full-width stacked arcs (`stage-04-2508.png`) — but the measured stack order top→bottom is **violet / red-orange / peach**, the reverse of the brief's "peach highest"; family 3 concentric C-arcs wrapping the centred headline (`stage-07-3354.png`); family 4 parallel S-curved cables on one side exiting an edge with the text on the other (`stage-11-4614.png`) — running **lower-left → upper-right**, mirrored vs the brief's "upper-left → lower-right" |
| 2.4 hr-band `viewBox 0 0 1320 420`, 3 paths, strokes 9/9/11, dasharray `0px,1600px` | **[VERIFIED]** | found: 3 paths, stroke-widths {9,11}, dasharray `0px, 1600px`, 3 gradients |
| 2.4 band `viewBox 0 0 1440 720`, 60px trunk + 22 dashed satellites, rhythms `2,10` / `40,14` / `120,30` | **[VERIFIED exactly]** | 23 paths, stroke-widths {60, 1.6, 0.9}, dasharrays exactly those three rhythms, trunk `d` byte-identical to the brief's string |
| 2.4 rays `viewBox 0 0 1440 680`, 19 quadratics from hub 720,640, widths 6–10 | **[VERIFIED exactly]** | 19 paths, all 19 quadratic, widths {6,10}, hub path `M720 640Q405.00 640.00 20 640` |
| 2.1/2.5 palette in CSS variables | **[VERIFIED]** | `--color-peach #ffb899`, `--color-accent-bright #ff4500`, `--color-violet #6b4eff`, `--color-sun #ffc23d` |
| 2.5 blueprint ornaments in `rgb(255,69,0)`, dotted `1px 1px` grids | **[VERIFIED]** | 26 strokes compute to `rgb(255, 69, 0)`, the dotted ones at `1px, 1px` dash and 1.5px stroke (the brief's "1–1.5px" is right) |
| 2.5 word-by-word karaoke fill | **[UNKNOWN]** | word-span blocks with per-word alpha-varying colours do exist (white, `oklab(… / 0.8)`, `oklab(… / 0.55)`, peach) — the structure a karaoke fill leaves — but I never observed the vector change with scroll: my first detector demanded opacity deltas, and the second latched onto an auto-advancing testimonial card whose rect moves under transform. Job 7 implements the effect as prescribed; the reference's scroll-linkage is not claimed as verified |
| 2.6 stack Lenis + Framer Motion + THREE | **[PARTIAL]** | Lenis confirmed (`window.lenis` is an object); Framer and THREE are not detectable by global or script-src probes (they may be bundled and minified). §2.6 is context only and says not to migrate, so this does not gate anything |

**Net:** the architecture claims V6 is built on — per-section pinned stages, no
global overlay, a morphing 3-stroke canvas, and the three SVG illustrations with
their exact viewBoxes, stroke widths and dash rhythms — are all confirmed by my
own measurement. The corrections (wrapper range, stage identities, arc stack
order, family-4 direction) are cosmetic for my build, since §4 and §7 require
AgentOS tokens and my own choreography, not karma's values.

## The one authorized deletion (§1.2)

| What | Where |
|---|---|
| The V5 line-overlay component (Job 1 of V5) | `src/components/motion/flow-lines.tsx` (whole file, 26885 bytes) |
| Its import and mount | `src/components/landing/landing-page.tsx:28` and `:158` |
| Scroll listeners installed only for it | inside `flow-lines.tsx` (none outside it) |
| The M12 stacking value added for it | `src/components/landing/horizontal-showcase.tsx` `relative z-[7]` — decided during M3, logged there |

Not deletable, and checked: the `--flow-*` colour tokens the protected strand
uses are defined in `src/app/globals.css:82`, **not** in `flow-lines.tsx`, so the
deletion cannot starve `strand-trail.tsx` of its colours. `strand-trail.tsx` is
Take 4 M8 work (the owner asked for it by name) and is **protected**, as is
`v5-layers.tsx` (V5 Job 2, named in §1.2's protected table).

## Job 2's real content

`src/components/landing/pipeline.tsx:37-43` holds five real stages — Plan (Jev
classifies), Dynamic team (researcher · critic · synthesizer), Evidence hub
(claims + sources), Critics (D4: enough? valid?), Judge (final verdict) — plus a
PASS terminal and a REWORK loop. N = 5, so the pinned wrapper is (5+1)×100svh and
the four §2.3 shape families are reused cyclically for the fifth step, per §5.

## BEFORE state of my product

25 frames labelled BEFORE, captured from the frozen `.next-t5` artifact on :3300
(the exact tree state V6 starts from), in `_lh/t6-before/`: 23 wheel-seeked
landing depths over docH 14863 (73 svg paths, 2 canvases, 8–56 running CSS
animations by depth, 0 sticky stages today) plus `/login` and `/dashboard` (the
latter redirects to the auth gate). `_lh/t6-before.json` carries the per-depth
DOM motion census that M10's no-deletions check will diff against.
