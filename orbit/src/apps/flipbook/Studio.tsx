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
  addCast,
  poseAt,
  recast,
  removeCast,
  setPose,
  setPaper,
  type Frame,
  type History,
} from './model';
import { figure, looks, STANDING, type Character } from './character';
import { drag, grab, handles, place as placeBones, skeleton, type Pose } from './rig';
import { COLORS, WIDTHS } from './palette';
import { CharacterSheet } from './CharacterSheet';
import { Walkthrough } from './Walkthrough';
import { deskOf, onPaper, placeNote, transformOf, visibleRange, type Desk } from './layout';
import { atRest, coast, COAST_LAND, cornerSpeed, dragFrames, KEEP_PLAYING, lockAxis, riffling, rubber, settle, springStep, velocity } from './scrub';
import { PAPER_KINDS, type GLNote, type PaperGL, type PaperKind } from './paperGL';
import { PaperSound } from './paperSound';
import { FIT, GHOST_AFTER, GHOST_BEFORE, ghostAlpha, paintNote, type Ghost, type View } from './ink';

/**
 * The drawing desk: the U of paper notes, the note you draw on, and the tools along the top.
 * The pen draws; a finger moves the pad (or draws too, with "Draw with a finger" on); two fingers
 * on the note zoom it.
 */

type Tool = 'pen' | 'eraser' | 'pose';
/** A character in its pose on one note. */
interface Fig {
  c: Character;
  pose: Pose;
}
const sameFigs = (a: readonly Fig[], b: readonly Fig[]) => a.length === b.length && a.every((f, i) => f.c === b[i].c && f.pose === b[i].pose);
const figStrokes = (figs: readonly Fig[]) => figs.flatMap((f) => figure(f.c, f.pose));
type Gesture =
  | { kind: 'none' }
  | { kind: 'draw'; id: number; stab: Stabilizer; pts: Pt[] }
  | { kind: 'erase'; id: number; hit: Set<number> }
  | { kind: 'scrub'; id: number; x0: number; y0: number; start: number; base: number; axis: 'x' | 'y' | null; samples: { t: number; p: number }[] }
  | { kind: 'pinch'; a: number; b: number; d0: number; m0: { x: number; y: number }; v0: View }
  | { kind: 'pose'; id: number; castId: string; handle: string; pose: Pose }
  | { kind: 'corner'; id: number; x0: number; y0: number; axis: 'x' | 'y' | null; push: number };

const FINGER_KEY = 'orbit:flipbook:finger';
const readFinger = () => {
  try {
    return localStorage.getItem(FINGER_KEY) === '1';
  } catch {
    return false;
  }
};

const NoteFace = memo(
  function NoteFace({ frame, px, figs }: { frame: Frame | undefined; px: number; figs: readonly Fig[] }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
      const ctx = ref.current?.getContext('2d');
      if (ctx) paintNote(ctx, frame?.strokes ?? [], px, { figures: figStrokes(figs) });
    }, [frame, px, figs]);
    return <canvas ref={ref} className="fb-note-ink" width={px} height={px} aria-hidden />;
  },
  (a, b) => a.frame === b.frame && a.px === b.px && sameFigs(a.figs, b.figs),
);

