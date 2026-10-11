# UI/UX Take 2 — decisions log

Every decision taken unattended during the run (§11: decide, log, continue), with
the evidence that drove it. Numbers are measurements from
`_lh/take2/fluid-check.json` and `_lh/take2/cursor/cursor-check.json`, not
estimates.

---

## T2-D1 — Raw WebGL2, no 3D dependency

**Decision:** write the fluid layer against WebGL2 directly; install nothing.

**Why:** §12 forbids unverified or heavy package installs, and the reference page
(Lusion) runs 47 programs / 25 FBOs / 47 textures through Three.js — a full
compositor with bloom, TAA, halo, RGB-shift and light-field passes. That is the
right budget for an agency portfolio, not for a localhost demo whose backend
spends real money per model call. The hero needs one advected dye field and one
display pass; two programs cover it.

**Verified, then rejected:** `three@0.186.1`, `@react-three/fiber@9.8.1`,
`@react-three/drei@10.7.9`, `ogl@1.0.11` all exist and are current — so this is a
trade, not a workaround. Cost of the decision: we own ~400 lines of GL boilerplate
(ping-pong targets, compile/link error capture, context loss, teardown).

**Failure mode chosen:** WebGL2 without `EXT_color_buffer_float` → static
gradient fallback, no half-float emulation path. Rationale: the extension is
present on every WebGL2 implementation we can reach (including software
rasterisation); building an RGBA8-encoded fallback would be speculative code for
a case we have never observed.

---

## T2-D2 — Adopt the technique, not the artwork

**Decision:** reproduce the *idea* recorded in the study (dye field advected by
curl noise, pushed by the pointer, dissipating) as an original shader; copy no
source, texture, model or font.

**Why:** the brief asks for Lusion-grade craft, and §12 forbids copying reference
artwork. The evidence we used is 159 uniform *names* and shader word counts —
vocabulary, not code. Their font (Aeonik) is proprietary; ours is the Inter we
already load.

---

## T2-D3 — Adaptive display resolution instead of a fixed quality tier

**Decision:** measure the frame gap, then trade render resolution for frames
(`scale` 1 → 0.4 floor), with a `scaleCeiling` so the controller can never retry
a size that already failed.

**Why:** the display pass is ~96 hash evaluations per fragment; on a 1440×900
buffer that is the whole cost, and it is the only lever that helps a weak device.
The field is low-frequency smoke, so upscaling a smaller buffer is nearly
invisible.

**Measured (software rasterisation, not GPU-verified):** median frame
**216.7 ms → 66.6 ms** (implied 4.6 → 15 fps) after the controller settled at
`scale: 0.40`, with the hero's composited appearance unchanged to the eye
(`_lh/take2/hero-idle.png`). The first implementation gated this on 40 frames,
which at 216 ms/frame is 8.6 s — the device that needs the rescue never got it, so
the warm-up is now time-based (≥8 frames **and** ≥1.2 s).

**Honesty note:** 60 fps on integrated graphics is **not** claimed. It cannot be
measured in this environment; see the report's performance section.

---

## T2-D4 — Cursor: a targeting reticle, and one element deleted

**Decision:** §5.3 **Option E (invent your own)**, borrowing Option A's
morph-to-element idea and its click pulse, but expressed as a measurement
instrument rather than a dot-and-ring that scales. Three parts: crosshair ticks
riding a fast-smoothed pointer position, a four-corner bracket that lerps onto
whatever is under the pointer, and a press pulse.

**Why the concept:** the product's whole promise is "Jev decides which agent works
on this". A pointer that measures, brackets and commits is the same gesture at
1px scale. A circle that scales up on hover is the thing the brief explicitly
rejects (§5.1: "the most generic cursor effect possible").

**§5.4 conformance, measured:** movement is never 1:1 — ticks, tip and pulse ride
`sx/sy`, a fast smoothing stage over the raw pointer; only the bracket's target
box reads live geometry. The reticle animates transform/opacity attributes only
(no layout property touched per frame), stays `aria-hidden` +
`pointer-events: none`, and never gates content.

**Why the trail went:** `_lh/take2/cursor/01-open.png` showed 12 samples of a
slow move as one long straight diagonal across the entire hero — a rendering
defect, not motion. A trail needs per-segment opacity to read as decay, which
means 11 more elements updated per frame for a detail nobody asked for. Deleted.

**Also changed after the same screenshot review:** the full-viewport hairline
cross (already at 0.22 opacity) still read like a screenshot utility over a
1440×900 canvas, so it became four 78px ticks with a 13px dead zone around the
tip, and they fade to 0.18× when the bracket locks on so the two readings never
compete. The tip square is now dark-filled with an accent stroke because a white
5px square disappears on the blue CTA.

---

## T2-D5 — Frame-rate-independent smoothing

**Decision:** express every easing rate per 16.7 ms and re-derive it from the
actual frame gap (`1 - (1-rate)^(dt/16.667)`).

