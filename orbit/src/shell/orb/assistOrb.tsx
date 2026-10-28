import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type { MotionLevel } from '../../motion/level';
import { cue, tick } from '../../motion/feedback';
import { spring, type Rect, type SpringValue } from './physics';
import { aroundBox, edgeRail, keepOnScreen, nearestT, pingPong, type Point } from './rail';
import { assistIntent, currentAssist, ideaFor, onAssistChange, orbApprove, pickFor, setApprover, type OrbAssist } from './assist';
import { setFieldValue } from './agent';
import { textOf, writable, type Field } from './write';
import { ASSIST_SMALL, assistSpot, restingRect } from './attention';
import { pulse, ringAround, sparks } from './fx';

/**
 * The orb's side of assist.ts: what it does on the step a walkthrough registered.
 *
 *  - Beside the step: it rides along as the step slides in, and lands with it.
 *  - Text step: tap into the box and it offers words. It circles the box while it thinks, then the
 *    idea appears as ghost text inside the box while the orb slides along the box's edge over the
 *    words (around the border for a box of several lines), never over the text. Tap the box again
 *    for a different idea; tap the orb or the ghost (or press Tab) to take it; start typing and the
 *    offer steps aside for the usual ghost text that finishes your sentence.
 *  - Choice step: tap the orb (or say "choose for me") and it hops over the choices while it decides,
 *    then presses its pick.
 *  - Approve: it flies to what was picked, nods, and a ring of light goes round it; then it flies back
 *    to land beside the next step as it slides in.
 *
 * Motion Full gets all of it; Lite short, direct moves; Off (or Reduce Motion) no travel at all.
 */

export type OrbMode = 'follow' | 'parked' | 'tucked' | 'drag' | 'acting' | 'caret';

/**
 * Each frame while it owns the orb: true = moving, 'hold' = owns it but nothing to animate, false =
 * done. `sizeAt` (optional) sets its size from where it is that frame (it squeezes through narrow gaps).
 */
export type Driver = ((t: number) => boolean | 'hold') & { sizeAt?: (x: number, y: number) => number };

export interface OrbParts {
  layer: RefObject<HTMLDivElement | null>;
  x: SpringValue;
  y: SpringValue;
  jelly: SpringValue;
  depth: SpringValue;
  morph: SpringValue;
  size: number;
  sizeTo: (g: number) => void;
  kick: () => void;
  mode: MutableRefObject<OrbMode>;
  level: MutableRefObject<MotionLevel>;
  follows: MutableRefObject<boolean>;
  drive: MutableRefObject<Driver | null>;
  offering: MutableRefObject<boolean>;
  view: () => Rect;
  refocus: () => void;
  syncCaret: () => void;
  rest: () => void;
  flash: (mood: number) => void;
}

/** Chasing a point moving round the box: a little lag and give, so it reads as a body, not a sprite. */
const PATH = spring(0.24, 0.78);
/** Flying to what was picked: quick and purposeful, a touch of overshoot. */
const APPROACH = spring(0.34, 0.78);
/** Hopping over choices while it decides. */
const HOP = spring(0.2, 0.74);
/** Back beside the next step as it slides in. */
const HOME = spring(0.46, 0.86);

/** One swing along a one-line box's edge and back (seconds). */
const SLIDE = 2.6;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The text box of a text step (the target itself, or the box inside it). */
export function fieldOf(a: OrbAssist | null): Field | null {
  if (!a?.target || a.kind !== 'text') return null;
  const own = writable(a.target);
  if (own) return own;
  const inner = a.target.querySelector('textarea, input, [contenteditable]:not([contenteditable="false"])');
  return inner ? writable(inner) : null;
}

function multiLine(field: Field, box: DOMRect): boolean {
  if (field instanceof HTMLInputElement) return false;
  const lh = parseFloat(getComputedStyle(field).lineHeight) || 20;
  return box.height > lh * 1.9;
}

const shownOnScreen = (el: Element | null | undefined): el is HTMLElement => {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
};

