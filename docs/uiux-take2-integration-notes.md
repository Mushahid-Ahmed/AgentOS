# UI/UX Take 2 — integration notes

Constraints found while wiring a WebGL layer, a custom cursor and per-section
motion into this specific Next.js 16 app. Each line below was hit in practice,
not copied from documentation.

## 1. WebGL library options — verified, then deliberately not installed

Checked against the registry on 2026-10-08 with `npm view <pkg> version`:

```
[VERIFIED] three@0.186.1
[VERIFIED] @react-three/fiber@9.8.1
[VERIFIED] @react-three/drei@10.7.9
[VERIFIED] ogl@1.0.11
```

All four exist and are current, so the choice not to install them is a decision,
not a blocker — see T2-D1 in `docs/uiux-take2-decisions-log.md`. The hero ships
as raw WebGL2 in one ~400-line module with no new dependency and no change to
`package.json` or the lockfile.

## 2. React Compiler rejects `gl.useProgram()` inside a component

`next.config.ts` runs `reactCompiler: { panicThreshold: 'all_errors' }`, so a
Compiler bailout fails the build instead of silently de-optimising. The Compiler
reads **any `useX(...)`-shaped call inside a function expression as a React
hook**, which includes `gl.useProgram(program)` — the build died with
`Hooks must be called at the top level… Cannot call hook within a function
expression`.

- Writing `gl['useProgram'](…)` does **not** help: the Compiler normalises the
  property name first. Measured, both forms failed identically.
- The fix that works is structural: keep the engine in a plain module
  (`src/lib/motion/fluid-layer.ts`, no `'use client'`, no React import — the
  Compiler does not visit it) and let the component
  (`src/components/landing/hero-fluid.tsx`) only mount and unmount it.

Any future GL/WebAudio/`useX`-named host API call belongs outside component
bodies for the same reason.

## 3. StrictMode + `WEBGL_lose_context` is a trap

`reactStrictMode: true`, so every effect runs mount → cleanup → mount on the
**same DOM node**. `getContext()` returns the *identical* context object after
`loseContext()`, and that object is permanently lost, so the second mount's
`getExtension('EXT_color_buffer_float')` came back null and the hero silently
rendered its static fallback with reason `no-float-render`.

Proved, not guessed, by `scripts/tmp-t2-lostprobe.mjs`:

```json
{ "freshFloatSupport": true, "lostFlag": true, "sameIdentityAfterLoss": true,
  "remountContextLost": true, "remountFloatSupport": false }
```

`stop()` therefore only calls `loseContext()` once `canvas.isConnected` is
false — which is exactly what a route change does, so the "no GL context
survives navigation" rule (§12) still holds. Verified live: after navigating to
`/login` the document has `canvases: 0`, and returning to `/` yields
`heroCanvas: true, lost: false`.

## 4. Headless measurement environment (affects every number in the report)

- Headless Chromium reports `prefers-reduced-motion: reduce` **by default**. Any
  harness that wants the animated path must pass `reducedMotion:
  'no-preference'` explicitly, or it measures the fallback and reports a lie.
- No GPU is available, so WebGL runs on the SwiftShader software rasteriser.
  Frame times measured here are **not** GPU-verified and are reported as
  software-rasterisation numbers only.
- Browser binary is pinned to `chromium_headless_shell-1248` via
  `scripts/tmp-t2-browser.mjs` (`T2_CHROME` overrides); the default Playwright
  revision is not installed in this environment.
- **GL readback does not work for evidence.** `readPixels` on a swapped
  backbuffer returns zeros, and `drawImage(glCanvas)` onto a 2D canvas returns
  transparent black for a context created without `preserveDrawingBuffer` — it
  measured `[0,0,0]` on a hero whose screenshot plainly showed the fluid. The
  working method is a composited `page.screenshot({ clip })` decoded back inside
  the page through an `Image` + 2D canvas. That is also what the visitor sees.
- Screenshotting forces `GPU stall due to ReadPixels` driver messages, so pixel
  capture and frame-time sampling must not be interleaved; the harness samples
  rAF first, then captures.

## 5. Existing design-system rules still apply

- Tailwind v4 is CSS-first (`@theme` in `src/app/globals.css`); there is no
  `tailwind.config.js`. New motion reuses `--ease-expo`, `--motion-*` durations
  and the dark tokens rather than inventing values.
- `pnpm check:tokens` rejects off-system arbitrary values; the one allowlisted
  exception in the reveal primitives is the descender-clearance `pb-[0.06em]`.
- No new font files: Inter (100–900) and IBM Plex Mono are already loaded and
  are the only two faces on every surface.
- The global `prefers-reduced-motion` kill switch in `globals.css` neutralises
  keyframe loops; component-level guards still have to handle transitions and
  anything JS-driven (the fluid layer and the cursor both check the media query
  themselves and render nothing when it matches).

## 6. Windows / repo hygiene

- `core.autocrlf` makes a repo-wide `prettier --check` meaningless locally —
  judge formatting from committed blobs, not a working-tree run.
- `pnpm test` has ~41 pre-existing Windows-environmental failures; validate with
  `tsc --noEmit` and `eslint` directly.
- The Bash tool's cwd is already inside `repo/`; a `cd repo` fails, and a `cd`
  inside one call persists into the next.
