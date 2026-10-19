import { animate } from 'motion/mini';
import type { MotionLevel } from './level';
import { springValue } from './physics';
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
  for (const p of ['transform', 'opacity', 'clip-path', 'visibility', 'transform-origin', 'filter']) el.style.removeProperty(p);
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
  if (level === 'off') {
    // Reduce Motion: nothing grows, but the app still cross-fades in so you see it arrive.
    await run(el, { opacity: [0, 1] }, { duration: 0.15, ease: 'easeOut' });
    return cancelMorph(el);
  }
  const icon = iconRect(id);
  if (level === 'full' && icon) {
    const from = frame(el, icon);
    el.style.transformOrigin = '0 0';
    await run(
      el,
      { transform: [from.transform, OPEN.transform], clipPath: [from.clip, OPEN.clip], opacity: [0.2, 1, 1] },
      { ...SPRING.default, opacity: { duration: 0.18 } },
    );
  } else {
    await run(el, { opacity: [0, 1], transform: ['scale(0.97)', 'scale(1)'] }, { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] });
  }
  cancelMorph(el);
}

/** Close into the icon (going home) or just ease away (another app is taking over). */
export async function morphOut(el: HTMLElement, id: string, level: MotionLevel, toIcon: boolean) {
  const fling = flung.get(el);
  flung.delete(el);
  cancelMorph(el);
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  if (level === 'off') {
    await run(el, { opacity: [1, 0] }, { duration: 0.15, ease: 'easeOut' });
    return cancelMorph(el);
  }
  const icon = toIcon ? iconRect(id) : null;
  if (fling && icon && level === 'full') {
    await flyFromDrag(el, icon, fling);
    return cancelMorph(el);
  }
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

/* ---------------------------------------------------------------- Swipe up on the dock to go home
   The window follows your finger (shrinking towards the bottom), and when you let go it either
   flies into its icon at your finger's speed or springs back. Grabbing it again stops it mid-way. */

const RADIUS = 28;
const flung = new WeakMap<HTMLElement, { up: number; v: number }>();

/** The window's pose while dragged `up` pixels: scaled about its bottom centre, lifted a little. */
function dragPose(el: HTMLElement, up: number) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const s = Math.max(0.4, 1 - (up / h) * 0.9);
  return { tx: (w * (1 - s)) / 2, ty: h * (1 - s) - up * 0.35, s, crop: 0, r: RADIUS / s };
}

function apply(el: HTMLElement, p: { tx: number; ty: number; s: number; crop: number; r: number }) {
  el.style.transformOrigin = '0 0';
  el.style.transform = `translate(${p.tx}px, ${p.ty}px) scale(${p.s})`;
  el.style.clipPath = `inset(0px 0px ${p.crop}px 0px round ${p.r}px)`;
}

export function homeDrag(el: HTMLElement, up: number) {
  live.get(el)?.cancel();
  live.delete(el);
  apply(el, dragPose(el, Math.max(0, up)));
}

/** Let go fast or far enough: remember where it is and how fast, then the caller goes home. */
export function homeFling(el: HTMLElement, up: number, velocity: number) {
  flung.set(el, { up, v: velocity });
}

/** Let go too early: spring back to full size, starting at the finger's speed. */
export async function homeCancel(el: HTMLElement, up: number, velocity: number) {
  const anim = springValue({
    from: up,
    to: 0,
    velocity: velocity * 1000,
    spring: SPRING.flick,
    onUpdate: (u) => apply(el, dragPose(el, Math.max(0, u))),
  });
  live.set(el, { cancel: anim.stop });
  if (await anim.finished) cancelMorph(el);
}

function flyFromDrag(el: HTMLElement, icon: DOMRect, fling: { up: number; v: number }) {
  const a = dragPose(el, fling.up);
  const win = el.getBoundingClientRect();
  const s = Math.min(1, icon.width / win.width);
  const b = {
    tx: icon.left - win.left,
    ty: icon.top - win.top,
    s,
    crop: Math.max(0, win.height - icon.height / s),
    r: (icon.width * 0.225) / s,
  };
  // The finger's speed, as progress per second along the flight from here to the icon.
  apply(el, a);
  const dist = Math.max(40, Math.hypot(b.tx - a.tx, b.ty - a.ty));
  const lerp = (x: number, y: number, t: number) => x + (y - x) * t;
  const anim = springValue({
    from: 0,
    to: 1,
    velocity: Math.min(8, (fling.v * 1000) / dist),
    spring: SPRING.flick,
    onUpdate: (t) => {
      apply(el, { tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), s: lerp(a.s, b.s, t), crop: lerp(a.crop, b.crop, Math.min(1, t)), r: lerp(a.r, b.r, t) });
      el.style.opacity = String(Math.max(0, Math.min(1, (1 - t) / 0.2)));
    },
  });
  live.set(el, { cancel: anim.stop });
  return anim.finished;
}

/* ---------------------------------------------------------------- MagStyle: turning the page
   Going from one app straight to another turns the page: the new one swings in from the right edge
   (hinged on its left, like a leaf of paper) while the old one slides back and away. Lite keeps a
   short slide; Off a cross-fade. */

export async function pageTurnIn(el: HTMLElement, level: MotionLevel) {
  cancelMorph(el);
  if (level === 'off') {
    await run(el, { opacity: [0, 1] }, { duration: 0.15, ease: 'easeOut' });
    return cancelMorph(el);
  }
  el.style.transformOrigin = '0% 50%';
  if (level === 'full') {
    await run(
      el,
      {
        transform: ['perspective(1600px) translateX(22%) rotateY(-16deg)', 'perspective(1600px) translateX(0%) rotateY(0deg)'],
        opacity: [0, 1, 1],
        filter: ['brightness(1.12)', 'brightness(1)'],
      },
      { ...SPRING.default, opacity: { duration: 0.22, times: [0, 0.6, 1] }, filter: { duration: 0.5 } },
    );
  } else {
    await run(el, { transform: ['translateX(6%)', 'translateX(0%)'], opacity: [0, 1] }, { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] });
  }
  cancelMorph(el);
}

export async function pageTurnOut(el: HTMLElement, level: MotionLevel) {
  cancelMorph(el);
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  if (level === 'off') {
    await run(el, { opacity: [1, 0] }, { duration: 0.15, ease: 'easeOut' });
    return cancelMorph(el);
  }
  el.style.transformOrigin = '100% 50%';
  await run(
    el,
    level === 'full'
      ? { transform: ['perspective(1600px) translateX(0%) scale(1)', 'perspective(1600px) translateX(-14%) scale(0.94)'], opacity: [1, 0], filter: ['brightness(1)', 'brightness(0.7)'] }
      : { transform: ['translateX(0%)', 'translateX(-4%)'], opacity: [1, 0] },
    { duration: level === 'full' ? 0.42 : 0.2, ease: [0.4, 0, 0.2, 1] },
  );
  cancelMorph(el);
}
