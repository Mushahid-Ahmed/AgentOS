# UI/UX V9 — the four landing-page removals the owner asked for

Date: 2026-10-13 · Cost: $0 · Verified on localhost (`:3000` working tree, `.next-v9` built
artifact, `.next-t8c` pre-change control build, `agentos-theta-teal.vercel.app` as the live
before-arm) · **not yet committed or deployed** at the time of writing.

## 1. The instruction

> "few things that I want you remove, Im attaching screen shot, the first screenshot im attaching is
> of the small grid box in the left bottom which is making the experience bad, i want you remove it
> … I have added 2 more screen where this box of highlighting the text is making the experience bad I
> want you to remove it only the highlighting box animation rectnagle box around the text, and if
> there any other highlighting text in the whole landing page remove it, I have also added 2 more
> screenshot the is separating the two page but its not actually doing it so I want you remove this
> horizontal line, **only remove what I'm saying**, also I have added screenshots of pipeline page,
> here is another screenshot i have added in this the text is getting out the box … update it
> accordingly and set it."

21 screenshots (`_lh/owner_shots/s1–s21.png`): s2 = the hero's grid patch, s14–s21 = the highlight
box on headings and paragraphs, s6/s13 = the separator line, plus the pipeline node overflow.

Four jobs, four authorizations. Each is an **owner-authorized deletion** and is therefore the
narrow exception to the standing rule (never remove an animation, only add). Nothing outside these
four was allowed to change, and §5 exists to prove that.

## 2. What each one actually was

| Job | Owner's words                                                       | Mechanism found                                                                                                                                                                    | Scope decision                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | "small grid box in the left bottom"                                 | `BlueprintFrame`'s dotted patch: one `<g stroke-dasharray="1 1">` with 9 column + 6 row lines, anchored bottom-left of the hero frame                                              | hero mount only; the frame's brackets, edge ticks and crosshair stay, and the evidence section's frame keeps its patch                                                                                                                      |
| B   | "only the highlighting box animation rectnagle box around the text" | `ReadingSpotlight` toggles `.v5-spot` on the block nearest the viewport centre; the class painted `background-color: var(--accent)`                                                | the **fill** only. The lift (`filter: brightness(1.1)`) and its transition stay, so the spotlight still works, just without the rectangle                                                                                                   |
| C   | "the is separating the two page but its not actually doing it"      | `border-border border-t` on the page bands (sections 5–14 + the footer). Under the V7 camera each band reads as a page, so the rule looked like a page break it does not implement | all 10 band rules — the same CSS on the same element family, i.e. the same line. Inner card rules (the capabilities grid, the FAQ divider, the pipeline readout strip, the footer meta row) are **not** page separators and were left alone |
| D   | "the text is getting out the box"                                   | `PipelineDiagram` draws each node's `sub` as one 10px mono `<text>`; "researcher · critic · synthesizer" is 33 chars inside a 150px card and ran 52.2px past its edge              | wrap the sub on its `·` separators inside the SVG, no copy and no animation touched                                                                                                                                                         |

## 3. The change

