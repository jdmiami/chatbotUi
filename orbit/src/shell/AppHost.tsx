import { Component, Suspense, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { APPS } from '../apps/registry';
import type { Placement } from '../apps/types';
import { useShell, type AppId } from '../state/shell';
import { useLayout } from '../state/viewport';
import { useMotionLevel } from '../motion/MotionProvider';
import { cancelMorph, morphIn, morphOut, pageTurnIn, pageTurnOut } from '../motion/morph';
import { ENTRIES } from './o5/IndexMenu';

/**
 * Renders every open app exactly once, in a stable order, and only changes its placement.
 * Because apps are never re-parented or unmounted while open, switching apps (or entering and
 * leaving split view) keeps terminal scrollback, unsaved editor buffers and chat drafts intact.
 */
export function AppHost() {
  const { openApps, activeApp, split, launch } = useShell();
  const setSplit = useShell((s) => s.setSplit);
  const o5 = useShell((s) => s.settings.skin === 'o5');
  const layout = useLayout();
  // MagStyle: going straight from one app to another turns the page (instead of growing from an icon).
  const lastApp = useRef<AppId | null>(activeApp);
  const turning = o5 && lastApp.current !== null && activeApp !== null && lastApp.current !== activeApp;
  useLayoutEffect(() => {
    lastApp.current = activeApp;
  }, [activeApp]);

  const splitActive =
    split.enabled &&
    layout.canSplit &&
    activeApp !== null &&
    (activeApp === split.left || activeApp === split.right) &&
    openApps.includes(split.left) &&
    openApps.includes(split.right);

  const placementOf = (app: AppId): Placement => {
    if (activeApp === null) return 'hidden';
    if (splitActive) {
      if (app === split.left) return 'split-left';
      if (app === split.right) return 'split-right';
      return 'hidden';
    }
    return app === activeApp ? 'full' : 'hidden';
  };

  // Stable render order (by registry) so React never re-parents an app.
  const ordered = (Object.keys(APPS) as AppId[]).filter((a) => openApps.includes(a));
  const leftPct = `${(split.ratio * 100).toFixed(2)}%`;

  return (
    <div className="app-host" aria-hidden={activeApp === null}>
      {ordered.map((id) => {
        const meta = APPS[id];
        const placement = placementOf(id);
        const visible = placement !== 'hidden';
        const isActive = visible && (placement === 'full' || activeApp === id);
        const paneWidth =
          placement === 'split-left'
            ? layout.width * split.ratio
            : placement === 'split-right'
              ? layout.width * (1 - split.ratio)
              : layout.width;
        const style: React.CSSProperties =
          placement === 'split-left'
            ? { width: leftPct }
            : placement === 'split-right'
              ? { width: `calc(100% - ${leftPct})` }
              : {};
        return (
          <AppWindow
            key={id}
            id={id}
            name={meta.name}
            placement={placement}
            visible={visible}
            isActive={isActive}
            style={style}
            compact={paneWidth < 600}
            goingHome={activeApp === null}
            turning={turning}
            o5={o5}
            onFocusApp={() => {
              if (visible && activeApp !== id) launch(id);
            }}
            Component={meta.component}
          />
        );
      })}
      {splitActive && <SplitDivider ratio={split.ratio} onChange={(ratio) => setSplit({ ratio })} />}
    </div>
  );
}

/** One open app. Opening grows it out of its icon; closing shrinks it back (see motion/morph). */
function AppWindow({
  id,
  name,
  placement,
  visible,
  isActive,
  style,
  compact,
  goingHome,
  turning,
  o5,
  onFocusApp,
  Component,
}: {
  id: AppId;
  name: string;
  placement: Placement;
  visible: boolean;
  isActive: boolean;
  style: React.CSSProperties;
  compact: boolean;
  goingHome: boolean;
  turning: boolean;
  o5: boolean;
  onFocusApp: () => void;
  Component: (typeof APPS)[AppId]['component'];
}) {
  const ref = useRef<HTMLElement>(null);
  const level = useMotionLevel();
  // A window mounts when its app is first opened, already in place: treat that as coming from hidden.
  const prev = useRef<Placement>('hidden');
  // MagStyle: each time the app comes into view it opens on its chapter page (a brief title card).
  const [opener, setOpener] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    const was = prev.current;
    prev.current = placement;
    if (!el || was === placement) return;
    const split = (p: Placement) => p === 'split-left' || p === 'split-right';
    if (split(was) || split(placement)) return cancelMorph(el);
    if (was === 'hidden') {
      if (o5 && level !== 'off') setOpener((n) => n + 1);
      void (turning ? pageTurnIn(el, level) : morphIn(el, id, level));
    } else if (placement === 'hidden') void (turning ? pageTurnOut(el, level) : morphOut(el, id, level, goingHome));
  }, [placement, id, level, goingHome, turning, o5]);
  const chapter = ENTRIES.findIndex((e) => e.id === id);
  const entry = ENTRIES[chapter];

  return (
    <section
      ref={ref}
      className="app-window"
      data-app={id}
      data-placement={placement}
      data-focused={isActive}
      aria-label={name}
      aria-hidden={!visible}
      // `inert` keeps hidden apps out of the tab order and away from assistive tech.
      inert={!visible || undefined}
      style={style}
      onPointerDownCapture={onFocusApp}
      onFocusCapture={onFocusApp}
    >
      <div className="app-window-body">
        <AppLoadBoundary name={name}>
          <Suspense fallback={<AppLoading name={name} />}>
            <Component placement={placement} isActive={isActive} compact={compact} />
          </Suspense>
        </AppLoadBoundary>
      </div>
      {o5 && entry && (
        <p className="o5-runhead" aria-hidden>
          Orbit · {String(chapter + 1).padStart(2, '0')} · {entry.title}
        </p>
      )}
      {o5 && entry && opener > 0 && placement === 'full' && (
        <div key={opener} className="o5-opener" aria-hidden onAnimationEnd={(e) => e.target === e.currentTarget && setOpener(0)}>
          <span className="o5-opener-n">{String(chapter + 1).padStart(2, '0')}</span>
          <span className="o5-opener-kicker">Chapter {String(chapter + 1).padStart(2, '0')}</span>
          <span className="o5-opener-title">{entry.title}</span>
          <span className="o5-opener-line">{entry.line}</span>
        </div>
      )}
    </section>
  );
}

