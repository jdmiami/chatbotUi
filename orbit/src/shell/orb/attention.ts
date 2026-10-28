/**
 * Where the orb should hover: next to the most important thing on the screen, never on top of it.
 *
 * What matters, in order:
 *  0. A stage (data-orb-spot="stage", e.g. the voice conversation): the orb is the voice orb there.
 *  ½. The step a walkthrough registered with useOrbAssist (assist.ts): its text box or its choices.
 *  1. Anything an app marks with data-orb-focus (the newest answer, the step you're on…).
 *  2. The field you're typing in.
 *  3. A spot an app keeps for it (data-orb-spot, e.g. the AI's face on an empty chat).
 *  4. The main action on screen (the primary button that is visible and enabled).
 *  5. The newest message in a conversation.
 *  6. Otherwise a quiet spot low on the right, out of the way of thumbs and content.
 *
 * The orb sits beside its target (to the right, else above, else to the left) so it points at it
 * without covering it, and never over another control. On a spot or a stage it sits centred on it
 * instead, grown to its size (data-orb-size, in px).
 */
import type { Rect } from './physics';

export interface Focus {
  /** Where the orb's centre should go. */
  x: number;
  y: number;
  /** What it is looking at (for the glance and for tests); null at the resting spot. */
  el: Element | null;
  kind: 'stage' | 'assist' | 'marked' | 'typing' | 'spot' | 'action' | 'latest' | 'rest';
  /** On a spot or a stage: how big it should be there (px). Beside a step with no room for it: smaller. */
  size?: number;
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

/** True when (x, y) is on the words of `el` themselves (not the empty end of its line). */
function onWords(el: Element, x: number, y: number, slack: number): boolean {
  const range = document.createRange();
  range.selectNodeContents(el);
  for (const r of range.getClientRects()) {
    if (x >= r.left - slack && x <= r.right + slack && y >= r.top - slack && y <= r.bottom + slack) return true;
  }
  return false;
}

/**
 * True when an orb at (x, y) would cover a control or text (sampled at its centre and four edges).
 * `opts.words`: only the words of a heading or paragraph count, not the rest of its line. `opts.shift`:
 * look where things are now for a spot they will move to (a step sliding in by that much).
 */
export function coversControl(x: number, y: number, size: number, self: Element | null, opts: { words?: boolean; shift?: { x: number; y: number } } = {}): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const q = size * 0.38;
  const sx = opts.shift?.x ?? 0, sy = opts.shift?.y ?? 0;
  for (const [dx, dy] of [[0, 0], [q, 0], [-q, 0], [0, q], [0, -q]]) {
    const px = x + dx + sx, py = y + dy + sy;
    const hit = document.elementsFromPoint(px, py).find((e) => !self?.contains(e));
    if (hit?.closest('button, a, input, textarea, select, [role="button"], [contenteditable]:not([contenteditable="false"])')) return true;
    // Nor over words you are reading (a sentence, a heading, a list item).
    const text = hit?.closest('p, h1, h2, h3, h4, li, blockquote');
    if (text && text.textContent?.trim() && (!opts.words || onWords(text, px, py, size * 0.12))) return true;
  }
  return false;
}

/**
 * Where `el` will be once what is moving it (a step sliding in, a sheet rising) has finished: its
 * rectangle now, less what the running animations of it and its parents add. Without animations it is
 * simply where it is.
 */
export function restingRect(el: Element): { rect: DOMRect; moving: boolean; shift: { x: number; y: number } } {
  const r = el.getBoundingClientRect();
  let dx = 0, dy = 0, moving = false;
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    const running = typeof n.getAnimations === 'function' && n.getAnimations().some((a) => a.playState === 'running');
    if (!running) continue;
    moving = true;
    const s = getComputedStyle(n);
    if (s.transform && s.transform !== 'none' && typeof DOMMatrixReadOnly === 'function') {
      const m = new DOMMatrixReadOnly(s.transform);
      dx += m.m41;
      dy += m.m42;
    }
    if (s.translate && s.translate !== 'none') {
      const [a, b = '0px'] = s.translate.split(/\s+/);
      if (a.endsWith('px')) dx += parseFloat(a) || 0;
      if (b.endsWith('px')) dy += parseFloat(b) || 0;
    }
  }
  return { rect: new DOMRect(r.left - dx, r.top - dy, r.width, r.height), moving, shift: { x: dx, y: dy } };
}

