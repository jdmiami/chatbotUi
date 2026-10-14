import { useShell } from '../state/shell';
import { Sheet } from '../ui/components';

/** First-run disclosure: what is simulated and where data is stored. */
export function IntroSheet() {
  const updateSettings = useShell((s) => s.updateSettings);
  const done = () => updateSettings({ introSeen: true });
  return (
    <Sheet title="Welcome to Orbit (demo)" onClose={done}>
      <div className="stack">
        <p style={{ margin: 0 }}>
          This is the Phase 1 prototype. It is <strong>not connected to an Ubuntu machine</strong> yet.
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>
            <strong>Terminal</strong> runs a simulated shell inside this browser. Commands never reach a server.
          </li>
          <li>
            <strong>Code</strong> edits a sample project saved in this browser&apos;s storage. It does not sync to your
            other devices, and Safari can clear it if you don&apos;t visit for a long time.
          </li>
          <li>
            <strong>Antigravity</strong> shows sample sessions and canned replies. The real Antigravity CLI is not
            called.
          </li>
        </ul>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
          Tip: in Safari, Share → Add to Home Screen opens Orbit full screen without the browser toolbar.
        </p>
        <button type="button" className="btn primary block" onClick={done}>
          Got it
        </button>
      </div>
    </Sheet>
  );
}
