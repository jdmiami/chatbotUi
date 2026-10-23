import { useEffect } from 'react';

/**
 * Orbit 0.5 keeps the screen for the content: scrolling down inside an app tucks its header away,
 * scrolling back up (or reaching the top) brings it back. Marked on the app window as data-chrome.
 */
export function useChromeOnScroll() {
  useEffect(() => {
    const last = new WeakMap<Element, number>();
    // Only your own scrolling hides things: an app following a reply, or opening at the bottom, doesn't.
    // …and only in the place you're scrolling: the scroll must contain where your input went.
    let userAt = 0;
    let userTarget: Node | null = null;
    const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
    const user = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (!SCROLL_KEYS.has(e.key)) return;
        // Space or arrows on a control press it or move inside it; they don't scroll the page.
        if ((e.target as Element | null)?.closest?.('button, a, input, textarea, select, [role="slider"], [contenteditable="true"]')) return;
      }
      userAt = performance.now();
      userTarget = e.target instanceof Node ? e.target : null;
    };
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (performance.now() - userAt > 600 || !userTarget || !el.contains(userTarget)) {
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
  }, []);
}
