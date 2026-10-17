import { useEffect, useRef } from 'react';
import { connection } from '../services';
import { useShell, type AccentId } from '../state/shell';
import { useLayout } from '../state/viewport';
import { Icon } from '../ui/Icon';

export const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'indigo', label: 'Indigo', color: '#6c7cff' },
  { id: 'teal', label: 'Teal', color: '#22b8a8' },
  { id: 'sky', label: 'Sky', color: '#3ea6f5' },
  { id: 'amber', label: 'Amber', color: '#f2a93b' },
  { id: 'rose', label: 'Rose', color: '#f2557a' },
];

/** Control Center: quick settings. Shows only real state (no fake connection or resource metrics). */
const MOTION_NAME = { system: 'Auto', full: 'Full', lite: 'Lite', reduce: 'Off' } as const;
const MOTION_NEXT = { full: 'lite', lite: 'reduce', reduce: 'system', system: 'full' } as const;

export function ControlCenter() {
  const { settings, updateSettings, setOverlay, launch, split, setSplit, openSplit, activeApp } = useShell();
  const layout = useLayout();
  const panel = useRef<HTMLDivElement>(null);
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && document.documentElement.dataset.theme === 'dark');
  const splitShowing =
    split.enabled && layout.canSplit && activeApp !== null && (activeApp === split.left || activeApp === split.right);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  return (
    <>
      <div className="cc-scrim" onClick={() => setOverlay(null)} aria-hidden />
      <div className="cc-panel glass" role="dialog" aria-modal="true" aria-label="Control Center" ref={panel}>
        <div className="cc-tile wide" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 0 }}>
          <Icon name={connection.mode === 'host' ? 'check' : 'wifiOff'} />
          <div style={{ flex: 1 }}>
            <div className="cc-label">{connection.label}</div>
            <div className="cc-value">
              {connection.mode === 'host' ? 'Connected to your Linux machine' : 'Not connected to your Linux machine'}
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close Control Center" onClick={() => setOverlay(null)}>
            <Icon name="close" />
          </button>
        </div>

        <button
          type="button"
          className="cc-tile"
          aria-pressed={dark}
          onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}
        >
          <Icon name={dark ? 'moon' : 'sun'} />
          <span className="cc-label">Dark mode</span>
          <span className="cc-value">{dark ? 'On' : 'Off'}</span>
        </button>

        <button
          type="button"
          className="cc-tile"
          aria-label={`Motion: ${MOTION_NAME[settings.motion]}. Tap to change.`}
          onClick={() => updateSettings({ motion: MOTION_NEXT[settings.motion], motionPicked: true })}
        >
          <Icon name="motion" />
          <span className="cc-label">Motion</span>
          <span className="cc-value">{MOTION_NAME[settings.motion]}</span>
        </button>

        {layout.canSplit && (
          <button
            type="button"
            className="cc-tile"
            aria-pressed={splitShowing}
            onClick={() => (splitShowing ? setSplit({ enabled: false }) : openSplit())}
          >
            <Icon name="split" />
            <span className="cc-label">Code + Chat</span>
            <span className="cc-value">{splitShowing ? 'Side by side' : 'Off'}</span>
          </button>
        )}

        <button
          type="button"
          className="cc-tile"
          aria-pressed={settings.terminalKeys}
          onClick={() => updateSettings({ terminalKeys: !settings.terminalKeys })}
        >
          <Icon name="keyboard" />
          <span className="cc-label">Terminal keys</span>
          <span className="cc-value">{settings.terminalKeys ? 'Shown' : 'Hidden'}</span>
        </button>

        <div className="cc-tile wide">
          <label className="cc-label" htmlFor="cc-text-size">
            Text size <span className="cc-value">{Math.round(settings.textScale * 100)}%</span>
          </label>
          <input
            id="cc-text-size"
            className="range"
            type="range"
            min={0.9}
            max={1.3}
            step={0.05}
            value={settings.textScale}
            onChange={(e) => updateSettings({ textScale: Number(e.target.value) })}
          />
        </div>

        <div className="cc-tile wide">
          <span className="cc-label" id="cc-accent-label">
            Accent colour
          </span>
          <div className="swatches" role="group" aria-labelledby="cc-accent-label">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="swatch"
                style={{ background: a.color }}
                aria-label={a.label}
                aria-pressed={settings.accent === a.id}
                onClick={() => updateSettings({ accent: a.id })}
              />
            ))}
          </div>
        </div>

        <button type="button" className="btn ghost" onClick={() => launch('settings')}>
          <Icon name="gear" size={18} /> Settings
        </button>
        <a className="btn ghost" href="/?choose=1">
          Switch workspace
        </a>
      </div>
    </>
  );
}
