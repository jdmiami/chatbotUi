import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AppProps } from '../types';
import { AppHeader, ConfirmSheet, DemoChip, Segmented, Toggle } from '../../ui/components';
import { UncensoredSwitch } from '../../ui/Censor';
import { Icon, type IconName } from '../../ui/Icon';
import { formatBytes } from '../../ui/format';
import { connection, getFileStore, resetDemoData } from '../../services';
import { AGY_CAPABILITIES } from '../../services/runner/agyCapabilities';
import type { CapabilityStatus } from '../../services/runner/types';
import { cue } from '../../motion/feedback';
import { requestTiltPermission, tiltNeedsPermission } from '../../motion/tilt';
import { useShell, type AppId, type MotionPref, type ThemePref, type WallpaperId } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { useLayout } from '../../state/viewport';
// Read only inside components: Shell.tsx imports the app registry, which imports this file.
import { ACCENTS } from '../../shell/ControlCenter';
import { SHORTCUTS } from '../../shell/Shell';
import {
  applyImport,
  buildExport,
  collectOrbitData,
  dataSize,
  describeKeys,
  exportFileName,
  MAX_IMPORT_BYTES,
  parseImport,
  type OrbitExport,
} from './dataTransfer';
import { Section, chapterId } from './parts';
import { CloudAiSection, NotifySection, OrbSection, UsageSection } from './UsageSection';
import './settings.css';

const VERSION = '0.2';
const TEXT_MIN = 0.9;
const TEXT_MAX = 1.3;
const TEXT_STEP = 0.05;
const TERM_MIN = 5;
const TERM_MAX = 22;

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];
const MOTIONS: { value: MotionPref; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'full', label: 'Full' },
  { value: 'lite', label: 'Lite' },
  { value: 'reduce', label: 'Off' },
];
const WALLPAPERS: { id: WallpaperId; label: string }[] = [
  { id: 'orbit', label: 'Orbit' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'graphite', label: 'Graphite' },
];
const APP_NAMES: Partial<Record<AppId, string>> = { terminal: 'Terminal', editor: 'Code', agent: 'Antigravity' };

const CAPABILITY_LABELS: Record<string, string> = {
  newConversation: 'New conversation',
  continueConversation: 'Continue a conversation',
  streamOutput: 'Live streaming output',
  stop: 'Stop a running turn',
  pauseResume: 'Pause and resume',
  approvals: 'Tool approvals',
  modes: 'Plan and accept-edits modes',
  models: 'Choose a model',
};
const STATUS: Record<CapabilityStatus, { label: string; chip: string }> = {
  supported: { label: 'Supported', chip: 'chip ok' },
  unverified: { label: 'Unverified', chip: 'chip info' },
  unsupported: { label: 'Not supported', chip: 'chip' },
};

type Pending = null | { kind: 'reload' } | { kind: 'reset' } | { kind: 'import'; backup: OrbitExport };
type Problem = { message: string; action?: { label: string; run: () => void } } | null;
interface Usage {
  items: number;
  bytes: number;
}

const roundScale = (n: number) => Math.min(TEXT_MAX, Math.max(TEXT_MIN, Math.round(n * 100) / 100));

/** Apps (other than Settings) whose App Switcher summary says they have unsaved work. */
function appsWithUnsavedWork(): string[] {
  const { summaries } = useWorkspace.getState();
  return (Object.entries(summaries) as [AppId, string | undefined][])
    .filter(([id, text]) => id !== 'settings' && !!text && /unsaved/i.test(text))
    .map(([id]) => APP_NAMES[id] ?? id);
}

function readUsage(): Usage | null {
  try {
    const data = collectOrbitData(window.localStorage);
    return { items: Object.keys(data).length, bytes: dataSize(data) };
  } catch {
    return null; // storage blocked (some private-browsing modes)
  }
}

function errorText(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
    return 'This browser’s storage for Orbit is full.';
  }
  return err instanceof Error && err.message ? err.message : 'Unknown error.';
}

