import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { CanvasDoc, DrawLayer, Op, Target } from './doc';
import { REFERENCE_ALPHA, lassoOk, thinPath, type LayerId, type XY } from './raster';
import { renderOps } from './render';
import { POSE_LIMBS, POSE_POINTS, POSE_COLORS, movePoint } from './pose';
import { TOOL_SIZE, drawStroke, fillGap, pressureOf, smoothPoint, tiltOf, type Pt, type Stroke, type Tool } from './sketch';

export type StageTool = Tool | 'fill' | 'picker';

export interface Region {
  id: number;
  points: XY[];
  prompt: string;
}

export interface StageHandle {
  /** Draw a layer again from the document (after undo, redo, clear). No target: all of them. */
  redraw(target?: Target): void;
  /** What a layer holds right now, the stroke still being drawn included. */
  live(target: Target): Op[];
  /** The on-screen canvas of a layer (the fill tool's lines, the PSD's pixels). */
  canvas(id: DrawLayer): HTMLCanvasElement | null;
  /** Back to the whole canvas, unzoomed. */
  fit(): void;
}

/** A two- or three-finger tap shorter than this, that barely moves, is Undo or Redo. */
const TAP_MS = 350;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 6;
const MASK_TINT = '#ff3d8b';

interface Drawing {
  target: Target;
  stroke: Stroke;
  last: Pt;
  raw: Pt;
}

/**
 * The one canvas: the AI picture underneath, the reference picture to trace, then the Colour and
 * Sketch layers (faded together by Ink), and on top what you are steering with (the Paint over mask,
 * regions, the pose figure). A Pencil draws and a resting hand doesn't; once a Pencil has been seen,
 * fingers move and pinch the canvas. Two fingers tap to undo, three to redo.
 */
