import { useEffect, useRef } from 'react';
import type { MotionLevel } from '../motion/level';

/**
 * The orb's face: a small liquid sphere drawn on the GPU. Colours flow inside it, its rim and
 * highlight follow the one light (and the page's tilt, read from --tx/--ty on <html>), and it
 * swells and stirs faster while you type. Full motion only; elsewhere (or without WebGL) it is the
 * plain CSS orb (see face.css).
 *
 * Port note: this is Orbit's `apps/ai/AiOrb.tsx` with one change: the motion level comes in as a
 * prop (`level`) instead of from Orbit's MotionProvider context. The shader and every number are
 * unchanged. The rendered element keeps the class names `ai-orb` / `ai-orb-gpu` / `ai-orb-eyes`
 * so Orbit's CSS for it (copied to face.css) applies as before.
 */
const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform float t;
uniform float energy;
uniform vec2 tilt;
// The face: how visible (0…1), where it looks (-1…1), eyelids (0 open … 1 shut), mood (-1 sad … 1 happy),
// how much it talks (0…1, the mouth moves) and sleepiness (heavy lids, a flat mouth).
uniform float faceOn;
uniform vec2 gaze;
uniform float lids;
uniform float mood;
uniform float talk;
uniform float sleepy;
// A sin-free hash: stays smooth on phone GPUs where sin() of big numbers turns blocky.
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  float size = 0.86 + energy * 0.1;
  vec2 q = uv / size;
  float r = length(q);
  float edge = 1.0 - smoothstep(0.97, 1.0, r);
  if (edge <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r * r)));
  // Liquid inside: two layers of flowing noise, stirred harder with energy.
  float speed = 0.25 + energy * 0.9;
  vec2 w = n.xy / (0.6 + n.z * 0.4) * (1.1 + energy * 0.4);
  float f1 = fbm(w + vec2(t * speed, -t * speed * 0.7));
  float f2 = fbm(w * 1.7 + f1 * 2.0 - vec2(t * speed * 0.5, 0.0));
  vec3 violet = vec3(0.55, 0.36, 0.96), cyan = vec3(0.02, 0.71, 0.83), green = vec3(0.13, 0.77, 0.37), amber = vec3(0.96, 0.62, 0.04);
  vec3 col = mix(violet, cyan, smoothstep(0.25, 0.75, f2));
  col = mix(col, green, smoothstep(0.62, 0.9, f1) * 0.6);
  col = mix(col, amber, smoothstep(0.75, 0.95, f2 * f1 * 1.6) * 0.5);
  // Glass shell: darker at the core edge, bright rim (fresnel) and one specular highlight from the light.
  vec3 L = normalize(vec3(-0.55 - tilt.x * 0.45, 0.6 + tilt.y * 0.45, 0.75));
  float diffuse = 0.55 + 0.45 * max(dot(n, L), 0.0);
  float fres = pow(1.0 - n.z, 2.4);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
  col = col * diffuse + fres * vec3(0.75, 0.85, 1.0) * 0.7 + spec * 0.9;
  if (faceOn > 0.01 && n.z > 0.05) {
    // Drawn in longitude/latitude on the sphere, so the features bend with its curve and squash
    // towards the rim when it looks aside.
    float lon = atan(n.x, n.z), lat = asin(clamp(n.y, -1.0, 1.0));
    vec2 c = vec2(gaze.x * 0.55, gaze.y * 0.38);
    float shut = clamp(max(lids, sleepy * 0.55), 0.0, 0.94);
    float eyes = 0.0;
    for (int i = 0; i < 2; i++) {
      float side = i == 0 ? -1.0 : 1.0;
      vec2 e = vec2(lon - (c.x + side * 0.30), lat - (c.y + 0.13));
      // Happy eyes squint into arcs; sad ones droop at the outer corner.
      e.y += mood * 0.05 * (1.0 - smoothstep(0.0, 0.1, abs(e.x))) * step(0.0, mood);
      e.y -= min(mood, 0.0) * 0.06 * side * e.x * 6.0;
      float h = 0.15 * (1.0 - shut);
      float d = length(vec2(e.x / 0.085, e.y / max(h, 0.012)));
      eyes = max(eyes, 1.0 - smoothstep(0.82, 1.0, d));
    }
    float mx = (lon - c.x) / 0.24;
    float open = talk * (0.35 + 0.65 * abs(sin(t * 13.0 + sin(t * 5.0) * 2.0)));
    float curve = (mood * (1.0 - sleepy)) * 0.075 * (mx * mx - 1.0);
    float my = lat - (c.y - 0.2 + curve);
    float thick = 0.02 + open * 0.06;
    float mouth = (1.0 - smoothstep(0.85, 1.0, abs(mx))) * (1.0 - smoothstep(thick * 0.6, thick, abs(my)));
    float ink = max(eyes, mouth) * faceOn * smoothstep(0.05, 0.35, n.z);
    col = mix(col, vec3(0.06, 0.05, 0.12), ink * 0.88);
    // A glint in each eye catches the light.
    col += ink * eyes * spec * 0.6;
  }
  gl_FragColor = vec4(col * edge, edge);
}`;

/**
 * `energy` (0…1), when given, drives the orb directly, e.g. from the microphone level in a voice chat.
 * `resolution` draws it sharper than its box, for an orb that is scaled up on screen (the cursor orb
 * growing into a stage).
 */
export interface OrbFaceState {
  /** Show the face (it fades in and out). */
  on: boolean;
  /** Where it looks, -1…1 on each axis (right / up are positive). */
  gaze: [number, number];
  /** -1 sad … 0 neutral … 1 happy. */
  mood: number;
  /** Talking: the mouth moves. */
  talk: boolean;
  /** Heavy lids and a flat mouth (nothing to think with). */
  sleepy: boolean;
}

export function OrbFace({
  typing,
  energy: drive,
  className = '',
  resolution = 1,
  face,
  level,
}: {
  typing: boolean;
  energy?: number;
  className?: string;
  resolution?: number;
  face?: OrbFaceState;
  /** The motion level: 'full' draws on the GPU, 'lite' is the CSS orb with eyes, 'off' the CSS orb with no face. */
  level: MotionLevel;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(0.25);
  target.current = drive != null ? Math.max(0.15, Math.min(1, drive)) : typing ? 1 : 0.25;
  const gpu = level === 'full' && typeof WebGLRenderingContext !== 'undefined';
  const faceRef = useRef<OrbFaceState | undefined>(face);
  faceRef.current = face;
  // Sharper only while it needs to be (drawing is the cost): changing it resizes, never rebuilds.
  const res = useRef(resolution);
  res.current = resolution;
  const resize = useRef<(() => void) | null>(null);
  useEffect(() => resize.current?.(), [resolution]);

  useEffect(() => {
    const canvas = ref.current;
    if (!gpu || !canvas) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!gl) return void (canvas.dataset.fallback = 'true');
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return void (canvas.dataset.fallback = 'true');
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uT = gl.getUniformLocation(prog, 't');
    const uE = gl.getUniformLocation(prog, 'energy');
    const uTilt = gl.getUniformLocation(prog, 'tilt');
    const uFace = gl.getUniformLocation(prog, 'faceOn');
    const uGaze = gl.getUniformLocation(prog, 'gaze');
    const uLids = gl.getUniformLocation(prog, 'lids');
    const uMood = gl.getUniformLocation(prog, 'mood');
    const uTalk = gl.getUniformLocation(prog, 'talk');
    const uSleepy = gl.getUniformLocation(prog, 'sleepy');
    // Eased face values, and the next blink.
    const fv = { on: 0, gx: 0, gy: 0, mood: 0, talk: 0, sleepy: 0, lids: 0 };
    let blinkAt = 0;
    const root = document.documentElement;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = () => {
      // clientWidth, not the on-screen box: the window may still be scaled mid-animation.
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr * res.current));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr * res.current));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize.current = size;
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    size();

    let energy = target.current;
    let time = 0;
    let last = 0;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      // Idle: a calm 30 frames a second is plenty; typing runs at full rate.
      const f = faceRef.current;
      const faceLive = Boolean(f?.on) || fv.on > 0.02;
      if (!visible || document.hidden || (energy < 0.4 && !faceLive && now - last < 32)) return;
      last = now;
      energy += (target.current - energy) * Math.min(1, dt * 6);
      time += dt;
      gl.uniform1f(uT, time);
      gl.uniform1f(uE, energy);
      gl.uniform2f(uTilt, Number(root.style.getPropertyValue('--tx') || 0), Number(root.style.getPropertyValue('--ty') || 0));
      const k = Math.min(1, dt * 7);
      fv.on += ((f?.on ? 1 : 0) - fv.on) * Math.min(1, dt * 5);
      fv.gx += ((f?.gaze[0] ?? 0) - fv.gx) * k;
      fv.gy += ((f?.gaze[1] ?? 0) - fv.gy) * k;
      fv.mood += ((f?.mood ?? 0) - fv.mood) * k;
      fv.talk += ((f?.talk ? 1 : 0) - fv.talk) * Math.min(1, dt * 10);
      fv.sleepy += ((f?.sleepy ? 1 : 0) - fv.sleepy) * Math.min(1, dt * 3);
      // A blink every few seconds (quick shut, quick open); sleepy blinks are slow.
      if (!blinkAt) blinkAt = now + 1500 + Math.random() * 3500;
      const since = now - blinkAt;
      const len = fv.sleepy > 0.5 ? 420 : 160;
      fv.lids = since < 0 ? 0 : since < len ? Math.sin((since / len) * Math.PI) : 0;
      if (since >= len) blinkAt = now + 2200 + Math.random() * 4000;
      gl.uniform1f(uFace, fv.on);
      gl.uniform2f(uGaze, fv.gx, fv.gy);
      gl.uniform1f(uLids, fv.lids);
      gl.uniform1f(uMood, fv.mood);
      gl.uniform1f(uTalk, fv.talk);
      gl.uniform1f(uSleepy, fv.sleepy);
      canvas.dataset.face = fv.on > 0.5 ? 'on' : 'off';
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(draw);
    canvas.dataset.live = 'true';
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      delete canvas.dataset.live;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [gpu]);

  if (!gpu)
    return (
      <div className={`ai-orb ${className}`} aria-hidden style={drive != null ? { transform: `scale(${1 + Math.min(1, drive) * 0.25})` } : undefined}>
        {/* Lite: eyes that look and blink. Off: no face (nothing moves). */}
        {face?.on && level === 'lite' && (
          <span className="ai-orb-eyes" data-sleepy={face.sleepy || undefined} style={{ transform: `translate(${face.gaze[0] * 18}%, ${-face.gaze[1] * 14}%)` }}>
            <i />
            <i />
          </span>
        )}
      </div>
    );
  return <canvas ref={ref} className={`ai-orb ai-orb-gpu ${className}`} aria-hidden />;
}
