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

| Job | Owner's words | Mechanism found | Scope decision |
| --- | --- | --- | --- |
| A | "small grid box in the left bottom" | `BlueprintFrame`'s dotted patch: one `<g stroke-dasharray="1 1">` with 9 column + 6 row lines, anchored bottom-left of the hero frame | hero mount only; the frame's brackets, edge ticks and crosshair stay, and the evidence section's frame keeps its patch |
| B | "only the highlighting box animation rectnagle box around the text" | `ReadingSpotlight` toggles `.v5-spot` on the block nearest the viewport centre; the class painted `background-color: var(--accent)` | the **fill** only. The lift (`filter: brightness(1.1)`) and its transition stay, so the spotlight still works, just without the rectangle |
| C | "the is separating the two page but its not actually doing it" | `border-border border-t` on the page bands (sections 5–14 + the footer). Under the V7 camera each band reads as a page, so the rule looked like a page break it does not implement | all 10 band rules — the same CSS on the same element family, i.e. the same line. Inner card rules (the capabilities grid, the FAQ divider, the pipeline readout strip, the footer meta row) are **not** page separators and were left alone |
| D | "the text is getting out the box" | `PipelineDiagram` draws each node's `sub` as one 10px mono `<text>`; "researcher · critic · synthesizer" is 33 chars inside a 150px card and ran 52.2px past its edge | wrap the sub on its `·` separators inside the SVG, no copy and no animation touched |

## 3. The change

| File | Change |
| --- | --- |
| `src/app/globals.css` | `.v5-spot` loses `background-color: var(--accent)`; keeps `filter: brightness(1.1)` + its transition. Owner ruling recorded in the comment |
| `src/components/landing/blueprint-marks.tsx` | `BlueprintFrame` gains a documented `grid = true` prop; the dotted patch renders under `{grid && …}` |
| `src/components/landing/landing-page.tsx` | hero mounts `<BlueprintFrame grid={false} />`; `border-t border-border` dropped from 9 page bands |
| `src/components/landing/landing-footer.tsx` | footer band `border-t` dropped |
| `src/components/landing/pipeline-stage.tsx` | `border-t` dropped from the pinned wrapper and the reduced-motion section |
| `src/components/landing/pipeline.tsx` | `wrapSub()` splits a sub on `·` into ≤22-char lines and the block re-centres; the separator that joins two lines is kept (`"researcher · critic ·"` / `"synthesizer"`) |

Net: 6 source files, +99 / −72. `tsc --noEmit` clean, ESLint clean on all touched files, Prettier
clean on all touched files, `next build` exit 0.

## 4. Verification — `_lh/v9-landing-jobs.mjs` 22/22, run four times

Two arms, one browser, sequential pages, hardware ANGLE (Intel Iris Xe): ART = the working tree on
`:3000`, CTRL = the live alias, which still serves the pre-edit HEAD. CTRL is the positive control:
every "0 found" on ART is worthless unless the same metric finds the thing on CTRL. Grading is a
pure function of the rows written to `v9-landing-jobs.json`, so `--rescore` re-grades a saved sweep.

| Gate | ART | CTRL (control fires?) |
| --- | --- | --- |
| A0 both arms surveyed the same frames | `[evidence, hero]` | yes, same inventory |
| A1 hero grid gone | group 0, lines 0 | — |
| A2 the patch exists on the control | — | group 1, **15 lines** |
| A3 frame ornaments kept | 5 paths/circles | 5, equal |
| A4 the evidence frame keeps its grid | evidence: 15 lines | evidence: 15 |
| B0 the alpha parser fails both ways | 6 notation samples (`rgba`, `rgb /`, `oklab /`, `color(srgb /`) classify as expected | — |
| B1 ART saw a spotlighted line | 14 distinct samples | — |
| B2 no highlight box on ART | 0 samples with a painted background | — |
| B3 the box exists on the control | — | 12 samples, e.g. `color(srgb .357 .486 .98 / .06)` |
| B4 the lift still animates | `brightness(1.1)` plus 13 intermediate values mid-transition | — |
| C1 no band top-borders on ART | 0 | — |
| C2 the lines exist on the control | — | **10** (capabilities, evidence, benchmarks, faq, start, footer, …) |
| D1 subs inside the box on ART | worst overflow **0.0px** | — |
| D2 the overflow exists on the control | — | worst overflow **52.2px** |
| D3 it wrapped, it did not truncate | 6 sub lines vs 5; widest line 21 chars vs 33 | — |
| D4 copy preserved, separator included | `Jev classifies \| researcher · critic · \| synthesizer \| claims + sources \| D4: enough? valid? \| final verdict` | identical string |
| R1 copy byte-identical | 7965 chars on both arms | — |
| R2 height delta is the removed rules | CTRL 20207 → ART 20197, **10px** = the 10 removed 1px rules | — |
| R3 headings unchanged | h2 10 = 10 | — |
| R4 no page errors on ART | 0 | — |
| P1 every screenshot framed its target | hero / pipeline / evidence / separator all ok | all ok |
| P2 a line was lit in both spotlight shots | `P` with `rgba(0, 0, 0, 0)` | `P` with `color(srgb … / .06)` |

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
paints a translucent rectangle behind the *Evidence hub* paragraph, ART leaves the text bare.
`04-separator-{ctrl,art}`: CTRL shows a full-width hairline at the band boundary under the nav, ART
does not. `02-pipeline-{ctrl,art}`: the *Dynamic team* subtitle runs through the card edge on CTRL
and sits inside it on ART.

