import { useRef } from 'react';
import { useMotionLevel } from '../../motion/MotionProvider';
import { homeCancel, homeDrag } from '../../motion/morph';
import { useShell, type AppId } from '../../state/shell';
import { useLayout } from '../../state/viewport';
import { folioOf } from './IndexMenu';

/**
 * Orbit 0.5 has no dock: one thin line at the bottom. Tap it for the index; inside an app, swipe it
 * up to go home (the app's folio sits over it, "04 · Terminal"). It steps aside while the keyboard is open.
 */
export function Handle() {
  const { activeApp, overlay, split, setOverlay } = useShell();
  const layout = useLayout();
  const splitShowing = split.enabled && layout.canSplit && activeApp !== null && (activeApp === split.left || activeApp === split.right);
  const swipe = useSwipeHome(activeApp, splitShowing, useShell.getState().goHome);
  return (
    <button
      type="button"
      className="o5-handle"
      data-home={activeApp === null}
      data-hidden={layout.keyboardOpen || overlay === 'index'}
      aria-label={activeApp ? 'Index. Swipe up to go home.' : 'Index'}
      aria-expanded={overlay === 'index'}
      onClick={() => setOverlay('index')}
      {...swipe}
    >
      {activeApp === null && <span className="o5-handle-word">Index</span>}
      {/* Inside an app: the folio, as at the foot of a magazine page. */}
      {activeApp !== null && folioOf(activeApp) && <span className="o5-handle-word o5-folio" aria-hidden>{folioOf(activeApp)}</span>}
      <span className="o5-handle-line" aria-hidden />
    </button>
  );
}

/**
 * Swipe up on the line to go home (MOTION.md §4): the app follows your finger, shrinking; let go
 * quickly or far enough and it goes home, otherwise it springs back.
 */
function useSwipeHome(activeApp: AppId | null, splitShowing: boolean, goHome: () => void) {
  const level = useMotionLevel();
  const swallowClick = useRef(false);
  const enabled = level === 'full' && activeApp !== null && !splitShowing;

  return {
    onPointerDown(e: React.PointerEvent) {
      swallowClick.current = false;
      if (!enabled || e.button > 0) return;
      // Follow this finger anywhere on screen: it leaves the line almost at once.
      const id = e.pointerId;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let y = y0;
      let t = e.timeStamp;
      let v = 0;
      let el: HTMLElement | null = null;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        const up = y0 - ev.clientY;
        if (!el) {
          if (up < 10 || Math.abs(ev.clientX - x0) > up) return;
          el = document.querySelector<HTMLElement>(`.app-window[data-app="${activeApp}"]`);
          if (!el) return end();
        }
        const dt = Math.max(1, ev.timeStamp - t);
        // Smooth the speed a little so one jittery sample doesn't decide the throw.
        v = v * 0.4 + ((y - ev.clientY) / dt) * 0.6;
        y = ev.clientY;
        t = ev.timeStamp;
        homeDrag(el, up);
      };
      const release = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        end();
        if (!el) return;
        swallowClick.current = true;
        const up = y0 - (ev.type === 'pointercancel' ? y : ev.clientY);
        // A stale sample (finger held still before letting go) means no throw.
        const speed = ev.type === 'pointercancel' || ev.timeStamp - t > 80 ? 0 : v;
        if (ev.type !== 'pointercancel' && (speed > 0.45 || up > el.offsetHeight * 0.22)) goHome();
        else void homeCancel(el, up, -speed);
      };
      const end = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', release);
        removeEventListener('pointercancel', release);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', release);
      addEventListener('pointercancel', release);
    },
    onClickCapture(e: React.MouseEvent) {
      if (swallowClick.current) {
        swallowClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}
