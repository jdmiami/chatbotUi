import { useEffect, type RefObject } from 'react';
import { useMotionLevel } from '../../motion/MotionProvider';

/**
 * Scroll depth for Orbit 0.5: every [data-depth] child of the scroller gets --p, how far it is from
 * the middle of the screen (-1 above … 0 centred … 1 below). CSS turns that into depth: pages sink
 * back and soften as they leave. Off at Motion "Off"; CSS keeps Lite to a gentle fade.
 */
export function useScrollDepth(scroller: RefObject<HTMLElement | null>, enabled = true) {
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
        const p = Math.max(-1, Math.min(1, (r.top + Math.min(r.height, box.height) / 2 - mid) / box.height));
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
  }, [scroller, enabled, level]);
}
