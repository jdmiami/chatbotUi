import { useRef } from 'react';
import { APPS, AppGlyph } from '../apps/registry';
import { useMotionLevel } from '../motion/MotionProvider';
import { homeCancel, homeDrag, homeFling } from '../motion/morph';
import { useShell, type AppId } from '../state/shell';
import { useLayout } from '../state/viewport';
import { Icon } from '../ui/Icon';

const DOCK_APPS: AppId[] = ['terminal', 'editor', 'agent', 'ai'];

/**
 * Persistent floating dock. Visible on the home screen and inside apps (it is the visible
 * alternative to gestures: Home, app launch, App Switcher, Control Center). It slides away while
 * the on-screen keyboard is open so the terminal prompt / chat composer stay visible.
 */
export function Dock() {
  const { activeApp, openApps, overlay, split, launch, goHome, toggleOverlay, openSplit, setSplit } = useShell();
  const layout = useLayout();
  const glyph = layout.compact ? 40 : 46;
  const splitShowing =
    split.enabled && layout.canSplit && activeApp !== null && (activeApp === split.left || activeApp === split.right);

  const swipe = useSwipeHome(activeApp, splitShowing, goHome);

  return (
    <nav className="dock glass" aria-label="Dock" data-hidden={layout.keyboardOpen} {...swipe}>
      {activeApp !== null && (
        <button type="button" className="dock-item util" onClick={goHome} aria-label="Home screen" title="Home">
          <span className="glyph" style={{ width: glyph, height: glyph }}>
            <Icon name="home" />
          </span>
        </button>
      )}
      {DOCK_APPS.map((id) => {
        const app = APPS[id];
        const current = activeApp === id || (splitShowing && (id === split.left || id === split.right));
        const running = openApps.includes(id);
        return (
          <button
            key={id}
            type="button"
            className="dock-item"
            data-app-id={id}
            onClick={() => launch(id)}
            aria-label={`${app.name}${running ? ' (open)' : ''}`}
            aria-current={current ? 'true' : undefined}
            data-running={running && !current}
            title={app.name}
          >
            <AppGlyph app={app} size={glyph} />
          </button>
        );
      })}
      <span className="dock-sep" aria-hidden />
      {layout.canSplit && (
        <button
          type="button"
          className="dock-item util"
          onClick={() => (splitShowing ? setSplit({ enabled: false }) : openSplit())}
          aria-label={splitShowing ? 'Leave Code and Chat split view' : 'Open Code and Chat side by side'}
          aria-pressed={splitShowing}
          title="Code + Chat split view"
        >
          <span
            className="glyph"
            style={{
              width: glyph,
              height: glyph,
              ...(splitShowing ? { background: 'var(--accent)', color: 'var(--on-accent)' } : {}),
            }}
          >
            <Icon name="split" />
          </span>
        </button>
      )}
      <button
        type="button"
        className="dock-item util"
        onClick={() => toggleOverlay('switcher')}
        aria-label="App Switcher"
        aria-pressed={overlay === 'switcher'}
        title="App Switcher"
      >
        <span className="glyph" style={{ width: glyph, height: glyph }}>
          <Icon name="switcher" />
        </span>
      </button>
      <button
        type="button"
        className="dock-item util"
        onClick={() => toggleOverlay('control-center')}
        aria-label="Control Center"
        aria-pressed={overlay === 'control-center'}
        title="Control Center"
      >
        <span className="glyph" style={{ width: glyph, height: glyph }}>
          <Icon name="sliders" />
        </span>
      </button>
    </nav>
  );
}

/**
 * Swipe up on the dock to go home (MOTION.md §4): the app follows your finger, shrinking; let go
 * quickly or far enough and it flies into its icon at your finger's speed, otherwise it springs back.
 */
function useSwipeHome(activeApp: AppId | null, splitShowing: boolean, goHome: () => void) {
  const level = useMotionLevel();
  const swallowClick = useRef(false);
  const enabled = level === 'full' && activeApp !== null && !splitShowing;

  return {
    onPointerDown(e: React.PointerEvent) {
      swallowClick.current = false;
      if (!enabled || e.button > 0) return;
      // Follow this finger anywhere on screen: it leaves the dock almost at once.
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
        if (ev.type !== 'pointercancel' && (speed > 0.45 || up > el.offsetHeight * 0.22)) {
          homeFling(el, up, Math.max(0, speed));
          goHome();
        } else void homeCancel(el, up, -speed);
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
