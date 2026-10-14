import { useEffect, useRef, useState } from 'react';
import { APPS, AppGlyph } from '../apps/registry';
import { useShell, type AppId } from '../state/shell';
import { useWorkspace } from '../state/workspace';
import { ConfirmSheet, EmptyState, IconButton } from '../ui/components';

/**
 * App Switcher: one card per running app with a live summary from the app itself.
 * Opening a card restores the app exactly as it was (apps stay mounted).
 * Closing a card unmounts the app; if it reports unsaved work we confirm first.
 */
export function AppSwitcher() {
  const { openApps, launch, closeApp, setOverlay, goHome } = useShell();
  const summaries = useWorkspace((s) => s.summaries);
  const [confirm, setConfirm] = useState<AppId | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const confirmOpen = useRef(false);
  confirmOpen.current = confirm !== null;

  // Keep keyboard focus inside the switcher while it is open, and give it back afterwards.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('.card-open, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el || confirmOpen.current) return; // the confirm sheet traps its own focus
      const focusables = Array.from(el.querySelectorAll<HTMLElement>('button, [href]')).filter(
        (n) => !n.hasAttribute('disabled'),
      );
      if (focusables.length === 0) return;
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
      // Only if nothing else (e.g. the app just opened) has taken focus.
      if (!document.activeElement || document.activeElement === document.body) prev?.focus?.();
    };
  }, []);

  const requestClose = (id: AppId) => {
    if (summaries[id]?.toLowerCase().includes('unsaved')) setConfirm(id);
    else closeApp(id);
  };

  return (
    <div className="switcher" role="dialog" aria-modal="true" aria-label="App Switcher" ref={ref}>
      <div className="switcher-header">
        <h2>Open apps</h2>
        <button type="button" className="btn small ghost" style={{ color: '#fff' }} onClick={goHome}>
          Home
        </button>
        <IconButton icon="close" label="Close App Switcher" style={{ color: '#fff' }} onClick={() => setOverlay(null)} />
      </div>
      {openApps.length === 0 ? (
        <div className="glass" style={{ borderRadius: 'var(--radius-lg)', display: 'flex' }}>
          <EmptyState icon="switcher" title="No apps open">
            Apps you open stay running here, with their state kept, until you close them.
          </EmptyState>
        </div>
      ) : (
        <div className="switcher-cards">
          {openApps.map((id) => {
            const app = APPS[id];
            return (
              <article key={id} className="switcher-card">
                <button type="button" className="card-open" onClick={() => launch(id)} aria-label={`Open ${app.name}`}>
                  <span className="card-top">
                    <AppGlyph app={app} size={36} />
                    {app.name}
                  </span>
                  <span className="card-summary">{summaries[id] ?? 'Running'}</span>
                </button>
                <div className="card-actions">
                  <button type="button" onClick={() => launch(id)}>
                    Open
                  </button>
                  <button type="button" className="danger" onClick={() => requestClose(id)} aria-label={`Close ${app.name}`}>
                    Close
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
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