export function Stage({
  ref,
  doc,
  tool,
  color,
  sizeScale,
  layer,
  painting,
  lasso,
  visible,
  ink,
  picture,
  living,
  reference,
  regions,
  pose,
  penOnly,
  onPenOnly,
  onStroke,
  onPick,
  onLasso,
  onPose,
  onUndo,
  onRedo,
}: {
  ref?: Ref<StageHandle>;
  doc: CanvasDoc;
  tool: StageTool;
  color: string;
  sizeScale: number;
  layer: DrawLayer;
  /** Paint over: strokes paint the mask (white = may change). */
  painting: boolean;
  /** Drawing a region with the lasso. */
  lasso: boolean;
  visible: Record<LayerId, boolean>;
  ink: number;
  picture: string | null;
  /** The picture is the live video stream (Bring to life). */
  living: boolean;
  reference: string | null;
  regions: Region[];
  pose: XY[] | null;
  penOnly: boolean;
  onPenOnly(on: boolean): void;
  /** A stroke moved (send at most every so often) or ended (send now). */
  onStroke(phase: 'move' | 'end'): void;
  onPick(color: string): void;
  onLasso(points: XY[]): void;
  onPose(points: XY[]): void;
  onUndo(): void;
  onRedo(): void;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const canvases = useRef<Record<Target, HTMLCanvasElement | null>>({ sketch: null, colour: null, mask: null });
  const pictureRef = useRef<HTMLImageElement>(null);
  const [paper, setPaper] = useState(0); // css px
  const px = useRef(0); // canvas px
  const view = useRef({ s: 1, tx: 0, ty: 0 });
  const drawing = useRef(new Map<number, Drawing>());
  const touches = useRef(new Map<number, { x: number; y: number; sx: number; sy: number }>());
  const gesture = useRef<{ at: number; most: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; mx: number; my: number; s: number; tx: number; ty: number } | null>(null);
  const lassoPts = useRef<XY[] | null>(null);
  const [lassoPath, setLassoPath] = useState<XY[] | null>(null);
  const tapAt = useRef<{ id: number; x: number; y: number } | null>(null);
  const penSeen = useRef(penOnly);
  penSeen.current = penOnly;
  // Read by the pointer handlers without re-binding them.
  const props = useRef({ tool, color, sizeScale, layer, painting, lasso });
  props.current = { tool, color, sizeScale, layer, painting, lasso };

  const applyView = () => {
    const el = paperRef.current;
    if (!el) return;
    const { s, tx, ty } = view.current;
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };

  const opsFor = useCallback((t: Target): Op[] => {
    const now = [...drawing.current.values()].filter((d) => d.target === t).map((d) => ({ kind: 'stroke' as const, stroke: d.stroke }));
    return now.length ? [...doc.get(t), ...now] : doc.get(t);
  }, [doc]);

  const redraw = useCallback(
    (t?: Target) => {
      const order: Target[] = t ? (t === 'sketch' ? ['sketch', 'colour'] : [t]) : ['sketch', 'colour', 'mask'];
      for (const k of order) {
        const c = canvases.current[k];
        if (!c || !c.width) continue;
        renderOps(c, opsFor(k), k === 'mask' ? { color: MASK_TINT, skipFills: true } : { boundary: k === 'colour' ? canvases.current.sketch : null });
      }
    },
    [opsFor],
  );

  useImperativeHandle(
    ref,
    () => ({
      redraw,
      live: opsFor,
      canvas: (id) => canvases.current[id],
      fit: () => {
        view.current = { s: 1, tx: 0, ty: 0 };
        applyView();
      },
    }),
    [redraw, opsFor],
  );

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
        for (const c of Object.values(canvases.current)) {
          if (!c) continue;
          c.width = want;
          c.height = want;
        }
        redraw();
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
  }, [redraw]);

  // ---- points
  const pointOf = (e: { clientX: number; clientY: number; pressure?: number; pointerType?: string; tiltX?: number; tiltY?: number; altitudeAngle?: number }): Pt => {
    const r = paperRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
      p: pressureOf(e),
      tilt: tiltOf(e),
    };
  };

  const cancelFingerStrokes = () => {
    let any = false;
    for (const [id, d] of drawing.current) {
      if (touches.current.has(id)) {
        drawing.current.delete(id);
        redraw(d.target);
        any = true;
      }
    }
    if (lassoPts.current && touches.current.size) {
      lassoPts.current = null;
      setLassoPath(null);
    }
    tapAt.current = null;
    return any;
  };

  /** The colour under a point: your ink first, then the picture, then the paper. */
  const sample = (x: number, y: number): string => {
    const hex = (d: ArrayLike<number>) => `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    for (const k of ['sketch', 'colour'] as const) {
      const c = canvases.current[k];
      const d = c?.getContext('2d')?.getImageData(Math.min(c.width - 1, Math.floor(x * c.width)), Math.min(c.height - 1, Math.floor(y * c.height)), 1, 1).data;
      if (d && d[3] > 40) return hex(d);
    }
    const img = pictureRef.current;
    if (img?.naturalWidth) {
      try {
        const one = document.createElement('canvas');
        one.width = one.height = 1;
        const g = one.getContext('2d')!;
        g.drawImage(img, Math.floor(x * img.naturalWidth), Math.floor(y * img.naturalHeight), 1, 1, 0, 0, 1, 1);
        return hex(g.getImageData(0, 0, 1, 1).data);
      } catch {
        /* a picture from elsewhere can't be read */
      }
    }
    return '#ffffff';
  };

  // ---- view (pan and pinch)
  const paperBase = () => {
    const v = viewRef.current!.getBoundingClientRect();
    const p = paperRef.current!;
    return { bx: v.left + p.offsetLeft, by: v.top + p.offsetTop };
  };
  const startPinch = () => {
    const pts = [...touches.current.values()];
    if (pts.length < 2) return void (pinch.current = null);
    const [a, b] = pts;
    pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ...view.current };
  };
  const movePinch = () => {
    const p = pinch.current;
    const pts = [...touches.current.values()];
    if (!p || pts.length < 2) return;
    const [a, b] = pts;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (p.s * d) / p.d));
    const { bx, by } = paperBase();
    // The point that was under the fingers stays under them.
    const cx = (p.mx - bx - p.tx) / p.s;
    const cy = (p.my - by - p.ty) / p.s;
    view.current = { s, tx: mx - bx - s * cx, ty: my - by - s * cy };
    applyView();
  };

  // ---- pointers
  const beginStroke = (e: React.PointerEvent<HTMLDivElement>) => {
    const { tool: t, color: c, sizeScale: k, layer: l, painting: paint, lasso: las } = props.current;
    const raw = pointOf(e.nativeEvent);
    if (las) {
      lassoPts.current = [{ x: raw.x, y: raw.y }];
      setLassoPath(lassoPts.current);
      return;
    }
    if (!paint && (t === 'fill' || t === 'picker')) {
      tapAt.current = { id: e.pointerId, x: raw.x, y: raw.y };
      return;
    }
    const target: Target = paint ? 'mask' : l;
    const kind: Tool = paint ? (t === 'eraser' ? 'eraser' : 'marker') : (t as Tool);
    const size = paint ? 0.06 * k : TOOL_SIZE[kind] * k;
    const stroke: Stroke = { tool: kind, color: paint ? '#ffffff' : c, size, points: [raw] };
    drawing.current.set(e.pointerId, { target, stroke, last: raw, raw });
    const cv = canvases.current[target];
    const g = cv?.getContext('2d');
    if (g && cv) drawStroke(g, stroke, cv.width, 0, target === 'mask' ? { color: MASK_TINT } : {});
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (!gesture.current) gesture.current = { at: Date.now(), most: 1, moved: false };
      gesture.current.most = Math.max(gesture.current.most, touches.current.size);
      if (touches.current.size >= 2) {
        // Two fingers: a gesture (a quick tap is Undo, three is Redo, a pinch zooms), never a line.
        cancelFingerStrokes();
        startPinch();
        return;
      }
      // A Pencil is in use: a resting palm or finger doesn't draw; one finger moves the canvas.
      if (penSeen.current) return;
    }
    if (e.pointerType === 'pen' && !penSeen.current) {
      penSeen.current = true;
      onPenOnly(true);
      cancelFingerStrokes();
    }
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
    beginStroke(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      const t = touches.current.get(e.pointerId)!;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      if (gesture.current && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > 12) gesture.current.moved = true;
      if (touches.current.size >= 2) return movePinch();
      if (penSeen.current) {
        view.current = { ...view.current, tx: view.current.tx + dx, ty: view.current.ty + dy };
        applyView();
        return;
      }
    }
    if (lassoPts.current && (e.buttons || e.pointerType !== 'mouse')) {
      const p = pointOf(e.nativeEvent);
      lassoPts.current = [...lassoPts.current, { x: p.x, y: p.y }];
      setLassoPath(lassoPts.current);
      return;
    }
    const d = drawing.current.get(e.pointerId);
    if (!d) return;
    e.preventDefault();
    // Every sample since the last event (Pencil events come faster than the screen draws).
    const native = e.nativeEvent as PointerEvent;
    let samples: PointerEvent[] = [];
    try {
      samples = native.getCoalescedEvents?.() ?? [];
    } catch {
      samples = [];
    }
    if (!samples.length) samples = [native];
    const from = d.stroke.points.length;
    for (const s of samples) {
      const raw = pointOf(s);
      const next = smoothPoint(d.last, raw);
      // Sparse events: fill the gap so a fast line has no corners.
      d.stroke.points.push(...fillGap(d.last, next), next);
      d.last = next;
      d.raw = raw;
    }
    const cv = canvases.current[d.target];
    const g = cv?.getContext('2d');
    if (g && cv) drawStroke(g, d.stroke, cv.width, from, d.target === 'mask' ? { color: MASK_TINT } : {});
    onStroke('move');
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
      if (touches.current.size === 1) startPinch();
      const g = gesture.current;
      if (g && touches.current.size === 0) {
        gesture.current = null;
        if (g.most >= 2) {
          if (!g.moved && Date.now() - g.at < TAP_MS && !drawing.current.size) (g.most >= 3 ? onRedo : onUndo)();
          return;
        }
      }
    }
    if (lassoPts.current) {
      const pts = thinPath(lassoPts.current);
      lassoPts.current = null;
      setLassoPath(null);
      if (!cancelled && lassoOk(pts)) onLasso(pts);
      return;
    }
    const tap = tapAt.current;
    if (tap && tap.id === e.pointerId) {
      tapAt.current = null;
      if (cancelled) return;
      if (props.current.tool === 'picker') onPick(sample(tap.x, tap.y));
      else {
        const target: Target = props.current.layer;
        doc.add(target, { kind: 'fill', x: tap.x, y: tap.y, color: props.current.color });
        redraw(target);
        onStroke('end');
      }
      return;
    }
    const d = drawing.current.get(e.pointerId);
    if (!d) return;
    drawing.current.delete(e.pointerId);
    if (cancelled) {
      redraw(d.target);
      return;
    }
    // The pen lifts where it really is (the smoothing lags a little behind).
    if (d.raw !== d.last) d.stroke.points.push(d.raw);
    doc.add(d.target, { kind: 'stroke', stroke: d.stroke });
    redraw(d.target);
    onStroke('end');
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const v = view.current;
    if (e.ctrlKey || e.metaKey) {
      const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.s * Math.exp(-e.deltaY / 300)));
      const { bx, by } = paperBase();
      const cx = (e.clientX - bx - v.tx) / v.s;
      const cy = (e.clientY - by - v.ty) / v.s;
      view.current = { s, tx: e.clientX - bx - s * cx, ty: e.clientY - by - s * cy };
    } else view.current = { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY };
    applyView();
  };

  // Pose: drag a joint (44 px to grab, wherever the canvas is zoomed).
  const [dragJoint, setDragJoint] = useState<number | null>(null);
  const grab = paper ? 22 / paper : 0.03;
  const jointMove = (e: React.PointerEvent<SVGCircleElement>, i: number) => {
    if (dragJoint !== i || !pose) return;
    e.stopPropagation();
    const r = paperRef.current!.getBoundingClientRect();
    onPose(movePoint(pose, i, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
  };

  useEffect(() => applyView(), [paper]);

  const inkA = Math.min(100, Math.max(0, ink)) / 100;
  const showMask = painting || doc.has('mask');
  return (
    <div
      ref={viewRef}
      className="ldx-view"
      data-tool={lasso ? 'lasso' : tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={paperRef} className="ldx-paper" style={{ width: paper, height: paper }} role="img" aria-label="Your drawing" data-strokes={doc.count('sketch') + doc.count('colour')}>
        {picture && visible.picture && (
          <img ref={pictureRef} className="ldx-layer ldx-picture" src={picture} alt={living ? 'Your drawing, brought to life' : 'The picture from your drawing machine'} draggable={false} data-living={living || undefined} />
        )}
        {reference && visible.reference && <img className="ldx-layer ldx-reference" src={reference} alt="" draggable={false} style={{ opacity: REFERENCE_ALPHA }} />}
        <canvas ref={(c) => void (canvases.current.colour = c)} className="ldx-layer" data-layer="colour" style={{ opacity: visible.colour ? inkA : 0 }} />
        <canvas ref={(c) => void (canvases.current.sketch = c)} className="ldx-layer" data-layer="sketch" style={{ opacity: visible.sketch ? inkA : 0 }} />
        <canvas ref={(c) => void (canvases.current.mask = c)} className="ldx-layer ldx-mask" data-layer="mask" style={{ opacity: showMask ? (painting ? 0.5 : 0.22) : 0 }} />
        {(regions.length > 0 || lassoPath || pose) && (
          <svg className="ldx-layer ldx-over" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden={pose ? undefined : true}>
            {regions.map((r, i) => (
              <g key={r.id} className="ldx-region">
                <polygon points={r.points.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
                <text x={r.points[0].x} y={r.points[0].y} fontSize={0.035}>
                  {i + 1}
                </text>
              </g>
            ))}
            {lassoPath && <polyline className="ldx-lasso" points={lassoPath.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />}
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
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        try {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        } catch {
                          /* synthetic events */
                        }
                        setDragJoint(i);
                      }}
                      onPointerMove={(e) => jointMove(e, i)}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        setDragJoint(null);
                      }}
                    />
                  </g>
                ))}
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
