import { useEffect, useRef } from 'react';
import { useMotionLevel } from '../motion/MotionProvider';

/**
 * The one GPU effect (MOTION.md §7): the home screen's far layer catching the light. A soft pool of
 * light from the top-left and a faint cool bounce from the bottom-right, both sliding as you tilt
 * the phone, so the glass in front reads as sitting above something real. It draws only when the
 * tilt changes, only on the home screen, only on Full motion, and stops when the tab is hidden.
 */
const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform vec2 tilt;
uniform vec2 res;
uniform vec3 accent;
uniform float strength;
float hash(vec2 q){ vec3 p3 = fract(vec3(q.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 a = vec2(res.x / res.y, 1.0);
  vec2 q = vec2(uv.x, 1.0 - uv.y) * a;
  vec2 key = (vec2(0.22, 0.08) - tilt * vec2(0.16, 0.12)) * a;
  vec2 fill = (vec2(0.85, 0.92) + tilt * vec2(0.1, 0.08)) * a;
  float k = exp(-dot(q - key, q - key) * 3.2);
  float f = exp(-dot(q - fill, q - fill) * 4.5);
  // A faint ring where the light pool meets the glass, like light through a thick pane.
  float ring = smoothstep(0.05, 0.0, abs(length(q - key) - 0.55)) * 0.12;
  vec3 col = accent * (k * 0.55 + ring) + vec3(0.2, 0.75, 0.9) * f * 0.22;
  float alpha = clamp((k * 0.55 + f * 0.22 + ring) * strength, 0.0, 1.0);
  // Dither so the soft gradient never bands.
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col * strength, alpha);
}`;

function rgb(css: string): [number, number, number] {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return [0.4, 0.4, 1];
  c.fillStyle = css;
  c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

export function HomeLight({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const level = useMotionLevel();
  const on = level === 'full' && active;

  useEffect(() => {
    const canvas = ref.current;
    if (!on || !canvas) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true, powerPreference: 'low-power' });
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const root = document.documentElement;
    const css = getComputedStyle(root);
    gl.uniform3fv(u('accent'), rgb(css.getPropertyValue('--accent').trim() || '#6366f1'));
    gl.uniform1f(u('strength'), root.dataset.theme === 'light' ? 0.45 : 1);

    // The light is soft, so half resolution is plenty and keeps it cheap.
    let w = 0;
    let h = 0;
    const size = () => {
      w = Math.max(1, Math.round(canvas.clientWidth * 0.5));
      h = Math.max(1, Math.round(canvas.clientHeight * 0.5));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u('res'), w, h);
      last = '';
    };
    let last = '';
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const tx = root.style.getPropertyValue('--tx') || '0';
      const ty = root.style.getPropertyValue('--ty') || '0';
      const key = `${tx},${ty},${w},${h}`;
      if (key === last) return;
      last = key;
      gl.uniform2f(u('tilt'), Number(tx), Number(ty));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    size();
    raf = requestAnimationFrame(draw);
    canvas.dataset.live = 'true';
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      delete canvas.dataset.live;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [on]);

  // A fresh canvas each time it switches on, since a lost context can't be reused.
  return on ? <canvas ref={ref} className="home-light" aria-hidden /> : null;
}