/** How small the orb gets beside a step that leaves no room for it (and while it offers words). */
export const ASSIST_SMALL = 0.64;

/**
 * Beside the step's text box or choices: full size where there is room, else smaller, else just
 * above its top right corner (outside it, so it never covers what is in it).
 */
export function assistSpot(
  el: Element,
  view: Rect,
  size: number,
  self: Element | null,
  /** Where the step will rest while it slides in, and how far it still has to go (see restingRect). */
  opts: { rect?: DOMRect; shift?: { x: number; y: number } } = {},
): Focus | null {
  const r = opts.rect ?? visible(el, view);
  if (!r) return null;
  // Beside a step only real words count (the empty end of a heading's line is room for it).
  const avoid = (s: number) => (x: number, y: number) => coversControl(x, y, s, self, { words: true, shift: opts.shift });
  const big = besideRect(r, view, size, avoid(size));
  if (big) return { ...big, el, kind: 'assist', size };
  const s = size * ASSIST_SMALL;
  const small = besideRect(r, view, s, avoid(s));
  if (small) return { ...small, el, kind: 'assist', size: s };
  const x = Math.min(view.x + view.w - s / 2 - 4, r.right - s / 2 - 4);
  const above = r.top - 3 - s / 2;
  const y = above - s / 2 >= view.y + 2 ? above : Math.min(view.y + view.h - s / 2 - 4, r.bottom + 3 + s / 2);
  return { x, y, el, kind: 'assist', size: s };
}

/**
 * Decide where the orb goes now. `self` is the orb (ignored when checking what it would cover);
 * `prefer` is the step it is helping with (assist.ts), which comes before anything but a stage.
 */
export function findFocus(view: Rect, size: number, self: Element | null, root: ParentNode = document, prefer?: Element | null): Focus {
  const avoid = (x: number, y: number) => coversControl(x, y, size, self);
  const place = (el: Element, kind: Focus['kind']): Focus | null => {
    const r = visible(el, view);
    if (!r) return null;
    const spot = besideRect(r, view, size, avoid);
    return spot ? { ...spot, el, kind } : null;
  };

  const centred = (kind: 'stage' | 'spot'): Focus | null => {
    for (const el of root.querySelectorAll(kind === 'stage' ? '[data-orb-spot="stage"]' : '[data-orb-spot]:not([data-orb-spot="stage"])')) {
      const r = visible(el, view);
      if (!r) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // Really in view at its centre (not scrolled away under something else).
      if (typeof document.elementsFromPoint === 'function') {
        const hit = document.elementsFromPoint(x, y).find((e) => !self?.contains(e));
        if (hit && hit !== el && !el.contains(hit)) continue;
      }
      return { x, y, el, kind, size: Number((el as HTMLElement).dataset.orbSize) || r.width };
    }
    return null;
  };
  // 0. A stage.
  const stage = centred('stage');
  if (stage) return stage;
  // ½. The step it is helping with.
  if (prefer) {
    const f = assistSpot(prefer, view, size, self);
    if (f) return f;
  }
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
  // 3. A spot kept for it.
  const spot = centred('spot');
  if (spot) return spot;
  // 4. The main action (topmost app window's own first; the lowest one on screen is usually "the next step").
  const actions = [...root.querySelectorAll(PRIMARY)].filter((el) => !(el as HTMLButtonElement).disabled && !self?.contains(el));
  actions.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
  for (const el of actions) {
    const f = place(el, 'action');
    if (f) return f;
  }
  // 5. The newest message or step.
  const latest = [...root.querySelectorAll(LATEST)].reverse();
  for (const el of latest.slice(0, 4)) {
    const f = place(el, 'latest');
    if (f) return f;
  }
  return { ...restSpot(view, size), el: null, kind: 'rest' };
}
