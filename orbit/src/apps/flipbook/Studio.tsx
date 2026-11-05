import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stabilizer } from '../livedraw/ink/stabilizer';
import { drawVectors, hitStroke, toVector } from '../livedraw/ink/vector';
import type { Pt } from '../livedraw/canvas/sketch';
import { useMotionLevel } from '../../motion/MotionProvider';
import { useShell } from '../../state/shell';
import { IconButton, Segmented, Sheet } from '../../ui/components';
import {
  addStroke,
  clearFrame,
  commit,
  duplicate,
  FPS_CHOICES,
  insertBlank,
  nextStrokeId,
  padLength,
  playable,
  redo as redoH,
  removeFrame,
  removeStrokes,
  setFps,
  undo as undoH,
  type Frame,
  type History,
} from './model';
import { deskOf, onPaper, placeNote, transformOf, visibleRange, type Desk } from './layout';
import { atRest, dragFrames, lockAxis, rubber, settle, springStep, velocity } from './scrub';
import { FIT, GHOST_AFTER, GHOST_BEFORE, ghostAlpha, paintNote, type Ghost, type View } from './ink';

/**
 * The drawing desk: the U of paper notes, the note you draw on, and the tools along the top.
 * The pen draws; a finger moves the pad (or draws too, with "Draw with a finger" on); two fingers
 * on the note zoom it.
 */

const COLORS = [
  { value: '#1d1b22', label: 'Pencil black' },
  { value: '#d2453c', label: 'Red' },
  { value: '#2f62d8', label: 'Blue' },
  { value: '#2f9e5a', label: 'Green' },
  { value: '#e08a1e', label: 'Orange' },
];
const WIDTHS = [
  { value: 0.004, label: 'Thin line' },
  { value: 0.009, label: 'Medium line' },
  { value: 0.018, label: 'Thick line' },
];
type Tool = 'pen' | 'eraser';
type Gesture =
  | { kind: 'none' }
  | { kind: 'draw'; id: number; stab: Stabilizer; pts: Pt[] }
  | { kind: 'erase'; id: number; hit: Set<number> }
  | { kind: 'scrub'; id: number; x0: number; y0: number; start: number; base: number; axis: 'x' | 'y' | null; samples: { t: number; p: number }[] }
  | { kind: 'pinch'; a: number; b: number; d0: number; m0: { x: number; y: number }; v0: View };

const FINGER_KEY = 'orbit:flipbook:finger';
const readFinger = () => {
  try {
    return localStorage.getItem(FINGER_KEY) === '1';
  } catch {
    return false;
  }
};

const NoteFace = memo(function NoteFace({ frame, px }: { frame: Frame | undefined; px: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) paintNote(ctx, frame?.strokes ?? [], px);
  }, [frame, px]);
  return <canvas ref={ref} className="fb-note-ink" width={px} height={px} aria-hidden />;
});

