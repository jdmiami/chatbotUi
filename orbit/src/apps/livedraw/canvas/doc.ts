/**
 * The simple stroke list the Paint over mask (and the lines sent to the drawing machine) are drawn
 * from. The layers themselves live in layers/model.ts.
 */
import type { Stroke } from './sketch';

export type DrawLayer = 'sketch' | 'colour';
export type Target = DrawLayer | 'mask';

export type Op = { kind: 'stroke'; stroke: Stroke } | { kind: 'fill'; x: number; y: number; color: string };
