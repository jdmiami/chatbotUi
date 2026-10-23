import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { Op } from './doc';
import { REFERENCE_ALPHA, floodRegion, growRegion, lassoOk, paintRegion, thinPath, type XY } from './raster';
import { renderOps } from './render';
import { POSE_LIMBS, POSE_POINTS, POSE_COLORS, movePoint } from './pose';
import { drawStroke, fillGap, hexRgb, pressureOf, smoothPoint, tiltOf, type Pt, type Stroke } from './sketch';
import { DabWalker, dabsFor, strokeLength } from '../brushes/dabs';
import { BASE } from '../brushes/presets';
import type { Brush } from '../brushes/types';
import { createRenderer, type Renderer } from '../engine/renderer';
import { PerspectiveSnap, activeVps, gridLines, type Perspective } from '../guides/perspective';
import { applyMat, mirrorDabs, symmetryAxes, symmetryMats, type Symmetry } from '../guides/symmetry';
import { SHAPE_NAMES, adjustShape, recognize, shapePoints, type Shape } from '../ink/quickshape';
import { Stabilizer } from '../ink/stabilizer';
import { hitPoint, hitStroke, moveStroke, movePoint as moveVPoint, toVector, type VStroke } from '../ink/vector';
import { activeLayer, addOp, layerById, nextId, patchLayer, type StrokeOp, type StudioDoc } from '../layers/model';
import { FIT, cssTransform, fromPaper, lerpView, pinchView, settleView, tapAction, toPaper, zoomAbout, type View } from '../ui/gestures';

export type StageTool = 'brush' | 'eraser' | 'smudge' | 'fill' | 'picker' | 'select';

export interface Region {
  id: number;
  points: XY[];
  prompt: string;
}

export interface Guides {
  perspective: Perspective;
  symmetry: Symmetry;
  /** Pulled string length, 0..1 (0 = off). */
  rope: number;
  /** Hold at the end of a stroke to snap it to a clean shape. */
  quickShape: boolean;
  /** The guide's points can be dragged. */
  edit: boolean;
}

export interface StageHandle {
  /** Bring the canvas in step with the drawing (after undo, redo, a layer change). */
  redraw(): void;
  renderer(): Renderer | null;
  /** The Paint over mask, the stroke being drawn included. */
  maskOps(): Op[];
  /** The stroke being drawn, if any (the machine's lines include it). */
  live(): { layerId: number; op: StrokeOp } | null;
  /** Back to the whole canvas, upright. */
  fit(): void;
}

/** A two- or three-finger tap shorter than this, that barely moves, is Undo or Redo. */
const TAP_MS = 350;
const HOLD_MS = 520;
const EYEDROPPER_MS = 450;
const MASK_TINT = '#ff3d8b';
const engineChoice = (): 'auto' | '2d' => {
  try {
    return localStorage.getItem('orbit:livedraw:engine') === '2d' ? '2d' : 'auto';
  } catch {
    return 'auto';
  }
};

/** The look of ink on a vector layer while it is drawn (it matches how the finished stroke is drawn). */
const VECTOR_INK: Brush = { ...BASE, id: 'vector-ink', name: 'Ink', hardness: 1, spacing: 0.04, smoothing: 0.45, dynamics: { ...BASE.dynamics, size: { pressure: 0.7, tilt: 0, speed: 0 } } };

interface Drawing {
  id: number;
  op: StrokeOp;
  layerId: number;
  toMask: boolean;
  vector: boolean;
  walker: DabWalker;
  stab: Stabilizer;
  persp: PerspectiveSnap | null;
  raw: Pt;
  startClient: XY;
  still: XY;
  snapped: { shape: Shape; anchor: XY; from: XY } | null;
}

interface MaskDrawing {
  id: number;
  stroke: Stroke;
  last: Pt;
  raw: Pt;
}

/**
 * The one canvas: the AI picture underneath, the reference picture to trace, then your layers (drawn
 * by the GPU engine and faded together by Ink), and on top what you are steering with (the Paint over
 * mask, regions, the pose figure, the guides). A Pencil draws and a resting hand doesn't; once a
 * Pencil has been seen, fingers move the canvas. Two fingers pinch, twist and tap to undo, three tap
 * to redo, four tap to hide the tools; a press held still picks a colour; held with two fingers (or
 * one, while a Pencil is in use) it opens the quick menu. A Pencil hovering shows the brush's size.
 */
