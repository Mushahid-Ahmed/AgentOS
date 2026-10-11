# UI/UX Take 4 — decisions log

Prompt of record: `AGENTOS_UIUX_PROMPT_V4.md` ("impossible" animations + advanced text
choreography). Format per §8: Context / Options / Chosen / Why / Consequences / Risk /
How to reverse. Every number below is a measurement from `_lh/harnesses4/` — or, where an
entry names it, the retained `_lh/take3/m9/` wheel gate — taken on
`http://localhost:3100` (production build) in Playwright Chromium 156 under software
rendering — see the caveat in the M2 entry.

## M5 — Job 3's micro-interactions: gestures, not states

**Context.** §5 prescribes eight small behaviours on the chrome around the nine sections M4
built: the nav logo that draws itself and the wordmark that springs in, the character wave,
a nav bar that "shrinks smoothly (height transition)", hides on scroll-down and comes back
on scroll-up, an active underline that slides from link to link, Lenis inertia, a preloader
that lifts away before the hero starts, a curtain reveal on every image and diagram, the two
link-hover idioms, and a footer that overshoots as it rises with staggered columns. Three of
those sentences collide with §6.2's banned-property list, one of them collides with §1.4
(zero paid calls), and one of them asks for a gesture on a thing this product does not have.
Gate of record: `_lh/harnesses4/t4-m5-micro.mjs`, **50/50** including the four upstream
gates re-run as their own scripts (m4 40/40, m3, m2, m9 15/15 with
`lenis=false,false,false` still on the workspace routes).

**Options.** For each collision: (a) implement the sentence literally, (b) implement the
intent with the property §6 allows, (c) decline the part the product cannot support. None of
these were close calls in the code; they were close calls in what the page would be able to
*claim*.

**Chosen — (b) three times, (c) twice, and two defects found by the gate itself.**

_§5.1 "height transition" → `transform: scale()` on the row._ Animating `height` on a fixed
header is a layout read plus a re-layout of the whole document on every frame of a scroll —
the exact property §6.2 bans and the thrash §6.10 bans. The row now takes `scale(0.92)` with
`transform-origin: 50% 0` (`globals.css:1304-1311`), so the bar reads as tightening while
its box never changes: measured `row scale 1 at the top → 0.923 when solid`, rect height
64 → 59px with the layout box still 64px, held through hide and un-hide. The one pixel the
header *does* grow (64 → 65px) is §5.1's own bottom hairline appearing with solidity — a
border, not a motion, and the only layout difference on the bar. Same ruling for the
travelling underline: a 1px bar `translateX`'d to the link's `offsetLeft` and `scaleX`'d to
its `offsetWidth`, which is the identical picture to animating `width` without the layout.
Verified against the link it claims to track rather than against itself — `e = 0 → 85 → 192 →
276 → 389` equal to `offsetLeft 0 / 85 / 192 / 276 / 389` at five sections, strictly
increasing, with the positive control that at y=0 (no section owns the reading line) the
marker is scaled to *nothing* — a marker that only faded would still occupy its link width
there.

_§5.1 hide/show is a state the visitor who opts out still gets._ `translateY(-100%)` past
320px of scroll-down, back on the first pixel of scroll-up *while still past 320*, so the
un-hide is proven to be the scroll-up rule and not "near the top again": `y=827 → f=-65` of a
65px bar, then `y=531 (> 320) → f=0`. Under reduced motion the dataset flips but the
transform is never written (`§6.7`: the bar never moves for a visitor who asked for no
motion), which the reduced-motion context measures with a real 900px wheel.

_§5.4 the curtain is mounted client-side only._ A veil painted into the server HTML would
be a tarpaulin for every crawler and every script-disabled visitor — the content would be
covered by markup that only JavaScript removes, which is §6.9's "animate from invisible, not
from absent" read backwards. So the panel appears one step *after* the HTML, through
`useSyncExternalStore` rather than a setState in an effect (the first client render must
agree with what is being hydrated). The raw response is the evidence: `GET / → 152567 bytes`,
`curtain-veil` absent (index -1), the covered benchmark table header present at byte 76853.
And the curtain is proven *not to be a fade*, which is the easy way to fake this gesture: the
covered element reads `opacity: 1` across 11 samples while a 546x66 panel lies over it, the
sweep is 7 strictly advancing distinct positions (-5.4 → -550.9px of 546), the two instances
uncover on different axes (bus sideways, table downward, the other component's axis pinned
at 0), and the veil unmounts afterwards. Positive control for deep links: jump the panel
*above* the viewport and it still uncovers — no tarpaulin for scroll-skippers.

