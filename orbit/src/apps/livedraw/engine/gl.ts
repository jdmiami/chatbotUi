/**
 * The GPU engine (WebGL2). Every layer (and layer mask) is a texture; a stroke's dabs are stamped,
 * instanced, into a stroke buffer and then baked onto its layer once (so a stroke's own dabs never
 * build past its opacity); each frame blends the layers in order, the live stroke previewed on its
 * layer, and the dabs predicted just ahead of the pen are drawn on top for that frame only. Bakes and
 * clears touch only the stroke's box. If iOS takes the GPU away (the app went to the background), the
 * engine rebuilds every layer from the drawing when it comes back.
 */
import type { Brush, Dab } from '../brushes/types';
import { GL_BLEND } from './blend';
import { Renderer, rgb01, type CompositeEntry, type Img, type LiveStroke, type StrokeMode } from './renderer';
import { BAKE_FS, COMP_FS, COPY_FS, DAB_FS, DAB_VS, QUAD_VS, SMUDGE_FS } from './shaders';
import { GRAIN, alphaToRgba, cachedGrain, cachedTip, TIP } from './textures';

type GL = WebGL2RenderingContext;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

interface Prog {
  p: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
}

const PICKUP = 128;
const MAX_BATCH = 4096;
const FLOATS = 7;

function compile(gl: GL, vs: string, fs: string): Prog {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) || 'link');
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    p,
    u: (n) => {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n));
      return cache.get(n)!;
    },
  };
}

export class GLRenderer extends Renderer {
  readonly kind = 'webgl2' as const;
  private gl: GL;
  private lost = false;
  private layers = new Map<number, Target>();
  private masks = new Map<number, Target>();
  private stroke!: Target;
  private tmp!: Target;
  private accA!: Target;
  private accB!: Target;
  private pickup!: Target;
  private img!: WebGLTexture;
  private tips = new Map<string, WebGLTexture>();
  private duals = new Map<string, WebGLTexture>();
  private grains = new Map<string, WebGLTexture>();
  private quadVao!: WebGLVertexArrayObject;
  private dabVao!: WebGLVertexArrayObject;
  private instBuf!: WebGLBuffer;
  private inst = new Float32Array(MAX_BATCH * FLOATS);
  private pDab!: Prog;
  private pBake!: Prog;
  private pComp!: Prog;
  private pCopy!: Prog;
  private pSmudge!: Prog;
  private lastAcc: Target | null = null;

