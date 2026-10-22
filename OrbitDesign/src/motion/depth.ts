import { useEffect, type RefObject } from 'react';
import { useMotionLevel } from './MotionProvider';

/**
 * Scroll depth (Orbit 0.5): every [data-depth] child of the scroller gets --p, how far it is from
 * the middle of the screen (-1 above … 0 centred … 1 below). CSS turns that into depth: pages sink
 * back and soften as they leave. Off at Motion "Off"; CSS keeps Lite to a gentle fade.
 */
export function useScrollDepth(
  scroller: RefObject<HTMLElement | null>,
  enabled = true,
  /**
   * 'center': pages a screen tall (the home) sink as they leave the middle. 'edges': shorter
   * sections (page sheets) stay crisp while in full view and sink only as they slide off an edge.
   */
  mode: 'center' | 'edges' = 'center',
) {
  const level = useMotionLevel();
  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled || level === 'off') return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const mid = box.top + box.height / 2;
      for (const child of el.querySelectorAll<HTMLElement>('[data-depth]')) {
        const r = child.getBoundingClientRect();
        // A page taller than the screen (a phone on its side) stays put while it fills the screen,
        // and only sinks once its top or bottom edge comes into view; otherwise reading its lower
        // half would blur it and push its last links down under the Index handle.
        const raw =
          mode === 'edges'
            ? r.top < box.top && r.bottom < box.bottom
              ? (r.top - box.top) / box.height
              : r.bottom > box.bottom && r.top > box.top
                ? (r.bottom - box.bottom) / box.height
                : 0
            : r.height < box.height
            ? (r.top + r.height / 2 - mid) / box.height
            : r.top > box.top
              ? (r.top - box.top) / box.height
              : r.bottom < box.bottom
                ? (r.bottom - box.bottom) / box.height
                : 0;
        const p = Math.max(-1, Math.min(1, raw));
        child.style.setProperty('--p', p.toFixed(3));
        child.style.setProperty('--ap', Math.abs(p).toFixed(3));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      for (const child of el.querySelectorAll<HTMLElement>('[data-depth]')) {
        child.style.removeProperty('--p');
        child.style.removeProperty('--ap');
      }
    };
  }, [scroller, enabled, level, mode]);
}