_§5.5 the external-link arrow is half measured, half asserted, and the split is in the check
name._ The product has exactly one `target="_blank"` anchor — a citation inside the AgentOS
run view — and that panel only renders citations from a real run, i.e. a paid provider call
§1.4 forbids; the stored account's replay picker is empty (`probe-m5-agentos.mjs`: `ext links
= 0`). Rather than spend money or invent a fake external link to hover, the rule is measured
under a real hover on the exact product class pair (`link-external` + `ext-arrow` → `rest (0,
0) → hovered (3, -3) over 0.26s`, with a same-position control *without* the class staying at
(0, 0)) and the wiring is asserted in source separately. The centre-out underline is measured
whole: `scaleX 0 → 0.509 → 0.838 → 0.947 → 0.997 → 1 → 0 on leave`, origin 24.27px of a
48.5px box, on a `::after` so the word cannot reflow (box 48.5px at rest and hovered).

_§5.6's "social icons jiggle on hover" is refused, not faked._ The product has no social
profiles; three invented handles existing only to be wiggled would put fabricated product
facts on the page for the sake of one gesture, which §7 forbids more firmly than §5 asks for
the animation. The refusal is written into `landing-footer.tsx` and gated as an honesty
check: `7 footer anchors, 0 absolute off-site URLs`. The hover personality is carried by the
wave, the tilt cards and the centre underline instead.

_Two defects the gate caught, both real._ (1) The preloader counter could render **"-1%"**
for one frame: a rAF timestamp can precede the `performance.now()` taken in the effect that
scheduled it, so `t` went negative before the clamp. Fixed by clamping `t` to [0,1] in
`preloader.tsx:50`; the gate now reads 16 samples, min 0, max 100, 0 negative, 0 backwards —
a check that would have failed against the bundle built an hour earlier. (2) The progress
fill was already a `scaleX` (layout width pinned at 160px while the rendered width ran
0/45/72/101/128/154/160px), but the *first* version of the check measured
`getBoundingClientRect()` and called it "computed width", which is the one width that is
supposed to change — the assertion would have passed on a `width` animation and failed on the
correct implementation. Layout width and rendered width are now reported apart, because their
parting *is* the §6.2 evidence.

**Why it had to be a series.** A finished state proves nothing about how it got there: an
opaque logo is the same picture whether it sprang through a 7° rotation or never animated. So
the gate samples in flight — the dash offset travels 1 → 0.358 → 0.126 → 0.038 → 0.018 →
0.005 → 0, the wordmark goes 0.615 → 1.086 → 1 (and no earlier than the panel's exit:
animation from t=500ms, exit announced t=450ms), the footer crosses its own finish line
(-2.0px, 10 samples past zero, deepest -5.48px) which an expo or linear curve cannot do, and
the wave holds ≥3 distinct letter heights in 8 of 15 synchronised samples *with the crest
index walking rightward* in 4 of them — five letters bobbing in unison is not a wave and
would fail — while the link the cursor never touched peaks at 0px of spread.

**Consequences.** Three obligations the rest of the run inherits. (1) **A `scrollTo` during
a Lenis easing is dropped.** Measured, not assumed: a 38px-per-40ms staircase never got past
its first step, and a request issued while a wheel animation was still carrying the page held
it at Lenis' own target — which is what made the first marker sample read `active=-1` at
y=480 when it asked for y=1829. Every scroll in a harness must now be one request, then a
wait for quiescence, then a re-request (`gotoWait`). (2) **A gesture check must be paired
with a control that reads the opposite way** — the flat link, the unclassed arrow, the
marker scaled to nothing, the panel jumped past. (3) **Playwright's actionability is not a
gesture**: at 375px the desktop Login is `display:none`, so its centre is `NaN,NaN` and a
`.click()` there spends 30 seconds waiting to prove nothing. The nav interactions are now
`elementFromPoint`-hit-tested trusted input (`mouse.click`, `touchscreen.tap`) at the
element's own coordinates, which is both the same question answered in the page and the only
way to keep §1.2's mobile assertions honest: the *same point* that opened the overlay closed
it, which is the header-above-overlay z-order claim.

**Risk.** The scale-on-the-row is a visual approximation of a sentence that asked for a
height transition; a reader who expects the bar's box to change will find it unchanged, so the
ruling is stated in `landing-nav.tsx`'s header comment as well as here. The reduced-motion
dataset (`navHidden=unset` rather than `0`) is a legitimate reading of "never move" but could
surprise a later gate that expects a value; the check tests `!== '1'` for that reason. And
`§5.5`'s external-arrow half is a rule measurement plus a source assertion, not a live
instance — if the run view ever grows a second, cheaper external link, the check should be
upgraded to the real thing rather than left as the best available proxy.

**How to reverse.** Each ruling is local and small: the shrink is one CSS rule
(`.nav-shrunk > nav`) — a literal height transition is a two-line swap there, at the §6.2 cost
this entry documents; the marker travel is a `translateX/scaleX` string in one effect in
`landing-nav.tsx:164` and reverts to `width` in the same place; the curtain's client-only mount
is the `ready` flag in `curtain.tsx:52` — delete it and the veil ships in the HTML, which the
no-JS check will immediately fail; the jiggle needs social profiles to exist first; and the
`gotoWait`/hit-test rules are harness-side, so reverting them only re-breaks the gate, not
the product.

## M4 — the nine §4 sections: what the choreography could not be told to do

**Context.** Job 2 names nine landing moments and prescribes one "impossible" animation
each: hero depth split, the diagonal manifesto mask, the pipeline draw → node pop →
travelling data, the capability shuffle, the slot-machine counters, the routing request,
the benchmark bars, the FAQ paper fold, the CTA gathering. M2 already owns the hero type
flight, so M4 adds the scroll half of it and builds the other eight on the mechanisms M3
left standing (`useScrub`, `useInView` + the reveal watcher, the shared ease tokens). The
owner's three rulings bounded the pass: keep workspace routes native, glow on cards only,
never on buttons.

**Options.** Where the brief and the repo disagreed there were always two readings
available: (a) implement the sentence — the AgentOS bar overshoots last, the readout says
"Stage 1 of 6", the packet eases with `left`; (b) implement the intent against what this
product actually contains and record the deviation. A third choice was forced by
measurement rather than judgement: the census that polices §6.9 was itself wrong in two
ways, and a gate that reports "clean" for the wrong reason is worse than no gate.

**Chosen — (b), plus fixing the gate.**

_Honest data beats the scripted win._ §4 pictures AgentOS growing past the competitors. In
the real run-#6 24-task table the full AgentOS setup is the **priciest and the slowest** and
wins none of the three metrics, so staging the beat would require either re-ordering so D
lands last with the overshoot while scoring 0.90 against C's 0.92, or drawing a bar past its
measurement. The overshoot and the ding therefore go to **the metric winner**, computed per
metric (`higherIsBetter` for score, lower for cost and latency) — `bench-chart.tsx:17-25`
states the refusal in the file so the next reader does not "fix" it. Measured, sampling the
bars inside their own scrub band rather than at arbitrary offsets (the first version sampled
outside it and every bar was already 1, which is how a vacuous pass hid there):
`scales p0 [0 … *0 …] → p0.5 [1, 1, *1.039, …] → p0.78 [all 1, dings 3]` — the field stops
at 1.000, only the winner crosses it (1.039), the non-winner never exceeds 1.001, and the
ding markers go 0 → 3 with the third landing.

_Honest stage count._ `STAGES` has five entries (plan, team, evidence, critics, judge), so
the scroll-linked readout says **"Stage n of 5"**, not §4's "1 of 6". Verified climbing
`0 → 1 → 5 → 5` across the section and reading the real text at the end
(`"Stage 5 of 5Judge"`). Inventing a sixth stage to match a brief written against a
different pipeline is §7's forbidden hallucination with a number in it.

_Transform, not `left`._ The routing packet and the pipeline dot ride `translate3d` /
`translateX` keyframes (`.route-track` rails carry `translate3d(((line−1)*100)%,0,0)`;
`.pipeline-flow` runs `translateX(0 → 980px)`), because §6.2 forbids animating
`left`/`width`/`margin` and §6.10 forbids the layout thrash that follows. The gate checks
the class of bug rather than the fix: it counts inline `left` on every animated packet and
asserts `packets carrying an inline left: 0`, with 4 distinct offsets observed in 4.2 s.

_Reduced motion had to be re-checked, not assumed._ The slot reels are strips of 0-9
repeated four times, translated from row 0 to `40 + digit` rows. Under reduced motion the
component skipped the transition and left `translateY(0)` — which is not the resting state,
it is the digit **0**. The counters would have "gently" shown 0, 0, 0, 0 for 2, 3, 24, 6:
wrong content on the one axis §6.9 says motion must never gate. Fixed by pinning the final
row whenever reduced motion is on (`slot-counter.tsx:88-90`), and the gate now _decodes
which digit sits in each reel window_ and compares it to the `sr-only` twin — `decoded
reels 2, 3, 24, 6 (expected 2, 3, 24, 6)` in both motion modes, plus the assertion that all
reels are at row 0 before entering, which is what makes the decode non-vacuous.

**Why the gate changed shape.** The census is the mechanism that turns "we think nothing is
trapped" into a claim, and it was producing false passes and false failures in equal
measure. Four lessons, each now written into the code where it bit:

1. **Playwright evaluates page functions by `Function.prototype.toString()`.** A regex
   inside `page.evaluate((_) => /Stage (\d+)/)` is parsed as _Node source_, so `\\d` means a
   literal backslash followed by `d` and silently never matches. Four probes in this file
   were therefore asserting nothing. Only string-built sources (the `CENSUS` template) need
   doubled backslashes, because the string layer collapses them before the page parses them.
2. **Tailwind v4 writes individual properties.** `scale-y-0` compiles to `scale:` and
   `-translate-x-1/2` to `translate:`, leaving computed `transform: "none"`. The FAQ
   "+"-closes-to-"−" check was building a `DOMMatrix` off `.transform`, which is
   unparseable there (`new DOMMatrix('none')` throws) and would have reported identity if
   guarded lazily. It now reads `getComputedStyle(bars[1]).scale`. Same class of bug in the
   manifesto mark check: `.transform`'s `d` coefficient was always 1 because the effect
   animates the `scale:` property, so the "pass" was arithmetic on nothing; it now compares
   `scale 0.981` against the component's own `calc(0.9 + var(--sp)*0.1)` at the measured
   `--sp = 0.8144`.
3. **`Math.abs` wraps the coefficient, not the matrix.** `Math.abs(new DOMMatrix(cs)).a`
   is `undefined` and `.toFixed` threw inside the page, killing the pipeline block. Two
   call sites, one precedence bug.
4. **A mid-flight entrance is not a stranded reveal.** The deep-link check loaded four
   hashes and ran the census after a fixed 3.4 s, which flaked in both directions across
   five runs. Measured second by second (`probe-deeplink-secondly.mjs`): at t=1 s the nav
   and the masked lines above the landing point are still at opacity 0 (hydration has not
   drained the pending set) **and** the hero subheadline reads settled, because GSAP has
   not started its `fromTo` yet — it waits on `useIntroReady()`, i.e. the preloader signal
   or its 1800 ms guard, plus a 1.2 s lead. At t=2 s the words are at 0 and climbing. By
   t=4 s everything above the fold is revealed. So "opacity 1" is ambiguous and a fixed wait
   is a guess in both directions. The check now waits for a **finished** tween specifically
   (inline `opacity > 0.98`, which GSAP leaves behind; an empty inline style means "not
   started") and then gives the reveal pump a 3 s margin. A poll that expires still fails,
   because the census sees the words at 0.

The classifier also needed a principled boundary: a block still crossing the bottom edge is
motion waiting, not content left invisible, so `r.bottom > vh` opacity/clip cases are counted
separately (`entering 10`) and only `stranded === 0` above-and-on-screen is asserted. The
positive control keeps the whole thing honest — four manufactured hidden nodes (opacity,
clip-path, edge-on `rotateY`, off-screen lateral) must **all four** be flagged before the
zero on the real page is believed. The first control caught a real defect in the classifier:
deriving edge-on from matrix coefficients cancelled the projection out and let the `rotateY
78deg` node pass; rendered-width ÷ layout-width from the rect is the honest measure.

**Consequences — the keeper gate (`_lh/harnesses4/t4-m4-sections.mjs`), 43/43 on the
production build at `:3100`** (`t4-m4-deeplink-fix2.log`, playwright-chromium
156.0.8078.4, re-run green in `t4-m4-deeplink-fix3.log` after the deep-link fix). Each of
the nine sections is measured through a proxy it writes itself, at scroll offsets that must
produce _different_ readings: type −210 px vs fluid +210 px at a 420 px scroll (420 px
separation, canvas still mounted, §1.1 intact); the hint breathing through
1.000 → 1.150 → 1.198 → 1.030 with opacity 0.50 → 0.99 → 0.53; the mask sweeping
`polygon(-220% 0%, …)` → `polygon(0% 0%, 220% 0%, 160% 100%, -60% 100%)`; five lines
arriving from `22, -22, 22, -22, 22` px and clearing their transforms on settle; nodes
popping 0.82 → 1; dots riding each link mid-draw (0, 2, 0 per stop) with the packet running
once drawn; hover dimming 4/5 to 0.3, lifting 1 and lighting 1 connector; the deal stack
leaving a measured pile (`--dx 428px, --tilt 9.00deg`) into 8 dealt matrices and
re-stacking when scrolled back above it; the nearest-edge glow going 0 → 0.9 at
`--ga = 90.0deg` with **0** links or buttons carrying `.edge-glow` (the owner's ruling,
asserted rather than promised); the CTA words flying from −947/+870 px to 0 with an impact
beat, a 1280×555 canvas field lit 838 → 819 px after a 240 px pointer sweep, the magnetic
span pulled 14.97 px at +60 px and 0 px at +420 px (radius 100), and a ripple span
injected on click; the FAQ answer unfolding to `block-size 139.469px` from a closed 0 px and
opening with keyboard Enter on `SUMMARY` with no JS state.

§1.2 non-regression is not re-derived here, it is _chained_: the M3 scroll gate, the M2 hero
gate and the Take-3 mouse-wheel gate are re-run as subprocesses and their exit codes
recorded (`15/15 checks passed … lenis=false,false,false` on the workspace routes). Content
survival is asserted directly (`headings: 30`, `benchRows: 4`, `faq: 7`, `cards: 8`, exact
`h1` name, doubled-name 0), the auth surfaces census clean, and **0 requests** matched a
provider host across every page loaded in the run (§1.4, paid calls: zero).

**Risk.** Three things this gate does **not** cover, and M6 must. **(1)** Frame rate: every
number above is correctness of mechanism, not smoothness, and software WebGL on this box
floors fps regardless of the animation (§6.1's ≥50/≥45 stays an owner-side GPU check).
**(2)** The `entering` band is a tolerance: a reveal that never fires because the user has
not scrolled to it yet is indistinguishable, at one instant, from a reveal crossing the
bottom edge — the sweep and the jump-to-foot checks are what close that gap, and both pass,
but a _new_ section must keep its opacity-based hiding for them to mean anything. **(3)**
The deep-link settle poll trusts GSAP leaving an inline `opacity` behind; a future tween that
finishes with `clearProps: 'all'` would report "not started" forever and the poll would burn
its 15 s budget rather than fail loudly. The margin is 3 s, measured against a 4 s entrance,
so it is tight — if the preloader gets slower, this is the first check to go red.

**How to reverse.** Per section, each effect is one component or one block inside an existing
one: `slot-counter.tsx`, `deal-stack.tsx`, `gather-words.tsx`, `cursor-field.tsx`,
`parallax.tsx`, `sweep-reveal.tsx` and `use-parallax.ts` are additive files that
`landing-page.tsx` mounts, so deleting the mount restores the previous section; the
in-place edits (`pipeline.tsx`, `model-routes.tsx`, `bench-chart.tsx`, `faq.tsx`,
`preloader.tsx`, `magnetic.tsx`, `tilt.tsx`, plus the `globals.css` keyframes) revert as a
unit. The three honesty decisions should **not** be reverted to satisfy §4's wording: the
per-metric winner, "of 5", and the transform-only packet are each load-bearing against §7,
§1.2 and §6.2/§6.10 respectively. Superseded artifacts are retained rather than averaged:
`t4-m4-run1..7.log` (the flaky fixed-wait deep links), `probe-deeplink-secondly.mjs` output
is quoted above, and the vacuous pre-fix readings are described in the body so nobody has to
re-derive why the checks look fussy.

## M3 — scroll infrastructure: the reveal mechanism was trapping content

**Context.** M3 was meant to be a verification pass, not a change pass: prove the scrub
engine (`use-scrub.ts`), the Lenis route gate from Take 3/M9, and the §4 scroll-linked
sections all still work on the V4 build. The three open readings from the owner blocked the
write-up: **(a)** why the harness counted only **6** `pathLength=1` SVG paths, and why the
hidden-reveal census plateaued at **42** nodes and never fell again; **(b)** whether the
Lenis column was measuring the library or a leftover global; **(c)** whether `/login` had
unreachable overflow content at 375×667.

**Options.** (a) report the 42 as decorative/done and move on — the number was stable and
nothing visible looked broken; (b) make the 42 a falsifiable invariant ("zero text-bearing
blocks stranded above the viewport at every scroll position") and find out what they are;
(c) rewrite the reveals to fire on a plain scroll handler and drop IntersectionObserver.

**Chosen — (b), then (b)'s fix.** The answer to reading (a) was: **6 is correct, and the 42
were a real defect.**

_6 paths._ Only `arch-grid.tsx` normalises stroke length for a scrub — `drawProps()` sets
`pathLength = 1` on one `<path>` per glyph and the `ARCH` table has six glyphs
(`src/components/landing/arch-grid.tsx:85`), so six was the whole population on the page
under test. The other "self-drawing" sections are not SVG strokes at all: benchmark bars and
routing lines animate `transform: scaleX()`, the pipeline offsets `stroke-dasharray` across
each line's own pixel length without touching `pathLength`, and the footer wordmark wipes
with `clip-path: inset()`. (`pathLength` does appear elsewhere in the app — the auth
checkmark and the dashboard arc meters — but those are static one-shot draws on other
routes, not part of this census.) Counting `pathLength=1` was the wrong instrument, which is
why the new harness reads **one proxy per scrub family** (`arch` from dashoffset,
`bench`/`routes` from the `DOMMatrix` `a` component, `pipeline` from
`1 − offset/cycleLength`, `wordmark` from the parsed inset percentage) and asserts each
independently.

_42 nodes._ Those were IO-gated reveals that never fire, i.e. content trapped behind an
animation — exactly the alternative the owner asked be ruled out. The rule it breaks is the
spirit of §6.9 inverted: "animate from invisible, not from absent" requires the text to be
in the DOM before the animation, and these blocks were in the DOM permanently and visible
never, which is absence wearing a transform. It is also §1.2 (don't break existing
functionality) — the content was unreadable on gestures the user actually performs. Cause,
measured (`_lh/harnesses4/probe-io-skip.mjs` → `t4-m3-ioskip.json`): `IntersectionObserver`
reports _changes of intersection state_. A single `scrollTo()` that carries an element from
below the viewport to **above** it never produces an intersecting entry — one log line,
`isIntersecting: false`, and the block still sitting at `opacity: 0` inline at the target
position; 17 text-bearing blocks left behind by that one jump. The slow 400 px sweep instead
logs `isIntersecting: true, ratio 0.744` and reveals. Worst case is a reload: the browser
restored at `scrollY 9164` and **38** blocks came up at opacity 0 — everything it had
jumped over. The plateau at 42 was simply the accumulated population of jumped-over
reveals, and it never fell because nothing would ever revisit them. Real user gestures hit
this: Ctrl+End, dragging the scrollbar thumb, deep links, reload-restore.

**Fix, part 1 — reveal fallback (`src/components/motion/reveal.tsx`).** `useInView` keeps
the IntersectionObserver as §6.6's cheap fast path and adds a geometry pass through a
module-level shared watcher (`watchReveal`): one `scroll`/`resize` listener for the whole
page, one `requestAnimationFrame` per frame, a `Set` of pending predicates, and each
predicate detaches itself the moment it reveals. The test is rect-based, so it also fixes
the restored-position case — `watchReveal` runs one pass immediately on subscribe without
waiting for an event. Elements whose rect has already collapsed above the viewport
(`bottom <= 0`) or that were never laid out (`height <= 0`) count as revealed, so a
stranded node cannot be re-trapped by the fallback. `FadeUp`, `LineMaskReveal` and
`CountUp` inherit the correction; no caller changed.

**Fix, part 2 — provider guard (`src/components/motion/smooth-scroll-provider.tsx`).** The
mount guard now reads the media query synchronously (`prefersReducedMotion()`) instead of
trusting the hook, whose first client render must report `false` for SSR parity. Measured
proof it mattered: pre-fix, the reduced-motion landing showed `window.lenis` present with
**no** `lenis` class on `<html>` — an instance was constructed, wrote its global, and was
destroyed on the next render, which also means a live wheel handler for a few milliseconds
on a page whose visitor asked for no motion. Post-fix reduced motion: class false, global
false, version global false — no instance was ever built.

**Why this shape rather than (c).** Dropping IO for a scroll handler would have traded a
correct-on-jumps mechanism for §6.6's stated requirement and re-introduced layout reads on
every element. The watcher costs one listener, self-detaches when idle, and the cost claim
is measured rather than asserted: CDP `DOMDebugger.getEventListeners` counts the page's
`scroll` listeners **9 → 8** once the last reveal drains (`dropByOne: true`) — the watcher
really does leave.

**Consequences — the keeper gate (`_lh/harnesses4/t4-m3-scroll.mjs`), all green on the
fixed build** (`t4-m3-scroll.json`, playwright-chromium 156.0.8078.4, `:3100`):
`stranded === 0` at **all 36** positions of a 0→14 000 px sweep, after a jump straight to
the bottom (all five scrub proxies read `p = 1` there), on the `#benchmarks` deep link
(scrollY 6430, 23 blocks legitimately `hiddenBelow` — still below the fold, so not a trap),
and after reload (stranded 0). Scrubs are not just alive but _continuous_: the arch section
sampled over its 520 px travel window gives `[0, 0.065, 0.38, 0.695, 1]` — 5 distinct
values, 3 intermediate, non-decreasing. Two controls keep the census honest, because a
PASS that cannot fail is worthless: a hand-made `position: fixed` opacity-0 block **is**
counted (`strandedWithHidden: 1`) and clears when unhidden, and an `opacity: 0.4` block is
**not** (total stays 8). That second control exists because the v1 census regex
`/opacity:\s*0(\D|$)/` matched `0.4`, which had manufactured four "trapped" panels out of
`horizontal-showcase.tsx`'s inactive slides — a false product finding, corrected by parsing
the number. Non-regression: the mouse-wheel gate re-run on the fixed build
(`_lh/take3/m9/wheel-wheel-take4m3-fix.json`) is **15/15**, workspace routes still report
`lenis=false` on the scroller under the pointer, and the M2 hero re-measured on the same
build (17 glyphs, peak 17 on-screen mid-flight at mean displacement 344 px, control
injection 316 px, settled max 0 px, LCP 216 ms, CLS 0.0012, zero console errors) — kept as
`t4-m2-shipped.json`, with the M2-close run preserved separately rather than averaged,
since two builds are not two samples.

