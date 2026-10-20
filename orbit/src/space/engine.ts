import { V, bump, clamp, lerp, rng, rotY, seg, settle, spring, vadd, vdist, vlerp, type Vec } from './math';
import type { Layout } from './model';
import type { Placed, Pose, Screen, Thread, World } from './place';

/**
 * Orbit Space's runtime: a tiny CSS-3D engine. Pages are real HTML that React renders inside the
 * world element; each frame the engine places them with 3D transforms (sorted by depth, fogged by
 * distance, faded as they pass the camera) and draws threads, knots, dust and the orb's trail on a
 * canvas behind them. It owns the camera and the gestures: drag to look, two fingers to move,
 * pinch to come closer, tap to approach, tap again to open. A pinch that starts on a room's pages
 * spreads or gathers them instead (stack ⇄ list ⇄ grid); a sideways swipe on a stack flips it.
 * Ported from docs/orbit-space/samples.html.
 */

export interface EngineEvents {
  /** The page the camera and the orb are at (null = the overview). */
  onApproach(id: string | null): void;
  /** Tap on the page you are at: open it flat and full screen. */
  onOpen(id: string): void;
  /** A pinch on a room's pages: 1 = spread, -1 = gather. */
  onReshape(room: string, dir: 1 | -1): void;
  /** Double tap on a room page. */
  onCycle(room: string): void;
  /** Swipe on a stack (or , and . keys): 1 = next card, -1 = previous. */
  onFlip(room: string, dir: 1 | -1): void;
  /** Keys L, S, G at a room. */
  onLayout(room: string, layout: Layout): void;
  /** The screen changed shape: the world should be placed again. */
  onScreen(screen: Screen): void;
}

interface Node {
  id: string;
  el: HTMLElement | null;
  w: number;
  h: number;
  group?: string;
  sculpture: boolean;
  frame?: Placed['frame'];
  from: Pose;
  to: Pose;
  t0: number;
  dur: number;
  /** The pose drawn last frame (tweens start from what you see). */
  p: Pose;
  vis: boolean;
  d: number;
}

interface Look {
  fx: number;
  fy: number;
  fz: number;
  r: number;
  th: number;
  ph: number;
}

const THEME = { fog: 0.82, thread: '243,238,230', ta: 0.34, dust: '243,238,230' };
const ORB = 60;
/** The agreed timings (docs/orbit-space/HANDOFF.md). */
export const TIMING = { travel: 520, intoWorld: 700, intoStagger: 60, morph: 480, morphStagger: 40, page: 480, dive: 260 };

const samePose = (a: Pose, b: Pose) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.z - b.z) < 0.5 && Math.abs(a.yaw - b.yaw) < 1e-3 && Math.abs(a.s - b.s) < 1e-3 && Math.abs(a.a - b.a) < 1e-3 && Math.abs(a.tilt - b.tilt) < 1e-3;
const mixPose = (a: Pose, b: Pose, p: number): Pose => ({
  x: lerp(a.x, b.x, p),
  y: lerp(a.y, b.y, p),
  z: lerp(a.z, b.z, p),
  yaw: lerp(a.yaw, b.yaw, p),
  tilt: lerp(a.tilt, b.tilt, p),
  s: lerp(a.s, b.s, p),
  a: lerp(a.a, b.a, p),
});

export class SpaceEngine {
  private stage: HTMLElement;
  private worldEl: HTMLElement;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private orbEl: HTMLElement | null = null;
  private ev: EngineEvents;
  private insets: () => { top: number; bottom: number };

  // viewport and lens
  private W = 0;
  private H = 0;
  private P = 800;
  private DPR = 1;
  private CX = 0;
  private CY = 0;
  private VIS = 600;
  screen: Screen = { ax: 1, ay: 1, rm: 1 };

  // camera
  private cam = { pos: V(0, 0, 1200), look: V(0, 0, 0), a: 0, b: 0, ca: 1, sa: 0, cb: 1, sb: 0, fd: 1200 };
  private home: Look = { fx: 0, fy: 0, fz: 0, r: 1600, th: 0, ph: 0.1 };
  private cur: Look = { ...this.home };
  private tgt: Look = { ...this.home };
  private vth = 0;
  private vph = 0;
  private dragging = false;
  approached: string | null = null;