**Why:** the harness caught a real bug, not a measurement artifact. With per-frame
lerps the bracket had not converged after 900 ms on a 15 fps frame budget —
`snapErrPx: 37.2` on the CTA and `454.1` on a nav link. After the change:
**`snapErrPx: 0` on both**, i.e. the bracket box equals the element's
`getBoundingClientRect()` + 6px pad exactly, and re-fits when the target changes
size (`refit: true`).

**How the check can fail:** the bracket geometry is read with `SVGGeometryElement
.getBBox()` and compared numerically against the live element rect. (Parsing the
path's `d` numbers was wrong and gave nonsense: `V` and `H` take one coordinate
each, so they are not `(x,y)` pairs.)

---

## T2-D6 — Native cursor policy

Hide the native cursor only inside `@media (hover: hover) and (pointer: fine)`,
and restore `cursor: auto` on `input, textarea, select` — a caret/IB-beam is
functional information the replacement cannot express. On touch or under reduced
motion the component renders nothing at all.

**Measured:** desktop `native: "none"` with the layer present; 375px touch context
`cursorLayer: false, native: "auto"`; reduced-motion context `cursorLayer: false`.

---

## T2-D7 — Extend the existing landing, do not rebuild it

The brief is explicit. Every section, all copy and every real number (benchmark
run #6, $0.530901 spend, the model table) stays; the run only adds motion and the
hero/cursor layers. `docs/uiux-take2-before/manifest.json` records the pre-run
state (12 sections, hero canvas kind `2d`, no horizontal overflow) so the
after-state is comparable rather than merely new.

---

## T2-D8 — Surface failure as data, not as a console warning

`no-console` is an error-level rule here, and a warning nobody reads is not a
diagnosis. The engine returns a `reason` string that the component renders as
`data-t2-fallback` on the fallback element, so a harness (and a human in devtools)
can tell *why* the shader is off: `reduced-motion`, `no-webgl2`, `context-lost`,
`no-float-render`, `compile: …`, `link: …`. This is what made the T2-D3/StrictMode
bug findable in one run instead of three.

---

## T2-D9 — Contrast is a shader responsibility

The display pass multiplies the field by an edge falloff **and** a centre scrim,
so the headline always sits on a darkened band. Measured on the composited hero:
luminance in the headline band ranges 5.1 → 242.2 (the 242 is the glyph ink
itself), while the outer field band stays 9.1 → 27.7 — i.e. the bright dye lives
where the copy does not.

---

## T2-D10 — Reduced motion gets a designed static, not an absence

When the shader must not run, the hero renders a three-stop radial gradient in the
same brand hues rather than an empty `--bg`. The page reads as designed either
way; nothing is gated behind animation, and `h1` is present in both branches
(measured: `"First Super AgentOS"` under `reducedMotion: reduce`).

---

## T2-D11 — One scrub primitive drives every landing section

§6.2 asks for scroll-driven motion in a dozen different shapes. They all read
from one hook, `useScrub(travel) → [ref, progress]`: a passive, rAF-throttled
`scroll`/`resize` listener that measures `getBoundingClientRect()` **inside** the
frame and maps the element's passage through the viewport onto `0 → 1`.
Consumers never see raw scroll position; they take stage timings out of it with
`scrubSlice(p, from, span)` and SVG draw-on with `drawProps(p)`.

Two measured properties of the band matter:
- it starts at `0.9 × innerHeight`, not `1.0`, so an element is already in motion
  when it becomes visible;
- its span is clamped to `documentElement.scrollHeight − innerHeight − from`, so
  elements near the bottom of the page (the footer wordmark) can still reach 1
  instead of saturating at 0.6 — the first harness run failed exactly this way.

Under `prefers-reduced-motion` the hook does not subscribe at all and returns 1,
which is what makes "nothing is gated" a structural property rather than a
per-component convention.

**How the check can fail:** each section is swept in 110px steps and its derived
progress must move >0.25, never step backwards by more than 0.004, and arrive at
≥99.5 % of its own maximum — three separate assertions per section, six sections.

---

## T2-D12 — Pointer-follow 3D writes to the DOM, not to state

`<Tilt>` sets `el.style.transform` and the `--mx/--my` sheen variables directly
from a `pointermove` handler. A React state write per mouse move re-renders the
capability grid on every frame of a pointer sweep; the DOM write costs one
compositor commit and keeps the `.sheen` radial reading as a specular highlight
on the same card. The rect is cached on `pointerenter` (a `getBoundingClientRect()`
per move is a forced layout), and the transition duration changes with intent:
420 ms expo on enter, 140 ms out-soft while tracking, 700 ms expo on leave.

**Measured:** `idle "none"` → `centre matrix3d(… −6 …)` (pure lift, zero tilt by
design at the middle) → `corner matrix3d(0.994226, …, −0.107305 …)` (real
rotateX/rotateY) → `afterLeave "none"`.

---

## T2-D13 — The accordion stays a `<details>`

§6.2-11 wants smooth height animation. The obvious implementation is a JS-driven
`max-height` on a controlled `<div>`, which costs the disclosure its semantics,
its keyboard behaviour and its URL-fragment behaviour. Instead: `interpolate-size:
allow-keywords` plus a `details::details-content` transition of `block-size: 0 →
auto` with `content-visibility … allow-discrete`. Browsers that do not understand
the pseudo-element open instantly; nothing else changes.

**Measured:** box `0px → 139.469px` through `77.9, 124.3, 136.0, 139.0, 139.45,
139.47` (a real curve, not a jump), `CSS.supports('selector(::details-content)')
=== true`, answer still 100 % text in the accessibility tree.

---

## T2-D14 — An animated chart is the same measurement, not a nicer one

The benchmark teaser re-renders run #6's four setups as bars, scaling each metric
to its own best so the gaps are the real ratios, and it sits directly above the
table with the identical numbers. Two rules came out of the screenshot review:
the row labels must carry their identity (`A · single LLM` … `D · full AgentOS`),
because bare `A/B/C/D` read as placeholder text; and the accent "winner" bar is
chosen by metric direction (highest score wins, lowest cost and latency win), so
the chart cannot quietly flatter the priciest, slowest setup.

---

## T2-D15 — Every section's animation must be more than a fade-up

§6.2 is explicit that a basic fade-up does not count. The Models & routing rows
originally shipped as a `FadeUp` stagger, which passes visually and fails the
brief, so they were replaced by the route-draw (`model-routes.tsx`): hairline
draws left→right, packet rides the leading edge, copy rises behind it, hairline
hands back to the row border. The audit trail is the section list itself —
1 hero line-mask, 2 manifesto line-mask, 3 pipeline scrub-draw, 4 tilt, 5 pinned
panel transitions, 6 scrubbed typewriter, 7 count-up, 8 route-draw, 9 glyph
line-draw + pulses, 10 bar growth, 11 `::details-content` height, 12 wordmark
wipe + cascading links.

---

## T2-D16 — The auth background is CSS, not a second WebGL context

§7.2-2 allows "gradient shift or animated background" for /login and /signup.
The hero's fluid shader was *not* reused there: these are the two routes that
must stay small (they are the entry point, and M6 measures them), and a second
context means a second compile, a second RAF-driven render loop and a second
chunk of main-thread work for the least interactive page in the app. Two accent
gradient lobes on 26 s / 34 s alternating `transform` loops cost nothing, stay
on the compositor, and the harness asserts `document.querySelectorAll('canvas')
.length === 0` on both routes, so the decision is enforced rather than merely
intended.

---

## T2-D17 — The entrance is a keyframe, not a JS-flipped inline style

The first version animated with `opacity`/`transform` inline styles flipped by an
`entered` flag after a double `requestAnimationFrame`. That has a cost nobody
sees in a screenshot: the server HTML carries `opacity: 0`, so the content is
invisible until React hydrates — and for a reduced-motion visitor, whose
`useReducedMotion` cannot be evaluated on the server, it is invisible *longer*.
The animation is now CSS (`.auth-stage`, `.auth-rise`), so the first painted
frame is already the animated start state, the no-JS path shows the form, and
the global reduced-motion guard settles it without any JS involvement. The only
thing carried per element is `--rise-x` and `animation-delay`.

The same change caught a real defect: `animation-duration: 0.001ms` alone was
not enough, because `animation-fill-mode: both` keeps the `from` state applied
during the *delay* — the last step stayed invisible for 360 ms. `animation-delay:
0ms !important` now joins the guard.

---

## T2-D18 — Direction, not colour, separates login from signup

§7.2-8 asks the pair to feel like one surface. Both routes are the same card
with different words, so the transition cue is motion: the whole stack enters
from the left on /login and from the right on /signup (`--rise-x` −22 / +22,
scaled slightly per step). Navigating between them therefore reads as the card
moving rather than a page swap, and the direction is asserted numerically
(`directionX < −4` vs `> 4`) instead of eyeballed.

---

## T2-D19 — Motion is additive to the error path, never a replacement for it

The shake is `transform`-only and the ripple is a painted layer inside the
button; neither hides, delays or replaces text. The checks encode that:
`shakeKeepsContentReachable` requires the error node, `aria-describedby` and
`aria-invalid="true"` to be intact while the form is shaking, and
`errorShakes` additionally requires the animation to be *removed* afterwards
(`animationName === 'none'`) so a user who cannot see the shake is not left with
a permanently displaced form. `fail()` returns early under reduced motion — the
copy already says what happened.

---

## T2-D20 — A decorative layer that mutates the DOM owns its own ref

The ripple needed imperative `appendChild`/`remove` of spans the renderer must
not own. Written as a `useRipple()` hook returning `{ hostRef, onClick }`, React
Compiler's `react-hooks/refs` rule rejected it: the caller dereferenced the ref
during render (`ripple.hostRef` in JSX, `ripple.onClick` on the button). The
component form — `<RippleLayer />`, which reads its ref only inside
`useEffect` and attaches the listener to its own parent — is both legal under
the rule and impossible to misuse: the ripple cannot be pointed at the wrong
button, and it stays a child of the button it paints.

---

## T2-D21 — The "before" build is measured from a real worktree, not a checkout

**Decision:** `_lh/t2-before` holds a `git worktree` at the pre-Take-2 commit
(`5cdba16`), built and served on :3200 for the whole run; every before/after
comparison is two production builds answering the same question at the same time.

**Why:** the alternative — `git stash` / `git checkout` in the working tree — is a
destructive step against 141 uncommitted Take-2 files, and it makes the two
measurements sequential, so machine state (page cache, background load, Supabase
warmth) drifts between them. A second worktree costs disk and one extra server
process and removes both problems: the harnesses hit :3100 and :3200 with
identical scripts, and an A/B difference is a code difference rather than a
time-of-day difference.

**Cost:** the worktree needs its own `.env.local` copy (removed at teardown) and
its own `pnpm build`, so a "before" number is only ever as fresh as the last
build of that tree.

---

## T2-D22 — Third-party scroller caches are an explicit, bounded allowance

**Decision:** the listener-leak gate permits `wheel +2` and `resize +1` above the
fresh-route baseline after client navigation, and additionally requires those
counts to be *identical across four route hops*.

**Why:** the first version of the M6 check failed with "4 extra `wheel` listeners
left behind on /login". Traced by wrapping `addEventListener` and keying each add
by `type :: stack`, the residue was not ours: GSAP's ScrollTrigger binds one
`wheel` handler per scroller axis in `tweenScroll = {top: …, left: …}` at the
first scrubbed `init`, plus a per-scroller `resize`, and `kill()` of a trigger
does not release them — only `ScrollTrigger.disable()` does, which would break
every later section. Our own listeners (`fluid-layer` resize/pointermove,
`use-scrub` scroll/resize ×8, cursor) all return to baseline on unmount.

**How it stays honest:** the allowance is per *kind* and is only granted if the
count is a constant across hops — a per-mount leak in the same kind would show
`4/5/6/7` and fail. The pre-Take-2 build shows the same signature (`wheel 4`,
`resize 5` on /login after visiting the landing), which is the control that makes
"Take 2 added zero residue" a measured claim rather than an assertion. Playwright's
own action bookkeeping (`mousemove`, `mousedown`, `__playwright_global_listeners_check__`…)
is printed as INFO and never gated; the 13 kinds it adds are automation, not app.

---

## T2-D23 — Reduced motion must not pay for a WebGL context it will discard

**Decision:** `HeroFluid`'s effect re-reads the media query through
`prefersReducedMotion()` in addition to the `reduced` state, so no GL context is
ever created for a reduced-motion visitor.

**Why:** `useReducedMotion` deliberately starts `false` so server HTML and the
first client render agree (no hydration mismatch). The hook's own effect runs
*before* the component's, so the first pass still sees `reduced === false` and
`createFluidLayer()` ran — a full WebGL2 context, ~30 FBO-sized textures and a
rAF loop, torn down one render later. Functionally correct, but the M6 reduced-motion
assertion counted contexts *created* (`__t2gl`) and reported `1`: a real cost paid
by exactly the users who asked for less.

**Scope chosen:** the guard was added where the cost is real (GPU resources) and
not to the Lenis/scrub/cursor primitives, whose transient listeners are removed
by their own cleanup and were measured returning to baseline.

---

## T2-D24 — Lighthouse desktop is reported as a range and never used as the gate

**Decision:** three quiet passes per build, scores quoted as ranges; the perf gate
is CDP main-thread work per frame, which is hardware-portable.

**Why:** pass 1 and pass 2 of the *same* landing differed by 23 Lighthouse points
(after 71 → 94, before 72 → 93) because the box was busy — while the before/after
delta inside each pass was ±1. A metric with 23 points of noise cannot resolve a
10 KB, +1.4 ms/frame change, so claiming "Lighthouse 94 vs 93" would be reading
the noise. The sensitive instrument is `Performance.getMetrics`: main-thread ms
per presented frame, which repeated to within 0.1 ms across runs
(scroll 2.69–2.83 before vs 4.19–4.28 after).

**Consequence:** the run reports the regression it caused (scroll frame cost
+1.4 ms, worst long task in the interaction windows 0 → 166–184 ms, in-page LCP
904–940 → 984–1012 ms) as well as the improvement, and states the software-rasteriser
caveat rather than quoting SwiftShader fps as if it were GPU-verified.

**Superseded, same entry:** the numbers in that consequence line came from a pair
measured while the box was busy. T2-D28 re-ran both sides quiet and the scroll
delta is +0.7 ms/frame, not +1.4, with no LCP regression at all. The method
conclusion stands — gate on main-thread ms, quote Lighthouse as a range — but the
rule is stricter than written: the CDP metric needs a quiet box too.

---

## T2-D25 — 24×24 tap targets are reached with padding, not with a spec exemption

**Decision:** the auth switch links and the inline "Try again" submit get
`px-1 py-1`/`py-1.5` instead of the harness taking WCAG 2.5.8's
"in-the-middle-of-a-sentence" exemption.

**Why:** the responsive sweep flagged `a.text-accent` at 50×17 px on every width.
The spec would let an inline sentence link off the hook, and the first version of
the harness tried to encode that exemption — but its test (`parent's display
contains inline`) never fired, because the parent is a block `<p>`, so the check
was both unrunnable and quietly wrong. Vertical padding on an inline box grows the
hit area without changing the line box, so the user gets a 24+ px target and the
typography is unchanged. The harness now gates every interactive box with no
exemptions, which is the stricter reading and cannot be satisfied by a bug in the
exemption logic.

---

## T2-D26 — The a11y harness is run against the pre-Take-2 build too, as a control

**Decision:** point `tmp-t2-m6-a11y.mjs` at the `_lh/t2-before` worktree (`:3200`)
with the same gates, and keep the log (`_lh/take2/m6/a11y-before-control.log`).

**Why:** a green a11y suite on Take 2 answers "is it accessible", not "did Take 2
make it accessible". Running the identical harness on the untouched tree separates
the two, and it changed the story in both directions:

- The **tap-target failures are pre-existing**: the control build fails 8 checks,
  all of them `a.text-accent` at 50×17 / 41×17 px on `/login` and `/signup` at
  every one of the four widths. Take 2 fixed a defect it did not cause, and the
  honest framing is "fixed here", not "never existed".
- Everything else the control build also passes: same single `h1`, same heading
  sequence, 26 landing Tab stops with no repeats or traps, AA contrast measured
  from rendered pixels (9.50:1 on the hero eyebrow — the shader is not making the
  text unreadable), zero horizontal overflow at 375/768/1280/1920, reduced motion
  leaving no text below 0.9 opacity.

The check counts differ (87 control vs 90 Take 2) because on the Take-2 build the
email field's focus is verified through the pixel path, which emits three extra
lines; the gates themselves are identical.

**Superseded, same entry.** The shipped run is **98 checks**: the pixel path became
an always-on gate (T2-D27) and the mobile-drawer sequence added five more (tap opens,
no overflow while open, ≥24 px inside, tap closes, 44 px toggle). The control build
was never re-run with those gates — its 87/8-FAIL figure is the snapshot this entry
was written against, and it is still the correct basis for the "pre-existing
tap-target defect" claim. Take 2 measures the hero eyebrow at 9.40:1 where the
control reads 9.50:1: the 0.10-point difference is the fluid background, and both sit
far above the 4.5:1 AA floor, which is exactly the point of measuring it on both
trees.

---

## T2-D27 — Focus indicators are proven twice, and the pixel path always runs

**Decision:** keep both halves of the indicator check — computed-style change on
every Tab stop, plus a rendered-pixel diff on a sampled stop even when they all
change — and blur the page before the baseline snapshot.

**Why:** three separate traps showed up while getting this non-vacuous.

1. The baseline paint was captured with `/login`'s `autoFocus` already on
   `#email`, so that field's "unfocused" style *was* its focused style. It read
   as "no computed change on focus" and was farmed out to the pixel test every
   run — a test artefact masquerading as a product finding. `COLLECT_STRUCTURE`
   now blurs first; the auth pages then show 7/7 stops changing paint.
2. The pixel diff was initially swamped by the auth star field and grain layer,
   which repaint more of a 100×40 crop between two frames than a 2 px ring does
   (floor 20,358 px vs ring 3,958 px). Freezing `animation`/`transition` for the
   crop — the same kill-switch reduced-motion users already get — brings the floor
   to 0 px, and the measured diff goes to 3,782 px.
3. Freezing loops creates its own blind spot, so it is disclosed in the log and
   paired with the unfrozen computed-paint check. A ring drawn *as* an animation
   would be measured frozen here.

The gate can fail and is shown failing: suppressing `outline`/`box-shadow` on the
same stop collapses 3,782 px → 352 px, which is what proves the number is a focus
ring and not ambient repaint.

---

## T2-D28 — The M6 perf pair was re-measured on a quiet box, and the first delta was wrong

**Decision:** discard the first before/after perf pair for comparison purposes and
re-run three passes per build with nothing else on the machine
(`perf-before-quiet-run{1,2,3}.json`, `perf-after-final-run{1,2,3}.json`).

**Why:** the first pair put scroll main-thread cost at 2.69–2.83 ms/frame before vs
4.19–4.28 after (+1.4 ms), and in-page LCP at 904–940 → 984–1012 ms (a regression).
Both sides had been measured while other work was running. On a quiet box the same
binaries read 0.92–1.16 vs 1.76–1.87 ms/frame, and LCP 348–636 before vs 472–556
after — inside the *before* range, which was itself 288 ms wide. The direction of
the earlier claim was right (Take 2 does cost more per scroll frame) but the
magnitude was ~2× overstated and the LCP "regression" does not survive the noise:
the after spread is narrower than the before spread.

**Consequence:** §13 reports the quiet pair only, with N=3 ranges, and states that
the earlier contended pair was superseded rather than quietly dropping it —
T2-D24's rule (gate on main-thread ms, treat Lighthouse as a range) turned out to
apply to the CDP numbers themselves, not just to Lighthouse.

---

## T2-D29 — The mobile drawer has to be closable with the thumb that opened it

**Decision:** raise the marketing `<header>` from `z-40` to `z-50` so it paints
above the `z-[45]` mobile overlay, instead of adding a separate close button or a
tap-the-backdrop handler.

**Why:** §8 asks whether the nav is "usable one-handed", and the a11y harness only
proved the *closed* button was 44×44. Adding the missing check — tap to open, then
tap the same control again — made the run die in Playwright's actionability retry
loop: the overlay is `fixed inset-0 z-[45]` and the header was `z-40`, so with the
menu open the hamburger/X position hit-tests to the overlay, not the button. The
drawer could be dismissed by Escape (a phone has no Escape) or by picking a link and
navigating away, but not by the control whose `aria-label` literally reads "Close
menu" and whose two bars rotate into an X. That is a one-handed dead end, and it was
invisible to every check that existed.

**Evidence after the fix** (`scripts/tmp-t2-m6-drawer.mjs`, 375 px, `hasTouch`,
`isMobile`): open state reports `expanded true`, `label "Close menu"`,
`hitTarget "button.text-text"` at the button's own centre, overlay opacity 1; the
second tap returns `expanded false`, overlay opacity 0, and the drawer's five link
targets measure 44 px tall. No page errors.

**Rejected alternatives:** a close affordance inside the overlay (duplicates a
control the header already owns, and the X animation already exists up there), and
backdrop-tap-to-close (an invisible target; §8 asks for a usable menu, not a guess).

---

## T2-D30 — Hand-written hover rules get the same `(hover: hover)` gate Tailwind applies

**Decision:** wrap `.sheen:hover::after` and `.auth-cta:hover` in
`@media (hover: hover)`, leaving `:active` ungated.

**Why:** the hostile pass asked "dead hover states on touch?", and the honest answer
was *yes, two of them*. Tailwind v4 emits its own `hover:` variants inside
`@media (hover: hover)`, so the ~200 utility-hover classes were already safe — which
is exactly why the risk moved to the two rules written by hand in `globals.css`. On
touch, a tap leaves `:hover` stuck until the next tap, so the card glow stayed lit at
the last touch point and the auth CTA stayed lifted by `translateY(-1px) scale(1.012)`
after its press animation should have ended. `:active` is the tap itself, so it stays.

**Scope check:** the only JS-driven hover in the landing/auth surfaces is the auth
CTA's `onMouseEnter → setDoor('nudge')`, which already had a symmetric
`onMouseLeave`; no third hover path was found by grepping `:hover` and
`onMouseEnter|onPointerEnter` across `src/`.

---

## T2-D31 — The M7 checklist was run as an adversary, and three of its checks could not fail

**Decision:** keep the shipped behaviour as the contract and fix the checks that
were measuring the wrong thing, but make one real product change out of the pass:
`#email-error` and `#password-error` in `src/components/auth/auth-form.tsx` now
carry `role="alert"`, so a failed validation is *announced* rather than only drawn.

**Why:** §15 asks for "working features verified by real interaction", so the M7
harness (`scripts/tmp-t2-m7-verify.mjs`) was written to be able to fail, then run
four times against the rebuilt production bundle: **7 FAILED / 47 checks → 2 FAILED
/ 50 → 1 FAILED / 50 → ALL PASS (50 checks)**. Every one of the earlier failures
was worth reading carefully, and only one was the product's:

1. *Empty submit produced no alert* — **real, fixed in the product.** The form did
   render `Enter your email address.` in `text-danger` with `aria-invalid="true"`
   and `aria-describedby`, so it looked fine in a screenshot, but the only live
   region on the page wrapped the *server* error. A screen-reader user pressing the
   CTA with empty fields heard nothing at all. `role="alert"` on the two field
   paragraphs makes the check ("announces an alert … through email-error+password-
   error") assert the announcement, not the paint.
2. *Server rejection did not change the message* — **harness, and it was vacuous in
   the other direction too.** The wait compared `alertText !== prev` with `prev`
   `null`; on a page with no alert the expression is `undefined !== null`, which is
   true, so it resolved instantly and the follow-up read printed `null`. It could
   never have failed. The real path is a `POST /auth/v1/token` that answers 400 and
   puts "We couldn't sign you in with that email and password." in the DOM in ~2 s;
   the predicate now demands a non-empty message. The same deliberate rejection on
   the signup side returned **429** once the address had been used repeatedly, which
   the form maps to its own rate-limit sentence — so the console filter accepts 400
   or 429, says how many lines it filtered, and prints the recorded statuses
   (`INFO: HTTP >=400 responses recorded: 400 /auth/v1/token, 429 /auth/v1/signup`)
   instead of hiding them.
3. *Section #start content at opacity 0.55* and *section 6 at 0.00* — **harness,
   wrong scope.** The content-gating rule sampled *every* animated node in a
   section. Two of them were designed to be dim: `[data-char]` spans are M4's
   magnetic display type, whose rest opacity is deliberately 0.55 (≈6.4:1 on this
   pairing, still AA), and `model-routes.tsx` draws an accent line that stays at 0
   until its route animates. The rule now applies to nodes that carry text, and
   decorative nodes are counted and reported rather than silently skipped
   (`… 2 text-bearing animated node(s), 26 decorative excluded`). Two guards keep
   the rewrite honest: a pointer on a glyph must lift it (rest 0.55 → 1.00, floor
   0.55 — the type is responsive, not trapped), and an aggregate
   `6 of 11 sections proved a reveal that starts hidden and ends visible` stops the
   per-section loop from passing by asserting nothing.
4. *No ripple on the CTA* — **harness, ambiguous selector.** `.auth-cta` matches two
   buttons: the pairing link in the header (no `RippleLayer`, and clicking it
   navigates away) and the submit CTA, which has it. Targeting
   `button[type="submit"].auth-cta` paints 1 node on a real press and 0 after 1.05 s,
   so the ripple both exists and cleans itself up. Mid-press sampling also had to go:
   `RippleLayer` listens for `click`, which fires on release.
5. *`--rise-x` null on both routes* — the var is set inline on each `.auth-rise`
   wrapper, not on `:root`, so the pairing-direction check was reading the wrong
   element. Read from the wrapper it now shows the two signs apart.

**Boundary respected:** the fix in (1) is markup on an error paragraph. No auth
logic, no `middleware`/`proxy`, no `lib/llm/**`, no API route was touched, and no
credentials were typed into any field that could succeed — the rejection probes use
`@uiux-take2.invalid` addresses.

**Follow-up this entry obliges:** the bundle changed, so the M6 98-check a11y gate
and the Take-2 harness family were re-run against the rebuilt build rather than
carried over from the pre-fix run.

---

## T2-D32 — The fail-open evidence needed a second production build, not a runtime env swap

**Decision:** produce the M7 app-surface evidence from a second copy of the source at
`_lh/t2-failopen-app`, built with a placeholder-only `.env.local` and served by
`next start -p 3110` (`_lh/harnesses2/t2-failopen-isolated.sh`), rather than
reconfiguring the shipped bundle at runtime or dropping to `next dev`.

**Why:** §15 wants landing → login → signup → app → chat → dashboard → run view
walked end to end, but no session exists in this tree, §12 forbids creating one or
making a paid model call, and §10 puts the auth code off-limits. The product's own
documented fail-open path (`src/lib/route-gate.ts`: `!configured → allow`) is the
only door that opens without breaking any of those. Reaching it took three
measurements, each of which killed an approach:

1. *Edit `.env.local`, restart `next start` on the shipped bundle* — every gated
   route still 307'd to `/login`. `NEXT_PUBLIC_*` is inlined at build time, so the
   built proxy chunk carries the literal. Quantified rather than asserted: walking
   both build trees for the project ref and the publishable key finds them in **30
   files under `repo/.next`** and in **0 files under the copy's `.next`**.
2. *`next dev` in the repo directory* (dev reads env per compile) — Next 16 refused:
   `.next/dev/lock` hands the caller the instance already running, so the command
   printed `Another next dev server is already running … PID 37668 … :3000` and
   exited. That :3000 server is not this run's, so it was left alone rather than
   killed.
3. *Junction `node_modules` into the copy* — Turbopack rejected it outright:
   `Symlink [project]/node_modules is invalid, it points out of the filesystem
   root`. The copy therefore gets its own install from the pnpm store (734 packages,
   0 downloaded); the copy's `prepare` script (`git config core.hooksPath`) fails
   because a scratch copy is not a git repo, which is expected and checked for by
   the tree, not the exit code.

A fourth incident shaped the guards: an orphan `next start` from an earlier attempt
was still holding :3110, so the next run measured a server it had not started and
reported a clean pass. The harness now refuses to begin unless :3110 is free, clears
its request ledger after the :3100 control, aborts the whole run if the preflight
lands anywhere but `/app`, and asserts `location.pathname === route` per capture.

**Consequence — the constraint became the strongest part of the evidence.** The
copy's env file contains no credential of any kind (placeholders shaped to satisfy
`src/lib/env.ts`), so §12's "no paid model call" and "no account" are structural
properties of that instance instead of promises: `/api/dashboard`,
`/api/agentos/runs` and `/api/spend` all answer 500 by construction, and the
browser-side ledger recorded **307 requests across exactly 1 host (localhost:3110),
zero POSTs to `/api/chat`** on the final ALL PASS run (`_lh/take2/m7/appsurfaces-isolated3.log`;
the two earlier runs of the same session recorded 322 and 325, also across one host
— the count moves with retries, the single host never does). The cost is equally explicit: data surfaces can only
show their empty and error states here, so the harness prints 4 `GAP` lines —
populated dashboard, run replay, streamed chat — and a gap is never counted as a
pass (`RESULT: ALL PASS (45 checks passed, 4 disclosed gap(s))`).

**Two harness bugs this exposed, both mine, both fixed:** the cursor check sampled
server HTML before hydration and reported "the landing cursor did not reach the app
shell" for `/dashboard` and `/agentos` (a bounded poll now waits for
`[data-t2-cursor]` and reports the hydration time — 294–350 ms — and still fails if
it never arrives); and the "not a blank surface" rule was one character budget,
which failed the chat workspace at 565 chars *by design* while passing a dashboard
carrying 71,136. Each route now declares the element that makes it that route
(composer / ≥4 sections / the run-replay aside).