export function Studio({ history, setHistory, isActive, saveLine }: { history: History; setHistory: (fn: (h: History) => History) => void; isActive: boolean; saveLine: string }) {
  const scene = history.now;
  const count = padLength(scene);
  const toast = useShell((s) => s.toast);
  const motion = useMotionLevel();

  const deskRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [index, setIndex] = useState(0);
  const [settled, setSettled] = useState(true);
  const [viewPos, setViewPos] = useState(0);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0].value);
  const [width, setWidth] = useState(WIDTHS[1].value);
  const [onion, setOnion] = useState(false);
  const [onionCount, setOnionCount] = useState(1);
  const [finger, setFingerState] = useState(readFinger);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>(FIT);
  const [more, setMore] = useState(false);

  const pos = useRef(0);
  const vel = useRef(0);
  const target = useRef(0);
  const raf = useRef(0);
  const gesture = useRef<Gesture>({ kind: 'none' });
  const touches = useRef(new Map<number, { x: number; y: number; onPaper: boolean }>());
  const notes = useRef(new Map<number, HTMLDivElement>());
  const base = useRef<HTMLCanvasElement | null>(null);

  const onionOpt = useMemo(() => ({ on: onion, count: onionCount }), [onion, onionCount]);
  const live = useRef({ desk, onionOpt, count, motion, scene, index });
  live.current = { desk, onionOpt, count, motion, scene, index };

  const setFinger = (on: boolean) => {
    setFingerState(on);
    try {
      localStorage.setItem(FINGER_KEY, on ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };

  // ---- the desk's size
  useLayoutEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setDesk((d) => (d && d.w === r.width && d.h === r.height ? d : deskOf(r.width, r.height)));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // ---- placing the notes (straight onto their styles: smooth at the thumb's speed)
  const place = useCallback(() => {
    const { desk: d, onionOpt: o } = live.current;
    if (!d) return;
    const p = pos.current;
    for (const [i, el] of notes.current) {
      const at = placeNote(i, p, d, o);
      el.style.transform = transformOf(at, d.size);
      el.style.zIndex = String(at.z);
      el.style.opacity = String(at.o);
      el.style.setProperty('--lift', at.lift.toFixed(3));
    }
    const vp = Math.round(p);
    setViewPos((cur) => (cur === vp ? cur : vp));
  }, []);

  const noteRef = useCallback((i: number, el: HTMLDivElement | null) => {
    if (el) notes.current.set(i, el);
    else notes.current.delete(i);
  }, []);

  useLayoutEffect(place);

  // ---- moving the pad
  const stopSpring = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const rest = useCallback((i: number) => {
    pos.current = i;
    vel.current = 0;
    target.current = i;
    place();
    setIndex(i);
    setSettled(true);
  }, [place]);

  const glide = useCallback(
    (to: number, v = 0) => {
      stopSpring();
      target.current = to;
      if (live.current.motion === 'off') return rest(to);
      vel.current = v;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        const s = springStep(pos.current, vel.current, to, dt);
        pos.current = s.x;
        vel.current = s.v;
        if (atRest(s.x, s.v, to)) return rest(to);
        place();
        raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [place, rest],
  );

  const go = useCallback(
    (i: number) => {
      const to = Math.max(0, Math.min(live.current.count - 1, i));
      setSettled(false);
      setView(FIT);
      glide(to);
    },
    [glide],
  );

  // The pad shrank (a note torn off, an undo): keep the drawing spot on a real note.
  useEffect(() => {
    if (index > count - 1) rest(count - 1);
  }, [count, index, rest]);

  useEffect(() => () => stopSpring(), []);

  // ---- playing it
  useEffect(() => {
    if (!playing) return;
    const order = playable(scene);
    let k = 0;
    const first = order[0];
    stopSpring();
    pos.current = first;
    place();
    const t = setInterval(() => {
      k = (k + 1) % order.length;
      pos.current = order[k];
      place();
    }, 1000 / scene.fps);
    return () => {
      clearInterval(t);
      rest(Math.round(pos.current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // ---- the note you draw on (sharp, with its ghosts)
  const ghosts = useMemo<Ghost[]>(() => {
    if (!onion) return [];
    const out: Ghost[] = [];
    for (let n = onionCount; n >= 1; n--) {
      const before = scene.frames[index - n];
      const after = scene.frames[index + n];
      if (before?.strokes.length) out.push({ strokes: before.strokes, color: GHOST_BEFORE, alpha: ghostAlpha(n) });
      if (after?.strokes.length) out.push({ strokes: after.strokes, color: GHOST_AFTER, alpha: ghostAlpha(n) });
    }
    return out;
  }, [onion, onionCount, scene, index]);

  const frame = scene.frames[index];
  const px = desk ? Math.round(desk.size * Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)) : 0;

  const paintBase = useCallback(
    (skip?: ReadonlySet<number>) => {
      const cv = inkRef.current;
      if (!cv || !px) return;
      if (!base.current) base.current = document.createElement('canvas');
      const b = base.current;
      if (b.width !== px) b.width = b.height = px;
      const bctx = b.getContext('2d');
      const ctx = cv.getContext('2d');
      if (!bctx || !ctx) return;
      paintNote(bctx, frame?.strokes ?? [], px, { paper: true, ghosts, view, skip });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(b, 0, 0);
    },
    [frame, ghosts, view, px],
  );

  useLayoutEffect(() => {
    if (settled && !playing) paintBase();
  }, [paintBase, settled, playing]);

  /** The live stroke over the base, without repainting the whole note. */
  const paintLive = (pts: Pt[]) => {
    const cv = inkRef.current;
    const ctx = cv?.getContext('2d');
    if (!ctx || !base.current || !px) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(base.current, 0, 0);
    ctx.save();
    ctx.translate(view.ox * px, view.oy * px);
    ctx.scale(view.z, view.z);
    const stroke = toVector(0, pts, width, color);
    // Same drawing as the saved stroke, so lifting the pen changes nothing on screen.
    drawVectors(ctx, [stroke], px, px);
    ctx.restore();
  };

  // ---- pointer input
  const local = (e: { clientX: number; clientY: number }) => {
    const r = deskRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** A desk point in the note's own units (0..1), through the zoom. */
  const toNote = (x: number, y: number) => {
    const d = live.current.desk!;
    const mx = (x - (d.paper.x - d.size / 2)) / d.size;
    const my = (y - (d.paper.y - d.size / 2)) / d.size;
    return { x: (mx - view.ox) / view.z, y: (my - view.oy) / view.z };
  };
  const sample = (e: PointerEvent | React.PointerEvent): Pt => {
    const p = local(e);
    const n = toNote(p.x, p.y);
    const pressure = e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.6;
    return { x: n.x, y: n.y, p: pressure, tilt: 0, t: e.timeStamp };
  };

  /** Pen down while the pad is still moving: land on the note in the middle first. */
  const landNow = () => {
    if (settled && !raf.current) return index;
    const i = Math.max(0, Math.min(count - 1, Math.round(target.current)));
    stopSpring();
    rest(i);
    return i;
  };

  const beginInk = (e: React.PointerEvent) => {
    if (playing) setPlaying(false);
    landNow();
    if (tool === 'eraser') {
      gesture.current = { kind: 'erase', id: e.pointerId, hit: new Set() };
      eraseAt(e.nativeEvent);
    } else {
      const stab = new Stabilizer(0, 0.3);
      const pts = stab.push(sample(e));
      gesture.current = { kind: 'draw', id: e.pointerId, stab, pts };
      // The live stroke needs the base painted for this note.
      requestAnimationFrame(() => {
        const g = gesture.current;
        if (g.kind === 'draw') paintLive(g.pts);
      });
    }
    capture(deskRef.current, e.pointerId);
  };

  const eraseAt = (e: PointerEvent) => {
    const g = gesture.current;
    if (g.kind !== 'erase' || !frame) return;
    const s = sample(e);
    const hit = hitStroke(frame.strokes.filter((st) => !g.hit.has(st.id)), s, 0.014 / view.z);
    if (hit) {
      g.hit.add(hit.id);
      paintBase(g.hit);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    const d = live.current.desk;
    if (!d) return;
    const p = local(e);
    const on = onPaper(d, p.x, p.y);
    const g = gesture.current;
    if (e.pointerType === 'pen') {
      // A pen always wins: a resting palm's touches are dropped.
      touches.current.clear();
      if (g.kind === 'scrub') gesture.current = { kind: 'none' };
      if (on) beginInk(e);
      return;
    }
    if (g.kind === 'draw' || g.kind === 'erase') return; // a palm while drawing
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      if (on) return beginInk(e);
    }
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { ...p, onPaper: on });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.entries()];
        if (a[1].onPaper && b[1].onPaper && !onion) {
          // Two fingers on the note: zoom. Whatever the first finger had started is put back.
          if (g.kind === 'scrub') {
            pos.current = g.start;
            place();
          }
          landNow();
          gesture.current = {
            kind: 'pinch',
            a: a[0],
            b: b[0],
            d0: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y) || 1,
            m0: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 },
            v0: view,
          };
        }
        return;
      }
      if (touches.current.size > 2) return;
      if (finger && on && settled) return beginInk(e);
    }
    // A finger (or the mouse off the note): move the pad.
    if (playing) setPlaying(false);
    stopSpring();
    const start = Math.round(target.current);
    gesture.current = { kind: 'scrub', id: e.pointerId, x0: p.x, y0: p.y, start, base: pos.current, axis: null, samples: [{ t: e.timeStamp, p: pos.current }] };
    setSettled(false);
    if (view.z !== 1) setView(FIT);
    capture(deskRef.current, e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const d = live.current.desk;
    if (!d) return;
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { ...local(e), onPaper: touches.current.get(e.pointerId)!.onPaper });
    if (g.kind === 'draw' && e.pointerId === g.id) {
      const evs = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e.nativeEvent]) g.pts.push(...g.stab.push(sample(ev)));
      paintLive(g.pts);
    } else if (g.kind === 'erase' && e.pointerId === g.id) {
      eraseAt(e.nativeEvent);
    } else if (g.kind === 'scrub' && e.pointerId === g.id) {
      const p = local(e);
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;
      g.axis ??= lockAxis(dx, dy);
      if (!g.axis) return;
      pos.current = rubber(g.base + dragFrames(dx, dy, g.axis, d.perFrame), live.current.count - 1);
      g.samples.push({ t: e.timeStamp, p: pos.current });
      if (g.samples.length > 12) g.samples.shift();
      place();
    } else if (g.kind === 'pinch') {
      const a = touches.current.get(g.a);
      const b = touches.current.get(g.b);
      if (!a || !b) return;
      const z = Math.min(5, Math.max(1, (g.v0.z * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0));
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const left = d.paper.x - d.size / 2;
      const top = d.paper.y - d.size / 2;
      const m0 = { x: (g.m0.x - left) / d.size, y: (g.m0.y - top) / d.size };
      const m1 = { x: (m.x - left) / d.size, y: (m.y - top) / d.size };
      const c = { x: (m0.x - g.v0.ox) / g.v0.z, y: (m0.y - g.v0.oy) / g.v0.z };
      const clampO = (o: number) => Math.min(0, Math.max(1 - z, o));
      setView({ z, ox: clampO(m1.x - c.x * z), oy: clampO(m1.y - c.y * z) });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    touches.current.delete(e.pointerId);
    if (g.kind === 'draw' && e.pointerId === g.id) {
      gesture.current = { kind: 'none' };
      const pts = [...g.pts, ...g.stab.finish(sample(e))];
      if (!pts.length || e.type === 'pointercancel') return paintBase();
      const stroke = toVector(nextStrokeId(scene), pts, width, color);
      setHistory((h) => commit(h, addStroke(h.now, index, stroke)));
    } else if (g.kind === 'erase' && e.pointerId === g.id) {
      gesture.current = { kind: 'none' };
      if (g.hit.size) setHistory((h) => commit(h, removeStrokes(h.now, index, g.hit)));
    } else if (g.kind === 'scrub' && e.pointerId === g.id) {
      gesture.current = { kind: 'none' };
      // The lift-off counts too: a thumb that stopped before letting go is not a flick.
      const v = e.type === 'pointercancel' ? 0 : velocity([...g.samples, { t: e.timeStamp, p: pos.current }]);
      const to = g.axis ? settle(g.start, pos.current, v, live.current.count - 1) : g.start;
      glide(to, v);
    } else if (g.kind === 'pinch' && (e.pointerId === g.a || e.pointerId === g.b)) {
      gesture.current = { kind: 'none' };
      touches.current.clear();
      if (view.z < 1.05) setView(FIT);
    }
  };

  // A mouse wheel or trackpad moves the pad too, landing on the nearest note when it stops.
  const wheelIdle = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    const d = live.current.desk;
    if (!d || gesture.current.kind !== 'none') return;
    if (playing) setPlaying(false);
    stopSpring();
    setSettled(false);
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    pos.current = rubber(pos.current + delta / d.perFrame, live.current.count - 1);
    place();
    clearTimeout(wheelIdle.current);
    wheelIdle.current = window.setTimeout(() => glide(Math.max(0, Math.min(live.current.count - 1, Math.round(pos.current)))), 140);
  };

  // ---- actions
  const undo = useCallback(() => setHistory(undoH), [setHistory]);
  const redo = useCallback(() => setHistory(redoH), [setHistory]);
  const change = (fn: (h: History) => History, note?: string) => {
    setHistory(fn);
    if (note) toast(note, 'info');
  };

  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        go(Math.round(target.current) + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        go(Math.round(target.current) - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, undo, redo, go]);

  // Leaving the app (or switching away) stops playback.
  useEffect(() => {
    if (!isActive) setPlaying(false);
  }, [isActive]);

  // ---- what's on the desk
  const [lo, hi] = desk ? visibleRange(viewPos, count, onionOpt) : [0, -1];
  const shown: number[] = [];
  for (let i = lo; i <= hi; i++) shown.push(i);
  const showInk = settled && !playing;
  const isBlank = index >= scene.frames.length;
  const frameLine = isBlank ? `New note · ${scene.frames.length} so far` : `Frame ${index + 1} of ${scene.frames.length}`;

  return (
    <div className="fb-studio" data-onion={onion || undefined} data-playing={playing || undefined}>
      <header className="fb-top" role="toolbar" aria-label="Flipbook tools">
        <div className="fb-group fb-where">
          <IconButton icon="back" label="Previous note" onClick={() => go(Math.round(target.current) - 1)} disabled={index === 0 && settled} />
          <p className="fb-frame" aria-live="polite">
            {frameLine}
          </p>
          <IconButton icon="forward" label="Next note" onClick={() => go(Math.round(target.current) + 1)} disabled={index >= count - 1 && settled} />
        </div>
        <div className="fb-group" role="group" aria-label="Drawing tools">
          <IconButton icon="pencil" label="Pen" pressed={tool === 'pen'} onClick={() => setTool('pen')} />
          <IconButton icon="eraser" label="Eraser" pressed={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <span className="fb-sep" aria-hidden />
          {WIDTHS.map((w) => (
            <button key={w.value} type="button" className="fb-width" aria-label={w.label} title={w.label} aria-pressed={tool === 'pen' && width === w.value} onClick={() => (setWidth(w.value), setTool('pen'))}>
              <span style={{ width: 4 + w.value * 500, height: 4 + w.value * 500 }} />
            </button>
          ))}
          <span className="fb-sep" aria-hidden />
          {COLORS.map((c) => (
            <button key={c.value} type="button" className="fb-swatch" aria-label={c.label} title={c.label} aria-pressed={tool === 'pen' && color === c.value} onClick={() => (setColor(c.value), setTool('pen'))}>
              <span style={{ background: c.value }} />
            </button>
          ))}
        </div>
        <div className="fb-group">
          <IconButton icon="undo" label="Undo" onClick={undo} disabled={!history.past.length} />
          <IconButton icon="redo" label="Redo" onClick={redo} disabled={!history.future.length} />
          <IconButton icon="layers" label={onion ? 'Onion view on' : 'Onion view'} pressed={onion} onClick={() => setOnion((o) => !o)} />
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Stop' : 'Play'} pressed={playing} onClick={() => setPlaying((p) => !p)} />
          <IconButton icon="more" label="More" onClick={() => setMore(true)} />
        </div>
      </header>

      <div
        className="fb-desk"
        ref={deskRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        data-tool={tool}
        aria-label="Paper notes. Draw on the note in the middle with the pen. Drag with a finger to turn the notes."
      >
        {desk && (
          <>
            <div className="fb-pile" data-side="next" style={pileStyle(desk, desk.next)} aria-hidden />
            <div className="fb-pile" data-side="done" data-empty={viewPos < 1 || undefined} style={pileStyle(desk, desk.done)} aria-hidden />
            {shown.map((i) => (
              <div
                key={i}
                ref={(el) => noteRef(i, el)}
                className="fb-note"
                data-index={i}
                data-blank={i >= scene.frames.length || undefined}
                data-here={(showInk && i === index) || undefined}
                style={{ width: desk.size, height: desk.size }}
              >
                <NoteFace frame={scene.frames[i]} px={desk.size} />
                <span className="fb-note-no" aria-hidden>
                  {i + 1}
                </span>
              </div>
            ))}
            <canvas
              ref={inkRef}
              className="fb-ink"
              data-shown={showInk || undefined}
              width={px}
              height={px}
              style={{ left: desk.paper.x - desk.size / 2, top: desk.paper.y - desk.size / 2, width: desk.size, height: desk.size }}
              aria-label={`The note you draw on: ${frameLine}`}
              role="img"
            />
            {view.z > 1 && showInk && (
              <button type="button" className="fb-fit" style={{ left: desk.paper.x + desk.size / 2 - 8, top: desk.paper.y - desk.size / 2 + 8 }} onClick={() => setView(FIT)}>
                Fit
              </button>
            )}
          </>
        )}
      </div>

      {more && (
        <Sheet title="Flipbook" onClose={() => setMore(false)}>
          <section className="fb-more">
            <h3>This note</h3>
            <div className="fb-more-actions">
              <button type="button" className="btn" onClick={() => (change((h) => commit(h, insertBlank(h.now, index))), setMore(false))}>
                Slip in a blank note here
              </button>
              <button
                type="button"
                className="btn"
                disabled={isBlank}
                onClick={() => {
                  change((h) => commit(h, duplicate(h.now, index)), 'Copied onto the next note.');
                  setMore(false);
                  go(index + 1);
                }}
              >
                Copy onto the next note
              </button>
              <button type="button" className="btn" disabled={isBlank || !frame?.strokes.length} onClick={() => (change((h) => commit(h, clearFrame(h.now, index)), 'Note wiped. Undo brings it back.'), setMore(false))}>
                Wipe this note
              </button>
              <button type="button" className="btn danger" disabled={isBlank} onClick={() => {
                  change((h) => commit(h, removeFrame(h.now, index)), 'Note torn off. Undo puts it back.');
                  setMore(false);
                  // Tearing off the last drawn note steps back to the one before, not onto the blank pad.
                  if (index > 0 && index === scene.frames.length - 1) rest(index - 1);
                }}
              >
                Tear off this note
              </button>
            </div>
            <h3>Onion view</h3>
            <p className="fb-hint">Shows the notes before (red) and after (blue) faintly under the one you draw on, and lays them out as cards.</p>
            <Segmented label="Notes each side" value={String(onionCount) as '1' | '2' | '3'} options={[{ value: '1', label: '1 each side' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} onChange={(v) => (setOnionCount(Number(v)), setOnion(true))} />
            <h3>Speed</h3>
            <Segmented
              label="Frames per second"
              value={String(scene.fps) as '8' | '12' | '24'}
              options={FPS_CHOICES.map((f) => ({ value: String(f) as '8' | '12' | '24', label: `${f} a second` }))}
              onChange={(v) => change((h) => commit(h, setFps(h.now, Number(v))))}
            />
            <h3>Fingers</h3>
            <label className="fb-switch">
              <input type="checkbox" role="switch" className="switch" checked={finger} onChange={(e) => setFinger(e.target.checked)} />
              <span>
                Draw with a finger
                <small>{finger ? 'A finger on the note draws; a finger anywhere else turns the notes.' : 'Only the pen draws. A finger turns the notes; two fingers on the note zoom.'}</small>
              </span>
            </label>
            <p className="fb-hint">{saveLine}</p>
          </section>
        </Sheet>
      )}
    </div>
  );
}

/** Keep getting a pointer's moves even when it leaves the desk (some pointers can't be captured). */
function capture(el: HTMLElement | null, id: number) {
  try {
    el?.setPointerCapture(id);
  } catch {
    /* fine without */
  }
}

function pileStyle(desk: Desk, at: { x: number; y: number }): React.CSSProperties {
  const s = desk.size * desk.k;
  return { left: at.x - s / 2, top: at.y - s / 2, width: s, height: s };
}
