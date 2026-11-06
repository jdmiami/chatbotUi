/**
 * Painting a note: the paper, the ghosts of the notes around it (onion view) and its ink.
 */
import { drawVectors, type VStroke } from '../livedraw/ink/vector';
import type { PaperKind } from './paperGL';

/** The square sticky note, and its gummed strip along the top. */
export const PAPER = '#f6edc4';
export const PAPER_GUM = '#eee1a6';

/** Onion ghosts: notes before in warm red, notes after in blue-green (the usual animator's colours). */
export const GHOST_BEFORE = '#d2453c';
export const GHOST_AFTER = '#1f8d9a';

export interface Ghost {
  strokes: readonly VStroke[];
  color: string;
  alpha: number;
}

export interface View {
  /** Zoom (1 = the whole note) and where the note's corner sits, in note widths (0 or less). */
  z: number;
  ox: number;
  oy: number;
}

export const FIT: View = { z: 1, ox: 0, oy: 0 };

/** Ghost strength for the note `n` away (1 = the nearest). */
export const ghostAlpha = (n: number) => Math.max(0.12, 0.42 - (n - 1) * 0.13);

/**
 * Paint one note onto a canvas whose drawing buffer is `px` square.
 * `skip` leaves out strokes (the eraser's preview).
 */
export function paintNote(
  ctx: CanvasRenderingContext2D,
  strokes: readonly VStroke[],
  px: number,
  opts: { paper?: boolean | PaperKind; ghosts?: readonly Ghost[]; view?: View; skip?: ReadonlySet<number>; figures?: readonly VStroke[]; after?: (ctx: CanvasRenderingContext2D) => void } = {},
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  const v = opts.view ?? FIT;
  ctx.translate(v.ox * px, v.oy * px);
  ctx.scale(v.z, v.z);
  if (opts.paper) drawPaper(ctx, px, opts.paper === true ? 'sticky' : opts.paper);
  for (const g of opts.ghosts ?? []) {
    ctx.globalAlpha = g.alpha;
    drawVectors(ctx, g.strokes, px, px, { color: g.color });
  }
  ctx.globalAlpha = 1;
  // The characters first, then the ink drawn on this note over them.
  if (opts.figures?.length) drawVectors(ctx, opts.figures, px, px);
  drawVectors(ctx, opts.skip?.size ? strokes.filter((s) => !opts.skip!.has(s.id)) : strokes, px, px);
  opts.after?.(ctx);
  ctx.restore();
}

/** The paper itself, flat (the 2D desk, the walkthrough and the iPhone viewer). */
export function drawPaper(ctx: CanvasRenderingContext2D, px: number, kind: PaperKind) {
  const base = { sticky: PAPER, sketch: '#f4f1ea', lined: '#f7f5ee', grid: '#f5f5f2', kraft: '#d8c3a0' }[kind];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, px, px);
  if (kind === 'sticky') {
    ctx.fillStyle = PAPER_GUM;
    ctx.fillRect(0, 0, px, px * 0.075);
  } else if (kind === 'lined') {
    ctx.fillStyle = 'rgba(140, 173, 219, 0.55)';
    for (let k = 3; k < 22; k++) ctx.fillRect(0, (k / 22) * px, px, Math.max(1, px * 0.0018));
    ctx.fillStyle = 'rgba(219, 107, 107, 0.6)';
    ctx.fillRect(px * 0.11, 0, Math.max(1, px * 0.005), px);
  } else if (kind === 'grid') {
    ctx.fillStyle = 'rgba(158, 178, 199, 0.32)';
    for (let k = 1; k < 20; k++) {
      ctx.fillRect(0, (k / 20) * px, px, Math.max(1, px * 0.0016));
      ctx.fillRect((k / 20) * px, 0, Math.max(1, px * 0.0016), px);
    }
  }
}
