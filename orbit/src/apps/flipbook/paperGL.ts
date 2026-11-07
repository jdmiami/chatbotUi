/**
 * The desk drawn on the graphics chip (WebGL2): every paper note is a fine mesh that really bends.
 *
 *  - It curls up from its bottom edge around a growing roll, the way a sticky note lifts, one corner
 *    leading; in flight it bows against the air and flutters.
 *  - Light falls from the top left (and follows the iPad's tilt): the paper is a little brighter where
 *    it faces the light, a soft sheen runs along the bend, the back of the sheet is darker with the ink
 *    faintly showing through, and every note casts a soft shadow on the desk that grows as it lifts.
 *  - The paper has grain, fibres and slightly worn edges, different on every note.
 *
 * Coordinates are the desk's own pixels (y down, z toward you), so a note lying flat in the middle
 * lands exactly under the sharp drawing canvas laid over it.
 */
import type { Place } from './layout';

export type PaperKind = 'sticky' | 'sketch' | 'lined' | 'grid' | 'kraft';
export const PAPER_KINDS: { value: PaperKind; label: string }[] = [
  { value: 'sticky', label: 'Sticky note' },
  { value: 'sketch', label: 'Sketch paper' },
  { value: 'lined', label: 'Lined' },
  { value: 'grid', label: 'Grid' },
  { value: 'kraft', label: 'Brown paper' },
];
const KIND_ID: Record<PaperKind, number> = { sticky: 0, sketch: 1, lined: 2, grid: 3, kraft: 4 };

export interface GLNote {
  /** Which note (for its texture and its own grain). */
  i: number;
  place: Place;
  /** Changes when the note's drawing changes (anything compared by identity). */
  key: unknown;
  /** Paints the note's ink (transparent background) into a square canvas `px` wide. */
  paint: (ctx: CanvasRenderingContext2D, px: number) => void;
  /** The sharp drawing canvas lies over this note: leave its ink out so it is not drawn twice. */
  hideInk: boolean;
  /** Extra curl on top of its place (the landing wobble). */
  wobble?: number;
}