export function Stage({
  ref,
  doc,
  tool,
  brush,
  color,
  sizeScale,
  opacityScale,
  painting,
  lasso,
  maskEdit,
  visible,
  ink,
  picture,
  living,
  reference,
  regions,
  pose,
  guides,
  selected,
  penOnly,
  onPenOnly,
  onStroke,
  onChange,
  onPick,
  onLasso,
  onPose,
  onUndo,
  onRedo,
  onRadial,
  onToggleUi,
  onGuides,
  onSelect,
  onNote,
  onEngine,
}: {
  ref?: Ref<StageHandle>;
  doc: StudioDoc;
  tool: StageTool;
  brush: Brush;
  color: string;
  sizeScale: number;
  opacityScale: number;
  /** Paint over: strokes paint the mask (white = may change). */
  painting: boolean;
  lasso: boolean;
  /** Strokes go onto the active layer's mask. */
  maskEdit: boolean;
  visible: { picture: boolean; reference: boolean };
  ink: number;
  picture: string | null;
  living: boolean;
  reference: string | null;
  regions: Region[];
  pose: XY[] | null;
  guides: Guides;
  /** The selected vector stroke (Edit ink). */
  selected: number | null;
  penOnly: boolean;
  onPenOnly(on: boolean): void;
  /** A stroke moved (send at most every so often) or ended (send now). */
  onStroke(phase: 'move' | 'end'): void;
  /** The drawing changed (a stroke, a fill, an edit): redraw panels. */
  onChange(): void;
  onPick(color: string): void;
  onLasso(points: XY[]): void;
  onPose(points: XY[]): void;
  onUndo(): void;
  onRedo(): void;
  /** Open the quick menu at a screen point. */
  onRadial(x: number, y: number): void;
  onToggleUi(): void;
  onGuides(next: { perspective?: Perspective; symmetry?: Symmetry }): void;
  onSelect(id: number | null): void;
  onNote(text: string): void;
  onEngine(kind: Renderer['kind']): void;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const pictureRef = useRef<HTMLImageElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const ropeRef = useRef<SVGLineElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const [paper, setPaper] = useState(0); // css px
  const px = useRef(0); // canvas px
  const view = useRef<View>(FIT);
  const drawing = useRef<Drawing | null>(null);
  const maskDrawing = useRef<MaskDrawing | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number; sx: number; sy: number }>());
  const gesture = useRef<{ at: number; most: number; moved: boolean; held: boolean } | null>(null);
  const pinch = useRef<{ v0: View; a0: XY; b0: XY; ids: [number, number] } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picking = useRef<number | null>(null);
  const lassoPts = useRef<XY[] | null>(null);
  const [lassoPath, setLassoPath] = useState<XY[] | null>(null);
  const tapAt = useRef<{ id: number; x: number; y: number } | null>(null);
  const vdrag = useRef<{ pointer: number; strokeId: number; point: number; from: XY; orig: VStroke; layerId: number; moved: boolean } | null>(null);
  const [vEdit, setVEdit] = useState<VStroke | null>(null);
  const lastPen = useRef<{ x: number; y: number; t: number } | null>(null);
  const penSeen = useRef(penOnly);
  penSeen.current = penOnly;
  const anim = useRef(0);
  // Read by the pointer handlers without re-binding them.
  const props = useRef({ tool, brush, color, sizeScale, opacityScale, painting, lasso, maskEdit, guides, selected, onStroke, onChange, onPick, onLasso, onUndo, onRedo, onRadial, onToggleUi, onSelect, onNote, onPenOnly });
  props.current = { tool, brush, color, sizeScale, opacityScale, painting, lasso, maskEdit, guides, selected, onStroke, onChange, onPick, onLasso, onUndo, onRedo, onRadial, onToggleUi, onSelect, onNote, onPenOnly };

  const applyView = () => {
    const el = paperRef.current;
    if (el) el.style.transform = cssTransform(view.current);
  };
  const animateTo = (to: View) => {
    cancelAnimationFrame(anim.current);
    const from = view.current;
    const reduce = document.documentElement.dataset.motion === 'off' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      view.current = to;
      return applyView();
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 220);
      view.current = lerpView(from, to, 1 - (1 - k) ** 3);
      applyView();
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  const redrawMask = useCallback(() => {
    const c = maskRef.current;
    if (!c || !c.width) return;
    const ops: Op[] = maskDrawing.current ? [...doc.state.paintMask, { kind: 'stroke', stroke: maskDrawing.current.stroke }] : doc.state.paintMask;
    renderOps(c, ops, { color: MASK_TINT, skipFills: true });
  }, [doc]);

  const redraw = useCallback(() => {
    renderer.current?.sync(doc.state);
    redrawMask();
    // The selected ink stroke may have changed under us (undo).
    const sel = props.current.selected;
    if (sel !== null) {
      const l = activeLayer(doc.state);
      const s = l?.vectors.find((v) => v.id === sel) ?? null;
      setVEdit(s);
      if (!s) props.current.onSelect(null);
    }
  }, [doc, redrawMask]);

  useImperativeHandle(
    ref,
    () => ({
      redraw,
      renderer: () => renderer.current,
      maskOps: () => (maskDrawing.current ? [...doc.state.paintMask, { kind: 'stroke', stroke: maskDrawing.current.stroke }] : doc.state.paintMask),
      live: () => (drawing.current ? { layerId: drawing.current.layerId, op: drawing.current.op } : null),
      fit: () => animateTo(FIT),
    }),
    [redraw, doc],
  );

  // The engine: the GPU one where there is WebGL2.
  useEffect(() => {
    const c = artRef.current;
    if (!c) return;
    let gone = false;
    void createRenderer(c, engineChoice()).then((r) => {
      if (gone) return r.destroy();
      renderer.current = r;
      onEngine(r.kind);
      c.dataset.engine = r.kind;
      if (px.current) r.resize(px.current);
      r.sync(doc.state);
    });
    return () => {
      gone = true;
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  // The paper: the largest square that fits (letterboxed), drawn at the screen's pixel density.
  useLayoutEffect(() => {
    const box = viewRef.current;
    if (!box) return;
    const fit = () => {
      const side = Math.max(120, Math.floor(Math.min(box.clientWidth, box.clientHeight) - 16));
      setPaper(side);
      const want = Math.min(2048, Math.max(512, Math.round(side * Math.min(3, window.devicePixelRatio || 1))));
      if (want !== px.current) {
        px.current = want;
        const m = maskRef.current;
        if (m) m.width = m.height = want;
        renderer.current?.resize(want);
        redrawMask();
      }
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(box);
    window.addEventListener('resize', fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [redrawMask]);

  useEffect(() => applyView(), [paper]);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // ---- points
  const paperBase = () => {
    const v = viewRef.current!.getBoundingClientRect();
    const p = paperRef.current!;
    return { bx: v.left + p.offsetLeft, by: v.top + p.offsetTop };
  };
  /** A screen point in canvas units (0..1 across the paper; outside it past the edges). */
  const unitOf = (clientX: number, clientY: number): XY => {
    const { bx, by } = paperBase();
    const p = toPaper(view.current, { x: clientX - bx, y: clientY - by });
    const side = Math.max(1, paper || paperRef.current?.clientWidth || 1);
    return { x: p.x / side, y: p.y / side };
  };
  const pointOf = (e: PointerEvent): Pt => {
    const u = unitOf(e.clientX, e.clientY);
    const ev = e as PointerEvent & { azimuthAngle?: number };
    let az: number | undefined;
    if (e.pointerType === 'pen') {
      if (typeof ev.azimuthAngle === 'number') az = ev.azimuthAngle;
      else if (e.tiltX || e.tiltY) az = Math.atan2(e.tiltY, e.tiltX);
      if (az !== undefined) az -= view.current.r;
    }
    return { x: u.x, y: u.y, p: pressureOf(e), tilt: tiltOf(e), az, t: e.timeStamp };
  };
  /** A canvas point on screen, relative to the view box. */
  const screenOf = (p: XY): XY => {
    const side = paper || 1;
    const v = viewRef.current!.getBoundingClientRect();
    const { bx, by } = paperBase();
    const s = fromPaper(view.current, { x: p.x * side, y: p.y * side });
    return { x: s.x + bx - v.left, y: s.y + by - v.top };
  };

  // ---- colour under a point: your layers over the picture over the paper
  const sample = (x: number, y: number): string => {
    const r = renderer.current;
    const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
    let under: [number, number, number] = [255, 255, 255];
    const img = pictureRef.current;
    if (img?.naturalWidth) {
      try {
        const one = document.createElement('canvas');
        one.width = one.height = 1;
        const g = one.getContext('2d')!;
        g.drawImage(img, Math.floor(x * img.naturalWidth), Math.floor(y * img.naturalHeight), 1, 1, 0, 0, 1, 1);
        const d = g.getImageData(0, 0, 1, 1).data;
        under = [d[0], d[1], d[2]];
      } catch {
        /* a picture from elsewhere can't be read */
      }
    }
    if (!r) return hex(under);
    const [pr, pg, pb, pa] = r.pixel(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
    const k = 1 - pa / 255;
    return hex([pr + under[0] * k, pg + under[1] * k, pb + under[2] * k]);
  };

  const showLoupe = (clientX: number, clientY: number, c: string | null) => {
    const el = loupeRef.current;
    if (!el) return;
    if (!c) {
      el.style.display = 'none';
      return;
    }
    const v = viewRef.current!.getBoundingClientRect();
    el.style.display = 'block';
    el.style.transform = `translate(${clientX - v.left - 44}px, ${clientY - v.top - 110}px)`;
    el.style.setProperty('--loupe', c);
  };

  const showHover = (e: PointerEvent | null) => {
    const el = hoverRef.current;
    if (!el) return;
    if (!e) {
      el.style.display = 'none';
      return;
    }
    const v = viewRef.current!.getBoundingClientRect();
    const { tool: t, brush: b, sizeScale: k, painting: paint } = props.current;
    const unit = paint ? 0.06 * k : t === 'fill' || t === 'picker' || t === 'select' ? 0 : b.size * k;
    const d = Math.max(4, unit * (paper || 1) * view.current.s);
    if (!unit) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${e.clientX - v.left - d / 2}px, ${e.clientY - v.top - d / 2}px)`;
  };

  const showRope = (a: XY | null, b: XY | null) => {
    const el = ropeRef.current;
    if (!el) return;
    if (!a || !b) {
      el.style.display = 'none';
      return;
    }
    const sa = screenOf(a);
    const sb = screenOf(b);
    el.style.display = 'inline';
    el.setAttribute('x1', String(sa.x));
    el.setAttribute('y1', String(sa.y));
    el.setAttribute('x2', String(sb.x));
    el.setAttribute('y2', String(sb.y));
  };

  const clearTimers = () => {
    if (lpTimer.current) clearTimeout(lpTimer.current);
    if (qsTimer.current) clearTimeout(qsTimer.current);
    lpTimer.current = qsTimer.current = null;
  };

  /** Drop the stroke being drawn (a gesture began, a colour is being picked). */
  const cancelStroke = () => {
    clearTimers();
    if (drawing.current) {
      drawing.current = null;
      renderer.current?.endStroke(false);
      showRope(null, null);
    }
    if (maskDrawing.current) {
      maskDrawing.current = null;
      redrawMask();
    }
    if (lassoPts.current) {
      lassoPts.current = null;
      setLassoPath(null);
    }
    tapAt.current = null;
  };

  // ---- strokes on layers
  const beginStroke = (e: PointerEvent) => {
    const P = props.current;
    const st = doc.state;
    const layer = activeLayer(st);
    if (!layer) return;
    if (!layer.visible) return P.onNote(`“${layer.name}” is hidden. Show it to draw on it.`);
    const vector = layer.kind === 'vector';
    if (vector && P.tool === 'smudge') return P.onNote('Smudge works on paint layers. Ink layers stay as clean lines.');
    const toMask = P.maskEdit && layer.hasMask && !vector;
    let b: Brush = P.brush;
    if (P.tool === 'eraser') b = { ...b, mode: 'erase' };
    else if (P.tool === 'smudge') b = { ...b, mode: 'smudge' };
    else if (b.mode === 'smudge') b = { ...b, mode: 'paint' };
    if (vector && b.mode === 'paint') b = VECTOR_INK;
    const g = P.guides;
    const raw = pointOf(e);
    const mats = g.symmetry.kind !== 'off' ? symmetryMats(g.symmetry) : undefined;
    const op: StrokeOp = {
      kind: 'stroke',
      brush: b,
      color: toMask ? '#000000' : P.color,
      size: (vector && b.mode === 'paint' ? P.brush.size : b.size) * P.sizeScale,
      opacity: Math.min(1, b.opacity * P.opacityScale),
      seed: Math.floor(Math.random() * 2 ** 31),
      points: [],
      ...(mats && mats.length > 1 ? { mirrors: mats } : {}),
      ...(layer.alphaLock && !toMask && b.mode === 'paint' ? { lock: true } : {}),
    };
    const rope = g.rope > 0 ? g.rope * 0.06 : 0;
    const d: Drawing = {
      id: e.pointerId,
      op,
      layerId: layer.id,
      toMask,
      vector,
      walker: new DabWalker(b, op.size, op.seed),
      stab: new Stabilizer(rope, b.smoothing),
      persp: g.perspective.kind !== 'off' && g.perspective.snap ? new PerspectiveSnap(g.perspective, raw) : null,
      raw,
      startClient: { x: e.clientX, y: e.clientY },
      still: raw,
      snapped: null,
    };
    drawing.current = d;
    renderer.current?.beginStroke(layer.id, op, toMask, Boolean(op.lock));
    feed(d, [raw]);
    // Held still right where it started: pick the colour there instead.
    lpTimer.current = setTimeout(() => {
      const cur = drawing.current;
      if (!cur || cur.id !== e.pointerId || cur.snapped) return;
      if (strokeLength(cur.op.points) > 0.012) return;
      cancelStroke();
      picking.current = e.pointerId;
      const c = sample(cur.raw.x, cur.raw.y);
      showLoupe(cur.startClient.x, cur.startClient.y, c);
    }, EYEDROPPER_MS);
  };

  /** New pen samples into the stroke: the steadying string, the guides, then dabs. */
  const feed = (d: Drawing, raws: Pt[], predicted: Pt[] = []) => {
    const r = renderer.current;
    if (d.snapped) return;
    for (const raw of raws) {
      for (const p of d.stab.push(raw)) d.op.points.push(d.persp ? d.persp.apply(p) : p);
      d.raw = raw;
    }
    const dabs = d.walker.feed(d.op.points);
    r?.addDabs(mirrorDabs(dabs, d.op.mirrors));
    if (predicted.length && r && (!d.persp || d.persp.decided)) {
      const ahead = d.stab.peek(predicted).map((p) => (d.persp ? d.persp.apply(p) : p));
      if (ahead.length) r.setPredicted(mirrorDabs(d.walker.clone().feed([...d.op.points, ...ahead]), d.op.mirrors));
    } else r?.setPredicted([]);
    if (d.stab.rope > 0) showRope(d.stab.anchor, d.raw);
  };

  const trySnap = (d: Drawing) => {
    if (!props.current.guides.quickShape || d.op.brush.mode === 'smudge' || drawing.current !== d) return;
    const shape = recognize(d.op.points);
    if (!shape) return;
    const avgP = d.op.points.reduce((n, p) => n + p.p, 0) / Math.max(1, d.op.points.length);
    const anchor = shape.kind === 'line' ? shape.a : d.op.points[0];
    d.snapped = { shape, anchor, from: { x: d.raw.x, y: d.raw.y } };
    d.op.points = shapePoints(shape, Math.max(0.35, avgP));
    renderer.current?.replaceDabs(mirrorDabs(dabsFor(d.op.brush, d.op.size, d.op.seed, d.op.points), d.op.mirrors));
    showRope(null, null);
    props.current.onNote(`Snapped to ${SHAPE_NAMES[shape.kind]}. Keep holding and move to adjust it.`);
    props.current.onStroke('move');
  };

  const endStroke = (d: Drawing, cancelled: boolean) => {
    clearTimers();
    drawing.current = null;
    showRope(null, null);
    const r = renderer.current;
    if (cancelled || !d.op.points.length) {
      r?.endStroke(false);
      return;
    }
    if (!d.snapped) for (const p of d.stab.finish(d.raw)) d.op.points.push(d.persp ? d.persp.apply(p) : p);
    const st = doc.state;
    const layer = layerById(st, d.layerId);
    if (!layer) {
      r?.endStroke(false);
      return;
    }
    if (d.vector) {
      r?.endStroke(false);
      if (d.op.brush.mode === 'erase') {
        // The ink eraser takes away whole strokes it touches.
        const touched = new Set<number>();
        const mats = d.op.mirrors ?? [null];
        for (const m of mats)
          for (const p of d.op.points) {
            const q = m ? applyMat(m, p) : p;
            const hit = hitStroke(layer.vectors.filter((v) => !touched.has(v.id)), q, d.op.size / 2);
            if (hit) touched.add(hit.id);
          }
        if (touched.size) doc.commit(patchLayer(st, layer.id, { vectors: layer.vectors.filter((v) => !touched.has(v.id)) }));
      } else {
        const mats = d.op.mirrors ?? [null];
        const added = mats.map((m) => toVector(nextId(), m ? d.op.points.map((p) => ({ ...p, ...applyMat(m, p) })) : d.op.points, d.op.size, d.op.color));
        doc.commit(patchLayer(st, layer.id, { vectors: [...layer.vectors, ...added] }));
      }
    } else {
      // The whole stroke again, now its length is known (the end taper), then onto the layer.
      if (d.op.brush.mode !== 'smudge' && (d.op.brush.taper.end > 0 || d.snapped)) r?.replaceDabs(mirrorDabs(dabsFor(d.op.brush, d.op.size, d.op.seed, d.op.points), d.op.mirrors));
      r?.endStroke(true);
      doc.commit(addOp(st, layer.id, { ...d.op, points: d.op.points.slice() }, d.toMask));
    }
    r?.sync(doc.state);
    props.current.onChange();
    props.current.onStroke('end');
  };

  // ---- the Paint over mask (the old soft marker, for the machine)
  const beginMask = (e: PointerEvent) => {
    const { tool: t, sizeScale: k } = props.current;
    const raw = pointOf(e);
    const stroke: Stroke = { tool: t === 'eraser' ? 'eraser' : 'marker', color: '#ffffff', size: 0.06 * k, points: [raw] };
    maskDrawing.current = { id: e.pointerId, stroke, last: raw, raw };
    const c = maskRef.current;
    const g = c?.getContext('2d');
    if (g && c) drawStroke(g, stroke, c.width, 0, { color: MASK_TINT });
  };

  // ---- fill
  const fillAt = (x: number, y: number) => {
    const r = renderer.current;
    const st = doc.state;
    const layer = activeLayer(st);
    if (!r || !layer) return;
    if (layer.kind === 'vector') return props.current.onNote('Fill works on paint layers. Add a layer to fill on.');
    if (!layer.visible) return props.current.onNote(`“${layer.name}” is hidden. Show it to fill on it.`);
    const side = px.current;
    const own = r.layerCanvas(layer.id, side).getContext('2d')!.getImageData(0, 0, side, side).data;
    // Lines on any other visible layer hold the fill in.
    const lines = r.snapshot(side, (l) => l.id !== layer.id).getContext('2d')!.getImageData(0, 0, side, side).data;
    const region = growRegion(floodRegion(own, lines, side, side, x * side, y * side), side, side, 1);
    const out = document.createElement('canvas');
    out.width = out.height = side;
    const g = out.getContext('2d')!;
    const img = g.createImageData(side, side);
    paintRegion(img.data, region, hexRgb(props.current.color), Math.round(255 * Math.min(1, props.current.opacityScale)));
    g.putImageData(img, 0, 0);
    doc.commit(addOp(st, layer.id, { kind: 'image', image: out }, props.current.maskEdit && layer.hasMask));
    r.sync(doc.state);
    props.current.onChange();
    props.current.onStroke('end');
  };

  // ---- view (pan, pinch, turn)
  const startPinch = () => {
    const ids = [...touches.current.keys()];
    if (ids.length < 2) return void (pinch.current = null);
    const a = touches.current.get(ids[0])!;
    const b = touches.current.get(ids[1])!;
    const { bx, by } = paperBase();
    pinch.current = { v0: { ...view.current }, a0: { x: a.x - bx, y: a.y - by }, b0: { x: b.x - bx, y: b.y - by }, ids: [ids[0], ids[1]] };
  };
  const movePinch = () => {
    const p = pinch.current;
    if (!p) return;
    const a = touches.current.get(p.ids[0]);
    const b = touches.current.get(p.ids[1]);
    if (!a || !b) return;
    const { bx, by } = paperBase();
    view.current = pinchView(p.v0, p.a0, p.b0, { x: a.x - bx, y: a.y - by }, { x: b.x - bx, y: b.y - by });
    applyView();
  };
  const settle = () => {
    const box = viewRef.current;
    if (!box) return;
    const { bx, by } = paperBase();
    const r = box.getBoundingClientRect();
    const to = settleView(view.current, { x: r.left + r.width / 2 - bx, y: r.top + r.height / 2 - by });
    if (to !== view.current) animateTo(to);
  };

  const startHold = (x: number, y: number) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      const g = gesture.current;
      if (!g || g.moved) return;
      g.held = true;
      const pen = lastPen.current;
      // With a Pencil in use, the menu opens where its tip is (if it was just there).
      if (pen && penSeen.current && performance.now() - pen.t < 8000) props.current.onRadial(pen.x, pen.y);
      else props.current.onRadial(x, y);
    }, HOLD_MS);
  };

  // ---- pointers
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const ne = e.nativeEvent;
    if (e.pointerType === 'mouse' && e.button === 2) {
      e.preventDefault();
      return props.current.onRadial(e.clientX, e.clientY);
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    showHover(null);
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (!gesture.current) gesture.current = { at: Date.now(), most: 1, moved: false, held: false };
      gesture.current.most = Math.max(gesture.current.most, touches.current.size);
      cancelAnimationFrame(anim.current);
      if (touches.current.size >= 2) {
        // Two fingers: a gesture (a tap is Undo, three Redo, four hides the tools, a pinch zooms), never a line.
        cancelStroke();
        startPinch();
        const pts = [...touches.current.values()];
        startHold(pts.reduce((n, p) => n + p.x, 0) / pts.length, pts.reduce((n, p) => n + p.y, 0) / pts.length);
        return;
      }
      // A Pencil is in use: a resting palm or finger doesn't draw; one finger moves the canvas.
      if (penSeen.current) {
        startHold(e.clientX, e.clientY);
        return;
      }
    }
    if (e.pointerType === 'pen' && !penSeen.current) {
      penSeen.current = true;
      props.current.onPenOnly(true);
      cancelStroke();
    }
    if (e.pointerType === 'pen') lastPen.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
    const P = props.current;
    const u = unitOf(e.clientX, e.clientY);
    if (P.lasso) {
      lassoPts.current = [u];
      setLassoPath(lassoPts.current);
      return;
    }
    if (P.painting) return beginMask(ne);
    if (P.tool === 'picker' || e.altKey) {
      picking.current = e.pointerId;
      showLoupe(e.clientX, e.clientY, sample(u.x, u.y));
      return;
    }
    if (P.tool === 'fill') {
      tapAt.current = { id: e.pointerId, x: Math.min(1, Math.max(0, u.x)), y: Math.min(1, Math.max(0, u.y)) };
      return;
    }
    if (P.tool === 'select') {
      const layer = activeLayer(doc.state);
      if (!layer || layer.kind !== 'vector') return P.onNote('Edit ink works on ink layers: pick one in Layers, or add one.');
      const tol = 22 / Math.max(1, (paper || 1) * view.current.s);
      const sel = P.selected !== null ? layer.vectors.find((v) => v.id === P.selected) : undefined;
      const pointAt = sel ? hitPoint(sel, u, tol) : -1;
      const hit = pointAt >= 0 ? sel! : hitStroke(layer.vectors, u, tol);
      if (!hit) {
        P.onSelect(null);
        setVEdit(null);
        return;
      }
      if (hit.id !== P.selected) P.onSelect(hit.id);
      setVEdit(hit);
      vdrag.current = { pointer: e.pointerId, strokeId: hit.id, point: pointAt, from: u, orig: hit, layerId: layer.id, moved: false };
      return;
    }
    beginStroke(ne);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ne = e.nativeEvent;
    if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && !e.buttons && !drawing.current) {
      // Hovering: the brush's size where it would land.
      if (e.pointerType === 'pen') lastPen.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      showHover(ne);
      return;
    }
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      const t = touches.current.get(e.pointerId)!;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      if (gesture.current && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > 12) {
        gesture.current.moved = true;
        if (holdTimer.current) clearTimeout(holdTimer.current);
      }
      if (touches.current.size >= 2) return movePinch();
      if (penSeen.current) {
        view.current = { ...view.current, tx: view.current.tx + dx, ty: view.current.ty + dy };
        applyView();
        return;
      }
    }
    if (e.pointerType === 'pen') lastPen.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (picking.current === e.pointerId) {
      const u = unitOf(e.clientX, e.clientY);
      showLoupe(e.clientX, e.clientY, sample(u.x, u.y));
      return;
    }
    if (lassoPts.current && (e.buttons || e.pointerType !== 'mouse')) {
      lassoPts.current = [...lassoPts.current, unitOf(e.clientX, e.clientY)];
      setLassoPath(lassoPts.current);
      return;
    }
    const vd = vdrag.current;
    if (vd && vd.pointer === e.pointerId) {
      const u = unitOf(e.clientX, e.clientY);
      vd.moved = true;
      const next = vd.point >= 0 ? moveVPoint(vd.orig, vd.point, u) : moveStroke(vd.orig, u.x - vd.from.x, u.y - vd.from.y);
      setVEdit(next);
      return;
    }
    // Every sample since the last event (a Pencil sends them faster than the screen draws).
    let samples: PointerEvent[] = [];
    try {
      samples = ne.getCoalescedEvents?.() ?? [];
    } catch {
      samples = [];
    }
    if (!samples.length) samples = [ne];
    let predicted: PointerEvent[] = [];
    try {
      predicted = ne.getPredictedEvents?.() ?? [];
    } catch {
      predicted = [];
    }
    const md = maskDrawing.current;
    if (md && md.id === e.pointerId) {
      e.preventDefault();
      const from = md.stroke.points.length;
      for (const s of samples) {
        const raw = pointOf(s);
        const next = smoothPoint(md.last, raw);
        md.stroke.points.push(...fillGap(md.last, next), next);
        md.last = next;
        md.raw = raw;
      }
      const c = maskRef.current;
      const g = c?.getContext('2d');
      if (g && c) drawStroke(g, md.stroke, c.width, from, { color: MASK_TINT });
      props.current.onStroke('move');
      return;
    }
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const raws = samples.map(pointOf);
    const last = raws[raws.length - 1];
    if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) > 8 && lpTimer.current) {
      clearTimeout(lpTimer.current);
      lpTimer.current = null;
    }
    if (d.snapped) {
      d.raw = last;
      const shape = adjustShape(d.snapped.shape, d.snapped.anchor, d.snapped.from, last);
      d.op.points = shapePoints(shape, d.op.points[0]?.p ?? 0.5);
      renderer.current?.replaceDabs(mirrorDabs(dabsFor(d.op.brush, d.op.size, d.op.seed, d.op.points), d.op.mirrors));
      props.current.onStroke('move');
      return;
    }
    feed(d, raws, predicted.map(pointOf));
    // Held still near the end of a stroke: snap it to a clean shape.
    if (props.current.guides.quickShape && Math.hypot(last.x - d.still.x, last.y - d.still.y) > 0.006) {
      d.still = last;
      if (qsTimer.current) clearTimeout(qsTimer.current);
      qsTimer.current = setTimeout(() => {
        qsTimer.current = null;
        if (strokeLength(d.op.points) > 0.03) trySnap(d);
      }, HOLD_MS);
    }
    props.current.onStroke('move');
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
      if (touches.current.size >= 2) startPinch();
      const g = gesture.current;
      if (g && touches.current.size === 0) {
        gesture.current = null;
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = null;
        if (g.most >= 2 || penSeen.current) {
          if (!g.held && !g.moved && Date.now() - g.at < TAP_MS && !drawing.current) {
            const act = tapAction(g.most);
            if (act === 'undo') props.current.onUndo();
            else if (act === 'redo') props.current.onRedo();
            else if (act === 'ui') props.current.onToggleUi();
          }
          if (g.moved) settle();
          return;
        }
      }
      if (touches.current.size > 0 && penSeen.current) return;
    }
    if (picking.current === e.pointerId) {
      picking.current = null;
      const u = unitOf(e.clientX, e.clientY);
      showLoupe(0, 0, null);
      if (!cancelled) props.current.onPick(sample(u.x, u.y));
      return;
    }
    if (lassoPts.current) {
      const pts = thinPath(lassoPts.current);
      lassoPts.current = null;
      setLassoPath(null);
      if (!cancelled && lassoOk(pts)) props.current.onLasso(pts);
      return;
    }
    const tap = tapAt.current;
    if (tap && tap.id === e.pointerId) {
      tapAt.current = null;
      if (!cancelled) fillAt(tap.x, tap.y);
      return;
    }
    const vd = vdrag.current;
    if (vd && vd.pointer === e.pointerId) {
      vdrag.current = null;
      if (cancelled || !vd.moved) return;
      const st = doc.state;
      const layer = layerById(st, vd.layerId);
      const u = unitOf(e.clientX, e.clientY);
      const next = vd.point >= 0 ? moveVPoint(vd.orig, vd.point, u) : moveStroke(vd.orig, u.x - vd.from.x, u.y - vd.from.y);
      if (layer) {
        doc.commit(patchLayer(st, layer.id, { vectors: layer.vectors.map((v) => (v.id === next.id ? next : v)) }));
        renderer.current?.sync(doc.state);
        setVEdit(next);
        props.current.onChange();
        props.current.onStroke('end');
      }
      return;
    }
    const md = maskDrawing.current;
    if (md && md.id === e.pointerId) {
      maskDrawing.current = null;
      if (!cancelled) {
        if (md.raw !== md.last) md.stroke.points.push(md.raw);
        doc.commit({ ...doc.state, paintMask: [...doc.state.paintMask, { kind: 'stroke', stroke: md.stroke }] });
        props.current.onChange();
      }
      redrawMask();
      props.current.onStroke('end');
      return;
    }
    const d = drawing.current;
    if (d && d.id === e.pointerId) endStroke(d, cancelled);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const v = view.current;
    if (e.ctrlKey || e.metaKey) {
      const { bx, by } = paperBase();
      view.current = zoomAbout(v, { x: e.clientX - bx, y: e.clientY - by }, Math.exp(-e.deltaY / 300));
    } else view.current = { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY };
    applyView();
  };

  // ---- dragging handles on the overlay (pose joints, vanishing points, the symmetry centre, ink points)
  const [drag, setDrag] = useState<string | null>(null);
  const grab = paper ? 22 / paper : 0.03;
  const handle = (key: string, onMove: (p: XY) => void, onUp?: () => void) => ({
    onPointerDown: (e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      setDrag(key);
    },
    onPointerMove: (e: React.PointerEvent<SVGElement>) => {
      if (drag !== key) return;
      e.stopPropagation();
      onMove(unitOf(e.clientX, e.clientY));
    },
    onPointerUp: (e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      setDrag(null);
      onUp?.();
    },
  });

  const inkA = Math.min(100, Math.max(0, ink)) / 100;
  const showMask = painting || doc.state.paintMask.length > 0;
  const persp = guides.perspective;
  const sym = guides.symmetry;
  const lines = persp.kind !== 'off' ? gridLines(persp, 12) : [];
  const axes = symmetryAxes(sym);
  const vps = activeVps(persp);
  const overlay = regions.length > 0 || lassoPath || pose || lines.length || axes.length || vEdit;
  return (
    <div
      ref={viewRef}
      className="ldx-view"
      data-tool={lasso ? 'lasso' : tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
      onPointerLeave={() => showHover(null)}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={paperRef} className="ldx-paper" style={{ width: paper, height: paper }} role="img" aria-label="Your drawing" data-strokes={doc.state.layers.reduce((n, l) => n + l.ops.length + l.vectors.length, 0)}>
        {picture && visible.picture && (
          <img ref={pictureRef} className="ldx-layer ldx-picture" src={picture} alt={living ? 'Your drawing, brought to life' : 'The picture from your drawing machine'} draggable={false} data-living={living || undefined} />
        )}
        {reference && visible.reference && <img className="ldx-layer ldx-reference" src={reference} alt="" draggable={false} style={{ opacity: REFERENCE_ALPHA }} />}
        <canvas ref={artRef} className="ldx-layer" data-layer="art" style={{ opacity: inkA }} />
        <canvas ref={maskRef} className="ldx-layer ldx-mask" data-layer="mask" style={{ opacity: showMask ? (painting ? 0.5 : 0.22) : 0 }} />
        {overlay && (
          <svg className="ldx-layer ldx-over" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden={pose || guides.edit || vEdit ? undefined : true}>
            <clipPath id="ldx-paper-clip">
              <rect x={0} y={0} width={1} height={1} />
            </clipPath>
            <g clipPath="url(#ldx-paper-clip)">
              {lines.map((l, i) => (
                <line key={`p${i}`} className={l.horizon ? 'ldx-guide ldx-horizon' : 'ldx-guide'} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} vectorEffect="non-scaling-stroke" />
              ))}
              {axes.map((l, i) => (
                <line key={`s${i}`} className="ldx-guide ldx-axis" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            {vps.map((p, i) => (
              <g key={`vp${i}`} className="ldx-vp" data-edit={guides.edit || undefined}>
                <circle cx={p.x} cy={p.y} r={grab * 0.3} className="ldx-vp-dot" vectorEffect="non-scaling-stroke" />
                {guides.edit && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={grab}
                    className="ldx-joint"
                    role="slider"
                    aria-label={`Vanishing point ${i + 1}`}
                    aria-valuetext={`${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}
                    tabIndex={-1}
                    {...handle(`vp${i}`, (q) => onGuides({ perspective: { ...persp, vps: persp.vps.map((v, k) => (k === i ? q : v)) } }))}
                  />
                )}
              </g>
            ))}
            {sym.kind !== 'off' && (
              <g className="ldx-vp" data-edit={guides.edit || undefined}>
                <circle cx={sym.cx} cy={sym.cy} r={grab * 0.3} className="ldx-vp-dot ldx-sym-dot" vectorEffect="non-scaling-stroke" />
                {guides.edit && (
                  <circle cx={sym.cx} cy={sym.cy} r={grab} className="ldx-joint" role="slider" aria-label="Symmetry centre" aria-valuetext={`${Math.round(sym.cx * 100)}% across, ${Math.round(sym.cy * 100)}% down`} tabIndex={-1} {...handle('sym', (q) => onGuides({ symmetry: { ...sym, cx: q.x, cy: q.y } }))} />
                )}
              </g>
            )}
            {regions.map((r, i) => (
              <g key={r.id} className="ldx-region">
                <polygon points={r.points.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
                <text x={r.points[0].x} y={r.points[0].y} fontSize={0.035}>
                  {i + 1}
                </text>
              </g>
            ))}
            {lassoPath && <polyline className="ldx-lasso" points={lassoPath.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />}
            {vEdit && (
              <g className="ldx-vsel" role="group" aria-label="Selected ink stroke">
                <polyline points={vEdit.points.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
                {vEdit.points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={grab * 0.28} className="ldx-vsel-pt" vectorEffect="non-scaling-stroke" data-point={i} />
                ))}
              </g>
            )}
            {pose && (
              <g className="ldx-pose" role="group" aria-label="Pose figure">
                {POSE_LIMBS.map(([a, b], i) => (
                  <line key={i} x1={pose[a].x} y1={pose[a].y} x2={pose[b].x} y2={pose[b].y} stroke={`rgb(${POSE_COLORS[i].join(',')})`} vectorEffect="non-scaling-stroke" />
                ))}
                {pose.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r={grab * 0.32} fill={`rgb(${POSE_COLORS[i].join(',')})`} className="ldx-joint-dot" />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={grab}
                      className="ldx-joint"
                      data-joint={i}
                      role="slider"
                      aria-label={POSE_POINTS[i]}
                      aria-valuetext={`${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}
                      tabIndex={-1}
                      {...handle(`j${i}`, (q) => onPose(movePoint(pose, i, q)))}
                    />
                  </g>
                ))}
              </g>
            )}
          </svg>
        )}
      </div>
      <div ref={hoverRef} className="ldx-hover" aria-hidden />
      <div ref={loupeRef} className="ldx-loupe" aria-hidden />
      <svg className="ldx-rope" aria-hidden>
        <line ref={ropeRef} style={{ display: 'none' }} />
      </svg>
    </div>
  );
}