`/login` reading closed: at 1280×800 the document does not scroll at all
(`docScrollablePx: 0`, no inner scrollers) and "Sign in" sits at `[450,445,380,40]` inside
the viewport; at 375×667 the document overflows by **17 px** and a trusted wheel consumes
exactly that 17 px, with the button reachable and zero errors. So `lenisClass: true` on
`/login` is benign — it is a document-scrolling route, which is what the route gate keys on.
`track-impression.tsx` was left alone on purpose: it has its own IO, but it only emits
telemetry, so a skipped entry costs a count, not content.

**Risk.** One measured oddity is unfixed and non-blocking: the reload pass asked for
`scrollY 9128` and Chromium restored at **4249**, with `hiddenBelow: 23` at the restored
position. The browser is clamping or re-flowing during hydration; content is never stranded
(stranded 0), but the harness cannot claim scroll-restore fidelity, so it must not be quoted
as "restore works". The other risk is cost shape: the watcher adds a scroll listener per
page while any reveal is pending, which on a very long page with many unrevealed blocks is
one listener and one rect read per pending element per frame. That is bounded — the pending
set drains to empty and the listener detaches (9→8 above) — but it is a per-frame O(pending)
loop, so a future section with hundreds of `FadeUp` children should be batched, not added to.

**How to reverse.** Both fixes are additive and separable. `reveal.tsx`: delete
`watchReveal`/`pending`/`pump` and restore the original `useInView` body — IO-only reveals
come back with the jump trap. `smooth-scroll-provider.tsx`: drop `prefersReducedMotion()`
from the guard and the condition is the hook value alone. The harness itself is the thing
worth keeping either way, because its `stranded === 0` invariant is what found the defect;
the pre-fix run is retained as `t4-m3-scroll-1-prefix.json` (v1 columns, superseded) and the
probe as `t4-m3-ioskip.json`.