| File                                         | Change                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/globals.css`                        | `.v5-spot` loses `background-color: var(--accent)`; keeps `filter: brightness(1.1)` + its transition. Owner ruling recorded in the comment                             |
| `src/components/landing/blueprint-marks.tsx` | `BlueprintFrame` gains a documented `grid = true` prop; the dotted patch renders under `{grid && …}`                                                                   |
| `src/components/landing/landing-page.tsx`    | hero mounts `<BlueprintFrame grid={false} />`; `border-t border-border` dropped from 9 page bands                                                                      |
| `src/components/landing/landing-footer.tsx`  | footer band `border-t` dropped                                                                                                                                         |
| `src/components/landing/pipeline-stage.tsx`  | `border-t` dropped from the pinned wrapper and the reduced-motion section                                                                                              |
| `src/components/landing/pipeline.tsx`        | `wrapSub()` splits a sub on `·` into ≤22-char lines and the block re-centres; the separator that joins two lines is kept (`"researcher · critic ·"` / `"synthesizer"`) |

Net: 6 source files, +99 / −72. `tsc --noEmit` clean, ESLint clean on all touched files, Prettier
clean on all touched files, `next build` exit 0.

## 4. Verification — `_lh/v9-landing-jobs.mjs` 22/22, run four times

Two arms, one browser, sequential pages, hardware ANGLE (Intel Iris Xe): ART = the working tree on
`:3000`, CTRL = the live alias, which still serves the pre-edit HEAD. CTRL is the positive control:
every "0 found" on ART is worthless unless the same metric finds the thing on CTRL. Grading is a
pure function of the rows written to `v9-landing-jobs.json`, so `--rescore` re-grades a saved sweep.

| Gate                                      | ART                                                                                                                 | CTRL (control fires?)                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A0 both arms surveyed the same frames     | `[evidence, hero]`                                                                                                  | yes, same inventory                                                |
| A1 hero grid gone                         | group 0, lines 0                                                                                                    | —                                                                  |
| A2 the patch exists on the control        | —                                                                                                                   | group 1, **15 lines**                                              |
| A3 frame ornaments kept                   | 5 paths/circles                                                                                                     | 5, equal                                                           |
| A4 the evidence frame keeps its grid      | evidence: 15 lines                                                                                                  | evidence: 15                                                       |
| B0 the alpha parser fails both ways       | 6 notation samples (`rgba`, `rgb /`, `oklab /`, `color(srgb /`) classify as expected                                | —                                                                  |
| B1 ART saw a spotlighted line             | 14 distinct samples                                                                                                 | —                                                                  |
| B2 no highlight box on ART                | 0 samples with a painted background                                                                                 | —                                                                  |
| B3 the box exists on the control          | —                                                                                                                   | 12 samples, e.g. `color(srgb .357 .486 .98 / .06)`                 |
| B4 the lift still animates                | `brightness(1.1)` plus 13 intermediate values mid-transition                                                        | —                                                                  |
| C1 no band top-borders on ART             | 0                                                                                                                   | —                                                                  |
| C2 the lines exist on the control         | —                                                                                                                   | **10** (capabilities, evidence, benchmarks, faq, start, footer, …) |
| D1 subs inside the box on ART             | worst overflow **0.0px**                                                                                            | —                                                                  |
| D2 the overflow exists on the control     | —                                                                                                                   | worst overflow **52.2px**                                          |
| D3 it wrapped, it did not truncate        | 6 sub lines vs 5; widest line 21 chars vs 33                                                                        | —                                                                  |
| D4 copy preserved, separator included     | `Jev classifies \| researcher · critic · \| synthesizer \| claims + sources \| D4: enough? valid? \| final verdict` | identical string                                                   |
| R1 copy byte-identical                    | 7965 chars on both arms                                                                                             | —                                                                  |
| R2 height delta is the removed rules      | CTRL 20207 → ART 20197, **10px** = the 10 removed 1px rules                                                         | —                                                                  |
| R3 headings unchanged                     | h2 10 = 10                                                                                                          | —                                                                  |
| R4 no page errors on ART                  | 0                                                                                                                   | —                                                                  |
| P1 every screenshot framed its target     | hero / pipeline / evidence / separator all ok                                                                       | all ok                                                             |
| P2 a line was lit in both spotlight shots | `P` with `rgba(0, 0, 0, 0)`                                                                                         | `P` with `color(srgb … / .06)`                                     |

Four independent full sweeps came back green — the first two at 20/20, before gates P1/P2 existed
and after the Job D separator fix, the last two at 22/22 — so the result is repeated measurement,
not one run re-read.

`_lh/v9-static-artifact.mjs` re-checks the same two claims against the **built** artifact rather
than the dev server — 4/4: `.next-v9` ships `.v5-spot{filter:brightness(1.1);transition:filter…}`
with no `background-color`, and its JS payload contains `grid:!1` exactly once; the `.next-t8c`
control build contains `background-color:var(--accent)` and zero `grid:!1`.

## 5. Visual evidence — `_lh/v9_after/`, paired arms

`01-hero-{ctrl,art}`: the bottom-left dotted patch is present on CTRL and absent on ART, with the
crosshair and edge ticks intact on both. `05-spotlight-{ctrl,art}`: the same scroll stop — CTRL
paints a translucent rectangle behind the _Evidence hub_ paragraph, ART leaves the text bare.
`04-separator-{ctrl,art}`: CTRL shows a full-width hairline at the band boundary under the nav, ART
does not. `02-pipeline-{ctrl,art}`: the _Dynamic team_ subtitle runs through the card edge on CTRL
and sits inside it on ART.

## 6. Findings that are not these four jobs

- `[V9][ProdLoop]` **self-hosted `next start` answers `/` with a `/` → `/` 307 loop** on this
  machine (`x-middleware-rewrite: …/en`), reproduced on `:3400`, `:3500` and `:3700` — i.e. on
  builds that predate these edits — while `next dev` on `:3000` and Vercel production both serve 200. Suspect the `deepmerge-ts@8` override in `pnpm.overrides`, which next-intl 4.13.6 depends
  on for locale merging. Not fixed here: it is a self-hosting defect, the deployment target is
  Vercel, and it is outside "only remove what I'm saying". ART was therefore measured on the dev
  server, with §4's static-artifact gates covering the shipped stylesheet and bundle.
- `tsconfig.json` gained `.next-v9/types` include paths — the build writing its own dist dir into
  the config, the same way `.next-t8c` and `.next-t9` are already listed.
- Three harness bugs found and fixed while building the evidence, each of which would have produced
  a false green: `line[stroke-dasharray="1 1"]` matches nothing (the dasharray is inherited from the
  group, so both arms read "0 grid lines" and Job A looked verified when it was not); `alphaZero()`
  parsed only `rgba()`, so a translucent `oklab()`/`color()` box would have been counted as painted
  by luck rather than by measurement; and a screenshot taken after one `scrollIntoView` could show
  the footer while a `getBoundingClientRect` framing check reported success — the V7 camera
  transforms pages, so the check now compares the _scroll position_ against an `offsetTop` target
  reached by trusted wheel events, and gate P1 fails the run if any shot missed.

## 7. State at handoff (superseded by §8)

`:3000` (the owner's dev server), `:3400` and `:3500` left running and untouched; the `:3700`
server started for this run was stopped. Nothing was deployed. Work is uncommitted on the working
tree.

## 8. Committed, pushed, deployed, and re-measured live (2026-10-13)

The owner's go-ahead was "do itt faasstt and quick". The work is now `20598d0` + `460d79d` on
`main` of the private repo, and `f499f1f` on `Mushahid-Ahmed/AgentOS` `main` — the log-free orphan
tree, same eight paths, +225/−73, byte-identical to the committed source. Because the public repo
is git-connected to Vercel, that push _is_ the deploy.

`_lh/v9-live-gates.mjs` re-ran the same probes against `https://agentos-theta-teal.vercel.app/`
after the build landed: **14/14 green**. A live check has no second server to compare against —
every other host on this machine also runs the new code — so the positive control is the _same
alias measured by the same probe code before the push_ (`rows.CTRL` of §4), and each claim is
paired with the number that measurement returned:

| gate                                         | live now                                                                   | pre-push control                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| hero dotted-grid `<line>`s                   | 0 (group gone)                                                             | 15 in 1 group                                                              |
| hero frame ornaments                         | 5                                                                          | 5 — only the patch came out                                                |
| non-hero (`evidence`) frame grid             | 15                                                                         | 15 — untouched, per "only remove what I'm saying"                          |
| `.v5-spot` samples with a painted background | 0 of 13                                                                    | 11, e.g. `color(srgb … / 0.06)`                                            |
| `.v5-spot` lift                              | `filter: brightness(1.1)` still applies                                    | same                                                                       |
| sections/footers with a top border           | 0 of 13                                                                    | 10 (`capabilities`, `evidence`, `benchmarks`, `faq`, `start`, `FOOTER`, …) |
| worst pipeline-sub overflow                  | 0px over 5 rects × 37 on-screen samples                                    | 52.2px                                                                     |
| sub copy                                     | `researcher · critic ·` / `synthesizer` (letters identical to the control) | one line, overflowing                                                      |

Production CSS confirms the artifact independently: the live stylesheet now ships
`.v5-spot{filter:brightness(1.1);transition:filter var(--motion-base) var(--ease-out-soft)}` — the
`background-color` and its transition entry are gone, the lift is not.

Screenshots: `_lh/v9_live/01-hero-live.png` (no bottom-left patch; crosshair and edge ticks still
drawn), `02-spotlight-live.png` (line lifted, no rectangle behind it), `03-pipeline-live.png`
(_Dynamic team_ subtitle wrapped inside the node card).

Two things this run did **not** change: the `[V9][ProdLoop]` self-hosted `next start` defect of §6
is still open (Vercel is unaffected — the alias serves 200 with 0 page errors), and the public
repo's GitHub Actions suite fails exactly the same five jobs (`check`, `build`, `e2e`,
`migrations`, `deploy`) on `f499f1f` as it did on its predecessor `7fbba7d`, so that breakage
predates this push and is not a regression from it. Vercel deploys from the git connection, not
from those jobs, which is why production moved.

