/**
 * Where the text cursor is, so the orb can become it while you type.
 *
 * Inputs and text areas don't expose their caret position, so a hidden copy of the field (same
 * font, padding, width, wrapping) is laid out with the text up to the caret and a marker after
 * it; the marker's position is the caret's. Editable elements use the selection's own rectangle.
 * The code editor (CodeMirror) draws its own cursor and the terminal (xterm) keeps a hidden text box
 * on its cursor cell: the orb reads where those are and takes their place.
 */

export interface Caret {
  /** Left edge of the caret and the top of its line, in viewport pixels. */
  x: number;
  y: number;
  /** Line height. */
  h: number;
}

const COPY = [
  'boxSizing', 'width', 'height', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'fontFamily', 'lineHeight', 'textAlign', 'textTransform', 'textIndent',
  'letterSpacing', 'wordSpacing', 'tabSize', 'wordBreak', 'overflowWrap', 'direction',
] as const;

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', '']);

/** A field the orb can be the caret of (not the orb's own box, nor one marked to keep its own caret). */
export function caretField(el: Element | null, skip?: Element | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!el || skip?.contains(el)) return null;
  if (el.closest('[data-own-caret]')) return null;
  if (el instanceof HTMLTextAreaElement && el.classList.contains('xterm-helper-textarea')) return el;
  if (el instanceof HTMLTextAreaElement) return el.readOnly ? null : el;
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type) && !el.readOnly ? el : null;
  if (el instanceof HTMLElement && el.isContentEditable) return el;
  return null;
}

function lineHeight(s: CSSStyleDeclaration) {
  const lh = parseFloat(s.lineHeight);
  return Number.isFinite(lh) ? lh : parseFloat(s.fontSize) * 1.25;
}

/** The caret of `el` right now, or null when it can't be placed (no selection, hidden field). */
export function caretOf(el: HTMLElement): Caret | null {
  const box = el.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  const s = getComputedStyle(el);
  const h = Math.min(lineHeight(s), box.height);

  // The terminal moves its hidden text box onto the cursor cell (for the on-screen keyboard and IME).
  if (el.classList.contains('xterm-helper-textarea')) {
    const screen = el.closest('.xterm')?.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (screen && (box.top < screen.top - 1 || box.bottom > screen.bottom + 1)) return null; // scrolled away
    return { x: box.left, y: box.top, h: box.height };
  }

  // The code editor draws its own cursor: take its place.
  const cm = el.closest('.cm-editor');
  if (cm) {
    const cur = (cm.querySelector('.cm-cursor-primary') ?? cm.querySelector('.cm-cursor'))?.getBoundingClientRect();
    if (cur && cur.height > 0) {
      const scroller = cm.querySelector('.cm-scroller')?.getBoundingClientRect() ?? cm.getBoundingClientRect();
      if (cur.bottom < scroller.top || cur.top > scroller.bottom) return null; // scrolled out of view
      return { x: cur.left, y: cur.top, h: cur.height };
    }
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    let pos: number;
    try {
      pos = el.selectionEnd ?? el.value.length;
    } catch {
      pos = el.value.length; // type=number has no selection API
    }
    return caretAt(el, pos);
  }

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.focusNode)) return null;
  const range = document.createRange();
  range.setStart(sel.focusNode!, sel.focusOffset);
  range.collapse(true);
  const r = range.getClientRects()[0] ?? null;
  // An empty line has no rectangle (and the page's text must not be touched): use the start of the
  // line it is on, or of the field.
  if (!r || (r.width === 0 && r.height === 0)) {
    const node = sel.focusNode;
    const line = node instanceof Element ? ((node.childNodes[sel.focusOffset] as Element | undefined) ?? node) : node?.parentElement;
    if (line instanceof Element && line !== el && el.contains(line)) {
      const lr = line.getBoundingClientRect();
      const ls = getComputedStyle(line);
      if (lr.height > 0) return { x: lr.left + parseFloat(ls.paddingLeft || '0'), y: lr.top, h: Math.min(lr.height, lineHeight(ls)) };
    }
    return { x: box.left + parseFloat(s.paddingLeft || '0'), y: box.top + parseFloat(s.paddingTop || '0'), h };
  }
  return { x: r.left, y: r.top, h: Math.max(r.height, h * 0.8) };
}

/**
 * Where the caret of a text box would be at each position from `from` to `to`, measured in one
 * pass: a hidden, identical copy of the box is laid out once with a marker at every position.
 */