function AppLoading({ name }: { name: string }) {
  return (
    <div className="app-loading" role="status">
      <span className="boot-spinner" aria-hidden /> Opening {name}…
    </div>
  );
}

/** If an app's code can't be downloaded (offline, or Orbit was updated meanwhile), offer a reload. */
class AppLoadBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-loading" role="alert">
        <p style={{ margin: 0 }}>{this.props.name} couldn&apos;t load. Check your connection, then reload Orbit.</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Reload Orbit
        </button>
      </div>
    );
  }
}

function SplitDivider({ ratio, onChange }: { ratio: number; onChange: (r: number) => void }) {
  const dragging = useRef(false);
  const clamp = (r: number) => Math.min(0.7, Math.max(0.3, r));

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const width = (e.currentTarget.parentElement as HTMLElement).clientWidth;
      onChange(clamp(e.clientX / width));
    },
    [onChange],
  );

  return (
    <button
      type="button"
      className="split-divider"
      style={{ left: `${ratio * 100}%` }}
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={30}
      aria-valuemax={70}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label="Resize split view. Use left and right arrow keys, or double-tap to reset."
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => (dragging.current = false)}
      onDoubleClick={() => onChange(0.55)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(clamp(ratio - 0.05));
        else if (e.key === 'ArrowRight') onChange(clamp(ratio + 0.05));
        else return;
        e.preventDefault();
      }}
    />
  );
}
