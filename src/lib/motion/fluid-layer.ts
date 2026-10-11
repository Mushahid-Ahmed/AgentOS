/* -------------------------------------------------------------------------- */
/*  fluid-layer — an original WebGL2 fluid field for the hero (Take 2, §4).    */
/*                                                                            */
/*  Plain module, no React: the Next 16 React Compiler scans component bodies  */
/*  and reads `gl.useProgram()` as a hook call, so the engine lives here and   */
/*  the component (landing/hero-fluid.tsx) only mounts and unmounts it.         */
/*                                                                            */
/*  Technique adopted from the Lusion about page, which I studied live in        */
/*  Phase A: a WebGL2 + Three.js compositor whose paint pass exposes            */
/*  u_prevPaintTexture / u_vel / u_curlScale / u_curlStrength / u_pushStrength  */
/*  / u_dissipations / u_scrollOffset — i.e. a dye field advected by a          */
/*  curl-noise velocity field, pushed by the pointer, dissipating over time,    */
/*  under a bloom + TAA + vignette post stack. We implement the SAME IDEA in    */
/*  two passes with no dependency and no copied asset: one ping-pong            */
/*  simulation texture (rg = velocity, b = dye, a = pointer trace) + one        */
/*  display pass that domain-warps fbm noise by that field.                     */
/*                                                                            */
/*  Budgets: shader source only (no textures or models); the simulation runs    */
/*  on a fixed ~280px-tall grid no matter how large the screen; DPR is capped;  */
/*  the RAF loop pauses off-screen and on tab hide; unmount releases every      */
/*  GL object AND loses the context, so nothing survives a route change.        */
/* -------------------------------------------------------------------------- */

const SIM = `#version 300 es
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_texel;
uniform vec2 u_mouse;
uniform vec2 u_mouseVel;
uniform float u_time;
uniform float u_delta;
uniform float u_aspect;
out vec4 outColor;

float hash(vec2 p){ p = fract(p * vec2(127.31, 241.73)); p += dot(p, p + 31.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
// Curl of a scalar potential: a divergence-free-ish flow, the same family of
// idea the reference's u_curl* uniforms describe.
vec2 curl(vec2 p, float t){
  float e = 0.06;
  float n1 = fbm(p + vec2(0.0, t));
  float n2 = fbm(p + vec2(0.0, t) + vec2(e, 0.0));
  float n3 = fbm(p + vec2(0.0, t) + vec2(0.0, e));
  return vec2(n3 - n1, -(n2 - n1)) / e;
}

void main(){
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec4 prev = texture(u_prev, uv);
  vec2 vel = prev.rg;
  float dye = prev.b;

  vec2 back = uv - vel * u_delta * vec2(u_aspect, 1.0) * 0.06;
  vec4 adv = texture(u_prev, clamp(back, vec2(0.0), vec2(1.0)));
  vec2 c = curl(uv * vec2(u_aspect, 1.0) * 2.6, u_time * 0.055);

  vel = mix(adv.rg, vel, 0.5) * 0.982 + c * 0.9e-3;

  vec2 d = (uv - u_mouse) * vec2(u_aspect, 1.0);
  float fall = exp(-dot(d, d) * 26.0);
  vel += u_mouseVel * fall * 0.9;
  dye += fall * length(u_mouseVel) * 0.55;

  dye *= 0.988;
  float band = clamp(adv.a * 0.99 + fall * 0.35, 0.0, 1.0);
  float speed = length(vel);
  vel = clamp(vel, vec2(-2.5), vec2(2.5));
  outColor = vec4(vel, clamp(dye + speed * 0.06, 0.0, 1.0), band);
}`

const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;

