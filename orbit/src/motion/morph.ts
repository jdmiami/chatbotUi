import { animate } from 'motion/mini';
import type { MotionLevel } from './level';
import { springValue } from './physics';
import { SPRING } from './springs';

/**
 * Apps ease in and out as they open and close (a short fade with a slight scale); going straight
 * from one app to another turns the page (below).
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

async function run(el: HTMLElement, keyframes: Record<string, string[] | number[]>, options: Parameters<typeof animate>[2]) {
  const controls = animate(el, keyframes as never, options);
  live.set(el, controls as unknown as { cancel(): void });
  try {
    await controls;
  } catch {
    /* cancelled by a newer animation */
  }
}

export async function morphIn(el: HTMLElement, level: MotionLevel) {
  cancelMorph(el);
  if (level === 'off') {
    // Reduce Motion: nothing moves, but the app still cross-fades in so you see it arrive.
    await run(el, { opacity: [0, 1] }, { duration: 0.15, ease: 'easeOut' });
    return cancelMorph(el);
  }
  await run(el, { opacity: [0, 1], transform: ['scale(0.97)', 'scale(1)'] }, { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] });
  cancelMorph(el);
}

/** Ease away (going home, or another app is taking over). */
export async function morphOut(el: HTMLElement, level: MotionLevel) {
  cancelMorph(el);
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  if (level === 'off') {
    await run(el, { opacity: [1, 0] }, { duration: 0.15, ease: 'easeOut' });
    return cancelMorph(el);
  }
  await run(el, { opacity: [1, 0], transform: ['scale(1)', 'scale(0.97)'] }, { duration: 0.16, ease: 'easeIn' });
  cancelMorph(el);
}

/* ---------------------------------------------------------------- Swipe up on the line to go home
   The window follows your finger (shrinking towards the bottom), and when you let go it either
   goes home or springs back. Grabbing it again stops it mid-way. */

const RADIUS = 28;

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