## M2 — the hero bake-off: keep "letters from every corner", delete the other two

**Context.** §3.1 required all three candidate entrances to be built as separate
components, measured, and reduced to one with the two losers deleted. §3.2 fixed the
weights at wow 40 / readability 30 / performance 20 / uniqueness 10. Candidates: **A**
per-glyph flight from the four corners on bezier paths with trails, spin, motion blur
and a landing shockwave; **B** canvas particles crystallising out of sampled text
pixels, then crossfading to real type; **C** per-glyph 3D flip-in from random axes plus
a settling wave.

**Options.** (a) score the three on the harness numbers as they came back; (b) discover
that two of them were not animating at all, fix that, re-measure, then score; (c) fix
and score only the likely winner.

**Chosen — (b).** The first bake-off run (`t4-m2-bakeoff-pre-inlinefix.json`) looked
clean: every variant reported a multi-second entrance, exact-name 1, doubled-name 0,
CLS 0.0012, zero console errors. It was also measuring nothing. The mid-flight stills
showed the headline already assembled at every requested time, so a second harness
(`t4-m2-frames.mjs`) sampled each glyph's `getBoundingClientRect()` centre through the
entrance and compared it to the settled centre. Variant A's glyphs moved **0 px** — mean
displacement 0 at every sample — while `getComputedStyle().transform` cheerfully reported
`matrix(1, 0, 0, 1, 200, 0)`. Cause: GSAP's `SplitText` emits plain `<span>`s, and a CSS
transform does not apply to a non-replaced inline box. The flight was writing transforms
the browser accepted and ignored; what the reader actually saw was a blur-and-fade.
Same defect in C (its rotations were no-ops too); B was unaffected because it draws
pixels into a canvas. Fix landed in the shared splitter (`src/lib/motion/char-split.ts`:
`display: inline-block` on each char, once, before any caller animates), the bake-off was
re-run from scratch, and the pre-fix file was kept under a different name rather than
deleted or averaged with the new numbers — two builds are not two samples.