/** "Ctrl ⇧ ," → "Control Shift Comma", for screen readers. */
function spokenKeys(keys: string): string {
  const names: Record<string, string> = {
    Ctrl: 'Control',
    '⇧': 'Shift',
    '⌘': 'Command',
    '⌥': 'Option',
    Esc: 'Escape',
    '\\': 'Backslash',
    ',': 'Comma',
    '.': 'Period',
  };
  return keys
    .split(' ')
    .map((k) => names[k] ?? k)
    .join(' ');
}

/** Render `code` spans in capability notes. Short spans never break inside (e.g. at the "--" of a flag). */
function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className={part.length <= 20 ? 'st-code st-code-nb' : 'st-code'}>
        {part}
      </code>
    ) : (
      part
    ),
  );
}

export default function SettingsApp({ isActive }: AppProps) {
  const settings = useShell((s) => s.settings);
  const updateSettings = useShell((s) => s.updateSettings);
  const toast = useShell((s) => s.toast);
  const host = connection.mode === 'host';

  const [pending, setPending] = useState<Pending>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [usage, setUsage] = useState<Usage | null>(() => readUsage());
  const fileInput = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    useWorkspace.getState().setSummary('settings', 'Settings');
    return () => useWorkspace.getState().setSummary('settings', undefined);
  }, []);

  // Storage use changes as other apps save; refresh whenever Settings is shown or preferences change.
  useEffect(() => {
    if (isActive) setUsage(readUsage());
  }, [isActive, settings]);

  useEffect(() => {
    if (problem) problemRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [problem]);

  const reconnect = () => {
    if (appsWithUnsavedWork().length > 0) setPending({ kind: 'reload' });
    else window.location.reload();
  };

  const exportData = () => {
    setProblem(null);
    try {
      const backup = buildExport(window.localStorage);
      const name = exportFileName();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const n = Object.keys(backup.data).length;
      toast(`Backup ready: ${name} (${n} item${n === 1 ? '' : 's'})`, 'success');
    } catch (err) {
      setProblem({
        message: `Couldn’t export Orbit’s data. ${errorText(err)}`,
        action: { label: 'Try again', run: exportData },
      });
    }
  };

  const pickBackup = () => {
    setProblem(null);
    fileInput.current?.click();
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires
    if (!file) return;
    const retry = { label: 'Choose another file', run: pickBackup };
    if (file.size > MAX_IMPORT_BYTES) {
      setProblem({ message: 'This file is too large to be an Orbit backup.', action: retry });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setProblem({ message: 'Couldn’t read that file. Try choosing it again.', action: retry });
      return;
    }
    const result = parseImport(text);
    if (!result.ok) setProblem({ message: result.error, action: retry });
    else setPending({ kind: 'import', backup: result.backup });
  };

  const runImport = async (backup: OrbitExport) => {
    setPending(null);
    try {
      applyImport(window.localStorage, backup.data);
    } catch (err) {
      setProblem({
        message: `Couldn’t import the backup: ${errorText(err)} Your previous data was kept.`,
        action: { label: 'Try again', run: () => setPending({ kind: 'import', backup }) },
      });
      return;
    }
    // Load the imported values into memory first, so nothing writes the old values back before the reload.
    try {
      await Promise.all([useShell.persist.rehydrate(), useWorkspace.persist.rehydrate()]);
    } catch {
      /* the reload below reads storage anyway */
    }
    window.location.reload();
  };

  const runReset = () => {
    setPending(null);
    try {
      resetDemoData();
      // The file store the apps hold caches its files; reset that instance too (demo only).
      if (connection.mode === 'demo') getFileStore().reset();
      useWorkspace.getState().clearRecents();
      setUsage(readUsage());
      toast('Demo data reset', 'success');
    } catch (err) {
      setProblem({ message: `Couldn’t reset the demo data. ${errorText(err)}`, action: { label: 'Try again', run: runReset } });
    }
  };

  const showWelcome = () => updateSettings({ introSeen: false });

  return (
    <div className="st-root">
      <AppHeader
        title="Settings"
        chip={
          host ? (
            <span className="chip ok" title={connection.detail}>
              <span className="dot" aria-hidden />
              Linux machine
            </span>
          ) : (
            <DemoChip text="Demo mode" title={connection.detail} />
          )
        }
      />
      <div className="st-scroll">
        <div className="st-page">
          <nav className="st-contents" aria-label="Chapters">
            <p className="o5-kicker">Settings</p>
            <h2 className="o5-chapter-title">Make it yours</h2>
            <ul className="o5-links">
              {CHAPTERS.map((title, i) => (
                <li key={title}>
                  <button
                    type="button"
                    className="o5-go"
                    onClick={() => document.getElementById(chapterId(title))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    <span className="o5-go-label">{title}</span>
                    <span className="o5-go-hint">{String(i + 1).padStart(2, '0')}</span>
                    <Icon name="down" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <ConnectionSection onReconnect={reconnect} />
          <AppearanceSection />
          <OrbSection />
          <CloudAiSection />
          <AiModelsSection />
          <NsfwSection />
          <TerminalSection />
          <SplitSection />
          <ShortcutsSection />
          <UsageSection active={isActive} />
          <NotifySection />

          <Section title="Data & storage">
            <div className="list">
              <div className="row st-row st-col">
                {host ? (
                  <>
                    <p className="st-text">
                      <strong>On your Linux machine:</strong> project files and Antigravity sessions live on the
                      machine’s saved storage, so your iPhone and iPad see the same ones. Terminal sessions keep
                      running while the machine is on; turning it off ends them.
                    </p>
                    <p className="st-text">
                      <strong>In this browser:</strong> preferences such as theme, text size and terminal options.
                      Each browser keeps its own.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="st-text">
                      <strong>Demo mode:</strong> the demo project files and Antigravity sessions live in this browser
                      only. They don’t sync to your other devices, and Safari can clear them if you don’t use Orbit
                      for a long time.
                    </p>
                    <p className="st-text">Preferences such as theme and text size are saved in this browser too.</p>
                  </>
                )}
                <p className="st-usage">
                  {usage
                    ? `Orbit data in this browser: ${usage.items} item${usage.items === 1 ? '' : 's'}, ${formatBytes(usage.bytes)}`
                    : 'This browser isn’t letting Orbit use its storage (private browsing can do this).'}
                </p>
              </div>
              <ActionRow
                icon="download"
                title="Export preferences & demo data"
                sub={
                  host
                    ? 'Downloads a backup of what Orbit keeps in this browser. Files on your Linux machine aren’t included.'
                    : 'Downloads a backup file of what Orbit keeps in this browser.'
                }
                onClick={exportData}
              />
              <ActionRow
                icon="upload"
                title="Import from a backup…"
                sub="Replaces Orbit’s data in this browser with a backup file, then reloads."
                onClick={pickBackup}
              />
              <ActionRow
                icon="info"
                title="Show the welcome sheet again"
                sub="The first-run guide to what’s real and what’s simulated."
                onClick={showWelcome}
              />
              <ActionRow
                icon="trash"
                tone="danger"
                title="Reset demo data"
                sub="Restores the sample project and sessions in this browser. Never touches your Linux machine."
                onClick={() => setPending({ kind: 'reset' })}
              />
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void onFileChosen(e)}
            />
            {problem && (
              <div className="banner error st-banner" role="alert" ref={problemRef}>
                <Icon name="alert" size={18} />
                <div className="st-banner-body">
                  <span>{problem.message}</span>
                  <div className="st-banner-actions">
                    {problem.action && (
                      <button type="button" className="btn small primary" onClick={problem.action.run}>
                        {problem.action.label}
                      </button>
                    )}
                    <button type="button" className="btn small ghost" onClick={() => setProblem(null)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Section>

          <AboutSection />
        </div>
      </div>

      {pending?.kind === 'reload' && (
        <ConfirmSheet
          title="Reload Orbit?"
          message={
            <UnsavedWarning prefix="Checking the connection reloads Orbit." fallback="Orbit will reload." />
          }
          confirmLabel="Reload anyway"
          destructive
          onConfirm={() => window.location.reload()}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'import' && (
        <ConfirmSheet
          title="Import this backup?"
          message={<ImportSummary backup={pending.backup} />}
          confirmLabel="Import and reload"
          onConfirm={() => void runImport(pending.backup)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'reset' && (
        <ConfirmSheet
          title="Reset demo data?"
          message={
            <div className="st-sheet-text">
              <p>
                This restores the sample project and the sample Antigravity sessions saved in this browser, and clears
                the Recent list on the home screen. Your preferences stay as they are.
              </p>
              <p>
                <strong>It never touches your Linux machine</strong>: files, terminals and Antigravity sessions there
                are not changed.
                {host && ' You’re connected to it now, so this only tidies up demo data left in this browser.'}
              </p>
              {!host && <UnsavedWarning />}
            </div>
          }
          confirmLabel="Reset demo data"
          destructive
          onConfirm={runReset}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Building blocks */

const CHAPTERS = ['Connection', 'Appearance', 'Orb', 'Cloud AI', 'AI models', 'Terminal', 'Split view (iPad)', 'Keyboard shortcuts', 'Usage', 'Data & storage', 'About'];

function ActionRow({
  icon,
  title,
  sub,
  tone,
  onClick,
}: {
  icon: IconName;
  title: string;
  sub: string;
  tone?: 'danger';
  onClick: () => void;
}) {
  return (
    <button type="button" className={`row st-row st-action ${tone === 'danger' ? 'st-danger' : ''}`} onClick={onClick}>
      <span className={`st-icon ${tone === 'danger' ? 'st-icon-danger' : 'st-icon-accent'}`} aria-hidden>
        <Icon name={icon} size={18} />
      </span>
      <span className="st-main">
        <span className="st-title">{title}</span>
        <span className="st-sub">{sub}</span>
      </span>
    </button>
  );
}

/** Lists apps with unsaved work (from their App Switcher summaries), if any. */
function UnsavedWarning({ prefix, fallback }: { prefix?: string; fallback?: string }) {
  const apps = appsWithUnsavedWork();
  if (apps.length === 0) return fallback ? <p className="st-sheet-p">{fallback}</p> : null;
  const names = apps.join(' and ');
  return (
    <p className="st-sheet-p st-warn">
      {prefix ? `${prefix} ` : ''}
      {names} {apps.length === 1 ? 'has' : 'have'} unsaved changes, which may be lost. Save them first if you want to
      keep them.
    </p>
  );
}

function ImportSummary({ backup }: { backup: OrbitExport }) {
  const keys = Object.keys(backup.data);
  const when = new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="st-sheet-text">
      <p>
        Backup from <strong>{when}</strong> with {keys.length} item{keys.length === 1 ? '' : 's'}:{' '}
        {describeKeys(keys).join(', ')}.
      </p>
      <p>
        It replaces Orbit’s preferences and demo data in this browser, then Orbit reloads. Nothing on your Linux
        machine changes.
      </p>
      <UnsavedWarning />
    </div>
  );
}

/* ------------------------------------------------------------------ Sections */

const DEMO_REASONS: Record<string, string> = {
  'machine-off': 'When Orbit started, your Linux machine was off and you chose demo mode.',
  unreachable:
    'When Orbit started, your Linux machine couldn’t be reached (it may have been starting up or reported a problem), and you chose demo mode.',
  'no-backend':
    'This copy of Orbit isn’t running behind your workspace site (for example, a local or static preview), so there is no Linux machine to connect to.',
  chosen: 'You chose demo mode.',
};

function ConnectionSection({ onReconnect }: { onReconnect: () => void }) {
  const host = connection.mode === 'host';
  const reason = connection.demoReason;
  return (
    <Section
      title="Connection"
      caption={
        host
          ? undefined
          : reason === 'no-backend'
            ? 'Connecting reloads Orbit and checks again. Without your workspace site behind it, Orbit opens in demo mode again; open Orbit from your workspace site to use your Linux machine.'
            : 'Connecting reloads Orbit and checks again. If your Linux machine is off, you’ll be offered to turn it on.'
      }
    >
      <div className="list">
        <div className="row st-row st-top">
          <span className={`st-icon ${host ? 'st-icon-ok' : 'st-icon-demo'}`} aria-hidden>
            <Icon name={host ? 'check' : 'wifiOff'} size={18} />
          </span>
          <div className="st-main">
            <span className="st-title st-strong">
              {host ? 'Connected to your Linux machine' : 'Not connected to your Linux machine'}
            </span>
            <span className="st-sub">Mode: {connection.label}</span>
          </div>
        </div>
        <div className="row st-row st-col">
          <p className="st-text">{connection.detail}</p>
          {!host && (
            <p className="st-text">
              <strong>Why:</strong> {(reason && DEMO_REASONS[reason]) ?? 'Orbit couldn’t find your Linux machine when it started.'}
            </p>
          )}
          <div className="st-buttons">
            {!host && (
              <button type="button" className="btn primary" onClick={onReconnect}>
                <Icon name="refresh" size={18} />
                Connect to Linux machine
              </button>
            )}
            <a className="btn ghost" href="/?choose=1">
              Switch workspace
            </a>
          </div>
        </div>
      </div>
    </Section>
  );
}

function AppearanceSection() {
  const settings = useShell((s) => s.settings);
  const updateSettings = useShell((s) => s.updateSettings);
  const ids = { accent: useId(), wallpaper: useId(), text: useId() };
  const pct = Math.round(settings.textScale * 100);
  const accent = ACCENTS.find((a) => a.id === settings.accent);

  return (
    <Section
      title="Appearance"
      caption="Motion: Auto picks Full or Lite for your device and follows its Reduce Motion setting. Full is the bounciest. Lite keeps short, light movement. Off turns animation off."
    >
      <div className="list">
        <div className="row st-row st-wrap">
          <span className="st-label">Theme</span>
          <div className="st-control">
            <Segmented label="Theme" value={settings.theme} options={THEMES} onChange={(theme) => updateSettings({ theme })} />
          </div>
        </div>

        <div className="row st-row st-wrap">
          <div className="st-main st-shrink">
            <span className="st-label" id={ids.accent}>
              Accent colour
            </span>
            <span className="st-sub">{accent?.label}</span>
          </div>
          <div className="swatches st-control st-swatches" role="group" aria-labelledby={ids.accent}>
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

        <div className="row st-row st-col">
          <span className="st-label" id={ids.wallpaper}>
            Wallpaper
          </span>
          <div className="st-wallpapers" role="group" aria-labelledby={ids.wallpaper}>
            {WALLPAPERS.map((w) => {
              const on = settings.wallpaper === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  className="st-wp"
                  aria-pressed={on}
                  onClick={() => updateSettings({ wallpaper: w.id })}
                >
                  <span className="st-wp-preview" data-wp={w.id} aria-hidden>
                    <span className="st-wp-dock" />
                    {on && (
                      <span className="st-wp-check">
                        <Icon name="check" size={14} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="st-wp-name">{w.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="row st-row st-col">
          <div className="st-line">
            <label className="st-label" htmlFor={ids.text}>
              Text size
            </label>
            <span className="st-value" aria-hidden>
              {pct}%
            </span>
          </div>
          <div className="st-range-row">
            <button
              type="button"
              className="st-step st-a-small"
              aria-label="Smaller text"
              disabled={settings.textScale <= TEXT_MIN}
              onClick={() => updateSettings({ textScale: roundScale(settings.textScale - TEXT_STEP) })}
            >
              A
            </button>
            <input
              id={ids.text}
              className="range"
              type="range"
              min={TEXT_MIN}
              max={TEXT_MAX}
              step={TEXT_STEP}
              value={settings.textScale}
              aria-valuetext={`${pct}%`}
              onChange={(e) => updateSettings({ textScale: roundScale(Number(e.target.value)) })}
            />
            <button
              type="button"
              className="st-step st-a-large"
              aria-label="Larger text"
              disabled={settings.textScale >= TEXT_MAX}
              onClick={() => updateSettings({ textScale: roundScale(settings.textScale + TEXT_STEP) })}
            >
              A
            </button>
          </div>
          <div className="st-preview" aria-label="Text size preview" role="group">
            <p className="st-preview-title">Preview</p>
            <p className="st-preview-body">Your terminal, code and Antigravity chats, one tap away.</p>
            <p className="st-preview-small">Labels and captions scale with it.</p>
          </div>
        </div>

        <div className="row st-row st-wrap">
          <span className="st-label">Motion</span>
          <div className="st-control">
            <Segmented label="Motion" value={settings.motion} options={MOTIONS} onChange={(motion) => updateSettings({ motion, motionPicked: true })} />
          </div>
        </div>
        <label className="row st-row st-click">
          <span className="st-main">
            <span className="st-label">Tilt effects</span>
            <span className="st-sub">
              Light and depth follow how you hold your phone (or your mouse). On iPhone and iPad this asks once to use the motion sensor.
            </span>
          </span>
          <Toggle
            checked={settings.tilt && (!tiltNeedsPermission() || Boolean(settings.tiltGranted))}
            label="Tilt effects"
            onChange={(v) => {
              if (!v) return updateSettings({ tilt: false });
              void requestTiltPermission().then((ok) => updateSettings({ tilt: true, tiltGranted: ok || settings.tiltGranted }));
            }}
          />
        </label>
        <label className="row st-row st-click">
          <span className="st-main">
            <span className="st-label">Sounds</span>
            <span className="st-sub">Soft pops and chimes when you send, finish or hit a problem.</span>
          </span>
          <Toggle
            checked={settings.sound}
            label="Play sounds"
            onChange={(v) => {
              updateSettings({ sound: v });
              if (v) cue('pop');
            }}
          />
        </label>
        <label className="row st-row st-click">
          <span className="st-main">
            <span className="st-label">Vibration</span>
            <span className="st-sub">A light buzz for key moments. Works on Android; on iPhone it is best effort and may do nothing.</span>
          </span>
          <Toggle
            checked={settings.haptics}
            label="Vibrate"
            onChange={(v) => {
              updateSettings({ haptics: v });
              if (v) cue('pop');
            }}
          />
        </label>
      </div>
    </Section>
  );
}

/** The one "Show NSFW" switch for all of Orbit (Make, the Lab, soReal, the chat). */
function NsfwSection() {
  return (
    <Section
      title="NSFW"
      caption="NSFW pictures and videos are hidden everywhere in Orbit until you turn this on. Even then they stay blurred: keep your finger on one to see it (a video plays while you hold it). It turns off again every time you open Orbit. One that slipped through: hold it for a moment and it hides. One hidden by mistake: turn this on, open it and turn off its NSFW switch."
    >
      <div className="list">
        <div className="row st-row">
          <UncensoredSwitch />
        </div>
      </div>
    </Section>
  );
}

/** Shortcuts into the Store's shelves, so they're a tap away from Settings too. */
function AiModelsSection() {
  const launch = useShell((s) => s.launch);
  const sendIntent = useWorkspace((s) => s.sendIntent);
  const open = (shelf: 'chat' | 'makers') => {
    sendIntent({ app: 'store', type: 'open', shelf });
    launch('store');
  };
  return (
    <Section title="AI models" caption="They live on your AI machine. You can browse while it rests; adding waits until it's on.">
      <div className="list">
        <ActionRow icon="download" title="Chat models" sub="In the Store: add, remove, see the details" onClick={() => open('chat')} />
        <ActionRow icon="sparkle" title="Makers" sub="Picture and video makers, in the Store" onClick={() => open('makers')} />
      </div>
    </Section>
  );
}

function TerminalSection() {
  const size = useShell((s) => s.settings.terminalFontSize);
  const keys = useShell((s) => s.settings.terminalKeys);
  const typingBoxPref = useShell((s) => s.settings.terminalTypingBox);
  const columns = useShell((s) => s.settings.terminalColumns) || 0;
  const { isPhone } = useLayout();
  const typingBox = typingBoxPref ?? (isPhone && (window.matchMedia?.('(pointer: coarse)').matches ?? false));
  const updateSettings = useShell((s) => s.updateSettings);
  const labelId = useId();
  const setSize = (n: number) => updateSettings({ terminalFontSize: Math.min(TERM_MAX, Math.max(TERM_MIN, n)) });

  return (
    <Section title="Terminal">
      <div className="list">
        <div className="row st-row st-col">
          <div className="st-line">
            <span className="st-label" id={labelId}>
              Font size
            </span>
            <div className="st-stepper" role="group" aria-labelledby={labelId}>
              <button
                type="button"
                className="st-step"
                aria-label="Smaller terminal font"
                disabled={size <= TERM_MIN}
                onClick={() => setSize(size - 1)}
              >
                −
              </button>
              <output className="st-step-value" aria-live="polite">
                {size} px
              </output>
              <button
                type="button"
                className="st-step"
                aria-label="Larger terminal font"
                disabled={size >= TERM_MAX}
                onClick={() => setSize(size + 1)}
              >
                +
              </button>
            </div>
          </div>
          <div className="st-term-preview" style={{ fontSize: size }} aria-hidden>
            <span className="st-term-prompt">~/projects $</span> ls -la
          </div>
        </div>
        <label className="row st-row st-click">
          <span className="st-main">
            <span className="st-label">Touch key row</span>
            <span className="st-sub">Esc, Tab, Ctrl, arrows and common symbols above the on-screen keyboard.</span>
          </span>
          <Toggle checked={keys} label="Show the touch key row" onChange={(v) => updateSettings({ terminalKeys: v })} />
        </label>
        <label className="row st-row st-click">
          <span className="st-main">
            <span className="st-label">Typing box</span>
            <span className="st-sub">
              Type in a box above the keys and send with Return. You always see what you type. Off: type straight
              into the terminal. On by default on phones.
            </span>
          </span>
          <Toggle checked={typingBox} label="Use the typing box" onChange={(v) => updateSettings({ terminalTypingBox: v })} />
        </label>
        <div className="row st-row">
          <span className="st-main">
            <span className="st-label">Width</span>
            <span className="st-sub">
              Fit the screen, or a fixed number of columns (as many programs expect). Wider than the screen: swipe
              sideways to see the rest, pinch or tap Fit width to zoom out.
            </span>
          </span>
          <Segmented
            label="Terminal width"
            value={columns ? String(columns) : 'fit'}
            options={[
              { value: 'fit', label: 'Fit' },
              { value: '80', label: '80' },
              { value: '100', label: '100' },
              { value: '120', label: '120' },
            ]}
            onChange={(v) => updateSettings({ terminalColumns: v === 'fit' ? 0 : Number(v) })}
          />
        </div>
      </div>
    </Section>
  );
}

function SplitSection() {
  const { canSplit } = useLayout();
  const openSplit = useShell((s) => s.openSplit);
  return (
    <Section title="Split view (iPad)">
      <div className="list">
        <div className="row st-row st-col">
          <p className="st-text">
            On iPad, Code and Antigravity can sit side by side, so you can read the code while you chat about it. Drag
            the divider between them to resize, or focus it and use the arrow keys. With a keyboard,{' '}
            <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">⇧</kbd> <kbd className="kbd">\</kbd> toggles it.
          </p>
          {canSplit ? (
            <div className="st-buttons">
              <button type="button" className="btn primary" onClick={openSplit}>
                <Icon name="split" size={18} />
                Open Code + Chat
              </button>
            </div>
          ) : (
            <p className="st-note">
              <Icon name="info" size={18} />
              Available on iPad in wider layouts.
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

function ShortcutsSection() {
  return (
    <Section
      title="Keyboard shortcuts"
      caption="For hardware keyboards, such as an iPad Magic Keyboard. Safari and iPadOS reserve many ⌘ shortcuts, so Orbit uses Control + Shift instead."
    >
      <ul className="list st-ul">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="row st-row st-wrap">
            <span className="st-main st-shrink st-title">{s.action}</span>
            <span className="st-keys">
              <span className="visually-hidden">{spokenKeys(s.keys)}</span>
              <span className="st-keys-visual" aria-hidden>
                {s.keys.split(' ').map((k, i) => (
                  <kbd key={i} className="kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AboutSection() {
  const host = connection.mode === 'host';
  const parts: { icon: IconName; name: string; text: string; chip: ReactNode }[] = host
    ? [
        {
          icon: 'terminal',
          name: 'Terminal',
          text: 'A real shell on your Linux machine. It keeps running in tmux when you leave.',
          chip: <RealChip />,
        },
        {
          icon: 'code',
          name: 'Code',
          text: 'Edits your project files on the machine’s saved storage.',
          chip: <RealChip />,
        },
        {
          icon: 'sparkle',
          name: 'Antigravity',
          text: 'Runs the real Antigravity CLI (agy) on the machine.',
          chip: <RealChip />,
        },
        {
          icon: 'sliders',
          name: 'Preferences',
          text: 'Theme, text size and terminal options are saved in this browser.',
          chip: <span className="chip">This browser</span>,
        },
      ]
    : [
        {
          icon: 'terminal',
          name: 'Terminal',
          text: 'A simulated shell inside this browser. Commands never reach a server.',
          chip: <DemoChip text="Simulated" />,
        },
        {
          icon: 'code',
          name: 'Code',
          text: 'A sample project saved in this browser. It doesn’t sync to your other devices.',
          chip: <DemoChip text="Local files" title="Files are stored in this browser only." />,
        },
        {
          icon: 'sparkle',
          name: 'Antigravity',
          text: 'Sample sessions and canned replies. The real Antigravity CLI isn’t called.',
          chip: <DemoChip text="Simulated" />,
        },
        {
          icon: 'sliders',
          name: 'Preferences',
          text: 'Theme, text size and terminal options are saved in this browser.',
          chip: <span className="chip">This browser</span>,
        },
      ];

  return (
    <Section title="About">
      <div className="list">
        <div className="row st-row">
          <img className="st-about-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={40} height={40} />
          <div className="st-main">
            <span className="st-title st-strong">Orbit {VERSION}</span>
            <span className="st-sub">A touch-first workspace for your Linux machine.</span>
          </div>
        </div>
      </div>

      <h3 className="list-title st-heading st-subheading">
        {host ? 'What’s real right now (connected)' : 'Real or simulated right now (demo mode)'}
      </h3>
      <ul className="list st-ul">
        {parts.map((p) => (
          <li key={p.name} className="row st-row st-top">
            <span className="st-icon" aria-hidden>
              <Icon name={p.icon} size={18} />
            </span>
            <span className="st-main">
              <span className="st-title">{p.name}</span>
              <span className="st-sub">{p.text}</span>
            </span>
            <span className="st-chip">{p.chip}</span>
          </li>
        ))}
      </ul>

      <h3 className="list-title st-heading st-subheading">Antigravity CLI capabilities</h3>
      <ul className="list st-ul">
        {Object.entries(AGY_CAPABILITIES).map(([key, cap]) => (
          <li key={key} className="row st-row st-top">
            <span className="st-main">
              <span className="st-title">{CAPABILITY_LABELS[key] ?? key}</span>
              <span className="st-sub">{withCode(cap.note)}</span>
            </span>
            <span className="st-chip">
              <span className={STATUS[cap.status].chip}>{STATUS[cap.status].label}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="list-caption st-caption">
        Orbit only offers what the real Antigravity CLI (agy) is known to do. Unverified features stay off until
        they’re confirmed.
        {!host && ' In demo mode the replies are canned, but the controls match the real ones.'}
      </p>
    </Section>
  );
}

function RealChip() {
  return (
    <span className="chip ok">
      <span className="dot" aria-hidden />
      Real
    </span>
  );
}
