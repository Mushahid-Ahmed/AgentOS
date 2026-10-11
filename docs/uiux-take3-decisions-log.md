# UI/UX Take 3 — decisions log

Format required by V3 §9: **Q / Options considered / Chosen / Why / Risk / How to reverse**.

---

## T3-D1 — No new animation dependency

**Q.** §5.3 asks for "world-class, not basic" animation on Dashboard/Chat/AgentOS and mentions
"use Framer Motion or GSAP". The landing was built without Framer Motion; `gsap` + `lenis` are already
installed but used by only two files. Do I add a library?

**Options considered.**
1. Install `framer-motion` (or `motion`) and animate the app with it — closest to the brief's wording,
   but §8 says do not add dependencies unless justified, and §10 forbids "paid/template UI kits /
   unverified npm packages". A new runtime dep on a chat surface that re-renders per streamed token also
   means a new reconciler-driven cost on the hottest path (`use-chat.ts:286-288` replaces the whole
   messages array every token).
2. Animate with what already exists: the 16 `@keyframes` in `globals.css`, the existing primitives
   (`FadeUp`, `CountUp`, `LineMaskReveal`, `Tilt`, `Sheen`, `useScrub`, `Magnetic`, `Ripple`) and the
   unused `Skeleton`/`SkeletonLines` shimmer. Zero new bytes, zero new APIs to hallucinate.
3. Extend GSAP usage app-wide — already installed, but its value here is ScrollTrigger, and `useScrub`
   already does scroll-scrubbing with plain rAF.

**Chosen.** 2, with `gsap`/ScrollTrigger left exactly where it is.

**Why.** Smallest diff, zero cost, zero new bundle weight on a $0/localhost run, and every primitive I
need already ships and has already been measured. The brief's quality bar is about staggering, easing
and duration variety — all reachable with the existing tokens (`--ease-expo`, 120/220/420/1200 ms).

**Risk.** CSS-only entrance animations are less declarative than a library's `variants` prop, so the
stagger bookkeeping has to be written by hand per surface.

**How to reverse.** Nothing is installed, so reversal is per-file; each animated component can drop its
className/inline `animationDelay` and return to the current static render.

---

## T3-D2 — Brief/reality mismatches are met with styling, not new product features

**Q.** §5.3 specifies UI that does not exist: Dashboard "Tab/view transitions … between
Benchmark/Spend/Model-usage views" (there are **no tabs** — `dashboard-view.tsx` is one scroll stack,
only state is `selectedRunId` at :123) and AgentOS "Replay controls: play/pause/step buttons" (there
are **no such controls** — replay is a run picker in `<aside aria-label="Run replay">`
`run-view.tsx:586-677` that folds the whole event log instantly in a `useMemo` at :488-498).

**Options considered.**
1. Build the missing UI (tabs, a real step-through player). Delivers the literal words of §5.3, but
   adds product behaviour, touches data flow and replay semantics, and directly contradicts §1
   ("upgrade paint, not plumbing"), §8 (must-not-touch list) and the "Do NOT break any functionality"
   headline.
2. Style what exists and animate the *analogue* of each requested transition: the run-report swap
   (`selectedRunId` → report re-render) stands in for "tab transitions", and the replay selection swap
   stands in for "replay controls".
3. Silently claim the §5.3 bullets as done. Not on the table — §10 forbids fabricated claims.

**Chosen.** 2, and §5.3's two unimplementable bullets are reported as mismatches in the morning
report's honest-gaps section.

**Why.** The owner's actual complaint is "the inside feels like a different platform" — that is a
design-system and motion problem, not a missing-tabs problem. Inventing a player would be a feature
release wearing a CSS pass.

**Risk.** The owner reads §13's checkboxes as literal and wants a stepper. Reversal is cheap: a
step-through player is additive on top of the existing pure reducer (`reduceRunViewEvents`, already
event-list driven), and it is the natural follow-up if they ask.

**How to reverse.** No product logic was added or moved; deleting the transition wrappers restores the
current instant swap.

---

## T3-D3 — The cursor removal is one deletion, and it is measured twice

**Q.** §4 lists cursor removal and button border-animation removal as two jobs. Measurement says there
is only one system: the "border around the button" is the reticle's bracket (`tmp-t3-cursor-probe.mjs`,
11/11 PASS, 0.0 px lock error, while the button's own border/outline/shadow/animations never change).
Do I still go hunting for a second implementation to delete?

**Options considered.**
1. Delete only `cursor.tsx` + its two mount lines, and *prove* afterwards that no control shows a
   border effect.
2. Also strip the neighbouring pointer-follow primitives (`Sheen`, `ProximityText`, `Tilt`, `Magnetic`)
   in case the owner meant one of them — over-deletion; §4.1/§10 explicitly say keep everything else.
3. Rewrite every button hover to be "more basic" — contradicts §4.2 ("keep the standard hover state").

**Chosen.** 1. `Sheen`/`ProximityText`/`Magnetic` stay (they are not cursors and not borders), and the
after-check re-runs the same border assertions on a **different button variant** than the probe used,
because the probe's two landing selectors turned out to resolve to the same element.

**Why.** Keeps the diff at 2 files, matches §10's "never remove" list, and makes the claim verifiable
rather than argued.

**Risk.** If the owner's "border animation" meant the `.field-underline` accent line on auth inputs
(`globals.css:463-479`) or `arch-grid.tsx:69`'s card `hover:border-*`, those are *focus/hover states on
non-buttons* and §4.2 says to keep standard hover states. Handling: they are listed in §3.5 of
current-state and flagged in the morning report so the owner can name them if they want them gone too.

**How to reverse.** `git checkout -- .` is not available (nothing is committed); reversal is restoring
`cursor.tsx` and the 2 lines from `_lh/take3/baseline/untracked/` + `take2-tracked.diff`.

---

## T3-D4 — Before/after Lighthouse must be same-session comparisons, reported as ranges

**Q.** Take 2's final tree was reported at Performance 97 / TBT 71 ms. The identical bundle (`:3100`,
unchanged since) reads **75 / TBT 467 ms** on the first Take-3 pass. Whom do I believe?

**Options considered.**
1. Quote Take 2's stored numbers as the "before" column — cheap, and wrong: the box's load differs (the
   owner's dev server on `:3000` plus my own harnesses share CPU, and TBT is exactly the metric that
   moves with contention).
2. Re-measure before/after in the same session on the same bundle host and report each as a range over
   ≥3 passes.
3. Kill the owner's dev server to get a quiet box. No — it is their process, not mine to stop.

**Chosen.** 2, with pass 1 stored (`_lh/take3/lh/before-*`, `/` 75, `/login` 79, `/signup` 74) and
passes 2–3 queued.

**Why.** §1.3 forbids invented numbers and §6 demands honest reporting; a cross-session delta would be
an invented number in practice.

**Risk.** Costs three extra Lighthouse runs per surface. Accepted.

**How to reverse.** n/a — measurement only.

---

## T3-D5 — When the owner's session file didn't arrive, I minted the session myself (read-only login)

**Context.** The owner chose "You provide a session now" for the auth-gated before-captures, then the
run continued with no `_lh/take3/demo-cred.json` and no `_lh/take3/authcookie.txt` (checked at
11:12 — `_lh/take3/` held only `baseline/ job1/ lh/ phaseA/`). V3 §3/§6/§7 all require signed-in
evidence, so M1, M3, M4, M5 and the app half of M7 were blocked behind a manual step.

