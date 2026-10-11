# V5 M1 — Animation inventory and do-not-touch checklist

Produced from a read-only audit of `src/`. **Every entry below must remain working after each
V5 milestone.** V5 §1.1 forbids removing, altering or simplifying any of these; new work layers
on top. The "smoke test" column is what to look at to prove the animation is still alive.

## Landing (`src/components/landing/`)

| Animation | File | Mechanism / trigger | Smoke test |
|---|---|---|---|
| Preloader 0→100 count, then slide-up exit | `preloader.tsx:44-65`, `:100` | rAF count on mount; `onTransitionEnd` unmount | Hard reload: counter runs, curtain lifts, hero appears |
| WebGL fluid hero background | `hero-fluid.tsx:19-29` → `lib/motion/fluid-layer.ts` | WebGL2 shader, continuous time + pointer loop | Hero swirls and reacts to mouse |
| Hero glyph flight (letters assemble from corners) | `hero/hero-display.tsx:129-198` | GSAP ticker rAF; analytic quadratic bezier `:167`, canvas trail spawn `:178`, landing kick + shockwave | Reload: letters fly in from off-page and slam into place |
| Canvas particle trails on hero entrance | `lib/motion/particle-field.ts` via `hero-display.tsx:178` | pooled particles, `fly`/`spray` modes, canvas | Dotted trails follow each letter, canvas unmounts after |
| Subhead word blur-in stagger | `hero/subhead-blur.tsx:37-49` | GSAP `fromTo` opacity+blur, gated on intro-ready | Subheadline words resolve after the hero |
| Hero parallax layers | `motion/parallax.tsx:25,36` | `--sy` written from `useParallaxPx` rAF | Background/foreground separate on scroll |
| Nav hide / solidify / active-link | `landing-nav.tsx:76-141` | one passive rAF scroll listener | Nav retracts on scroll down, returns on up |
| Nav logo self-draw + wordmark spring | `landing-nav.tsx:216-224` | CSS `stroke-dashoffset` transition, `nav-logo-in` | Logo outline draws itself at load |
| Nav per-letter hover wave | `landing-nav.tsx:51` | CSS `@keyframes .nav-wave` | Hover a nav word: letters ripple |
| Nav travelling underline | `landing-nav.tsx:155-169` | transform-only JS write | Underline slides between links |
| Manifesto drift mark | `motion/sweep-reveal.tsx:66` | CSS 720s rotation + `useScrubVar --sp` | Faint mark rotates and scales with scroll |
| Diagonal sweep reveal (all `SectionHead` titles) | `motion/sweep-reveal.tsx:25` | CSS `clip-path` transition on `useInView` | Each heading wipes in on entry |
| Pipeline SVG edge draw + node pop | `pipeline.tsx:71,106-118` | `useScrub` → `strokeDasharray/Offset`, scrub-derived spring | Diagram draws left-to-right while scrolling through it |
| Pipeline REWORK curved edge + looping packet | `pipeline.tsx:145-152`, `:270-284` | cubic bezier path, CSS keyframe dash loop | Dashed curve pulses backwards, packet circles |
| Capability card deal-flight | `motion/deal-stack.tsx:37` | IntersectionObserver flips `data-deal`; CSS transform on `--dx/--dy/--tilt` | Cards fan out from a stack |
| Card tilt + edge glow + sheen | `motion/tilt.tsx:22`, `.sheen`, `.edge-glow` | pointer-driven `--mx/--my/--ga` inline | Card leans toward cursor, rim lights |
| Horizontal showcase pin/scrub | `horizontal-showcase.tsx:281-295` | **GSAP ScrollTrigger `scrub:1, pin:true`** (only real ScrollTrigger in the app) | Section pins and tracks sideways |
| Showcase playhead grow | `horizontal-showcase.tsx:367-377` | CSS `transition-all` height/width | Playhead thickens on the active panel |
| Decision Bus curtain + typewriter | `motion/curtain.tsx:28`, `motion/typewriter.tsx:27,37,40` | CSS transform veil; `useScrub` char slice, `caret-blink` | Veil slides off, text types as you scroll |
| Evidence slot-machine counters | `motion/slot-counter.tsx:32` | CSS translateY reel + `slot-land`/`slot-ping` keyframes | Digits spin up and land |
| Model route hairline grow + riding packet | `model-routes.tsx:36,114,122` | `useScrub` → `scaleX` + `translate3d`; `route-shot`/`route-glow`/`route-breathe` keyframes on 3s `setInterval :47` | Lines extend, dots shoot along them |
| Architecture glyph stroke draw | `arch-grid.tsx:58,63,85` | `useScrub` + `scrubSlice` + `drawProps` | Glyphs stroke themselves on as you pass |
| Architecture node pulse | `arch-grid.tsx:105-113` | CSS `@keyframes` | Nodes breathe |
| Benchmark bar grow + grid draw + winner overshoot | `bench-chart.tsx:67,73,152` | `useScrub` → `scaleX`, spring overshoot | Bars extend, winner springs past |
| Benchmark ding | `bench-chart.tsx` `bench-ding` | CSS keyframe | Fires once when bars land |
| FAQ fold | `faq.tsx:54-69` + `globals.css:369-389` | CSS `::details-content` `block-size`/`rotateX`/`clip-path` + `fold-lift` | Answer unfolds with a slight 3D tilt |
| CTA gather-words | `motion/gather-words.tsx:19` | per-word CSS transform/opacity on `useInView` + `gather-impact` | Words pull together into the headline |
| CTA cursor particle field | `motion/cursor-field.tsx:32,38` | canvas rAF, 90 motes, pointer repulsion, IntersectionObserver-gated | Motes push away from the cursor |
| Magnetic CTA + click ripple | `motion/magnetic.tsx:22`, `motion/ripple.tsx:16` | pointer transform with `--ease-spring` return; `ripple-out` keyframe | Button leans to cursor, ring on click |
| Footer wordmark wipe + column cascade | `landing-footer.tsx:67,70,150` | scrub `clip-path: inset()`, `useInView` + `footer-rise` | Giant wordmark wipes in, columns rise |
| Scroll-state reveals | `motion/reveal.tsx:65,111,152` | IntersectionObserver + rAF fallback, CSS transitions | FadeUp / LineMask everywhere |
| Grain overlay | `motion/grain-overlay.tsx:6` | static inline SVG `feTurbulence` | Film grain present on every route |
| **Strand trail (V5 M8 pre-work)** | `motion/strand-trail.tsx` | `useScrub` + `drawProps`, orbit radii from measured `h2` box | Pipeline section: three lines sweep in, orbit the heading, run vertical |