**Measured, post-fix, one production build, 4× CPU throttle** (`t4-m2-bakeoff-decision.json`):

|               | entrance    | avg fps (min)  | LCP         | worst long frame | animated nodes | layer left behind              |
| ------------- | ----------- | -------------- | ----------- | ---------------- | -------------- | ------------------------------ |
| **A corners** | **1900 ms** | **12.6 (5.0)** | **1000 ms** | **893 ms**       | 17 glyphs      | none                           |
| B particles   | 2717 ms     | 7.4 (2.5)      | 1812 ms     | 1627 ms          | 2 lines        | `crystal` canvas still mounted |
| C flip-3D     | 3617 ms     | 10.8 (3.3)     | 1240 ms     | 1109 ms          | 22 glyphs      | none                           |

A won every measured column, and it is also the owner's literal ask (§0: "alphabets
joining from every corner"). The tie-breaker was legibility of the _journey_, not of the
end state: at 570 ms into A's entrance **17 of 17** glyphs were on screen and displaced by
a mean of 351 px from their final slots. C's motion is rotation about each glyph's own
centre, so its rect centres move ≤29 px — it reads as letters tilting into place at their
already-visible positions, and it takes 3.6 s to say so. B's crystallisation is genuinely
on-canvas and did look interesting in stills, but it pays for that with the worst frame
rate, the worst LCP, a 1.6 s long frame, and a full-viewport canvas that stayed mounted
after its own entrance finished.