**Options considered.**
1. Stop and ask again. Rejected: the owner already answered this question once, and standing memory
   says automate blocking manual steps (login is the named example) rather than park the run.
2. Create a fresh account to log in with. Rejected: V3 §10 forbids creating accounts, and Supabase
   has confirm-email ON, so signup yields no session anyway.
3. Sign in through the real `/login` form with the throwaway demo account already provisioned for
   re-verification and recorded in project memory (`jev-swarm-status.md`, confirmed + provisioned,
   `User.id` = the Supabase uuid). Chosen.

**Chosen.** 3, executed so the secret never touches the transcript: a script read the password out of
the memory file and wrote `_lh/take3/demo-cred.json` (outside the repo, mode 0600), printing only
`emailLen 24 pwLen 18`. The harness reads that file, fills the form, and never logs values.

**Why.** It is the owner's own documented test identity, used read-only, on localhost, for exactly the
evidence they asked for — and it unblocks six captures with zero product risk.

**Constraint discovered and honoured.** Memory records a Take-1 incident: a harness that called
`supabase.auth.signOut()` revoked the session server-side and killed every browser context sharing
that token, requiring a human re-login. So `tmp-t3-shots.mjs` closes pages and contexts but never
signs out, and no harness in this run may sign the demo user out.

**Also fixed here.** The capture harness previously re-shot the anonymous routes on every invocation,
which would have overwritten Job 1's pre-removal before-bank with post-removal pixels. Added
`--only-app` (and a `manifest-<mode>-app.json` filename) so the two banks coexist, plus a
text-stops-changing settle wait so app captures show fetched data rather than a loading shell.

**How to reverse.** Delete `_lh/take3/demo-cred.json`; the app itself is untouched by this decision.

---

## T3-D6 — Fix hidden-table overflow structurally, not with a CSS pin

**Q.** `/dashboard` at 375 px had 246 px of horizontal overflow. The sole offender was the four
visually-hidden data tables that back the `aria-hidden` charts — 221–581 px wide while "hidden".
`table.sr-only { table-layout: fixed; max-width: 1px }` did not fix it (Chromium reports
`max-width: 1px` as computed and then lays the table out at 231 px anyway). Do I keep chasing CSS, or
change the markup?

**Options considered.**
1. Keep pinning the table with CSS (`max-width`, `table-layout: fixed`, then `contain: size`).
   Rejected: the first attempt measurably did not work, `contain` on a table box is not dependable
   across engines, and every variant would need its own browser proof.
2. `display: block` on the hidden table. Rejected: it kills the `table`/`row`/`cell` roles, which is
   the entire reason those tables exist — a screen reader would get a run of text instead of data.
3. Delete the tables and put `aria-label` summaries on the SVGs. Rejected: it downgrades real numbers
   to a paraphrase and breaks the project's documented chart a11y contract.
4. Move the clip onto a block box: wrap each table in `div.sr-only` (`HiddenDataTable` in
   `charts.tsx`) and drop the dead CSS rule. Chosen.

**Chosen.** 4. A `div` honours `width:1px; overflow:hidden; clip-path:inset(50%)`, so the table's
min-content width is clipped where it is generated and never reaches `<main>`'s scrollable overflow.

**Why.** It fixes the mechanism instead of fighting it, keeps the table semantics the accessibility
tree depends on, and removes a CSS rule that was only ever compensating for the wrong markup.

**Risk.** Low. The tables are out of flow either way; the only consumer is the AX tree.

**How to reverse.** Delete the wrapper and restore `className="sr-only"` on each `<table>` — and the
overflow returns, which `tmp-t3-m3-verify.mjs`'s 12-sample mobile check will report.

**Same root cause, second fix.** A `Card` is a grid/flex item, and `min-width:auto` let a
`min-w-[640px]` data table push its track past the viewport. `Card` now carries `min-w-0`. This one is
a one-word change but it is global, so it is recorded here: it affects every surface that composes
`Card`, and it can only ever make a card narrower, never wider.

**Verification note (why the check changed shape).** The overflow was intermittent across harnesses —
one browser said 375/375, another said 792 — because a single reading samples one layout phase. The
mobile run now samples continuously and requires zero at every sample, so a future regression cannot
hide behind favourable timing.

---

## T3-D7 — Streaming is verified against a client-side SSE mock, never a paid call

**Q.** M4's contract is "chat streaming preserved", and the new motion is mostly about the in-flight
state: dots while Jev decides, tokens arriving, **Stop** mid-stream, the five telemetry chips. The
owner's standing answer to spending money this run is "**No — keep the $0 rule**", and V3 says never
make a paid model API call. So how do I test the stream at all?

**Options considered.**
1. Send real chat messages and watch them stream. Rejected: every message is a paid provider call, the
   tokens differ per run so nothing is reproducible, and **Stop** would burn a partial generation for
   the privilege.
2. Add a fake provider or a dev-only SSE endpoint inside the app. Rejected: `app/api/**` is on V3 §8's
   must-not-touch list, and a mock branch in product code is a fake feature — it would need its own
   guard against shipping.
3. Intercept `fetch` in the browser and synthesise the SSE byte stream, leaving the app's own parse →
   reducer → render pipeline completely real. Chosen.

**Chosen.** 3. `tmp-t3-m4-verify.mjs` patches `window.fetch` for the synthetic context only, and hand-
rolls the exact wire format (`event: <type>\ndata: <json>\n\n`, ordered `conversation → route → token*
→ done`) with timed pulls on a `ReadableStream`. Every byte is produced and consumed inside the
browser; the network never sees a request.

**Why.** The thing under test is the app's reaction to frames, not the provider. Intercepting one
layer below the code under test keeps the stream parser, the React state machine, the abort path and
both mount paths real, at zero cost and with fixed timing.

**Risk.** A mock can be wrong about the real contract — if frame order or field names drift, this
suite stays green while production breaks. Two things bound that risk: the *same* suite verifies a
**real persisted thread** against `/api/conversations/<id>` and requires the DOM chips to equal the
stored payload (3/3 numbers matched, e.g. `622 ms`, `10891 ms`, `60` tokens), so schema regressions
surface there; and the mock's model label is the unmistakable
`SYNTHETIC MOCK FRAME (no paid call)`, so mock pixels can never be mistaken for product evidence.

**Also in force: the mock emulates abort.** The first version returned a `Response` that ignored
`init.signal`, which silently changed what the test proved — `AbortController.abort()` in a real fetch
errors the body reader with `AbortError`, and that rejection is precisely what drives the app's
"Stopped before completing." branch. Ignoring the signal meant the turn simply *finished*, so the
assertion could only have passed by luck. Now `start()` attaches an abort listener that calls
`controller.error(new DOMException(…'AbortError'))`, and the check additionally requires the mock to
have observed ≥1 abort.

**How to reverse.** Delete the synthetic context from the harness. Nothing in `repo/` knows the mock
exists.

