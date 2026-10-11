# UI/UX integration notes — library + font verification (anti-hallucination, §3.6)

Every dependency below was verified against the **npm registry (free GET)** before any decision,
and the already-installed ones were confirmed present in `package.json` / `node_modules`.
`[VERIFIED]` = a real command/output proves it.

## npm registry versions (queried 2026-10-08)

Command: `curl -s https://registry.npmjs.org/<pkg>/latest | node -e …print .version…`

| package         | latest  | note                                                                                                                                                      |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gsap`          | 3.15.0  | `[VERIFIED]` ScrollTrigger ships **inside** the `gsap` package (`gsap/ScrollTrigger`); no separate install.                                               |
| `lenis`         | 1.3.26  | `[VERIFIED]` canonical current name is `lenis` (formerly `@studio-freight/lenis`). **Already installed** at `^1.3.26` in `package.json` — matches latest. |
| `framer-motion` | 14.0.0  | `[VERIFIED]` successor package is `motion` (also 14.0.0). **NOT installed**; we do not add it (see decisions).                                            |
| `motion`        | 14.0.0  | `[VERIFIED]` (same line as above). Not added.                                                                                                             |
| `three`         | 0.186.1 | `[VERIFIED]` **NOT installed**; we do not add it (hero = 2D canvas, see decisions).                                                                       |
| `split-type`    | 0.3.4   | `[VERIFIED]` **NOT installed**; we split text with a small local util instead (no dep).                                                                   |

## Already installed and reused (no new install)

- `lenis@^1.3.26` — present in `package.json` dependencies. `[VERIFIED]` by reading
  `package.json`. (It was installed but **not wired** anywhere before this run — grep for
  `lenis|Lenis` matched only `package.json`, `pnpm-lock.yaml`, and docs.)
- `tailwindcss@^4.3.3` (CSS-first, `@theme`) — the token system lives in `src/app/globals.css`.
- Existing motion primitives: `src/components/motion/{grain-overlay,magnetic,sheen}.tsx`.

## New dependency added (justified, one line each — see decisions log)

- **`gsap` (^3.15.0)** — the only new package: supplies ScrollTrigger for scroll-scrubbed
  timelines, pinning and the horizontal showcase. Justification: the pinned horizontal showcase
  and pipeline draw-on-scroll are core owner asks and ScrollTrigger is the purpose-built,
  tree-shakeable tool; it is bundled in `gsap` so one install covers both.

## Fonts (verified against the `next/font/google` catalog, §8.2)

- **Display + text: Inter** (variable). Already installed via `next/font/google` in
  `[locale]/layout.tsx` as `--font-inter`; variable axis gives 100–900 so heavy display weights
  need no extra faces. Neo-grotesque character matches the references' Aeonik / Instrument Sans
  (we match character, never the proprietary file). `[VERIFIED]` present in layout.tsx.
- **Mono: IBM Plex Mono.** Already installed (`--font-ibm-plex-mono`). Lusion itself ships an
  IBM Plex Mono — same family, legally self-hosted by next/font. `[VERIFIED]` present in layout.
- **Retired: EB Garamond** (the previous editorial serif display). Removed from the display role
  because the owner re-aimed the site at the Lusion/DownBeat neo-grotesque look (§4.1 supersedes
  the light-editorial style). Kept out of the final pairing.

## Reference-site fingerprints (from live probes, see uiux-reference-study.md)

- lusion.co: Aeonik + IBMPlexMono + LusionMono; WebGL hero canvas + transition-overlay canvas;
  percentage preloader; virtual scroll (html/body overflow hidden).
- downbeat: Instrument Sans + JetBrains Mono + Mona Sans; `window.lenis` active; sticky 100vh +
  `w-max` horizontal track; line-mask `.ln` reveals; segmented scroll-progress bar.