> **Status note (added at M11, `[VERIFIED]`):** this row was **declared but inert** from Take 4
> through M10 — the component looked for its heading inside its own wrapper, which can only succeed
> after the `<svg>` it gates has rendered, so **0 strand paths painted at any scroll depth on the
> landing page**. M11 repaired it with a sibling lookup (`strand-trail.tsx:91`), a one-line change
> that touched no duration, easing or path formula. It is now verified present and moving
> (3 `<path>` nodes, 4 distinct dashoffset sets, 4 distinct svg slides — control build: 0 nodes),
> verified *visible* rather than merely painted, and priced at +1.33fps of 23.9fps in its own scroll
> band. See `uiux-take5-decisions-log.md`. The smoke test above is what proves it stayed alive.

## App surfaces (must not regress either)

| Animation | File | Notes |
|---|---|---|
| Dashboard sheen + edge glow | `motion/sheen.tsx:16` | dashboard-only |
| Sparkline / donut stroke draw | `dashboard/charts.tsx:86,252`, `globals.css:657,792,803` | `gauge-sweep`, `donut-sweep`, `.spark-draw` |
| Meter bar grow | `dashboard/meter-bar.tsx:47` | `transition-[width]` — see §6.2 note below |
| Routing visualizer | `chat/routing-visualizer.tsx:70` | `transition-[width]` |
| Proximity text (app) | `motion/proximity-text.tsx:13` | per-char scale/glow rAF |
| Auth check mark draw | `globals.css:792` | `.auth-check path` |
| Workspace scroll fix | `motion/smooth-scroll-provider.tsx:33` | `/app /dashboard /agentos /admin` stay on native document scroll — **Lenis must not be re-enabled there** |

## Shared infrastructure that must survive

