/**
 * Where the text cursor is, so the orb can become it while you type.
 *
 * Inputs and text areas don't expose their caret position, so a hidden copy of the field (same
 * font, padding, width, wrapping) is laid out with the text up to the caret and a marker after
 * it; the marker's position is the caret's. Editable elements use the selection's own rectangle.
 * Editors that draw their own caret (CodeMirror, the terminal) keep theirs.
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

/** A field the orb can be the caret of (not editors that draw their own, nor the orb's own box). */
export function caretField(el: Element | null, skip?: Element | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!el || skip?.contains(el)) return null;
  if (el.closest('.cm-editor, .xterm, [data-own-caret]')) return null;
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

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    let pos: number;
    try {
      pos = el.selectionEnd ?? el.value.length;
    } catch {
      pos = el.value.length; // type=number has no selection API
    }
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
    copy.textContent = value.slice(0, pos);
    const mark = document.createElement('span');
    mark.textContent = '​';
    copy.append(mark);
    document.body.append(copy);
    const m = mark.getBoundingClientRect();
    copy.remove();
    // A single-line input centres its text vertically; a text area starts at the top padding.
    const top = el instanceof HTMLInputElement ? box.top + (box.height - h) / 2 : m.top - el.scrollTop;
    const x = Math.min(box.right - 2, Math.max(box.left, m.left - el.scrollLeft));
    const y = Math.min(box.bottom - h, Math.max(box.top, top));
    return { x, y, h };
  }

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.focusNode)) return null;
  const range = document.createRange();
  range.setStart(sel.focusNode!, sel.focusOffset);
  range.collapse(true);
  const r = range.getClientRects()[0] ?? null;
  // An empty line has no rectangle (and the page's text must not be touched): use the field's start.
  if (!r || (r.width === 0 && r.height === 0)) return { x: box.left + parseFloat(s.paddingLeft || '0'), y: box.top + parseFloat(s.paddingTop || '0'), h };
  return { x: r.left, y: r.top, h: Math.max(r.height, h * 0.8) };
}
