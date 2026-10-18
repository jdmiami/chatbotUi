import { useEffect } from 'react';

/** The machine banners that step aside while you type. */
const BANNERS = '.app-window :is(.ai-banner, .sr-helper)';
/** A soft, settled ease: quick to start, long gentle landing. */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function calm() {
  const motion = document.documentElement.dataset.motion;
  return motion === 'off' || motion === 'reduce' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** The banner's height folds to nothing (and the gap after it closes too), fading as it goes. */
function folded(el: HTMLElement) {
  const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const gap = parent && /flex|grid/.test(parent.display) ? parseFloat(parent.rowGap) || 0 : 0;
  return { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: `${-gap}px`, borderTopWidth: '0px', borderBottomWidth: '0px', opacity: 0, transform: 'translateY(-6px)' };
}
function open(el: HTMLElement) {
  const s = getComputedStyle(el);
  return { height: `${el.offsetHeight}px`, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, marginTop: s.marginTop, marginBottom: s.marginBottom, borderTopWidth: s.borderTopWidth, borderBottomWidth: s.borderBottomWidth, opacity: 1, transform: 'none' };
}

function foldAway(root: HTMLElement) {
  const els = calm() ? [] : [...document.querySelectorAll<HTMLElement>(BANNERS)].filter((el) => el.offsetHeight > 0);
  for (const el of els) {
    el.dataset.folding = '';
    const a = el.animate([{ ...open(el), overflow: 'hidden' }, { ...folded(el), overflow: 'hidden' }], { duration: 340, easing: EASE, fill: 'forwards' });
    const done = () => {
      delete el.dataset.folding;
      a.cancel();
    };
    a.onfinish = done;
    a.oncancel = () => delete el.dataset.folding;
  }
  root.dataset.typing = '';
}

function foldBack(root: HTMLElement) {
  delete root.dataset.typing;
  if (calm()) return;
  for (const el of document.querySelectorAll<HTMLElement>(BANNERS)) {
    for (const a of el.getAnimations()) a.cancel();
    if (!el.offsetHeight) continue;
    el.animate([{ ...folded(el), overflow: 'hidden' }, { ...open(el), overflow: 'hidden' }], { duration: 420, easing: EASE });
  }
}

/** Text boxes in an app (not the orb's own, not editors that draw their own caret). */
function isTextBox(el: Element | null): boolean {
  if (!el || !el.closest('.app-window')) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * While you type in an app, <html data-typing> lets the machine banners at the top step aside so
 * what you write stays in view: they fold away and back smoothly. When you leave the box they come back only after a quiet moment
 * (no taps or keys for 600 ms): popping back mid-tap would push the page down under your finger
 * and the tap would land on the wrong thing.
 */
export function useTyping() {
  useEffect(() => {
    const root = document.documentElement;
    let timer = 0;
    let pending = false;
    const settle = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        pending = false;
        if (!isTextBox(document.activeElement) && 'typing' in root.dataset) foldBack(root);
      }, 600);
    };
    const onIn = (e: FocusEvent) => {
      if (!isTextBox(e.target as Element)) return;
      clearTimeout(timer);
      pending = false;
      if (!('typing' in root.dataset)) foldAway(root);
    };
    const onOut = () => {
      if (!('typing' in root.dataset)) return;
      pending = true;
      settle();
    };
    // Any tap or key while it is about to come back starts the quiet moment again.
    const onActivity = () => pending && settle();
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    window.addEventListener('pointerdown', onActivity, true);
    window.addEventListener('keydown', onActivity, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      window.removeEventListener('pointerdown', onActivity, true);
      window.removeEventListener('keydown', onActivity, true);
      delete root.dataset.typing;
    };
  }, []);
}
