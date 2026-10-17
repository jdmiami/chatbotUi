import { useEffect } from 'react';

/**
 * Orbit 0.5 keeps the screen for the content: scrolling down inside an app tucks its header away,
 * scrolling back up (or reaching the top) brings it back. Marked on the app window as data-chrome.
 */
export function useChromeOnScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const last = new WeakMap<Element, number>();
    // Only your own scrolling hides things: an app following a reply, or opening at the bottom, doesn't.
    let userAt = 0;
    const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
    const user = (e: Event) => {
      if (e instanceof KeyboardEvent && !SCROLL_KEYS.has(e.key)) return;
      userAt = performance.now();
    };
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (performance.now() - userAt > 600) {
        last.set(el, el.scrollTop);
        return;
      }
      const win = el.closest<HTMLElement>('.app-window');
      if (!win || el.scrollHeight - el.clientHeight < 160) return;
      const top = el.scrollTop;
      const prev = last.get(el) ?? 0;
      last.set(el, top);
      if (top < 24 || top - prev < -10) win.dataset.chrome = 'shown';
      else if (top - prev > 10) win.dataset.chrome = 'hidden';
    };
    const inputs = ['touchmove', 'wheel', 'keydown'] as const;
    for (const t of inputs) window.addEventListener(t, user, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      for (const t of inputs) window.removeEventListener(t, user, { capture: true });
      document.removeEventListener('scroll', onScroll, { capture: true });
      for (const w of document.querySelectorAll<HTMLElement>('.app-window[data-chrome]')) delete w.dataset.chrome;
    };
  }, [enabled]);
}