**Product finding, outside Take-2 scope:** that 71,136-char dashboard is real — the
Model Pool health panel renders the entire in-code registry as **625 table rows**.
Pre-existing MP-M6 behaviour, not a Take-2 change, and `lib/model-pool/**` is exactly
the kind of routing code §10 says not to touch for cosmetics. Logged as a
needs-human item rather than silently edited.

---

## T2-D33 — Teardown: the harness family leaves the repo, and still has to run

**Decision:** at close, all 22 `scripts/tmp-t2-*.mjs` harnesses move out of the repo
to `_lh/harnesses2/` (the Take-1 precedent, UX-D40: the app ships without a second
test runner), the two scratch build trees are deleted, `:3110` and `:3200` are
stopped, and `:3100` keeps serving the shipped bundle.

**Why relocation could have been a silent lie:** Take 1's relocated harnesses import
bare `playwright`, which does not resolve outside `repo/` — they are source, not
re-runnable. Relocating a family whose whole purpose is "the numbers can be re-made"
only preserves the evidence if the moved copies actually run. Three real breaks had
to be fixed for that, all found by reading, not by hoping:

1. Node resolves bare specifiers from the **importing file's** directory, so
   `import { chromium } from '@playwright/test'` fails from `_lh/harnesses2/`. The
   shared launcher now `createRequire`s from `repo/package.json`. One file owns the
   dependency, because every other harness imports the launcher, not Playwright.
