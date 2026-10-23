/**
 * Drawing the layers onto real canvases: on screen (at the screen's own pixel density) and for the
 * machine (at the working size: 512, 768 or 1024 square). Strokes are replayed in order; a fill is
 * worked out again from what is under it then (bounded by the Sketch layer's lines).
 */
import type { Op } from './doc';
import { binarizeMask, floodRegion, growRegion, maskCoverage, paintRegion, type XY } from './raster';
import { drawStroke, hexRgb, type DrawOpts } from './sketch';

export function makeCanvas(side: number, doc: Document = document): HTMLCanvasElement {
  const c = doc.createElement('canvas');
  c.width = side;
  c.height = side;
  return c;
}

function pixels(src: HTMLCanvasElement, side: number): Uint8ClampedArray | null {
  let c = src;
  if (src.width !== side || src.height !== side) {
    c = makeCanvas(side);
    c.getContext('2d')?.drawImage(src, 0, 0, side, side);
  }
  return c.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, side, side).data ?? null;
}

/** One fill, onto `ctx` (`side` square), bounded by the lines on `boundary`. */
export function fillAt(ctx: CanvasRenderingContext2D, op: Extract<Op, { kind: 'fill' }>, side: number, boundary: HTMLCanvasElement | null) {
  const img = ctx.getImageData(0, 0, side, side);
  const lines = boundary ? pixels(boundary, side) : null;
  const region = growRegion(floodRegion(img.data, lines, side, side, op.x * side, op.y * side), side, side, 1);
  paintRegion(img.data, region, hexRgb(op.color));
  ctx.putImageData(img, 0, 0);
}

/** Replay a layer's strokes and fills onto a cleared canvas. */
export function renderOps(canvas: HTMLCanvasElement, ops: Op[], opts: DrawOpts & { boundary?: HTMLCanvasElement | null; skipFills?: boolean } = {}) {
  const side = canvas.width;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, side, side);
  for (const op of ops) {
    if (op.kind === 'stroke') drawStroke(ctx, op.stroke, side, 0, opts);
    else if (!opts.skipFills) fillAt(ctx, op, side, opts.boundary ?? null);
  }
}

/** A layer as a PNG data URL on transparent, `side` square (lines: black ink, no fills). */
export function layerPng(ops: Op[], side: number, opts: DrawOpts & { boundary?: HTMLCanvasElement | null; skipFills?: boolean } = {}): string {
  const c = makeCanvas(side);
  renderOps(c, ops, opts);
  return c.toDataURL('image/png');
}

/** The Paint over mask (white = may change, on black), or null when nothing is painted. */
export function maskPng(ops: Op[], side: number): string | null {
  const c = makeCanvas(side);
  renderOps(c, ops, { color: '#ffffff', skipFills: true });
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, side, side);
  binarizeMask(img.data);
  if (maskCoverage(img.data) === 0) return null;
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** A region (a lasso) as a mask: white inside, black outside. */
export function regionPng(poly: XY[], side: number): string {
  const c = makeCanvas(side);
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x * side, p.y * side) : ctx.moveTo(p.x * side, p.y * side)));
  ctx.closePath();
  ctx.fill();
  return c.toDataURL('image/png');
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That picture could not be read.'));
    img.src = src;
  });
}

/** A picture from the device (HEIC too on an iPhone), shrunk to at most `max` px, as a data URL. */
export async function fileToDataUrl(file: Blob, max = 1024, type = 'image/jpeg'): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type, 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw a picture centred and cropped to fill a square (a reference photo on the square canvas). */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength }, side: number) {
  const w = img.naturalWidth || img.videoWidth || (typeof img.width === 'number' ? img.width : 0) || side;
  const h = img.naturalHeight || img.videoHeight || (typeof img.height === 'number' ? img.height : 0) || side;
  const s = Math.min(w, h);
  ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, side, side);
}
