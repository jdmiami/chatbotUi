/**
 * Where the orb should hover: next to the most important thing on the screen, never on top of it.
 *
 * What matters, in order:
 *  1. Anything an app marks with data-orb-focus (the newest answer, the step you're on…).
 *  2. The field you're typing in.
 *  3. The main action on screen (the primary button that is visible and enabled).
 *  4. The newest message in a conversation.
 *  5. Otherwise a quiet spot low on the right, out of the way of thumbs and content.
 *
 * The orb sits beside its target (to the right, else above, else to the left) so it points at it
 * without covering it, and never over another control.
 */
import type { Rect } from './physics';

export interface Focus {
  /** Where the orb's centre should go. */
  x: number;
  y: number;
  /** What it is looking at (for the glance and for tests); null at the resting spot. */
  el: Element | null;
  kind: 'marked' | 'typing' | 'action' | 'latest' | 'rest';
}

const PRIMARY = '[data-orb-focus], .btn.primary, button[type="submit"], .ai-make, .ai-send';
const LATEST = '.ai-msg-assistant, .ag-msg, .sr-shot, .o5-step';

function visible(el: Element, view: Rect): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < view.y + 8 || r.top > view.y + view.h - 8 || r.right < 0 || r.left > view.w) return null;
  const s = getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return null;
  if (el.closest('[inert], [aria-hidden="true"], [data-hidden="true"]')) return null;
  return r;
}

const isTyping = (el: Element | null): el is HTMLElement =>
  !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit'].includes(el.type)) || (el as HTMLElement).isContentEditable);

/** The resting spot: low on the right, above the home handle / dock and the keyboard. */
export function restSpot(view: Rect, size: number): { x: number; y: number } {
  return { x: view.x + view.w - size / 2 - 14, y: view.y + view.h - size / 2 - 96 };
}

/** Pick a place beside `r` for an orb of `size`, inside `view`, avoiding other controls. */
export function besideRect(r: DOMRect, view: Rect, size: number, avoid?: (x: number, y: number) => boolean): { x: number; y: number } | null {
  const half = size / 2;
  const gap = 10;
  const candidates = [
    { x: r.right + gap + half, y: r.top + half }, // right, top-aligned
    { x: r.right - half, y: r.top - gap - half }, // above, right end
    { x: r.left - gap - half, y: r.top + half }, // left
    { x: r.right - half, y: r.bottom + gap + half }, // below, right end
  ];
  for (const c of candidates) {
    const inside = c.x - half >= view.x + 4 && c.x + half <= view.x + view.w - 4 && c.y - half >= view.y + 4 && c.y + half <= view.y + view.h - 4;
    if (inside && !(avoid?.(c.x, c.y) ?? false)) return c;
  }
  return null;
}

/** True when an orb at (x, y) would cover a control (sampled at its centre and four edges). */
export function coversControl(x: number, y: number, size: number, self: Element | null): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const q = size * 0.38;
  for (const [dx, dy] of [[0, 0], [q, 0], [-q, 0], [0, q], [0, -q]]) {
    const hit = document.elementsFromPoint(x + dx, y + dy).find((e) => !self?.contains(e));
    if (hit?.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')) return true;
  }
  return false;
}

/** Decide where the orb goes now. `self` is the orb (ignored when checking what it would cover). */
export function findFocus(view: Rect, size: number, self: Element | null, root: ParentNode = document): Focus {
  const avoid = (x: number, y: number) => coversControl(x, y, size, self);
  const place = (el: Element, kind: Focus['kind']): Focus | null => {
    const r = visible(el, view);
    if (!r) return null;
    const spot = besideRect(r, view, size, avoid);
    return spot ? { ...spot, el, kind } : null;
  };

  // 1. Marked by an app, newest first.
  const marked = [...root.querySelectorAll('[data-orb-focus]')].reverse();
  for (const el of marked) {
    const f = place(el, 'marked');
    if (f) return f;
  }
  // 2. Typing.
  const active = document.activeElement;
  if (isTyping(active) && !self?.contains(active)) {
    const f = place(active, 'typing');
    if (f) return f;
  }
  // 3. The main action (topmost app window's own first; the lowest one on screen is usually "the next step").
  const actions = [...root.querySelectorAll(PRIMARY)].filter((el) => !(el as HTMLButtonElement).disabled && !self?.contains(el));
  actions.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
  for (const el of actions) {
    const f = place(el, 'action');
    if (f) return f;
  }
  // 4. The newest message or step.
  const latest = [...root.querySelectorAll(LATEST)].reverse();
  for (const el of latest.slice(0, 4)) {
    const f = place(el, 'latest');
    if (f) return f;
  }
  return { ...restSpot(view, size), el: null, kind: 'rest' };
}
