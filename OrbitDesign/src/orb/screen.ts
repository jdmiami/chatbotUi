/**
 * What is on screen, for the orb to understand and explain: the visible text in reading order, and
 * a list of the controls a person could use. Passwords, private boxes ([data-private]) and the
 * orb's own UI are left out.
 *
 * Port note: this is the DOM-only part of Orbit's `look.ts` (`screenText`, `isExplain`,
 * `EXPLAIN_PROMPT`) plus the DOM-only `snapshot` from Orbit's agent module (used by the panel's
 * "What can I do here?" chip). `screenPictures` (the biggest pictures as JPEG data URLs, for a
 * model that can see) is not ported: the adapter's messages are text only.
 */
import { labelOf, privateField } from './write';

const SKIP = '.orb-layer, .wh-ui, [data-private], [aria-hidden="true"], [inert], script, style, noscript, template';

function visible(r: DOMRect, vw: number, vh: number) {
  return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
}

/** The text you can see now, top to bottom, at most `max` characters. */
export function screenText(root: ParentNode = document.body, max = 5000): string {
  const vw = window.innerWidth, vh = window.innerHeight;
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const seen = new Map<Element, { top: number; left: number; text: string }>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || el.closest(SKIP)) continue;
    const r = el.getBoundingClientRect();
    if (!visible(r, vw, vh)) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.opacity === '0') continue;
    const prev = seen.get(el);
    if (prev) prev.text += ` ${text}`;
    else seen.set(el, { top: Math.round(r.top), left: Math.round(r.left), text });
  }
  // What is typed in boxes counts too (but never private ones).
  for (const f of (root as Element).querySelectorAll?.<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? []) {
    if (f.closest(SKIP) || privateField(f) || !f.value || f.type === 'hidden') continue;
    const r = f.getBoundingClientRect();
    if (visible(r, vw, vh)) seen.set(f, { top: Math.round(r.top), left: Math.round(r.left), text: `[typed] ${f.value.slice(0, 600)}` });
  }
  const parts = [...seen.values()].sort((a, b) => a.top - b.top || a.left - b.left);
  let out = '';
  for (const p of parts) {
    if (out.length + p.text.length > max) break;
    out += (out ? '\n' : '') + p.text;
  }
  return out;
}

/** "Explain this", "what's on my screen", "summarise this page"… */
export function isExplain(goal: string): boolean {
  return /\b(explain|summari[sz]e|tl;?dr|describe|read (this|it)|what('s| is| does)\b.*\b(this|that|screen|page|here|mean|say|it)\b|what am i (looking at|seeing))/i.test(goal);
}

/** Orbit's system prompt for "explain this screen", unchanged. An app can replace it through the `explainPrompt` prop. */
export const EXPLAIN_PROMPT =
  'You are the orb in Orbit, a web workspace. You see what is on the owner\'s screen (its text, and sometimes pictures). ' +
  'Answer their question about it in plain, friendly language: 2 to 5 short sentences, no jargon, no markdown headings. ' +
  'If something looks wrong (an error, a warning), say what it means and one thing to try. Never repeat passwords or keys.';

export interface PageItem {
  id: number;
  role: 'button' | 'link' | 'field' | 'tab' | 'option' | 'switch';
  label: string;
  value?: string;
  el: HTMLElement;
  /** Further down (or up) the page: it scrolls there first. */
  offscreen?: boolean;
}

function roleOf(el: HTMLElement): PageItem['role'] {
  const r = el.getAttribute('role');
  if (r === 'tab') return 'tab';
  if (r === 'radio' || r === 'option' || r === 'menuitem') return 'option';
  if (r === 'switch' || (el instanceof HTMLInputElement && el.type === 'checkbox')) return 'switch';
  if (el.matches('input, textarea, select, [contenteditable="true"]')) return 'field';
  if (el.tagName === 'A') return 'link';
  return 'button';
}

/**
 * What can be used right now, top to bottom. `skip` = the orb's own UI. With `all`, controls
 * scrolled out of view are included too (marked offscreen).
 */
export function snapshot(skip?: Element | null, root: ParentNode = document, { all = false } = {}): PageItem[] {
  const els = root.querySelectorAll<HTMLElement>(
    'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], [contenteditable="true"]',
  );
  const items: PageItem[] = [];
  const vh = window.innerHeight, vw = window.innerWidth;
  for (const el of els) {
    if (skip?.contains(el) || (el as HTMLButtonElement).disabled) continue;
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const offscreen = r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
    if (offscreen && (!all || r.right < 0 || r.left > vw || getComputedStyle(el).visibility === 'hidden')) continue;
    const label = labelOf(el);
    if (!label) continue;
    const role = roleOf(el);
    // Passwords, codes and card numbers are never read out (to a model or anyone else).
    const value = role === 'field' && 'value' in el && !privateField(el) ? String((el as HTMLInputElement).value).slice(0, 60) : undefined;
    items.push({ id: items.length + 1, role, label, value, el, offscreen: offscreen || undefined });
  }
  items.sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
  items.forEach((it, i) => (it.id = i + 1));
  return items;
}