export function Studio({
  history,
  setHistory,
  isActive,
  saveLine,
  characters,
  onCharacter,
}: {
  history: History;
  setHistory: (fn: (h: History) => History) => void;
  isActive: boolean;
  saveLine: string;
  /** The character library, newest first. */
  characters: Character[];
  onCharacter: (c: Character) => void;
}) {
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
  const [castSheet, setCastSheet] = useState(false);
  const [walking, setWalking] = useState<string | null>(null);
  /** The bending paper on the graphics chip (null: the flat desk, for Reduce Motion or without WebGL2). */
  const [gl, setGl] = useState<PaperGL | null>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const [riffle, setRiffle] = useState<number | null>(null);
  const sound = useRef<PaperSound | null>(null);
  sound.current ??= new PaperSound();
  const [soundOn, setSoundOnState] = useState(() => sound.current!.enabled);
  const wobble = useRef<{ t0: number; amp: number } | null>(null);
  const lastWhole = useRef(0);

  const pos = useRef(0);
  const vel = useRef(0);
  const target = useRef(0);
  const raf = useRef(0);
  const gesture = useRef<Gesture>({ kind: 'none' });
  const touches = useRef(new Map<number, { x: number; y: number; onPaper: boolean }>());
  const notes = useRef(new Map<number, HTMLDivElement>());
  const base = useRef<HTMLCanvasElement | null>(null);

  const onionOpt = useMemo(() => ({ on: onion, count: onionCount }), [onion, onionCount]);
  const live = useRef({ desk, onionOpt, count, motion, scene, index, gl, inkOn: true, figsAt: (_i: number): Fig[] => [] });

  // ---- the characters on this flipbook
  const byId = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const cast = scene.cast ?? [];
  const lead = cast[0] ? (byId.get(cast[0].characterId) ?? null) : null;
  /** Everyone on note `i`, in their pose there (or held from an earlier note, or standing). */
  const figsAt = (i: number, live?: { castId: string; pose: Pose }): Fig[] =>
    cast.flatMap((m) => {
      const c = byId.get(m.characterId);
      if (!c) return [];
      const pose = live?.castId === m.id ? live.pose : (poseAt(scene, i, m.id) ?? STANDING);
      return [{ c, pose }];
    });

  const kind: PaperKind = scene.paper ?? 'sticky';
  live.current = { desk, onionOpt, count, motion, scene, index, gl, inkOn: settled && !playing, figsAt };

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
  const glNotes = useRef(new Map<number, { frame: unknown; figs: Fig[]; key: object }>());
  /** A note's drawing changes only when its ink or its characters' poses change. */
  const keyOf = (i: number, frame: unknown, figs: Fig[]) => {
    const k = glNotes.current.get(i);
    if (k && k.frame === frame && sameFigs(k.figs, figs)) return k.key;
    const key = {};
    glNotes.current.set(i, { frame, figs, key });
    return key;
  };
  const drawGL = useCallback(() => {
    const L = live.current;
    const d = L.desk;
    if (!L.gl || !d) return;
    const p = pos.current;
    const [lo, hi] = visibleRange(Math.round(p), L.count, L.onionOpt);
    const now = performance.now();
    const w = wobble.current;
    const wob = w ? w.amp * Math.sin(((now - w.t0) / 1000) * 19) * Math.exp((-(now - w.t0) / 1000) * 5.5) : 0;
    if (w && now - w.t0 > 1200) wobble.current = null;
    const list: GLNote[] = [];
    for (let i = lo; i <= hi; i++) {
      const frame = L.scene.frames[i];
      const figs = L.figsAt(i);
      list.push({
        i,
        place: placeNote(i, p, d, L.onionOpt),
        key: keyOf(i, frame, figs),
        hideInk: L.inkOn && i === L.index,
        wobble: i === Math.round(p) ? wob : 0,
        paint: (ctx, px) => {
          paintNote(ctx, frame?.strokes ?? [], px, { figures: figStrokes(figs) });
          ctx.font = `italic 600 ${Math.round(px * 0.042)}px Georgia, serif`;
          ctx.fillStyle = 'rgba(60, 50, 20, 0.45)';
          ctx.textAlign = 'right';
          ctx.fillText(String(i + 1), px * 0.965, px * 0.975);
        },
      });
    }
    const root = document.documentElement.style;
    const tilt = { x: parseFloat(root.getPropertyValue('--tx')) || 0, y: parseFloat(root.getPropertyValue('--ty')) || 0 };
    L.gl.draw(list, { size: d.size, kind: L.scene.paper ?? 'sticky', tilt, time: now / 1000 });
    // How many sheets are on the desk, and where the pad is (for tests and tools).
    if (glCanvas.current) {
      glCanvas.current.dataset.notes = String(list.length);
      glCanvas.current.dataset.pos = p.toFixed(2);
    }
    if (wobble.current && !drawPending.current)
      drawPending.current = requestAnimationFrame(() => {
        drawPending.current = 0;
        drawGL();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The paper is drawn at most once per screen frame, however many times the pad moves in between.
  const drawPending = useRef(0);
  const requestDraw = useCallback(() => {
    if (drawPending.current) return;
    drawPending.current = requestAnimationFrame(() => {
      drawPending.current = 0;
      drawGL();
    });
  }, [drawGL]);

  const place = useCallback(() => {
    const { desk: d, onionOpt: o } = live.current;
    if (!d) return;
    const p = pos.current;
    // Each whole note passed: a soft paper flick.
    const whole = Math.floor(p + 0.5);
    if (whole !== lastWhole.current) {
      sound.current?.flick(Math.min(1, Math.abs(vel.current) / 12 + 0.25));
      lastWhole.current = whole;
    }
    if (live.current.gl) requestDraw();
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
    // A note that lands at speed settles with a soft wobble.
    const v = Math.abs(vel.current);
    if (live.current.gl && v > 0.4) wobble.current = { t0: performance.now(), amp: Math.min(0.22, v * 0.035) };
    sound.current?.riffle(0);
    setRiffle(null);
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
        // Real time passes even when frames are slow: small steps keep the spring steady.
        let dt = Math.max(0, Math.min(0.3, (now - last) / 1000));
        last = now;
        let s = { x: pos.current, v: vel.current };
        while (dt > 0) {
          const h = Math.min(0.008, dt);
          s = springStep(s.x, s.v, to, h);
          dt -= h;
        }
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

  /** Let go mid-riffle: it keeps going and slows, then lands; a hard flick keeps the animation playing. */
  const coastFrom = useCallback(
    (v: number) => {
      stopSpring();
      if (Math.abs(v) >= KEEP_PLAYING && v > 0) {
        setRiffle(null);
        sound.current?.riffle(0);
        rest(Math.max(0, Math.min(live.current.count - 1, Math.round(pos.current))));
        setPlaying(true);
        return;
      }
      vel.current = v;
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
        last = now;
        const max = live.current.count - 1;
        const c = coast(pos.current, vel.current, dt);
        pos.current = c.pos;
        vel.current = c.v;
        setRiffle(Math.round(Math.abs(c.v)));
        sound.current?.riffle(Math.abs(c.v));
        if (Math.abs(c.v) < COAST_LAND || c.pos < 0 || c.pos > max) {
          setRiffle(null);
          sound.current?.riffle(0);
          return glide(Math.max(0, Math.min(max, Math.round(c.pos + c.v * 0.12))), c.v);
        }
        place();
        raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [glide, place, rest],
  );

  /** Holding the corner: the pad riffles on its own, as fast as the thumb has pushed. */
  const cornerLoop = useCallback(() => {
    stopSpring();
    let last = performance.now();
    const step = (now: number) => {
      const g = gesture.current;
      const d = live.current.desk;
      if (g.kind !== 'corner' || !d) return;
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      const v = cornerSpeed(g.push, d.perFrame);
      const max = live.current.count - 1;
      vel.current = v;
      pos.current = Math.max(0, Math.min(max, pos.current + v * dt));
      setRiffle(v ? Math.round(Math.abs(v)) : null);
      sound.current?.riffle(Math.abs(v));
      place();
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [place]);

  // The pad shrank (a note torn off, an undo): keep the drawing spot on a real note.
  useEffect(() => {
    if (index > count - 1) rest(count - 1);
  }, [count, index, rest]);

  useEffect(() => () => stopSpring(), []);

  // ---- the bending paper (loaded after the first paint; the flat desk shows until then)
  useEffect(() => {
    if (motion === 'off') return;
    let alive = true;
    let made: PaperGL | null = null;
    void import('./paperGL').then(({ PaperGL: G }) => {
      if (!alive || !glCanvas.current) return;
      made = G.create(glCanvas.current);
      setGl(made);
    });
    return () => {
      alive = false;
      made?.dispose();
      setGl(null);
    };
  }, [motion]);
  useLayoutEffect(() => {
    if (gl && desk) {
      gl.resize(desk.w, desk.h, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
      drawGL();
    }
  }, [gl, desk, drawGL]);
  // The light follows the iPad's tilt: redraw when the tilt changes.
  useEffect(() => {
    if (!gl) return;
    let frame = 0;
    const mo = new MutationObserver(() => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          drawGL();
        });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [gl, drawGL]);

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
      for (const [k, color] of [
        [index - n, GHOST_BEFORE],
        [index + n, GHOST_AFTER],
      ] as const) {
        if (k < 0 || k >= scene.frames.length) continue;
        const strokes = [...figStrokes(figsAt(k)), ...scene.frames[k].strokes];
        if (strokes.length) out.push({ strokes, color, alpha: ghostAlpha(n) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onion, onionCount, scene, index, byId]);

  const frame = scene.frames[index];
  const px = desk ? Math.round(desk.size * Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)) : 0;

  const paintBase = useCallback(
    (skip?: ReadonlySet<number>, livePose?: { castId: string; pose: Pose }) => {
      const cv = inkRef.current;
      if (!cv || !px) return;
      if (!base.current) base.current = document.createElement('canvas');
      const b = base.current;
      if (b.width !== px) b.width = b.height = px;
      const bctx = b.getContext('2d');
      const ctx = cv.getContext('2d');
      if (!bctx || !ctx) return;
      const figs = figsAt(index, livePose);
      paintNote(bctx, frame?.strokes ?? [], px, {
        // On the bending paper the sheet itself is drawn underneath; the flat desk paints its own.
        paper: gl ? false : kind,
        ghosts,
        view,
        skip,
        figures: figStrokes(figs),
        // Posing: every joint you can grab, as a dot on the bones.
        after: tool === 'pose' ? (c) => drawHandles(c, figs, px, view.z) : undefined,
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(b, 0, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame, ghosts, view, px, tool, scene, byId, index, gl, kind],
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
    const at = landNow();
    if (tool === 'pose') {
      const pt = toNote(local(e).x, local(e).y);
      for (const m of cast) {
        const c = byId.get(m.characterId);
        if (!c) continue;
        const pose = poseAt(live.current.scene, at, m.id) ?? STANDING;
        const h = grab(placeBones(skeleton(c.level), pose), pt, 0.045 / view.z);
        if (h) {
          gesture.current = { kind: 'pose', id: e.pointerId, castId: m.id, handle: h.id, pose };
          capture(deskRef.current, e.pointerId);
          return;
        }
      }
      if (!cast.length) toast('Put a character on first: tap the character button.', 'info');
      return;
    }
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
    sound.current?.wake();
    if (e.pointerType === 'pen') {
      // A pen always wins: a resting palm's touches are dropped.
      touches.current.clear();
      if (g.kind === 'scrub') gesture.current = { kind: 'none' };
      if (on) beginInk(e);
      return;
    }
    if (g.kind === 'draw' || g.kind === 'erase' || g.kind === 'pose') return; // a palm while drawing
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
      // The note's bottom-right corner is the riffle handle: hold it and push to flip through.
      if (inCorner(d, p.x, p.y)) {
        if (playing) setPlaying(false);
        gesture.current = { kind: 'corner', id: e.pointerId, x0: p.x, y0: p.y, axis: null, push: 0 };
        setSettled(false);
        capture(deskRef.current, e.pointerId);
        cornerLoop();
        return;
      }
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
    } else if (g.kind === 'pose' && e.pointerId === g.id) {
      const c = byId.get(cast.find((m) => m.id === g.castId)?.characterId ?? '');
      if (!c) return;
      const p = local(e);
      g.pose = drag(skeleton(c.level), g.pose, g.handle, toNote(p.x, p.y));
      paintBase(undefined, { castId: g.castId, pose: g.pose });
    } else if (g.kind === 'scrub' && e.pointerId === g.id) {
      const p = local(e);
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;
      g.axis ??= lockAxis(dx, dy);
      if (!g.axis) return;
      pos.current = rubber(g.base + dragFrames(dx, dy, g.axis, d.perFrame), live.current.count - 1);
      g.samples.push({ t: e.timeStamp, p: pos.current });
      if (g.samples.length > 12) g.samples.shift();
      const v = velocity(g.samples);
      vel.current = v;
      const r = riffling(v, pos.current - g.start);
      setRiffle(r ? Math.round(Math.abs(v)) : null);
      sound.current?.riffle(r ? Math.abs(v) : 0);
      place();
    } else if (g.kind === 'corner' && e.pointerId === g.id) {
      const p = local(e);
      const dx = p.x - g.x0;
      const dy = p.y - g.y0;
      g.axis ??= lockAxis(dx, dy, 4);
      if (g.axis) g.push = g.axis === 'x' ? dx : -dy;
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
    } else if (g.kind === 'pose' && e.pointerId === g.id) {
      gesture.current = { kind: 'none' };
      if (e.type === 'pointercancel') return paintBase();
      const { castId, pose } = g;
      setHistory((h) => commit(h, setPose(h.now, index, castId, pose)));
    } else if (g.kind === 'scrub' && e.pointerId === g.id) {
      gesture.current = { kind: 'none' };
      // The lift-off counts too: a thumb that stopped before letting go is not a flick.
      const v = e.type === 'pointercancel' ? 0 : velocity([...g.samples, { t: e.timeStamp, p: pos.current }]);
      // Riffling when let go: it keeps riffling and slows down (or keeps playing, for a hard flick).
      if (g.axis && riffling(v, pos.current - g.start) && Math.abs(v) > COAST_LAND && live.current.motion !== 'off') return coastFrom(v);
      setRiffle(null);
      sound.current?.riffle(0);
      const to = g.axis ? settle(g.start, pos.current, v, live.current.count - 1) : g.start;
      glide(to, v);
    } else if (g.kind === 'corner' && e.pointerId === g.id) {
      gesture.current = { kind: 'none' };
      stopSpring();
      setRiffle(null);
      sound.current?.riffle(0);
      glide(Math.max(0, Math.min(live.current.count - 1, Math.round(pos.current))));
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
    <div className="fb-studio" data-onion={onion || undefined} data-playing={playing || undefined} data-gl={gl ? true : undefined} data-paper={kind}>
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
          <IconButton icon="person" label="Pose the character" pressed={tool === 'pose'} onClick={() => (cast.length ? setTool('pose') : setCastSheet(true))} />
          {tool === 'pose' && lead && cast[0] && <FacePick c={lead} pose={poseAt(scene, index, cast[0].id) ?? STANDING} onPick={(pose) => setHistory((h) => commit(h, setPose(h.now, index, cast[0].id, pose)))} />}
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
          <IconButton icon="user" label={lead ? `Character: ${lead.name}` : 'Characters'} onClick={() => (landNow(), setCastSheet(true))} />
          <IconButton icon="more" label="More" onClick={() => (landNow(), setMore(true))} />
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
            <canvas ref={glCanvas} className="fb-gl" data-on={gl ? true : undefined} style={{ width: desk.w, height: desk.h }} aria-hidden />
            {!gl && <div className="fb-pile" data-side="next" style={pileStyle(desk, desk.next)} aria-hidden />}
            {!gl && <div className="fb-pile" data-side="done" data-empty={viewPos < 1 || undefined} style={pileStyle(desk, desk.done)} aria-hidden />}
            {!gl && shown.map((i) => (
              <div
                key={i}
                ref={(el) => noteRef(i, el)}
                className="fb-note"
                data-index={i}
                data-blank={i >= scene.frames.length || undefined}
                data-here={(showInk && i === index) || undefined}
                style={{ width: desk.size, height: desk.size }}
              >
                <NoteFace frame={scene.frames[i]} px={desk.size} figs={figsAt(i)} />
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
              // While posing, where each joint is on the note (note units), for tests and tools.
              data-joints={tool === 'pose' && lead && cast[0] ? JSON.stringify(handles(placeBones(skeleton(lead.level), poseAt(scene, index, cast[0].id) ?? STANDING)).map((h) => ({ id: h.id, x: +h.at.x.toFixed(4), y: +h.at.y.toFixed(4) }))) : undefined}
            />
            <span
              className="fb-corner"
              data-hidden={playing || undefined}
              style={{ left: desk.paper.x + desk.size / 2 - desk.size * CORNER, top: desk.paper.y + desk.size / 2 - desk.size * CORNER, width: desk.size * CORNER, height: desk.size * CORNER }}
              aria-hidden
            />
            {riffle !== null && riffle > 0 && (
              <p className="fb-riffle" role="status">
                Riffling · {riffle} a second
              </p>
            )}
            {view.z > 1 && showInk && (
              <button type="button" className="fb-fit" style={{ left: desk.paper.x + desk.size / 2 - 8, top: desk.paper.y - desk.size / 2 + 8 }} onClick={() => setView(FIT)}>
                Fit
              </button>
            )}
          </>
        )}
      </div>

      {castSheet && (
        <CharacterSheet
          library={characters}
          onStage={lead}
          onClose={() => setCastSheet(false)}
          onSave={onCharacter}
          onUse={(c) => {
            if (cast[0]) change((h) => commit(h, recast(h.now, cast[0].id, c.id)), `${c.name} is on the flipbook.`);
            else change((h) => commit(h, addCast(h.now, c.id).scene), `${c.name} is on the flipbook. Pose them with the person button.`);
            setTool('pose');
          }}
          onDraw={(c) => {
            setCastSheet(false);
            setWalking(c.id);
          }}
          onRemove={() => {
            if (cast[0]) change((h) => commit(h, removeCast(h.now, cast[0].id)), 'Taken off the flipbook. Undo puts them back.');
            setCastSheet(false);
            if (tool === 'pose') setTool('pen');
          }}
        />
      )}
      {walking && byId.get(walking) && <Walkthrough character={byId.get(walking)!} onChange={onCharacter} onClose={() => setWalking(null)} />}

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
            <h3>Paper</h3>
            <Segmented label="Paper" value={kind} options={PAPER_KINDS} onChange={(v) => change((h) => commit(h, setPaper(h.now, v)))} />
            <label className="fb-switch">
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={soundOn}
                onChange={(e) => {
                  sound.current?.set(e.target.checked);
                  setSoundOnState(e.target.checked);
                }}
              />
              <span>
                Paper sounds
                <small>A soft flick as each note turns, and a rustle when you riffle.</small>
              </span>
            </label>
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

/** Posing: a dot on every joint you can grab (the hips' dot moves the whole figure). */
function drawHandles(ctx: CanvasRenderingContext2D, figs: readonly Fig[], px: number, z: number) {
  const r = Math.max(3, (px * 0.011) / z);
  for (const f of figs) {
    const placed = placeBones(skeleton(f.c.level), f.pose);
    ctx.lineWidth = Math.max(1.5, (px * 0.003) / z);
    for (const p of placed.values()) {
      ctx.strokeStyle = 'rgba(224, 135, 58, 0.55)';
      ctx.beginPath();
      ctx.moveTo(p.o.x * px, p.o.y * px);
      ctx.lineTo(p.e.x * px, p.e.y * px);
      ctx.stroke();
    }
    for (const p of placed.values()) dot(ctx, p.e.x * px, p.e.y * px, p.bone.len < 0.02 ? r * 0.6 : r, '#ffffff', '#e0873a');
    const root = [...placed.values()][0];
    if (root) dot(ctx, root.o.x * px, root.o.y * px, r * 1.4, '#e0873a', '#ffffff');
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.stroke();
}

/** Which eyes and mouth show on this note (only when the character has more than one look). */
function FacePick({ c, pose, onPick }: { c: Character; pose: Pose; onPick: (p: Pose) => void }) {
  const eyes = looks(c, 'eyes').length;
  const mouths = looks(c, 'mouth').length;
  if (eyes < 2 && mouths < 2) return null;
  return (
    <span className="fb-face" role="group" aria-label="Face on this note">
      {eyes > 1 && (
        <button type="button" className="btn small" onClick={() => onPick({ ...pose, eyes: (pose.eyes + 1) % eyes })}>
          Eyes {(pose.eyes % eyes) + 1}/{eyes}
        </button>
      )}
      {mouths > 1 && (
        <button type="button" className="btn small" onClick={() => onPick({ ...pose, mouth: (pose.mouth + 1) % mouths })}>
          Mouth {(pose.mouth % mouths) + 1}/{mouths}
        </button>
      )}
    </span>
  );
}

/** The riffle handle: this much of the note's bottom-right corner. */
const CORNER = 0.16;
function inCorner(d: Desk, x: number, y: number): boolean {
  const right = d.paper.x + d.size / 2;
  const bottom = d.paper.y + d.size / 2;
  const c = d.size * CORNER;
  return x <= right && y <= bottom && x >= right - c && y >= bottom - c;
}
