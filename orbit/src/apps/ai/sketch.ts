/**
 * Live draw's drawing: strokes made from Pointer Events (Apple Pencil, finger or mouse), kept as
 * points in 0..1 canvas units so the picture doesn't care how big the canvas is on screen. Pressure
 * sets the width and darkness of a stroke; tilting the Pencil lays it flatter, so the stroke gets
 * wider and softer, like shading with a pencil's side. The same strokes are drawn twice: in colour
 * for you, and as plain dark lines on white for the AI machine (sketchLines).
 */

export type Tool = 'pen' | 'brush' | 'eraser';

export interface Pt {
  x: number;
  y: number;
  /** 0..1 */
  p: number;
  /** 0 (upright) .. 1 (lying flat) */
  tilt: number;
}

export interface Stroke {
  tool: Tool;
  color: string;
  /** Base width as a fraction of the canvas side. */
  size: number;
  points: Pt[];
}

export const COLORS = [
  { value: '#1b1b1f', label: 'Black' },
  { value: '#d6452b', label: 'Red' },
  { value: '#2f6fdb', label: 'Blue' },
  { value: '#2e9b57', label: 'Green' },
  { value: '#e5a91c', label: 'Yellow' },
];

/** A stroke's base width (fraction of the canvas side) per tool. */
export const TOOL_SIZE: Record<Tool, number> = { pen: 0.006, brush: 0.022, eraser: 0.045 };

/**
 * How far the pen is tilted, 0 (upright) .. 1 (flat). Safari gives altitudeAngle (radians, π/2 is
 * upright); others give tiltX / tiltY in degrees (0 is upright).
 */
export function tiltOf(e: { altitudeAngle?: number; tiltX?: number; tiltY?: number; pointerType?: string }): number {
  if (e.pointerType && e.pointerType !== 'pen') return 0;
  if (typeof e.altitudeAngle === 'number' && Number.isFinite(e.altitudeAngle) && e.altitudeAngle > 0) {
    return clamp01(1 - e.altitudeAngle / (Math.PI / 2));
  }
  const tx = Number(e.tiltX) || 0;
  const ty = Number(e.tiltY) || 0;
  if (!tx && !ty) return 0;
  // The angle from upright, from the two tilt angles.
  const a = Math.atan(Math.sqrt(Math.tan((tx * Math.PI) / 180) ** 2 + Math.tan((ty * Math.PI) / 180) ** 2));
  return clamp01(a / (Math.PI / 2));
}

/**
 * Pressure 0..1. A finger or mouse reports nothing useful (0, 0.5 or 1): treated as a medium press.
 * A Pencil's first contact can report 0: kept just above, so the stroke still shows.
 */
export function pressureOf(e: { pressure?: number; pointerType?: string }): number {
  if (e.pointerType !== 'pen') return 0.5;
  const p = Number(e.pressure);
  return Number.isFinite(p) && p > 0 ? clamp01(p) : 0.08;
}

/** Width of a stroke at one point, in canvas units (fraction of the side). */
export function widthAt(tool: Tool, size: number, p: number, tilt: number): number {
  if (tool === 'eraser') return size * (0.6 + 0.8 * p);
  const base = tool === 'pen' ? size * (0.35 + 1.3 * p) : size * (0.5 + p);
  // Lying the Pencil down: up to three times as wide.
  return base * (1 + 2 * clamp01(tilt) ** 1.5);
}

/** How strong the ink is at one point (0..1): harder is darker, flatter is softer. */
export function alphaAt(tool: Tool, p: number, tilt: number): number {
  if (tool === 'eraser') return 1;
  const a = tool === 'pen' ? 0.55 + 0.45 * p : 0.22 + 0.45 * p;
  return clamp01(a * (1 - 0.55 * clamp01(tilt)));
}

/**
 * Light smoothing: each new point moves part of the way from the last one, so a shaky hand or a
 * Pencil whose events arrive unevenly (Safari has been reported to send sparse pointermove events
 * for the Pencil Pro) still draws a clean line. Pressure and tilt are smoothed the same way.
 */
