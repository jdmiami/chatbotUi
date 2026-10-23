/**
 * Pixel helpers that don't need a screen: the fill tool's region, masks for Paint over and Regions
 * (white = may change, on black), the lasso, and the order the layers are flattened in. Kept free of
 * canvases so they can be tested on plain arrays.
 */

/**
 * The fill tool: every pixel connected to (x, y) whose colour is close to the one tapped (within
 * `tol` per channel, alpha included) and that isn't a line on `boundary` (another layer's ink, alpha
 * at or above 96). Returns 1 for each pixel to fill.
 */
export function floodRegion(target: ArrayLike<number>, boundary: ArrayLike<number> | null, w: number, h: number, x: number, y: number, tol = 40): Uint8Array {
  const out = new Uint8Array(w * h);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const at = (i: number) => i * 4;
  const s = at(y * w + x);
  const sr = target[s], sg = target[s + 1], sb = target[s + 2], sa = target[s + 3];
  const blocked = (i: number) => (boundary ? boundary[at(i) + 3] >= 96 : false);
  const same = (i: number) => {
    const k = at(i);
    // Transparent pixels match each other whatever their (meaningless) colour.
    if (sa < 8 && target[k + 3] < 8) return true;
    return Math.abs(target[k] - sr) <= tol && Math.abs(target[k + 1] - sg) <= tol && Math.abs(target[k + 2] - sb) <= tol && Math.abs(target[k + 3] - sa) <= tol;
  };
  if (blocked(y * w + x)) return out;
  const stack = [y * w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i]) continue;
    const row = Math.floor(i / w);
    // Walk left, then right, along the row; queue the rows above and below.
    let l = i;
    while (l % w > 0 && !out[l - 1] && same(l - 1) && !blocked(l - 1)) l--;
    let r = i;
    while (r % w < w - 1 && !out[r + 1] && same(r + 1) && !blocked(r + 1)) r++;
    for (let k = l; k <= r; k++) {
      out[k] = 1;
      if (row > 0) {
        const up = k - w;
        if (!out[up] && same(up) && !blocked(up)) stack.push(up);
      }
      if (row < h - 1) {
        const dn = k + w;
        if (!out[dn] && same(dn) && !blocked(dn)) stack.push(dn);
      }
    }
  }
  return out;
}

/** Grow a region by `by` pixels, so a fill tucks under the soft edge of the lines around it. */
export function growRegion(region: Uint8Array, w: number, h: number, by = 1): Uint8Array {
  let cur = region;
  for (let n = 0; n < by; n++) {
    const next = cur.slice();
    for (let i = 0; i < cur.length; i++) {
      if (cur[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1;
    }
    cur = next;
  }
  return cur;
}

/** Paint a region of an RGBA buffer in one colour (in place). */
export function paintRegion(data: Uint8ClampedArray, region: Uint8Array, rgb: [number, number, number], alpha = 255) {
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue;
    const k = i * 4;
    data[k] = rgb[0];
    data[k + 1] = rgb[1];
    data[k + 2] = rgb[2];
    data[k + 3] = alpha;
  }
}

/**
 * A mask for the machine (in place): wherever anything was painted (alpha above `threshold`) is
 * white, everything else black, all opaque. White = may change.
 */
export function binarizeMask(data: Uint8ClampedArray, threshold = 24): Uint8ClampedArray {
  for (let k = 0; k < data.length; k += 4) {
    const v = data[k + 3] > threshold ? 255 : 0;
    data[k] = v;
    data[k + 1] = v;
    data[k + 2] = v;
    data[k + 3] = 255;
  }
  return data;
}

/** The share of a mask that is white (0..1): an empty Paint over mask sends nothing. */
export function maskCoverage(data: ArrayLike<number>): number {
  let on = 0;
  const n = data.length / 4;
  for (let k = 0; k < data.length; k += 4) if (data[k] > 127) on++;
  return n ? on / n : 0;
}

export interface XY {
  x: number;
  y: number;
}

/** Is a point inside a polygon (even-odd rule)? */
export function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

/** A lasso worth keeping: at least three points spread over a little area (not a tap). */
export function lassoOk(poly: XY[]): boolean {
  if (poly.length < 3) return false;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return Math.max(...xs) - Math.min(...xs) > 0.02 && Math.max(...ys) - Math.min(...ys) > 0.02;
}

/** Fewer lasso points (every point at least `min` apart), so a region stays light to keep and send. */
export function thinPath(poly: XY[], min = 0.006): XY[] {
  const out: XY[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= min) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** How the Reference layer shows (a tracing picture). */
export const REFERENCE_ALPHA = 0.45;

/** Draw layers onto white paper, bottom first (the flattened PNG, the time-lapse's last frame). */
export function flattenOnto(
  ctx: Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'fillRect' | 'drawImage'> & { globalAlpha: number; fillStyle: string | CanvasGradient | CanvasPattern },
  side: number,
  layers: { source: CanvasImageSource | null; alpha: number }[],
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  for (const l of layers) {
    if (!l.source || l.alpha <= 0) continue;
    ctx.globalAlpha = l.alpha;
    ctx.drawImage(l.source, 0, 0, side, side);
  }
  ctx.restore();
}

/** The prompt the machine gets: your words, then each picked style's words. */
export function joinPrompt(words: string, styles: string[]): string {
  return [words.trim(), ...styles.map((s) => s.trim())].filter(Boolean).join(', ');
}