  // scene
  private nodes = new Map<string, Node>();
  private threads: Thread[] = [];
  private layouts: Record<string, Layout> = {};
  private rooms = new Set<string>();
  private dust: { p: Vec; ph: number; sp: number }[] = [];
  private orb = { p: V(0, 0, 0), ring: 0.1 };
  private travel: { from: Vec; to: Vec; t0: number; dur: number; arc: number } | null = null;
  private trail: Vec[] = [];
  /** A live pinch on a room's pages: its pages spread (f > 1) or gather (f < 1) with your fingers. */
  private squeeze: { room: string; f: number } | null = null;
  private first = true;

  // loop
  private raf = 0;
  private last = 0;
  private running = false;
  private idleSince = 0;
  reduced = false;

  // input
  private ptrs = new Map<number, { x: number; y: number; node: string | null }>();
  private down: { x: number; y: number; t: number; moved: number; node: string | null; dx: number; dy: number; flip: string | null; flipped: boolean } | null = null;
  private two: { kind: 'squeeze'; room: string; d0: number } | { kind: 'camera'; d0: number; r0: number; mid: { x: number; y: number } } | null = null;
  private lastTap: { id: string; t: number } | null = null;
  private diveTimer = 0;
  private ro: ResizeObserver | null = null;
  private offs: (() => void)[] = [];

