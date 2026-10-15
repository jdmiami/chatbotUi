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
        const height = vv?.height ?? window.innerHeight;
        const offsetTop = vv?.offsetTop ?? 0;
        const layoutHeight = window.innerHeight;
        const keyboard = Math.max(0, layoutHeight - height - offsetTop);
        root.style.setProperty('--app-height', `${Math.round(height)}px`);
        root.style.setProperty('--vv-offset-top', `${Math.round(offsetTop)}px`);
        root.style.setProperty('--keyboard-inset', `${Math.round(keyboard)}px`);
        // A soft keyboard is at least ~150px; smaller differences are browser chrome changing.
        const editing = isEditableFocused();
        setViewport({
          width: Math.round(window.innerWidth),
          height: Math.round(height),
          keyboardOpen: keyboard > 150 || (editing && isCoarsePointer() && height < layoutHeight * 0.75),
        });
      });
    };

    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [setViewport]);
}

function isEditableFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