  static create(canvas: HTMLCanvasElement): GLRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    return new GLRenderer(canvas, gl);
  }

  private constructor(canvas: HTMLCanvasElement, gl: GL) {
    super(canvas);
    this.gl = gl;
    this.init();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  private onRestored = () => {
    this.lost = false;
    this.layers.clear();
    this.masks.clear();
    this.tips.clear();
    this.duals.clear();
    this.grains.clear();
    this.init();
    const px = this.px;
    this.px = 0;
    // Everything is drawn again from the drawing.
    this.drawn.clear();
    this.resize(px);
  };

  private init() {
    const gl = this.gl;
    this.pDab = compile(gl, DAB_VS, DAB_FS);
    this.pBake = compile(gl, QUAD_VS, BAKE_FS);
    this.pComp = compile(gl, QUAD_VS, COMP_FS);
    this.pCopy = compile(gl, QUAD_VS, COPY_FS);
    this.pSmudge = compile(gl, DAB_VS, SMUDGE_FS);
    // Full-size quad.
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    const q = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, q);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Dabs: a corner quad and one instance per dab.
    this.dabVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.dabVao);
    const c = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, c);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, FLOATS * 4, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    this.img = this.texture(1, 1);
    this.pickup = this.target(PICKUP, PICKUP);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  // ---- textures and targets
  private texture(w: number, h: number, wrap: number = this.gl.CLAMP_TO_EDGE, data: ArrayBufferView | null = null): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture(w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h };
  }

  private drop(t: Target | undefined) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  private alphaTex(key: string, cache: Map<string, WebGLTexture>, size: number, bytes: () => Uint8Array, wrap: number): WebGLTexture {
    let t = cache.get(key);
    if (!t) {
      const gl = this.gl;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      t = this.texture(size, size, wrap, new Uint8Array(alphaToRgba(bytes()).buffer));
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      cache.set(key, t);
    }
    return t;
  }

  protected resizeTargets(px: number) {
    if (this.lost) return;
    for (const t of [this.stroke, this.tmp, this.accA, this.accB]) this.drop(t);
    for (const t of this.layers.values()) this.drop(t);
    for (const t of this.masks.values()) this.drop(t);
    this.layers.clear();
    this.masks.clear();
    this.stroke = this.target(px, px);
    this.tmp = this.target(px, px);
    this.accA = this.target(px, px);
    this.accB = this.target(px, px);
    for (const id of this.drawn.keys()) {
      this.layers.set(id, this.target(px, px));
      if (this.drawn.get(id)!.mask) this.masks.set(id, this.target(px, px));
    }
  }

  protected allocLayer(id: number) {
    if (!this.layers.has(id)) this.layers.set(id, this.target(this.px, this.px));
  }
  protected freeLayer(id: number) {
    this.drop(this.layers.get(id));
    this.layers.delete(id);
  }
  protected allocMask(id: number) {
    if (!this.masks.has(id)) this.masks.set(id, this.target(this.px, this.px));
  }
  protected freeMask(id: number) {
    this.drop(this.masks.get(id));
    this.masks.delete(id);
  }
  private tgt(id: number, mask: boolean): Target | undefined {
    return (mask ? this.masks : this.layers).get(id);
  }

  protected clearTarget(id: number, mask: boolean) {
    const t = this.tgt(id, mask);
    if (!t || this.lost) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // ---- drawing passes
  private quad(prog: Prog, to: Target | null, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u('u_res'), w, h);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private bindTex(prog: Prog, name: string, unit: number, tex: WebGLTexture | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u(name), unit);
  }

  /** Copy `src` onto `dst` (scaled), alpha-blended or replacing. */
  private copy(src: WebGLTexture, dst: Target | null, w: number, h: number, blend: boolean, alpha = 1) {
    const gl = this.gl;
    gl.useProgram(this.pCopy.p);
    this.bindTex(this.pCopy, 'u_tex', 0, src);
    gl.uniform1f(this.pCopy.u('u_alpha'), alpha);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    this.quad(this.pCopy, dst, w, h);
    gl.disable(gl.BLEND);
  }

  protected drawImage(id: number, mask: boolean, img: Img) {
    const t = this.tgt(id, mask);
    if (!t || this.lost) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource);
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    gl.disable(gl.SCISSOR_TEST);
    this.copy(this.img, t, this.px, this.px, true);
  }

  protected clearStroke() {
    if (this.lost) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stroke.fbo);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Set up the dab program for a brush (tip, grain, dual). */
  private useBrush(prog: Prog, brush: Brush) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u('u_res'), this.px, this.px);
    const round = brush.shape === 'round';
    gl.uniform1i(prog.u('u_round'), round ? 1 : 0);
    gl.uniform1f(prog.u('u_hard'), brush.hardness);
    this.bindTex(prog, 'u_tip', 0, round ? null : this.alphaTex(brush.shape, this.tips, TIP, () => cachedTip(brush.shape), gl.CLAMP_TO_EDGE));
    if (prog === this.pDab) {
      const grainOn = brush.grain !== 'none' && brush.grainDepth > 0;
      this.bindTex(prog, 'u_grain', 1, grainOn ? this.alphaTex(brush.grain, this.grains, GRAIN, () => cachedGrain(brush.grain), gl.REPEAT) : null);
      gl.uniform1f(prog.u('u_grainDepth'), grainOn ? brush.grainDepth : 0);
      gl.uniform1f(prog.u('u_grainPx'), GRAIN * brush.grainScale * Math.max(0.6, this.px / 1600));
      const dualOn = brush.dual.shape !== 'none' && brush.dual.depth > 0;
      const ds = brush.dual.shape === 'none' ? 'round' : brush.dual.shape;
      this.bindTex(prog, 'u_dual', 2, dualOn ? this.alphaTex(ds, this.duals, TIP, () => cachedTip(ds, 0.5), gl.REPEAT) : null);
      gl.uniform1f(prog.u('u_dualDepth'), dualOn ? brush.dual.depth : 0);
      gl.uniform1f(prog.u('u_dualPx'), Math.max(8, brush.size * brush.dual.scale * this.px));
    }
  }

  private fillInstances(dabs: readonly Dab[], from: number, n: number) {
    const px = this.px;
    for (let i = 0; i < n; i++) {
      const d = dabs[from + i];
      let size = d.size * px;
      let alpha = d.alpha;
      // Under a pixel and a half the tip can't be drawn smaller: fade it instead.
      if (size < 1.5) {
        alpha *= size / 1.5;
        size = 1.5;
      }
      const o = i * FLOATS;
      this.inst[o] = d.x * px;
      this.inst[o + 1] = d.y * px;
      this.inst[o + 2] = size;
      this.inst[o + 3] = d.angle;
      this.inst[o + 4] = alpha;
      this.inst[o + 5] = d.roundness;
      this.inst[o + 6] = d.r;
    }
  }

  private drawDabs(dabs: readonly Dab[], brush: Brush, color: string, to: Target | null, alphaMul = 1) {
    const gl = this.gl;
    this.useBrush(this.pDab, brush);
    const [r, g, b] = rgb01(color);
    gl.uniform3f(this.pDab.u('u_color'), r, g, b);
    gl.uniform1f(this.pDab.u('u_alphaMul'), alphaMul);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fbo : null);
    gl.viewport(0, 0, this.px, this.px);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.dabVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    for (let from = 0; from < dabs.length; from += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, dabs.length - from);
      this.fillInstances(dabs, from, n);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, n * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  protected stampStroke(dabs: readonly Dab[], brush: Brush, color: string) {
    if (this.lost || !dabs.length) return;
    this.drawDabs(dabs, brush, color, this.stroke);
  }

  /** A box in canvas units as a GL pixel rect (y up), padded and clamped; null when off the canvas. */
  private rect(b: LiveStroke['bounds']): [number, number, number, number] | null {
    if (!b) return null;
    const px = this.px;
    const x0 = Math.max(0, Math.floor(b.x0 * px) - 2);
    const x1 = Math.min(px, Math.ceil(b.x1 * px) + 2);
    const y0 = Math.max(0, Math.floor(b.y0 * px) - 2);
    const y1 = Math.min(px, Math.ceil(b.y1 * px) + 2);
    if (x1 <= x0 || y1 <= y0) return null;
    return [x0, px - y1, x1, px - y0];
  }

  private blit(from: Target, to: Target, r: [number, number, number, number]) {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.fbo);
    gl.blitFramebuffer(r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3], gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  protected bake(id: number, mask: boolean, opacity: number, mode: StrokeMode, bounds: LiveStroke['bounds']) {
    const t = this.tgt(id, mask);
    const r = this.rect(bounds);
    if (!t || !r || this.lost) return;
    const gl = this.gl;
    gl.useProgram(this.pBake.p);
    this.bindTex(this.pBake, 'u_dst', 0, t.tex);
    this.bindTex(this.pBake, 'u_stroke', 1, this.stroke.tex);
    gl.uniform1f(this.pBake.u('u_opacity'), opacity);
    gl.uniform1i(this.pBake.u('u_mode'), mode === 'erase' ? 1 : mode === 'lock' ? 2 : 0);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    gl.disable(gl.BLEND);
    this.quad(this.pBake, this.tmp, this.px, this.px);
    gl.disable(gl.SCISSOR_TEST);
    this.blit(this.tmp, t, r);
  }

  protected smudge(id: number, mask: boolean, dabs: readonly Dab[], brush: Brush, prev: Dab | null) {
    const t = this.tgt(id, mask);
    if (!t || this.lost || !dabs.length) return;
    const gl = this.gl;
    const px = this.px;
    let from = prev ?? dabs[0];
    for (let i = prev ? 0 : 1; i < dabs.length; i++) {
      const d = dabs[i];
      const size = Math.max(2, d.size * px);
      // Pick up the paint where the previous dab was.
      const sx = from.x * px - size / 2;
      const sy = px - (from.y * px + size / 2);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pickup.fbo);
      gl.blitFramebuffer(Math.round(sx), Math.round(sy), Math.round(sx + size), Math.round(sy + size), 0, 0, PICKUP, PICKUP, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      const r = this.rect({ x0: d.x - d.size, y0: d.y - d.size, x1: d.x + d.size, y1: d.y + d.size });
      if (r) {
        this.blit(t, this.tmp, r);
        this.useBrush(this.pSmudge, brush);
        this.bindTex(this.pSmudge, 'u_dst', 1, t.tex);
        this.bindTex(this.pSmudge, 'u_pickup', 2, this.pickup.tex);
        gl.uniform2f(this.pSmudge.u('u_center'), d.x * px, d.y * px);
        gl.uniform1f(this.pSmudge.u('u_size'), size);
        gl.uniform1f(this.pSmudge.u('u_strength'), brush.smudge);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.tmp.fbo);
        gl.viewport(0, 0, px, px);
        gl.disable(gl.BLEND);
        this.fillInstances([d], 0, 1);
        gl.bindVertexArray(this.dabVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
        gl.bindVertexArray(null);
        this.blit(this.tmp, t, r);
      }
      from = d;
    }
  }

  // ---- compositing
  private compositeInto(entries: CompositeEntry[], withLive: boolean): Target {
    const gl = this.gl;
    let acc = this.accA;
    let out = this.accB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    const p = this.pComp;
    gl.useProgram(p.p);
    for (const e of entries) {
      const layer = this.layers.get(e.id);
      if (!layer) continue;
      const live = withLive && this.live && this.live.layerId === e.id && this.live.op.brush.mode !== 'smudge' ? this.live : null;
      const mask = e.mask ? this.masks.get(e.id) : undefined;
      const clip = e.clip !== null ? this.layers.get(e.clip) : undefined;
      const clipMask = e.clip !== null && e.clipMask ? this.masks.get(e.clip) : undefined;
      gl.useProgram(p.p);
      this.bindTex(p, 'u_acc', 0, acc.tex);
      this.bindTex(p, 'u_layer', 1, layer.tex);
      this.bindTex(p, 'u_mask', 2, mask?.tex ?? null);
      this.bindTex(p, 'u_clip', 3, clip?.tex ?? null);
      this.bindTex(p, 'u_clipMask', 4, clipMask?.tex ?? null);
      this.bindTex(p, 'u_stroke', 5, live ? this.stroke.tex : null);
      gl.uniform1f(p.u('u_opacity'), e.opacity);
      gl.uniform1i(p.u('u_blend'), GL_BLEND[e.blend]);
      gl.uniform1i(p.u('u_hasMask'), mask ? 1 : 0);
      gl.uniform1i(p.u('u_hasClip'), clip ? 1 : 0);
      gl.uniform1i(p.u('u_clipHasMask'), clipMask ? 1 : 0);
      gl.uniform1i(p.u('u_stroke_on'), live && (!live.toMask || mask) ? 1 : 0);
      gl.uniform1i(p.u('u_strokeToMask'), live?.toMask ? 1 : 0);
      gl.uniform1i(p.u('u_strokeMode'), live ? (live.mode === 'erase' ? 1 : live.mode === 'lock' ? 2 : 0) : 0);
      gl.uniform1f(p.u('u_strokeOpacity'), live?.op.opacity ?? 1);
      this.quad(p, out, this.px, this.px);
      [acc, out] = [out, acc];
    }
    for (let u = 0; u < 6; u++) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    return acc;
  }

  protected present(entries: CompositeEntry[]) {
    if (this.lost) return;
    const gl = this.gl;
    const acc = this.compositeInto(entries, true);
    this.lastAcc = acc;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.px, this.px);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.copy(acc.tex, null, this.px, this.px, false);
    // The dabs just ahead of the pen, this frame only.
    if (this.predicted.length && this.live) this.drawDabs(this.predicted, this.live.op.brush, this.live.op.color, null, this.live.op.opacity);
  }

  /** Read a target back as a 2D canvas `side` square (rows flipped, colours unpremultiplied). */
  private readBack(src: Target, side: number): HTMLCanvasElement {
    const gl = this.gl;
    let from = src;
    let temp: Target | null = null;
    if (side !== src.w) {
      temp = this.target(side, side);
      // Shrinking a lot: let the GPU average (mipmaps) so thin lines don't break up.
      if (side < src.w / 1.5) {
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
      this.copy(src.tex, temp, side, side, false);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      from = temp;
    }
    const data = new Uint8Array(side * side * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, from.fbo);
    gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (temp) this.drop(temp);
    const out = document.createElement('canvas');
    out.width = out.height = side;
    const ctx = out.getContext('2d');
    if (!ctx) return out;
    const img = ctx.createImageData(side, side);
    const row = side * 4;
    for (let y = 0; y < side; y++) {
      const s = (side - 1 - y) * row;
      const d = y * row;
      for (let x = 0; x < row; x += 4) {
        const a = data[s + x + 3];
        img.data[d + x + 3] = a;
        if (a) {
          const k = 255 / a;
          img.data[d + x] = Math.min(255, Math.round(data[s + x] * k));
          img.data[d + x + 1] = Math.min(255, Math.round(data[s + x + 1] * k));
          img.data[d + x + 2] = Math.min(255, Math.round(data[s + x + 2] * k));
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  protected compositeCanvas(entries: CompositeEntry[], side: number): HTMLCanvasElement {
    if (this.lost) return blank(side);
    const acc = this.compositeInto(entries, false);
    const out = this.readBack(acc, side);
    this.invalidate();
    return out;
  }

  protected readTarget(id: number, mask: boolean, side: number): HTMLCanvasElement {
    const t = this.tgt(id, mask);
    if (!t || this.lost) return blank(side);
    return this.readBack(t, side);
  }

  pixel(x: number, y: number): [number, number, number, number] {
    if (this.lost || !this.state) return [0, 0, 0, 0];
    const acc = this.compositeInto(this.entries(this.state.layers.filter((l) => l.visible)), false);
    const gl = this.gl;
    const out = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
    gl.readPixels(Math.min(this.px - 1, Math.max(0, Math.floor(x * this.px))), Math.min(this.px - 1, Math.max(0, this.px - 1 - Math.floor(y * this.px))), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    this.invalidate();
    return [out[0], out[1], out[2], out[3]];
  }

  destroy() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (this.lost) return;
    for (const t of [this.stroke, this.tmp, this.accA, this.accB, this.pickup]) this.drop(t);
    for (const t of this.layers.values()) this.drop(t);
    for (const t of this.masks.values()) this.drop(t);
    this.layers.clear();
    this.masks.clear();
  }

  /** The last frame's composite is in this target (tests and debugging). */
  get frameTarget() {
    return this.lastAcc;
  }
}

function blank(side: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = side;
  return c;
}
