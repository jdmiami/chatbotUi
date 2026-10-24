/**
 * Paths the orb travels while it offers words for a text box: around the box's border (a rounded
 * rectangle grown outward, so it never covers the text), or along one edge, sliding over the words
 * it offers. Plain math (no DOM), unit-tested.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A point on the outline of `box` grown by `pad` (corners rounded by `radius` + `pad`), `t` of the way
 * round (0…1, any number wraps), clockwise from the left end of the top edge.
 */
export function aroundBox(box: Box, pad: number, radius: number, t: number): Point {
  const L = box.left - pad, T = box.top - pad, R = box.right + pad, B = box.bottom + pad;
  const r = Math.max(0, Math.min(radius + pad, (R - L) / 2, (B - T) / 2));
  const w = Math.max(0, R - L - 2 * r);
  const h = Math.max(0, B - T - 2 * r);
  const arc = (Math.PI / 2) * r;
  const total = 2 * w + 2 * h + 4 * arc;
  if (total <= 0) return { x: (L + R) / 2, y: T };
  let s = (((t % 1) + 1) % 1) * total;
  const corner = (cx: number, cy: number, from: number, d: number): Point => {
    const a = from + (d / Math.max(arc, 1e-9)) * (Math.PI / 2);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  // top edge, left to right
  if (s <= w) return { x: L + r + s, y: T };
  s -= w;
  if (s <= arc) return corner(R - r, T + r, -Math.PI / 2, s);
  s -= arc;
  // right edge, downwards
  if (s <= h) return { x: R, y: T + r + s };
  s -= h;
  if (s <= arc) return corner(R - r, B - r, 0, s);
  s -= arc;
  // bottom edge, right to left
  if (s <= w) return { x: R - r - s, y: B };
  s -= w;
  if (s <= arc) return corner(L + r, B - r, Math.PI / 2, s);
  s -= arc;
  // left edge, upwards
  if (s <= h) return { x: L, y: B - r - s };
  s -= h;
  return corner(L + r, T + r, Math.PI, s);
}

/** How far round the outline (0…1) the point nearest to `p` is: where to join the path from where it is. */
export function nearestT(box: Box, pad: number, radius: number, p: Point, samples = 48): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples; i++) {
    const q = aroundBox(box, pad, radius, i / samples);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) ((bestD = d), (best = i / samples));
  }
  return best;
}

/**
 * The line just outside one edge of a one-line box that an orb of radius `r` slides along: above the
 * box when there is room on screen, else below it.
 */
export function edgeRail(box: Box, view: { y: number; h: number }, r: number, gap = 3): { y: number; side: 'top' | 'bottom' } {
  const above = box.top - gap - r;
  if (above - r >= view.y + 2) return { y: above, side: 'top' };
  const below = box.bottom + gap + r;
  if (below + r <= view.y + view.h - 2) return { y: below, side: 'bottom' };
  return { y: above, side: 'top' };
}

/** Back and forth between 0 and 1 every `period` seconds, easing at each end (a slide that turns softly). */
export function pingPong(seconds: number, period: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * seconds) / Math.max(0.001, period));
}

/** Keep a point (the centre of an orb of radius `r`) on screen. */
export function keepOnScreen(p: Point, view: { x: number; y: number; w: number; h: number }, r: number): Point {
  return {
    x: Math.min(view.x + view.w - r - 2, Math.max(view.x + r + 2, p.x)),
    y: Math.min(view.y + view.h - r - 2, Math.max(view.y + r + 2, p.y)),
  };
}
