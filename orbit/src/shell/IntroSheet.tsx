import { connection } from '../services';
import { useShell } from '../state/shell';
import { Sheet } from '../ui/components';

/** First-run disclosure: what is simulated and where data is stored. */
export function IntroSheet() {
  const updateSettings = useShell((s) => s.updateSettings);
  const done = () => updateSettings({ introSeen: true });
  if (connection.mode === 'host') {
    return (
      <Sheet title="Welcome to Orbit" onClose={done}>
        <div className="stack">
          <p style={{ margin: 0 }}>
            You&apos;re connected to your <strong>Linux machine</strong>. Everything here is real:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
            <li>
              <strong>Terminal</strong> is a real shell on the machine. It keeps running in tmux when you leave, so you
              can pick up on your iPhone or iPad.
            </li>
            <li>
              <strong>Code</strong> edits your files in <span className="mono">~/projects</span> on the machine&apos;s
              saved storage.
            </li>
            <li>
              <strong>Antigravity</strong> runs the real Antigravity CLI. The first time, open Terminal and run{' '}
              <span className="mono">agy</span> to sign in.
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
  return (
    <Sheet title="Welcome to Orbit (demo)" onClose={done}>
      <div className="stack">
        <p style={{ margin: 0 }}>
          Orbit is in demo mode: it is <strong>not connected to your Linux machine</strong>.
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