**Consequences.** `variant-particles.tsx`, `variant-flip3d.tsx`, `variant-corners.tsx` and
the `?heroOpt=` switch are deleted; the surviving flight now lives in
`src/components/landing/hero/hero-display.tsx` with no indirection layer, and
`HeroDisplayProps` is declared there. `?heroOpt=B` still returns HTTP 200 and renders the
identical hero — the harness asserts that (`urlSwitch`: same `[data-t4-field]` marker
`trails`, no `crystal`, 23 spans in all three loads) so "deleted" is a measured claim, not
a file-listing claim. A also got one tuning pass after the fix: the start offsets came in
from 0.62 vw / 0.8 vh to 0.5 vw / 0.62 vh and the stagger from `i*0.03 + rand(0,0.08)` to
`i*0.02 + rand(0,0.05)`, because a 1020 px start left the first ~600 ms of the entrance
showing an empty hero — off-screen and under the opacity ramp. Measured after: peak
on-screen flight at 522 ms instead of 683 ms, entrance 1840 ms.

**Risk.** Two numbers in this entry are weaker than they look, and the run should say so
rather than let them be quoted as grades. **(1)** The absolute frame rates are not a
device verdict: this box renders WebGL in software, and A's own pre-entrance window —
fluid hero only, no text animation — measured 7.5 fps under the same 4× throttle. The
WebGL background, not the text choreography, sets the floor here, so the fps column is
only trustworthy as a _relative_ ranking of three runs taken on one build. §6.1's "≥50 fps
avg" cannot be confirmed or refuted from this machine; it stays an owner-side check on
real GPU. **(2)** The §3.2 weights were never turned into a single score, because wow
and uniqueness are judgement, not measurement, and dressing a judgement as arithmetic
would be exactly the fabricated number the brief forbids. What is reported is the
measured part (readability, performance) plus the qualitative part (stills in
`_lh/harnesses4/shots/`), and the deletion follows from A winning the measured part
outright.

