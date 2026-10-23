/**
 * The drawing itself, apart from any screen: what is on the Sketch and Colour layers (strokes and
 * fills, in order), the Paint over mask, and one undo history across all of them (two fingers tap to
 * undo, three to redo). Clear can be undone too.
 */
import type { Stroke } from './sketch';

export type DrawLayer = 'sketch' | 'colour';
export type Target = DrawLayer | 'mask';

export type Op = { kind: 'stroke'; stroke: Stroke } | { kind: 'fill'; x: number; y: number; color: string };

interface Step {
  target: Target;
  before: Op[];
}

export class CanvasDoc {
  private ops: Record<Target, Op[]> = { sketch: [], colour: [], mask: [] };
  private undone: Step[] = [];
  private done: Step[] = [];
  /** Goes up on every change (what a frame was made from). */
  version = 0;

  get(target: Target): Op[] {
    return this.ops[target];
  }
  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }
  /** Nothing drawn on Sketch or Colour (eraser strokes alone are nothing). */
  get empty() {
    return !this.has('sketch') && !this.has('colour');
  }
  /** Anything drawn on a layer (or the mask). */
  has(target: Target) {
    return this.ops[target].some((o) => o.kind === 'fill' || o.stroke.tool !== 'eraser');
  }
  /** Strokes on a layer (eraser strokes too): the sketch reader waits for a new one. */
  count(target: Target) {
    return this.ops[target].length;
  }

  add(target: Target, op: Op) {
    if (op.kind === 'stroke' && !op.stroke.points.length) return;
    this.done.push({ target, before: this.ops[target] });
    this.ops[target] = [...this.ops[target], op];
    this.undone = [];
    this.version++;
  }
  clear(target: Target) {
    if (!this.ops[target].length) return;
    this.done.push({ target, before: this.ops[target] });
    this.ops[target] = [];
    this.undone = [];
    this.version++;
  }
  /** Undo the last change; returns the layer it was on (to redraw), or null. */
  undo(): Target | null {
    const step = this.done.pop();
    if (!step) return null;
    this.undone.push({ target: step.target, before: this.ops[step.target] });
    this.ops[step.target] = step.before;
    this.version++;
    return step.target;
  }
  redo(): Target | null {
    const step = this.undone.pop();
    if (!step) return null;
    this.done.push({ target: step.target, before: this.ops[step.target] });
    this.ops[step.target] = step.before;
    this.version++;
    return step.target;
  }
}