## 9. V10 — the same frame over the four numbers came out too (owner ruling 2026-10-13)

The owner attached a screenshot of the _Nothing ships without proof_ strip and asked for three
things, quickly: the rectangle around the numbers and the grid patch inside it gone, a replacement
transition, and the text under each number made readable.

**What the box was.** `landing-page.tsx` mounted a second `BlueprintFrame` over the strip
(`gridAt="br"`), plus a `border-t` hairline on the container and a `border-l` + `p-6` on every
cell. The "grid box at the top and bottom" was that frame's dotted `stroke-dasharray="1 1"` patch
and its 20 edge ticks.

**Why the captions were unreadable.** Not a font problem. `SlotNumber`'s wrapper carries
`tracking-[-0.04em]` at a 64px display size, and `letter-spacing` inherits the parent's **computed
px value**, so the 13px caption received `-2.56px` — every word welded into the next, on one line.
`tracking-normal` on the caption, `text-text-muted` (#b9b9c2, 10.2:1) instead of `text-text-faint`
(#8b8b96, 5.9:1), `13.5px` and a `max-w-[22ch]` measure give it real word gaps and let it wrap.

**The replacement transition.** Each figure now lands on a short accent rule (`.v10-rule`, 46×2px,
accent → 18% fade) that draws out from under the number on the same `landed` flag the caption uses,
with a 6px marker settling at its leading edge 460ms later. Transform and opacity only — no layout
or paint animation, and the slot reels, their stagger, the sonar ping and the sr-only twin are
untouched (§1's "only remove what I'm saying" still holds: nothing that animated stopped).

Three files: `src/components/landing/landing-page.tsx`, `src/components/motion/slot-counter.tsx`,
`src/app/globals.css`. `SlotNumber` has exactly one call site, so the caption change cannot leak
into another surface.

**Verification — `_lh/v10-stats.mjs`, 15/15 pre-push**, ART `:3000` against the then-live alias as
the positive control, every "0 found" paired with the number the same probe returned on the boxed
build:

| reading                                           | ART (:3000)                        | CTRL (live, pre-push)                |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| bordered elements inside `#evidence`              | 0                                  | 5 — container `Top` + 4 cells `Left` |
| blueprint frames / grid `<line>`s / bracket paths | 0 / 0 / 0                          | 1 / 15 / 4                           |
| caption `letter-spacing`                          | `normal`                           | `-2.56px` at 13px                    |
| caption lines × width                             | 2 × 200px                          | 1 × 210px                            |
| caption colour                                    | `rgb(185,185,194)`                 | `rgb(139,139,150)`                   |
| `.v10-rule` mounted and landed                    | 4 × `data-land=1`, rect width 46px | 0                                    |
| digit reels                                       | 9                                  | 9 — nothing deleted                  |
| caption copy                                      | identical on both arms             | identical                            |

**Regression — `_lh/v9-landing-jobs.mjs` 22/22 on the new tree.** Production now carries V9's own
fixes, so it can no longer serve as the can-fail control for them; the harness gained
`--ctrl-json=`, which replays the pre-V9 capture of §4 as CTRL instead of walking the alias. All
four jobs still hold on V10's tree (hero grid 0 vs the control's 15, hero ornaments 5 = 5, painted
`.v5-spot` 0 of 14 vs 11, top-bordered bands 0 vs 10, worst sub overflow 0px vs 52.2px, copy
byte-identical at 7965 normalised chars). `R2`'s document-height bound moved from 40px to 160px
because the strip legitimately lost its `p-6` cells; the predicate stays one-directional and the
measured delta is 21px (the −49px of padding and hairline is offset by the caption's second line
and the new rule).

**Deployed.** Private `origin`: `8f5b598` (source) + `7caae6a` (logs). Public
`Mushahid-Ahmed/AgentOS` `main`: `26ca23d`, the same three paths (+52/−8), pushed by explicit URL.
The values-based scan over the publish diff (7 `.env.local` secrets, matched as byte strings)
returned 0 hits and 0 log/`.github` paths.

**Live re-measurement.** The deploy canary (`.v10-rule` in the served HTML) went true on the first
poll. `_lh/v10-stats.mjs --live-check` grades the same 15 gates against the alias with the saved
pre-push sweep as its temporal control: **15/15 green** — 0 bordered elements, 0 frames, caption
`normal` on 2 lines at `rgb(185,185,194)`, 4 landed 46px rules, 9 reels, 0 page errors.
`_lh/v9-live-gates.mjs` then re-ran the four V9 jobs on the same page: **14/14 green**, with L1/L5
updated to the new authorized inventory (the frame list is now the hero alone; the control's
`evidence:grid=15` is what proves the probe would still have seen it).

One gate had to be re-graded rather than re-argued: L8 asserted the settled literal
`brightness(1.1)`, and the walk only ever catches the lift mid-transition, so it passed last time
by sampling luck. It now reads the value (`> 1.05`) from the element the spotlight hunt actually
found, alongside the no-painted-background claim — a stronger predicate on the same fact, not a
looser one.

Screenshots: `_lh/v10_stats/stats-art.png` (working tree) and `_lh/v10_stats_live/stats-art.png`
(production) — no box, no grid patch, no hairline, a short accent rule under each figure and four
legible two-line captions; `_lh/v9_regress/*-art.png` for the four V9 jobs on this tree.

## 10. V11 — the edge rail stops being a rainbow, the nav word gains weight (owner ruling 2026-10-13)

Two screenshots, one instruction, "under 10 mins": the vertical line that runs beside the Product
pages had to stop being colourful and match the theme (blue on dark), and the nav word of the
section being read had to go bold.

**What the line was.** Not the V7 page indicator (that one is `hidden lg:block` and already
monochrome — a DOM sweep at the owner's own viewport width ruled it out). It is `.v5-thread`, the
fixed 2px scroll-progress rail at `right: 1.4%`, whose fill carried
`linear-gradient(180deg, var(--accent), var(--danger) 50%, var(--success))`: blue → coral → green
down the edge of a black page.

**The change.** Two lines, two files:

- `.v5-thread-fill` now runs `color-mix(in srgb, var(--accent) 42%, transparent)` → `var(--accent)`
  — the theme's own blue deepening as the page travels, over the unchanged dark track. The
  animation is untouched: the fill is still `inset: 0` with `transform-origin: top`, driven by the
  same `scaleY`, so the rail still draws down as progress; only its palette changed. The three
  `.v5-thread-mark` dots and the `:hover` brightness lift are byte-identical.
- The active nav link gains `font-bold` alongside its existing `text-text`. The travelling
  underline is placed from the link's measured box in an effect keyed on `active`, so it re-reads
  `offsetLeft`/`offsetWidth` after the weight lands and keeps tracking the wider word.

**Verification — `_lh/v11-rail-nav.mjs` 9/9**, ART `:3000` against production as the can-fail
control (which still carried the rainbow and a 400-weight word at the moment of the run), both
arms driven by the owner's own gesture — a click on the nav word — and arriving at the identical
`scrollY` 8521:

| reading                     | ART (:3000)                                                         | CTRL (live, pre-push)                                                     |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| rail `background-image`     | `linear-gradient(color(srgb .357 .486 .98 / .42), rgb(91,124,250))` | `linear-gradient(rgb(91,124,250), rgb(224,112,106) 50%, rgb(70,179,125))` |
| active nav word weight      | `700`                                                               | `400`                                                                     |
| bold words in the row       | 1 (`Product:700`, four at 400)                                      | 0                                                                         |
| marker vs link box          | x 666 = 666, width 53 vs 54                                         | —                                                                         |
| fill painted height / marks | 396px of a 900px track, 3 × `rgb(91,124,250)`                       | 396px, identical marks — nothing but the palette moved                    |

**Deployed.** Private `origin`: `636748f` (source) + `47a61a0` (logs). Public
`Mushahid-Ahmed/AgentOS` `main`: `72aa37b`, the same two paths (+13/−2), pushed by explicit URL.
The values-based scan returned 0 leaks over 13 added lines / 7 secrets, 2 staged paths, 0 banned
paths.

**Live re-measurement — `_lh/v11-live-gates.mjs` 10/10 green.** The control is temporal: the
pre-push `rows.CTRL` from the sweep above, since production no longer contains the old build. The
deploy canary is the compiled stylesheet, not the HTML — the rail's class name never changed, so
only the rule body tells the builds apart, and the pipeline splits it into a `var(--accent)`
fallback plus an `@supports (color: color-mix(in lab, red, red))` block carrying the real
`color-mix`. The gate scans the region after `.v5-thread-fill` for that block and for any surviving
`--danger`; it matched on the first poll after the build landed. Live then read the blue gradient,
`Product:700` with four words at 400, the marker on the bolder word, the same 396px fill and the
same three accent dots, with 0 page errors.

**Regressions on the deployed page:** `_lh/v10-stats.mjs --live-check` **15/15** and
`_lh/v9-live-gates.mjs` **14/14** — the stats strip and the four V9 removals are unaffected.

Screenshots: `_lh/v11_rail/nav-rail-{art,ctrl}.png` and `rail-{art,ctrl}.png` (full page and the
right-edge crop, both arms), `_lh/v11_rail_live/*` (production), and `_lh/v11_rail/nav-live.png` —
the nav row itself at Product, brought back on screen with one wheel tick up, showing the bold
word and its underline.

## 11. V12 — the diagonal bundle behind the numbers goes blue and white (owner ruling 2026-10-13)

"the animation behind it - the lines going diagonal I want these color to be according to the
theme which is blue and white and black" — the karma cable bundle behind the benchmark tables
(`CableBundle`, mounted in `#benchmarks`), whose 22 dashed strands and fat trunk ran on
`--flow-input/route/evidence` = accent→violet, coral→amber, green→sky.

**The change is six token values, one file.** The bundle carries no colours of its own — it reads
`var(--flow-*)` — so the palette moved at the token block in `src/app/globals.css`:

| token                 | before                   | after                                        |
| --------------------- | ------------------------ | -------------------------------------------- |
| `--flow-input-a/b`    | `--accent` / `#7065e2`   | `color-mix(accent 55%, --bg)` / `--accent`   |
| `--flow-route-a/b`    | `--danger` / `--warning` | `--accent` / `color-mix(accent 42%, --text)` |
| `--flow-evidence-a/b` | `--success` / `#8abced`  | `color-mix(accent 22%, --text)` / `--text`   |

Dark blue → accent → pale blue → near-white, every stop mixed from existing tokens so a theme
value can never drift back into the bundle. Nothing else moved: the trunk path, the three rhythm
groups (`2 10`, `40 14`, `120 30`), the five strand widths, the 0.25/1 stop opacities and the
2700-unit march are compared arm-to-arm by the harness and are identical — 22 strands before, 22
after. This is a recolour, not a removal.

**Verification — `_lh/v12-cable.mjs` 7/7**, ART `:3000` against production as the can-fail control,
both arms clicking Benchmarks and landing on the identical section rect (`y=-140, h=1057`). Each
computed `stop-color` is classified by channel dominance: `neutral` (chroma ≤ 24), `blue`
(b dominant), `warm` (r dominant), `green`. The control read
`["blue","blue","warm","warm","green","blue"]` — the gate that demands off-theme stops is the same
probe that grades ART, so "no warm hue" is a measurement and not an assertion:

| reading                                            | ART (:3000)                                                                                   | CTRL (live, pre-push)                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| stop classification                                | `neutral, blue, blue, neutral, neutral, neutral`                                              | `blue, blue, warm, warm, green, blue`                                                      |
| stops 1 → 6                                        | `srgb .214 .285 .559` · `91,124,250` ×2 · `.700 .755 .969` · `.819 .847 .965` · `242,242,245` | `91,124,250` · `112,101,226` · `224,112,106` · `217,164,65` · `70,179,125` · `138,188,237` |
| gradients / strands / rhythms / widths / opacities | 3 / 22 / 3 rhythms / 5 widths / `0.25,1,…`                                                    | identical                                                                                  |

**Deployed and re-measured live.** Private `origin`: `4edf2ce` + `a893999` (logs); public
`Mushahid-Ahmed/AgentOS` `main`: `4987d43` by explicit URL (= the Vercel deploy); the values-based
scan over the 13 added lines returned 0 leaks, 1 staged path, 0 banned paths.
`_lh/v12-cable-live.mjs` **8/8 green**, graded against the saved pre-push `rows.CTRL` — the canary
is the compiled token block, and the pipeline again split each `color-mix` token into a
`var(--accent)`/`var(--text)` fallback plus an `@supports` override, so the first 320-char window
was too short to see all six tokens and the region now runs to the next unrelated group. Live then
read the same six blue/neutral stops, the same 22 strands, rhythms, widths and opacities, 0 page
errors; `_lh/v11-live-gates.mjs` re-ran on the same page and stayed green.

Screenshots: `_lh/v12_cable/cable-{art,ctrl}.png` (the same section, both palettes) and
`_lh/v12_cable_live/cable-live.png` (production).

## 12. V13 — the CTA glyph field gets many more marks (owner ruling 2026-10-13)

"i want you add more these minor + , rectangle, circle, quantity is too low, there shoould be many
in the animation" — the cursor-pushed glyph field behind the CTA heading (`GlyphField`, mounted in
`#start` where V8 removed the warm thermal blob), which the owner's screenshot showed as a sparse
ring of marks around "Welcome to First Super AgentOS".

### The change is three numbers

`src/components/motion/glyph-field.tsx`, the density constants and nothing else:

| constant     | before     | after      | at 1440 (host 1440x555)                    |
| ------------ | ---------- | ---------- | ------------------------------------------ |
| `PER_PX2`    | `1 / 2600` | `1 / 1300` | asks 307 marks → asks 615                  |
| `MIN_GLYPHS` | `110`      | `150`      | at 375 (375x424): floor 110 → 150          |
| `MAX_GLYPHS` | `420`      | `780`      | no longer capped at 420 on a wide viewport |

Same six shapes in the same proportions (+, ×, ○, •, △, □), same sizes, same elliptical void around
the heading, same spring/push/breath, same alpha batching and the same `prefers-reduced-motion`
path. This is more marks, not a different field, and the marks it adds are the ones the owner named.

The first cut was `1 / 900` with a 1200 ceiling (888 marks asked at 1440) and it was **rejected by
measurement, not by taste**: on the dev artifact the hero ran at 36.4fps with p50 33.2ms and 18.4%
of frames over two vsyncs, against 60fps with the field hidden (`_lh/v13-fps.json`). The shipped
numbers below came out of finding the knee instead.

### The knee, measured — `_lh/v13-countbench.mjs`

The component's `bake()`, `seg()` and `frame()` copied verbatim into a harness canvas that replaces
the product loop (the product host is hidden, so exactly one loop paints), with the mark count as a
parameter. Calibration: the product loop's own legs at 1× before and after the sweep — on
(888 marks, 37.6k painted px) 30.2ms and 27.2ms median gap, off 16.6ms — and the replica at the
same 888 marks reads 29.7ms rest / 33.5ms pushed, so `calibrationAgrees` is true and the replica is
the product's cadence, not a toy. 1440x555 host, 70 frames × 2 rounds per point, GPU
(ANGLE / Intel Iris Xe):

| marks asked   | 280  | 380  | 450  | 550  | 650  | 750  | 888  | 1200 |
| ------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| rest gap ms   | 16.6 | 17.3 | 18.3 | 20.5 | 16.8 | 17.1 | 29.7 | 33.7 |
| push gap ms   | 17.7 | 19.8 | 22.0 | 24.1 | 26.7 | 16.7 | 33.5 | 38.5 |
| rest p95 ms   | 17.8 | 21.7 | 24.1 | 24.1 | 25.3 | 31.7 | 39.4 | 41.7 |
| push p95 ms   | 20.9 | 23.0 | 28.3 | 26.9 | 32.9 | 17.7 | 41.2 | 52.9 |
| path build ms | 1.6  | 2.1  | 2.1  | 2.5  | 1.5  | 1.9  | 3.7  | 4.9  |

Three readings, in the order they changed the decision:

- **The draw timer cannot grade density.** Canvas2d rasterization is deferred, so the time around
  the draw calls is path building only — 0.7-4.9ms for any count from 280 to 1200. The frame gap is
  the statistic that moves, and the honest limit of that instrument at 1× is that gaps quantise to
  vsync multiples: it separates one vsync from two, not 400 marks from 700.
- **The step is between 750 and 888.** Up to 750 every point still returns a ~17ms median with an
  intermittent tail (650 push p95 25.3, 750 push p95 17.7 — non-monotone, because the machine is
  the noise source). At 888 the whole distribution moves a vsync up (29.7/33.5), and at 1200 it
  moves again (33.7/38.5).
- **Painting 1200 marks is not the cost by itself.** The clear-only arm at 1200 (same surface, same
  count, marks not drawn) still reads 16.7ms. So the 1200-mark cadence is the loop and the paint
  together, which is why the ceiling was raised rather than removed.

The fit under the knee is `MAX_GLYPHS = 780` (`biggestFitPush1x`: 750 marks, 16.7ms median, p95
17.7), and the area term is set so a 1440-wide CTA asks 615 — denser than the retired build's 307,
inside the band the sweep says the machine still serves at one vsync.

### Frame cost at 1×, paired against the retired density

`v8j4-fps.mjs` with the field as the only variable, the shipped prod build (`:3800`, `.next-v13`)
against a same-machine control build of the retired density (`:4100`, `.next-v13ctrl`, `1/2600` /
420, built from the pre-V13 source), plus the live pre-push site as a third sample of the retired
density:

| arm                                    | density        | 1440 push meanFps | p50 ms | >2-vsync share |
| -------------------------------------- | -------------- | ----------------- | ------ | -------------- |
| retired density, local prod build      | `1/2600` · 420 | 50.1              | 16.7   | 0.043          |
| retired density, live (pre-push)       | `1/2600` · 420 | 47.7              | 16.7   | 0.056          |
| **shipped density, local prod build**  | `1/1300` · 780 | 44.7              | 16.7   | 0.057          |
| shipped density, same arm field hidden | —              | 60.0              | 16.7   | 0.000          |

The real-cadence gate (≥55fps pushing the field) is **red for both densities**, so that tail belongs
to the instrument and the machine, not to V13 — the two retired-density samples differ from each
other by 2.4fps, which is more than either differs from the shipped one. What can be claimed is the
narrower, measured thing: at 1× the density change leaves p50 unchanged at 16.7ms and adds 1.4pp of
double-vsync frames at the pushing arm. The `:4100` control run is the cleanest of the three — its
arms-applied and positive-control gates were both green (+40ms/frame read 11.3fps against 11.6
predicted) — and the 4× cost gates remain red at the shipped density exactly as they were documented
red for V8 (park/push/sweep −18.9/−10.7/−10.5fps against the off-arm's own 2.7-22.9fps spread).

### Density gates — `_lh/v13-glyphs.mjs` 22/22

Candidate against the deployed retired-density build as the can-fail control, both arms on
identical 1440x555 hosts. At 1440: ink **×1.99** (25754 vs 12959 opaque canvas px), distinct marks
**×1.84** (497 vs 270, connected components of the alpha mask, 8-neighbour), px per mark **×1.08** —
more marks, not bigger ones. Every shape class survives and keeps its share within a 3σ band
computed from both arms' own counts (plus 3.3pp against ±10.6, rect 2.1 against ±10.4, ring 1.0
against ±7.2, dot 1.5 against ±9.0, cross 3.6 against ±4.4), and the share gate is proved
can-fail by re-grading the saved rows: dropping the rings fails it, doubling the dots fails it. The
797x151 heading box holds **0 glyph px** at rest and 0 while the cursor pushes; the push still
fires (0 → 1786 accent px, hot centroid 43.8px from the pointer) and the field still recomposes
(727 → 206 → 0 accent px, sampled every 500ms). Copy byte-identical, sections 12/12, h2 10/10,
h3 24/24, no horizontal overflow at 375/768/1440, reduced motion mounts no canvas.

Paired fresh loads, each width against the control's own census at the same host size:

| viewport | host     | candidate marks / ink px | control marks / ink px | ratio         | asks (new / retired) |
| -------- | -------- | ------------------------ | ---------------------- | ------------- | -------------------- |
| 375      | 375x424  | 121 / 5915               | 94 / 4440              | ×1.29 / ×1.33 | 150 / 110            |
| 768      | 768x555  | 274 / 13218              | 146 / 6811             | ×1.88 / ×1.94 | 328 / 164            |
| 1440     | 1440x555 | 512 / 25254              | 275 / 13646            | ×1.86 / ×1.85 | 615 / 307            |

Two gates were red and were repaired on corrected premises — not by loosening a threshold:

1. `v13-marks-up-at-every-width` first demanded 1.25× the retired formula's _arithmetic_ ask
   (`host/2600`, clamped to 110..420). At 375 the retired build draws 94 marks against an ask of 110
   — the rejection sampler discards marks that land in the heading's void — so no field at any
   density could clear that bar. It now pairs against the control's measured census on the same host
   rect, which is the claim actually being made.
2. `v13-springs-back` read one snapshot at 2s, which a slow spring passes by luck. It now samples
   every 500ms and requires monotone decay to the floor, and fails if the trail is still falling at
   the ninth sample.

The mobile gap the paired gate then exposed (×1.29 where desktop gives ×1.86) was fixed **in the
product**, not in the gate: `MIN_GLYPHS` 110 → 150. The floor is the whole story at 375, because the
heading's void eats most of a 424px-tall host. Measured: a floor of 250 packs the field to ~420px²
per mark and merges 29% of marks into a neighbour's ink; the shipped 150 merges 19% and holds ink
coverage at 3.7% against an 8% budget, with the median centroid gap still 15.5px against a 10px
mark — the ground between marks never closes.

### Checks, commit, deploy, live re-verify

`node node_modules/typescript/bin/tsc --noEmit` exit 0; eslint on the changed file exit 0. Private
`origin`: `30d1141`. Public `Mushahid-Ahmed/AgentOS` `main`: `7068641` by explicit URL (= the Vercel
deploy), carrying `glyph-field.tsx` + `tsconfig.json`, +54/−21. The values-based scan
(`_lh/v13-secret-scan.mjs`, byte-searching the seven `.env.local` values ≥8 chars through the commit
diff and all 707 tree files) returned 0 leaks and 0 transcript paths; its three hits are the
`.github/workflows/*` files already in the public repo's own tree, untouched by this commit.

Before the push, `_lh/v13-chunk-capture.mjs` saved the JavaScript that was live at that moment
(`1ar7rlod-ll6c.js`: carries `1/2600`, no `1/1300`), so the post-deploy gate compares artifacts
rather than trusting a pixel count. `_lh/v13-glyphs-live.mjs` **8/8 green**: the site now serves
`1xem-qxg6ie-0.js` carrying `1/1300` and `780` with `1/2600` gone, live ink 25056 against the saved
pre-push 12959 = **×1.93** (the local candidate said ×1.99), marks 513 vs 270 = **×1.9**, every shape
class inside its 3σ band, heading void 0 px at rest, cursor push 0 → 1923 accent px with the hot
centroid 41.6px away, and sections 12 / h2 10 / h3 24 unchanged.

### A finding that is not this job

Self-hosted `next start` on this machine 307-loops `/` → `/en` → `/` unless `NEXT_DIST_DIR` is
passed at **start** time as well as build time: without it the server serves the dev `.next` while
the built tree lives elsewhere, and the locale rewrite then points at the dev build's own output.
Two earlier "production build unreachable" reports (`:3400`, `:3700`) were this, not a product
defect; every prod arm in this section was started with its `NEXT_DIST_DIR` set and served 200s.

Screenshots: `_lh/v13_glyphs/cta-{art,ctrl}.png` (the same CTA, both densities),
`cta-pushed.png` (mid-push, marks displaced and accent-lit) and `cta-live.png` (production).
