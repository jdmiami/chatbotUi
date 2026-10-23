/**
 * Live Draw's strokes: made from Pointer Events (Apple Pencil, finger or mouse), kept as points in
 * 0..1 canvas units so a drawing doesn't care how big the canvas is on screen. Pressure sets the
 * width and darkness of a stroke; tilting the Pencil lays it flatter, so the stroke gets wider and
 * softer, like shading with a pencil's side. Strokes are drawn on transparent layers: the paper is
 * underneath, the eraser cuts through to it. `lines` draws them as plain black ink for the machine.
 */

export type Tool = 'pen' | 'pencil' | 'marker' | 'airbrush' | 'eraser';

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
  { value: '#6b6b73', label: 'Grey' },
  { value: '#ffffff', label: 'White' },
  { value: '#d6452b', label: 'Red' },
  { value: '#ef8a2e', label: 'Orange' },
  { value: '#e5c21c', label: 'Yellow' },
  { value: '#2e9b57', label: 'Green' },
  { value: '#2f6fdb', label: 'Blue' },
  { value: '#7a4fd6', label: 'Purple' },
  { value: '#8a5a3b', label: 'Brown' },
  { value: '#f2c9a5', label: 'Skin' },
  { value: '#7fc7e8', label: 'Sky' },
];

/** A stroke's base width (fraction of the canvas side) per tool; the Size slider scales it. */
export const TOOL_SIZE: Record<Tool, number> = { pen: 0.006, pencil: 0.004, marker: 0.03, airbrush: 0.07, eraser: 0.045 };

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
  const t = clamp01(tilt) ** 1.5;
  switch (tool) {
    case 'eraser':
      return size * (0.6 + 0.8 * p);
    case 'pen':
      return size * (0.35 + 1.3 * p) * (1 + 2 * t);
    case 'pencil':
      // Shading with the side of the lead: up to five times as wide.
      return size * (0.6 + 0.8 * p) * (1 + 4 * t);
    case 'marker':
      return size * (0.85 + 0.3 * p) * (1 + t);
    case 'airbrush':
      return size * (0.6 + 0.8 * p) * (1 + t);
  }
}

/** How strong the ink is at one point (0..1): harder is darker, flatter is softer. */
export function alphaAt(tool: Tool, p: number, tilt: number): number {
  const t = clamp01(tilt);
  switch (tool) {
    case 'eraser':
      return 1;
    case 'pen':
      return clamp01((0.55 + 0.45 * p) * (1 - 0.55 * t));
    case 'pencil':
      return clamp01((0.25 + 0.55 * p) * (1 - 0.5 * t));
    case 'marker':
      return 0.55;
    case 'airbrush':
      return clamp01(0.05 + 0.12 * p);
  }
}

/**
 * Light smoothing: each new point moves part of the way from the last one, so a shaky hand or a
 * Pencil whose events arrive unevenly still draws a clean line. Pressure and tilt are smoothed too.
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

/** "#rrggbb" (or "#rgb") as [r, g, b]. */
export function hexRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface DrawOpts {
  /** Plain black ink (what the machine reads as lines). */
  lines?: boolean;
  /** Every stroke in this colour (the paint-over mask: white). */
  color?: string;
}

/** Draw part of a stroke (points from `from` on) onto a transparent canvas of `side` pixels. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, side: number, from = 0, opts: DrawOpts = {}) {
  const color = opts.color ?? (opts.lines ? '#000000' : s.color);
  const eraser = s.tool === 'eraser';
  // The lines for the machine are solid: soft shading would read as no line at all.
  const alpha = (p: number, tilt: number) => (eraser ? 1 : opts.lines || opts.color ? (s.tool === 'airbrush' ? 0.5 : s.tool === 'marker' ? 0.85 : 1) : alphaAt(s.tool, p, tilt));
  ctx.save();
  ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  const pts = s.points;
  if (s.tool === 'airbrush' && !eraser) {
    // Soft round dabs, a little apart, so the spray builds up where you linger.
    const [r, g, b] = hexRgb(color);
    for (let i = Math.max(0, from); i < pts.length; i++) {
      const q = pts[i];
      const rad = Math.max(1, (widthAt(s.tool, s.size, q.p, q.tilt) * side) / 2);
      const grad = ctx.createRadialGradient(q.x * side, q.y * side, 0, q.x * side, q.y * side, rad);
      const a = alpha(q.p, q.tilt);
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(q.x * side, q.y * side, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (pts.length === 1 && from === 0) {
    const q = pts[0];
    ctx.globalAlpha = alpha(q.p, q.tilt);
    ctx.beginPath();
    ctx.arc(q.x * side, q.y * side, (widthAt(s.tool, s.size, q.p, q.tilt) * side) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const p = (a.p + b.p) / 2;
    const tilt = (a.tilt + b.tilt) / 2;
    ctx.globalAlpha = alpha(p, tilt);
    ctx.lineWidth = Math.max(1, widthAt(s.tool, s.size, p, tilt) * side);
    ctx.beginPath();
    ctx.moveTo(a.x * side, a.y * side);
    ctx.lineTo(b.x * side, b.y * side);
    ctx.stroke();
  }
  ctx.restore();
}

export function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
