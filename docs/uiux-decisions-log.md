# UI/UX decisions log (autonomous protocol §13)

Format: **Q / Options considered / Chosen / Why / Risk / How to reverse.**

## UX-D1 — Theme: one dark system supersedes the light-editorial style

- **Q:** The repo currently ships a light-editorial marketing palette (paper/ink/hairline,
  `dawn`) plus a swappable dark (`dusk`). The brief §4.1 orders ONE dark design system across all
  six surfaces, explicitly superseding the light editorial look.
- **Options:** (a) keep light-editorial and add dark accents (contradicts §4.1); (b) force the
  existing `dusk` dark palette everywhere and enrich it to Lusion-grade near-black; (c) build a
  brand-new dark palette from scratch, discarding both.
- **Chosen:** **(b)** — make dark the single surface. Re-point the token system at a refined
  near-black canvas (`#0a0a0b`-family) with elevated surfaces and ONE accent; retire the
  light-editorial marketing palette and the light/dark toggle (differentiate surfaces by
  intensity, not theme, per §4.1).
- **Why:** the owner re-aimed the site at Lusion/DownBeat (both dark immersive); §4.1 is explicit.
  Reusing the existing `dusk` variable plumbing (`--bg/--surface/--text/…` + `@theme inline`) is
  the smallest diff — every component already reads those tokens, so flipping their values
  recolors all six surfaces at once.