const VERT = `#version 300 es
precision highp float;
in vec2 a_uv;
uniform mat4 u_model;
uniform vec3 u_view;      // desk width, height, eye distance (px)
uniform float u_bend;     // total curl from the hinge to the bottom edge (radians)
uniform float u_twist;    // -1..1: which corner leads
uniform float u_flutter;  // 0..1
uniform float u_time;
uniform float u_hinge;    // where the curl starts (from the top, 0..1)
uniform float u_zoff;     // stacking: further down the pile is a little further away
uniform float u_peel;     // 0..1: how far the roll has climbed from the bottom edge
out vec2 v_uv;
out vec3 v_normal;
out float v_curve;
void main() {
  float u = a_uv.x;
  float v = a_uv.y;
  float B = u_bend * (1.0 + u_twist * (u - 0.5) * 1.6);
  vec3 p = vec3(u - 0.5, v, 0.0);
  vec3 n = vec3(0.0, 0.0, 1.0);
  float curve = 0.0;
  if (u_peel > 0.001) {
    // Peeling: a roll climbs from the bottom edge toward the top (the right-hand corner a little
    // ahead). Paper past the roll wraps round it and lies back over the note, face down. Everything
    // stays on or above the note, so it never cuts into the paper beneath.
    const float R = 0.07;
    const float PI = 3.14159265;
    float L = 1.0 - u_peel * 0.67 - u_twist * (u - 0.5) * 0.3 * u_peel;
    float dd = v - L;
    if (dd > 0.0) {
      if (dd < PI * R) {
        float th = dd / R;
        p.y = L + R * sin(th);
        p.z = R * (1.0 - cos(th));
        n = vec3(0.0, -sin(th), cos(th));
        curve = th;
      } else {
        p.y = L - (dd - PI * R);
        p.z = 2.0 * R;
        n = vec3(0.0, 0.0, -1.0);
        curve = 0.0; // lying flat again: no sheen
      }
    }
  } else if (v > u_hinge && abs(B) > 1e-4) {
    float L = 1.0 - u_hinge;
    float k = B / L;
    float th = k * (v - u_hinge);
    p.y = u_hinge + sin(th) / k;
    p.z = (1.0 - cos(th)) / k;
    n = vec3(0.0, -sin(th), cos(th));
    curve = abs(th);
  }
  // Fluttering in the air: small waves running down the sheet, strongest at the free edge.
  float f = u_flutter * 0.035 * sin(3.14159 * u) * sin(6.2832 * (v * 1.3 - u_time * 2.6)) * v;
  p.z += f;
  vec4 w = u_model * vec4(p, 1.0);
  w.z += u_zoff;
  v_normal = normalize(mat3(u_model) * n);
  v_uv = a_uv;
  v_curve = curve;
  float W = u_view.x, H = u_view.y, D = u_view.z;
  // Seen from straight above the desk's middle: nearer (lifted) paper looks a little bigger.
  float persp = (D - w.z) / D;
  vec2 ndc = vec2(2.0 * (w.x - W * 0.5) / W, -2.0 * (w.y - H * 0.5) / H);
  gl_Position = vec4(ndc, -w.z / 4000.0 * persp, persp);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_normal;
in float v_curve;
uniform sampler2D u_ink;
uniform float u_hideInk;
uniform int u_kind;
uniform vec3 u_light;
uniform float u_seed;
uniform float u_alpha;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), s.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), s.x), s.y);
}
float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1) * 0.3 + noise(p * 4.3) * 0.15; }

vec3 paperColor(vec2 uv) {
  vec3 c;
  if (u_kind == 0) {
    c = vec3(0.965, 0.929, 0.769);
    if (uv.y < 0.075) c = vec3(0.933, 0.882, 0.651);
  } else if (u_kind == 1) {
    c = vec3(0.957, 0.945, 0.918);
  } else if (u_kind == 2) {
    c = vec3(0.969, 0.961, 0.933);
    float row = fract(uv.y * 22.0);
    if (uv.y > 0.1 && row < 0.04) c = mix(c, vec3(0.55, 0.68, 0.86), 0.55);
    if (abs(uv.x - 0.11) < 0.0025) c = mix(c, vec3(0.86, 0.42, 0.42), 0.6);
  } else if (u_kind == 3) {
    c = vec3(0.961, 0.961, 0.949);
    vec2 g = fract(uv * 20.0);
    if (g.x < 0.035 || g.y < 0.035) c = mix(c, vec3(0.62, 0.7, 0.78), 0.32);
  } else {
    c = vec3(0.847, 0.765, 0.627);
  }
  return c;
}

void main() {
  vec2 uv = v_uv;
  vec3 base = paperColor(uv);
  // Grain and fibres, different on every note.
  vec2 sp = uv * 260.0 + u_seed * 17.0;
  float grain = fbm(sp) - 0.5;
  float fibre = noise(vec2(uv.x * 900.0 + u_seed, uv.y * 60.0)) - 0.5;
  base *= 1.0 + grain * 0.07 + fibre * 0.025;
  // Slightly worn edges.
  float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float wear = smoothstep(0.0, 0.014 + noise(uv * 80.0 + u_seed) * 0.01, e);
  base *= mix(0.82, 1.0, wear);

  bool front = gl_FrontFacing;
  vec3 N = normalize(front ? v_normal : -v_normal);
  vec3 col = base;
  if (front) {
    vec4 ink = texture(u_ink, vec2(uv.x, 1.0 - uv.y));
    col = mix(col, ink.rgb, ink.a * (1.0 - u_hideInk));
  } else {
    // The back: the same paper, a touch darker, the drawing faintly showing through, mirrored.
    vec4 ink = texture(u_ink, vec2(1.0 - uv.x, 1.0 - uv.y));
    col = mix(col * 0.95, ink.rgb, ink.a * 0.1);
  }
  vec3 L = normalize(u_light);
  float diff = 0.8 + 0.2 * max(dot(N, L), 0.0);
  vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
  float sheen = pow(max(dot(N, Hh), 0.0), 36.0) * 0.22 * clamp(v_curve * 1.4, 0.0, 1.0);
  float hollow = (1.0 - N.z) * 0.06;
  col = col * (diff - hollow) + vec3(sheen);
  outColor = vec4(col, u_alpha);
}`;