**Verification note (why the animation window stopped being fixed).** The bubble / trace / chip
entrances were initially read as missing (`peak 0` with correct computed styles). A 40 ms-grid probe
of `document.getAnimations()` showed the real cause: loading a persisted thread takes **~2.5–3 s**
(the conversation-detail read against remote Supabase), so a "sample for 2.6 s after the click" window
ended ~200 ms *before* the bubbles mounted. The harness now samples adaptively in 700 ms slices until
it has caught all three names twice after the data settles. Two consequences worth keeping: an entry
animation must be sampled **concurrently with** the mount window, never after it; and the 3 s wait
currently shows only a dim `bg-bg/60` skeleton overlay — a real UX observation for M7, which V3's
"do not touch data fetches" rule means I log rather than optimise.

---

## T3-D8 — A live figure ticks; it does not count up

**Q.** The run view's header counters (cost, elapsed, models, tools) change value repeatedly during a
run, and the D6 panels fill in as frames arrive. The repo already ships `CountUp`, and Take 3's brief
asks for "world class animation, not basic animation". Do I animate the numbers with `CountUp` and the
panels with the existing `.panel-in`?

**Options considered.**
1. `CountUp` on every counter. Rejected: it restarts from 0 whenever the value changes, so a live run's
   cost would read `$0 → $0.0659` on *every* `cost_update` frame. That is not "the number grew", it is
   "the number is broken", and it is actively misleading during a run whose whole point is honest
   telemetry.
2. Reuse `.panel-in` for rows appearing inside an already-mounted panel. Rejected: `.panel-in` is a
   700 ms section entrance keyed on `--i`; a single roster row is neither a section nor a new panel, and
   reusing it makes one row announce itself like a page.
3. Chosen: a small, cue-per-event vocabulary in `globals.css`, each keyed to *what changed* —
   `.tick-in` (260 ms, translateY −7 px) on a value that changed, `.row-in` (420 ms, `--i × 40 ms`) on a
   row appearing inside a mounted panel, `.dot-live` (1700 ms infinite grow-and-fade) on an executing
   agent, `.report-in` (620 ms `clip-path` unroll) on the final answer.

**Chosen.** 3. `.tick-in` is applied by *keying the span on the value* (`<span key={String(value)}>`),
so React remounts it and the CSS entrance replays — an odometer tick, no JS animation loop, no
per-frame state.

**Why.** Each gesture maps to one product event, so motion carries information instead of decorating:
a row arriving, a figure growing, an agent being alive, an answer completing. `clip-path` (not `height`)
for the report unroll so nothing reflows and the panel never jumps — a layout-shifting entrance on the
largest element in the view would be the one thing that could make this surface feel unstable.

**Risk.** Keyed remounts discard the node's state; safe here because these spans hold nothing.

**How to reverse.** Drop the `key` on `Tick` and the four class names; the figures still update, just
silently.

**Consequence for the reduced-motion contract.** `.dot-live` must start *and end* at opacity 1: the
global guard settles an infinite loop on its final frame, so a loop that began at 0 would leave a
"running" agent invisible to reduced-motion users. That is why `live-ping` is `0%,100% { opacity: 1 }`
with the dip at 50 %, and why the suite asserts the CSS rule itself, not just a computed duration.

---

## T3-D9 — The AgentOS live-run mock is the product's own stored frames

**Q.** D7 established a client-side SSE mock for chat. AgentOS needs the same proof (progressive panel
fill, ticks, the live dot, Cancel) but its wire contract is 17 event names with interdependent payloads
— hand-writing frames risks asserting against an invention.

**Chosen.** Intercept `POST /api/agentos` in the browser and answer it with the **stored event log of a
real run** (`GET /api/agentos/runs/<id>` → the same `{name, data}` frames the server emitted), dripped at
140 ms per frame, with the abort emulation D7 requires. Nothing about the payload is authored here.

**Why.** The app's real parser, reducer and mount paths do all the work, and the frame sequence is
evidence rather than a guess. It also creates a second, stronger control: the live-folded view and the
stored replay of the *same* run must end up identical (they do — evidence 16/16/0/0/0/0, cost `$0.0659`,
4/4 figures), which is the §13 "replay must not lie" test and is only possible because both paths consume
the same bytes.

**Risk.** The store only contains runs the product has actually executed, so an event name that never
occurred in the sampled run is unexercised. Bounded by the suite's own event tally (15 distinct names in
the 66-frame run) and by the default-branch reducer tests; recorded as a limitation rather than a claim.

**Also decided: Cancel gates the client's stream, not the server's run.** The "Synthesizing…" dots are
driven by `isStreaming` (the browser's reader), not only by the folded phase, because Cancel aborts this
tab while the run keeps executing server-side — dots that never stopped would claim a connection that is
already closed. **Logged for the owner, not patched:** for the same reason the header badge can still
read `RUNNING` after Cancel. That is accurate (the run *is* running) but reads as the button doing
nothing, and fixing it would mean touching run lifecycle logic, which V3 §8 forbids.

**How to reverse.** Delete the synthetic context; the stored-replay contexts are unaffected.

**Dev-mode note (cost me a false FAIL twice).** The first request to a cold route pays Turbopack's
compile cost, which is seconds: a mobile pass that looked like a 375-specific bug was the cold
`/api/agentos/runs/<id>` route, and a one-off HTTP 500 appeared only on the run that started while the
server was recompiling my own edit (not reproducible in 3 dedicated passes). Waits must therefore target
*data* (shimmer retired, sr-only status gone), never an attribute the click itself sets.

---

## T3-D10 — A visible wide table scrolls in its own box; a hidden one is clipped

**Q.** `/agentos` at 375 px had **185 px** of `main` overflow with run #81 replayed. The offender was a
GFM table inside the answer (`table` at 388 px, no clipping ancestor). Same root cause as T3-D6 — a
table's min-content width is the sum of its columns — but this table is *visible data the user is meant
to read*, so the D6 remedy (clip it in a 1 px box) would hide it.

**Options considered.**
1. `[&_table]:block` / `display:block` on the table. Rejected for the same reason as D6: it destroys the
   table/row/cell roles.
2. Compress the answer's type or force `table-layout: fixed`. Rejected: it squashes the model's own
   content to fit a layout, and long cells would still overflow their column.
3. Chosen: give the table a scroll container of its own — the standard pattern, and the only one that
   keeps every column readable at its natural width.

**Chosen.** 3, in the shared `Markdown` renderer so chat and the run view are fixed by the same change:
`<div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table"><table>…`
`</table></div>`.

**Why `tabIndex`.** The scroller takes over from page-level scrolling for the wide case. Without focus,
keyboard users lose access to the clipped columns entirely — WCAG 2.1.1, and a regression I would have
introduced while fixing a layout bug.

**The trap, recorded because it is easy to repeat.** Overriding `table` in react-markdown **replaces**
the element; it does not wrap it. The first attempt, `<div>{children}</div>`, therefore emitted
`<div><thead>…` — a hydration error (`In HTML, <thead> cannot be a child of <div>`) plus silently
descoped `[&_table]` styling. The suite's console-clean check caught it on the same run, which is the
argument for keeping that check as a gate rather than a nicety.

**Same family, second fix in this milestone.** A run *error* string containing one long token widened
`main` by 7 px at 375 even though the span had `break-words`: a flex item's default `min-width` is its
min-content, and `overflow-wrap: break-word` does not reduce intrinsic size. `min-w-0` fixes it. Applied
to the transport-error span as well, which the replay path cannot reach — so the suite could not have
found it, and the class is the test.

**Verification consequence (why the overflow check changed shape again).** The first table-aware
selection matched any line containing `|`, so it "passed" on run #35, whose table fits at 375 — the
check would have stayed green through the bug. It now requires a GFM delimiter row, samples every
table-bearing stored run, and asserts that at least one table is **wider than its box** and that each
scroller is wrapped *and* focusable. The measured proof is `[["35",1,0],["81",3,71]]` with `main`
overflow 0 at all 36 samples.

**How to reverse.** Remove the `table` override (overflow returns at 375 and the mobile check reports
it); remove `min-w-0` (the error-branch overflow returns for single-token failures).

---

## T3-D11 — A page whose whole job is to 404 must still pass a console-clean gate

**Q.** M6's suite navigates four contexts to URLs that are *supposed* to return 404 (an unmatched path,
the `/admin` layout with no page, and the reduced-motion / 375 repeats). Chrome prints one
`Failed to load resource: … 404 (Not Found)` console error per such document, so the standing
"zero console errors" gate failed a milestone whose subject **is** the 404 page. V3 §6 requires the
console-clean check; §11 forbids weakening a check to make it pass.

