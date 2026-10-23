/**
 * What the drawing machine is sent, from the layers (the contract in docs/livedraw/DESIGN.md §5.1 is
 * unchanged): `sketch` is every visible layer marked "lines" drawn as plain black lines (each stroke's
 * centre line, whatever the brush: textured shading would read as no line at all); `color` is every
 * visible layer marked "colour" as it looks. Fills, merged pictures and smudges are not lines.
 */
import type { Op } from '../canvas/doc';
import type { Stroke, Tool } from '../canvas/sketch';
import { applyMat } from '../guides/symmetry';
import { sampleCurve, vWidth } from '../ink/vector';
import type { Brush } from '../brushes/types';
import type { DocState, Layer, Role, StrokeOp } from './model';

/** The old line tool that draws a brush closest to how it looks (for the machine's lines). */
export function lineTool(b: Brush): Tool {
  if (b.mode === 'erase') return 'eraser';
  if (b.shape === 'round' && b.hardness < 0.35) return 'airbrush';
  if (b.shape === 'chisel') return 'marker';
  if (b.shape === 'pencil' || b.shape === 'charcoal') return 'pencil';
  return 'pen';
}

function strokeLines(op: StrokeOp): Op[] {
  if (op.brush.mode === 'smudge') return [];
  const tool = lineTool(op.brush);
  const mats = op.mirrors?.length ? op.mirrors : null;
  const one = (points: StrokeOp['points']): Op => ({ kind: 'stroke', stroke: { tool, color: op.color, size: op.size, points } as Stroke });
  if (!mats) return [one(op.points)];
  return mats.map((m) => one(op.points.map((p) => ({ ...p, ...applyMat(m, p) }))));
}

/** A layer's strokes as lines (vector ink too, as its curve at its width). */
export function layerLines(l: Layer): Op[] {
  if (l.kind === 'vector')
    return l.vectors.map((v) => ({ kind: 'stroke', stroke: { tool: 'pen', color: v.color, size: v.width * 0.75, points: sampleCurve(v.points, 4).map((p) => ({ ...p, p: Math.min(1, vWidth(v, p.p) / v.width) })) } }));
  return l.ops.flatMap((o) => (o.kind === 'stroke' ? strokeLines(o) : []));
}

/** Every visible layer with a role, its lines, bottom first (and the stroke being drawn, if on one). */
export function machineLines(s: DocState, role: Role, live?: { layerId: number; op: StrokeOp } | null): Op[] {
  const out: Op[] = [];
  for (const l of s.layers) {
    if (!l.visible || l.role !== role) continue;
    out.push(...layerLines(l));
    if (live && live.layerId === l.id) out.push(...strokeLines(live.op));
  }
  return out;
}

/** Is there anything for the machine on layers with this role (erasing alone is nothing)? */
export function hasRoleInk(s: DocState, role: Role, live?: { layerId: number; op: StrokeOp } | null): boolean {
  return s.layers.some(
    (l) =>
      l.visible &&
      l.role === role &&
      (l.vectors.length > 0 || l.ops.some((o) => o.kind === 'image' || o.brush.mode === 'paint') || (live?.layerId === l.id && live.op.brush.mode === 'paint')),
  );
}

/** How many strokes there are on the layers the machine reads (the sketch reader waits for a new one). */
export function strokeCount(s: DocState): number {
  return s.layers.reduce((n, l) => n + (l.role === 'none' ? 0 : l.ops.length + l.vectors.length), 0);
}