export function smoothPoint(prev: Pt | undefined, raw: Pt, k = 0.55): Pt {
  if (!prev) return raw;
  return { x: prev.x + (raw.x - prev.x) * k, y: prev.y + (raw.y - prev.y) * k, p: prev.p + (raw.p - prev.p) * k, tilt: prev.tilt + (raw.tilt - prev.tilt) * k };
}

/**
 * Points to add between two far-apart samples (sparse events), so the line has no gaps or corners:
 * a straight run at roughly `step` spacing (canvas units).
 */
export function fillGap(a: Pt, b: Pt, step = 0.004): Pt[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.min(64, Math.floor(d / step));
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t, tilt: a.tilt + (b.tilt - a.tilt) * t });
  }
  return out;
}

/** The drawing with undo and redo; Clear can be undone too. */
export class Sketch {
  strokes: Stroke[] = [];
  private undone: Stroke[][] = [];
  private history: Stroke[][] = [];

  get canUndo() {
    return this.history.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }
  get empty() {
    return !this.strokes.some((s) => s.tool !== 'eraser');
  }

  /** A finished stroke. */
  add(stroke: Stroke) {
    if (!stroke.points.length) return;
    this.history.push(this.strokes);
    this.strokes = [...this.strokes, stroke];
    this.undone = [];
  }
  clear() {
    if (!this.strokes.length) return;
    this.history.push(this.strokes);
    this.strokes = [];
    this.undone = [];
  }
  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.undone.push(this.strokes);
    this.strokes = prev;
    return true;
  }
  redo() {
    const next = this.undone.pop();
    if (!next) return false;
    this.history.push(this.strokes);
    this.strokes = next;
    return true;
  }
}

type Ctx = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'arc' | 'fill' | 'fillRect' | 'save' | 'restore'> & {
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
};

export const PAPER = '#ffffff';

/**
 * Draw part of a stroke (points from `from` on) onto a canvas of `side` pixels. `lines`: plain dark
 * ink on white, what the AI machine reads (every colour the same black, the eraser white).
 */
export function drawStroke(ctx: Ctx, s: Stroke, side: number, from = 0, lines = false) {
  const color = s.tool === 'eraser' ? PAPER : lines ? '#000000' : s.color;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const pts = s.points;
  if (pts.length === 1 && from === 0) {
    const q = pts[0];
    ctx.globalAlpha = lines && s.tool !== 'eraser' ? 1 : alphaAt(s.tool, q.p, q.tilt);
    ctx.beginPath();
    ctx.arc(q.x * side, q.y * side, (widthAt(s.tool, s.size, q.p, q.tilt) * side) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const p = (a.p + b.p) / 2;
    const tilt = (a.tilt + b.tilt) / 2;
    // The lines for the machine are solid: soft shading would read as no line at all.
    ctx.globalAlpha = lines && s.tool !== 'eraser' ? (s.tool === 'brush' ? 0.85 : 1) : alphaAt(s.tool, p, tilt);
    ctx.lineWidth = Math.max(1, widthAt(s.tool, s.size, p, tilt) * side);
    ctx.beginPath();
    ctx.moveTo(a.x * side, a.y * side);
    ctx.lineTo(b.x * side, b.y * side);
    ctx.stroke();
  }
  ctx.restore();
}

/** The whole drawing on a canvas `side` pixels square (white paper first). */
export function drawAll(ctx: Ctx, strokes: Stroke[], side: number, lines = false) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, side, side);
  ctx.restore();
  for (const s of strokes) drawStroke(ctx, s, side, 0, lines);
}

/** The drawing as a PNG data URL: dark lines on white, `side` pixels square (512 for the live preview). */
export function sketchLines(strokes: Stroke[], side = 512, doc: Document = document): string {
  const c = doc.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  drawAll(ctx, strokes, side, true);
  return c.toDataURL('image/png');
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
