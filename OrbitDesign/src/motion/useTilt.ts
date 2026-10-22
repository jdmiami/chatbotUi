import { useCallback, useRef, type PointerEvent } from 'react';
import { useMotionLevel } from './MotionProvider';

/**
 * Cards lean toward your finger (or the mouse) a few degrees and spring back on release.
 * It only writes two CSS variables; the .tilt class in motion.css does the rest.
 */
export function useTilt(maxDeg = 7) {
  const level = useMotionLevel();
  const frame = useRef(0);

  const move = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (level !== 'full') return;
      const el = e.currentTarget;
      const { clientX, clientY } = e;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (clientX - r.left) / r.width - 0.5;
        const y = (clientY - r.top) / r.height - 0.5;
        el.dataset.tilting = 'true';
        el.style.setProperty('--ry', `${(x * maxDeg * 2).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${(-y * maxDeg * 2).toFixed(2)}deg`);
      });
    },
    [level, maxDeg],
  );

  const reset = useCallback((e: PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(frame.current);
    const el = e.currentTarget;
    el.dataset.tilting = 'false';
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }, []);

  return {
    className: 'tilt',
    onPointerDown: move,
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' || e.buttons) move(e);
    },
    onPointerUp: reset,
    onPointerLeave: reset,
    onPointerCancel: reset,
  };
}
