import { APPS, AppGlyph } from '../apps/registry';
import { useShell, type AppId } from '../state/shell';
import { useLayout } from '../state/viewport';
import { Icon } from '../ui/Icon';

const DOCK_APPS: AppId[] = ['terminal', 'editor', 'agent'];

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

  return (
    <nav className="dock glass" aria-label="Dock" data-hidden={layout.keyboardOpen}>
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