float hash(vec2 p){ p = fract(p * vec2(127.31, 241.73)); p += dot(p, p + 31.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.07 + 7.1; a *= 0.5; }
  return v;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);

  vec4 field = texture(u_field, uv);
  float energy = clamp(field.b, 0.0, 1.0);
  vec2 vel = field.rg;

  vec2 q = p * 1.6 + vec2(u_time * 0.012, -u_time * 0.009);
  vec2 w1 = vec2(fbm(q + vel * 0.30), fbm(q + vec2(3.1, 5.2) + vel * 0.30));
  vec2 w2 = vec2(fbm(q + 2.1 * w1 + vec2(1.7, 9.2) + vel * 0.55), fbm(q + 2.1 * w1 + vec2(8.3, 2.8) + vel * 0.55));
  float f = fbm(q + 2.3 * w2);

  vec3 ink = vec3(0.039, 0.039, 0.043);
  vec3 blue = vec3(0.357, 0.486, 0.980);
  vec3 cyan = vec3(0.541, 0.737, 0.929);
  vec3 violet = vec3(0.439, 0.396, 0.886);

  float t1 = smoothstep(0.18, 0.78, f + 0.28 * length(vel));
  float t2 = smoothstep(0.42, 0.96, f * 1.25 + energy * 0.9);
  vec3 col = mix(ink, blue * 0.55, t1);
  col = mix(col, cyan * 0.75, t2);
  col = mix(col, violet * 0.55, smoothstep(0.62, 1.0, f * 1.4) * 0.5);
  col += blue * energy * 0.5;
  col += vec3(0.06, 0.09, 0.16) * field.a;

  float edge = smoothstep(1.35, 0.35, length(p));
  col *= 0.35 + 0.65 * edge;
  float scrim = smoothstep(0.10, 0.62, length(p * vec2(0.82, 1.0)));
  col *= 0.42 + 0.58 * scrim;
  col = mix(ink, col, 0.94);

  col += (hash(frag + u_time) - 0.5) * 0.018;
  outColor = vec4(max(col, vec3(0.0)), 1.0);
}`

// One oversized triangle covers the viewport; the fragment derives its own uv.
const VERT = `#version 300 es
precision highp float;
void main(){
  vec2 pos = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}`

const SIM_H = 280
const SCALE_MIN = 0.4
const noop = () => {}

export type FluidLayer = { stop: () => void; reason: string }

export function createFluidLayer(canvas: HTMLCanvasElement): FluidLayer {
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: false,
		depth: false,
		stencil: false,
		powerPreference: 'low-power'
	})
	if (!gl) return { stop: noop, reason: 'no-webgl2' }
	if (gl.isContextLost()) return { stop: noop, reason: 'context-lost' }
	if (!gl.getExtension('EXT_color_buffer_float')) return { stop: noop, reason: 'no-float-render' }

	let failReason = ''
	const compile = (type: number, src: string) => {
		const s = gl.createShader(type)
		if (!s) return null
		gl.shaderSource(s, src)
		gl.compileShader(s)
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			failReason = 'compile: ' + String(gl.getShaderInfoLog(s)).slice(0, 180)
			return null
		}
		return s
	}
	const buildProgram = (fragSrc: string) => {
		const v = compile(gl.VERTEX_SHADER, VERT)
		const f = compile(gl.FRAGMENT_SHADER, fragSrc)
		if (!v || !f) return null
		const p = gl.createProgram()
		if (!p) return null
		gl.attachShader(p, v)
		gl.attachShader(p, f)
		gl.linkProgram(p)
		gl.deleteShader(v)
		gl.deleteShader(f)
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
			failReason = 'link: ' + String(gl.getProgramInfoLog(p)).slice(0, 180)
			return null
		}
		return p
	}

	const simProg = buildProgram(SIM)
	const dispProg = buildProgram(DISPLAY)
	if (!simProg || !dispProg) {
		if (simProg) gl.deleteProgram(simProg)
		if (dispProg) gl.deleteProgram(dispProg)
		return { stop: noop, reason: failReason || 'shader-failure' }
	}

	type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }
	const makeTarget = (w: number, h: number): Target => {
		const tex = gl.createTexture()!
		gl.bindTexture(gl.TEXTURE_2D, tex)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		const fb = gl.createFramebuffer()!
		gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
		return { tex, fb, w, h }
	}

	const vao = gl.createVertexArray()!
	gl.bindVertexArray(vao)

	let prev = makeTarget(2, 2)
	let curr = makeTarget(2, 2)
	let W = 1
	let H = 1
	let sw = 2
	let sh = 2
	// Adaptive display resolution. The field is low-frequency smoke, so the
	// composite pass can run at a fraction of the CSS size and be upscaled by
	// the browser almost invisibly — that is the one lever that actually saves
	// a weak device, since the cost is per fragment. It starts at 1 and walks
	// down when measured frame time says we are missing frames (see frame()).
	let scale = 1
	let scaleCeiling = 1

	const sizeDisplay = () => {
		const dpr = Math.min(1.75, window.devicePixelRatio || 1)
		canvas.width = Math.max(1, Math.floor(W * dpr * scale))
		canvas.height = Math.max(1, Math.floor(H * dpr * scale))
	}
	const sizeSim = () => {
		sh = SIM_H
		sw = Math.max(64, Math.round((sh * W) / Math.max(1, H)))
		gl.deleteTexture(prev.tex)
		gl.deleteFramebuffer(prev.fb)
		gl.deleteTexture(curr.tex)
		gl.deleteFramebuffer(curr.fb)
		prev = makeTarget(sw, sh)
		curr = makeTarget(sw, sh)
		gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fb)
		gl.bindTexture(gl.TEXTURE_2D, prev.tex)
		gl.clearColor(0, 0, 0, 0)
		gl.clear(gl.COLOR_BUFFER_BIT)
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
	}
	const resize = () => {
		W = Math.max(1, canvas.clientWidth)
		H = Math.max(1, canvas.clientHeight)
		sizeDisplay()
		sizeSim()
	}
	resize()

	const loc = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n)
	const simU = {
		prev: loc(simProg, 'u_prev'),
		texel: loc(simProg, 'u_texel'),
		mouse: loc(simProg, 'u_mouse'),
		mouseVel: loc(simProg, 'u_mouseVel'),
		time: loc(simProg, 'u_time'),
		delta: loc(simProg, 'u_delta'),
		aspect: loc(simProg, 'u_aspect')
	}
	const dispU = {
		field: loc(dispProg, 'u_field'),
		res: loc(dispProg, 'u_res'),
		time: loc(dispProg, 'u_time')
	}

	const mouse = { x: -9, y: -9, vx: 0, vy: 0, has: false }
	const onMove = (e: PointerEvent) => {
		const r = canvas.getBoundingClientRect()
		const nx = (e.clientX - r.left) / Math.max(1, r.width)
		const ny = 1 - (e.clientY - r.top) / Math.max(1, r.height)
		if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
			mouse.has = false
			return
		}
		if (mouse.has) {
			mouse.vx = (nx - mouse.x) * 22
			mouse.vy = (ny - mouse.y) * 22
		}
		mouse.x = nx
		mouse.y = ny
		mouse.has = true
	}
	const onLeave = () => {
		mouse.has = false
		mouse.x = -9
		mouse.y = -9
	}

	let running = true
	let raf = 0
	let last = performance.now()
	const t0 = last

	// Frame-time controller: smooth the measured gap, then trade resolution for
	// frames when it drifts past a 60Hz budget. `scaleCeiling` records the size
	// that failed so the loop can never oscillate back into it.
	let emaMs = 16.7
	let frameCount = 0
	let tuneAt = 0
	const tune = (now: number, elapsed: number) => {
		emaMs += (Math.min(400, elapsed) - emaMs) * 0.12
		frameCount++
		// Skip the warm-up: shader compile and the first draw are one-off stalls,
		// and reacting to them would shrink the hero for no reason. The window is
		// time-based, not frame-based — a device that needs the rescue is also the
		// device that takes 40 frames to reach a frame count.
		if (frameCount < 8 || now - t0 < 1200 || now < tuneAt) return
		tuneAt = now + 500
		if (emaMs > 24 && scale > SCALE_MIN) {
			scaleCeiling = Math.max(SCALE_MIN, scale - 0.05)
			scale = Math.max(SCALE_MIN, scale - 0.15)
			sizeDisplay()
		} else if (emaMs < 9 && scale < scaleCeiling) {
			scale = Math.min(scaleCeiling, scale + 0.1)
			sizeDisplay()
		}
		canvas.dataset.t2Scale = scale.toFixed(2)
		canvas.dataset.t2FrameMs = emaMs.toFixed(1)
	}

	const frame = (now: number) => {
		raf = 0
		const elapsed = now - last
		last = now
		const dt = Math.min(0.05, elapsed / 1000)
		const time = (now - t0) / 1000
		tune(now, elapsed)

		gl.useProgram(simProg)
		gl.bindFramebuffer(gl.FRAMEBUFFER, curr.fb)
		gl.viewport(0, 0, sw, sh)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D, prev.tex)
		gl.uniform1i(simU.prev!, 0)
		gl.uniform2f(simU.texel!, 1 / sw, 1 / sh)
		gl.uniform2f(simU.mouse!, mouse.has ? mouse.x : -9, mouse.has ? mouse.y : -9)
		gl.uniform2f(simU.mouseVel!, mouse.vx, mouse.vy)
		gl.uniform1f(simU.time!, time)
		gl.uniform1f(simU.delta!, dt)
		gl.uniform1f(simU.aspect!, W / Math.max(1, H))
		gl.drawArrays(gl.TRIANGLES, 0, 3)
		const swap = prev
		prev = curr
		curr = swap
		mouse.vx *= 0.55
		mouse.vy *= 0.55

		gl.useProgram(dispProg)
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.viewport(0, 0, canvas.width, canvas.height)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindTexture(gl.TEXTURE_2D, prev.tex)
		gl.uniform1i(dispU.field!, 0)
		gl.uniform2f(dispU.res!, canvas.width, canvas.height)
		gl.uniform1f(dispU.time!, time)
		gl.drawArrays(gl.TRIANGLES, 0, 3)

		if (running) raf = requestAnimationFrame(frame)
	}
	raf = requestAnimationFrame(frame)

	const resume = () => {
		last = performance.now()
		if (!raf) raf = requestAnimationFrame(frame)
	}
	const onVisibility = () => {
		running = !document.hidden
		if (running) resume()
	}
	const io = new IntersectionObserver(([entry]) => {
		running = !!entry && entry.isIntersecting && !document.hidden
		if (running) resume()
	})
	io.observe(canvas)
	window.addEventListener('resize', resize)
	window.addEventListener('pointermove', onMove, { passive: true })
	canvas.addEventListener('pointerleave', onLeave)
	document.addEventListener('visibilitychange', onVisibility)

	return {
		reason: '',
		stop: () => {
			cancelAnimationFrame(raf)
			raf = 0
			running = false
			io.disconnect()
			window.removeEventListener('resize', resize)
			window.removeEventListener('pointermove', onMove)
			canvas.removeEventListener('pointerleave', onLeave)
			document.removeEventListener('visibilitychange', onVisibility)
			gl.deleteProgram(simProg)
			gl.deleteProgram(dispProg)
			gl.deleteTexture(prev.tex)
			gl.deleteFramebuffer(prev.fb)
			gl.deleteTexture(curr.tex)
			gl.deleteFramebuffer(curr.fb)
			gl.deleteVertexArray(vao)
			// Release the context only once the canvas has actually left the
			// document. During a dev StrictMode double-invoke the element survives,
			// and getContext() hands back the *identical* object after loseContext()
			// — permanently lost — so losing it there poisons the remount (measured:
			// scripts/tmp-t2-lostprobe.mjs). A route change does detach the element,
			// so nothing survives navigation (§12: no leaked GL context).
			if (!canvas.isConnected) {
				gl.getExtension('WEBGL_lose_context')?.loseContext()
			}
		}
	}
}