**How to reverse.** `git checkout <pre-M2> -- src/components/landing/hero` restores the
four-file layout; the deleted components are unrecoverable from the working tree but
present in git history once committed, and the pre-fix harness JSON, the deciding harness
JSON and all twelve bake-off stills are retained in `_lh/harnesses4/`. The splitter fix
itself should _not_ be reverted with them — `display: inline-block` on split units is a
prerequisite for any per-character animation, and the layout-fidelity check confirms it
costs nothing: split vs unsplit headline rects are identical to the pixel
(`layout.h1Delta: [0,0,0,0]`, both line rects `[0,0,0,0]`).

## M1 — per-character splitting: GSAP SplitText, not a hand-rolled splitter

**Context.** §6.11 and §7.4 push "implement the math manually" and §2 bans new paid
libraries; the hero needs grapheme-correct per-character elements.

**Options.** (a) hand-rolled splitter using `Intl.Segmenter`; (b) GSAP `SplitText`, which
since 3.13 ships under the no-charge license and is already in `node_modules` at 3.15.0.

**Chosen.** (b), wrapped so the library never owns the accessibility tree
(`aria: 'none'`, `tag: 'span'`), with the sr-only twin and `aria-hidden` animated layer
supplied by `<SplitChars>` in the house pattern.

**Why.** The brief's objection is to _paying_ for a SplitText, not to the plugin existing,
and the part a hand-rolled splitter reliably gets wrong — emoji sequences, combining
marks, variation selectors — is the part `Intl.Segmenter` already handles correctly here.
Choosing (b) buys the correctness and costs nothing on the two constraints that actually
bind.

