import { useState } from 'react';
import { APPS, AppGlyph } from '../apps/registry';
import { connection } from '../services';
import { useShell, APP_ORDER } from '../state/shell';
import { useLayout } from '../state/viewport';
import { useWorkspace } from '../state/workspace';
import { Icon } from '../ui/Icon';
import { IconButton, Sheet } from '../ui/components';
import { useTilt } from '../motion/useTilt';

/** Home screen: launch apps and resume recent work. No invented health/metrics, only real local data. */
export function HomeScreen({ hidden }: { hidden: boolean }) {
  const { launch, toggleOverlay, openSplit } = useShell();
  const layout = useLayout();
  const { recentFiles, recentSessions, sendIntent } = useWorkspace();
  const [showConnection, setShowConnection] = useState(false);
  const tilt = useTilt(5);

  return (
    <>
      <div className="shell-topbar" data-hidden={hidden} style={hidden ? { visibility: 'hidden' } : undefined}>
        <span className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={26} height={26} style={{ borderRadius: 7 }} />
          Orbit
        </span>
        <button
          type="button"
          className={`chip ${connection.mode === 'host' ? 'ok' : 'demo'}`}
          onClick={() => setShowConnection(true)}
          aria-label={`${connection.label}. ${connection.mode === 'host' ? 'Connected.' : 'Not connected to your Linux machine.'} Show details.`}
        >
          <span className="dot" aria-hidden />
          {connection.label}
        </button>
        <IconButton icon="sliders" label="Control Center" onClick={() => toggleOverlay('control-center')} />
      </div>

      <main className="home" data-hidden={hidden} aria-hidden={hidden} inert={hidden || undefined}>
        <div className="home-inner">
          <section aria-label="Apps">
            <div className="home-grid">
              {APP_ORDER.map((id) => {
                const app = APPS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className="app-icon"
                    data-app-id={id}
                    style={{ '--i': APP_ORDER.indexOf(id) } as React.CSSProperties}
                    onClick={() => launch(id)}
                    aria-label={`${app.name}. ${app.description}`}
                  >
                    <AppGlyph app={app} />
                    <span className="label" aria-hidden>
                      {app.name}
                    </span>
                  </button>
                );
              })}
              {layout.canSplit && (
                <button
                  type="button"
                  className="app-icon"
                  onClick={openSplit}
                  aria-label="Code and Chat. Open the editor and Antigravity side by side."
                >
                  <span
                    className="glyph"
                    style={{ background: 'linear-gradient(145deg, #3a4bff 50%, #0fb39b 50%)', color: '#fff' }}
                    aria-hidden
                  >
                    <Icon name="split" size={32} strokeWidth={2} />
                  </span>
                  <span className="label" aria-hidden>
                    Code + Chat
                  </span>
                </button>
              )}
            </div>
          </section>

          <div className="widgets">
            <section {...tilt} className={`widget glass ${tilt.className}`} aria-labelledby="resume-files">
              <h2 id="resume-files">Recent files</h2>
              {recentFiles.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Files you open in Code appear here.
                </p>
              ) : (
                <div className="list" style={{ background: 'transparent', border: 0 }}>
                  {recentFiles.slice(0, 4).map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className="row"
                      onClick={() => {
                        sendIntent({ app: 'editor', type: 'open-file', path: f.path });
                        launch('editor');
                      }}
                    >
                      <Icon name="file" />
                      <span className="row-main">
                        <span className="row-title">{f.path.split('/').pop()}</span>
                        <span className="row-sub mono">{f.path}</span>
                      </span>
                      <Icon name="forward" size={18} />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section {...tilt} className={`widget glass ${tilt.className}`} aria-labelledby="resume-sessions">
              <h2 id="resume-sessions">Recent Antigravity sessions</h2>
              {recentSessions.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Sessions you open in Antigravity appear here.
                </p>
              ) : (
                <div className="list" style={{ background: 'transparent', border: 0 }}>
                  {recentSessions.slice(0, 4).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="row"
                      onClick={() => {
                        sendIntent({ app: 'agent', type: 'open-session', sessionId: s.id });
                        launch('agent');
                      }}
                    >
                      <Icon name="sparkle" />
                      <span className="row-main">
                        <span className="row-title">{s.title}</span>
                        <span className="row-sub">{s.projectName}</span>
                      </span>
                      <Icon name="forward" size={18} />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section {...tilt} className={`widget glass ${tilt.className}`} aria-labelledby="conn-title">
              <h2 id="conn-title">Linux machine</h2>
              <div className="row-inline" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <Icon name={connection.mode === 'host' ? 'check' : 'wifiOff'} size={22} />
                <div>
                  <strong>{connection.mode === 'host' ? 'Connected' : 'Not connected'}</strong>
                  <p className="muted" style={{ margin: '4px 0 8px', fontSize: 'var(--fs-sm)' }}>
                    {connection.detail}
                  </p>
                  <div className="row-inline">
                    {connection.mode === 'demo' && connection.demoReason !== 'no-backend' && (
                      <button type="button" className="btn small primary" onClick={() => window.location.reload()}>
                        Connect
                      </button>
                    )}
                    <a className="btn small ghost" href="/?choose=1">
                      Switch workspace
                    </a>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {showConnection && (
        <Sheet title={connection.label} onClose={() => setShowConnection(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{connection.detail}</p>
            {connection.mode === 'host' ? (
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-2)' }}>
                <li>Terminal: a real shell on your Linux machine, kept running in tmux between visits.</li>
                <li>Code: your project files in ~/projects on the machine&apos;s saved storage.</li>
                <li>Antigravity: the real Antigravity CLI running on the machine; sessions are shared by your devices.</li>
              </ul>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-2)' }}>
                <li>Terminal: a simulated shell that runs in this browser. No commands reach a server.</li>
                <li>Code: a sample project saved in this browser&apos;s storage. It does not sync between devices.</li>
                <li>Antigravity: canned demo replies. The real Antigravity CLI is not called.</li>
              </ul>
            )}
            <button type="button" className="btn primary" onClick={() => setShowConnection(false)}>
              OK
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