## 6. Findings that are not these four jobs

- `[V9][ProdLoop]` **self-hosted `next start` answers `/` with a `/` → `/` 307 loop** on this
  machine (`x-middleware-rewrite: …/en`), reproduced on `:3400`, `:3500` and `:3700` — i.e. on
  builds that predate these edits — while `next dev` on `:3000` and Vercel production both serve
  200. Suspect the `deepmerge-ts@8` override in `pnpm.overrides`, which next-intl 4.13.6 depends
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
  transforms pages, so the check now compares the *scroll position* against an `offsetTop` target
  reached by trusted wheel events, and gate P1 fails the run if any shot missed.

## 7. State at handoff (superseded by §8)

`:3000` (the owner's dev server), `:3400` and `:3500` left running and untouched; the `:3700`
server started for this run was stopped. Nothing was deployed. Work is uncommitted on the working
tree.

## 8. Committed, pushed, deployed, and re-measured live (2026-10-13)

The owner's go-ahead was "do itt faasstt and quick". The work is now `20598d0` + `460d79d` on
`main` of the private repo, and `f499f1f` on `Mushahid-Ahmed/AgentOS` `main` — the log-free orphan
tree, same eight paths, +225/−73, byte-identical to the committed source. Because the public repo
is git-connected to Vercel, that push *is* the deploy.

`_lh/v9-live-gates.mjs` re-ran the same probes against `https://agentos-theta-teal.vercel.app/`
after the build landed: **14/14 green**. A live check has no second server to compare against —
every other host on this machine also runs the new code — so the positive control is the *same
alias measured by the same probe code before the push* (`rows.CTRL` of §4), and each claim is
paired with the number that measurement returned:

| gate | live now | pre-push control |
| --- | --- | --- |
| hero dotted-grid `<line>`s | 0 (group gone) | 15 in 1 group |
| hero frame ornaments | 5 | 5 — only the patch came out |
| non-hero (`evidence`) frame grid | 15 | 15 — untouched, per "only remove what I'm saying" |
| `.v5-spot` samples with a painted background | 0 of 13 | 11, e.g. `color(srgb … / 0.06)` |
| `.v5-spot` lift | `filter: brightness(1.1)` still applies | same |
| sections/footers with a top border | 0 of 13 | 10 (`capabilities`, `evidence`, `benchmarks`, `faq`, `start`, `FOOTER`, …) |
| worst pipeline-sub overflow | 0px over 5 rects × 37 on-screen samples | 52.2px |
| sub copy | `researcher · critic ·` / `synthesizer` (letters identical to the control) | one line, overflowing |

Production CSS confirms the artifact independently: the live stylesheet now ships
`.v5-spot{filter:brightness(1.1);transition:filter var(--motion-base) var(--ease-out-soft)}` — the
`background-color` and its transition entry are gone, the lift is not.

Screenshots: `_lh/v9_live/01-hero-live.png` (no bottom-left patch; crosshair and edge ticks still
drawn), `02-spotlight-live.png` (line lifted, no rectangle behind it), `03-pipeline-live.png`
(*Dynamic team* subtitle wrapped inside the node card).

Two things this run did **not** change: the `[V9][ProdLoop]` self-hosted `next start` defect of §6
is still open (Vercel is unaffected — the alias serves 200 with 0 page errors), and the public
repo's GitHub Actions suite fails exactly the same five jobs (`check`, `build`, `e2e`,
`migrations`, `deploy`) on `f499f1f` as it did on its predecessor `7fbba7d`, so that breakage
predates this push and is not a regression from it. Vercel deploys from the git connection, not
from those jobs, which is why production moved.