const SHADOW_VERT = `#version 300 es
precision highp float;
in vec2 a_uv;
uniform vec4 u_box;   // centre x, y, half width, half height (desk px)
uniform float u_rot;  // radians
uniform float u_blur;
uniform vec3 u_view;
out vec2 v_p;
void main() {
  vec2 half_ = u_box.zw + vec2(u_blur * 2.0);
  vec2 q = (a_uv * 2.0 - 1.0) * half_;
  float c = cos(u_rot), s = sin(u_rot);
  vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + u_box.xy;
  v_p = q;
  gl_Position = vec4(2.0 * r.x / u_view.x - 1.0, 1.0 - 2.0 * r.y / u_view.y, 0.999, 1.0);
}`;

const SHADOW_FRAG = `#version 300 es
precision highp float;
in vec2 v_p;
uniform vec4 u_box;
uniform float u_blur;
uniform float u_strength;
out vec4 outColor;
void main() {
  vec2 d = abs(v_p) - u_box.zw;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float a = 1.0 - smoothstep(-u_blur, u_blur, dist);
  outColor = vec4(0.0, 0.0, 0.0, a * u_strength);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
  return sh;
}
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'a_uv');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

/** Column-major 4×4 matrices, just what a note needs: translate · rotZ · rotX · rotY · scale. */
type M4 = Float32Array;
const ident = (): M4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const rad = (d: number) => (d * Math.PI) / 180;
function rotX(d: number): M4 {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function rotY(d: number): M4 {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function rotZ(d: number): M4 {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d));
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function trans(x: number, y: number, z: number): M4 {
  const m = ident();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
function scale(s: number): M4 {
  const m = ident();
  m[0] = m[5] = m[10] = s;
  return m;
}

/** A note's model matrix: its top edge's middle at the place, turning on that edge (as the flat desk does). */
export function modelOf(p: Place, size: number): M4 {
  const rx = p.paper ? p.paper.rx : p.rx;
  const top = p.y - (p.s * size) / 2;
  return mul(mul(mul(mul(trans(p.x, top, 0), rotZ(p.rz)), rotX(rx)), rotY(p.ry)), scale(p.s * size));
}

const GRID_U = 18;
const GRID_V = 26;

interface Tex {
  key: unknown;
  canvas: HTMLCanvasElement;
  tex: WebGLTexture;
  px: number;
}

export class PaperGL {
  private gl: WebGL2RenderingContext;
  private paperProg: WebGLProgram;
  private shadowProg: WebGLProgram;
  private grid: WebGLVertexArrayObject;
  private gridCount: number;
  private quad: WebGLVertexArrayObject;
  private texes = new Map<number, Tex>();
  private w = 1;
  private h = 1;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private sloc: Record<string, WebGLUniformLocation | null> = {};

  static create(canvas: HTMLCanvasElement): PaperGL | null {
    try {
      const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
      return gl ? new PaperGL(gl) : null;
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.paperProg = program(gl, VERT, FRAG);
    this.shadowProg = program(gl, SHADOW_VERT, SHADOW_FRAG);
    for (const n of ['u_model', 'u_view', 'u_bend', 'u_twist', 'u_flutter', 'u_time', 'u_hinge', 'u_zoff', 'u_peel', 'u_ink', 'u_hideInk', 'u_kind', 'u_light', 'u_seed', 'u_alpha'])
      this.loc[n] = gl.getUniformLocation(this.paperProg, n);
    for (const n of ['u_box', 'u_rot', 'u_blur', 'u_view', 'u_strength']) this.sloc[n] = gl.getUniformLocation(this.shadowProg, n);

    // The note's mesh: a grid of points over the sheet, denser along its length (where it curls).
    const pts: number[] = [];
    for (let j = 0; j <= GRID_V; j++) for (let i = 0; i <= GRID_U; i++) pts.push(i / GRID_U, j / GRID_V);
    const idx: number[] = [];
    for (let j = 0; j < GRID_V; j++)
      for (let i = 0; i < GRID_U; i++) {
        const a = j * (GRID_U + 1) + i;
        idx.push(a, a + 1, a + GRID_U + 1, a + 1, a + GRID_U + 2, a + GRID_U + 1);
      }
    this.gridCount = idx.length;
    this.grid = gl.createVertexArray()!;
    gl.bindVertexArray(this.grid);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  resize(w: number, h: number, dpr: number) {
    const cv = this.gl.canvas as HTMLCanvasElement;
    const r = Math.min(2, dpr);
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
    this.w = w;
    this.h = h;
  }

  private texFor(n: GLNote, px: number): WebGLTexture {
    const gl = this.gl;
    let t = this.texes.get(n.i);
    if (!t || t.px !== px) {
      if (t) gl.deleteTexture(t.tex);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      t = { key: Symbol('none'), canvas, tex: gl.createTexture()!, px };
      this.texes.set(n.i, t);
    }
    if (t.key !== n.key) {
      const ctx = t.canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      n.paint(ctx, px);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t.key = n.key;
    }
    return t.tex;
  }

  /** Let go of the textures of notes no longer on the desk. */
  private sweep(keep: Set<number>) {
    for (const [i, t] of this.texes)
      if (!keep.has(i)) {
        this.gl.deleteTexture(t.tex);
        this.texes.delete(i);
      }
  }

  draw(notes: readonly GLNote[], o: { size: number; kind: PaperKind; tilt: { x: number; y: number }; time: number }) {
    const gl = this.gl;
    const cv = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const view = [this.w, this.h, Math.max(this.w, this.h) * 2.2] as const;
    const light = [-0.35 + o.tilt.x * 0.6, -0.6 + o.tilt.y * 0.5, 1.0] as const;
    const order = [...notes].filter((n) => n.place.o > 0.01).sort((a, b) => a.place.z - b.place.z);

    // Shadows on the desk first: soft, bigger and further off as a note lifts.
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.shadowProg);
    gl.bindVertexArray(this.quad);
    gl.uniform3f(this.sloc.u_view, ...view);
    for (const n of order) {
      const p = n.place;
      const lift = Math.min(1, p.lift + Math.abs(p.paper?.bend ?? 0) * 0.25);
      const half = (p.s * o.size) / 2;
      const off = 3 + lift * 22;
      gl.uniform4f(this.sloc.u_box, p.x + off * 0.45 + o.tilt.x * -6, p.y + off, half * (1 - lift * 0.05), half * (1 - lift * 0.08));
      gl.uniform1f(this.sloc.u_rot, rad(p.rz));
      gl.uniform1f(this.sloc.u_blur, 3 + lift * 26);
      gl.uniform1f(this.sloc.u_strength, (0.38 - lift * 0.14) * p.o);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // The desk's y runs down the screen, which turns triangles over: the front of the paper winds clockwise.
    gl.frontFace(gl.CW);
    gl.useProgram(this.paperProg);
    gl.bindVertexArray(this.grid);
    gl.uniform3f(this.loc.u_view, ...view);
    gl.uniform3f(this.loc.u_light, ...light);
    gl.uniform1f(this.loc.u_time, o.time);
    gl.uniform1i(this.loc.u_kind, KIND_ID[o.kind]);
    gl.uniform1f(this.loc.u_hinge, o.kind === 'sticky' ? 0.075 : 0.02);
    gl.uniform1i(this.loc.u_ink, 0);
    gl.activeTexture(gl.TEXTURE0);
    const px = Math.min(640, Math.round(o.size * Math.min(2, devicePixelRatio || 1)));
    const keep = new Set<number>();
    for (const n of order) {
      keep.add(n.i);
      // Notes are laid one over another, nearest the middle last: depth only sorts each sheet's own curl,
      // so a tilted neighbour never cuts through the note on top of it.
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const p = n.place;
      gl.bindTexture(gl.TEXTURE_2D, this.texFor(n, px));
      gl.uniformMatrix4fv(this.loc.u_model, false, modelOf(p, o.size));
      gl.uniform1f(this.loc.u_bend, (p.paper?.bend ?? 0) + (n.wobble ?? 0));
      gl.uniform1f(this.loc.u_twist, p.paper?.twist ?? 0);
      gl.uniform1f(this.loc.u_flutter, p.paper?.flutter ?? 0);
      gl.uniform1f(this.loc.u_peel, p.paper?.peel ?? 0);
      // Lower in the pile is a touch further away, so notes never fight over the same spot.
      gl.uniform1f(this.loc.u_zoff, (p.z - 1000) * 0.3);
      gl.uniform1f(this.loc.u_hideInk, n.hideInk ? 1 : 0);
      gl.uniform1f(this.loc.u_seed, (n.i * 7.31) % 97);
      gl.uniform1f(this.loc.u_alpha, p.o);
      gl.drawElements(gl.TRIANGLES, this.gridCount, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
    this.sweep(keep);
  }

  dispose() {
    for (const t of this.texes.values()) this.gl.deleteTexture(t.tex);
    this.texes.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