  constructor(stage: HTMLElement, world: HTMLElement, canvas: HTMLCanvasElement, ev: EngineEvents, insets: () => { top: number; bottom: number }) {
    this.stage = stage;
    this.worldEl = world;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ev = ev;
    this.insets = insets;
    const r = rng(7);
    for (let i = 0; i < 230; i++) this.dust.push({ p: V(r() * 7000 - 3500, r() * 4000 - 2000, r() * 9000 - 7000), ph: r() * 6.28, sp: 0.4 + r() * 0.8 });
    this.bindInput();
    this.measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => {
        const before = this.screen;
        this.measure();
        if (before.ax !== this.screen.ax || before.ay !== this.screen.ay || Math.abs(before.rm - this.screen.rm) > 0.01) this.ev.onScreen(this.screen);
        this.wake();
      });
      this.ro.observe(stage);
    }
  }

  destroy() {
    this.stop();
    this.ro?.disconnect();
    this.offs.forEach((f) => f());
    clearTimeout(this.diveTimer);
  }

  // ------------------------------------------------------------------ viewport
  private measure() {
    this.W = this.stage.clientWidth || window.innerWidth;
    this.H = this.stage.clientHeight || window.innerHeight;
    this.DPR = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(this.W * this.DPR);
    this.cv.height = Math.round(this.H * this.DPR);
    this.cv.style.width = `${this.W}px`;
    this.cv.style.height = `${this.H}px`;
    const { top, bottom } = this.insets();
    this.VIS = Math.max(240, this.H - top - bottom);
    this.CX = this.W / 2;
    this.CY = top + this.VIS / 2;
    this.P = Math.min(this.W, this.VIS * 1.05) * 1.15;
    this.worldEl.style.perspective = `${this.P.toFixed(1)}px`;
    this.worldEl.style.perspectiveOrigin = `50% ${this.CY.toFixed(1)}px`;
    this.worldEl.style.setProperty('--cy', `${this.CY.toFixed(1)}px`);
    const portrait = this.W / this.VIS < 0.85;
    this.screen = { ax: portrait ? 0.5 : 1, ay: portrait ? 1.1 : 1, rm: ((portrait ? 1.02 : 0.73) * this.P) / this.VIS };
  }
  private readDist(w: number, h: number) {
    return this.P * Math.max(h / (0.66 * this.VIS), w / (0.86 * this.W));
  }

  // ------------------------------------------------------------------ scene
  /** Place the world. Pages that moved tween from where they are now; new ones arrive. */
  set(world: World, layouts: Record<string, Layout>, opts: { instant?: boolean } = {}) {
    const now = performance.now();
    const instant = opts.instant || this.reduced;
    this.layouts = layouts;
    this.threads = world.threads;
    this.rooms = new Set(Object.values(world.placed).filter((p) => p.frame).map((p) => p.id));
    const els = new Map<string, HTMLElement>();
    this.worldEl.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => els.set(el.dataset.node!, el));
    this.orbEl = this.worldEl.querySelector<HTMLElement>('[data-orb]');
    const seen = new Set<string>();
    const order = new Map<string, number>();
    let arriving = 0;
    for (const pl of Object.values(world.placed)) {
      seen.add(pl.id);
      const el = els.get(pl.id) ?? null;
      const old = this.nodes.get(pl.id);
      if (old) {
        old.el = el;
        old.w = pl.w;
        old.h = pl.h;
        old.group = pl.group;
        old.frame = pl.frame;
        old.sculpture = !!pl.sculpture;
        if (!samePose(old.to, pl.pose)) {
          // Cards in the same room fly in turn, 40 ms apart.
          const k = pl.group ? (order.get(pl.group) ?? 0) : 0;
          if (pl.group) order.set(pl.group, k + 1);
          old.from = { ...old.p };
          old.to = pl.pose;
          old.t0 = now + (instant ? 0 : k * TIMING.morphStagger);
          old.dur = instant ? 0 : TIMING.morph;
        }
      } else {
        // Into the world: pages drift in from further back, 60 ms apart.
        const start: Pose = { ...pl.pose, z: pl.pose.z - 420, a: 0 };
        const k = arriving++;
        this.nodes.set(pl.id, {
          id: pl.id,
          el,
          w: pl.w,
          h: pl.h,
          group: pl.group,
          frame: pl.frame,
          sculpture: !!pl.sculpture,
          from: start,
          to: pl.pose,
          t0: now + (instant ? 0 : Math.min(k, 14) * TIMING.intoStagger),
          dur: instant ? 0 : this.first ? TIMING.intoWorld : TIMING.page,
          p: instant ? { ...pl.pose } : start,
          vis: true,
          d: 0,
        });
      }
    }
    for (const id of [...this.nodes.keys()]) if (!seen.has(id)) this.nodes.delete(id);
    const h = world.home;
    this.home = { fx: h.focus.x, fy: h.focus.y, fz: h.focus.z, r: h.r, th: h.th, ph: h.ph };
    if (this.first) {
      // Start a little further out and settle in.
      this.cur = { ...this.home, r: this.home.r * (instant ? 1 : 1.25) };
      this.tgt = { ...this.home };
      const cover = this.nodes.get('cover');
      this.orb.p = cover ? this.orbSpot(cover, cover.to) : V(0, 200, 300);
      this.first = false;
    }
    if (this.approached && !this.nodes.has(this.approached)) this.approached = null;
    if (this.approached) this.aim(this.nodes.get(this.approached)!, now, false);
    else Object.assign(this.tgt, this.home);
    this.wake();
  }

  private orbSpot(n: Node, p: Pose = n.p): Vec {
    return vadd(V(p.x, p.y, p.z), rotY(V((-n.w * p.s) / 2 - 8, (-n.h * p.s) / 2 - 8, 36), p.yaw));
  }
  private orbTo(to: Vec, now: number, dur = TIMING.travel, arc = 140) {
    this.travel = { from: { ...this.orb.p }, to, t0: now, dur, arc };
  }

  // ------------------------------------------------------------------ approach and overview
  approach(id: string) {
    const n = this.nodes.get(id);
    if (!n || n.sculpture) return;
    this.aim(n, performance.now(), true);
    this.wake();
  }
  private aim(n: Node, now: number, travel: boolean) {
    const p = n.to;
    const f = n.frame;
    this.tgt.fx = f ? f.x : p.x;
    this.tgt.fy = f ? f.y : p.y;
    this.tgt.fz = f ? f.z : p.z;
    this.tgt.th = p.yaw;
    this.tgt.ph = 0.03;
    this.tgt.r = f ? this.readDist(f.w, f.h) * 1.04 : this.readDist(n.w * p.s, n.h * p.s);
    if (this.approached !== n.id) {
      this.approached = n.id;
      this.ev.onApproach(n.id);
    }
    if (travel) this.orbTo(this.orbSpot(n, p), now);
    else if (!this.travel) this.orb.p = this.orbSpot(n, p);
  }
  overview() {
    Object.assign(this.tgt, this.home);
    if (this.approached !== null) {
      this.approached = null;
      this.ev.onApproach(null);
    }
    const cover = this.nodes.get('cover');
    if (cover) this.orbTo(this.orbSpot(cover, cover.to), performance.now());
    this.wake();
  }
  /** Open the page you are at: the camera dives into it, then it goes flat and full screen. */
  open(id: string) {
    if (this.reduced) return this.ev.onOpen(id);
    this.tgt.r *= 0.55;
    this.wake();
    clearTimeout(this.diveTimer);
    this.diveTimer = window.setTimeout(() => {
      this.ev.onOpen(id);
      // Back from the app: the page is where you left it, at reading distance.
      const n = this.nodes.get(id);
      if (n) this.aim(n, performance.now(), false);
    }, TIMING.dive);
  }
  groupOf(id: string): string | null {
    if (this.rooms.has(id)) return id;
    return this.nodes.get(id)?.group ?? null;
  }

  // ------------------------------------------------------------------ loop
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.idleSince = 0;
    this.raf = requestAnimationFrame(this.frame);
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  /** Something changed: make sure frames are running. */
  wake() {
    this.idleSince = 0;
    if (!this.running && !this.paused) this.start();
  }
  paused = false;
  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.stop();
    else this.wake();
  }
  /** One frame now (tests and the first paint). */
  renderNow() {
    this.step(performance.now(), 0);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    const busy = this.step(now, dt);
    if (busy) this.idleSince = 0;
    else if (!this.idleSince) this.idleSince = now;
    // Settled: with motion on, keep a slow drift at a lower frame rate; with motion off, stop.
    if (!busy && this.idleSince && (this.reduced || now - this.idleSince > 20_000)) {
      this.running = false;
      return;
    }
    this.last = now;
    if (!busy && !this.reduced) {
      setTimeout(() => this.running && (this.raf = requestAnimationFrame(this.frame)), 33);
    } else this.raf = requestAnimationFrame(this.frame);
  };

  /** Returns true while anything is still moving. */
  private step(now: number, dt: number): boolean {
    let busy = this.dragging || this.ptrs.size > 0;
    // ---- camera
    const c = this.cur;
    const g = this.tgt;
    if (!this.dragging && (Math.abs(this.vth) > 1e-5 || Math.abs(this.vph) > 1e-5)) {
      g.th += this.vth;
      g.ph += this.vph;
      this.vth *= 0.9;
      this.vph *= 0.9;
      this.limits();
      busy = true;
    }
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * (this.dragging ? 18 : 4.2));
    let moving = false;
    for (const key of ['fx', 'fy', 'fz', 'r', 'th', 'ph'] as const) {
      c[key] = lerp(c[key], g[key], k);
      if (Math.abs(c[key] - g[key]) > (key === 'th' || key === 'ph' ? 1e-4 : 0.3)) moving = true;
    }
    if (moving) busy = true;
    const sw = this.reduced ? 0 : this.approached ? 0.012 : 0.05;
    const th = c.th + sw * Math.sin(now / 5200);
    const ph = c.ph + sw * 0.45 * Math.sin(now / 7100 + 1);
    this.cam.pos = V(c.fx + c.r * Math.sin(th) * Math.cos(ph), c.fy - c.r * Math.sin(ph), c.fz + c.r * Math.cos(th) * Math.cos(ph));
    this.cam.look = V(c.fx, c.fy, c.fz);
    this.basis();

    // ---- pages
    for (const n of this.nodes.values()) {
      if (n.dur <= 0 || now >= n.t0 + n.dur) n.p = { ...n.to };
      else {
        n.p = mixPose(n.from, n.to, settle(seg(now, n.t0, n.dur)));
        busy = true;
      }
    }
    if (this.squeeze) this.applySqueeze(this.squeeze.room, this.squeeze.f);

    // ---- orb
    if (this.travel) {
      const t = this.travel;
      const p = clamp((now - t.t0) / t.dur, 0, 1);
      const o = vlerp(t.from, t.to, this.reduced ? 1 : spring(p));
      o.y -= this.reduced ? 0 : bump(p) * t.arc;
      this.orb.p = o;
      if (p >= 1) this.travel = null;
      busy = true;
    }
    const bob = this.reduced ? 0 : Math.sin(now / 900) * 6;
    this.orb.ring = 0.1 + (this.reduced ? 0 : 0.06 * Math.sin(now / 700));

    this.renderNodes(bob);
    this.draw(now, bob);
    return busy;
  }

  private applySqueeze(room: string, f: number) {
    const kids = [...this.nodes.values()].filter((n) => n.group === room);
    if (!kids.length) return;
    const cx = kids.reduce((s, n) => s + n.p.x, 0) / kids.length;
    const cy = kids.reduce((s, n) => s + n.p.y, 0) / kids.length;
    const cz = kids.reduce((s, n) => s + n.p.z, 0) / kids.length;
    for (const n of kids) n.p = { ...n.p, x: cx + (n.p.x - cx) * f, y: cy + (n.p.y - cy) * f, z: cz + (n.p.z - cz) * f };
  }

  private limits() {
    const h = this.home;
    const g = this.tgt;
    g.ph = clamp(g.ph, -0.35, 1.35);
    g.r = clamp(g.r, 220, h.r * 2.2);
    // Endless enough: you can roam well past the last page, but not get lost in the void.
    g.fx = clamp(g.fx, -4200, 4200);
    g.fy = clamp(g.fy, -2600, 2600);
    g.fz = clamp(g.fz, -9000, 1600);
  }

  // ------------------------------------------------------------------ projection
  private basis() {
    const cam = this.cam;
    const tx = cam.look.x - cam.pos.x;
    const ty = cam.look.y - cam.pos.y;
    const tz = cam.look.z - cam.pos.z;
    const h = Math.hypot(tx, tz) || 1e-6;
    cam.b = Math.atan2(tx, -tz);
    cam.a = Math.atan2(-ty, h);
    cam.ca = Math.cos(cam.a);
    cam.sa = Math.sin(cam.a);
    cam.cb = Math.cos(cam.b);
    cam.sb = Math.sin(cam.b);
    cam.fd = Math.hypot(tx, ty, tz);
  }
  private toCam(p: Vec): [number, number, number] {
    const cam = this.cam;
    const x = p.x - cam.pos.x;
    const y = p.y - cam.pos.y;
    const z = p.z - cam.pos.z;
    const x1 = x * cam.cb + z * cam.sb;
    const z1 = -x * cam.sb + z * cam.cb;
    return [x1, y * cam.ca - z1 * cam.sa, y * cam.sa + z1 * cam.ca];
  }
  private proj(v: [number, number, number]) {
    const d = -v[2];
    const s = this.P / d;
    return { x: this.CX + v[0] * s, y: this.CY + v[1] * s, s, d };
  }

  // ------------------------------------------------------------------ render
  private renderNodes(bob: number) {
    const cam = this.cam;
    const near = cam.fd * 0.85;
    const far = near + Math.max(2600, cam.fd * 2.2);
    const rot = ` rotateX(${cam.a}rad) rotateY(${cam.b}rad)`;
    for (const n of this.nodes.values()) {
      const el = n.el;
      if (!el) continue;
      const p = n.p;
      const v = this.toCam(p);
      const d = -v[2];
      n.d = d;
      // Pages fade as they pass the camera, and pages well outside the frame are skipped.
      const nearFade = clamp((d - 70) / 110, 0, 1);
      const sc = this.P / Math.max(d, 1);
      const half = Math.max(n.w, n.h) * p.s * sc * 0.6;
      const off = Math.abs(v[0] * sc) - half > this.W * 0.75 || Math.abs(v[1] * sc) - half > this.H * 0.75;
      if (off || nearFade <= 0.004 || p.a <= 0.004) {
        if (n.vis) {
          el.style.visibility = 'hidden';
          n.vis = false;
        }
        continue;
      }
      if (!n.vis) {
        el.style.visibility = 'visible';
        n.vis = true;
      }
      const f = n.sculpture ? 0 : clamp((d - near) / (far - near), 0, 1);
      el.style.transform = `translate3d(${v[0].toFixed(1)}px,${v[1].toFixed(1)}px,${(this.P + v[2]).toFixed(1)}px)${rot} rotateY(${p.yaw}rad) rotateX(${p.tilt}rad) scale(${p.s.toFixed(4)})`;
      const op = p.a * nearFade * (f > 0.82 ? 1 - ((f - 0.82) / 0.18) * 0.85 : 1);
      el.style.opacity = op.toFixed(3);
      el.style.setProperty('--fog', (f * THEME.fog).toFixed(3));
      el.style.zIndex = String(Math.max(1, Math.round(300000 - d * 10)));
    }
    if (this.orbEl) {
      const o = this.orb.p;
      const v = this.toCam(V(o.x, o.y + bob, o.z));
      const d = -v[2];
      const show = d > 60;
      this.orbEl.style.visibility = show ? '' : 'hidden';
      if (show) {
        this.orbEl.style.transform = `translate3d(${v[0].toFixed(1)}px,${v[1].toFixed(1)}px,${(this.P + v[2]).toFixed(1)}px)`;
        this.orbEl.style.zIndex = String(Math.max(1, Math.round(300000 - d * 10)));
        this.orbEl.style.opacity = clamp((d - 70) / 90, 0, 1).toFixed(3);
        this.orbEl.style.setProperty('--ring', this.orb.ring.toFixed(3));
      }
    }
  }

  private draw(now: number, bob: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const near = this.cam.fd * 0.85;
    const far = near + Math.max(2600, this.cam.fd * 2.2);
    const fogAt = (d: number) => clamp((d - near) / (far - near), 0, 1);
    // ---- threads with a slight sag, square knots at both ends
    for (const th of this.threads) {
      const na = this.nodes.get(th.a);
      const nb = this.nodes.get(th.b);
      if (!na || !nb || (na.p.a < 0.02 && nb.p.a < 0.02)) continue;
      const A = V(na.p.x, na.p.y, na.p.z);
      const B = V(nb.p.x, nb.p.y, nb.p.z);
      const len = vdist(A, B);
      const N = 22;
      const sag = th.sag ?? 0.05;
      ctx.beginPath();
      let on = false;
      let mid: ReturnType<SpaceEngine['proj']> | null = null;
      for (let i = 0; i <= N; i++) {
        const p = i / N;
        const Q = vlerp(A, B, p);
        Q.y += bump(p) * len * sag;
        const v = this.toCam(Q);
        if (-v[2] < 60) {
          on = false;
          continue;
        }
        const q = this.proj(v);
        if (i === N >> 1) mid = q;
        if (on) ctx.lineTo(q.x, q.y);
        else {
          ctx.moveTo(q.x, q.y);
          on = true;
        }
      }
      const md = mid ? mid.d : 2000;
      const al = THEME.ta * (th.alpha ?? 1) * (1 - fogAt(md) * 0.85) * Math.min(1, Math.max(na.p.a, 0.3)) * Math.min(1, Math.max(nb.p.a, 0.3));
      ctx.strokeStyle = `rgba(${THEME.thread},${al.toFixed(3)})`;
      ctx.lineWidth = clamp((mid ? mid.s : 0.5) * 1.6, 0.6, 1.5);
      ctx.setLineDash(th.dash ? [3, 5] : []);
      ctx.stroke();
      for (const E of [A, B]) {
        const v = this.toCam(E);
        if (-v[2] < 60) continue;
        const q = this.proj(v);
        ctx.fillStyle = `rgba(${THEME.thread},${(al * 1.6).toFixed(3)})`;
        ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
      }
    }
    ctx.setLineDash([]);
    // ---- dust
    const tt = now / 1000;
    for (const m of this.dust) {
      const p = this.reduced ? m.p : V(m.p.x + Math.sin(tt * 0.07 * m.sp + m.ph) * 40, m.p.y + Math.cos(tt * 0.05 * m.sp + m.ph) * 30, m.p.z);
      const v = this.toCam(p);
      const d = -v[2];
      if (d < 80) continue;
      const q = this.proj(v);
      if (q.x < 0 || q.x > this.W || q.y < 0 || q.y > this.H) continue;
      const tw = this.reduced ? 0.7 : 0.55 + 0.45 * Math.sin(tt * m.sp + m.ph);
      const a = 0.5 * tw * (1 - clamp((d - 300) / 7000, 0, 1));
      if (a < 0.02) continue;
      const r = clamp(q.s * 2.2, 0.5, 2.4);
      ctx.fillStyle = `rgba(${THEME.dust},${a.toFixed(3)})`;
      ctx.fillRect(q.x - r / 2, q.y - r / 2, r, r);
    }
    // ---- the orb's trail
    const o = V(this.orb.p.x, this.orb.p.y + bob, this.orb.p.z);
    this.trail.push(o);
    if (this.trail.length > 16) this.trail.shift();
    const lastP = this.trail[this.trail.length - 1];
    for (let i = 0; i < this.trail.length - 1; i++) {
      const a = this.trail[i];
      if (vdist(a, lastP) < 8) continue;
      const v = this.toCam(a);
      if (-v[2] < 60) continue;
      const q = this.proj(v);
      const al = (i / this.trail.length) * 0.28;
      const r = ((ORB * 0.4 * q.s) * i) / this.trail.length;
      ctx.fillStyle = `rgba(108,124,255,${al.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, 6.283);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ input
  private nodeAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    const n = el?.closest?.('[data-node]') as HTMLElement | null;
    return n && this.worldEl.contains(n) ? (n.dataset.node ?? null) : null;
  }

  private bindInput() {
    const s = this.stage;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      s.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => s.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => {
      if (e.button > 0) return;
      try {
        s.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable (synthetic events) */
      }
      const node = this.nodeAt(e.clientX, e.clientY);
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, node });
      if (this.ptrs.size === 1) {
        const room = node ? this.groupOf(node) : null;
        const flip = room && room !== node && this.layouts[room] === 'stack' ? room : null;
        this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, node, dx: 0, dy: 0, flip, flipped: false };
      }
      if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const ra = a.node ? this.groupOf(a.node) : null;
        const rb = b.node ? this.groupOf(b.node) : null;
        this.two = ra && ra === rb ? { kind: 'squeeze', room: ra, d0 } : { kind: 'camera', d0, r0: this.tgt.r, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        if (this.down) this.down.moved = 99;
      }
      this.dragging = true;
      this.vth = 0;
      this.vph = 0;
      s.dataset.dragging = 'true';
      this.wake();
    });
    on('pointermove', (e) => {
      const prev = this.ptrs.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.ptrs.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });
      if (this.down) {
        this.down.moved += Math.abs(dx) + Math.abs(dy);
        this.down.dx += dx;
        this.down.dy += dy;
      }
      if (this.ptrs.size === 2 && this.two) {
        const [a, b] = [...this.ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        if (this.two.kind === 'squeeze') {
          this.squeeze = { room: this.two.room, f: clamp(d / this.two.d0, 0.55, 1.7) };
        } else {
          this.tgt.r = (this.two.r0 * this.two.d0) / d;
          // Two fingers moving together carry you through the space.
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          this.pan(mid.x - this.two.mid.x, mid.y - this.two.mid.y);
          this.two.mid = mid;
          this.limits();
        }
        return;
      }
      if (this.ptrs.size !== 1) return;
      const dn = this.down;
      if (dn?.flip) {
        // A sideways swipe on a stack flips its cards instead of turning the view.
        if (!dn.flipped && Math.abs(dn.dx) > 42 && Math.abs(dn.dx) > Math.abs(dn.dy) * 1.4) {
          dn.flipped = true;
          this.ev.onFlip(dn.flip, dn.dx < 0 ? 1 : -1);
        }
        return;
      }
      this.tgt.th -= dx * 0.0042;
      this.tgt.ph += dy * 0.0032;
      this.vth = -dx * 0.0042;
      this.vph = dy * 0.0032;
      this.limits();
    });
    const end = (e: PointerEvent) => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.delete(e.pointerId);
      if (this.two && this.ptrs.size < 2) {
        if (this.two.kind === 'squeeze' && this.squeeze) {
          const f = this.squeeze.f;
          if (f > 1.18) this.ev.onReshape(this.two.room, 1);
          else if (f < 0.85) this.ev.onReshape(this.two.room, -1);
          // Let go: the pages fly from where your fingers left them.
          for (const n of this.nodes.values()) if (n.group === this.two.room) n.from = { ...n.p };
          this.retween(this.two.room);
          this.squeeze = null;
        }
        this.two = null;
      }
      if (this.ptrs.size > 0) return;
      this.dragging = false;
      delete s.dataset.dragging;
      const dn = this.down;
      this.down = null;
      if (dn && dn.moved < 9 && performance.now() - dn.t < 450) {
        this.vth = 0;
        this.vph = 0;
        this.tap(dn.node);
      }
      this.wake();
    };
    on('pointerup', end);
    on('pointercancel', end);
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        this.tgt.r *= Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012));
        this.limits();
        this.wake();
      },
      { passive: false },
    );
    on('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const g = this.tgt;
      const room = this.approached ? this.groupOf(this.approached) : null;
      const keys: Record<string, () => void> = {
        ArrowLeft: () => (g.th += 0.12),
        ArrowRight: () => (g.th -= 0.12),
        ArrowUp: () => (g.ph -= 0.08),
        ArrowDown: () => (g.ph += 0.08),
        '+': () => (g.r *= 0.88),
        '=': () => (g.r *= 0.88),
        '-': () => (g.r *= 1.14),
        Escape: () => this.overview(),
      };
      if (room) {
        keys.l = () => this.ev.onLayout(room, 'list');
        keys.s = () => this.ev.onLayout(room, 'stack');
        keys.g = () => this.ev.onLayout(room, 'grid');
        keys['.'] = () => this.ev.onFlip(room, 1);
        keys[','] = () => this.ev.onFlip(room, -1);
      }
      const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!fn) return;
      if (e.key === 'Escape' && !this.approached) return;
      fn();
      this.limits();
      this.wake();
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /** Move the camera's focus sideways and up or down with the fingers. */
  private pan(dx: number, dy: number) {
    const k = this.cur.r / this.P;
    const cb = Math.cos(this.cur.th);
    const sb = Math.sin(this.cur.th);
    this.tgt.fx -= dx * k * cb;
    this.tgt.fz += dx * k * sb;
    this.tgt.fy -= dy * k;
  }

  private retween(room: string) {
    const now = performance.now();
    for (const n of this.nodes.values()) {
      if (n.group !== room) continue;
      n.t0 = now;
      n.dur = this.reduced ? 0 : TIMING.morph;
    }
  }

  /** A tap on a page (or on nothing). */
  tap(id: string | null) {
    const now = performance.now();
    const n = id ? this.nodes.get(id) : null;
    if (!n || n.sculpture) {
      if (this.approached) this.overview();
      return;
    }
    // Double tap on a room page: the next layout.
    if (this.rooms.has(n.id) && this.lastTap?.id === n.id && now - this.lastTap.t < 340) {
      this.lastTap = null;
      this.ev.onCycle(n.id);
      return;
    }
    this.lastTap = { id: n.id, t: now };
    if (this.approached === n.id) {
      if (!this.rooms.has(n.id)) this.open(n.id);
      return;
    }
    this.approach(n.id);
  }
}
