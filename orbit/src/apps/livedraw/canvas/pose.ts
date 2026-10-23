/**
 * Pose: an 18-point stick figure (the OpenPose / COCO body layout) you drag into place, drawn the
 * way OpenPose draws a skeleton (black ground, the standard colour per limb and per joint), so the
 * machine's pose ControlNet reads it as a person standing like that.
 */
import type { XY } from './raster';

/** COCO-18 order, as OpenPose numbers its body points. */
export const POSE_POINTS = [
  'Nose',
  'Neck',
  'Right shoulder',
  'Right elbow',
  'Right wrist',
  'Left shoulder',
  'Left elbow',
  'Left wrist',
  'Right hip',
  'Right knee',
  'Right ankle',
  'Left hip',
  'Left knee',
  'Left ankle',
  'Right eye',
  'Left eye',
  'Right ear',
  'Left ear',
] as const;

/** The 17 limbs OpenPose draws (pairs of points, 0-based), in its order. */
export const POSE_LIMBS: [number, number][] = [
  [1, 2],
  [1, 5],
  [2, 3],
  [3, 4],
  [5, 6],
  [6, 7],
  [1, 8],
  [8, 9],
  [9, 10],
  [1, 11],
  [11, 12],
  [12, 13],
  [1, 0],
  [0, 14],
  [14, 16],
  [0, 15],
  [15, 17],
];

/** OpenPose's colours (RGB), one per point and, in the same order, one per limb. */
export const POSE_COLORS: [number, number, number][] = [
  [255, 0, 0],
  [255, 85, 0],
  [255, 170, 0],
  [255, 255, 0],
  [170, 255, 0],
  [85, 255, 0],
  [0, 255, 0],
  [0, 255, 85],
  [0, 255, 170],
  [0, 255, 255],
  [0, 170, 255],
  [0, 85, 255],
  [0, 0, 255],
  [85, 0, 255],
  [170, 0, 255],
  [255, 0, 255],
  [255, 0, 170],
  [255, 0, 85],
];

/** A person standing, facing you, in 0..1 canvas units (their right is on your left). */
export function defaultPose(): XY[] {
  return [
    { x: 0.5, y: 0.2 },
    { x: 0.5, y: 0.3 },
    { x: 0.41, y: 0.3 },
    { x: 0.37, y: 0.43 },
    { x: 0.35, y: 0.55 },
    { x: 0.59, y: 0.3 },
    { x: 0.63, y: 0.43 },
    { x: 0.65, y: 0.55 },
    { x: 0.44, y: 0.56 },
    { x: 0.43, y: 0.72 },
    { x: 0.42, y: 0.88 },
    { x: 0.56, y: 0.56 },
    { x: 0.57, y: 0.72 },
    { x: 0.58, y: 0.88 },
    { x: 0.48, y: 0.18 },
    { x: 0.52, y: 0.18 },
    { x: 0.46, y: 0.19 },
    { x: 0.54, y: 0.19 },
  ];
}

type PoseCtx = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'fillRect' | 'beginPath' | 'ellipse' | 'arc' | 'fill'> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
};

const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/**
 * Draw the skeleton on a `side`-pixel square: black ground, each limb an ellipse at 60 % in its
 * colour (OpenPose's stick width 4 at 512 px, scaled), then each point a dot in its colour.
 */
export function drawPose(ctx: PoseCtx, points: XY[], side: number) {
  const stick = Math.max(2, (4 * side) / 512);
  const dot = Math.max(2, (4 * side) / 512);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, side, side);
  POSE_LIMBS.forEach(([a, b], i) => {
    const p = points[a];
    const q = points[b];
    if (!p || !q) return;
    const x1 = p.x * side, y1 = p.y * side, x2 = q.x * side, y2 = q.y * side;
    const len = Math.hypot(x2 - x1, y2 - y1);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = rgb(POSE_COLORS[i]);
    ctx.beginPath();
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, len / 2, stick, Math.atan2(y2 - y1, x2 - x1), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  points.forEach((p, i) => {
    if (!p) return;
    ctx.fillStyle = rgb(POSE_COLORS[i]);
    ctx.beginPath();
    ctx.arc(p.x * side, p.y * side, dot, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/** The skeleton as a PNG data URL, `side` pixels square. */
export function poseImage(points: XY[], side: number, doc: Document = document): string {
  const c = doc.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  drawPose(ctx, points, side);
  return c.toDataURL('image/png');
}

/** Move one point, kept on the canvas. */
export function movePoint(points: XY[], i: number, to: XY): XY[] {
  return points.map((p, k) => (k === i ? { x: Math.min(1, Math.max(0, to.x)), y: Math.min(1, Math.max(0, to.y)) } : p));
}
