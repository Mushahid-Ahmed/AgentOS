# UI/UX Phase A — Reference study (live, Rung 1 browser automation)

Studied **live** with the browser-use MCP (real Chromium): loaded each site, ran JS probes
(computed styles, `document.fonts`, canvas/WebGL detection, scroll-container + overflow
inspection, library fingerprints), and saved real screenshots. Capability rung used:
**Rung 1 (real browser automation)** for all three sites. No site was unreachable; there are no
`[UNKNOWN]` entries below. Screenshots are genuine captures.

The four reference captures are **not** in this repo — they are third-party visuals, and §14 keeps
copied assets out of the published tree (UX-D42). They live in the run's local evidence folder,
`_lh/reference-captures/` next to the repo, and in the delivered bundle
`~/Desktop/AgentOS-UIUX-2026-10-08/uiux-before/`:

- `_lh/reference-captures/lusion-about-01-load.png`
- `_lh/reference-captures/downbeat-01-hero.png`
- `_lh/reference-captures/downbeat-02-hscroll.png`
- `_lh/reference-captures/lusion-projects-01.png`

Everything in `docs/uiux-before/` and `docs/uiux-after/` **is** ours: the pre-run AgentOS surfaces
and the shipped ones.

---

## 1 · https://lusion.co/about (owner's favourite)

**Probe results (real):**

- Fonts (`document.fonts`): **Aeonik** 400/500 + italic 400 (display AND body), **IBMPlexMono**
  400/500, and a custom **LusionMono** 400. Aeonik is proprietary (not on Google Fonts) — we
  match its _character_ (clean geometric neo-grotesque), never the file.
- Hero centerpiece: `<canvas id="canvas">` with a **live WebGL context** (700×713 backing,
  560×570 CSS) rendering a monochrome particle field forming an abstract 3D shape.
- A second `<canvas id="transition-overlay">` (WebGL-less 2D) = the signature **page-transition
  overlay**.
- **Preloader:** `.preloader-percent-digit` / `-num` elements → a 0→100 **percentage-counter
  preloader**.
- **Scroll model:** `html` and `body` both `overflow:hidden`, `scrollHeight == innerHeight`
  (570) → a **virtual / JS-driven smooth scroll** (body locked, an inner wrapper is translated).
  Library globals (`window.gsap/ScrollTrigger/Lenis/THREE`) are all `false` because everything is
  bundled into module scope — fingerprinted by behaviour (scroll-lock) not globals.
- Palette: near-black canvas, near-white text `rgb(240,241,250)`; monochrome (grayscale) imagery.
- Type: display 38px Aeonik 400; body/labels 14px Aeonik 500 **UPPERCASE**; huge bottom wordmark
  "LUSION" in heavy tight Aeonik; "SCROLL TO EXPLORE" uppercase micro-label.
- Layout: fixed top-left wordmark, top-right circular menu button, a row of "+" crosshair
  registration marks across the mid-line, full-viewport hero.

**Screenshot read (`lusion-about-01-load.png`):** dark immersive WebGL particle hero; giant
"LUSION" wordmark bottom; "SCROLL TO EXPLORE"; crosshair grid marks; monochrome.

## 2 · https://lusion.co/projects (same studio, list/work view)

**Probe results (real):**

- Same font stack: **Aeonik / IBMPlexMono / LusionMono**. Same virtual scroll (`overflow:hidden`,
  `scrollHeight == innerHeight`). Preloader present. 3 canvases.
- **Light editorial index:** pale lavender-white canvas `rgb(240,241,250)`-ish with near-black
  type — i.e. Lusion mixes a LIGHT index surface with DARK immersive pages.
- Huge black Aeonik display word "PROJECTS" (~90px, tight) + a **count "19"** + a **diagonal
  arrow (↘)** as meta, top-right of the title.
- **Full-bleed rounded image cards** stacked vertically; project links
  (`/projects/oryzo_ai`, `/atlas_motion`, `/devin_ai`, …).

**Screenshot read (`lusion-projects-01.png`):** light index, giant "PROJECTS", count+arrow meta,
one full-bleed rounded photo card.