- `src/lib/motion/use-scrub.ts` — `useScrub` / `scrubSlice` / `drawProps`. The house scroll pattern; reduced-motion aware (`:56` pins progress to 1).
- `src/lib/motion/use-parallax.ts` — `useScrubVar` / `useParallaxPx`.
- `src/lib/motion/use-reduced-motion.ts` — `useReducedMotion()`, `prefersReducedMotion()`, `useFinePointer()`.
- `src/components/motion/motion-provider.tsx` → `smooth-scroll-provider.tsx` — Lenis ↔ `ScrollTrigger.update()` pump at `:59-64`; never instantiated under reduced motion, on workspace routes, or on touch.
- `src/app/globals.css:422-432` — the `@media (prefers-reduced-motion: reduce)` backstop. Note `globals.css:975`: inline `style.transform` outranks it, so any new JS writer **must** gate on `useReducedMotion` itself.
- Motion tokens: `--motion-fast 120ms`, `--motion-base 220ms`, `--motion-slow 420ms`, `--motion-scene 1200ms`; `--ease-expo cubic-bezier(0.16,1,0.3,1)`, `--ease-spring cubic-bezier(0.34,1.56,0.64,1)`, `--ease-out-soft`, `--ease-in-out`; named classes `ease-gather`, `ease-slot-reel`.

---

### Decision: V5 §2 library stack does not match the installed manifest
- **Context:** V5 §2 lists Framer Motion and Three.js/R3F as "already installed" and directs their use.
- **Verified:** `package.json` has `gsap ^3.15.0`, `lenis ^1.3.26`, `next-intl ^4.13.6`. `framer-motion`,
  `motion`, `three`, `@react-three/fiber`, `@react-three/drei`, `split-type` are **absent**. The fluid hero
  is hand-written WebGL2, not Three. GSAP plugins present on disk and usable: `MotionPathPlugin.js`,
  `ScrollTrigger.js`, `SplitText.js`, `DrawSVGPlugin.js`, `MorphSVGPlugin.js`. `[VERIFIED]`
- **Chosen:** build V5 §3 on GSAP ScrollTrigger + hand-rolled `useScrub` + SVG `stroke-dashoffset`. No new libraries.
- **Why:** installing framer-motion/three to satisfy §2 would blow the §6.8 <50KB gz budget for effects the
  existing stack already performs, and V5 §7.4 says implement manually rather than assume a library.
- **Risk:** none to the product; the brief's premise is simply wrong.
- **How to reverse:** `pnpm add framer-motion three @react-three/fiber` and port.
- **Existing animations preserved:** all — nothing was removed to make this work.

### Decision: V5 §5 timing tokens vs the shipped motion tokens
- **Context:** §5.4 prescribes Fast 0.15s / Medium 0.3s / Slow 0.6s / Very slow 1.2s and a material default
  `cubic-bezier(0.4,0,0.2,1)`, and says to replace hardcoded durations across every component.
- **Conflict:** the repo already ships `--motion-fast 120ms / base 220ms / slow 420ms / scene 1200ms` and
  `--ease-expo cubic-bezier(0.16,1,0.3,1)` — which *is* §5.4's "Smooth". Re-timing existing animations to
  §5.4's numbers would alter them, which §1.1 forbids.
- **Chosen:** the shipped tokens are the authority. V5's four names map onto them (fast→`--motion-fast`,
  medium→`--motion-base`, slow→`--motion-slow`, very-slow→`--motion-scene`). §5 becomes a read-only audit
  plus token adoption in **new** V5 code only; no existing duration is edited.
- **Risk:** §5.1–5.4 will report pre-existing hardcoded values as "not fixed".
- **How to reverse:** adopt §5.4's numbers globally in one pass if the owner prefers that scale.
- **Existing animations preserved:** all timings untouched.

### Decision: there is no content system to read text from
- **Context:** V5 §1.5 forbids hardcoded text and says to use "the existing content system (CMS, config
  files, or component props)".
- **Verified:** `next-intl` is wired (`src/i18n/routing.ts`, `src/i18n/request.ts`, provider at
  `[locale]/layout.tsx:73`) but `useTranslations` / `getTranslations` are called **zero** times in `src/`.
  `messages/en.json` contains only the untouched template key `HomePage`. All 15 landing sections hold copy
  inline. `[VERIFIED]`
- **Chosen:** V5 animation layers add **no new strings at all** — geometry, colour and motion only — so §1.5
  cannot be violated. Extracting existing copy into `messages/en.json` is a separate, text-affecting refactor
  across every section and is not done under a "no deletions, no alterations" brief without an explicit go.
- **Risk:** the owner may have expected §1.5 to trigger the i18n migration.
- **How to reverse:** one milestone to add a `landing.*` namespace and switch sections to `useTranslations`.
- **Existing animations preserved:** all — no section was rewritten.
