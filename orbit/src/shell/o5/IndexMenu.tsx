import { useEffect, useRef } from 'react';
import { APPS } from '../../apps/registry';
import { useShell, type AppId } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';

const ENTRIES: { id: AppId; title: string; line: string }[] = [
  { id: 'ai', title: 'Talk', line: 'Your own models' },
  { id: 'soreal', title: 'soReal', line: 'Movies, shot by shot' },
  { id: 'editor', title: 'Code', line: 'Your projects' },
  { id: 'terminal', title: 'Terminal', line: 'A shell that stays open' },
  { id: 'agent', title: 'Antigravity', line: 'The coding agent' },
  { id: 'settings', title: 'Settings', line: 'Make it yours' },
];
const MOTION_NAME = { system: 'Auto', full: 'Full', lite: 'Lite', reduce: 'Off' } as const;
const MOTION_NEXT = { full: 'lite', lite: 'reduce', reduce: 'system', system: 'full' } as const;

/**
 * Orbit 0.5's one menu: a full-screen index, like a magazine's contents page. Everything is here:
 * home, every app, what's open now, and the few switches worth having at hand.
 */
export function IndexMenu() {
  const { activeApp, openApps, settings, launch, goHome, closeApp, setOverlay, updateSettings } = useShell();
  const summaries = useWorkspace((s) => s.summaries);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOverlay(null);
  const go = (fn: () => void) => () => {
    fn();
    close();
  };
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('.o5-index-close')?.focus();
    return () => prev?.focus?.();
  }, []);

  return (
    <div className="o5-index" role="dialog" aria-modal="true" aria-label="Index" ref={panel}>
      <div className="o5-index-scroll">
        <header className="o5-index-head">
          <p className="o5-kicker">Index</p>
          <button type="button" className="o5-index-close" aria-label="Close the index" onClick={close}>
            <Icon name="close" size={22} />
          </button>
        </header>

        {openApps.length > 0 && (
          <section className="o5-index-open" aria-label="Open now">
            <p className="o5-kicker">Open now</p>
            <ul>
              {openApps.map((id) => (
                <li key={id}>
                  <button type="button" className="o5-open-go" aria-current={id === activeApp || undefined} onClick={go(() => launch(id))}>
                    <span className="o5-open-name">{APPS[id].name}</span>
                    <span className="o5-go-hint">{summaries[id] || (id === activeApp ? 'On screen' : 'Waiting')}</span>
                  </button>
                  <button type="button" className="o5-open-close" aria-label={`Close ${APPS[id].name}`} onClick={() => closeApp(id)}>
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <nav aria-label="Everything">
          <ol className="o5-index-list">
            <li style={{ '--i': 0 } as React.CSSProperties}>
              <button type="button" className="o5-index-go" aria-current={activeApp === null || undefined} onClick={go(goHome)}>
                <span className="o5-index-n">00</span>
                <span className="o5-index-title">Home</span>
                <span className="o5-go-hint">The path</span>
              </button>
            </li>
            {ENTRIES.map((e, i) => (
              <li key={e.id} style={{ '--i': i + 1 } as React.CSSProperties}>
                <button type="button" className="o5-index-go" aria-current={activeApp === e.id || undefined} onClick={go(() => launch(e.id))}>
                  <span className="o5-index-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="o5-index-title">{e.title}</span>
                  <span className="o5-go-hint">{e.line}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <footer className="o5-index-switches" aria-label="Quick settings">
          <button type="button" className="o5-switch" aria-pressed={dark} onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}>
            {dark ? 'Dark' : 'Light'}
          </button>
          <button
            type="button"
            className="o5-switch"
            aria-label={`Motion: ${MOTION_NAME[settings.motion]}. Tap to change.`}
            onClick={() => updateSettings({ motion: MOTION_NEXT[settings.motion], motionPicked: true })}
          >
            Motion · {MOTION_NAME[settings.motion]}
          </button>
          <button type="button" className="o5-switch" onClick={go(() => updateSettings({ skin: 'classic' }))}>
            Classic look
          </button>
          <a className="o5-switch" href="/?choose=1">
            Switch workspace
          </a>
        </footer>
      </div>
    </div>
  );
}