## 3 · https://sarthakdev-downbeat.vercel.app/ (owner's 2nd reference)

**Probe results (real):**

- **Lenis detected: `window.lenis` truthy** → smooth inertial scroll is active.
- **Pinned horizontal showcase CONFIRMED:** two `position:sticky; top:0; height:100vh` wrappers,
  each containing a `flex … w-max will-change-transform` track **2240px / 2275px wide** (wider
  than the viewport) that vertical scroll translates horizontally. Carries
  `motion-reduce:w-full` / `motion-reduce:static` → a real reduced-motion fallback exists.
- **Scroll-progress segmented bar** under the fixed nav (thin multi-segment rule that fills).
- **Scroll-driven word-by-word text highlight:** a statement paragraph where reached words light
  to white and unreached words stay dim gray, with one accent word in blue
  (`downbeat-02-hscroll.png`).
- **Line-mask reveals:** h1 split into `.ln` `overflow-hidden` line wrappers, each with an inner
  `block` translated `translateY(0)` via `transition: transform 1.3s cubic-bezier(0.16,1,0.3,1)`
  with staggered delays (2.1s / 2.22s) — a long expo-out line reveal after load.
- Fonts: **Instrument Sans** (h1 81.2px weight 620 tracking −2.84px; body 18px) + **JetBrains
  Mono** + **Mona Sans** (variable 200–900). Neo-grotesque display, tight negative tracking.
- Palette: near-black `rgb(13,14,17)` canvas, near-white `rgb(236,236,239)` text, royal-blue
  accent; a theme (sun) toggle + blue "Start →" pill in the nav.
- 13 `<canvas>` elements = per-card **audio waveform / equalizer bar visualizers**
  (`flex-grow` bar spans), not text char-splits.
- `scrollHeight` 11194 vs `innerHeight` 570 → a long native-scroll page (Lenis on top of native).
- The **proximity word-glow** is NOT present as per-char spans at load (probed: no char-split
  containers on headings; the char-span containers found are waveform bars). It is applied on
  pointer interaction / further down. We therefore implement it from the owner's description +
  the standard technique (per-char spans, distance-mapped scale+glow), tagged `[ADAPTED-FROM-DESCRIPTION]`,
  not as a copied DOM.

**Screenshot read (`downbeat-01-hero.png`, `downbeat-02-hscroll.png`):** dark hero with nav
(waveform logo + wordmark, theme toggle, blue Start pill); a scroll-reveal statement with
word-by-word highlight and blue accent word; segmented scroll-progress bar.

---

## 4 · What NOT to copy (Rule 8)

Proprietary assets we must never reuse: Lusion's **Aeonik / LusionMono font files**, their
particle-field **3D scenes/artwork**, the "LUSION" **wordmark/logo**, all project **photography &
video**, and all **copy/text**. DownBeat's **Instrument Sans/Mona Sans are Google-fonts-legal to
load but we do not claim them as the references' identity**, and we never reuse DownBeat's
artwork, logo, waveform assets, or copy. We adapt **techniques only** (scroll pinning, smooth
scroll, proximity text, line-mask reveals, WebGL/canvas scenes, easing character) and draw ALL
artwork originally in code.

---

## 5 · Technique adoption list (re-implemented originally for AgentOS)