2. Six harnesses built their artifact dir as `../../_lh/…`, which from the new home
   points outside the workspace; and the two capture harnesses wrote
   `../docs/uiux-take2-<mode>` (repo-relative). All repointed.
3. Verified rather than assumed: a relocated-launcher smoke test loaded the shipped
   bundle (`title` + a live `webgl2` canvas), then `tmp-t2-m7-verify.mjs` was run
   from its new path into a fresh dir
   (`_lh/take2/m7/teardown/m7-verify-*.json`) → **`RESULT: ALL PASS (50 checks)`**.

**Deletion mechanics worth recording:** `git worktree remove --force` unregistered
`_lh/t2-before` but failed to delete it — `error: failed to delete …: Filename too
long`, because pnpm's store paths exceed `MAX_PATH`. The directory was emptied with
`robocopy <empty-dir> <target> /MIR` and then `rmdir`. Both scratch trees
(`_lh/t2-before` 654 MB, `_lh/t2-failopen-app` 1.4 GB) are gone; `_lh` is now 93 MB.
Neither is irreplaceable: the control is one `git worktree add` from the real commit
`5cdba16`, and the fail-open instance is fully scripted by
`_lh/harnesses2/t2-failopen-isolated.sh`.

**Secret hygiene at teardown:** the worktree's copied `.env.local` and
`_lh/take2/m7/env.local.orig` were both removed with their trees (verified: `find
_lh -name "*.env*"` returns nothing, and the only remaining file mentioning Supabase
is the superseded script, which contains variable *names* only — checked without
printing values). `repo/.env.local` is the single live copy, gitignored, untouched.
`_lh/harnesses2/t2-failopen.sh` was deleted as superseded; a stale pointer to it in a
harness comment was rewritten to name the isolated script instead of leaving a
dangling reference behind.

**Gates after the move** (`_lh/take2/m7/teardown-gates.log`): `pnpm typecheck` ✓,
`eslint . --max-warnings=0` ✓ (exit 0), `pnpm check:tokens` ✓. The tree as handed
over is 30 entries — 17 untracked (7 Take-2 docs + 10 new source files), 12 modified,
1 deleted — and contains no scratch scripts.

**Rule:** a harness you cannot re-run is a screenshot, not evidence. Relocation is
only finished when the moved copy has executed from its new path.
