import { privateField } from './agent';

/**
 * What is on screen, for the orb to understand and explain: the visible text in reading order and
 * the biggest pictures. Passwords, private boxes ([data-private]) and the orb's own UI are left out.
 */

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

/** Up to `n` of the biggest pictures on screen, as small JPEG data URLs (skips ones the browser won't share). */
export async function screenPictures(n = 2, size = 768): Promise<string[]> {
  const vw = window.innerWidth, vh = window.innerHeight;
  const els = [...document.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLCanvasElement>('img, video, canvas')]
    .filter((el) => !el.closest(SKIP) && !el.closest('.orb-cursor'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => visible(r, vw, vh) && r.width >= 120 && r.height >= 120)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  const out: string[] = [];
  for (const { el } of els) {
    if (out.length >= n) break;
    const w = el instanceof HTMLImageElement ? el.naturalWidth : el instanceof HTMLVideoElement ? el.videoWidth : el.width;
    const h = el instanceof HTMLImageElement ? el.naturalHeight : el instanceof HTMLVideoElement ? el.videoHeight : el.height;
    if (!w || !h) continue;
    const k = Math.min(1, size / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    try {
      c.getContext('2d')?.drawImage(el, 0, 0, c.width, c.height);
      out.push(c.toDataURL('image/jpeg', 0.8));
    } catch {
      /* from another site without permission: skip */
    }
  }
  return out;
}

/** "Explain this", "what's on my screen", "summarise this page"… */
export function isExplain(goal: string): boolean {
  return /\b(explain|summari[sz]e|tl;?dr|describe|read (this|it)|what('s| is| does)\b.*\b(this|that|screen|page|here|mean|say|it)\b|what am i (looking at|seeing))/i.test(goal);
}

export const EXPLAIN_PROMPT =
  'You are the orb in Orbit, a web workspace. You see what is on the owner\'s screen (its text, and sometimes pictures). ' +
  'Answer their question about it in plain, friendly language: 2 to 5 short sentences, no jargon, no markdown headings. ' +
  'If something looks wrong (an error, a warning), say what it means and one thing to try. Never repeat passwords or keys.';
