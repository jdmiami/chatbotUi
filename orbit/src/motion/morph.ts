import { animate } from 'motion/mini';
import type { MotionLevel } from './level';
import { SPRING } from './springs';

/**
 * Apps grow out of the icon you tapped and shrink back into it. It is a uniform scale (so text is
 * never squashed) plus a clip that crops the window down to the icon's shape.
 */

const live = new WeakMap<HTMLElement, { cancel(): void }>();

/** Belt and braces: if the browser scrolled a clipping parent to reveal a focused field mid-animation, undo it. */
function unscroll(el: HTMLElement) {
  for (let p: HTMLElement | null = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.scrollLeft || p.scrollTop) {
      if (p.classList.contains('shell') || p.classList.contains('app-host')) {
        p.scrollLeft = 0;
        p.scrollTop = 0;
      }
    }
  }
}

export function cancelMorph(el: HTMLElement) {
  unscroll(el);
  live.get(el)?.cancel();
  live.delete(el);
  for (const p of ['transform', 'opacity', 'clip-path', 'visibility', 'transform-origin']) el.style.removeProperty(p);
}

/** Where the icon for an app is on screen: its tile on the home screen, else its dock tile. */
export function iconRect(id: string): DOMRect | null {
  const pick = (sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
  };
  return pick(`.home:not([data-hidden='true']) [data-app-id="${id}"] .glyph`) ?? pick(`.dock [data-app-id="${id}"] .glyph`) ?? pick(`[data-app-id="${id}"] .glyph`);
}

function frame(el: HTMLElement, icon: DOMRect) {
  const win = el.getBoundingClientRect();
  const s = Math.min(1, icon.width / win.width);
  // Translate so the window's top-left lands where the icon's top-left is (after scaling about 0 0).
  const tx = icon.left - win.left;
  const ty = icon.top - win.top;
  const cropBottom = Math.max(0, win.height - icon.height / s);
  const radius = Math.round(icon.width * 0.225 / s);
  return {
    transform: `translate(${tx}px, ${ty}px) scale(${s})`,
    clip: `inset(0px 0px ${cropBottom}px 0px round ${radius}px)`,
  };
}

const OPEN = { clip: 'inset(0px 0px 0px 0px round 0px)', transform: 'translate(0px, 0px) scale(1)' };

async function run(el: HTMLElement, keyframes: Record<string, string[] | number[]>, options: Parameters<typeof animate>[2]) {
  const controls = animate(el, keyframes as never, options);
  live.set(el, controls as unknown as { cancel(): void });
  try {
    await controls;
  } catch {
    /* cancelled by a newer animation */
  }
}

export async function morphIn(el: HTMLElement, id: string, level: MotionLevel) {
  cancelMorph(el);
  if (level === 'off') return;
  const icon = iconRect(id);
  if (level === 'full' && icon) {
    const from = frame(el, icon);
    el.style.transformOrigin = '0 0';
    await run(
      el,
      { transform: [from.transform, OPEN.transform], clipPath: [from.clip, OPEN.clip], opacity: [0.2, 1, 1] },
      { ...SPRING.gentle, opacity: { duration: 0.18 } },
    );
  } else {
    await run(el, { opacity: [0, 1], transform: ['scale(0.97)', 'scale(1)'] }, { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] });
  }
  cancelMorph(el);
}

/** Close into the icon (going home) or just ease away (another app is taking over). */
export async function morphOut(el: HTMLElement, id: string, level: MotionLevel, toIcon: boolean) {
  cancelMorph(el);
  if (level === 'off') return;
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  const icon = toIcon ? iconRect(id) : null;
  if (level === 'full' && icon) {
    const to = frame(el, icon);
    el.style.transformOrigin = '0 0';
    await run(
      el,
      { transform: [OPEN.transform, to.transform], clipPath: [OPEN.clip, to.clip], opacity: [1, 1, 0] },
      { ...SPRING.snappy, opacity: { duration: 0.26, times: [0, 0.7, 1] } },
    );
  } else {
    await run(el, { opacity: [1, 0], transform: ['scale(1)', 'scale(0.97)'] }, { duration: 0.16, ease: 'easeIn' });
  }
  cancelMorph(el);
}
