import { useEffect } from 'react';
import { useShell, type AppId } from '../state/shell';
import { useLayout } from '../state/viewport';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useApplySettings } from '../hooks/useApplySettings';
import { useTyping } from '../hooks/useTyping';
import { HomeScreen } from './HomeScreen';
import { HomeLight } from './HomeLight';
import { Dock } from './Dock';
import { AppHost } from './AppHost';
import { AppSwitcher } from './AppSwitcher';
import { ControlCenter } from './ControlCenter';
import { Toasts } from './Toasts';
import { AiOffWarning } from './AiOffWarning';
import { IntroSheet } from './IntroSheet';
import { Path } from './o5/Path';
import { Space } from '../space/Space';
import { Handle } from './o5/Handle';
import { IndexMenu } from './o5/IndexMenu';
import { useChromeOnScroll } from './o5/chrome';
import { OrbCursor } from './orb/OrbCursor';
import { WriteHelp } from './orb/WriteHelp';

/**
 * Root of Orbit. Owns global layout concerns: visual viewport (keyboard), theme, overlays,
 * and hardware-keyboard shortcuts. Apps render inside <AppHost> and stay mounted while open.
 */
export function Shell() {
  useVisualViewport();
  useApplySettings();
  useTyping();
  const { activeApp, overlay, settings } = useShell();
  const layout = useLayout();
  useShortcuts();

  const inApp = activeApp !== null;
  const o5 = settings.skin === 'o5';
  const space = o5 && settings.space !== false;
  useChromeOnScroll(o5);
  return (
    <div
      className="shell"
      data-in-app={inApp}
      data-compact={layout.compact}
      data-keyboard={layout.keyboardOpen}
      data-space={space}
      style={
        {
          // Apps reserve space for the floating dock, except while the keyboard is up (dock hides).
          '--app-bottom-inset': layout.keyboardOpen
            ? '0px'
            : o5
              ? 'calc(var(--safe-bottom) + 22px)' // Orbit 0.5: only a thin line at the bottom
              : `calc(var(--safe-bottom) + ${layout.compact ? 58 : 64}px + var(--dock-gap) * 2)`,
        } as React.CSSProperties
      }
    >
      {o5 ? (
        space ? <Space hidden={inApp} /> : <Path hidden={inApp} />
      ) : (
        <>
          <HomeLight active={!inApp} />
          <HomeScreen hidden={inApp} />
        </>
      )}
      <AppHost />
      {o5 ? <Handle /> : <Dock />}
      {overlay === 'index' && <IndexMenu />}
      {overlay === 'switcher' && <AppSwitcher />}
      {overlay === 'control-center' && <ControlCenter />}
      {!settings.introSeen && <IntroSheet />}
      <Toasts />
      <AiOffWarning />
      <OrbCursor />
      <WriteHelp />
    </div>
  );
}

/**
 * Hardware keyboard shortcuts (iPad Magic Keyboard etc.). Ctrl+Shift avoids clashing with
 * Safari/iPadOS (⌘) shortcuts and with shells (plain Ctrl).
 */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useShell.getState();
      if (e.key === 'Escape' && s.overlay) {
        // A sheet open on top (e.g. "Close app?") handles its own Escape first.
        if (document.querySelector('.sheet')) return;
        s.setOverlay(null);
        return;
      }
      if (!(e.ctrlKey && e.shiftKey) || e.metaKey || e.altKey) return;
      const apps: Record<string, AppId> = { Digit1: 'terminal', Digit2: 'editor', Digit3: 'agent', Digit4: 'ai', Digit5: 'soreal', Comma: 'settings' };
      let handled = true;
      if (apps[e.code]) s.launch(apps[e.code]);
      else if (e.code === 'KeyH') s.goHome();
      else if (e.code === 'KeyA') s.toggleOverlay('switcher');
      else if (e.code === 'Period') s.toggleOverlay('control-center');
      else if (e.code === 'Backslash') {
        if (s.split.enabled && s.activeApp && (s.activeApp === s.split.left || s.activeApp === s.split.right)) {
          s.setSplit({ enabled: false });
        } else s.openSplit();
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl ⇧ 1', action: 'Open Terminal' },
  { keys: 'Ctrl ⇧ 2', action: 'Open Code' },
  { keys: 'Ctrl ⇧ 3', action: 'Open Antigravity' },
  { keys: 'Ctrl ⇧ ,', action: 'Open Settings' },
  { keys: 'Ctrl ⇧ H', action: 'Home screen' },
  { keys: 'Ctrl ⇧ A', action: 'App Switcher' },
  { keys: 'Ctrl ⇧ .', action: 'Control Center' },
  { keys: 'Ctrl ⇧ \\', action: 'Toggle Code + Chat split (iPad)' },
  { keys: 'Ctrl ⇧ Space', action: 'Ask the orb to do something' },
  { keys: 'Esc', action: 'Close an overlay or sheet' },
];