export function caretsAt(el: HTMLInputElement | HTMLTextAreaElement, from: number, to: number): (Caret | null)[] {
  const box = el.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return Array.from({ length: Math.max(0, to - from + 1) }, () => null);
  const s = getComputedStyle(el);
  const h = Math.min(lineHeight(s), box.height);
  const copy = document.createElement('div');
  const cs = copy.style as unknown as Record<string, string>;
  for (const p of COPY) cs[p] = (s as unknown as Record<string, string>)[p];
  copy.style.position = 'fixed';
  copy.style.left = `${box.left}px`;
  copy.style.top = `${box.top}px`;
  copy.style.visibility = 'hidden';
  copy.style.pointerEvents = 'none';
  copy.style.overflow = 'hidden';
  copy.style.whiteSpace = el instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
  if (el instanceof HTMLTextAreaElement) copy.style.overflowWrap = 'break-word';
  const value = el instanceof HTMLInputElement && el.type === 'password' ? '•'.repeat(el.value.length) : el.value;
  copy.append(value.slice(0, from));
  // A marker before each character (whole characters: never between the two halves of an emoji).
  const marks: (HTMLSpanElement | null)[] = [];
  for (let pos = from; pos <= to; ) {
    const mark = document.createElement('span');
    mark.textContent = '\u200b';
    copy.append(mark);
    marks.push(mark);
    if (pos >= to) break;
    const len = (value.codePointAt(pos) ?? 0) > 0xffff ? 2 : 1;
    copy.append(value.slice(pos, pos + len));
    if (len === 2) marks.push(null); // no caret position inside a character
    pos += len;
  }
  copy.append(value.slice(to));
  document.body.append(copy);
  const out = marks.map((mark) => {
    if (!mark) return null;
    const m = mark.getBoundingClientRect();
    // A single-line input centres its text vertically; a text area starts at the top padding.
    const top = el instanceof HTMLInputElement ? box.top + (box.height - h) / 2 : m.top - el.scrollTop;
    const x = Math.min(box.right - 2, Math.max(box.left, m.left - el.scrollLeft));
    const y = Math.min(box.bottom - h, Math.max(box.top, top));
    return { x, y, h };
  });
  copy.remove();
  return out;
}

/** Where the caret of a text box would be with the cursor at `pos`. */
export function caretAt(el: HTMLInputElement | HTMLTextAreaElement, pos: number): Caret | null {
  return caretsAt(el, pos, pos)[0];
}

/** The position in a text box nearest to the point (x, y): where a cursor dropped there should go. */
export function offsetAt(el: HTMLInputElement | HTMLTextAreaElement, x: number, y: number): number {
  // Right-to-left or mixed text: positions don't run left to right within a line, so find the line
  // (lines do run top to bottom), then measure each position on it and take the nearest.
  if (/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(el.value) || getComputedStyle(el).direction === 'rtl') {
    const n = el.value.length;
    const firstWhere = (test: (c: Caret) => boolean) => {
      let lo = 0;
      let hi = n + 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const c = caretAt(el, mid);
        if (c && test(c)) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const single = el instanceof HTMLInputElement;
    const from = single ? 0 : Math.min(n, firstWhere((c) => c.y + c.h > y));
    const to = single ? n : Math.min(n, firstWhere((c) => c.y > y) - 1);
    // Every position on that line, measured in one layout pass (not one per position).
    const all = caretsAt(el, from, Math.max(from, to));
    let best = from;
    let bestD = Infinity;
    all.forEach((c, i) => {
      if (!c) return;
      const d = Math.abs(c.x - x) + Math.abs(c.y + c.h / 2 - y) * 4;
      if (d < bestD) ((bestD = d), (best = from + i));
    });
    return best;
  }
  const single = el instanceof HTMLInputElement;
  // True while the caret at `pos` is still before the point (reading order: line, then across).
  const before = (pos: number) => {
    const c = caretAt(el, pos);
    if (!c) return true;
    if (!single && y < c.y) return false;
    if (!single && y > c.y + c.h) return true;
    return c.x <= x;
  };
  let lo = 0;
  let hi = el.value.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (before(mid)) lo = mid;
    else hi = mid - 1;
  }
  // Between two letters: the nearer gap.
  if (lo < el.value.length) {
    const a = caretAt(el, lo);
    const b = caretAt(el, lo + 1);
    if (a && b && Math.abs(b.y - a.y) < 1 && Math.abs(b.x - x) < Math.abs(a.x - x)) return lo + 1;
  }
  return lo;
}
