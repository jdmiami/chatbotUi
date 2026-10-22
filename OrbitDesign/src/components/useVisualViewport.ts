import { useEffect, useRef } from 'react';

/**
 * Tracks the *visual* viewport, which on iOS Safari shrinks when the on-screen keyboard opens
 * (the layout viewport does not). We publish:
 *   --app-height      visible height in px (the shell is sized to this)
 *   --vv-offset-top   how far iOS has scrolled the visual viewport (keeps the shell pinned)
 *   --keyboard-inset  approximate keyboard height
 * and calls `onChange` (optional) with the size and a `keyboardOpen` flag.
 * The source app's hook, with its store replaced by a callback.
 */
export function useVisualViewport(onChange?: (v: { width: number; height: number; keyboardOpen: boolean }) => void) {
  // The latest callback, read inside the effect, so a new function each render never re-subscribes.
  const latest = useRef(onChange);
  latest.current = onChange;
  const setViewport = (v: { width: number; height: number; keyboardOpen: boolean }) => latest.current?.(v);

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
  }, []);
}

/** Height of Safari 26's floating bar above the iPhone keyboard (AutoFill, hide keyboard), with its margin. */
const FLOATING_BAR = 76;
const floatingKeyboardBar =
  typeof navigator !== 'undefined' &&
  /iPhone/.test(navigator.userAgent) &&
  Number(navigator.userAgent.match(/Version\/(\d+)/)?.[1] ?? 0) >= 26;

function isEditableFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