| #   | Pattern (from reference)                                      | Where on AgentOS                                         | Mechanism                                         | Reduced-motion / mobile fallback               |
| --- | ------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| 1   | Percentage-counter preloader (lusion)                         | Landing entry                                            | DOM counter + fade, ≤2s, skippable                | Skipped entirely                               |
| 2   | Monochrome WebGL/canvas particle hero (lusion)                | Landing hero centerpiece                                 | 2D canvas particle field (no three.js)            | Static poster frame                            |
| 3   | Huge tight neo-grotesque display wordmark (lusion/downbeat)   | Hero + footer giant type                                 | Inter variable 800/900, −0.04em                   | Static (type only)                             |
| 4   | Uppercase micro-labels (lusion)                               | Section eyebrows, "SCROLL TO EXPLORE"                    | Inter 500 uppercase, tracking +0.08em             | Static                                         |
| 5   | Crosshair registration marks (lusion)                         | Hero mid-line grid                                       | SVG/DOM plus-marks                                | Static                                         |
| 6   | Virtual/inertial smooth scroll (lusion) + Lenis (downbeat)    | Whole landing                                            | `lenis` (installed) + rAF                         | Native scroll (Lenis off)                      |
| 7   | Scroll-progress segmented bar (downbeat)                      | Under landing nav                                        | Scroll-linked scaleX segments                     | Static full bar                                |
| 8   | Line-mask text reveal (downbeat `.ln`)                        | Manifesto + section titles                               | overflow-hidden line + inner translateY, expo-out | Fully visible, no transform                    |
| 9   | Scroll word-by-word highlight (downbeat)                      | Manifesto statement                                      | Per-word opacity/color mapped to scroll progress  | All words full-opacity                         |
| 10  | Pinned horizontal showcase (downbeat)                         | Product-surface showcase (Chat→Dash→Run→Evidence→Replay) | sticky 100vh + `w-max` track translated by scroll | Native horizontal scroll-snap / vertical stack |
| 11  | Proximity word-glow on display type (downbeat, owner's ask)   | Hero headline + big CTA words                            | Per-char spans, distance→scale+glow, rAF          | Disabled (native cursor, static text)          |
| 12  | Custom cursor dot+ring (award-site standard)                  | Landing + app (fine pointer only)                        | rAF-lerped dot+ring, morph on interactive         | Disabled on touch/reduced-motion               |
| 13  | Waveform/equalizer canvas bars (downbeat)                     | Jev routing visualizer accent / hero ambience            | canvas bars driven by real routing telemetry      | Static bars                                    |
| 14  | SVG edge draw-on-scroll (pipeline)                            | "How it works" D1 pipeline                               | stroke-dashoffset scrubbed by ScrollTrigger       | Fully drawn statically                         |
| 15  | Stagger node entrance (lusion/downbeat cards)                 | Capability grid, pipeline nodes                          | ScrollTrigger batch stagger                       | All visible                                    |
| 16  | Count-up counters on first view (downbeat)                    | Evidence/verification stats                              | rAF count on IntersectionObserver                 | Final value shown immediately                  |
| 17  | Full-bleed rounded media cards (lusion projects)              | Showcase panels / benchmark teaser                       | rounded-2xl overflow-hidden framed panels         | Static stack                                   |
| 18  | Count + diagonal-arrow meta (lusion projects)                 | Section headers (e.g. "06 / ↘")                          | mono numeral + SVG arrow                          | Static                                         |
| 19  | Magnetic button hover (already in repo `motion/magnetic.tsx`) | Primary CTAs                                             | existing magnetic component                       | Disabled                                       |
| 20  | Pointer-follow sheen (already in repo `motion/sheen.tsx`)     | Hero panel + cards                                       | existing sheen component                          | Disabled                                       |
| 21  | Grain overlay (already in repo `motion/grain-overlay.tsx`)    | Global ambience                                          | existing grain overlay                            | Static/removed                                 |
| 22  | Nav transparent→solid on scroll, hide-down/show-up (lusion)   | Landing nav                                              | scroll listener toggling classes                  | Always solid                                   |
| 23  | Animated full-overlay mobile menu (award-site standard)       | Landing nav mobile                                       | AnimatePresence-less CSS/DOM overlay              | Plain stacked links                            |
| 24  | Accordion FAQ with smooth height (standard)                   | FAQ section                                              | grid-template-rows 0fr→1fr transition             | Instant open/close                             |
| 25  | Giant-type footer moment (lusion)                             | Footer                                                   | oversized wordmark + columns                      | Static                                         |
| 26  | Page-transition overlay (lusion `transition-overlay`)         | Route changes (app)                                      | 2D canvas/clip wipe, short                        | None (instant)                                 |
| 27  | Easing character: long expo-out `cubic-bezier(0.16,1,0.3,1)`  | All reveals (signature ease)                             | motion token `--ease-expo`                        | n/a                                            |
| 28  | Dark immersive canvas + one accent (both refs)                | Whole site (single dark system)                          | design tokens                                     | n/a                                            |
