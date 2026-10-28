import { useEffect } from 'react';
import { useViewportStore } from '../state/viewport';

/**
 * Tracks the *visual* viewport, which on iOS Safari shrinks when the on-screen keyboard opens
 * (the layout viewport does not). We publish:
 *   --app-height      visible height in px (the shell is sized to this)
 *   --vv-offset-top   how far iOS has scrolled the visual viewport (keeps the shell pinned)
 *   --keyboard-inset  approximate keyboard height
 * and a `keyboardOpen` flag in the viewport store (the dock hides while typing).
 */
export function useVisualViewport() {
  const setViewport = useViewportStore((s) => s.set);

  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visible = vv?.height ?? window.innerHeight;
        const offsetTop = vv?.offsetTop ?? 0;
        const layoutHeight = window.innerHeight;
        const keyboard = Math.max(0, layoutHeight - visible - offsetTop);
        // A soft keyboard is at least ~150px; smaller differences are browser chrome changing.
        const editing = isEditableFocused();
        const keyboardOpen = keyboard > 150 || (editing && isCoarsePointer() && visible < layoutHeight * 0.75);
        // Safari 26 on iPhone floats its AutoFill and hide-keyboard buttons over the bottom of the
        // page, just above the keyboard: keep what you type (and the composer's buttons) above them.
        const covered = keyboardOpen && floatingKeyboardBar ? FLOATING_BAR : 0;
        const height = visible - covered;
        root.style.setProperty('--app-height', `${Math.round(height)}px`);
        root.style.setProperty('--vv-offset-top', `${Math.round(offsetTop)}px`);
        root.style.setProperty('--keyboard-inset', `${Math.round(keyboard + covered)}px`);
        setViewport({
          width: Math.round(window.innerWidth),
          height: Math.round(height),
          keyboardOpen,
        });
        // What you type always comes first: once the keyboard is up (and the layout has shrunk to
        // the space above it), bring the box being typed in back into view wherever it is.
        if (keyboardOpen && editing) keepInView(document.activeElement as HTMLElement);
      });
    };

    // iOS may scroll even overflow:hidden boxes to reveal a focused input under the keyboard,
    // which leaves part of the app shifted out of view. Those boxes never scroll on purpose,
    // so put them straight back.
    const unshift = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.scrollTop === 0) return;
      if (getComputedStyle(el).overflowY === 'hidden') el.scrollTop = 0;
    };
    document.addEventListener('scroll', unshift, true);

    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', unshift, true);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [setViewport]);
}

/** Height of Safari 26's floating bar above the iPhone keyboard (AutoFill, hide keyboard), with its margin. */
const FLOATING_BAR = 76;
const floatingKeyboardBar =
  typeof navigator !== 'undefined' &&
  /iPhone/.test(navigator.userAgent) &&
  Number(navigator.userAgent.match(/Version\/(\d+)/)?.[1] ?? 0) >= 26;

let keepTimer = 0;
/** Scroll the box being typed in into view, after the keyboard has finished arriving (it animates in). */
function keepInView(el: HTMLElement) {
  clearTimeout(keepTimer);
  keepTimer = window.setTimeout(() => {
    if (document.activeElement !== el) return;
    const r = el.getBoundingClientRect();
    const seen = window.visualViewport?.height ?? window.innerHeight;
    if (r.top >= 0 && r.bottom <= seen) return;
    el.scrollIntoView({ block: r.height > seen * 0.6 ? 'start' : 'center', behavior: 'smooth' });
  }, 320);
}

function isEditableFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
