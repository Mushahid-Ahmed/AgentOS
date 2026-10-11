# UI/UX Take 2 — Phase A reference study

Studied live on 2026-10-08 with a Playwright harness (`scripts/tmp-t2-lusion-study.mjs`,
raw capture at `_lh/lusion/study.json`, frames at `_lh/lusion/01-idle.png`,
`02-after-pointer.png`, `03-after-scroll.png`). Reference under study:
**https://lusion.co/about** ("Lusion - About Us"), the page the brief names as the
target for the hero background.

We adopted **techniques only**. No shader source, texture, model, font or asset was
copied, and none of their code is in this repo.

## 1. What the page actually is

| Fact | Measured |
| --- | --- |
| Renderer | One `webgl2` canvas, `id="canvas"`, 1440×900 attribute **and** CSS size, `position: fixed`, direct child of `<body>` |
| GL version string | `WebGL 2.0 (OpenGL ES 3.0 Chromium)` |
| Float render support | `EXT_color_buffer_float`, `EXT_color_buffer_half_float`, `EXT_float_blend`, `OES_texture_float_linear` |
| Scene graph | Three.js (`window.THREE` present): **94 shaders, 47 programs, 47 textures, 25 framebuffer objects** |
| Other canvases | a 45×45 `2d` canvas inside a `<button>` (their custom cursor), and `#transition-overlay`, a 1442×902 `2d` canvas at `z-index: 100` (page transitions) |
| Document scroll height | **900px** — the document does not scroll; the scene is one viewport and virtual scroll is a shader uniform |
| Type | body font `Aeonik` (proprietary; our equivalent is Inter, already loaded) |
| Palette | near-black canvas, white text |
| Console errors / failed requests | none / two blocked Google Analytics beacons |

That last structural row is the biggest idea on the page: the scroll bar is a lie.
`u_scrollOffset`, `u_scrollRatio`, `u_scrollY` and `u_introTime` are fed into the
compositor, so "scrolling" is an animation parameter rather than a document
movement. We did **not** copy that — our landing must stay a normal scrolling
document for semantics, anchors, find-in-page and SEO.

## 2. The fluid vocabulary (the part we adopted)

159 unique uniform names were recorded across the 94 shaders. Two clusters define
the hero look:

**Simulation / paint pass**

`u_prevPaintTexture` · `u_lowPaintTexture` · `u_paintTexelSize` · `u_vel` ·
`u_curlScale` · `u_curlStrength` · `u_pushStrength` · `u_dissipations` ·
`u_drawFrom` · `u_drawTo` · `u_scrollOffset` · `u_noiseTime` · `u_noiseScale` ·
`u_noiseStableFactor` · `u_mouse` · `u_delta`

Read straight off those names, this is a dye field painted into a ping-pong
texture (`prev → next`), advected by a velocity field `u_vel` whose energy comes
from **curl noise** (`u_curlScale` / `u_curlStrength`), pushed by the pointer
(`u_pushStrength`, `u_mouse`), and decayed per-frame (`u_dissipations`), with a
low-resolution copy (`u_lowPaintTexture`) for cheap glow. Shader word counts
confirm it: `curl`, `noise`, `simplex`, `velocity`, `mouse`, `dither`, `bloom`,
`blur` all appear in the source.

**Post stack**

`u_bloomTexture` · `u_vignetteFrom/To/Aspect/Color` · `u_rgbShift` ·
`u_haloWidth/Strength/RGBShift/MaskInner/MaskOuter` · `u_blueNoiseTexture` +
`u_ditherSeed` · `u_channelMixer{R,G,B,A}` · `u_contrast` · `u_brightness` ·
`u_tintColor/u_tintOpacity` · `u_blurRatio` · `u_glitchOffset/Strength/Threshold`

Blue-noise dithering under a bloom/vignette stack is how they keep a dark gradient
from banding. Our display pass uses a cheap hash dither for the same reason.

**DOM-to-canvas welding** (studied, not adopted)

`u_toDomXY` · `u_toDomWH` · `u_toDomPivot` · `u_domXY` · `u_domWH` ·
`u_domPivot` · `u_domPadding` · `u_letterIdx` — they project DOM rectangles into
the GL scene (and drive per-letter text animation). Out of scope for our budget.

## 3. What we built instead, and why

`src/lib/motion/fluid-layer.ts` implements the same *idea* in **two passes and
zero dependencies**: one ping-pong `RGBA16F` simulation texture (rg = velocity,
b = dye, a = pointer trace) driven by self-advection + curl-of-fbm + pointer
push + dissipation, and one display pass that domain-warps fbm by that field
under the brand palette with an edge falloff, a centre scrim for headline
contrast, and dither. Lusion spends 47 programs and 25 FBOs on this; a
localhost demo against a metered API does not need to. See
`docs/uiux-take2-decisions-log.md` T2-D1.

## 4. Honest UNKNOWNs from this study

- **Frame rate: not measured.** The rAF sampler returned `{"frames":0,
  "medianMs":0,"impliedFps":0}` and every `readPixels` mean returned `[0,0,0]`
  across `before` / `afterSweep` / `afterIdle` / `afterScroll` — with
  `document.hidden === false` at capture time, so tab throttling does not
  explain it away, and a zero-frame sample plus a zeroed backbuffer is
  **inconclusive, not evidence** that the page is idle or black. (An earlier
  attempt through the browser-use MCP was separately unusable because that tab
  *was* backgrounded and reported the WebGL canvas as 0×0.) We are claiming
  nothing about Lusion's fps.
- We did not attempt to reproduce their bloom, TAA, halo, RGB-shift, glitch or
  light-field passes, so the "premium" delta between their hero and ours that is
  attributable to those passes is unquantified.
- The 45×45 `2d` canvas inside a button is *their* cursor; we recorded its
  existence and geometry only, not its behaviour.