interface Offer {
  id: string;
  field: Field;
  n: number;
  base: string;
  status: 'thinking' | 'shown';
  mode?: 'append' | 'replace';
  add?: string;
}

interface Ghost {
  field: Field;
  prefix: string;
  add: string;
  mode: 'append' | 'replace';
  key: number;
}

export interface AssistControls {
  /** A tap on the orb: true when the step took it (choose / take the idea / write one in). */
  tap: () => boolean;
  /** Words said or typed to the orb: true when they were for the step ("choose for me"…). */
  voice: (goal: string) => boolean;
  /** A suggestion for the orb's panel on this step. */
  chip: { label: string; run: () => void } | null;
  /** Drawn in the orb's layer: the offered words. */
  overlay: ReactNode;
}

export function useAssistOrb(parts: OrbParts): AssistControls {
  const P = useRef(parts);
  P.current = parts;
  const [assist, setAssistNow] = useState<OrbAssist | null>(() => currentAssist());
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const offer = useRef<Offer | null>(null);
  const token = useRef(0);
  const counters = useRef(new Map<string, number>());
  const selfTyping = useRef(false);
  const busy = useRef(false);
  /** Where the offered words are on screen (x from…to), measured by the ghost. */
  const range = useRef<{ x0: number; x1: number } | null>(null);
  const ghostKey = useRef(0);

  const nextN = (id: string) => {
    const n = counters.current.get(id) ?? 0;
    counters.current.set(id, n + 1);
    return n;
  };
  const setLook = (state: 'thinking' | 'offer' | 'choosing' | null) => {
    const l = P.current.layer.current;
    if (!l) return;
    if (state) l.setAttribute('data-assist', state);
    else l.removeAttribute('data-assist');
  };

  // ---- the orb's paths
  /** Round the box while it thinks; along its edge (or round it, for several lines) while it offers. */
  const pathDriver = (field: Field, phase: () => 'think' | 'offer'): Driver => {
    let lap: number | null = null;
    let last = 0;
    let since = 0;
    let shown = phase();
    let radius = -1;
    let pads: [number, number, number, number] | null = null;
    /** Where the words are (inside the box's padding): the orb never goes over it. */
    let inner = { left: 0, top: 0, right: 0, bottom: 0 };
    let screen = P.current.view();
    /** One line: on the edge it rides yet, and where in its swing it joined. */
    let railed = false;
    let railFrom = 0;
    let railPhase = 0;
    const drive: Driver = (t) => {
      const p = P.current;
      const m = p.mode.current;
      if (m === 'drag' || m === 'acting' || m === 'caret' || !field.isConnected) return false;
      // Rounding out after being the caret: set off once it is a ball again.
      if (p.morph.value > 0.3) return true;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
      last = t;
      const ph = phase();
      if (ph !== shown || !since) ((shown = ph), (since = t));
      const secs = (t - since) / 1000;
      const box = field.getBoundingClientRect();
      const view = p.view();
      const level = p.level.current;
      const rs = (p.size * ASSIST_SMALL) / 2;
      // It rides just outside the border, close enough to sit on its edge (sizeAt keeps it off the words).
      const pad = rs * 0.45 + 1;
      if (radius < 0) radius = parseFloat(getComputedStyle(field).borderTopLeftRadius) || 0;
      if (!pads) {
        const cs = getComputedStyle(field);
        pads = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => parseFloat(v) || 0) as [number, number, number, number];
      }
      inner = { left: box.left + pads[3], top: box.top + pads[0], right: box.right - pads[1], bottom: box.bottom - pads[2] };
      screen = view;
      const rail = edgeRail(box, view, rs, pad - rs);
      const corner = { x: box.right - rs - 4, y: rail.y };
      const multi = multiLine(field, box);
      const words = range.current;
      let at: Point;
      let hold = false;
      if (level !== 'full') {
        // Lite: one short move to the edge it is nearest (the end of the words, or the corner), and it
        // stays there. It never crosses the box to get there.
        const below = p.y.value > (box.top + box.bottom) / 2 && box.bottom + 2 * rs + 5 <= view.y + view.h;
        const y = below ? box.bottom + pad : rail.y;
        at = ph === 'offer' && !multi && words ? { x: Math.min(box.right - rs, Math.max(box.left + rs, words.x1)), y } : { x: corner.x, y };
        hold = true;
      } else {
        // Full: round the border (never across the box), brisk while it thinks.
        const per = 2 * (box.width + box.height) + 2 * Math.PI * pad;
        if (lap === null) lap = nearestT(box, pad, radius, { x: p.x.value, y: p.y.value });
        const advance = (speed: number) => (lap! += (dt * speed) / Math.max(1, per));
        const onRail = (q: Point) => Math.abs(q.y - rail.y) < 1.5 && q.x >= box.left && q.x <= box.right;
        let q = aroundBox(box, pad, radius, lap);
        if (ph === 'think') {
          advance(620);
          railed = false;
        } else if (multi) {
          // Several lines: a slow lap round it while it offers; then on round to its corner, and rest.
          if (secs <= 9) advance(95);
          else if (!(onRail(q) && q.x >= corner.x - 8)) advance(420);
          else hold = true;
        } else if (!railed) {
          // One line: on round to the edge it rides…
          advance(620);
          q = aroundBox(box, pad, radius, lap);
          if (onRail(q)) {
            railed = true;
            railFrom = secs;
            const x0 = Math.max(box.left + rs, words ? words.x0 + rs * 0.5 : box.left + rs);
            const x1 = Math.min(box.right - rs, words ? Math.max(x0, words.x1 - rs * 0.5) : box.right - rs);
            const u = Math.min(1, Math.max(0, (q.x - x0) / Math.max(1, x1 - x0)));
            const s0 = (Math.acos(1 - 2 * u) / (2 * Math.PI)) * SLIDE;
            // Along the top it was going right (first half of the swing), along the bottom left.
            railPhase = rail.side === 'top' ? s0 : SLIDE - s0;
          }
        }
        q = aroundBox(box, pad, radius, lap);
        if (ph === 'offer' && !multi && railed) {
          // …then slides back and forth along it over the words offered, and settles at their end.
          const x0 = Math.max(box.left + rs, words ? words.x0 + rs * 0.5 : box.left + rs);
          const x1 = Math.min(box.right - rs, words ? Math.max(x0, words.x1 - rs * 0.5) : box.right - rs);
          const calm = secs > 9;
          at = { x: calm ? x1 : x0 + (x1 - x0) * pingPong(secs - railFrom + railPhase, SLIDE), y: rail.y };
          hold = calm;
        } else at = q;
      }
      // No room between the box and the screen's edge: it squeezes through the gap (see sizeAt).
      if (at.x < view.x + rs + 2) at.x = Math.max(at.x, Math.min(view.x + rs + 2, (view.x + inner.left) / 2));
      if (at.x > view.x + view.w - rs - 2) at.x = Math.min(at.x, Math.max(view.x + view.w - rs - 2, (view.x + view.w + inner.right) / 2));
      if (at.y < view.y + rs + 2) at.y = Math.max(at.y, Math.min(view.y + rs + 2, (view.y + inner.top) / 2));
      if (at.y > view.y + view.h - rs - 2) at.y = Math.min(at.y, Math.max(view.y + view.h - rs - 2, (view.y + view.h + inner.bottom) / 2));
      p.x.spring = level === 'full' ? PATH : HOME;
      p.y.spring = p.x.spring;
      p.x.target = at.x;
      p.y.target = at.y;
      return hold ? 'hold' : true;
    };
    // Its size from where it actually is: never over the words, never off the screen (a stretched
    // orb is up to a third longer as it wobbles, hence the 1.35).
    drive.sizeAt = (cx, cy) => {
      const rs = (P.current.size * ASSIST_SMALL) / 2;
      const dx = Math.max(inner.left - cx, 0, cx - inner.right);
      const dy = Math.max(inner.top - cy, 0, cy - inner.bottom);
      const edge = Math.min(cx - screen.x, screen.x + screen.w - cx, cy - screen.y, screen.y + screen.h - cy) - 1;
      const r = Math.max(5, Math.min(rs, (Math.hypot(dx, dy) - 3) / 1.35, edge / 1.35));
      return (2 * r) / P.current.size;
    };
    return drive;
  };

  /** Ride along beside the step for a moment (it slides in), then let the usual placement take over. */
  const track = (ms = 1400) => {
    const p = P.current;
    if (p.level.current === 'off' || p.mode.current !== 'follow') return p.refocus();
    const until = performance.now() + ms;
    let still = 0;
    p.drive.current = (t) => {
      const q = P.current;
      // Done once the time is up, or once it has landed and the step has stopped moving.
      if (q.mode.current !== 'follow' || t > until || still > 12) {
        queueMicrotask(() => q.refocus());
        return false;
      }
      const target = currentAssist()?.target;
      // Where the step will land (it is sliding in), so the orb arrives with it.
      const rest = target?.isConnected ? restingRect(target) : null;
      const spot = target && rest ? assistSpot(target, q.view(), q.size, q.layer.current, rest.moving ? { rect: rest.rect, shift: rest.shift } : {}) : null;
      if (!spot) return true;
      still = rest?.moving || Math.hypot(q.x.value - spot.x, q.y.value - spot.y) > 1 ? 0 : still + 1;
      q.sizeTo((spot.size ?? q.size) / q.size);
      q.x.spring = HOME;
      q.y.spring = HOME;
      q.x.target = spot.x;
      q.y.target = spot.y;
      return true;
    };
    p.kick();
  };

  // ---- offering words for a text step
  const endOffer = (thenCaret = true) => {
    token.current++;
    const o = offer.current;
    offer.current = null;
    if (o) delete (o.field as HTMLElement).dataset.orbOffer;
    setGhost(null);
    range.current = null;
    setLook(null);
    const p = P.current;
    if (!p.offering.current) return;
    p.offering.current = false;
    if (p.drive.current) p.drive.current = null;
    if (thenCaret) {
      // Back to being the caret if the box still has the focus, else beside the step.
      p.syncCaret();
      if (p.mode.current !== 'caret') p.refocus();
    }
  };

  const startOffer = async (n: number) => {
    const a = currentAssist();
    const field = fieldOf(a);
    if (!a || !field || busy.current) return;
    const p = P.current;
    if (p.mode.current === 'drag' || p.mode.current === 'acting') return;
    const my = ++token.current;
    const base = a.value ?? textOf(field);
    offer.current = { id: a.id, field, n, base, status: 'thinking' };
    setGhost(null);
    range.current = null;
    // The usual ghost text (WriteHelp) steps aside for the offer.
    window.dispatchEvent(new CustomEvent('orb:offer'));
    p.offering.current = true;
    p.syncCaret(); // it stops being the caret and rounds out
    setLook('thinking');
    p.sizeTo(ASSIST_SMALL);
    const level = p.level.current;
    if (level === 'full') {
      // Anticipation: a little squash before it sets off round the box.
      p.depth.target = 0.45;
      p.jelly.velocity -= 1.6;
      window.setTimeout(() => ((p.depth.target = 0), p.kick()), 90);
    }
    if (level !== 'off' && p.mode.current === 'follow') {
      p.drive.current = pathDriver(field, () => (offer.current?.status === 'shown' ? 'offer' : 'think'));
    }
    p.kick();
    const started = performance.now();
    const idea = await ideaFor(a.context, base, n);
    // Long enough round the box to read as thinking (Full only).
    if (level === 'full') await wait(Math.max(0, 420 - (performance.now() - started)));
    if (my !== token.current || !offer.current) return;
    const cur = offer.current;
    const appendable = !!base && idea.startsWith(base) && idea.length > base.length;
    const mode: 'append' | 'replace' = !base.trim() || appendable ? 'append' : 'replace';
    const add = appendable ? idea.slice(base.length) : idea;
    cur.status = 'shown';
    cur.mode = mode;
    cur.add = add;
    (field as HTMLElement).dataset.orbOffer = mode;
    ghostKey.current++;
    setGhost({ field, prefix: mode === 'append' ? base : '', add, mode, key: ghostKey.current });
    setLook('offer');
    if (level === 'full') p.jelly.velocity += 2.2;
    tick();
    p.kick();
    // The next idea, ready for the next tap.
    void ideaFor(a.context, base, n + 1);
  };

  /** Put the words in, a few letters at a time (Full / Lite), the way the orb types. */
  const typeIn = async (a: OrbAssist, field: Field | null, from: string, full: string) => {
    const set = (v: string) => {
      selfTyping.current = true;
      try {
        if (a.setValue) a.setValue(v);
        else if (field) setFieldValue(field as HTMLElement, v);
      } finally {
        selfTyping.current = false;
      }
    };
    const level = P.current.level.current;
    const start = full.startsWith(from) ? from.length : 0;
    if (level !== 'off') {
      const steps = Math.max(4, Math.min(16, Math.ceil((full.length - start) / 4)));
      for (let k = 1; k < steps; k++) {
        set(full.slice(0, start + Math.ceil(((full.length - start) * k) / steps)));
        await wait(level === 'full' ? 26 : 14);
      }
    }
    set(full);
    if (field && document.activeElement === field && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      requestAnimationFrame(() => {
        try {
          field.setSelectionRange(field.value.length, field.value.length);
        } catch {
          /* no selection on this kind of box */
        }
      });
    }
  };

  /** A little celebration on the box it just wrote in. */
  const cheer = (el: Element | null) => {
    const p = P.current;
    const level = p.level.current;
    p.flash(1);
    cue('done');
    if (level === 'full') {
      p.jelly.velocity += 3;
      p.y.velocity += 260;
      sparks(p.x.value, p.y.value, level, 7);
    }
    if (el) void ringAround(el, level, 640);
    p.kick();
  };

  const take = async (): Promise<boolean> => {
    const o = offer.current;
    const a = currentAssist();
    if (!o || o.status !== 'shown' || !a || a.id !== o.id || busy.current) return false;
    busy.current = true;
    const full = o.mode === 'append' ? o.base + (o.add ?? '') : (o.add ?? '');
    token.current++;
    delete (o.field as HTMLElement).dataset.orbOffer;
    setGhost(null);
    try {
      await typeIn(a, o.field, o.mode === 'append' ? o.base : '', full);
    } finally {
      busy.current = false;
    }
    offer.current = null;
    cheer(o.field);
    endOffer(true);
    return true;
  };

  /** Write an idea in for them (the orb tapped, or "write it for me"). */
  const fill = async () => {
    const a = currentAssist();
    if (!a || a.kind !== 'text' || busy.current) return;
    const field = fieldOf(a);
    const p = P.current;
    busy.current = true;
    endOffer(false);
    const base = a.value ?? (field ? textOf(field) : '');
    const level = p.level.current;
    setLook('thinking');
    if (field && level !== 'off' && p.mode.current === 'follow') {
      p.offering.current = true;
      p.syncCaret();
      p.sizeTo(ASSIST_SMALL);
      p.drive.current = pathDriver(field, () => 'think');
      p.kick();
    }
    try {
      const idea = await ideaFor(a.context, base, nextN(a.id));
      await typeIn(a, field, base, idea);
      cheer(field ?? a.target);
    } finally {
      busy.current = false;
      setLook(null);
      if (p.offering.current) {
        p.offering.current = false;
        p.drive.current = null;
      }
      p.syncCaret();
      if (p.mode.current !== 'caret') p.refocus();
    }
  };

  // ---- choosing for them
  const flyTo = async (x: number, y: number, sp: typeof HOP, maxMs: number) => {
    const p = P.current;
    p.x.spring = sp;
    p.y.spring = sp;
    p.x.target = x;
    p.y.target = y;
    p.kick();
    const t0 = performance.now();
    while (performance.now() - t0 < maxMs && Math.hypot(p.x.value - x, p.y.value - y) > 6) await wait(16);
  };

  const choose = async () => {
    const a = currentAssist();
    if (!a || a.kind !== 'choice' || !a.options?.length || !a.choose || busy.current) return;
    const p = P.current;
    if (p.mode.current === 'drag' || p.mode.current === 'caret') return;
    busy.current = true;
    endOffer(false);
    const back: OrbMode = p.mode.current === 'acting' ? (p.follows.current ? 'follow' : 'parked') : p.mode.current;
    p.mode.current = 'acting';
    p.drive.current = null;
    setLook('choosing');
    const level = p.level.current;
    let picked: string | null | undefined;
    const pick = pickFor(a.context, a.options).then((id) => (picked = id));
    try {
      if (level === 'full') {
        // A little roulette over the choices while it decides (at least two hops).
        const els = a.options.map((o) => o.el).filter(shownOnScreen);
        p.sizeTo(0.8);
        let i = Math.max(0, els.findIndex((el) => el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true') + 1);
        for (let hops = 0; els.length > 1 && hops < 9 && (picked === undefined || hops < 2); hops++, i++) {
          const el = els[i % els.length];
          const r = el.getBoundingClientRect();
          el.setAttribute('data-orb-hover', '');
          await flyTo(r.left + r.width / 2, r.top + Math.min(r.height / 2, 28), HOP, 240);
          tick();
          p.jelly.velocity += 1.2;
          await wait(40);
          el.removeAttribute('data-orb-hover');
        }
      }
      await pick;
    } catch {
      /* pickFor never throws; just in case */
    }
    setLook(null);
    const id = picked ?? null;
    const opt = a.options.find((o) => o.id === id);
    if (!opt) {
      p.mode.current = back;
      p.sizeTo(1);
      busy.current = false;
      return p.refocus();
    }
    const el = opt.el && opt.el.isConnected ? opt.el : null;
    if (el && level !== 'off') {
      const r = el.getBoundingClientRect();
      const at = keepOnScreen({ x: r.right - 6, y: r.top + 6 }, p.view(), (p.size * 0.78) / 2);
      p.sizeTo(0.78);
      await flyTo(at.x, at.y, APPROACH, 650);
      // Pressed, like a finger would.
      p.depth.target = 1;
      p.kick();
      await wait(100);
      p.depth.target = 0;
      p.kick();
    }
    p.mode.current = back;
    busy.current = false;
    a.choose(opt.id);
    // The step usually approves its own pick (orbApprove); this is the same show, never twice.
    await orbApprove(el);
  };

  // ---- approving what was picked
  const approve = async (el: HTMLElement): Promise<void> => {
    const p = P.current;
    const level = p.level.current;
    if (level === 'off') return;
    const m = p.mode.current;
    if (m === 'caret' || m === 'drag') {
      // It is the caret, or in your hand: the ring alone.
      pulse(el, level);
      void ringAround(el, level);
      await wait(level === 'full' ? 300 : 180);
      return;
    }
    if (offer.current) endOffer(false);
    const back: OrbMode = m === 'acting' ? (p.follows.current ? 'follow' : 'parked') : m;
    p.mode.current = 'acting';
    p.drive.current = null;
    const rs = (p.size * 0.78) / 2;
    const r = el.getBoundingClientRect();
    const at = keepOnScreen({ x: r.right - 6, y: r.top + 6 }, p.view(), rs);
    p.sizeTo(0.78);
    if (level === 'full') {
      // Anticipation: it pulls back and squashes, then goes.
      const dx = at.x - p.x.value, dy = at.y - p.y.value;
      const d = Math.max(1, Math.hypot(dx, dy));
      p.x.velocity -= (dx / d) * 260;
      p.y.velocity -= (dy / d) * 260;
      p.depth.target = 0.5;
      p.jelly.velocity -= 2.2;
      p.kick();
      await wait(80);
      p.depth.target = 0;
    }
    await flyTo(at.x, at.y, APPROACH, level === 'full' ? 650 : 400);
    // The nod: down and back up, a squash, sparks, and a ring of light round the pick.
    if (level === 'full') {
      p.y.velocity += 560;
      p.jelly.velocity += 3.4;
    }
    p.depth.target = 0.85;
    p.kick();
    window.setTimeout(() => ((p.depth.target = 0), p.kick()), 120);
    p.flash(1);
    cue('done');
    pulse(el, level);
    void ringAround(el, level);
    sparks(p.x.value, p.y.value, level);
    await wait(level === 'full' ? 300 : 160);
    // Back to its place for the next step, landing as it slides in.
    window.setTimeout(() => {
      const q = P.current;
      if (q.mode.current !== 'acting') return;
      q.mode.current = back;
      q.sizeTo(1);
      if (back === 'follow') track();
      else q.rest();
    }, 0);
  };

  useEffect(() => {
    setApprover((el) => approve(el));
    return () => setApprover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- the step under it
  const prevId = useRef<string | null>(assist?.id ?? null);
  useEffect(
    () =>
      onAssistChange(() => {
        const a = currentAssist();
        setAssistNow(a);
        const o = offer.current;
        if ((a?.id ?? null) !== prevId.current) {
          prevId.current = a?.id ?? null;
          if (o) endOffer(true);
          // A new step: ride in beside it.
          if (a && !busy.current && P.current.mode.current === 'follow') track();
        } else if (o && a && !selfTyping.current && !busy.current && a.value !== undefined && a.value !== o.base) {
          // Its words changed some other way ("Fill for me"): the offer is out of date.
          endOffer(true);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(
    () => () => {
      token.current++;
      const o = offer.current;
      if (o) delete (o.field as HTMLElement).dataset.orbOffer;
      P.current.offering.current = false;
    },
    [],
  );

  // Taps into the box: the first one (focus) offers an idea, each one after that a different idea.
  const field = fieldOf(assist);
  const assistId = assist?.id ?? null;
  useEffect(() => {
    if (!field || !assistId) return;
    const el = field as HTMLElement;
    let wasFocused = false;
    let down: { x: number; y: number } | null = null;
    const onFocus = () => {
      if (selfTyping.current || busy.current || offer.current) return;
      void startOffer(nextN(assistId));
    };
    const onDown = (e: PointerEvent) => {
      wasFocused = document.activeElement === el;
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10;
      down = null;
      if (wasFocused && !moved && !busy.current) void startOffer(nextN(assistId));
    };
    const onInput = () => {
      if (selfTyping.current || busy.current) return;
      if (offer.current) endOffer(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (offer.current?.status !== 'shown') return;
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        void take();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        endOffer(true);
      }
    };
    const onBlur = (e: FocusEvent) => {
      if ((e.relatedTarget as Element | null)?.closest?.('.orb-layer')) return;
      if (offer.current && !busy.current) endOffer(true);
    };
    el.addEventListener('focus', onFocus);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    // Already in the box when the step arrived.
    if (document.activeElement === el && !offer.current) onFocus();
    return () => {
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, assistId]);

  // ---- what the orb's own controls do on a step
  const ctl = useRef<AssistControls>(null!);
  const live = () => {
    const a = currentAssist();
    return a && a.target?.isConnected ? a : null;
  };
  const tap = () => {
    const a = live();
    if (!a) return false;
    if (busy.current) return true;
    if (a.kind === 'text') {
      if (offer.current?.status === 'shown') void take();
      else void fill();
    } else void choose();
    return true;
  };
  const voice = (goal: string) => {
    const a = live();
    const want = a ? assistIntent(goal) : null;
    if (!a || !want) return false;
    if (a.kind === 'choice') {
      void choose();
      return true;
    }
    if (want === 'another') {
      const f = fieldOf(a);
      if (f && document.activeElement === f) void startOffer(nextN(a.id));
      else void fill();
    } else if (offer.current?.status === 'shown') void take();
    else void fill();
    return true;
  };
  const chip = assist && assist.target ? { label: assist.kind === 'text' ? 'Write it for me' : 'Choose for me', run: () => void tap() } : null;
  ctl.current = {
    tap,
    voice,
    chip,
    overlay: ghost ? <OfferGhost key={ghost.key} ghost={ghost} level={parts.level.current} range={range} onTake={() => void take()} kick={parts.kick} /> : null,
  };
  return ctl.current;
}

// ---------------------------------------------------------------- the offered words, inside the box

const COPY = [
  'boxSizing', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle',
  'borderBottomStyle', 'borderLeftStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant',
  'fontWeight', 'fontStretch', 'fontSize', 'fontFamily', 'lineHeight', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing',
  'wordSpacing', 'tabSize', 'wordBreak', 'overflowWrap', 'direction',
] as const;

/**
 * A see-through copy of the box laid exactly over it (same font, padding and wrapping), with what is
 * written kept invisible and the offered words after it: so they sit right where they would go.
 */
function OfferGhost({
  ghost,
  level,
  range,
  onTake,
  kick,
}: {
  ghost: Ghost;
  level: MotionLevel;
  range: MutableRefObject<{ x0: number; x1: number } | null>;
  onTake: () => void;
  kick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    const field = ghost.field as HTMLElement;
    if (!m) return;
    const s = getComputedStyle(field);
    const ms = m.style as unknown as Record<string, string>;
    for (const p of COPY) ms[p] = (s as unknown as Record<string, string>)[p];
    m.style.borderColor = 'transparent';
    const single = field instanceof HTMLInputElement;
    m.style.whiteSpace = single ? 'pre' : 'pre-wrap';
    let raf = 0;
    let lastKey = '';
    let frames = 0;
    const place = () => {
      const r = field.getBoundingClientRect();
      const w = field.offsetWidth || r.width;
      const h = field.offsetHeight || r.height;
      const key = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)},${field.scrollTop},${field.scrollLeft}`;
      if (key !== lastKey) {
        lastKey = key;
        m.style.width = `${w}px`;
        m.style.height = `${h}px`;
        if (single) {
          const px = (v: string) => parseFloat(v) || 0;
          m.style.lineHeight = `${h - px(s.borderTopWidth) - px(s.borderBottomWidth) - px(s.paddingTop) - px(s.paddingBottom)}px`;
        }
        m.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(${r.width / w}, ${r.height / h})`;
        m.scrollTop = field.scrollTop;
        m.scrollLeft = field.scrollLeft;
        frames = 0;
      }
      // Where the words are (for the orb's slide), re-measured while they appear and when the box moves.
      if (frames++ < 40 && words.current) {
        const rects = words.current.getClientRects();
        if (rects.length) {
          const first = rects[0];
          const lastR = rects[rects.length - 1];
          range.current = { x0: first.left, x1: Math.min(r.right, rects.length > 1 ? r.right : lastR.right) };
          if (frames === 1) kick();
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [ghost, range, kick]);

  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const parts = ghost.add.split(/(\s+)/);
  let i = 0;
  return (
    <div ref={ref} className="oa-mirror" data-mode={ghost.mode} data-level={level}>
      {ghost.prefix && <span className="oa-prefix">{ghost.prefix}</span>}
      <span
        ref={words}
        className="oa-ghost"
        role="button"
        tabIndex={-1}
        aria-label={`Idea: ${ghost.add.trim()}. Tap to use it.`}
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={onTake}
      >
        {parts.map((w, k) =>
          /^\s+$/.test(w) || !w ? (
            w
          ) : (
            <span key={k} className="oa-word" style={{ '--i': i++ } as React.CSSProperties}>
              {w}
            </span>
          ),
        )}
      </span>
    </div>
  );
}
