import { useEffect, useRef, useState } from 'react';
import { APPS } from '../../apps/registry';
import { useShell, type AppId } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet } from '../../ui/components';
import { AppArt } from '../../ui/AppArt';

export const ENTRIES: { id: AppId; title: string; line: string }[] = [
  { id: 'ai', title: 'Talk', line: 'Your own models' },
  { id: 'make', title: 'Make', line: 'Pictures and videos' },
  { id: 'livedraw', title: 'Live Draw', line: 'Draw, and watch it become a picture' },
  { id: 'store', title: 'Store', line: 'Models, makers and styles' },
  { id: 'soreal', title: 'soReal', line: 'A movie from one idea' },
  { id: 'lab', title: 'Lab', line: 'Comedy or spicy, made while the machine is on' },
  { id: 'editor', title: 'Code', line: 'Your projects' },
  { id: 'terminal', title: 'Terminal', line: 'A shell that stays open' },
  { id: 'agent', title: 'Antigravity', line: 'The coding agent' },
  { id: 'playground', title: 'Playground', line: 'The full AI playground' },
  { id: 'vscode', title: 'VS Code', line: 'The full editor' },
  { id: 'desktop', title: 'Linux desktop', line: 'The whole machine' },
  { id: 'windows', title: 'Windows PC', line: 'Your computer at home' },
  { id: 'stats', title: 'Stats', line: 'Every number, money and storage' },
  { id: 'settings', title: 'Settings', line: 'Make it yours' },
];
/** The folio for an app, as on the contents page: "04 · Terminal". */
export function folioOf(app: AppId | null): string | null {
  const i = ENTRIES.findIndex((e) => e.id === app);
  return i < 0 ? null : `${String(i + 1).padStart(2, '0')} · ${ENTRIES[i].title}`;
}
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
  const [confirm, setConfirm] = useState<AppId | null>(null);
  const confirmOpen = useRef(false);
  confirmOpen.current = confirm !== null;
  const close = () => setOverlay(null);
  // Closing an app with unsaved work asks first (as the App Switcher does).
  const requestClose = (id: AppId) => {
    if (summaries[id]?.toLowerCase().includes('unsaved')) setConfirm(id);
    else closeApp(id);
  };
  const go = (fn: () => void) => () => {
    fn();
    close();
  };
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && document.documentElement.dataset.theme === 'dark');

  // Keyboard focus stays inside the index while it is open, and goes back afterwards.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = panel.current;
    el?.querySelector<HTMLElement>('.o5-index-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el || confirmOpen.current) return; // the confirm sheet traps its own focus
      const focusables = Array.from(el.querySelectorAll<HTMLElement>('button, [href]')).filter((n) => !n.hasAttribute('disabled'));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (!document.activeElement || document.activeElement === document.body) prev?.focus?.();
    };
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
                  <button type="button" className="o5-open-close" aria-label={`Close ${APPS[id].name}`} onClick={() => requestClose(id)}>
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
                  <AppArt id={e.id} size={48} className="o5-index-art" />
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
          <a className="o5-switch" href="/?choose=1">
            Switch workspace
          </a>
        </footer>
      </div>
      {confirm && (
        <ConfirmSheet
          title={`Close ${APPS[confirm].name}?`}
          message="It has unsaved changes. Closing the app discards them."
          confirmLabel="Discard and close"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            closeApp(confirm);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