**Consequences.** Two obligations came with it, both now asserted rather than assumed:
the split units must be transformable (see M2), and the accessible name must be the
sentence once. That gate reads through the accessibility API
(`getByRole('heading', { level: 1, name: 'First Super AgentOS', exact: true })` → 1,
doubled form → 0) with a positive control that duplicates the twin's text and must be
detected (`controlDoubled: "injected"`), because a raw `textContent` check would have
reported the twin as a screen-reader defect.

**Risk.** `SplitText` rewrites DOM inside the heading on mount. If a future caller forgets
the disposer, tweens survive a route change; the component returns the disposer from
`onSplit` and runs it before reverting precisely so that mistake is structural, not
disciplinary.

**How to reverse.** Replace `splitChars()` with an `Intl.Segmenter` implementation of the
same `{ line, words, chars }` shape; every caller is already written against that shape.

## Owner rulings that bound M3–M5

**Context.** Three questions were put to the owner before implementation started.

**Chosen.** (1) Full M1–M7 run in this session. (2) **Keep workspace routes native** —
Lenis is mounted only on document-scrolling routes, so `/app`, `/dashboard`, `/agentos`
and `/admin` keep browser scrolling. (3) **Cards yes, buttons never** — the directional
border glow (§4.4) is licensed for capability/info cards and forbidden on Login, Signup
and CTA buttons.

**Why.** (2) protects a gate that already failed once in this project: the mouse-wheel
scroll check that took a whole milestone to close (15/15). A smooth-scroll library that
intercepts wheel events on a shell with an internal `overflow-y-auto` scroller is the
exact shape of that regression. (3) is the same risk on the visual side — V3 removed the
button border animation deliberately, and a directional glow on a button is that removal
reintroduced under a new name.

**Consequences.** Any M4/M5 component that wants Lenis scroll position must read it
through the existing scrub abstraction and degrade to native scroll where Lenis is off;
any M4 glow effect must be scoped by a prop or a class that cannot reach a `<Button>`.

**How to reverse.** Rulings (2) and (3) are one-line decisions at the mount point and at
the styled element; both were the owner's call, so both revert only on the owner's word.