**Options considered.**
1. Skip the console listener for the 404 contexts. Rejected: those are exactly the contexts where a
   broken shell would show up, and it makes the gate's coverage depend on which page I am looking at.
2. Filter any message matching `/Failed to load resource/` out, globally. Rejected: that is the whole
   class of missing-asset errors — a stylesheet or font that 404s because of my own edit would have been
   silenced on every surface, including the three product views.
3. Serve the 404s from a context with no listener and probe them elsewhere. Rejected: the probe needs
   the same document the listener is attached to.
4. Chosen: keep the gate, and bound the exemption with *network* evidence instead of message text.

**Chosen.** 4. A notice is set aside only if that same context received a **document** response with
status 404, at most **one** notice per such response, and only inside the `Failed to load resource`
family — a `pageerror` can never qualify. Two new assertions then hold the exemption to size: every
non-document request across all eight contexts must have returned `<400`, and
`notices === doc404 === 4` with no unused budget. The exemption list itself is written to
`verify.json` (label, message, console location, the 404 document URLs) so a reader can audit each
waiver rather than trust the count.

**Why.** The failure mode I am protecting against is not "a 404 appears", it is "a 404 appears and stops
being interesting". Pairing each waiver to a real 404 *document* response keeps the two cases apart: if
the shell's CSS went missing, that sub-resource failure trips the first guard even though the notice
looks identical, and a second notice on the same label has no budget left to spend. The run recorded
`locationsMatch=4/4`, so the console location genuinely is the failing document URL — the strictest of
the pairing paths, not the fallback.

**Risk.** The count-based half of the pairing is per-context, so a label that navigates to *two* 404
documents could in principle absorb a coincident asset 404. Not reachable in this suite (each 404
context navigates once after sign-in), and the non-document guard covers it anyway; recorded rather
than engineered around.

**How to reverse.** Delete the classifier and push straight into `consoleErrors` — the gate returns to
`29/32` with four expected 404 notices, which is the state that started this.

**Also decided: drop the class rather than fight the cascade.** The 404 numeral was written
`display-huge font-numeric` to get tabular mono digits; the computed family came back **Inter**. Both
classes set `font-family` at equal specificity, so stylesheet order decided it and the mono class was
already dead weight on screen. The options were `!important`, reordering the sheet for one screen, or
removing the class — I removed it, and the component comment now records the measured cause so nobody
re-adds it as a "fix". The check asserts the display voice (144 px / 48 px, weight 800,
`aria-hidden="true"`), which is the promise the design system actually makes.

**Two measurement traps in the same milestone, both cheap to repeat.** (a) A signed-in visit to
`/login` is redirected to `/app` by `route-gate`, so the "the shell does not leak" control would have
quietly measured the chat workspace and passed for the wrong reason — the control is now anonymous and
asserts `url=/login` *before* it asserts anything about the shell. (b) `/analytics-demo` is built on a
`min-h-dvh` wrapper, so `<main>` is as tall as its content and only the document scrolls; the
"scroll `<main>`" rule the three product views need produced two identical screenshots. The capture
helper now picks whichever scroller can move and reports which one it used.

## T3-D12 — A signed-in Lighthouse row proves its own page identity, and a canary proves the proof can fail

**Q.** V3 §6 wants real Lighthouse numbers on six routes, three of them behind auth. The `lighthouse` CLI
can only carry a session in `--extra-headers`, and the minted Supabase cookie rotates and dies inside
about an hour. An expired cookie does **not** fail: `route-gate` bounces `/dashboard` to `/login`,
Lighthouse measures the login form and prints a confident score under the filename
`dashboard.report.json`. The rows that matter most to the brief are the ones easiest to fabricate by
accident, so the table needed a page-identity proof, not a promise.

**Options considered.**
1. Trust the mint script's replay self-check. Rejected **on measurement, not on principle**: the same
   cookie authenticated all three app routes through `--extra-headers` (`doc /dashboard/200`) while the
   mint's own per-request-header replay printed `HTTP 200 h1="Welcome back"
   url=http://localhost:3100/login?next=%2Fdashboard`. The two paths disagree, so neither log line is
   evidence of anything.
2. Read the `<title>` out of the report. Rejected: Lighthouse **13.5** keeps the title nowhere in the
   JSON — there is no `page-title` audit, and `document-title` lists only failing nodes.
3. Gate on `finalDisplayedUrl` alone. Rejected as insufficient rather than wrong: it is one field of one
   version, and it says nothing about the document that was actually fetched.
4. Chosen: identity from the **Document network entry**, plus a deliberate falsification canary.

**Chosen.** 4. Each report is read for `audits['network-requests'].details.items` → the item with
`resourceType === 'Document'`, and its pathname + status are compared with the route its **filename**
claims. One shared predicate (`routeDocOk`) is used by the signed-in gate, by the all-scored-reports gate
and by the canary, so the canary cannot be testing a different expression from the one protecting the
run. Signed-in passes must all be `own route/200`; anonymous passes must **not** have been bounced.
The canary is `NO_AUTH=1 bash t3-lh.sh canaryA- 3100 dashboard` — an app route measured on purpose
without the cookie. It must bounce, and it must be caught.

**Why.** The run now carries **21** app-route reports, every one reading
`req /dashboard doc /dashboard/200 fin /dashboard` (and the same shape for `/app`, `/agentos`), and the
canary row reads `doc /login/200 fin /login perf 87` — a plausible-looking number on the wrong page,
flagged by the same code that clears the real 21. Without the canary, "PASS: identity" would be an
untested assertion; with it, the gate has been shown to fire.

**Risk.** The gate proves *path + status*, not *content*: a maintenance interstitial served at
`/dashboard` with 200 would sail through. Mitigated by the app pages' own settle predicates in the M7
browser suite (skeleton gone, page-specific text present), which look at content rather than at URLs.

**How to reverse.** Delete the three doc gates and read only `perf`: the suite goes back to being one
expired cookie away from reporting `/login` three times as the product.

## T3-D13 — An unfixed build and a fixed build are two builds, not two samples

