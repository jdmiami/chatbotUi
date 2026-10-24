import type { MotionLevel } from '../../motion/level';

/**
 * The orb's little shows of light, drawn just under it: a ring of light around what you picked (it
 * stays on the thing as it slides away) and a burst of sparks where the orb nods. Transform and
 * opacity only, so they stay smooth on a phone; nothing at all with Motion off.
 */

function layer(): HTMLElement {
  let el = document.querySelector<HTMLElement>('.orb-fx');
  if (!el) {
    el = document.createElement('div');
    el.className = 'orb-fx';
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
  }
  return el;
}

/** A ring of light around `target` that swells and fades (it follows the element while it moves). */
export function ringAround(target: Element, level: MotionLevel, ms = 720): Promise<void> {
  if (level === 'off' || !target.isConnected || typeof Element.prototype.animate !== 'function') return Promise.resolve();
  const r0 = target.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.className = 'orb-fx-ring';
  const pad = 5;
  const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
  ring.style.width = `${r0.width + pad * 2}px`;
  ring.style.height = `${r0.height + pad * 2}px`;
  ring.style.borderRadius = `${radius + pad}px`;
  const place = (r: DOMRect) => (ring.style.translate = `${r.left - pad}px ${r.top - pad}px`);
  place(r0);
  layer().append(ring);
  let raf = 0;
  const follow = () => {
    // The step it was on went away: the ring goes with it, quickly.
    if (!target.isConnected) return anim.updatePlaybackRate(4);
    place(target.getBoundingClientRect());
    raf = requestAnimationFrame(follow);
  };
  raf = requestAnimationFrame(follow);
  const full = level === 'full';
  const anim: Animation = ring.animate(
    full
      ? [
          { opacity: 0, transform: 'scale(0.96)' },
          { opacity: 1, transform: 'scale(1.015)', offset: 0.3 },
          { opacity: 0.85, transform: 'scale(1)', offset: 0.55 },
          { opacity: 0, transform: 'scale(1.05)' },
        ]
      : [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }],
    { duration: full ? ms : ms * 0.6, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
  return anim.finished
    .catch(() => undefined)
    .then(() => {
      cancelAnimationFrame(raf);
      ring.remove();
    });
}

/** A burst of sparks from (x, y): Full only. */
export function sparks(x: number, y: number, level: MotionLevel, count = 9) {
  if (level !== 'full' || typeof Element.prototype.animate !== 'function') return;
  const host = layer();
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'orb-fx-spark';
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    host.append(s);
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const d = 30 + Math.random() * 26;
    const size = 0.6 + Math.random() * 0.7;
    s.animate(
      [
        { opacity: 1, transform: `translate(-50%, -50%) translate(0px, 0px) scale(${size})` },
        { opacity: 0, transform: `translate(-50%, -50%) translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0.2)` },
      ],
      { duration: 520 + Math.random() * 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    ).finished.then(
      () => s.remove(),
      () => s.remove(),
    );
  }
}

/** The picked element itself swells a little, once. */
export function pulse(target: Element, level: MotionLevel) {
  if (level === 'off' || !(target instanceof HTMLElement)) return;
  target.setAttribute('data-orb-approved', '');
  window.setTimeout(() => target.removeAttribute('data-orb-approved'), 560);
}
