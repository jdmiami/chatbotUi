import { useShell } from '../../state/shell';
import { useLayout } from '../../state/viewport';
import { useSwipeHome } from '../Dock';
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
