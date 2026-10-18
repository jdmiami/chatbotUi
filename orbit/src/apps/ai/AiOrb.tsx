import { useEffect, useRef } from 'react';
import { useMotionLevel } from '../../motion/MotionProvider';

/**
 * The AI's face on the empty chat: a small liquid sphere drawn on the GPU. Colours flow inside it,
 * its rim and highlight follow the one light (and your tilt), and it swells and stirs faster while
 * you type. Full motion only; elsewhere (or without WebGL) it is the plain CSS orb.
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
  gl_FragColor = vec4(col * edge, edge);
}`;

/**
 * `energy` (0…1), when given, drives the orb directly, e.g. from the microphone level in a voice chat.
 * `resolution` draws it sharper than its box, for an orb that is scaled up on screen (the cursor orb
 * growing into the voice orb).
 */
export function AiOrb({ typing, energy: drive, className = '', resolution = 1 }: { typing: boolean; energy?: number; className?: string; resolution?: number }) {
  const level = useMotionLevel();
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(0.25);
  target.current = drive != null ? Math.max(0.15, Math.min(1, drive)) : typing ? 1 : 0.25;
  const gpu = level === 'full' && typeof WebGLRenderingContext !== 'undefined';
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
      if (!visible || document.hidden || (energy < 0.4 && now - last < 32)) return;
      last = now;
      energy += (target.current - energy) * Math.min(1, dt * 6);
      time += dt;
      gl.uniform1f(uT, time);
      gl.uniform1f(uE, energy);
      gl.uniform2f(uTilt, Number(root.style.getPropertyValue('--tx') || 0), Number(root.style.getPropertyValue('--ty') || 0));
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

  if (!gpu) return <div className={`ai-orb ${className}`} aria-hidden style={drive != null ? { transform: `scale(${1 + Math.min(1, drive) * 0.25})` } : undefined} />;
  return <canvas ref={ref} className={`ai-orb ai-orb-gpu ${className}`} aria-hidden />;
}