- **Risk:** muted-text contrast on near-black must be re-checked for AA (the light palette's
  `--text-faint` values won't carry over). Mitigated in M6 a11y pass.
- **Reverse:** restore the previous `:root`/`[data-surface]` blocks from git (the light values
  are preserved in this log's rationale and in `docs/DESIGN.md`).

## UX-D2 — Fonts: Inter (variable) display+text + IBM Plex Mono; retire EB Garamond

- **Q:** Which ONE display/text family + ONE mono family (§8.2)? References use Aeonik (lusion,
  proprietary) and Instrument Sans (downbeat). Current repo display = EB Garamond serif.
- **Options:** (a) Inter (already installed, variable 100–900); (b) Space Grotesk (distinctive
  geometric, new dep); (c) Instrument Sans (downbeat's actual face, new dep); (d) keep EB Garamond.
- **Chosen:** **(a) Inter** for display+text (heavy weights 700–900 with tight −0.03/−0.04em
  tracking for display), **IBM Plex Mono** for mono/terminal/data (already installed). Retire EB
  Garamond from the display role.
- **Why:** Inter is a clean neo-grotesque in the same character family as Aeonik / Instrument
  Sans (we match character, never the proprietary file); it is already self-hosted via
  `next/font` as a variable font so heavy display weights cost zero extra faces and zero new
  deps; IBM Plex Mono is literally the family Lusion ships. Smallest diff, zero load risk, no
  unstyled flash. Space Grotesk's quirky glyphs read _less_ like Lusion's neutral Aeonik.
- **Risk:** Inter-at-900 is less "distinctive" than Space Grotesk for an award site. Mitigated by
  extreme scale contrast + tight tracking + uppercase micro-labels (the Lusion cadence).
- **Reverse:** swap the `--font-display/--font-sans` variables in `globals.css` and the
  `next/font` import in `[locale]/layout.tsx`.

## UX-D3 — Animation stack: lenis (installed) + gsap/ScrollTrigger (new); NO three, NO framer

- **Q:** Which animation libraries (§5.1 priority: existing first, then framer, gsap, lenis, three)?
- **Options:** (a) lenis + gsap only; (b) lenis + gsap + framer-motion/motion; (c) lenis + gsap +
  three/@react-three/fiber for a WebGL hero; (d) hand-roll everything with rAF.
- **Chosen:** **(a)** — `lenis@1.3.26` (already installed, now actually wired) + **`gsap@^3.15.0`**
  (ScrollTrigger bundled). No framer-motion, no three.
- **Why:** lenis covers smooth scroll; gsap/ScrollTrigger is purpose-built for the pinned
  horizontal showcase, scroll-scrubbed timelines and pinning (the two owner signature moves).
  Component enter/exit + reveals are handled by small shared CSS/rAF primitives (no framer
  needed), keeping the bundle lean (§5.7 ≤150KB animation JS). Adding framer AND three would
  blow the budget for marginal gain.
- **Risk:** hand-rolled enter/exit primitives are more code than framer's AnimatePresence.
  Acceptable: reveals are simple opacity/transform staggers.
- **Reverse:** `pnpm remove gsap` and delete `lib/motion/**` scroll wiring; reveals degrade to CSS.

## UX-D4 — Hero centerpiece: 2D canvas particle field, NOT three.js/WebGL-3D

- **Q:** WebGL (three/@react-three/fiber) hero vs 2D canvas/SVG (§5.1 conditions)?
- **Options:** (a) three.js particle scene; (b) 2D canvas monochrome particle field; (c) layered
  SVG/DOM only.
- **Chosen:** **(b)** — a 2D `<canvas>` monochrome particle field (drifting points + connecting
  density), Lusion-_feeling_ but original, drawn in code.
- **Why:** §5.1 says use three only if it stays smooth on integrated graphics, loads after LCP,
  pauses off-screen, has a static fallback, and hero assets <1.5MB. A 2D canvas meets all of
  these trivially with a fraction of the bundle and no WebGL-context-loss risk; three adds
  ~600KB+ and real jank risk on the demo laptop. "When in doubt, canvas/SVG."
- **Risk:** 2D canvas is less "3D-wow" than a real WebGL scene. Mitigated by craft (density,
  parallax, pointer response) and by the rest of the page's motion.
- **Reverse:** swap the hero canvas component for a dynamic-imported three scene later.

## UX-D5 — Text splitting: local char/word util, no `split-type` dep

- **Q:** Use `split-type@0.3.4` or split manually for the proximity glow + line/char reveals?
- **Options:** (a) install split-type; (b) a small local `splitText()` util producing
  per-char/per-word `<span>`s.
- **Chosen:** **(b)** local util.
- **Why:** the splitting needed is trivial (wrap chars/words in spans with `aria-hidden`
  duplicates for a11y); a dep adds bytes and a hydration edge for no capability gain. Keeps the
  new-dep count at one (gsap).
- **Risk:** manual splitter must preserve accessibility (screen readers read the whole string,
  not per-char). Mitigated: render an `sr-only` full-text twin and `aria-hidden` the split spans.
- **Reverse:** install split-type and swap the util's internals (same output shape).

## UX-D6 — Proximity word-glow implemented from owner description (reference DOM not isolable)

- **Q:** DownBeat's proximity glow was not present as per-char spans at load (live probe found
  only waveform-bar char containers). How to implement the owner's named effect?
- **Options:** (a) copy an assumed DOM from memory (risk: wrong + unverifiable); (b) implement the
  standard technique from the owner's description ("cursor near a word → that part grows +
  glows"), tagged `[ADAPTED-FROM-DESCRIPTION]`.
- **Chosen:** **(b)** — per-char spans on display type; on pointermove, map distance→scale +
  glow (transform/opacity/filter only), rAF-throttled; radius/scale/glow from tokens; disabled on
  touch + reduced motion.
- **Why:** honest (we never claim to have copied a DOM we couldn't observe) and it delivers
  exactly the effect the owner described.
- **Risk:** our parameters differ from DownBeat's. Acceptable — the goal is the feel, not a clone.
- **Reverse:** delete the proximity component; headings render unsplit.

## UX-D7 — Showcase panels: code-drawn miniatures of the REAL surfaces (no fabricated screenshots)

- **Q:** The pinned horizontal showcase must show the product's own surfaces. Real captures vs
  code-drawn miniatures (§6.2 item 7)?
- **Options:** (a) real browser captures of /app, /dashboard, /agentos embedded as images; (b)
  code-drawn stylized miniatures (live DOM/SVG) of each surface.
- **Chosen:** **(b)** code-drawn miniatures (stylized, clearly illustrative), because embedding
  real captures as static images would freeze live data and risk reading as "fabricated
  screenshots"; miniatures render real structure (panels, badges, charts) in code.
- **Why:** §6.2 forbids fabricating screenshots claiming they're real captures; code-drawn
  miniatures are honest, crisp at any DPR, and theme-consistent.
- **Risk:** miniatures are less photoreal. Acceptable and labeled as illustrative.
- **Reverse:** swap a panel's inner content for a real labeled capture if one is produced later.

## UX-D8 — No new app pages; nav = Chat · Dashboard · AgentOS (already real)

- **Q:** Add new app pages/nav buttons (§4.3 allows only real pages)?
- **Options:** (a) add a Runs index page; (b) keep the existing three real views.
- **Chosen:** **(b)** — the existing `ViewNav` already exposes exactly Chat · Dashboard ·
  AgentOS, all real and data-backed. No new pages (a Runs index would duplicate the run view's
  replay list without new data).
- **Why:** "only real routes get buttons — no dead links, no placeholder pages."
- **Risk:** none material.
- **Reverse:** add a page later if it gains a real data job.

## UX-D9 — M4 landing composition: new `components/landing/` tree; old marketing landing deleted

- **Q:** Where does the 15-section landing live, and what happens to `components/marketing/landing.tsx`?
- **Options:** (a) rewrite the old file in place; (b) new `components/landing/` module tree
  (preloader, nav, hero-canvas, showcase, pipeline, faq, landing-page) with `page.tsx` re-pointed,
  old file deleted.
- **Chosen:** **(b)** — the rebuild shares nothing with the thin single-screen page; a dedicated
  module keeps each motion piece independently testable and reduced-motion-guarded. The old file
  was git-tracked, so it stays recoverable from HEAD.
- **Why:** cleanest ownership; `MarketingShell`/`DoorIllustration` remain for auth surfaces (M5).
- **Risk:** none material — no tests or other components referenced the deleted file (verified by grep).
- **Reverse:** `git checkout HEAD -- src/components/marketing/landing.tsx` and re-point page.tsx.

## UX-D10 — M4 verification tooling: temporary Playwright harness (remove after use)

- **Q:** The automation browser throttles requestAnimationFrame to 0 frames/s for the
  off-screen tab, so gsap's ticker (and therefore the pinned scrub + Lenis) cannot be
  exercised through browser-use's synthetic input. How do we verify the pinned showcase
  honestly?
- **Options:** (a) claim it "works in principle"; (b) drive a real Chromium with trusted
  wheel input via a temporary local Playwright harness; (c) skip verification.
- **Chosen:** **(b)** — `playwright` added as a devDependency only for this pass;
  `scripts/tmp-uiux-m4-verify.mjs` runs locally against :3000 (1440 scrub + pin lifecycle,
  375 overflow, reduced-motion static checks). Both will be removed once M4–M7 verification
  is done, keeping the delivered dependency set at lenis+gsap (UX-D3).
- **Why:** §9 forbids claiming motion works without watching it move; free, local, no
  accounts, no paid calls.
- **Risk:** none to the product; devDep churn is reverted at M7.
- **Reverse:** `pnpm remove playwright; rm scripts/tmp-uiux-m4-verify.mjs`.

## UX-D11 — SmoothScrollProvider must NOT globally kill ScrollTriggers (StrictMode bug found)

- **Q:** Live probe showed the pinned showcase applied once at load then froze (no scrub,
  no pin updates). Root cause?
- **Two causes found:** (1) provider cleanup called `ScrollTrigger.getAll().forEach(kill)` —
  under React StrictMode double-mount this destroys OTHER components' triggers (they don't
  re-create because their own deps didn't change); (2) the verification browser's rAF
  throttling (UX-D10) hid all ticker-driven behaviour from the first probe round.
- **Chosen fix:** provider now only removes its ticker callback, unbinds its Lenis listener
  and destroys its own Lenis; every scene component owns (and kills) its own ScrollTrigger.
  Also added a Preloader timeout fallback (transitionend can never fire when transitions
  are disabled) so the overlay can never swallow clicks.
- **Why:** brief: "no ScrollTrigger/RAF loops running across route changes" — ownership per
  scene satisfies it without cross-component destruction.
- **Risk:** none; standard gsap+Next practice.
- **Reverse:** not needed.

## UX-D12 — Anchor navigation needs Lenis `anchors: true` (dead nav found by live probe)

- **Q:** M4 harness clicked `header a[href="#capabilities"]` and the page did not move
  (`{ top: 2284, scrollY: 0 }`). Fake anchor links are a §14 NEVER ("no dead nav buttons"). Why?
- **Options:** (a) hand-write a click handler that calls `lenis.scrollTo`; (b) enable Lenis's
  built-in `anchors` option; (c) drop hash links for buttons.
- **Chosen:** **(b)** — verified in `node_modules/lenis/dist/lenis.d.ts` (`anchors?: boolean |
ScrollToOptions`) and `lenis.mjs`: the constructor registers a `click` listener, filters
  `event.composedPath()` for same-host+same-pathname anchors carrying a hash, and calls
  `scrollTo(hash, options)`. `scrollTo` reads `getComputedStyle(node).scrollMarginTop`, so the
  existing `scroll-mt-20` classes supply the fixed-header offset for free. One option, zero
  custom code.
- **Why:** Lenis owns the animated scroll position; the browser's instant jump gets snapped back
  to Lenis's value, which is exactly the dead-link symptom.
- **Risk:** none — disabled under `reducedMotion` (the provider does not mount Lenis there), and
  plain hash navigation still works as the browser fallback.
- **Reverse:** delete the `anchors: true` key.

## UX-D13 — M4 verification drives trusted wheel input only (programmatic scroll fights Lenis)

- **Q:** The first harness used `scrollIntoView` / `scrollBy` and reported "showcase not pinned",
  "section still fixed after range end", and a proximity-glow FAIL. Genuine regressions?
- **Options:** (a) "fix" the components; (b) change the harness to match how a human scrolls.
- **Chosen:** **(b)** — Lenis snaps programmatic jumps back to its own animated value, so only
  `page.mouse.wheel` (trusted input) drives the pin/scrub lifecycle honestly. The harness now
  discovers the pin by wheel-stepping until `position: fixed`, scrubs in 300–400px increments,
  and waits ~1.2s after the last wheel event because Lenis keeps gliding — reading glyph rects
  mid-glide measures the wrong viewport position.
- **Why:** §9 forbids claiming motion works without watching it move; a harness artifact must
  never be mistaken for a product bug (or the reverse).
- **Risk:** harness is slower (~30s per pass) and wheel-step granularity can overshoot a
  shortened pin range — after UX-D17 the delta dropped 5205→4886px, so the scrub loop was
  retuned from 12×400 to 5×400 + 4×300.
- **Reverse:** revert to `scrollIntoView` when Lenis is removed (never).

## UX-D14 — Preloader cut to 900ms; dev-server timing is not the shipped number

- **Q:** Measured unmount was 3250ms against the brief's ≤2.5s flash-free budget.
- **Options:** (a) claim the harness over-measures; (b) shorten the animation and re-measure;
  (c) remove the preloader.
- **Chosen:** **(b)** — `DURATION_MS` 1300→900 with the exit transition unchanged; the phase
  union narrowed to `'showing' | 'leaving' | 'gone'` and the 400ms unmount safety timer kept
  (transitionend can never fire when transitions are disabled). Now 1929–2468ms in `pnpm dev`,
  and the harness polls from navigation start with a `sawIt` guard so "never rendered" fails
  loudly instead of silently passing.
- **Why:** honest measurement over rationalisation; the remaining ~1.0–1.5s in that window is
  dev-mode hydration, not animation.
- **Risk:** the dev number still sits near the 2.5s ceiling — **must be re-measured against a
  production build during M6** before any claim is made in the morning report.
- **Reverse:** restore 1300ms if the entrance reads too fast after the M6 check.

## UX-D15 — Pipeline viewBox widened: the PASS terminal was being clipped

- **Q:** The 16-shot section sweep showed the right-hand PASS node cut off in the SVG.
- **Root cause:** nodes were laid out across `ROW = 980` while the `viewBox` width was also 980,
  so the 150px-wide last node (x=1006 after its own width) overflowed the drawing box.
- **Chosen:** `VW = 1064`, `VH = 320` — the viewBox is deliberately wider than the node row, with
  a comment recording why. `nodeX(i)` still distributes across `ROW`.
- **Why:** a diagram whose terminal state is invisible misrepresents the pipeline; §14 forbids
  shipping a broken feature.
- **Risk:** none — the SVG is `width: 100%; height: auto`, so the aspect change is the only
  visual delta (labels sit slightly smaller relative to the row).
- **Reverse:** not needed.

## UX-D16 — ProximityText splits by word so line breaks never land mid-word

- **Q:** The hero proximity headline wrapped as "Firs / t Super" at 1440.
- **Options:** (a) shrink font-size/width; (b) split per character but wrap each word in a
  non-breaking inline block; (c) take the `split-type` dependency.
- **Chosen:** **(b)** — `splitWords()` yields words and spaces; spaces render as bare `<Fragment>`
  text so line breaking is normal, each word becomes
  `inline-block whitespace-nowrap` holding its own `data-char` spans. Glow logic (window
  `pointermove` → rAF → `scale`/`opacity`/`drop-shadow` per glyph within `radius`) is untouched.
  Dead `splitChars()` removed from `lib/motion/split-text.ts`.
- **Why:** per-character `inline-block` makes every glyph a break opportunity; the owner's
  proximity-glow demo (DownBeat-style) is worthless if the word disintegrates.
- **Risk:** none material; the sr-only full-text twin still carries the accessible name.
- **Reverse:** revert to flat char mapping (reintroduces the defect).

## UX-D17 — Showcase composition: two-scale panel widths, full-height miniatures

- **Q:** Desktop sweep shots showed the pinned showcase panels floating with dead space:
  caption column and miniature column were both fixed at the same width, miniatures only filled
  their natural height.
- **Chosen:** caption column `w-[min(34vw,420px)]`, miniature column `w-[min(48vw,640px)]`, both
  `shrink-0`; `ShowcasePanel` takes `className` and pads via `pad(index+1) / pad(PANELS.length)`;
  `EvidenceMini` rows `flex-1`, `RunViewMini` container `h-full justify-center`.
- **Why:** the reference-site look is asymmetric columns with the visual dominant; the brief
  demands a product showcase that reads as designed, not as stacked cards.
- **Risk:** the pin scrub distance shrank (see UX-D13 risk); panel widths are viewport-proportional
  so 1280/1920 need the M6 sweep, and ≤768px takes the vertical fallback.
- **Reverse:** restore equal `w-[420px]` columns.

## UX-D18 — 375px horizontal overflow was real: Decision Bus `<pre>` blew its grid track

- **Q:** The harness reported `document.scrollWidth` 532 vs a 375 viewport (§14 NEVER: no
  horizontal overflow). Offender dump pointed at the terminal `<pre>` in the Decision Bus section.
- **Options:** (a) clamp with `overflow: hidden`; (b) hide the terminal on mobile; (c) fix the
  flex/grid min-size.
- **Chosen:** **(c)** — `min-w-0` on the `<FadeUp>` grid child plus `max-w-full overflow-x-auto`
  on the `<pre>`, so long trace lines scroll inside their own box instead of widening the page.
- **Why:** a grid/flex child's default `min-width: auto` is its content width; hiding or clipping
  would delete real content from the mobile experience.
- **Risk:** none — verified PASS ("375px: no horizontal overflow") after the fix.
- **Reverse:** not needed.

## UX-D19 — Token misuse cleanup from the same visual pass

- **Q:** Three smaller defects surfaced while reviewing the sweep: `<main>` carried `bg-text`
  (a light token — it would paint a near-white page), desktop Login used `variant="ghost"` and
  disappeared against the nav, and the FAQ block was `mx-auto max-w-3xl` inside a wider head.
- **Chosen:** `<main className="text-text selection:bg-accent/30 selection:text-bg">`; Login →
  `variant="outline" size="controlSm"`; FAQ `w-full max-w-4xl`; CTA section id `start` (the
  proximity headline the owner demoed); FAQ head retitled "Questions a juror would ask".
- **Why:** `bg-text` was a silent token slip that `check:tokens` cannot catch (both are valid
  tokens); the rest is competition-grade polish, not invention.
- **Risk:** none. Selection colour now uses the accent on the dark bg token — contrast checked
  again in the M6 a11y pass.
- **Reverse:** revert class strings.

## UX-D20 — The three-state theme toggle was deleted, not restyled

- **Q:** Brief line 242 says "Keep all existing auth/middleware behavior untouched" and the app
  header carried a `ThemeToggle` (dawn / dusk / system). Under UX-D1 the product ships ONE dark
  system across all six surfaces, so a light/dark switch is a control that cannot do what its
  label claims. §14 NEVER: "never ship dead nav buttons".
- **Options:** (a) keep it and let it flip the app surfaces back to a light palette (breaks
  UX-D1); (b) keep it but neuter it to a no-op (a dead control with a working-looking menu);
  (c) delete it and everything it depends on.
- **Chosen:** **(c)** — removed `src/components/theme/` (toggle, provider, store) and the
  `[data-surface]` CSS blocks in `globals.css` that only those files ever set, plus the NO_FOUC
  inline script and `suppressHydrationWarning` in the root layout. Verified by grep that no other
  module imported them (`src/lib/models.ts` has unrelated "dawn/dusk" strings and sits in the §11
  must-not-touch list — left alone).
- **Why:** a switch that changes one surface but not the landing is worse than no switch; the
  owner's stated goal is font/palette _consistency_ across the six surfaces.
- **Risk:** losing the light "editorial" palette if the owner wants it back. Recoverable — the
  files exist at git HEAD (`git show HEAD:src/components/theme/theme-toggle.tsx`), and the retired
  `paper/ink/sub/hairline` tokens are documented in UX-D1.
- **Reverse:** `git checkout HEAD -- src/components/theme src/app/\[locale\]/layout.tsx` and
  restore the two CSS blocks.

## UX-D21 — Auth surfaces and the marketing shell moved onto the dark system

- **Q:** `/login` and `/signup` were still painted with the retired light editorial palette
  (`panel rgb(247,248,250)`, white inputs, near-black submit) while everything else went dark —
  a font-and-palette split on the exact two surfaces the juror clicks first.
- **Chosen:** `bg-bg` canvas → `bg-surface` 22px panel with an accent hairline + peeking
  `bg-surface-hover` edge (`marketing-shell.tsx` geometry preserved, only its colours changed);
  inputs `border-border bg-bg text-text placeholder:text-text-faint` with accent focus rings;
  submit keeps `variant="primary"` (accent pill, `--accent-ink` text); header uses `.hero-editorial`;
  content column wrapped in the landing's `<FadeUp>`; the door illustration now fills from tokens
  (`var(--bg)`, `var(--surface-hover)`, `var(--text)`) instead of raw hex. Destructive button text
  went `text-bg`: white on `--danger #e0706a` measures ≈2.8:1 (fails AA) where dark ink measures
  ≈6.3:1.
- **Why:** brief line 246 allows paint changes and forbids touching auth logic; the logic
  (signUp / signInWithPassword / `provisionCurrentUser` / door-swing timing) is byte-identical.
- **Risk:** none outstanding — harness 27/27 PASS, including "empty submit fired zero auth
  requests" on all four viewport/page combos and the real GoTrue failure path rendering the
  generic alert in the danger token.
- **Reverse:** revert five files; `check:tokens` would then flag the door's raw hex again.

## UX-D22 — Identity pass: one name, one scheme, one scrim

- **Q:** Signed-in surfaces disagreed with the landing on small things a juror notices: the chat
  empty state said "Jev Chat Workspace", `metadata.title` still said the template name, the
  viewport advertised a light scheme, the mobile drawer scrim was `bg-black/40` while the landing
  nav uses a blurred `bg-bg/85`, and `global-error.tsx` rendered a light card.
- **Chosen:** chat title/subtitle → "Jev chat" / "multi-model routing workspace";
  `metadata.title = 'AgentOS'`; `viewport = { colorScheme: 'dark', themeColor: '#0a0a0b' }`;
  drawer scrim → `bg-bg/80 … backdrop-blur-sm`; `global-error.tsx` repainted from the dark `:root`
  values (it is allowlisted for hex because it replaces the whole app before `globals.css` is
  guaranteed to have loaded — its own comment says so). The door gained a 1.5px accent "spill"
  down the opening edge so the light-beyond metaphor survives on a dark canvas.
- **Why:** brief line 357 wants the app surfaces on the _same_ system, and a browser chrome that
  proposes light mode contradicts the product.
- **Risk:** none. `check:tokens` still green (allowlist unchanged).
- **Reverse:** revert class/style strings; keep the allowlist entry regardless, the file must stay
  dependency-free.

## UX-D23 — Playwright's `waitForSelector` pierces the Next.js dev overlay (harness trap)

- **Q:** The M5 failure-path check reported "no visible alert" twice while a standalone repro
  proved the product was correct: POST `/auth/v1/token?grant…` → 400 → the form's own
  `[role="alert"]` text present at 3s and still present at 15s.
- **Root cause:** `page.waitForSelector` pierces open shadow DOM, so it resolved against the
  Next.js dev-overlay's own `role="alert"` toast (a transient "App exception" bubble), which had
  vanished by the time the light-DOM read ran.
- **Chosen:** poll the light DOM with `page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.trim() || null)`
  and report the elapsed time (0.8s in the passing run). Kept the long default budget because the
  GoTrue round trip on this project is regularly slower than 2.5s.
- **Why:** this is a harness bug, not a product bug — §14 forbids "fixing" a green flow to satisfy
  a red test.
- **Risk:** if the dev overlay ever shows a _real_ exception we want it loud, not skipped. The
  check separately asserts zero console errors, so a genuine crash still fails the run.
- **Reverse:** revert the wait in `scripts/tmp-uiux-m5-verify.mjs` (file is deleted at M7 anyway).

## UX-D24 — Signed-in surfaces verified by code path, not live login

- **Q:** Brief line 284 says a milestone is done because a feature was _USED_. Chat, dashboard and
  the run view need a session to be used. This session has no test credentials: `_scratch/.test-creds`
  and `_scratch/live-session.json` are absent, no demo password is committed, and §14 forbids
  creating accounts (a signup writes a real auth row to the owner's Supabase project).
- **Chosen:** verified the auth _failure_ path live against real GoTrue (one rejected login, $0,
  no row created) and verified the signed-in surfaces by code path — grep that no retired light
  token/class survives anywhere in `src`, confirm `AppHeader`/`CardTitle`/`EmptyState` all render
  through `.title-editorial`, confirm chat composer/sidebar/conversation use token borders and
  accent focus rings, and confirm the D6 panel order is byte-identical
  (`Header → User → Decision Bus → Roster → Pool Failover → Evidence → Jev Decision → Result`),
  which the brief also protects.
- **Why:** brief line 246 pre-approves exactly this: "otherwise verify visually + via code path,
  and say which you did." Reporting a live signed-in run would have been fabrication.
- **Risk:** a runtime-only regression inside a signed-in surface (e.g. a hook throwing after auth)
  would not be caught by this pass. Mitigated by zero-console-errors on the pages that do load.
- **Reverse:** n/a. **Unblock for M7:** the owner drops a session cookie at
  `_scratch/live-session.json` and the same harness can sweep all three surfaces live.

## UX-D25 — Contrast: measured every text pair, kept the hairline borders as decorative

- **Q:** Brief line 270 demands AA contrast on the dark theme and explicitly says "check muted
  text!". Earlier milestones asserted the token values looked right; nobody had computed the ratios.
- **Chosen:** `scripts/tmp-uiux-m6-contrast.mjs` parses the `:root` block out of
  `src/app/globals.css`, resolves `var()` indirection, and computes WCAG relative-luminance ratios.
  Results on `--bg #0a0a0b`: text 17.7:1, text-muted 10.2:1, text-faint 5.9:1, accent 5.4:1 as a
  focus ring — every text pair clears AA body (4.5:1), and the comments in `globals.css` were
  rewritten to carry these measured numbers instead of the earlier estimates.
- **Two INFO rows are deliberate:** `--border` (1.32:1) and `--border-strong` (1.76:1) sit under the
  3:1 non-text contrast line (SC 1.4.11). They are hairline card edges, not the only visual cue for
  any state or control — every interactive element additionally shows a 2px accent/text focus ring,
  which measures 5.4:1. Left as-is and logged rather than quietly brightened, because lifting them
  to 3:1 would turn the editorial hairlines into visible boxes and diverge from the reference sites.
- **Risk:** a future state that relies on a border alone (e.g. "error = red outline") must be
  re-checked against 1.4.11; the lint gate cannot express that.
- **Reverse:** re-run the script; it reads the tokens, so changing a token changes the audit.

## UX-D26 — Tap targets: four real WCAG 2.5.8 failures found and fixed

- **Q:** Brief line 270 (keyboard + focus) plus the hostile-self-critique list (line 276) asked for
  a touch sweep. The new `scripts/tmp-uiux-m6-sweep.mjs` measures every visible `a`/`button` box at
  375/768/1280/1920/**3840** and on `/login`.
- **Found (measured, not guessed):** marketing nav anchors 16px tall, footer Explore/Account links
  16px, the hero's "or log in" 20px, the auth-surface brand link 23px. All below the 24×24 AA
  minimum (2.5.8). The "or log in" link is _not_ exempt — 2.5.8 exempts links presented inside a
  sentence, and this one is a standalone CTA next to a button.
- **Chosen:** `inline-flex min-h-11 items-center` on the nav anchors, footer links, the auth brand
  and "or log in"; hamburger `size-10` → `size-11`. Footer link lists went `gap-2.5` → `gap-0.5`
  because the 44px hit boxes already provide the rhythm. No visual redesign, only hit-area padding.
- **Harness note kept honest:** the probe measures layout boxes, so an `opacity-0` closed overlay
  still counts. That direction is conservative — it can only raise more failures, never hide one.
- **Result:** 66/66 checks green, including "all 19 tap targets meet WCAG 2.2 AA (>=24px)" at every
  width, and the two 36px `controlSm` buttons are reported as INFO (above 24, below 44).
- **Reverse:** remove the `min-h-11` utilities; the harness will fail again and show the same numbers.

## UX-D27 — Preloader must not replay: session-scoped skip, no hydration risk

- **Q:** The brief's attack list opens with "preloader flash on repeat visits?". The intro played on
  every navigation into `/`, including client-side returns, and a judge clicking around sees the
  curtain twice.
- **Chosen:** record `agentos.preloader.seen` in `sessionStorage` once the fade begins, and read it
  through `useSyncExternalStore` (`subscribe` is a no-op, server snapshot is `false`). `seen`, a
  reduced-motion preference, or `phase === 'gone'` all render `null`. The 400ms safety-net timer
  still unmounts a fading overlay if `transitionend` never fires, so a transparent full-screen
  layer can never swallow clicks.
- **Why `useSyncExternalStore` and not an effect:** the first attempt called `setPhase('gone')`
  inside the mount effect and eslint rejected it (`react-hooks/set-state-in-effect`); a store read
  is also SSR-safe — server HTML and the first client paint agree, so there is no hydration
  mismatch and no flash of the curtain on a server-rendered pass.
- **Result:** production run reports "client-side return to / does NOT replay the preloader"; a cold
  first visit still mounts and unmounts at 1396ms (budget 2000ms), and the `catch` around the
  storage write means a blocked-storage browser simply plays the intro again rather than crashing.
- **Reverse:** delete the store read + `SEEN_KEY` write in `src/components/landing/preloader.tsx`.

## UX-D28 — Hover-only destructive action is unreachable on touch

- **Q:** Attack list: "dead hover states on touch?". The chat sidebar's delete button was
  `opacity-0 group-hover:opacity-100`, i.e. permanently invisible without a mouse — and it is the
  only way to delete a conversation.
- **Chosen:** `[@media(hover:none)]:opacity-100` plus a token-sized 28px box (`flex size-7 items-center
justify-center`) and `focus-visible:opacity-100` for keyboard users; colours moved to
  `text-text-faint` / `hover:text-danger` so the token lint stays green.
- **Verified:** the touch context (390×844, `hasTouch`, `isMobile`) reports "no control left visible
  only on hover" — 0 offenders across the landing, and the same probe asserts the positive case on
  desktop ("custom cursor mounted (2 nodes) under pointer:fine") so the touch PASS can't be vacuous.
- **Risk:** the always-visible delete icon adds a small affordance to every row on touch; accepted as
  the cost of making the action reachable.
- **Reverse:** restore `opacity-0 group-hover:opacity-100` in `conversation-sidebar.tsx`.

## UX-D29 — FPS: documented method, headless numbers, labelled as a lower bound

- **Q:** Brief line 269 requires an FPS claim with "the method + the number"; line 283 demands "Real
  FPS numbers".
- **Method actually used:** a `requestAnimationFrame` sampler inside the page during a scripted
  wheel-scrub through the pinned `#surfaces` showcase on a **production** build (`pnpm build` +
  `next start -p 3100`), plus a `PerformanceObserver` for `longtask`. Result: 74 frames sampled,
  median 16.7ms (= 60fps at the median), p95 33.4ms, worst 66.6ms, mean 21.2ms (~47fps), and **zero**
  main-thread tasks over 50ms during the scrub (so the >200ms rule is met with headroom).
- **Honest limitation:** these ran under headless software rasterisation. A headed browser — the only
  way to get real GPU numbers on this machine — could not launch here (`browserType.launch:
spawn UNKNOWN`), and the available MCP browser is a 560×570 viewport that never enters the pinned
  desktop showcase path. So this is reported as "60fps at the median, ~47fps mean as a lower bound,
  headless", **not** as "60fps on a mid-tier laptop". No number was invented to close that gap.
- **Also measured, same harness:** LCP 200ms and CLS 0.0009 on the production build, no leaked
  `.pin-spacer` nodes after three route changes (1 → 1, which is the "no ScrollTrigger left running"
  attack), motion code 76KB gzipped and the added libraries 50.6KB gzipped against the 150KB budget.
- **Reverse:** the sampler lives only in the temporary harness (deleted at M7).

## UX-D30 — A budget I invented, caught and replaced with the brief's real one

- **Q:** While writing the perf harness I asserted "page JS must stay under 300KB" and let that drive
  a FAIL. The brief never says that.
- **Chosen:** re-read §5.7 (line 196) and implemented only its budgets — ~60fps on scroll, no long
  task >200ms during scroll, animation JS ≤~150KB gzipped **excluding code already in the app**,
  LCP <2.5s and CLS <0.1 on a production build. Total page weight (472KB JS across 17 files, 593KB
  overall) is now reported as INFO, not judged, because the brief sets no ceiling for it and the app
  surfaces share that bundle with the landing.
- **Why:** a fabricated standard is the same class of error as a fabricated screenshot — it makes the
  report untrustworthy even when the code is fine. Recorded so the number is never re-asserted.
- **Reverse:** n/a.

## UX-D31 — Harness bug: console-error checks were silently vacuous (audit of all harnesses)

- **Q:** The M6 sweep printed "zero console errors" before printing anything else about errors —
  suspiciously clean.
- **Found:** `page.on('console', (m) => m.type === 'error' && …)` compares a **method** to a string,
  so the listener never recorded anything. `m.type()` is the correct call.
- **Chosen:** fixed the sweep and audited every harness for the same mistake
  (`grep -n "m.type" scripts/tmp-uiux-*.mjs`): `tmp-uiux-m4-verify.mjs` (×2),
  `tmp-uiux-m5-verify.mjs` (×2) and `tmp-uiux-m6-perf.mjs` all use `m.type()` correctly, so the
  console-clean claims already recorded for M4/M5 and the production perf run stand. Only this
  sweep's lines were meaningless, and they are now real.
- **Why log it:** the brief's §14 bans fabricated verification. A check that cannot fail is the same
  thing wearing a lab coat, and the fix is worth more than the PASS.
- **Reverse:** n/a.

## UX-D32 — Real Lighthouse on the production build, and what it found that I had missed

- **Q:** Brief line 283 demands "Real Lighthouse before/after", not a self-assessed vibe.
- **Chosen:** ran Lighthouse 13.5.0 against the production build (`pnpm build` + `next start -p 3100`,
  `--preset=desktop`, default simulated throttling, Chrome = the Playwright-bundled Chromium via
  `CHROME_PATH`), $0 and localhost-only. Reports are kept outside the repo at
  `_lh/landing*.report.html` (they are multi-hundred-KB binaries; not committed).
- **Progression actually measured on `/`:** run 1 = Performance 98 / Accessibility 94 / Best
  Practices 100 / SEO 100 with two a11y findings; after fixing both, 98 / **100** / 100 / 100.
  Final field values: FCP 0.3s, LCP 1.0s, TBT 10ms, CLS 0.001, Speed Index 0.9s, TTI 1.0s.
- **Cross-check with my own harness (same build, different method):** `tmp-uiux-m6-perf.mjs` reports
  LCP 360ms / CLS 0.0033 (raw PerformanceObserver, unthrottled localhost) vs Lighthouse's simulated
  1.0s / 0.001. Both are recorded; the Lighthouse numbers are the ones to quote because they are
  throttled, and the observer numbers show the same ordering (well inside §5.7's budgets).
- **Risk:** a desktop-preset localhost run flatters the network path. The throttling model is
  documented here so nobody reads 98 as a production-CDN claim — this app is not deployed by design.
- **Reverse:** n/a. **Follow-up:** UX-D36 records the "before" run from HEAD.

## UX-D33 — The skip link was dead furniture on the landing, and my own harness had approved it

- **Q:** axe reported `skip-link` → "No skip link target" on `/`. The layout's link points at
  `#main-content`, but the landing rendered `<main id="top">`: only the auth shell, chat, dashboard
  and run view carried `id="main-content"`. Keyboard users pressing the skip link went nowhere.
- **Why my sweep missed it:** the check was `!!document.querySelector('a[href="#main-content"]')` —
  presence, not resolution. A link can exist and be broken at the same time.
- **Chosen:** landing `<main id="main-content" tabIndex={-1}>`, nav brand `#top` → `#main-content`
  (verified no other `#top` reference survives), `tabIndex={-1}` added to `MarketingShell`'s main and
  to the template's analytics-demo main so every route's target is a focusable landmark. And the
  harness now asserts three separate things per route: the href resolves to a real `<main>`, the link
  is on-screen once focused, and pressing Enter moves focus into `main#main-content`. That last
  assertion is what caught the missing `tabIndex` on the auth shell (2 FAILs on the first run of the
  improved sweep, fixed, now 80/80).
- **Also changed:** the link itself moved from `sr-only focus:not-sr-only` to a fixed element parked
  off-screen with `-translate-y-[200%]` and a token-duration transform. A 1px clip-path box reads as
  "not focusable" to automated audits; the slide-in also makes the reveal visibly anchored.
- **Risk:** `tabIndex={-1}` on `<main>` adds it to programmatic focus only (not the tab order) — the
  standard pattern; a page that never receives the skip keeps identical behaviour.
- **Reverse:** restore `id="top"` / drop `tabIndex`; the sweep will fail again with the exact reason.

## UX-D34 — axe's two contrast findings: one text node fixed, one decoration reclassified

- **Q:** `color-contrast` failed on `/` with two nodes: the showcase counter `/ 05` at **2.28:1**
  (`text-text-faint` plus `opacity-50`, 11px), and the footer's 144px `AGENTOS` watermark at **1.27:1**
  (`text-text/10`), which is `aria-hidden="true"` and still got flagged.
- **Counter — fixed, not argued:** the hierarchy was carrying meaning the token system already has.
  Current index is now `text-text-muted` (10.2:1), the total `text-text-faint` (5.9:1), no opacity.
  Same read, AA on both halves, and it removes the last `opacity-*` used to darken real text.
- **Watermark — reclassified as a graphic:** it is pure ornament (WCAG 1.4.3 excludes decoration), but
  axe evaluates visible DOM text regardless of `aria-hidden`, so the honest move was to stop making it
  DOM text: `<svg aria-hidden><text fill="var(--text)" fillOpacity="0.1">` inside the same
  `display-huge` box. Pixels are within a hair of the original; the finding disappears because the
  letters are no longer content the audit is being asked to read. This is UX-D25's INFO row becoming
  a hard fact, which is why the INFO row is gone from the script's list.
- **Verification:** Lighthouse a11y 94 → 100 with no `color-contrast` items left.
- **Risk:** an SVG wordmark does not reflow like text at odd widths; it is `overflow-hidden` exactly
  like the div it replaced, and 4K + 375px both render clean in the sweep.
- **Reverse:** put back `text-text/10` on a text div — axe will flag it again.

## UX-D35 — Scroll FPS has run-to-run variance; the claim is a range, not a hero number

- **Q:** Three consecutive runs of the same production build on the same machine gave scrub medians of
  16.7ms, 33.2ms and 16.7ms (means ~47, ~39, ~41 fps).
- **Chosen:** report the range and the cause instead of the best sample. The sampler is
  `requestAnimationFrame` deltas during a scripted wheel-scrub through the pinned `#surfaces`
  showcase; a 33.2ms median means every frame missed one vsync, which is what CPU contention from
  other Chromium processes on this box does to a software rasteriser. What stayed rock-solid across
  all three runs: **zero** main-thread tasks over 50ms during the scrub (budget 200ms), p95 33.4ms,
  worst 50-66ms, and no leaked pin-spacers.
- **So the honest claim is:** "60fps at the median in the clean runs, ~39-47fps as the mean, under
  headless software rendering with no GPU; never a long task." The brief's "≈60fps on a mid-tier
  laptop" cannot be claimed from this machine — that needs a real GPU trace (UX-D29).
- **Risk:** a juror with a GPU laptop could see better or worse; the number is labelled with its
  method, so a mismatch is not a false claim.
- **Reverse:** n/a.

## UX-D36 — Real Lighthouse before/after, measured against HEAD in a throwaway worktree

- **Q:** §5.7 and line 283 require a _real_ before/after, not a claimed one. The "before" is the
  repository as it stood before this UI/UX run (`cb63530`, the light editorial landing), so it had
  to be built and served, not remembered.
- **Method:** `git worktree add --detach _lh/before cb63530` → `pnpm install --ignore-scripts`
  (the install skipped Prisma codegen and `next build` then failed typecheck on
  `@prisma/client`'s missing `PrismaClient`; `pnpm prisma:generate` fixed it — **local codegen
  only**, no DB connection, no migration) → `pnpm build` → `next start -p 3200`. Both builds were
  run through the same Lighthouse 13.5.0 invocation: `npx --yes lighthouse --preset=desktop
--chrome-flags="--headless=new --disable-gpu --no-sandbox"` with `CHROME_PATH` set to the
  Playwright Chromium, so the comparison is same-engine, same flags, same machine.
- **Results (desktop preset, production builds):**

  | Metric         | Before (`cb63530`) | After (this run) |
  | -------------- | ------------------ | ---------------- |
  | Performance    | **79**             | **98**           |
  | Accessibility  | 100                | 100              |
  | Best Practices | 100                | 100              |
  | SEO            | 100                | 100              |
  | FCP            | 0.2s               | 0.3s             |
  | LCP            | 1.4s               | **1.0s**         |
  | TBT            | 400ms              | **10ms**         |
  | CLS            | 0                  | 0.001            |
  | Speed Index    | **0.3s**           | 0.9s             |
  | TTI            | 1.5s               | 1.0s             |

- **The regression is stated, not buried:** Speed Index went the wrong way (0.3s → 0.9s). That is
  the honest, expected cost of a preloader + a much richer above-the-fold hero — SI rewards pages
  that paint content early and uniformly, and the intro deliberately does neither. Everything the
  brief sets as a hard budget moved the right way and well inside its limit (LCP 1.0s < 2.5s,
  CLS 0.001 < 0.1, TBT 400ms → 10ms), which is why the trade is acceptable. If a reviewer weights
  SI above LCP/TTI, the preloader is the one call to revisit.
- **A11y had a mid-run fail:** the first "after" run scored **94**, not 100 — `color-contrast` (2
  items) and `skip-link` (no target). Both were real and both were fixed in-product rather than
  explained away (UX-D33, UX-D34); the 100 above is the score _after_ those fixes.
- **Cross-check:** Lighthouse's lab numbers agree with this run's own harness on the same build
  (LCP 360ms FCP-side / 1.0s field, CLS 0.0033 vs 0.001, 0 long tasks) — two independent tools,
  same conclusions, so neither is being quoted alone.
- **Report disposition:** the eight artifacts live in `_lh/` **outside the repo** (`git status`
  clean of them). Lighthouse JSON is megabytes of machine output with no review value in a
  competition repo, and §14 forbids padding the repo with unverified artifacts; the numbers above
  are the extract, `_lh/` is the receipt. Copy to Desktop/Downloads with the morning report (M7).
- **Teardown:** `git worktree remove --force _lh/before` deregistered it, but Windows' 260-char
  path limit blocked the recursive delete ("Filename too long"), so `cmd //c "rmdir /s /q before"`
  finished it. Verified: the directory is gone **including the `.env.local` copy it held** (that
  copy carried the demo DB credentials — a temporary, untracked file, and now deleted, not
  printed), and `git worktree list` shows only the main repo.
- **Risk:** "before" was built from HEAD without this run's `.env.local` edits, so its routes that
  need env vars could have degraded. It served, hydrated and scored cleanly, and its landing is a
  pure-marketing page with no data fetch, so the comparison is landing-vs-landing on equal footing.
- **Reverse:** n/a — the pair is the evidence. Re-measuring means rebuilding both trees.

## UX-D37 — I destroyed my own before-evidence with a harness default, then rebuilt it

- **What happened:** the M7 final suite re-ran `tmp-uiux-m5-verify.mjs` **without its `after`
  argument**. The harness defaults to `MODE='before'`, so it wrote its four auth captures into
  `docs/uiux-before/` — overwriting the genuine light-editorial before shots with dark
  after-state images. The suite reported "ALL PASS" while quietly corrupting the evidence the
  status doc cites. Nothing failed; that is the point.
- **Why it matters more than a typo:** §14 forbids fabricated evidence, and a `before/` folder
  holding after-state renders is fabrication by omission — worse than a missing file, because it
  looks intact.
- **Recovery:** rebuilt `cb63530` in a throwaway worktree (same method as UX-D36), served it on
  :3200 and re-captured with a dedicated script that **asserts the thing it is proving**: every
  capture printed its computed `body` background, and the script only passes if the before tree is
  light — `body rgb(247, 248, 250)` on all six shots vs `rgb(10, 10, 11)` in the after build.
  Bonus: the recovery produced the two **landing** before captures that never existed
  (`docs/uiux-before/landing-1440.png`, `landing-375.png`), so §16's before/after pair is now
  visual, not just numeric. Worktree, its `.env.local` copy and port 3200 are gone again.
- **Rule taken from it:** a capture harness must not have a destructive default. The M5 harness now
  gets invoked with its mode explicitly, and the M7 recapture script has no mode at all.
- **Risk:** the recaptured before shots are from a rebuilt tree, not the literal pixels the owner
  saw before this run. Same commit, same build pipeline, same routes — the honest description is
  "HEAD rebuilt and captured", which is what the status doc and report now say.
- **Reverse:** n/a.

## UX-D38 — Two semantic defects the section inventory turned up (fixed, not logged as gaps)

- **Q:** M7's live inventory (`section` count, heading outline, link audit) was meant to produce
  accurate numbers for the morning report. It found two things instead.
- **1 · the closing CTA had no heading.** `#start`'s display line was a bare `ProximityText`
  `<span>`, so the page's final call to action was invisible to the heading outline — a juror
  jumping with a screen reader never sees it. Fixed by wrapping it in a real `<h2>` at the call
  site rather than teaching `ProximityText` a polymorphic tag: the glow stays on the inner span,
  the outline gets its entry, and the layout is byte-stable (`max-w-[16ch]` moved to the `h2`,
  which is the flex item).
- **2 · the hero's accessible name was "First SuperAgentOS".** `LineMaskReveal` renders each line
  as a block `<span>`, so `textContent` concatenates them with **no** separator — the space the eye
  reads across the line break does not exist in the DOM. Affects the `<h1>` (the page label
  assistive tech and crawlers quote) and every masked headline. Fixed with a trailing `{' '}`
  inside the masked span: invisible in layout, present in the text stream.
- **Verification:** outline probe after the fix reads `H1 First Super AgentOS` and an `H2` for
  `#start` — 11 headings across 12 sections. Then the **entire** suite was re-run on a fresh
  production build (m4 19, m5 30, contrast AA, perf 15, sweep 80, 25 captures) plus a new
  Lighthouse pass, so no number in the report predates these edits.
- **Risk:** one character of whitespace in a masked line could in principle change wrapping; the
  375/768/1280/1920/3840 sweep re-ran clean with zero overflow, and the reduced-motion render is
  unchanged at 12,660px.
- **Reverse:** drop the `h2` wrapper and the `{' '}`; the outline probe will report both defects
  again.

## UX-D39 — A probe artifact almost became a bug report (aria-aware name check added)

- **Q:** the post-fix outline probe printed `H2 Welcome to First Super AgentOSWelcome to Fir…`,
  i.e. the closing CTA's heading text twice. Read literally that is a screen reader reading the
  headline twice — a real defect worth fixing.
- **Finding:** the probe uses `h.textContent`, and `ProximityText` deliberately ships **two** copies
  of its string: an `sr-only` twin carrying the whole text and an `aria-hidden` split-glyph layer
  carrying the same characters for the visual effect. `textContent` sees both; the accessibility
  tree sees one. So the doubling was an artifact of the measuring instrument, not of the product —
  but nothing in the suite proved that, and "the probe says it twice" is exactly the kind of claim
  a juror or a teammate would take at face value.
- **Decision:** answer it with a measurement that cannot lie. New temporary harness
  `tmp-uiux-m7-a11yname.mjs` resolves the names through `getByRole('heading', { name, exact: true })`
  — which computes the _accessible_ name and therefore honours `aria-hidden` — and adds the
  positive control that the doubled form must resolve to zero elements. Result **ALL PASS (5)**:
  `h1=1 h2=0` for "First Super AgentOS", `h1=0 h2=1` for "Welcome to First Super AgentOS", doubled
  forms 0/0, and the split layer confirmed `aria-hidden` with 26 glyphs.
- **Rule carried forward:** a probe's own blind spots belong in the report next to its numbers.
  Where an assertion is about _meaning_ (accessible names, roles, labels), the harness must go
  through the accessibility API, never through `textContent`/`innerHTML`.
- **Reverse:** n/a — the harness is temporary and dies with the rest at teardown.

## UX-D40 — Teardown: what leaves the repo, what leaves the machine, and one self-inflicted evidence loss

- **Q:** §10 closes with "remove the temporary harnesses and the temporary dependency". Which
  artifacts are temporary, and who keeps them?
- **Removed from the repo:** the `playwright` devDependency (`pnpm remove playwright`; the
  pre-existing `@playwright/test@^1.62.1` and the `test:e2e` script from `cb63530` are untouched —
  verified against `git show HEAD:package.json`), all eleven `scripts/tmp-uiux-*.mjs` harnesses, and
  the stray `docs/uiux-m4-proximity-diagnostic.png`. Product dependencies this run _added for real_
  (`gsap`) stay; nothing in `src/` imported the bare `playwright` package, so removal is inert.
- **Kept, outside the repo:** the harnesses are moved to `../_lh/harnesses/` rather than deleted.
  They are the only record of _how_ each claim was tested, and a juror or teammate may want to
  re-run one; they must not ship in the app. Screenshots and the morning report stay in `docs/`
  because they are the deliverable.
- **Mistake found during teardown:** trimming `_lh/` scratch deleted the JSON behind one cited
  sample (TBT 10ms). No number may outlive its artifact, so the morning report and this status doc
  were re-quoted against the three retained reports only — before 79/404ms/0.28s, pre-fix after
  98/13ms/0.99s, final tree 97/71ms/1.13s — and the variance range is now **97–98 perf, TBT
  13–71ms, SI 0.99–1.13s**.
- **Rule carried forward:** cite-or-keep. Before deleting any measurement artifact, grep the docs
  for the numbers it produced; if a doc quotes one, the file stays (or the doc changes first).
- **Post-teardown gates:** typecheck · `eslint . --max-warnings=0` · `check:tokens` · prettier on
  touched files · `check-secrets --all` · a clean `pnpm build` · routes re-served and checked.
  Production server stopped; dev :3000 left running for the demo. Nothing committed.

## UX-D41 — What ships as evidence and what does not (pre-commit pruning)

- **Q:** committing the run means committing its images. `docs/` held three tiers: the curated
  `uiux-before/` (10) and `uiux-after/` (25) sets, plus 23 loose `uiux-m4-*.png` frames and a
  `uiux-m5/` folder written by the now-deleted verification harnesses — 8.7MB of superseded scratch
  against 8.8MB of curated evidence.
- **Decision:** commit only the curated sets. The m4 frames predate the final tree (the harness wrote
  them mid-milestone, including the misframed showcase attempts) and the m5 set contains `before`
  mode output — exactly the confusing material UX-D37 flagged. Nothing is deleted: both moved to
  `../_lh/interim-captures/` next to the harness sources.
- **Why it matters:** a repo a juror clones should contain evidence a claim can be checked against,
  not every frame a script happened to write. The report's §4 table names the 25 captures that are
  in `docs/uiux-after/`, and that is exactly what is committed.
- **Reverse:** `mv ../_lh/interim-captures/* docs/` if the raw sweep frames are wanted in history.

## UX-D42 — Third-party reference captures stay out of the published tree

- **Q:** the curated `docs/uiux-before/` set contained ten files, but only six are ours. Four are
  screenshots of other people's websites (`lusion-about-01-load.png`, `lusion-projects-01.png`,
  `downbeat-01-hero.png`, `downbeat-02-hscroll.png`). Committing them would put third-party visuals
  — proprietary type, proprietary art direction — into a repo that gets cloned and shipped.
- **Decision:** `docs/uiux-before/` ships six files (`landing-`, `login-`, `signup-` at 1440 and
  375). The four reference captures moved to `../_lh/reference-captures/` and are also in the
  delivered Desktop/Downloads bundle. `docs/uiux-reference-study.md` and the morning report's §1 now
  point at that local folder instead of an in-repo path, and say plainly why it is out-of-tree.
- **Why it matters:** §14 already forbids _copying_ reference assets; committing their screenshots
  is the same violation at lower resolution. The study doc keeps the probe results and the
  technique-level adoption table, which is the actual deliverable — a juror can verify the techniques
  in the shipped code without the repo having to carry someone else's homepage.
- **Reverse:** `cp ../_lh/reference-captures/*.png docs/uiux-before/` to put them back in history.

## UX-D43 — Judging Prettier on a CRLF checkout, and how far to reformat on a push

- **Q:** before pushing, `npx prettier --check .` in this repo reported 315 files. Was the push
  about to break CI's `format` job?
- **What the numbers actually meant:** `core.autocrlf` makes every working-tree file CRLF, and
  Prettier's default `endOfLine` is `lf`, so on this machine a repo-wide check fails on essentially
  every text file regardless of content. The only meaningful check is against **committed blobs**:
  `git show <ref>:<path>` → normalize to LF → `prettier --check`. Run that over all 153 files in
  `cb63530..HEAD` and 38 come back unformatted — 32 of them were already unformatted at
  `cb63530`, so the `format` job is red on pre-existing drift, not on this work.
- **Decision:** fix only what this push is responsible for — the 6 files that were Prettier-clean at
  `cb63530` and arrived dirty, or are new: `src/components/chat/telemetry.tsx`,
  `src/server/lib/ai-usage/pricing.ts`, `src/server/mcp/research-server.ts`,
  `src/components/dashboard/meter-bar.tsx`, `src/lib/chat-model-chain.ts`, `src/lib/spend.test.mts`.
  One `style(ai-usage)` commit, whitespace only, verified by `tsc`, `eslint` and the 42 tests that
  cover those modules. Do **not** run `pnpm format` repo-wide in a push whose brief is "commit and
  push": it would rewrite the lockfile and ~300 files of other people's history into one unreadable
  diff, and the choice of when to do it belongs to the owner.
- **Rule carried forward:** on a Windows checkout, never quote a repo-wide `prettier --check` count
  as a regression — compare blob-level verdicts at the merge base and at HEAD, and report the two
  numbers separately.
- **Harness lesson:** the first two attempts at the comparison reported "0 regressions" because the
  temp-file path keys never matched Prettier's output paths; the mapping was rebuilt so every warn
  line resolves to a real file, and the same script was then made to reproduce known-bad input (the
  6 dirty files) before its verdict was trusted.

---

# AgentOS UI/UX Take 6 — V6 entries (§13 format)

Take 6 runs from `AGENTOS_UIUX_PROMPT_V6.md` (karma.business Line System, Faithful Observed
Edition, 2026-10-11). §13 orders entries appended to `UIUX_DECISION_LOG.md` in the block format
`[V6][Job N] / Where / Why / Evidence / Protected animations checked`. That exact filename does not
exist in this repo; the live analogue is this file (`docs/uiux-decisions-log.md`, the master log
that UX-D1..D43 were appended to), so V6 entries are appended **here** rather than in a fourth
per-take log. Measurements are from this machine only, on the frozen Take-5/M12 artifact served at
`:3300` (`.next-t5`), with `:3100` as the V4 control. The owner's `:3000` dev server was never used
for a measurement and never touched. Zero paid API calls.

### [V6][M1] Ground-truth re-verification of karma.business before building anything from it

```
[V6][M1] Re-measured every §2 claim about karma.business in a real browser instead of trusting
         the brief, and logged four corrections.
Where: harnesses _lh/harnesses5/t6-karma-truth.mjs (pass 1, 10/14 gates),
       _lh/harnesses5/t6-karma-truth2.mjs (pass 2, 6/7 gates),
       report docs/uiux-take6-m1-ground-truth.md
Why:   §2 is the specification the whole build rests on. V6 §12 says only report what was
       verified with evidence paths; a claim the brief asserts but the reference does not show
       would have been faithfully reproduced as a bug.
Evidence: _lh/t6-karma-truth.json, _lh/karma2/stage-02..11-*.png, _lh/karma2/walk-*.png.
       Confirmed: 4 sticky `top-0 h-[100svh] overflow-hidden` stages; the stage canvas is 2D
       (1430x900, `absolute inset-0 size-full`, wrapper 970..5470); exactly 3 stroke colours
       rgb(255,69,0)/rgb(107,78,255)/rgb(255,184,153) at 37/34/29%; stroke runs 13-20 CSS px
       (= 0.97-1.39%vw); no svg spans >50% of the document (so no global line overlay);
       hr-band `paths 3 / ["9px","11px"] / ["0px, 1600px"]`; band `23 paths /
       ["60px","1.6px","0.9px"] / ["2px, 10px","40px, 14px","120px, 30px"]` with firstD
       byte-identical to §7; rays `19 paths / 19 quadratics / ["10px","6px"]` and hubD
       "M720 640Q405.00 640.00 20 640"; Lenis present.
       Corrected: (1) pinned wrapper heights are 500/355/240/200vh, not a 300-500vh range;
       (2) the hero is NOT pinned — only the four mid-page stages are; (3) the arc stack order is
       violet / red-orange / peach, the reverse of §2's description; (4) waypoint family 4 runs
       mirrored relative to §2.3's wording.
       Unknown: §2's karaoke scroll-linkage could not be observed (the detector matched an
       auto-advancing testimonial card whose rect moves under transform, so 0 in-view word reads
       across both passes). Per-word alpha-varying colours do exist. Job 7 will implement the
       prescribed effect without claiming the reference linkage as verified.
Protected animations checked: none yet — M1 is read-only. The BEFORE capture (below) is the
       inventory every later milestone diffs against.
```

### [V6][M1] Where the pinned carousel may sit, given two protected animations in section 5

```
[V6][M1] The §5 pinned stage will be a sibling block OUTSIDE section 5's `${SECTION} relative`
         div, leaving that section's existing markup byte-identical.
Where: target src/components/landing/landing-page.tsx (section 5 PIPELINE, sibling-block pattern
       already used at :313 for HorizontalShowcase); constraints from
       src/lib/motion/use-scrub.ts (progress = y + rect.top - vh*0.9) and
       src/components/motion/strand-trail.tsx (geometry derived from its wrapper's frame.h,
       orbits the sibling h2 via host.parentElement.querySelector).
Why:   `position:sticky` makes `y - from` constant inside the pinned stage, so any useScrub-driven
       animation placed there freezes — that is PipelineDiagram and StrandTrail, both protected by
       §1.2. Wrapping them would silently kill two protected animations to satisfy a layout
       instruction; §5 itself says adapt the NEW code, never disable V4. StrandTrail additionally
       sizes itself from its wrapper height, so a 6x100svh wrapper would distort it.
Evidence: use-scrub.ts freeze derivation; strand-trail.tsx frame.h usage; BEFORE capture
       _lh/t6-before.json (animations 8-56 per depth, sticky 0, fixed 10).
Protected animations checked: StrandTrail (Take4 M8) stays outside the pinned wrapper and keeps its
       own section-relative box; PipelineDiagram (V4) keeps its scrub driver; both re-verified at
       M3 and again item-by-item at M10.
```

### [V6][M1] LineEngine stroke colours come from the three existing --flow-* gradient pairs

```
[V6][M1] §4's three strokes will be painted from AgentOS tokens
         --flow-input-a/b, --flow-route-a/b, --flow-evidence-a/b — zero new colours.
Where: tokens defined at src/app/globals.css:82; consumer will be the new
       src/components/motion/line-engine.tsx (M2).
Why:   §4 forbids karma's colours and §11 requires AgentOS tokens only. Those three pairs already
       carry product meaning (input / route / evidence) and already exist, so the engine maps 1:1
       onto meaning instead of inventing a fourth palette. They also survive the §1.2 deletion:
       the tokens live in globals.css, not in flow-lines.tsx, so removing the V5 overlay cannot
       starve the protected StrandTrail, which reads the same variables.
Evidence: globals.css:82 token block; strand-trail.tsx reads var(--flow-input-a/b),
       var(--flow-route-a); deletion-safety note in docs/uiux-take6-m1-ground-truth.md.
Protected animations checked: StrandTrail colour source confirmed independent of the file §1.2
       authorises deleting.
```

### [V6][M1] BEFORE capture taken from the frozen :3300 artifact, labelled explicitly

```
[V6][M1] 25 labelled BEFORE frames + a per-depth DOM census of the Take-5/M12 artifact.
Where: harness _lh/harnesses5/t6-before.mjs; output _lh/t6-before/ (23 landing wheel depths +
       /login + /dashboard), _lh/t6-before.json.
Why:   §12 requires before-captures of every affected section before any change, and M10's
       no-deletions verification needs a machine-readable baseline rather than a recollection.
Evidence: census docH 14863 / 73 svg paths / 2 canvases / sticky 0 / fixed 10 / animations 8-56
       by depth; mode recorded as BEFORE in the filenames and in the JSON.
Protected animations checked: the census is the checklist M10 walks.
```

### [V6][Job 1 / M2] LineEngine — pure waypoint geometry + canvas renderer

```
[V6][Job 1] Built the reusable line engine: four normalized waypoint families, a staggered
       morph, a scroll-velocity fading tail, and a DPR-aware Canvas 2D renderer that idles to
       zero frames.
Where: src/lib/motion/line-shapes.ts (geometry, DOM-free: sampleShape / morphSamples / headAt /
       tailAlpha / shapeForStep), src/components/motion/line-engine.tsx (renderer + imperative
       setProgress/setStepIndex contract), src/lib/motion/line-shapes.test.mts (13 cases).
Why:   §3 row 1 maps karma's canvas 3-line centerpiece onto the pipeline explainer, and §4 fixes
       the contract. Splitting geometry from renderer is what makes the morph unit-verifiable in
       node — §12 demands measured evidence, and a parametric curve sampled into a fixed-length
       Float32Array can be asserted on exactly, while a canvas can only be asserted on
       statistically. Fixed sample count (60) is what allows 1:1 interpolation with no
       resampling, i.e. glide rather than teleport (§2.2).
       Colours are the three existing --flow-* token pairs read via getComputedStyle at mount;
       the file contains no colour literal at all, so §11's "AgentOS tokens only" is structural
       rather than a review promise. Stroke width is clamp(6px, 1.2vw, 14px) computed per resize.
       The rAF loop is demand-driven (input, morph in flight, or velocity decaying) and is
       cancelled by IntersectionObserver off-screen and by visibilitychange; the tail is painted
       as 18 alpha-quantised chunks per line rather than one stroke per sample, so a frame is
       <=54 short strokes.
Evidence: 13/13 unit tests pass
       (node --import ./scripts/register-ts.mjs --test src/lib/motion/line-shapes.test.mts);
       tsc --noEmit clean; eslint --max-warnings=0 clean; prettier --check clean.
       Non-vacuity proven by mutation: setting the morph stagger to 0 fails "the morph is
       staggered"; freezing headAt to a constant fails "head position glides with progress".
       Both mutations were reverted and the file diffed against its pre-mutation copy.
       Built-in negative controls: stagger=0 must interpolate to exact midpoints (contrast case
       for the stagger assertion), and shapeForStep over steps 0-5 must yield exactly 4 distinct
       families (contrast case for the cyclic-reuse assertion).
       NOT yet evidenced at M2: canvas pixels. The engine is not mounted anywhere until M3, so
       the renderer's paint output is verified there with named gates — three distinct token
       colours in a pixel census, a census delta between two step indices at equal progress
       (the morph), a tail alpha ramp, and a static reduced-motion paint.
Self-review fix before shipping: the first version made kick() a no-op under
       prefers-reduced-motion, so a step change would never repaint the static terminal shape
       §4 requires. Reduced motion now repaints synchronously on input and on becoming visible.
Protected animations checked: M2 adds two new files and modifies none. FlowLines, StrandTrail,
       PipelineDiagram, v5-layers and the WebGL hero were not read-only-verified at this
       milestone because nothing they depend on changed; M3 (which deletes the §1.2 overlay and
       mounts the stage) re-verifies each of them.
Logged, not fixed here: scripts/check-design-tokens.mjs reports two PRE-EXISTING raw hex values
       in Take-5 code — src/components/motion/cursor-field.tsx:85 (#5b7cfa fallback) and :86
       (#8a93a8, which matches no token in globals.css). Neither is V6's, and cursor-field is a
       protected animation, so the colour source is not being changed mid-milestone; it is
       scheduled for the M8 consistency audit.
```

```
[V6][Job 2 / M3] Pinned pipeline carousel mounted as a SIBLING of section 5, and the §1.2
overlay removal verified by path conservation rather than by a count threshold.
Where:   src/components/landing/pipeline-stage.tsx (new, 600svh wrapper + sticky 100svh stage:
       LineEngine canvas, five step copies from STAGES, dots, 01/05 counter, heading marquee);
       src/components/landing/landing-page.tsx:158 the <FlowLines /> mount replaced by a §1.2
       comment, :286 <PipelineStage heading={PIPELINE_TITLE} /> inserted after section 5;
       src/app/globals.css dead V5 §3 flow CSS deleted, .v6-marquee + @keyframes v6-marquee added;
       _lh/take5-archive/flow-lines.tsx (26,885 bytes MOVED out of src/, not deleted);
       harness _lh/harnesses6/t6-m3-stage.mjs, evidence _lh/t6-m3.json + _lh/t6-m3/ (7 png).
Why:   §5 asks for karma's per-section pin, but two protected animations cannot live inside one:
       useScrub computes `from = y + rect.top - vh*0.9`, which is CONSTANT under position:sticky,
       so the scrubbed PipelineDiagram would freeze mid-draw, and StrandTrail sizes its geometry
       from its wrapper's height, so a 600svh wrapper would stretch it. Both stay exactly where
       they were and the carousel gets its own scroll budget; §5's "adapt the NEW code, never
       disable V4" is satisfied structurally, not by a flag.
Evidence: 22/22 named gates on the :3400 artifact (hardware ANGLE, Intel Iris Xe D3D11), trusted
       page.mouse.wheel input throughout. Pin proven by geometry, not by a screenshot: stage
       rect.top = 0,0,0,0,0 px while its wrapper travels 3731px, wrapper 5400px = 6.0x vh.
       Step walk: counter 01/05..05/05 and aria-current 0..4 track floor(p*5) exactly; exactly one
       32px dot at the active index; opacity 1/0/0/0/0 rotates through the five slots; copy is the
       pipeline's own five labels. Canvas: buffer 1440x900 = css x dpr, ink 2414/2030/2230/2631/
       2575, and a 24x14 occupancy signature that changes by 17/36/33/28 cells at every step
       boundary (the morph, in pixels — M2's deferred evidence). Colour provenance: 22/26 census
       buckets land within 0.14 of a --flow-* token and ZERO within 0.14 of karma's three stroke
       colours. Reduced motion (separate context): sticky 0, five labels readable in flow, zero
       dimmed items, static canvas ink 50146, docH 13943 vs 20263. Zero LLM-endpoint requests.
       §1.2 removal: 48 of the V5 artifact's 73 svg paths belonged to the fixed+mix-blend-screen
       overlay root (measured on the frozen :3300 artifact by t6-pathcount.mjs); the new artifact
       carries exactly 73-48 = 25 with 0 inside any overlay root, so nothing outside the
       authorised one was lost. fixed+screen roots now 0.
Two measurement failures logged, both fixed by changing the MEASUREMENT, not the product:
       (1) the marquee velocity gate first read 34s everywhere. Cause A: it sampled a settled
       scroll, where a velocity-reactive property has legitimately already decayed; fixed by an
       in-page rAF probe during live wheel input, slow arm (wheel 40px/220ms, peak ~400px/s) vs
       fast arm (900px/30ms, peak ~11,300px/s, t6-m3-diag.mjs). Cause B was a REAL PRODUCT BUG
       the gate exposed: the speed accumulator added a new sample every frame while decaying by
       0.92 every frame, which converges to ~12x the true px/s, so every arm pinned to the top
       bucket. Replaced with peak-hold; buckets now 300/1100/2600 px/s. Result 22s slow / 9s fast
       / 34s idle, 3/3 rounds.
       (2) the fading-tail gate was flaky (2.9x, then 0.84x on unchanged code) because each arm
       crossed three step changes (mid-morph frames are partly lit) and sampled "after arrival",
       which is not a fixed instant relative to the last wheel. Rebuilt as a paired burst: same
       start, same 400px, same 8x50px events, same step, only the gap differs, censused INSIDE the
       burst. Now fast>slow in 3/3 rounds, median ratio 1.225.
Protected animations checked: StrandTrail dash offsets sweep 1.00/1.00/1.00 across 6 depths of
       section 5; PipelineDiagram edge dashoffsets sweep 57.5px (its full edge length) across the
       same sweep; v5-grid present; hero WebGL canvas present and mounting a 2d-inert context;
       svg path conservation as above. The first version of these gates read 0,0,0 / [] because
       its selector matched the removed overlay's own 48-path svg and both scrubs sit undrawn
       outside their own window — selectors now key off what drawProps writes (pathLength=1,
       stroke-dasharray on a small svg) and off the diagram's `0 0 1064` viewBox.
Also: pipeline.tsx exports Stage/STAGES so the carousel renders the same five stages from one
       source of truth (no new copy, §11); the horizontal-showcase track keeps its z-[7] with a
       comment explaining it is stacking order against its own section, not a leftover of the
       removed overlay, so changing it would be an unmeasured edit to a protected animation.
Still open for M9: fps cost of the added rAF + canvas and LCP on the new 20,263px document.
```

```text
[V6][Job 3 / M4] hr-band draw-on dividers
Where       NEW src/components/landing/hr-band.tsx (153 lines): LANES :42, lanePath :50,
            IntersectionObserver re-arm :70, 12vh host :91, comet dasharray/offset :130-146.
            Mounted in src/components/landing/landing-page.tsx at :265 (manifesto->pipeline),
            :364 (decision bus->evidence), :422 (models->architecture), :487 (benchmarks->faq);
            import :11, boundary rationale comment :259.
            Harness ../_lh/harnesses6/t6-m4-hrband.mjs, evidence ../_lh/t6-m4.json +
            ../_lh/t6-m4/ (7 pngs: mid-flight pair, reduced band pair, reduced band-hidden control).
Why         §3 maps karma's divider to "a signal passing under each heading as you travel the
            page". The measured karma DOM (_lh/t6-karma-truth.json, M1 ground truth) is one svg
            viewBox "0 0 1320 420", 3 paths at 9/9/11, stroke-dasharray "0px, 1600px", 3
            gradients, class "pointer-events-none absolute inset-0 size-full opacity-80", and an
            EMPTY d filled by JS at runtime. Reproduced the shape, authored the geometry myself
            (three S-curves at different heights/amplitudes/phases so the band reads as depth,
            not one line drawn three times), and used karma's mechanism: one short lit dash on an
            otherwise-gap path, dashoffset transitioned on viewport entry. Two deliberate
            departures, both documented in the file header: the dash is 6x the stroke width
            instead of 0px (a zero-length dash only paints if the renderer honours round caps on
            empty dashes; a comet slightly longer than wide is the same gesture with no
            dependency on that edge case), and each lane keeps its faint guide path at 0.16
            opacity (additive per §1.1 - an invisible guide would make a resting divider read as
            nothing but a stray blob). Max 1 strip per boundary and every strip sits OUTSIDE the
            sections it separates, so no strip can overlap a V4/V5 wipe that already owns an edge
            (§6). Four of fifteen boundaries carry one; the pinned carousel, the horizontal
            showcase and the CTA (CursorField) were skipped as already-transitioned.
Evidence    17/17 gates on the shipping artifact (:3400, hardware ANGLE, trusted mouse wheel).
            Shape: 4 strips at doc tops 1416/14860/16428/18402 (all distinct, so one per
            boundary), each 3 comets + 3 guides + 3 gradients, widths 9/9/11, pathLength 1600,
            d authored from "M -60 ...", dasharray "54px, 1600px / 54px / 66px"; host 1440px wide,
            108px = 0.12vh tall, aria-hidden, pointer-events none, svg exactly filling it; zero
            heading-box collisions; scrollWidth 1440 == innerWidth 1440.
            Draw-on (the gate that can fail): a per-rAF trace of computed stroke-dashoffset while
            the strip is wheel-scrolled in gave 157 frames, 56 strictly rising, per-lane maxima
            1546/1546/1534, which is the analytically expected terminal (pathLength - dash) to
            0px error - a frozen divider gives 0 and a wrong-signed offset gives a wrap.
            Stagger: 23 mid-flight samples with a max lane spread of 1276px (0 would mean one
            shared offset, i.e. no 0/150/300ms delays); computed transitions are
            "stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)" with 0 / 0.15s / 0.3s on the
            three lanes, and the four control points were compared NUMERICALLY against the page's
            own --ease-expo token (cubic-bezier(.16,1,.3,1)), not against a typed curve.
            It actually paints: two PNGs of the strip 240ms apart mid-flight differ.
            Re-arm: driven out of view the offsets return to 0,0,0 and a second wheel-in sweeps
            to 1546 again - so this is scroll-triggered per pass, not a one-shot that only looks
            right the first time.
            Colour provenance: all 24 stops are DECLARED as var(--flow-*-*) and resolve to the six
            AgentOS flow tokens (max distance 0.0; e.g. var(--flow-input-a) -> rgb(91,124,250));
            no karma hex appears in hr-band.tsx.
            Reduced motion (separate context, scrolled to the strip): offsets render the terminal
            shape immediately (1546/1546/1534), every parsed transition duration is 1e-06s, and
            two clips 900ms apart are byte-identical - with the positive control that the same
            clip with the hosts visibility:hidden DIFFERS, so "identical" cannot be the blank-page
            artifact (the probe writes the style back and re-asserts visibility).
            Regression: svg path conservation now 49 = 25 (M3 baseline) + 4*6 new; M3's own suite
            re-run against this artifact is 22/22 again, including the protected StrandTrail and
            PipelineDiagram scrub sweeps and the reduced-motion carousel (docH 14375 vs 20695).
            docH grew 20263 -> 20695, exactly 4 x 108px. Zero paid/provider requests across both
            runs.
Failures    Two, found before shipping. (1) The first draft read its duration from a CSS property
            --t-band-runtime-css that nothing set, while its header claimed landing-page.tsx
            supplied it from the benchmark numbers. Checked the real data (BENCH latency in
            landing-page.tsx:126 is 8.4-75.8 SECONDS, fmtLatency renders it as such): wiring it
            would either be a 75-second divider or an invented mapping, so the claim and the read
            were both removed and §6's prescribed 1.2s / 0.15s stagger used. A comment that
            describes code which does not exist is a defect even when the render is fine.
            (2) My karma-colour proximity gate (distance > 60) was wrong by construction: it
            would have failed the product for using its own accent violet, which is legitimately
            37.3 away from karma's violet. Restated as what §8/M8 actually bans - no stop may
            RESOLVE to a karma value (distance > 24 vs 0 for an exact match) and no karma hex may
            appear in the source - which is the value-level rule, not a hue-distance wish.
Protected   §1.1 audited before writing: the divider is a new sibling block in normal flow, no
animations  existing element was restyled, no scroll listener was added (the strip uses its own
            IntersectionObserver on its own host), no state is shared with the carousel. Strand
            Trail, PipelineDiagram, V5Layers, hero WebGL and the whole M3 carousel were re-verify
            ing by re-running the M3 suite on this artifact rather than assumed - and that re-run
            is what exposed that M3's strand selector was matching the new strips, a harness bug
            fixed by excluding the 1320x420 viewBox (strand dash spread 0.00 -> live again).
Still open  M9 must re-measure fps and LCP on the 20,695px document with four more animated
            elements in the scroll path.
```

```text
[V6][Job 4 / M5] cable bundle behind the benchmark cards
Where       NEW src/components/landing/cable-bundle.tsx (120 lines): header notes :10-17,
            TRUNK_D :21, RHYTHMS :24, MARCH_UNITS :30, MARCH_SECONDS :32, PAIRS :34,
            SATELLITES fan :40-56, useScrub(0.9) + trunk slice :59-60, z-0 host :63-67,
            3 gradients :75-80, trunk draw-on :84-93, 22 marching satellites :95-116.
            src/app/globals.css: .v6-march loop :1627-1629, @keyframes v6-march :1631-1635
            (travels var(--v6-march-units), default -2700px).
            Mounted in src/components/landing/landing-page.tsx: import :12, section
            #benchmarks :441-442 (already position:relative), <CableBundle /> :444 as the
            section's FIRST child, content wrapper gains "relative z-10" :445.
            Harness ../_lh/harnesses6/t6-m5-bundle.mjs, evidence ../_lh/t6-m5.json +
            ../_lh/t6-m5/ (bundle-lit.png, reduced-1/2.png).
Why         §7 asks for karma's bundle behind the darkest section's cards: one fat gradient
            trunk plus thin dashed satellites, drawn on by scroll and marching on a loop.
            The trunk d is karma's measured path string reproduced byte-for-byte in a
            const - authored in source, not filled at runtime as karma does, so the shape
            is reviewable and the draw gate has something fixed to compare against. The
            22 satellites are that same d under a translate, so the fan is a genuine bundle
            (threads that follow the cable) rather than 22 unrelated curves; the fan offsets
            run mostly horizontal (dx -64..+64) with only dy +96..-96, because the cable
            enters bottom-left and exits top-right and a pure vertical offset would stack
            the strands into a wall. Group membership is i%3 and speed is per group
            (9s/21s/46s per 2700 units), which is what makes the fine threads read as
            nearer than the coarse ones. Rhythm dasharrays are karma's 2/10, 40/14,
            120/30. The march must travel a multiple of every period or the loop snaps the
            dashes at the seam: LCM(12, 54, 150) = 2700, so 2700 units is the travel and
            each cycle ends in the phase it started in.
            Scroll reveal is split by role, not duplicated: the trunk rides stroke-dashoffset
            (pathLength=1, offset 1-p) because nothing else writes its offset, while the
            satellites ride stroke-opacity (0.1 -> 0.44) because their dashoffset belongs to
            the march loop. A strand cannot be scrub-drawn and marched at once - the loop
            would overwrite the reveal every frame - which is why the reveal moved to
            opacity here and why the trunk is the only element that does both.
Evidence    15/15 gates on the shipping artifact (:3400, hardware ANGLE, trusted wheel).
            Shape: exactly 1 svg with viewBox "0 0 1440 720", host absolute inset-0 z-0
            overflow-hidden pointer-events-none aria-hidden, #benchmarks at doc top 17344,
            height 1058; document height 20695 == M4's, because the bundle is out of flow.
            Trunk: d identical to §7's measured string, stroke-width 60, stroke-opacity
            0.16 (inside 12-18%). Satellites: 22 of them in groups of 8/7/7 with dasharrays
            "2 10" / "40 14" / "120 30", widths 1.00/1.18/1.36/1.54/1.72, every one carrying
            the trunk d under a translate(...) and animation-name v6-march, at three distinct
            durations 9s/21s/46s.
            Scroll draws it: at rest 300px above the scrub start the trunk offset is 1.000,
            and a 234-frame per-rAF trace during 26 wheel notches gives 1 -> 0 with ZERO
            backwards steps while scrollY ran 16380 -> 19739; the satellites' opacity goes
            0.1 -> 0.44 with a max mid-scroll lane spread of 0.108 (all-equal would mean the
            reveal is one shared switch, not a staggered fill).
            The loop marches without scroll: with scrollY spread measured at 0px over 3.0s of
            stillness, computed stroke-dashoffset travelled 2690.0 / 385.6 / 176.0 px in the
            three groups - a dead loop reads 0, and 2690 is one 2700-unit cycle crossing its
            seam mid-window, which is the phase-invariance the LCM was chosen for. Control in
            the same svg: the scrub-driven trunk moved 0.00px over that window, so the
            recorder is measuring the march and not reading its own noise.
            Stacking: host absolute z0 pointer-events none, content wrapper relative z10,
            elementFromPoint over a real <td> centre -> that td; positive control on the same
            node (host pointer-events auto + z-index 30) makes the identical point answer as
            the svg, and after the probe the point answers as the td again with no inline
            style left behind, so the lift-the-bundle test is what makes "the cell won" mean
            something. Colours: 3 gradients, 6 stops all DECLARED var(--flow-*-*) and
            resolving to the AgentOS flow tokens (e.g. var(--flow-input-a) ->
            rgb(91,124,250)); byte-search of cable-bundle.tsx finds no karma hex
            (ff4500/6b4eff/ffb899).
            Reduced motion (own context, driven to the section): trunk offset 0, every strand
            at full light 0.44, march durations 1e-06s, and the animated property itself is
            still - 0.000px of dashoffset travel across all 22 strands over the same 3.0s
            window (181 frames) in which the normal arm moved 2690px - plus two 1440x900
            clips 900ms apart that are byte-identical. The reduced document is 14375px tall
            (the pinned carousel collapses), 6320px shorter than the animated one.
            Regression: svg path conservation 91 = M4's 49 + 23 bundle paths + 19 ray-burst
            spokes (the gate subtracts the burst so §1.3's own "= 72" claim for this bundle
            still reads true); zero paid/provider requests; scrollWidth 1440 == innerWidth 1440.
Failures    Six, all in the harness or the design, none shipped silently.
            (1) The collector referenced the Node-side TRUNK_D const, which blew up as
            ReferenceError in the page: a serialised function closes over nothing. Fixed by
            passing TRUNK_D as page.evaluate's argument - the alternative (duplicating the
            string in the collector) would let the two copies drift apart silently.
            (2) The stacking gate read sec.querySelector("div"), which is the bundle's own
            host - the section's first div - so it would have reported the bundle as the
            content wrapper. Fixed by picking the section child that is not the host.
            (3) The same gate ran its hit-test at scroll 0, where the table is far below the
            viewport and elementFromPoint legitimately answers null; it now has its own
            position (first cell parked mid-viewport) and an in-view precondition that fails
            loudly instead of silently.
            (4) The trunk draw gate FAILED on the second run, not from a product bug: Lenis
            keeps gliding after the last wheel event, so between the seek and the first
            recorded frame the page crossed the scrub start and the trace began at 0.876
            instead of 1. seekTo now polls until scrollY is at rest before returning, and the
            gate's predicates were left exactly as written - a measurement race, not a
            loosened threshold.
            (5) The reduced arm reused the animated page's section doc top (17344), but the
            reduced document is only 14375px tall, so the seek bottomed out at max scroll and
            the clip computed a negative height. It now measures its own target in its own
            context.
            (6) After M6 landed, the march gate FAILED while the dashes were demonstrably
            alive: its >25-frames-per-1.2s floor was really an fps assertion, and the same
            as-is arm records 22..61 frames per 1.2s depending on momentary machine load.
            Rather than lower the number to make the run go green, the two claims were
            separated: the window is now 3.0s, the floor is a liveness check, the observed
            cadence is printed but not asserted, a scrub-driven trunk control (0.00px) was
            ADDED so a PASS cannot come from noise, and the §11 fps budget stays where it
            belongs - M9's dedicated 4x-throttled probe. Attribution was measured, not
            assumed: ../_lh/harnesses6/t6-m5-idle-diag.mjs ran 5 interleaved rounds of
            as-is / burst-hidden / burst-restored at this scroll position (44.8 / 38.4 /
            45.4 mean frames) and the burst is at visibility 0.000 there, so the drop is
            machine load, not M6.
            Design correction from the owner mid-flight: the first draft split the 22 into 11
            scroll-runners + 11 marchers, which contradicts §7's count of 22 MARCHING
            satellites. All 22 now march and the reveal moved onto stroke-opacity; §7's count
            and the harness ids are unchanged.
Protected   §1.1 audited before writing: the bundle is a new absolutely-positioned sibling
animations  inside a section that was already position:relative; no existing element was
            restyled, no class removed, no listener added (it reuses the existing useScrub
            hook, and adds no new scroll handler beyond the one per host it already
            implements). The cards keep z-10 so nothing in the table can be covered. The
            benchmarks section's own motion (BenchChart grow, the table's curtain reveal,
            CursorField, the CTA) was untouched, and both earlier suites were RE-RUN against
            this artifact rather than assumed: M3 22/22 (its conservation now counts
            +BUNDLE_PATHS=23; its strand selector already ignores the bundle because the
            bundle svg carries 23 paths against the selector's <=12 cap) and M4 17/17 (its
            conservation subtracts the bundle so the gate's own "= 49" claim still reads
            true). Both were run a third time after M6 added 19 more paths, with the gate
            labels byte-preserved and only the arithmetic extended.
Still open  M9 must measure the fps cost of 22 CSS-composited dashoffset loops running
            regardless of section visibility (a .v6-march element off-screen still animates),
            plus LCP on the 20,695px document. If the cost is real, the fix is NEW code that
            scopes the loop (e.g. animation-play-state gated by the host's own
            IntersectionObserver), never a reduction of the effect.
```

```text
[V6][Job 5 / M6] karma's ray hub burst behind Models & routing
Where       NEW src/components/landing/ray-burst.tsx (182 lines): header notes :11-22,
            HUB_X/HUB_Y :24-25, viewBox size :26-27, DRAW_MS/STAGGER_MS :28-29,
            RayGroup :31-35, FAMILY (4 visual families: width band, radius ring, token
            pair) :38-43, PHI_MIN/PHI_MAX :45-46, spokePath :48-60, component :62,
            lit state :65, re-arming IntersectionObserver :68-82 (threshold 0.3,
            rootMargin :78), total :84, deterministic fan :88-101, host div :105-107
            (absolute inset-0 z-0 overflow-hidden pointer-events-none aria-hidden),
            svg :110-113 (viewBox 0 0 1440 680, xMidYMax slice), 4 linear gradients +
            hub radial :116-125, 19 ray paths :128-147 (pathLength 1 :136, dasharray 1
            :137, offset 1->0 + transition :140-143), 19 endpoint circles :148-164
            (+260ms opacity), hub group :167-178 (halo r86 / ring r34 / core r9).
            src/app/globals.css: .v6-hub :1640-1645 (transform-box fill-box, origin
            center, 5.5s var(--ease-expo) infinite, will-change transform),
            @keyframes v6-hub-pulse :1647+ (scale 1 -> 1.04 + opacity .72 -> 1).
            Mounted in src/components/landing/landing-page.tsx: import :13, RAY_GROUPS
            :131-136, section + <RayBurst groups={RAY_GROUPS}/> :415, content wrapper
            gains relative z-10 :416, the stacking rationale is the comment :411-414.
            Harness ../_lh/harnesses6/t6-m6-rays.mjs (17 gates) + attribution probe
            ../_lh/harnesses6/t6-m5-idle-diag.mjs; evidence ../_lh/t6-m6.json and
            ../_lh/t6-m6/ (burst-lit.png, reduced-lit-1/2.png, reduced-burst-hidden.png).
Why         §8 wants karma's hub-and-spoke burst as a backdrop for the routing section.
            The spoke COUNT is not chosen for looks: the caller passes the lengths of
            four real product arrays - AGENT_ROLES 5 (src/lib/decisions/types.ts:99),
            TASK_TYPES 6 (:86), the model-route list FAMILIES+1 = 4 (landing-page.tsx:118,
            :134), COMPLEXITY_TIERS 4 (types.ts:91) - so 19 rays is the orchestra's
            vocabulary drawn as geometry, and each array gets its own visual family
            (width band, radius ring, gradient pair) rather than 19 identical lines.
            DEVIATION, stated rather than papered over: §8 also lists "MCP-tool nodes",
            but the repo registers only two MCP tools, so enumerating them would have
            made the burst a picture of a number that is not in the product. The burst
            is text-free and aria-hidden for the same reason - §11 forbids invented copy
            and §8 wants the hub to be an existing product element, so the hub's identity
            comes from the ModelRoutes list the rays point at, not from a label.
            Only the two non-obvious facts are in code: each path is authored hub-first,
            so dashoffset 1 -> 0 GROWS outward (a node-first path would reveal inward,
            the opposite gesture); and the fan is computed from indices with no
            Math.random, because the server and the client must render identical markup.
            A deterministic 26-unit radius wobble (fam.r + 26*sin(i*2.3)) keeps the ring
            from looking machined without needing randomness.
Evidence    17/17 gates on the shipping artifact (:3400, hardware ANGLE, trusted wheel).
            New, not inherited: the frozen V5 BEFORE (:3300) has burst count 0 with 73 svg
            paths and a 14863px document; :3400 reads 91 paths.
            Shape: exactly 1 svg with viewBox "0 0 1440 680"; all 19 paths are quadratic
            and every attrD begins "M 720 640" (startsHub 19/19); widths 10/9/7/6 counted
            5/6/4/4 - inside §8's 6-10px band, and the counts are the arrays above;
            endpoints span x 300.8 -> 1219.7 with the highest y 108.6, all above the hub
            line y=640 and all inside the box, so the fan genuinely covers the upper half
            and reaches both flanks.
            Mechanism: pathLength 1 + stroke-dasharray 1 + a transition whose animated
            property is stroke-dashoffset at 1.1s with cubic-bezier(0.16,1,0.3,1), which
            is compared NUMERICALLY against the resolved --ease-expo, for all 19; delays
            0 -> 0.81s ascending in exact 45ms steps in ray order.
            It grows with the wheel: host visibility -0.001 -> 0.763 across a trusted-wheel
            pass 14687 -> 15788, 265 per-rAF frames; every ray starts above 0.99 and lands
            at 0 (19/19 lit), max mid-flight spread 0.997 (0 would mean one shared draw),
            ZERO frames where any ray moved backwards, and the frame at which each ray
            reaches 0 is monotonic in ray order (first finishes at frame 53, last at 102).
            The hub pulses on the compositor only: animation-name v6-hub-pulse at 5.5s,
            keyframes animate exactly {opacity, transform} (the effect's bookkeeping keys
            offset/computedOffset/easing/composite are excluded before the set is read),
            231 distinct matrices sampled, scale 1.00891 -> 1.00013 over the window - while
            in the same window the section box (top -199.78, height 839.63), the host box
            (1440x838.63) and the svg box (1440x839) do not move by a fraction of a px.
            A model row could not be used as the witness because .route-breathe legitimately
            scales it; the unmoved boxes are the proof.
            Stacking + hit-testing: host absolute z-0 pointer-events-none aria-hidden,
            wrapper relative z-10; elementFromPoint at a real model row's centre answers a
            span inside that row. Positive control on the same point: making the host
            interactive ALONE still answers the row (pointer-events cannot beat a z-10
            sibling - only z-order can), lifting the host to z-50 answers the svg, and
            after restore the point answers the row again with pointer-events none, z 0 and
            no inline style left behind.
            Coexistence (§1.3): the routing animation the section already owned is
            element-for-element what :3300 shows - rows 4, accent lines 4, tracks 5,
            packets 4, glows 1, live rows 1, laid-out nodes 9, stack height 240px, and the
            four route-* names present on 7 elements in BOTH builds; none of them is inside
            the burst host. Zero invented copy: the burst host's own text length is 0.
            Colours: 4 gradients, 10 stops all declared var(--flow-*-*) and resolving to
            the AgentOS tokens (e.g. var(--flow-input-a) -> rgb(91,124,250)); no karma
            orange/indigo hex anywhere in ray-burst.tsx.
            Re-arm: scrolling past the section returns all 19 offsets to 1 (measured at
            scrollY 19739) and re-entering draws them back to 0 (scrollY 15719, dots lit
            0.5 x19) - the burst redraws on every pass, it is not a one-shot.
            No layout damage: document 20639px, section 839.63px, content wrapper
            1152x614.63 are identical with the host shown, display:none and restored, so
            the burst is out of flow; and the load-time document (20695px) equals the M5
            artifact's 20695px.
            Reduced motion (own context): 19 rays finished at offset 0, durations read
            1e-06s, endpoint dots at 0.5, 22 circles present (19 dots + 3 hub), two clips
            900ms apart byte-identical - and the hide-the-burst control produces a
            DIFFERENT clip, which is what makes those pixels attributable to the burst
            rather than to a page that would look the same without it.
            §11 budgets: 0 paid/provider requests of 29; scrollWidth 1440 == innerWidth.
            Regressions RE-RUN against this artifact, gate labels byte-preserved and only
            the arithmetic extended: M3 22/22 (conservation 25 + 24 + 23 + 19 = 91), M4
            17/17 (subtracts the burst so its "= 49" still reads true), M5 15/15.
Failures    Nine, every one of them in the harness or the expectation, none in the product.
            (1) sameBez was handed a raw ease string and threw "a.every is not a function";
            both sides are now parsed before comparing.
            (2) Gate 1 reported "begins with M 720 640 = false" because the collector
            truncated d to 12 chars ("M 720 640 Q") and compared with ===. The collector
            now returns the whole string and the gate uses startsWith - the assertion got
            stronger, not weaker.
            (3) Hoisting ENV for the BEFORE arm left a duplicate const ENV; caught at load.
            (4) v4.animated read 0 at scroll 0 and looked like a broken V4 animation. It is
            not: .route-breathe is applied only while the stack is in view, and the first
            probe also demanded stroke-dasharray, which model-routes.tsx never uses. The
            expectation was wrong, so it was replaced by an in-view element census compared
            against :3300 - not by loosening a real measurement.
            (5) The draw-on gate FAILED (0/19 lit, 46 backwards frames) because an open-loop
            pile of wheel events overshot the section, so the trace caught the burst drawing
            AND retracting. Fixed by entering on intersection ratio (seekRatio 0.95) after
            letting Lenis come to rest; the same edit added the motion-derived finish-order
            predicate, so the gate is now harder to pass than the one that failed.
            (6) The hub-pulse gate FAILED on "composite, opacity, transform": getKeyframes
            carries a composite bookkeeping key, which is not an animated property. Excluded
            at the source of the scan rather than by accepting a wider set.
            (7) The stacking control FAILED (isHost=false with pointer-events forced) - the
            CONTROL was wrong, the product was right: a z-0 element cannot win a hit-test
            against a z-10 sibling by pointer-events alone. Rebuilt as pe-only, then z-lift,
            then restore-and-re-read.
            (8) The layout gate FAILED at 20695 vs M5's 20639 - two different SCROLL PHASES
            of the same document, not a regression. Replaced with an in-page shown/hidden/
            restored measurement plus a load-phase equality against M5; a vacuous
            totalPaths > 0 predicate that had been added to pad the diff was deleted.
            (9) The reduced arm asserted dots === 19 and found 22, because the hub is three
            circles. Fixed to SPOKES + 3 with the dots read from a slice, keeping the count
            exact instead of switching to an inequality.
Protected   §1.1 audited before writing: the burst is a new absolutely-positioned sibling
animations  inside a section that was already relative; nothing existing was restyled, no
            class or listener was removed, and the section's own V4 motion (scrub-driven
            route lines, packets, the 3s routing cadence, node glow, landing flash) is
            counted element-for-element against the frozen V5 build rather than asserted.
            §1.2 was NOT invoked here - the only authorised deletion remains M3's page-wide
            V5 overlay. The three earlier suites were re-run against this artifact and all
            three are green, with their conservation arithmetic extended to 91 paths.
Still open  M9 must measure what the burst costs: the 19 dashoffset transitions and the
            5.5s hub pulse keep running whenever the section has been entered once, next to
            M5's 22 .v6-march loops. Attribution was measured, not guessed - at the
            benchmarks position the burst sits at visibility 0.000 and contributes exactly
            one running animation, and hiding it moved the idle cadence by less than the
            run-to-run spread (means 44.8 / 38.4 / 45.4 frames per 1.2s over 5 interleaved
            rounds). LCP on the 20,695px document is the other half. Any fix is NEW code
            that scopes the loop (animation-play-state gated by the host's own
            IntersectionObserver), never a reduction of the effect.
```

```text
[V6][Job 6 / M7] karma's blueprint ornaments on section frames and card corners
Where       NEW src/components/landing/blueprint-marks.tsx (313 lines): header notes the
            two non-obvious rules :7-25, geometry constants ARM/TICK/TILE/CROSS/DRAW_MS
            :27-31, useBox's ResizeObserver :34-57, corner() :59-62 (an L from two 26px
            arms), brackets() :64-73 (four, clockwise), BlueprintFrame :75-215 — host
            :104-109 (data-t6="blueprint-frame", absolute inset-0 overflow-hidden
            pointer-events-none, aria-hidden), the viewBox-less svg :110, the 4 bracket
            paths :112-135 (strokeOpacity 0.42, pathLength 1, dasharray 1, offset 1→0 on
            a 620ms var(--ease-expo) transition delayed i*70ms), 10 top/bottom edge ticks
            :138-153 at 0.3, the left tick column + crosshair :156-178 (group 0.3, inner
            pair 0.38, ring 0.3), the dotted patch :181-210 (strokeDasharray "1 1", 0.26,
            22px pitch, gridAt 'bl'|'br'); BlueprintCorners :226-313 — host
            data-t6="blueprint-card" :235, two 14x14 brackets :238-275 ("M9.5 1H1V9.5" at
            90ms, "M4.5 13H13V4.5" at 160ms, strokeOpacity 0.45) and the 8x8 crosshair
            :278-295, which arrives on opacity at 240ms instead of on a dash offset.
            Mounted in src/components/landing/landing-page.tsx: import :14, hero frame
            :216, one corner set per capability card :344 (8 cards, first child of the
            card's own p-5 relative box), evidence-band frame :408 with threshold 0.2.
            Harnesses ../_lh/harnesses6/t6-m7a-blueprint.mjs (12 gates) and the
            root-cause probe ../_lh/harnesses6/t6-m7a-diag.mjs; evidence
            ../_lh/t6-m7a.json and ../_lh/t6-m7a/01-hero-frame.png,
            02-band-frame-lit.png, 03-reduced.png, 04-reduced-hidden.png.
Why         §9 wants corner brackets, crosshairs, tick marks and dotted grids at 25-45%
            opacity in the brand accent, as "engineering detail, not clutter". The two
            things that could not be read off the brief and are documented in the file
            header: the frame svg deliberately has NO viewBox, because inside a scaled
            viewBox a "1 1" dash scales with the drawing — a 100-unit box stretched to
            1440px would paint 14px dots, i.e. a carpet — whereas laid out in CSS px
            against a ResizeObserver-measured box it is a literal 1px dot; and only the
            brackets are paths and only they draw on, because the ticks, crosshairs and
            grid are already dashed, so animating their offset would shimmer rather than
            reveal. The card ornament is 14px placed in a 4px corner offset because the
            card's own padding is 20px: the marks live inside the padding band and the
            content lives outside it, which makes "not clutter" structural instead of a
            measurement that could regress with the next copy change. The corner set is
            authored in a fixed 14x14 box so it needs no measurement and cannot overflow.
Evidence    12/12 gates on the shipping artifact (:3400, hardware ANGLE, trusted wheel).
            New, not inherited: :3300 (frozen V5) carries 0 frames, 0 card ornaments and
            73 svg paths with a 14863px document; :3400 reads 115 paths (73 - 48 + 24 +
            23 + 19 = 91 at M6, + 24 brackets) and 20695px.
            Mount: 2 frames (hero, no id; evidence band) + 8 cards, each card 3 svgs of 2
            paths + 2 lines, every host aria-hidden, pointer-events none and text-free
            (own text length 0 x10).
            Pixel space: both frame svgs report viewBox null/null and an svg box equal to
            its host box (1440x900 and 1152x144.5), and the dotted patch measures 9
            verticals over 176px at a 22px pitch on BOTH frames — 8x5 tiles, the small
            corner note §9 asks for rather than a full carpet.
            Subtlety: 126 ornament strokes, computed opacity 0.26..0.45 (0 outside
            §9's 25-45%), widths 1..1.2 (0 outside 1-1.5px), and --accent #5b7cfa →
            rgb(91,124,250) on every one; karma orange appears nowhere.
            Geometry: 4 paths per frame, each with getTotalLength 52.00 (two 26px arms),
            2 per card; brackets are the only <path> elements in the ornament.
            Draw-on: the approach settles at scrollY 14211 with the band top 1120.7px
            below the fold, visibility 0 (< the frame's own 0.2 threshold) and offsets
            1/1/1/1; the trace then records 155 frames over 2612ms ending 0/0/0/0, with
            per-path travel exactly 1.000 and no offset ever increasing. Choreography
            measured from Web Animations: starts 182/245/313/382ms against declared
            delays 0/70/140/210ms, duration 0.62s, cubic-bezier(0.16, 1, 0.3, 1) —
            byte-equal to --ease-expo — and the hero frame is already settled at load, so
            this is a one-shot on first view, never a loop.
            Stacking: frame position absolute at z 0 against cells at position relative,
            so the cells paint above the ornaments by DOM order (the band frame is a
            SIBLING of the border grid, not its child — as a child it painted over the
            stat numbers).
            Not clutter: 0 overlaps on all 8 cards between an ornament box and the
            heading ink, body ink or the card icon, worst clearance 124.28..144.42px
            against the 20px padding, measured against per-LINE ink rects (6,6,5,5,6,6,6,5
            ink boxes per card) rather than element boxes.
            Hit-testing: at hero point (14,120) shipped resolves to <canvas.h-full
            w-full> with frame=false; lifting pointer-events:none on the same point
            resolves to <svg> with frame=true; re-forced true again; restored → <canvas>,
            frame=false, computed pointer-events none. The stat-cell point (154,405) is
            kept as the stacking assertion: cell=true, frame=false.
            No layout cost: the 4 decorated band cells are rect-identical with and
            without the ornaments (394.72,144,287.25,144.5 → the same), band height 145.5
            → 145.5, document 20695 → 20695, styles restored after.
            Reduced motion (own context): offsets 0/0/0/0 on both frames and 0/0 on the
            card, declared durations 1e-06s, 55 frames over ~0.9s with max travel 0, and
            the hide-the-ornaments clip DIFFERS, so those pixels are the ornaments.
            Regressions RE-RUN against this artifact, gate labels byte-preserved and only
            the arithmetic extended: M3 22/22, M4 17/17, M5 15/15, M6 17/17 — all four now
            carry the +24 blueprint term in their conservation ledger.
Failures    Seven, all in the harness or the expectation except the first, which was real
            and was fixed in source.
            (1) The subtlety gate FAILED with opacity up to 1.0: the left-edge tick column
            and its crosshair inherited the frame's default stroke. Fixed at the source
            (group 0.3, inner 0.38, ring 0.3) so the whole page now sits inside §9's band
            across all 126 strokes.
            (2) The BEFORE control FAILED because it asserted 91 paths on the frozen V5
            build. The expectation was wrong: 91 is the M6 artifact; :3300 has 73. Rewritten
            as 73 there vs 115 here — the gate got stronger, not weaker.
            (3) The draw-on gate FAILED (0/0/0/0 before the reveal). Root-caused with a
            diagnostic rather than guessed: Lenis glides ~209px past the last wheel event,
            so a "below the band" seek still arrived with the band in view, and the
            latching useInView reveal had already fired. Fixed with a 240px safety margin
            AND a predicate-verified approach (retry with wheel-up until visibility < 0.2
            and every offset > 0.999) — the seek is now proven from the ornament's own
            state, not from a scroll number.
            (4) The hit-test FAILED at a point 154,-130: the lit-seek used bandDocTop + 120,
            which scrolled the band out of view. Now the recorder and the hit-test both
            land on bandDocTop - vh*0.45 — the same settled position.
            (5) The hit-test FAILED again (the forced control landed on the cell, not the
            frame). The product was right and the control was wrong: the stat cells are
            position:relative, and a positioned later sibling legitimately wins both paint
            order and elementFromPoint over a z-0 overlay. Rebuilt as a hero scan that
            finds a genuinely free point, and the cell point is kept as the stacking
            assertion instead of being re-probed.
            (6) not-clutter FAILED on cards 2 and 7: the first card-corner geometry put an
            18px mark 24px into a 20px padding box. Fixed in source with the 14px-in-4px
            corners, and the harness moved from element boxes to per-line ink rects,
            because a paragraph's box spans the content width even where its last line
            stops short — that comparison flattered the ornament.
            (7) M3's strand selector would have silently started measuring the new card
            corners: they are absolute svgs with pathLength=1 dashed paths too, and they
            precede the pipeline in DOM order. Tightened to also require
            overflow="visible", the attribute only src/components/motion/strand-trail.tsx:131
            declares; M3's strand gate passing proves it still finds the strand.
Protected   §1.1 audited before writing: both frames are new absolutely-positioned
            children of boxes that were already relative, and each card gained one such
            child; nothing existing was restyled, no class, listener, keyframe or
            transition was removed, and the ornaments paint above nothing the page needs
            to click (pointer-events none everywhere, proven by the hit-test). +24 paths,
            0 subtracted: §1.2 was NOT invoked here — the only authorised deletion
            remains M3's page-wide V5 overlay.
Still open  M9 owns the cost of 126 extra stroked primitives over the hero canvas and the
            evidence band. They are static after a 620ms one-shot, so the expectation is
            "no steady-state cost", but that is a measurement M9 must make, not a claim
            this job may assert. Also unmeasured: the 14px card corners against the 8px
            icon on the narrowest card at 375px, which the collision gate only ran at
            1440.
```

```text
[V6][Job 7 / M7] karaoke fill, the thermal accent shift and the footer's third pass
Where       NEW src/components/landing/karaoke-fill.tsx (81 lines): header :7-20, DIM
            0.25 :22, SPAN 2.5 words :23-26, isGap :28, plan() :31-36 (module-level, so
            the word ordinal is computed once per text, not per frame), KaraokeFill
            :38-81 with useScrub(travel 3.2) :48, the reduced-motion early return to a
            plain <p> :~49-53, the playhead g = p*(1+SPAN) - SPAN/2 :~55, host
            <p ref data-t6="karaoke" className> :60 and per-word spans carrying ONLY
            opacity :61-75, whitespace kept as its own spans so the browser's normal
            text layout still owns the wrap.
            NEW src/components/landing/thermal-blob.tsx (81 lines): header :5-22 (the
            single-theme fallback and the two cost decisions), LAYERS :24-29 (the three
            --flow-* tokens at band centres 0.18/0.55/0.92), SIZE 260 / SCALE 2.35
            :31-32, useScrub(1.35) :35, weights/sum :39-40, host :49-57 (aria-hidden,
            data-t6="thermal-blob", pointer-events-none, absolute inset-x-0 top-0 z-0,
            h-[46vh] min-h-[300px], overflow-hidden), the sheet :59-66 (filter
            blur(34px), willChange transform, translate3d + scale), the three gradient
            layers :67-79 (radial-gradient(closest-side, token 0%, transparent 72%),
            opacity = 0.62 * weight/sum).
            src/components/landing/landing-footer.tsx: WORDMARK :33, useScrub(1.2) :72,
            wipe :75 (V4's, untouched), rise :76-77 (the new second read of the SAME p),
            <defs> clipPath in objectBoundingBox units :166-170, the original 10%-fill
            text :171-173 (byte-identical to what :3300 ships), wordmark-outline
            :174-184, wordmark-fill :185-194.
            Mounted in src/components/landing/landing-page.tsx: karaoke prop threaded
            through SectionHead :64 with the single body class string written once and
            used by both branches :79/:83, enabled at the pipeline head :311 and the
            benchmarks head :486; ThermalBlob :554 under the existing CursorField inside
            #start. Harnesses ../_lh/harnesses6/t6-m7b-job7.mjs (13 gates); evidence
            ../_lh/t6-m7b.json and ../_lh/t6-m7b/ (01-karaoke-lit.png,
            01-karaoke-mid.png, 02-thermal-cta.png, 03-wordmark.png,
            04-reduced-cta.png, 05-reduced-cta-noblob.png).
Why         §10's first requirement is an audit, not an effect: karaoke may only land on
            long paragraphs that no existing word-level animation owns. The sweep is
            deliberately a playhead over WORD ORDINAL rather than over measured pixel
            positions — nothing is measured per word, so the cost is one arithmetic
            expression per word inside useScrub's existing rAF-throttled write, a reflow
            can never desynchronise the light from the glyph, and the paragraph's layout
            stays identical to a plain <p> (only opacity changes), which is what makes it
            safe to mount on copy other layers already paint.
            DEVIATION, stated rather than papered over: §10 describes a thermal blob at
            the boundary between contrasting sections with a scroll-linked hue. This
            landing is one dark theme, so §10's own written fallback applies — the heat
            maps to the accent shift at the CTA boundary — and there is a second reason
            not to hue-rotate: driving one layer through the ~165° the brief implies would
            drag --flow-input-b (227°) past magenta, off the house palette §11 forbids.
            So the hue travel is three pre-coloured gradient layers crossfaded on
            OPACITY while the whole sheet moves on TRANSFORM: every frame the compositor
            receives is a transform plus two opacity steps rather than a new blur, and
            every colour that ever paints is an existing token. The blur is baked into a
            small 260px sheet that is scaled 2.35x, so the filtered surface stays tiny
            instead of re-rasterising a 1440x420 box per write.
            The footer wordmark passed §10's gate the same way: the audit showed the
            existing giant wordmark is a single 10%-fill text with no stroke and no clip,
            so an outline and a rising accent fill are additions, and they are the page's
            second travel direction — V4 wipes left→right, this rises from the baseline.
Evidence    13/13 gates on the shipping artifact (:3400, hardware ANGLE, trusted wheel).
            No duplication: karaoke hosts are exactly the two bodies (the pipeline head
            and #benchmarks), and every word-level effect V4/V5 already ran is still
            there in the same count — sweep headings 9 → 9, CTA gathering spans 6 → 6, V4
            hero word spans 10 → 10 with the same text; :3300 had 0 karaoke hosts.
            Layout-neutral: both paragraphs wrap to 529.92x96 on :3400 against 529.92x96
            on the static :3300 build (Δ0/0), 24px line-height on both, same class string,
            85 and 83 spans on this build vs 0 on :3300.
            Dim floor: approaching from above (scrollY 912.02) all 43 words read exactly
            0.25, at the end of the band all 43 read exactly 1, and the lowest value in
            the whole 121-frame trace is 0.25 — the sweep really starts from nothing lit.
            Marching head: mid-scrub 22/43 words full, 3 caught in the ramp, first word 1,
            last word 0.25, no later word ahead of an earlier one anywhere in the trace;
            across 121 frames 48 distinct opacity levels, head range 0.750 and tail lift
            0.750 — the head travels from the first word to the last.
            Paint-only: every span has transform none, filter none, display inline-block
            and transition-duration 0s; computed opacity equals the inline value written;
            43 word spans + 42 whitespace spans; exactly ONE paragraph box (529.92x96)
            for the whole sweep.
            Blob mount: one host in #start, z 0 / absolute, pointer-events none,
            aria-hidden, 414px tall against a 260px sheet and 3 layers; :3300 has no blob
            at all. Palette: --flow-input-b #7065e2, --flow-route-a #e0706a,
            --flow-route-b #d9a441 resolve to rgb(112,101,226) / rgb(224,112,106) /
            rgb(217,164,65) and each layer's own computed rgb matches its token, so no
            literal colour is authored.
            Compositor claim measured, not asserted: the computed filter string is
            byte-identical at three scrub stops (blur(34px) three times) while the
            transform changes (matrix 1.959 / -41.0 → 2.37 / 0.26 → 2.632 / 44.07) and the
            layer opacities change (0.62/0/0 → 0.1438/0.4311/0.0451 → 0/0/0.62), the
            crossfade totals pinned at 0.62/0.62/0.62 so the sheet never dims between
            falloffs, will-change is transform, and the blur lives on the sheet
            (layers' own filter none/none/none). Hue hands over first token → third.
            No layout cost: CTA height 556.19 shown → hidden → restored, content wrapper
            336.91x235.19 identical, document 20639 → 20639 at that scroll phase.
            Wordmark additive: :3300 paints the word once (rgb(242,242,245) at 0.1, stroke
            none); :3400 paints it three times with that first pass byte-preserved, plus
            an outline at 0.28/1px stroke and an accent fill rgb(91,124,250) at 0.2
            clipped by the rise rect in objectBoundingBox units. Scroll-linked: the rect
            travels y/height 1/0 → 0.9394/0.0606 → 0/1 across scrollY 19240/19630/19739
            while V4's own wipe keeps travelling on the same progress (inset 100% →
            66.77% → 0%) and the glyph box 1152x136.8 never moves.
            Reduced motion (own context): 0 karaoke hosts and both paragraphs back as
            plain <p>s with byte-identical text, 0 spans and the same 96px height as V5;
            the blob's matrix is held across 3 wheel steps (1 distinct value) at layer
            opacities 0/0/0.62 with a hide-control that produces a DIFFERENT clip, so
            those pixels are the blob; the wordmark's rise clip is already open (0/1) with
            the wipe at 0% and all three passes present.
            §11: 0 paid/provider requests, and this job adds 0 svg paths — the page stays
            at 115 — because karaoke, blob and wordmark are text, divs and opacity.
Failures    Six, all in the harness or the expectation; the product did not need a change
            for any of them.
            (1) The word collector counted 85 "words" alternating 0.25/1: whitespace gap
            spans were being treated as words. Fixed by filtering to non-blank spans (43
            words + 42 gaps), which also explained the computed==inline mismatch — the gaps
            simply have no inline opacity.
            (2) The dim-floor and sweep gates FAILED because they expected ≥8 distinct
            opacity levels within a SINGLE frame. That model is wrong for this effect: a
            one-word-at-a-time head legitimately shows ~4 levels at any instant. Replaced
            with cross-frame evidence (48 distinct levels over 121 frames, head range and
            tail lift both 0.750, monotone order preserved) rather than by loosening the
            threshold until the old expectation passed.
            (3) The mid-scrub seek overshot to 1.0 lit: a 307px scrub band is smaller than
            the ~209px Lenis glide, so a fixed half-band seek is not trustworthy. Replaced
            by an adaptive loop that corrects against the piece's OWN measured lit
            fraction (this run logged 1 → 1 → 0.605 before landing at 22/43), the same
            lesson M6's draw-on gate learned, now applied before it cost a rebuild.
            (4) The paint-only gate FAILED on the transition assertion: Chrome prints the
            shorthand as plain "all", so matching the property name was meaningless. Now
            asserts transitionDuration === "0s", which is falsifiable.
            (5) A reduced-motion gate was written as a vacuous placeholder and deleted on
                review — it was replaced by the real predicate (0 hosts, identical text,
                0 spans, V5-equal height), since a PASS that cannot fail is not evidence.
            (6) The reduced-arm blob screenshot was taken with the blob off-screen, which
            would have made its hide-control pair trivially identical. Added rSeek() to
            park the CTA mid-viewport before the two clips.
Protected   §1.1 audited before writing, and this is the job with the highest risk of an
animations  accidental substitution: the two karaoke bodies are still the same strings
            produced by the same constants and rendered with the same class (byte-identical
            to :3300, which is what the layout gate compares), the SectionHead branch was
            added without touching the static branch, and V4's Gathering, SweepReveal,
            hero stagger and footer wipe are counted equal on both builds. The footer's
            original text element is unchanged and the new passes are siblings. Nothing
            here removes, disables or simplifies an animation; §1.2 was NOT invoked.
            M3/M4/M5/M6 were re-run against this artifact and are green (22/22, 17/17,
            15/15, 17/17) with only their path arithmetic extended.
Still open  M9 has three new things to price: 43 inline opacity writes per scrub frame in
            each paragraph (86 across the two), on text rather than on a stroke — painting
            text is not free the way a dashed line is; the blob's single blurred sheet
            scaled 2.35x over the CTA; and a third <text> pass on a 1152px-wide glyph.
            None of them is a rAF
            loop — all three ride useScrub's existing throttle, and reduced motion pins
            them without attaching — so the §11 "no rAF loops" claim is safe on reading,
            but the paint cost under 4x CPU throttle has not been measured. Also open:
            the karaoke band (307px) is shorter than a Lenis glide, so a fast flick can
            skip most of the sweep; that is a feel question the brief does not gate, and
            the fix would be a longer travel value, not a new effect.
```

```text
[V6][Job 8 / M8] consistency audit — nothing from the reference site's palette
            reached the product, and everything the product paints is a token
Where       src/app/globals.css:93-98 — new --mote-ambient: #8a93a8 with the
            reason written next to it, added after --grain-opacity and before
            --ring-color. Nothing above it changes.
            src/components/motion/cursor-field.tsx:84-86 — the two canvas inks
            now come from one getComputedStyle read (--accent, --mote-ambient),
            consumed at :119 (ctx.fillStyle = speed > 0.25 ? accent : ambientInk).
            src/lib/motion/hero-shared.ts:10-13 — heroPalette() lost its three
            fallback literals; read() returns the token value or an empty string,
            and globals.css owns every colour. Consumer unchanged
            (hero/hero-display.tsx:75).
            Harness _lh/harnesses6/t6-m8-consistency.mjs (11 gates), evidence
            _lh/t6-m8.json.
Why         §11 says AgentOS tokens only, and §5 asks for a consistency audit of
            this run's own work. Two findings were open from the shipped lint
            (a hex in cursor-field, a hex with no token behind it) and the audit
            had one more job: prove no colour from the reference site leaked into
            this product. That claim is only worth making value-first — a
            grep-shaped colour search misses a leak that arrives as an rgb()
            triple, a canvas fillStyle, or inside a minified chunk, so the search
            set was harvested from the ground-truth capture rather than typed
            from the brief, and each value is looked for in four spellings.
Evidence    11/11 PASS. Set: 11 values measured on the reference site
            (#ffb899 #ff4500 #6b4eff #ffc23d #d93a00 #c23300 #ff8a5c #fff0e9
            #e0592b #ef8b5f #a13c15) x 4 spellings = 44 needles. Zero hits in 274
            .ts/.tsx/.css under src/, and zero in the 259 served chunks/CSS/HTML
            (16,091KB) the artifact on :3400 was rebuilt from — which is also the
            freshness proof for every gate below. The two sets are disjoint: 17
            literal colours in globals.css, none of them in the search set, so
            "0 hits" cannot be an accident of a broken searcher; the same searcher
            finds 11 of 11 in the capture it came from through 14 distinct
            spellings, and reports 0 hits for two colours that are not in the set
            over 41 files. The repo's own scripts/check-design-tokens.mjs exits 0
            on this tree. 5 colour literals survive in component/motion code and
            all 5 are classified: hero-fluid.tsx:39-41 rgb(91,124,250)/
            rgb(138,188,237)/rgb(112,101,226) and particle-field.ts:58 #5b7cfa are
            token-declared values, horizontal-showcase.tsx:36 rgba(0,0,0,0.45) is
            a hueless shadow key; three controls prove the classifier rejects a
            non-token hue, rejects a grey used as a surface colour, and really
            does excuse the shadow it excuses. The five files this run touched
            carry 0 hex and 0 rgb literals (karaoke-fill reads no colour at all —
            its sweep is opacity only), and the counter is proven to count.
            45 custom properties read by landing/motion code: 28 declared in
            globals.css, 17 provided at runtime and each traced to its line
            (--i analytics-demo-client.tsx:78, --rise-x auth-form.tsx:65,
            --bubble-from message-bubble.tsx:26, --c charts.tsx:255, --g
            bench-chart.tsx:156, --v6-march-units cable-bundle.tsx:99,
            --v6-marquee-duration pipeline-stage.tsx:63, --dx/--dy/--tilt
            deal-stack.tsx:61-63, --sy use-parallax.ts:30, --mx/--my sheen.tsx:31,
            --sp use-parallax.ts:78, --ga tilt.tsx:59, --xx/--yy
            v5-layers.tsx:153) — no orphan, and a name nothing provides is
            reported as one. In the browser, 187 computed stroke/fill/text colours
            on the [data-t6] job elements reduce to 6 distinct triples (91,124,250
            242,242,245 112,101,226 224,112,106 217,164,65 185,185,194), all in
            the token set; --accent resolves to #5b7cfa and --mote-ambient to
            #8a93a8 exactly as declared; heroPalette's three inputs come back
            #5b7cfa #b9b9c2 #6e6e78 — three real, distinct colours, so removing
            the fallbacks blanked nothing. 0 paid requests of 29. Artifact
            rebuilt and :3400 restarted before any browser gate ran, then M3
            22/22, M4 17/17, M5 15/15, M6 17/17, M7a 12/12, M7b 13/13 on it.
Failures    (1) The harness threw ReferenceError on its first run: a gate read
            BUILD_HITS, which was declared underneath it. Hoisted above the gate.
            (2) READS() called .map on a Set — TypeError, not a silent empty
            result, which is the good kind of bug.
            (3) Gate 6 FAILED honestly and the harness was blind, not the code:
            hero-shared.ts passes its token names through read(), so a regex that
            only matched getPropertyValue('--x') saw no reads at all. Fixed by
            counting a quoted property name as a read wherever it appears, and by
            asserting the file also touches the browser (getPropertyValue|var().
            (4) Gate 5 FAILED on rgba(0,0,0,0.45) inside a Tailwind shadow. The
                tempting fix — exempt shadows by filename — would have excused any
                colour in that file. Instead the arm is narrow (r==g==b AND the
                matched line sets a shadow) and carries a third control proving
                the excuse is actually applied.
            (5) Widening READS surfaced 16 runtime properties the previous gate
                had covered with a single hardcoded whitelist entry (--sy). The
                whitelist is gone; each property now has to name its provider.
            (6) --sp still looked orphaned, because useScrubVar writes
                setProperty(name, '…') with a parameter. A blanket "any quoted
                property name in a file that calls setProperty" would have excused
                anything, so the scan links the literal to the identifier the call
                receives (name = '--sp' at use-parallax.ts:78).
            (7) The real product finding: hero-shared.ts's fallbacks contradicted
                the tokens they named — #8abced for --series-2 (which is #b9b9c2)
                and #7065e2 for --series-3 (which is #6e6e78). They are the sky and
                violet of an earlier palette, left behind. Nothing broke, because
                both tokens exist, so the wrong colours were unreachable; but a
                token rename or a deleted declaration would have painted colours
                no stylesheet could audit. Deleted rather than corrected: a
                fallback that silently supplies a colour is the reason the bug was
                invisible, and gate 10 now proves the read still yields three
                distinct values without one.
            (8) A throwaway diagnostic used to list the orphans mapped over an
                array of arrays and printed a confidently wrong answer (26 reads,
                0 orphans). Recorded so no number in this block is trusted from it
                — the harness's own output is the evidence.
Protected   §1.1 holds: this job touched no animation code. The three source
animations  edits are colour resolution (two getComputedStyle reads, one new
            token, one set of fallback literals removed), and the effect
            measurements did not move — the blueprint, karaoke, blob and wordmark
            gates re-ran on the rebuilt artifact at 12/12 and 13/13, and the path
            ledger is still 115 (25 protected + 24 bands + 23 bundle + 19 spokes +
            24 brackets) with M3/M4/M5/M6 green on the same artifact. The cursor
            field's two inks are the same two colours it already painted, so the
            motion is bit-for-bit the same for every value of --mote-ambient that
            is #8a93a8 — which gate 6 records as the declared value.
Still open  hero-fluid.tsx and particle-field.ts still write literals whose values
            happen to equal tokens; they could be hoisted to var()/getPropertyValue
            so a token edit reaches them, which is a §5 nicety and not a leak. The
            shadow key at horizontal-showcase.tsx:36 is the only colour literal
            left that no token owns, and the honest fix there is a --shadow-key
            token, not an exemption. --mote-ambient has exactly one consumer. M9
            inherits everything Job 7 flagged: 86 inline opacity writes per scrub
            frame, a 260px blur sheet scaled to 2.632 over the CTA, a third 1152px
            wordmark pass, and the 22 march loops plus 126 blueprint strokes to
            price under 4x CPU throttle.
```

```text
[V6][Job 9 / M9] performance hardening — the off-screen pause is ONE declaration,
            V6 measures faster than the build it replaces, and the cost that
            remains is measured instead of assumed
Where       src/lib/motion/use-idle-pause.ts (new) — :4-13 is the rule written
            next to the code: pausing is scoping, not reducing, and a dashoffset
            animation is ticked on the main thread whether or not any of it is on
            screen. :14-28 is the whole body: one IntersectionObserver that
            writes data-v6-idle="active"/"paused" on the host, 160px rootMargin,
            and a cleanup that removes the attribute it added.
            src/app/globals.css:1666-1675 — the only pause rule in the
            stylesheet: three selectors ([data-v6-idle='paused'] × .v6-march /
            .v6-hub / .v6-marquee) and one declaration, animation-play-state.
            grep says animation-play-state occurs exactly once, and "Nothing
            above this line changes" is true — the loops at :1613-1616,
            :1634-1636 and :1647-1652 are untouched.
            Call sites: cable-bundle.tsx:4/:61, ray-burst.tsx:4/:70,
            pipeline-stage.tsx:6/:51. pipeline-stage.tsx:86-90 is the band
            controller's off-band early-out (it writes no custom property when
            the wrap cannot intersect the viewport), and :54 returns before the
            controller mounts under reduced motion.
            Harnesses _lh/harnesses6/t6-m9-perf.mjs (13 gates),
            t6-m9-fps.mjs (7 gates), t6-m9-scrubcost.mjs (1 gate); evidence
            _lh/t6-m9.json, _lh/t6-m9-fps.json, _lh/t6-m9-scrubcost.json.
Why         §4 requires the canvas engine to render on rAF and "pause when the
            stage is off-screen (IntersectionObserver)"; §11.1 says 60fps or it
            doesn't ship; §11.2 sets LCP<2.5s and ≤50KB gzipped added; §11.3
            demands reduced motion get a static terminal state and no rAF loop;
            §11.4 zero paid calls; §12 requires fps probes run alone, arms
            interleaved per round, at 4× CPU throttle "so a 60Hz ceiling can't
            fake a pass". The owner's standing rule makes the only legal answer
            to a perf finding a cheaper way to draw the SAME animation, so every
            gate below measures a state, never a deletion.
Evidence    Scoping — 13/13 PASS. Pause hosts measured at document y 2425
            (h5400), 15589 (h839), 17345 (h1057); 15 reads across them with 0
            disagreements (14 paused, 1 active). Motion, proved suspended: the
            march advanced Δ274.886px while active and Δ0 paused, the hub
            Δ0.0158 scale vs Δ0, the marquee Δ160.21px vs Δ0. Identity, proved
            untouched: animation-name, duration, timing-function,
            iteration-count and will-change are byte-identical between arms and
            only play-state differs; removing the attribute resumes the loop.
            §4 rAF — in band 106 engine frames and 27 property writes with the
            canvas 900px visible; off band 0 frames and 0 writes with the canvas
            0px. The counters are identity-filtered prototype patches with saved
            originals, and the gate asserts a synthetic clearRect plus a
            synthetic setProperty were each counted ({draws:1, writes:1}) before
            it trusts a zero, then that the prototypes came back.
            §11.2 budget — 11 V6-authored files, 24.9KB gzipped against the
            50KB cap. The wire moves Δ6.6KB: 17 chunks byte-identical to V5
            (472.0KB shared) and 2 V6-only chunks (59.8KB). LCP 368ms against
            V5's 480ms, i.e. well inside 2.5s; an earlier run of the same
            harness read 532 vs 448, so the honest claim is the margin, not the
            delta.
            §11.3 reduced — the engine canvas carries ink of 51094px, so what
            those users get is a painted static shape, not a blank box; 0 frames
            and 0 writes across a 1500ms still hold with 8 wheel events fired,
            and 1 frame for the 1 viewport re-entry the band's own observer
            measured. The reduced DOM has no .v6-marquee element at all, 2 pause
            hosts and the 5-step in-flow <ol> (pipeline-stage.tsx:154-177); the
            two loops that survive compute to 1e-06s × 1 under the pre-existing
            !important guard at globals.css:440-450, not a new branch.
            §11.1 fps — 3 interleaved rounds at 4× throttle, 1440×900, real
            wheel events: V6 band median 31fps (31/30.8/36, p50 33.2ms) against
            the V5 build it replaces at 22.4fps (22.4/20.5/24.7). V6 is
            +8.6fps FASTER with identical DOM (1754 nodes) and identical
            document height. Positive control: a +40ms/frame spinner measured
            13.2fps against a predicted 13.8, so the meter can fail. Ship
            cadence at 1×: 60 and 59.7fps, p50 16.7ms, worst 17.1ms — a 60Hz
            ceiling compresses that leg, which is why the regression statistic
            is the throttled one. Rig: 24/24 samples inside the band in every
            arm, 24 distinct scrollY values, canvas 900px in band and 0px in the
            tail arm.
            The pause's fps value is deliberately NOT claimed. In the document
            tail it measured 25.8fps paused against 25.8fps with all three loops
            forced active (a first round of the same rig read +3.8), i.e. inside
            the noise floor. The pause stands on the frame and write counters
            above (0 vs 106, 0 vs 27), not on a measured fps gain.
            What the pause does NOT cover, measured: a 10-event wheel burst in
            the document tail (scrollY 18833→19634, 801px of travel, max 19739)
            costs 2444 getBoundingClientRect calls over 167 rAF frames = 14.63
            calls/frame, 86.2% of them reading a box entirely outside the
            viewport (50 of 52 svg boxes off-screen there; the sampled callers
            are #pipeline, #capabilities, #surfaces, #evidence, #benchmarks, the
            engine canvas and the footer wordmark). The same burst inside the
            pipeline band costs 2380 calls = 14.34/frame. So the 11 useScrub
            listeners (use-scrub.ts:27-41 reads a rect plus
            documentElement.scrollHeight every frame, and only its
            setProgress dirty check at :40 keeps React quiet) work exactly as
            hard off-screen as on it. It is V5 code and §11.8 says adapt the
            NEW code, so it stays and is reported.
            §11.4 — 0 paid requests of 29; both legs localhost (:3400 artifact,
            :3300 frozen V5).
Failures    (1) TypeError: seekToOn was undefined — a closure over the wrong
            page scrolled the wrong document. Replaced with a mkScroller(p)
            factory so each page drives its own trusted wheel events.
            (2) Gate 1 could never pass: the CSS regex matched the pause block
            once per selector (three of them), so "exactly one rule" was
            unprovable. Replaced with structural block extraction, comments
            stripped from the selector list.
            (3) The reduced arm was blind — it looked for a marquee host the
            reduced branch never renders. Fixed with one canvas finder valid for
            both render paths (the marquee band, else div.min-h-64 canvas),
            which doubles as an assertion of the reduced DOM shape.
            (4) A gate awaited an evaluate after rctx.close() — the host read is
            now hoisted above the close.
            (5) The counters had no self-test, so a 0-frame PASS was
            indistinguishable from a dead patch. Added the synthetic call and
            made the gate assert it was counted before trusting any zero.
            (6) The reduced gate FAILED 12/13 on "1 frame", and the frame was
            real: the engine's own observer repaints once on viewport re-entry,
            which is legitimate §11.3 behaviour. Fixed by budgeting frames
            against the measured enters+1 and adding a 1500ms still hold — not
            by loosening a threshold.
            (7) fps harness threw on r.attrs.join — the result carries
            attrsSeen.
            (8) The fps tail arms read paused,paused,active: the standard
            approach (band.top - vh + 150) starts INSIDE the last pause host.
            Added startAtTop for those arms.
            (9) The §11.1 gap gate failed on an improvement. Math.abs(gap) meant
            V6 measuring FASTER than V5 tripped the regression gate. Now
            one-directional (-gap <= max(4, v5spread)); an absolute test would
            have failed the run for measuring a gain, which is how a gate
            quietly stops meaning anything.
            (10) Caught before running the scrub probe: 10×260px from
            scrollY 18833 in a 20695px document would clamp at the bottom and
            silently under-count the tail arm. Both bursts are 10×80px now, and
            the gate asserts equal travel (801 vs 799px) so the two call counts
            are comparable.
Protected   §1.1 holds: M9 changes no animation. What it adds is one attribute
            on three hosts, one CSS rule holding one declaration, and one early-
            out that writes nothing when the stage cannot be seen. Every loop
            keeps its name, duration, curve, iteration count and phase; the
            pause is undone by removing the attribute, and the effect's cleanup
            (use-idle-pause.ts:25-26) removes it. Nothing was simplified,
            disabled or deleted, and the hide-style arms used for measurement
            (visibility on a flow root, forced play-state) lived only in
            throwaway browser pages and were handed back.
            Same-artifact regressions after the last build: M3 22/22, M4 17/17,
            M5 15/15, M6 17/17, M7a 12/12, M7b 13/13, M8 11/11, path ledger
            still 115 (73 V5 − 48 authorised §1.2 overlay + 24 + 23 + 19 + 24),
            and tsc --noEmit, eslint --max-warnings=0 and
            scripts/check-design-tokens.mjs all exit 0.
Still open  The 14.6 rect reads per frame that 11 useScrub listeners keep
            off-band: real main-thread work that paints nothing, but it costs no
            measurable frames at either 4× or 1×, and the fix would be inside
            V5 scroll code that §11.8 says leave alone. The tail-arm pause delta
            is unresolvable (25.8 vs 25.8), so the pause's value is stated as
            counters, not fps. LCP moves ±100ms run to run, so only the margin
            under 2.5s is quoted. At 4× the band still shows p95 50-83ms and a
            >2-frame share of 0.1-0.22 — that is the whole V5+V6 layer stack
            under artificial throttle, not a 60Hz reader's cadence (1× is 60fps
            with a 17.1ms worst frame). M10 inherits the no-deletions
            verification against _lh/t6-before.json.
```

```text
[V6][Job 10 / M10] no-deletions verification — the §1.2 inventory walked item by
            item on three builds, with the two rows a landing walk cannot reach
            (native cursor, app surfaces) measured where they actually live
Where       Verification only; no product file changed for this job, so the
            :3400 artifact under test is exactly the one Job 9 closed on.
            _lh/harnesses6/t6-m10-inventory.mjs (new, 13 gates) sweeps V6
            :3400, the frozen V5 :3300 (the labelled BEFORE build) and the V4
            :3100 control — which carries no V5 or V6 code — in one run.
            _lh/harnesses6/t6-m10-cursor-apps.mjs (new, 5 gates) walks /,
            /login, /dashboard, /app and /agentos on V6 and V4.
            _lh/harnesses4/t5-m11-functional.mjs (Take-5's functional suite,
            not one line changed) re-run against :3400.
Why         §1.3 makes any protected animation that is removed, disabled or
            simplified a FAIL "even if the new line system is perfect", and
            §14 M10 asks for the §1.2 list walked item by item with each one
            observed working. Observed, not declared: a row scores only on
            evidence that moves — an @keyframes parsed out of the live sheet, a
            getAnimations() sighting, a rect / dashoffset / attribute delta
            across samples. Three builds sit inside every gate because one
            build cannot tell "alive" from "the detector is blind".
Evidence    Inventory 13/13 PASS (_lh/harnesses6/t6-m10-inventory.json, verdicts
            _lh/t6-m10-inventory.log). 42/42 protected rows observed working on
            :3400 — preloader veil, WebGL fluid hero, V4 glyph flight + trails,
            parallax --sy writes, nav hide/solidify, logo self-draw, per-letter
            hover wave, grain, clip-path sweep reveal, pipeline edge draw +
            rework packet, capability deal-flight, card tilt / edge glow /
            sheen, showcase pin, typewriter caret, evidence counters + ping,
            model-route hairline + breathe, architecture pulse, benchmark grow +
            ding, FAQ fold, CTA gather + particle field, magnetic + ripple,
            footer cascade, scroll hint, strand trails and the six V5 §4 layers.
            Row by row the same 42 are alive on the frozen V5 build too — 0
            disagreements, so nothing was weakened on the way to V6.
            Non-vacuity: the V4 control lights 30/31 pre-V5 rows; the exception
            is strand trail, the documented pre-V5 defect Take 5 repaired (0
            nodes on :3100, alive on V5 and V6). §1.2's authorised deletion is
            proved with a detector that could have caught it: the four
            flow-overlay rows (§3 flow lanes chunked, halo + core twins, idle
            pulse, section-enter brighten) read alive on V5 and gone on V6, the
            stylesheet diff vanishes exactly flow-pulse and flow-lit out of 54
            parsed @keyframes, and 16/16 V6 layers are alive with 0 matches on
            either older build. The walk reached 19739/19795px in 27 positions;
            ledger 73 (V5) − 48 (overlay) + 90 (V6 jobs 3-7) = 115 paths,
            canvases 3 → 4 (the extra is §4's line engine); 12 <main> sections
            on all three builds, Lenis and the GSAP trace present, 0 of 0 paid
            requests, 0 page errors, 34/34 selectors parse.
            Cursor + app surfaces 5/5 PASS (_lh/harnesses6/t6-m10-cursor-apps
            .json, _lh/t6-m10-cursor-apps.log — the log is the same recorded
            walk re-graded, not a second observation): the served CSS, 83KB on
            every route, carries 6 cursor declarations and their VALUES
            {not-allowed:3, pointer:3} — 0 `none`; the computed census over
            every element (landing 1719 nodes {auto 1585, pointer 114, default
            20}, /dashboard 11769 {auto 11723, pointer 46}, /agentos 474) reads
            0 `none` on all five routes with body and html both auto. Two
            controls pay for that zero: the scanner counts 1 `none` in a
            synthetic sheet, and an injected cursor:none <p> is counted (1) and
            reads 0 again after it is deleted. Nothing tracks the pointer
            either — 37 landing candidates, 0 strict (moved by the exact pointer
            delta) and 0 loose — while the identical detector catches a
            synthetic follower at 1000,620 after an 800×400 trusted mouse move
            on every route, and both control nodes come back out with 0
            leftovers. App motion survived: V6's 51 @keyframes contain all 43
            V4 names on every route, and the first-frame animationstart /
            transitionstart log shows the same names ever animating on both
            builds (/dashboard 11 vs 10 — V6 has one MORE) with 0 paused
            animations. §11.8's rule is scoped: 0 [data-v6-idle] hosts and 0
            .v6-* nodes on the app routes against 3 hosts / 24 loop nodes on the
            landing. The session is proven, not assumed: /login opened
            anonymous lands on /login on both builds, the same URL with the
            seeded cookie lands on /app, and the /dashboard table settles at 736
            rows on V6 and 736 on V4 (634>634>666>666>732>732>736 over twelve
            one-second samples). 128 requests over both builds, 0 off
            localhost, 0 page errors.
            Functionality 17/17 PASS on :3400 (_lh/t6-m10-functional.log) with
            Take-5's own suite: a nav click scrolls 0→18430 for a section top of
            18510 (80px gap), the progress thread's mousedown at (1419,675)
            lands at 16702 = smoothstep(0.75)×19795 with a 0px error, no
            horizontal overflow at 375/640/768/1280/1440/1920, 26 interactive
            elements with 0 pointer interceptions on V6 and 0 on V4, wheel
            travel on each route's own scroller (/app 790px, /agentos 2850px,
            /dashboard 6388px), stored replay intact, 650 requests over 50 URLs
            and none of them non-GET.
Failures    All ten below are harness defects found while running, not product
            regressions; each is recorded rather than quietly fixed.
            (1) The "V6's own layers are present" gate tested the unscored ROWS
            table, where no row carries an ok field, and reported 0/16 alive.
            Fixed to read the scored rows, and validated by re-grading the SAME
            saved three-build sweep (--rescore, labelled in its header) instead
            of re-running and calling it new evidence.
            (2) --rescore was read as argv[2] and printed as a build URL.
            (3) score() assumed every channel lives on art.states; gsap and
            lenis sit on art. Caught before the run, not after.
            (4) The cursor control never registered: the injected cursor:none
            <p> went into body while the probe only selected "main *, body,
            html, header *, footer *", so a real 0 and a blind probe looked
            identical. The census now covers every element under body and
            reports the values that ARE there.
            (5) The synthetic follower never moved — its handler was
            `d.transform !== "" || setProperty(...)` and div.transform is
            undefined, so || short-circuited; its samples were also taken after
            the move, comparing a 100×80 delta against an expected 800×400.
            Both fixed; the control now trips on 5/5 routes.
            (6) The first version compared instantaneous animation COUNTS
            (/dashboard 34 on V6 vs 40 on V4). That is a timing claim, and it
            failed for a skeleton: the event log shows `shimmer` runs on both
            builds and had simply unmounted before the poll window opened.
            Motion is now compared by name, unioned from frame one.
            (7) The auth cookie path was typed with a dash
            (2026-09-30-55da7713) instead of the real directory
            (2026-09-30/55da7713). existsSync returned false, the cookie list
            came back empty and all four app routes rendered /login — a run that
            would have looked green and measured nothing. The path now resolves
            from import.meta.url and the harness aborts below two cookies.
            (8) The settle heuristic stopped at the first 3-sample plateau and
            reported 2 dashboard rows on V6 while the same build reached 736 a
            few seconds later. It now needs 12 samples with the last 4 equal.
            (9) "routes not redirected" was the wrong expectation: the product
            bounces an AUTHENTICATED visitor off /login to /app. That redirect
            is now the session proof, with the anonymous trip as its control.
            (10) Cross-build element-count parity was dropped as a gate — the
            dashboard census moves with the data (11769 vs 10816 in one run),
            which says nothing about animation. Reported, not asserted.
            No §1.1 violation was found, so §14's "failures fixed by adapting
            NEW code" had nothing to fix: no product file was touched.
Protected   The full 42-row §1.2 set above, re-observed moving on the artifact;
            the WebGL fluid hero, the native cursor (measured now, not assumed),
            the V4 hero glyph flight, every "impossible" scroll animation, the
            micro-interactions, the six V5 §4 layers, the Dashboard / Chat /
            AgentOS surfaces and all product functionality each got a gate with
            a control. M3-M8 stay green on the same :3400 artifact (22/22,
            17/17, 15/15, 17/17, 12/12, 13/13, 11/11) because nothing was
            rebuilt for this job.
Still open  Nothing for M10. M11 carries the §15 verification report (before and
            after media with labelled modes, measured-motion evidence,
            fps/LCP/bundle numbers, the §1.2 checklist with per-item status),
            the modified-files list and file delivery. Job 9's measured costs
            stay open as costs: the 14.6 rect reads per frame that 11 useScrub
            listeners keep off-band, and the tail-arm pause fps delta that the
            throttle runs cannot resolve.
```

```text
[V6][Job 11 / M11] final verification + artifacts — one harness, two builds, a
            labelled before/after media set that cannot silently shoot the wrong
            route, and the §15 report
Where       _lh/harnesses6/t6-m11-media.mjs (new). Output:
            _lh/t6-m11/BEFORE-v5-3300/ and _lh/t6-m11/AFTER-v6-3400/ (33 PNGs
            each), _lh/t6-m11/manifest.json, _lh/t6-m11.json, log
            _lh/t6-m11-media.log. Report: docs/uiux-take6-verification-report.md
            (new). This block. No product file changed for M11, so the artifact
            under test is still exactly the one Jobs 3-10 closed on.
Why         §14 M11 asks for the full before/after media set, a complete
            decision log and the modified-files list; §15 asks for a
            verification report with media, measured-motion evidence,
            fps/LCP/bundle numbers and the §1.2 checklist with per-item status.
            §12 requires the modes labelled, so the directory names carry the
            build and the port — there is no mode flag left to forget, which is
            how the Take-5 capture suite broke twice.
Evidence    Pairing gate PASS: 21 BEFORE frames, 21 AFTER twins of the same
            name, 0 orphans. Landing frames: hero viewport, per-<main section>
            viewport frame + element clip for all 12 sections, footer, top with
            nav, anonymous /login, then /dashboard, /app, /agentos in an authed
            context and two reduced-motion frames. BEFORE shot on the frozen V5
            artifact at 14863px / 12 sections, AFTER on the V6 artifact at
            20695px / 12 sections, 0 page errors on either.
            Frames audited by eye, not only by filename: section-07 is the §7
            ray burst firing over the route rows on V6 and bare on V5;
            section-02 is the §4 pinned stage (STAGE 5 OF 5 / Judge) with the
            LineEngine canvas mid-morph; the hero carries the §8 blueprint
            frame over the surviving fluid canvas. clip-10-faq and
            app-app-top are byte-identical across builds, which is the correct
            reading of "V6 adds no art to FAQ and touched no app route".
            Whole-run scoreboard: 164 browser gates green (M3 22, M4 17, M5 15,
            M6 17, M7a 12, M7b 13, M8 11, M9 13+7+1, M10 13+5+17, M11 1) plus
            13 line-shapes unit tests, 0 failures. Perf: LCP 368ms vs 480ms,
            25,457B gz added against a 51,200B budget, +6.6KB wire, 59.9/60fps
            unthrottled, V6 31.0 vs V5 22.4 fps at 4x throttle. $0 spend,
            localhost only, nothing deployed, nothing committed (HEAD a92779b).
Failures    The first run of this harness produced a green-looking media set of
            the wrong page: the landing context carried the session cookie, the
            product redirects a signed-in visitor off / onto /app, and nine
            frames of /app were written under landing filenames (its own log
            line said "9 frames, doc 900px, 0 sections"). Fixed by splitting
            the contexts (anonymous for / and /login, authed for the three app
            routes), rmSync of the scratch directory before capture, and an
            abort tripwire that refuses to shoot unless path == "/", sections
            >= 11 and the document is at least 13000px (BEFORE) / 19000px
            (AFTER) — a redirected landing can no longer pass.
            Also found by the eye check rather than by any gate: the §4 canvas
            art crosses the pipeline section's own heading and first paragraph
            lines at stage 1 (AFTER section-02 frame). Text stays legible and
            the canvas is pointer-events:none, so every M3 gate passed; the
            suite has no ink-over-text gate, so this is reported instead of
            silently fixed. Adapting it means re-routing the new waypoints, per
            §11.8, never moving the copy.
Protected   Nothing was touched to make the media set, so §1.1 holds by
            construction, and the run re-confirms it cheaply: 12 sections on
            both builds, 0 page errors, the V5 layers visible in the AFTER
            frames (progress thread on the hero, x-ray and energy states on
            CTAs), and the app-route frames identical to the pre-V6 build.
Still open  Two owner decisions, neither blocking: whether to re-route the §4
            waypoints clear of the pipeline heading, and whether to add an
            ink-over-text gate so the next take catches that class of finding
            automatically. Job 9's costs stay logged as costs. Commit and push
            remain unauthorised; delivery is files only.
```