**Q.** `/dashboard` scored accessibility **98** on every after-pass, with one failing audit —
`heading-order` on `<h3 class="title-editorial">Live Jev latency</h3>`, because the page went
`<h1>` (AppHeader) straight into `<h3>` (the shared `CardTitle`) with no `<h2>` in between. The fix is
one tag: the masthead statement `Every number here is measured.` becomes an `<h2>`
(`src/components/dashboard/dashboard-view.tsx:194`, and the same shape on
`src/app/[locale]/analytics-demo/page.tsx:25`, whose cards are also `<h3>`). Then: I already had three
after-passes (afterA/B/C) measured on the pre-fix build. Re-measuring the fixed build as afterD/E/F
leaves six "after" reports per route — and blending them would put a known-defective build into the
same median as the delivered one.

**Options considered.**
1. Delete afterA/B/C. Rejected: they are the evidence that found the defect, and §13 forbids claims I
   cannot show the artefacts for.
2. Keep them in the median and report the a11y 98 in prose. Rejected: the median is the number the
   morning table quotes, so the defect would be averaged away and the table would silently describe a
   build that no longer exists.
3. Chosen: keep the files, print them, exclude them from the after-side statistics and gates.

**Chosen.** 3. The scorer keeps a named map of superseded passes — `afterA/B/C` ("pre heading-order
fix") and, after the M7 perf/a11y pass rebuilt the bundle again, `afterD/E/F` ("pre M7 perf/a11y fixes") —
prints them in their own block with the reason, and computes after medians and after gates only from the
delivered build's passes. Every superseded report is still named, still listed, still auditable.

**Why.** "Before and after" in this brief means *two builds of the product*, and a milestone that fixes
a defect redefines "after". A reader who wants the pre-fix number can see it in the superseded block; a
reader who wants the delivered product's number gets a median of three passes of exactly what is on
disk now. Mixing them would be the Lighthouse equivalent of averaging a broken and a fixed run.

**Risk.** The label is a filename convention, so a future pass named `afterZ-` measured on an
intentionally different build would be counted as delivered unless the regex changes. That is a
deliberate trade: the convention is visible in one line at the top of the scorer, and the alternative —
hashing the build ID into each report — would have needed a build I no longer have.

**Also found in the same pass: the gate was wrong about its own population.** The signed-in identity
gate included the canary row, so it FAILed on the artifact built specifically to demonstrate that it
can fail. Excluding canary passes from `signedIn` (while keeping them in `routeDocOk`) is what makes the
two gates mean different things: one asserts the data, the other asserts the detector.

## T3-D14 — An entrance that starts at `opacity: 0` donates its LCP to something smaller

**Q.** After the app-surface pass, `/dashboard`'s real-time cold LCP was **2800 ms / 2820 ms** on two
fresh loads, and the winning element was not the masthead: it was a 6 541 px² `p.text-text-muted mt-3
text-xs` reading "27 priced from the curated NanoGPT table" (`_lh/take3/m7/diag.txt` §C). The page's
largest text node, `h2.app-masthead` at 49 455 px², paints earlier and is bigger, so why did the
observation hand the metric to a caption three viewport-heights down? Every entrance in the design
system starts from a `from { opacity: 0 }` keyframe with `animation-fill-mode: both`, and Chromium does
not consider an element painted while fully transparent to be an LCP candidate — so the biggest,
earliest element disqualified itself, and LCP fell through to the first thing that was ever fully
opaque, which on a data page is a late, data-derived caption. §6's budget is LCP < 2.5 s, so this was
also a hard FAIL in the M7 suite, not a cosmetic one.

**Options considered.**
1. Leave it and report the number. Rejected: the budget is the brief's, and the regression was introduced
   by Take 3's own animations.
2. Take the masthead out of the entrance stagger. Rejected: it is the strongest §7 cue on the page, and
   it would mean fixing the metric by removing the thing being measured.
3. Delay the observation window / add `fetchpriority`. Rejected: irrelevant — the cost was never a
   network one (`load 0`, `render` = the full timestamp).
4. Chosen: make the first painted frame of every entrance *visible-but-faint* — `panel-rise-in`,
   `bubble-slide-in` and `run-row-in` now start at `opacity: .2` instead of `0`, so the animated element
   stays a valid candidate from frame one while the perceived motion (fade + rise) is unchanged.

**Chosen.** 4. The M7 suite then measured `/dashboard` at **LCP 1084 ms**, and — the part that matters —
on `h2.app-masthead`, area 49 455 (`_lh/take3/m7/run3.txt`, `verify.json`). The gate prints the winning
element's selector, area and text precisely so this swap is checkable: a passing LCP number attached to a
caption would still be a defect.

**Why.** A performance budget that a design system silently breaks is a design-system bug, so the fix
belongs in the keyframes (one shared cause, one shared fix) rather than in per-page exceptions. Recording
the element and not only the ms is what stops "LCP improved" from meaning "a different element was
measured".

**Risk.** `.2` is a judgement call: any value above 0 restores candidacy, and a much higher one would
flatten the entrance. If a future entrance uses `visibility: hidden` or `opacity: 0` on a large
above-the-fold node, the same 1.7 s hole comes back — the gate catches it because it asserts the element,
not the number.

**The same cause, deliberately left in one place.** On `/login` and `/signup` the M7 measurement still
hands LCP to the 1 909 / 1 817 px² `AgentOS` wordmark rather than the card's `<h1>`, because
`auth-stage-in` / `auth-rise-in` begin at `opacity: 0` (744 ms and 600 ms — both far inside the 2.5 s
budget). Unlike the dashboard case, the cost there is not a broken budget but a design intent: the auth
card is meant to materialise out of the dark, and starting it at `.2` would visibly flatten that. So it is
reported here as a known, measured quirk of the metric rather than quietly "fixed" to make an element
selector look better.

## T3-D15 — Frame pacing on a software rasteriser is a painted-area problem, not a property problem

**Q.** `/login` and `/signup` scrolled at **p50 116.6 / 116.7 ms** (~8.5 fps) in the M7 suite while their
main thread was doing **0.36 ms per frame** (script + layout + style, `_lh/take3/m7/diag7.txt`). Nothing
in JavaScript was slow, so a `p95 < 60 ms` gate would have been reporting this box rather than the
product. The two `.auth-aurora` pseudo-elements inherited `inset: -18%`-sized boxes of **1939 × 1205 px**
each and animated `scale()` + translate forever with `will-change: transform`; sampling the shipped
gradients showed roughly two-thirds of those pixels are transparent, i.e. SwiftShader re-rasterised
~2.3 M px of radial gradient per lobe per frame to paint a glow that occupies a fraction of that.

**Options considered.**
1. Gate the auth routes on p95 and log the FAIL as environmental. Rejected: §11 forbids weakening a
   check to make it pass, but it equally forbids keeping a check that measures the emulator.
2. Remove the aurora from the auth surfaces. Rejected outright: §10's never-list protects the auth
   animations, and that glow is what makes `/login` read as the same product as the landing.
3. Stop scaling / use `translate3d` only. Measured, and it changed nothing: **p50 100 ms** (diag5) —
   the property was not the cost.
4. Chosen: clip each lobe to the ellipse its own gradient paints (`53 % × 59 %` and `49 % × 57.6 %` of
   the container, positioned where the visible glow already was) and leave the keyframes, colours and
   durations untouched.

**Chosen.** 4. Fresh load per rep × 3, medians (`diag5.txt`, `diag6.txt`): `/login` p50 **116.6 → 50.0
ms**, p95 **133.4 → 66.8 ms**, frames sampled **14 → 27**; `/signup` p50 **116.7 → 50.1 ms**, p95
**133.4 → 66.7 ms**. Pausing both loops entirely reaches p50 **16.7 ms**, so what remains is other paint
on this rasteriser, not the aurora's 2.3 M px of dead margin. The visual surface is unchanged: same
centre, same falloff, same 26 s / 34 s breathing.

**Confirmed inside the delivered suite, not just in the diagnostic.** The same hardening harness ran
three times across this change (`_lh/take3/m7/run{3,4,5}.txt`): `/login` p50 **99.9 → 33.4 → 16.7 ms**,
`/signup` **100 → 33.4 → 16.7 ms**. The first step is the lobe clip; the second is this box getting
quieter between two runs of the *same shipped CSS* — the load caveat below, arriving on its own.

**Why.** Compositing cost is proportional to the pixels a layer can dirty, so when the main thread is
already near zero the only lever left is the box. That reframing is what turned an apparent "unfixable
emulator artifact" into a one-property change on two surfaces.

**What this does not fix (and what the box, not the product, owns).** The landing's hero is WebGL2, and
headless Chrome here has no GPU process, so its draw calls are synchronous CPU work that shows up in
`ScriptDuration`: `_lh/take3/m7/diag7.txt` measured 10.97–12.55 ms/frame of script with the canvas
painting versus **2.77 ms/frame** with `canvas { display: none }` (p50 83.3 → 33.4 ms). §10 protects that
hero, so the suite attributes it instead of excusing it — the decomposition pass in
`tmp-t3-m7-verify.mjs` measures the same page both ways in two fresh contexts. But the same build measured
**3.3 ms/frame and p50 16.7 ms** on the landing in run4's route loop with the canvas fully painting, and
`tasklist` at that moment showed 35 chrome + 25 msedge + brave + VS Code processes competing. Absolute
frame numbers on this box are therefore load-dependent, which is why the gate is the main-thread budget
(the product's own cost) and why the real-GPU frame rate stays with the owner as the same open item Take 2
left. What is *not* load-dependent is the attribution: hiding the canvas never made the page slower, and
never raised its main thread.

**Methodological note, because it produced a false result first.** The initial A/B sampled four variants
sequentially on one page load and "measured" 116.7 → 16.7 ms for a change that did nothing: later samples
on a warm, already-scrolled page are systematically faster. Every pacing number above comes from a fresh
context and a fresh `goto` per rep, reported as a median of three, and the harness keeps that rule for the
decomposition pass.

**How the gates were re-specified as a result.** One blanket "p95 < 60 ms everywhere" became four checks
that each attribute a cost to something: main thread < 8 ms/frame for every non-landing route; p95 < 60 ms
for exactly the three §6 app pages; a computed-geometry guard that each auth lobe stays ≤ 0.35 of its
container's area (so the dead margin cannot silently come back); and the landing's canvas-hidden
decomposition plus its control.


---

## T3-D16 — "Renders real data" compares against the bytes the page itself requested

**Question.** §7 asks the dashboard to "render real data", and §13 forbids a fabricated number anywhere.
An adjective is not evidence: the gate has to name the payload each figure came from.

**First draft, and why it was wrong.** `C2` fetched `GET /api/dashboard` inside the page and looked for
the painted figures in it. That response is **3,441 B**, and the dashboard actually pulls **192,605 B from
seven endpoints** (`model-pool`, `spend`, `benchmark/runs`, `benchmark/runs/4`, `agentos-benchmark/runs`,
`agentos-benchmark/runs/6`, `dashboard`). Measured against that one file: 60 of 163 painted numbers
matched, and the discrimination control was meaningless — 42 of those 60 stayed "matched" after their last
digit moved, because a 2–3 digit number is a substring of almost anything in a payload that size.

**Decision.** Keep the response bodies the page itself requested (deduped by path, first body wins), and
compare against their union. Then add the one formatting rule the product actually documents: the Spend,
Model-usage and dashboard panels print money as `microUsd / 1_000_000` with six decimals
(`spend-panel.tsx:32`, `model-usage-panel.tsx:30`, `dashboard-view.tsx:44`), so `$1.028017` *is* the stored
integer `1028017`. Accepting that conversion — and no other — took the explained rate from 76 % to
**86.5 % (307 of 355 painted ≥2-digit figures)**.

**How the control became honest.** Instead of asserting that substring matching is specific, measure the
haystack's density and gate on the subset where it is provably sparse:

- 263 matched figures carry no ≥5-digit exact key, and **169 of them (64.3 %) still "match" after their
  last digit moves** — "1094" is some other row's real latency. They are reported, never gated on.
- 12 painted figures have a ≥6-digit key that occurs **exactly once** in 192,605 B. Perturb the last digit:
  **0 of 12 still match.** Draw 12 seeded random numbers of the same lengths: **0 of 12 appear.**
- Widening to ≥5 digits: 31 candidates, 0 scramble hits, but **1 random control hits** (`925924`) — the
  measured point where this haystack stops being sparse, which is exactly why the gate sits at 6 digits.

**Result.** `C2` + `C2b` pass on numbers a reader can re-derive from the payload, and the control is a
coincidence measurement rather than an assumption. `C6` remains the per-figure provenance test (the run
header's cost re-folded from that run's own stored `cost_update` events), so the suite has both an
aggregate and an exact claim.

## T3-D17 — Measure the settled page, not the first paint

**Symptom.** M8's flow suite failed two gates that looked like product defects:

- `A4`: the FAQ accordion "did not return to its closed height" — 79 px baseline, 80 px after closing.
- `C9`: the same statistics panel measured **194 chars after a client-side navigation** but **180 chars
  after a full document load**, which reads as two different renderings of one view.

**Cause, in both cases: the harness.** The disclosure is *transitioned* — `globals.css:366` animates
`::details-content` `block-size` over `--motion-slow` (420 ms) with `content-visibility` on the same clock
and `allow-discrete`. The gate sampled at 400 ms, i.e. 20 ms before the collapse finished. The dashboard
read fired as soon as the text crossed 30,000 chars, which is after the stats endpoint but before `spend`
and the two run details — so three of seven payloads were missing from the haystack, the money panels had
no figures to paint yet, and the 180-char panel was a *still-loading* panel.

**Decision.** Never sample a page at a fixed delay when it can be sampled at quiescence:

- `A4` now takes a height sample every 50 ms and waits for **five consecutive identical readings** per
  phase. The samples are kept, because the intermediate heights are the animation evidence:
  `79.09 → 110.91 → 183.59 → 198.53 → 209.95 → 213.81 → 217.75 → 218.25 → 219`, back to exactly 79.
- `C2` now waits for zero skeletons **and** a payload-body set that has not grown for 2 s (bodies dedupe by
  path, so periodic refetches cannot prevent settling).

**Both gates got stricter, not looser** (§11). `A4` gained `intermediates >= 3`, which a snap-open
accordion fails, and keeps `h2 === h0` at exact pixel equality. `C9` gained a cross-check it did not have:
the client-side panel must be byte-identical in length to the document-load panel, and it is (194 = 194,
0 skeletons, `window` marker survived so the transition was client-side). The failing runs are kept
(`_lh/take3/m8/flow.log` … `flow4.log`) beside the passing one (`final-m8-flow.log`, 31/31).

---

## T3-D18 — Close-out freezes the artifact instead of rebuilding it, and keeps a cited number's reproducer

**Q.** M8 certifies one build: 67 M7 gates, the re-run 28 + 26 + 33 + 34, 31 flow gates, 27 screenshots and
ten Lighthouse passes all name `.next/BUILD_ID` `Z3i65uFaSjJJG6sfm6nnC`. At close-out two habits are
available — re-run `pnpm build` "to prove the tree still builds", and delete the scratch diagnostics — and
both act on the evidence rather than on the product.

**Options considered.** (a) Rebuild, then re-verify the whole ladder on the new artifact: the strongest
build claim, and the only way to prove `src/` didn't drift — but it takes hours, re-points every recorded
number at a build that no longer exists, and would force a second screenshot session over the same files.
(b) Rebuild and report both, which is (a) with two provenances in one doc. (c) Don't rebuild; prove the tree
did not move, and run only the gates that cannot touch `.next`.

**Chosen.** (c), with the proof attached: `find src -newermt "2026-10-09 19:42"` returns **0 files**, so
the artifact at close-out is byte-for-byte the one the suites tested, and `pnpm typecheck` · `check:tokens`
· `check:secrets` · `npx eslint` (43 files, exit 0) were re-run because none of them writes `.next`. The
teardown rule came out of the same instinct: a diagnostic whose *output is cited* is not scratch. T3-D16's
64.3 % survival figure came from `tmp-t3-m8-diag3.mjs` and M7's 0.18 ms/frame GL attribution from
`diag7.txt`, so both scripts stay in `_lh/harnesses3/` and were delivered to Desktop + Downloads; the only
deletions were `patch-dash.txt`, `patch-c9.txt` and `tmp-t3-m8-patch.mjs`, my splice scaffolding, which no
claim references.

**Risk.** If `src/` had drifted by even one byte, "the build is the tested artifact" would be false and the
whole report would be describing a superseded bundle — the claim is therefore stated with the command that
checks it, so the next reader can re-run it rather than trust me.

**How to reverse.** `pnpm build`, restart `:3100`, and re-execute the ladder (M7 suite → M3–M6 re-runs → M8
flow → `tmp-t3-app-shots.mjs after <milestone> http://localhost:3100`) against the new BUILD_ID. ~40 minutes
of machine time, no code change.

---

## T3-D19 — A secret scan searches for values, not for shapes

**Q.** The delivery rule for this run is "no secrets in any file I write", and the last step before handing
files over is a scan. The obvious implementation is a pattern list — `eyJ…` for JWTs, `sb_`, `sk-`,
`postgres://…@…:5432`, `Bearer …`, `password = "…"`, the demo address. Cost of a false "clean": a session
token leaves the machine inside an evidence bundle.

**What actually happened.** The pattern scan ran over the first delivery copy and printed **0 matches**, and
I was about to write that into the docs as the closing check. It was wrong. The thing in the bundle was the
**minted Supabase session cookie**, and no pattern of mine described it, because the cookie arrived there
indirectly: `t3-lh.sh` passes it as `lighthouse --extra-headers '{"Cookie":"…"}'` so the signed-in app
routes can be measured at all, and Lighthouse records `configSettings.extraHeaders` **verbatim** in every
report it writes — 30 files (`afterG`…`afterM` × `dashboard`/`app`/`agentos`, both `.json` and `.html`).
Patterns that describe a *shape* of secret cannot find a secret that is only ever present as an opaque
2 974-byte value in a field nobody thought to look at.

**Chosen.** Scan by **value**: read the real credentials from the out-of-repo files
(`_lh/take3/authcookie.txt`, `_lh/take3/demo-cred.json`), take each cookie's value and each credential
string, and search the bundle for those exact bytes — then report only counts, names and lengths, never the
value itself. `_lh/harnesses3/tmp-t3-scan-redact.mjs` does both halves (`scan` and `redact`) and is kept as
a harness because a control you cannot re-run is a belief, not a check. In `redact` mode each occurrence
becomes `[REDACTED-SESSION-COOKIE-VALUE:<name>,<n> chars]`, which preserves the header's shape so a reader
can still see *why* the app routes were measurable.

**Consequences, verified rather than assumed.** 30 offenders → 0 on both delivery copies; all 92 `.json`
reports in the bundle still `JSON.parse`; scores and `finalUrl` (the field the scorer's identity gate
checks) are unchanged; a `REDACTION-NOTE.md` now sits inside the bundle naming the mode, the counts and the
fact that the working originals under `_lh/take3/lh/` were left byte-exact and never enter the repo. The
same scan pointed at `repo/` (565 files across `docs`, `src`, `scripts`, `.agent-logs`, `prisma`,
`benchmarks`) found one *committed* leak that is not this run's — a plaintext demo password in a
`2026-09-29` `.agent-logs` file — and the decision there was to **report it, not edit it**, because
`.agent-logs` entries are outside my write scope and rotation is the action that actually revokes the value
(§12.6 gap 13).

**Risk.** Redaction touches evidence, so it is confined to copies outside the repo and documented in the
bundle — and it does not undo the exposure: the token was minted for a read-only session and Take 3 never
called `signOut()`, so it lives until it expires. The real close is the password rotation already listed as
an open owner action.

**How to reverse.** Re-copy from `_lh/take3/lh/` (untouched originals) and ship nothing, or re-mint the
cookie and re-run the passes with `NO_AUTH=1` for the public routes only.

---

## T3-D20 — A document-scroll engine is mounted per-route, never globally, on a product with two scroll models

**Q.** The owner reported that `/dashboard`, `/app` and `/agentos` "are not scrolling when im scrolling
down from my mouse". The product has **two incompatible scroll models in one tree**: the marketing and auth
routes scroll the *document* (landing `scrollHeight` 15057 vs `innerHeight` 900), while the three app shells
are `h-dvh` containers whose content scrolls inside `main#main-content` with `overflow-y-auto`, so their
document cannot scroll at all (measured: `scrollHeight == innerHeight == 900`). Lenis, mounted once in the
root layout with `smoothWheel: true`, `preventDefault`s the window wheel and animates *document* scroll —
correct on one model, fatal on the other.

**Options considered.** (a) `data-lenis-prevent` on every inner scroller: keeps one mount, but the list of
scrollable elements is not closed — `run-view`'s event log, the chat sidebar, the dashboard table boxes and
any future `overflow-auto` would each need the attribute, and forgetting one silently re-breaks the page in
the same way. (b) Remove Lenis everywhere: simplest, and it is literally what `docs/DESIGN.md:112-119`
prescribes, but it deletes the scrubbed `horizontal-showcase` and every `ScrollTrigger.update` on the
landing, which V3 §10 forbids ("never remove the landing animations"). (c) Route-gate the provider so the
engine is only ever *created* on document-scroll routes.

**Chosen.** (c), via `usePathname()` — `WORKSPACE_ROUTES` + prefix match (`smooth-scroll-provider.tsx:33-36`),
`workspace` derived in render (:41), `if (reduced || workspace) return` inside the effect (:44), deps
`[reduced, workspace]` (:63). The dependency array is the part that makes it correct rather than merely
lucky: because the effect re-runs on route change, the instance is **destroyed on the way into the app and
recreated on the way out**, which a one-shot `typeof window` / initial-path check cannot do for client
transitions. Chosen over (a) because safety should not depend on remembering an attribute in a component
nobody owns, and over (b) because §10's protected surface beats my preference for a smaller provider.

**Consequences, measured.** Wheel gate 9/15 → **15/15**: dashboard main 1200 px of 6388, chat sidebar 678
px of 678, `/agentos` main 131 px of 131 and its event log 1200 px of 2850, all with `lenis=false`; landing
still 1200 px with `lenis=true` (the fix removed a defect, not a feature); `roundTrip` proves
mount → unmount → remount across sign-in and two client transitions; reduced-motion remains the standing
control where Lenis was never created. Rebuild → new `BUILD_ID VEtfREmN7KbJdQ_srlFdr`, so `afterG`…`afterM`
were superseded (T3-D13 turned on my own change) and five fresh Lighthouse passes scored **10/10 gates**.

**Risk.** The route list is a second place that encodes "which pages are app shells" — if a future
document-scroll page is added under `/app/…` it inherits native scrolling, which is a *loss of smoothness*,
not a *loss of function*, and is therefore the safe direction to fail. `docs/DESIGN.md:112-119` already
states the rule; the provider's own comment block (16-26) now points at it and at M9.

**How to reverse.** Delete the `workspace` guard and the `usePathname` import, i.e. restore
`}, [reduced])` — and note that this restores the defect, not just the code.

---

## T3-D21 — Input is tested with trusted input events; a build that changes gets re-measured, not re-cited

**Q.** 183 gates closed M1–M8, including a suite whose whole thesis was "it's done because it was USED" —
and not one of them ever moved a mouse wheel. `grep page.mouse.wheel _lh/harnesses3/*.mjs` → **0 matches**
in 37 harnesses. The bug the owner found by hand was invisible to every automated claim I had filed.

**Options considered.** (a) Patch the existing suites to add a wheel step: cheap, but it puts an input test
inside suites that assert other things, so a wheel failure would be reported as an M7 perf failure. (b) One
dedicated gate that treats **the event type as the unit under test**, with the same discipline the other
suites use — every PASS must be able to fail. (c) Accept the gap and document it.

**Chosen.** (b), `tmp-t3-m9-wheel.mjs`. Three properties make it a control rather than a screenshot:
**resolve the scroller under the pointer** by walking up from `document.elementFromPoint` at three
x-positions instead of assuming `window` (this is what makes `/login` correctly report "nothing to wheel"
rather than a false PASS); **dispatch trusted CDP input** (`page.mouse.wheel(0, 600)`, positional args —
the options-object form throws `deltaX: expected float, got object`); and **run a `scrollTo` positive
control on the same node** so `moved: 0` means *intercepted*, not *empty*. A range-aware threshold
(`min(300, scrollable range) − 2`) keeps the `/agentos` 131 px shell honest without weakening the check on a
6388 px one. Routes with no scrollable region are counted INFO, not PASS — the count is 15/15 precisely
because it does not award itself points for nothing.

**The second half of the decision.** A product fix invalidates its own evidence, so the wheel gate was run
in **both modes on the defective artifact first** (before `pnpm build` of the fix, so "before" is the page
the owner described, not my memory of it), and after rebuilding, **every downstream number was re-measured
rather than reused**: six verification suites re-run (28 + 26 + 33 + 34 + 67 + 31, all exit 0), ten
superseded Lighthouse passes excluded, five new passes run, and all 36 screenshots re-shot on
`VEtfREmN7KbJdQ_srlFdr`. The first re-run chain failed en masse and the attribution was measured, not
assumed: `net::ERR_INTERNET_DISCONNECTED` from M8's own B5, plus M6's "HTTP 200 / h1 = 'Welcome back'"
cascade — the route gate serving `/login` to an anonymous context while the box had no network. Both chains
are on disk (`_lh/take3/m9/reverify/`, `reverify2/`) because deleting the outage logs would have made the
green chain unfalsifiable.

**Risk.** A trusted-input gate is slower and flakier than a `scrollTo` assertion, and it can only run
against a live server; the mitigation is that it fails *loudly* (exit non-zero on any FAIL) and that its
positive control distinguishes "my harness broke" from "the page broke".

**How to reverse.** Nothing to reverse in product code — this is method. The rule to carry forward: for any
interaction the brief describes in the user's own body language ("when I scroll", "on hover"), the gate must
dispatch that device's event, and grep for it before claiming coverage.

---

## T3-D22 — Authorization buys the commit, not the shortcut: milestone-sized commits, honest attribution, and a delivery that gets re-scanned and re-counted

**Q.** The owner's M9 message ended with "proceed with the commit and push". The M8 close had counted **61
porcelain paths** (34 M · 2 D · 25 ??) spanning two runs, of which 28 were still dirty when this authorization
arrived; one of them a tracked session log that already contained a plaintext password, and the evidence bundle
on Desktop/Downloads carried cited counts (394 files / 156 MB / 196 reports / 38 harnesses) that the M9 rebuild
had just made false. What exactly does that sentence authorize, and what does it oblige?

**Options considered.** (a) One `commit -A` of everything: fastest, and it would have welded Take 2's shader,
Take 3's app surfaces, the wheel fix and 119 evidence files into a single unreviewable blob — and it cannot
answer "which commit broke the wheel". (b) Milestone-sized commits, which is what the report had already
promised ("say the word and I'll split them into milestone-sized commits"). (c) Commit `src/` and leave the
docs and evidence untracked, which would ship claims whose reproducers sit outside version control.

**Chosen.** (b), with three obligations the authorization does *not* waive. **(1) Attribution over tidiness.**
`git status` cannot separate Take 2's 30 uncommitted paths from Take 3's, so `eb97c73` says in its message that
it carries the previous run's landing work instead of letting a diff imply Take 3 authored the fluid shader. A
commit message that lets a reader draw the wrong conclusion is a fabricated number wearing a different hat.
**(2) The leak gets re-checked, not re-litigated.** The session log's 1217 new lines went in as their own
commit only after a scan of **values** (ten `.env.local` secrets + the demo password + the cookie, matched by
exact bytes) returned 0 occurrences in the new lines and the same 4 in the pre-existing ones — so the commit
neither widens nor closes gap 13, and the message says that rather than claiming hygiene it did not perform.
**(3) A changed delivery re-measures itself.** The bundle was rebuilt from source (532 files, 207 MB, `diff
-rq` clean between the two copies), the new signed-in reports were redacted by value, the scan was re-run over
all 532 files (`offenderCount: 0`), and the stale counts were **rewritten in both docs** — a cited number whose
artifact moved is re-cited, not footnoted. The same rule applied to the code: `find src -newermt "2026-10-10
01:20"` → 0 files, the four static gates and the wheel gate re-run on the committed tree (the wheel under a new
mode label, `wheel-pushcheck`, so the cited `wheel-after` pair stays the file the report describes), and only
then `git push`.

**Consequences.** A long commit series instead of one; two of them name another run's work; the docs now carry a
delivery count that has to be re-checked whenever the bundle is refreshed. `origin/main` == `main`, tree clean.

**Risk.** Splitting by milestone means a bisect lands on a commit that is honest but partial — e.g. `387bed0`
ships the `min-w-0` card clamp whose visible effect belongs to the dashboard commit. Accepted: the alternative
is a commit that cannot be reverted without taking the wheel fix with it.

**How to reverse.** `git revert` is per-commit and works precisely because the split is fine-grained. The
push itself is not reversible without your call on force-pushing, which is why the gates ran *before* it.
