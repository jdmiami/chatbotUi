import { useCallback, useEffect, useState } from 'react';
import { useShell } from '../../state/shell';
import { cloudStatus, type CloudStatus } from '../../services/ai/CloudAi';
import { Segmented, Toggle } from '../../ui/components';
import { Section } from './parts';
import { disableNotify, enableNotify, notifyState, type NotifyState } from '../../services/notify';
import { AUTO_OFF, autoOffMinutesOf, autoOffSentence, untilText } from '../../services/autoOff';

/**
 * What the status pill used to show at the top of every screen, now here: money (balance, spending
 * right now, today), and each machine (on or off, cost per hour, how long it has been on, when it
 * turns itself off, how busy it is), with the switches. Read from the site's /api/status.
 */

interface Machine {
  id: 'ai' | 'linux';
  name: string;
  state: string;
  detail?: string;
  costPerHour: number | null;
  uptimeSeconds: number | null;
  offAt: string | null;
  heldUntil?: string | null;
  autoOff: boolean;
  /** The one auto-off rule's minutes (the same for every machine). */
  autoOffMinutes?: number;
  gpuName?: string | null;
  live: { cpu: number | null; memory: number | null; gpu: number | null; gpuMemory: number | null } | null;
}
interface Status {
  money: { balance: number | null; spendPerHour: number | null; today: number | null; spendLimit: number | null } | null;
  machines: Machine[];
  canPower?: boolean;
  /** The one auto-off rule (the site's lib/autoOff.ts). */
  autoOff?: { minutes: number; warnMinutes: number; keepOnMinutes: number; maxHoldMinutes: number };
}

const usd = (n: number | null | undefined, digits = 2) => (typeof n === 'number' ? `$${n.toFixed(digits)}` : '—');
const STATE: Record<string, string> = { on: 'On', off: 'Off', starting: 'Starting', downloading: 'Getting models', error: 'Problem', unknown: 'Unknown' };

function duration(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function UsageSection({ active }: { active: boolean }) {
  const toast = useShell((s) => s.toast);
  const [status, setStatus] = useState<Status | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Turning a machine off ends what runs on it (terminals, jobs): the first tap asks, the second does it.
  const [armed, setArmed] = useState<'ai' | 'linux' | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 15_000);
    return () => clearInterval(t);
  }, [active, load]);

  const minutes = autoOffMinutesOf(status?.autoOff?.minutes, status?.machines[0]?.autoOffMinutes);
  const step = status?.autoOff?.keepOnMinutes ?? AUTO_OFF.keepOnMinutes;
  const act = async (machine: 'ai' | 'linux', action: 'start' | 'stop' | 'extend') => {
    setBusy(`${machine}:${action}`);
    try {
      const res = await fetch('/api/status', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ machine, action, minutes: step }),
      });
      const body = (await res.json().catch(() => ({}))) as Status & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setStatus(body);
      if (action === 'extend') toast(`The ${machine === 'ai' ? 'AI' : 'Linux'} machine stays on ${step} more minutes.`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Usage" caption={`Each machine ${autoOffSentence(minutes).toLowerCase()} “Keep on” adds ${step} minutes.`}>
      <div className="list st-usage-list" aria-busy={!status && !unavailable}>
        {unavailable ? (
          <div className="row st-row">
            <p className="st-text">Money and machines show here when Orbit is opened from your workspace site.</p>
          </div>
        ) : !status ? (
          <div className="row st-row">
            <p className="st-text">Loading…</p>
          </div>
        ) : (
          <>
            <div className="row st-row st-col" aria-label="Money">
              <span className="st-label">Money</span>
              <dl className="st-money">
                <div>
                  <dt>Balance</dt>
                  <dd>{usd(status.money?.balance)}</dd>
                </div>
                <div>
                  <dt>Spending now</dt>
                  <dd>{usd(status.money?.spendPerHour, 3)}/h</dd>
                </div>
                <div>
                  <dt>Today</dt>
                  <dd>{usd(status.money?.today)}</dd>
                </div>
              </dl>
            </div>
            {status.machines.map((m) => {
              const on = m.state === 'on' || m.state === 'downloading';
              // Starting can already bill: show its price and time too.
              const billing = on || m.state === 'starting';
              const until = m.autoOff && on ? untilText(m.offAt, now, m.heldUntil) : null;
              return (
                <div key={m.id} className="row st-row st-col st-machine" data-state={m.state} aria-label={m.name}>
                  <div className="st-line">
                    <span className="st-label">{m.name}</span>
                    <span className="st-chip" data-state={m.state}>
                      {STATE[m.state] ?? m.state}
                    </span>
                  </div>
                  <p className="st-sub">
                    {[
                      billing && m.costPerHour ? `${usd(m.costPerHour)}/h` : null,
                      billing && m.uptimeSeconds ? `on for ${duration(m.uptimeSeconds)}` : null,
                      until,
                      m.gpuName,
                      m.detail,
                    ]
                      .filter(Boolean)
                      .join(' · ') || (m.state === 'off' ? 'Not running, costs nothing per hour' : on ? 'Running' : STATE[m.state] ?? m.state)}
                  </p>
                  {on && m.live && (
                    <div className="st-meters">
                      {(
                        [
                          ['CPU', m.live.cpu],
                          ['Memory', m.live.memory],
                          ['GPU', m.live.gpu],
                          ['GPU memory', m.live.gpuMemory],
                        ] as const
                      )
                        .filter(([, v]) => v != null)
                        .map(([k, v]) => (
                          <div key={k} className="st-meter">
                            <span>{k}</span>
                            <meter min={0} max={100} value={v ?? 0} aria-label={`${m.name} ${k}`} />
                            <span>{Math.round(v ?? 0)}%</span>
                          </div>
                        ))}
                    </div>
                  )}
                  {status.canPower !== false && (
                    <div className="st-banner-actions">
                      {on || m.state === 'starting' ? (
                        <button
                          type="button"
                          className={armed === m.id ? 'btn small danger' : 'btn small'}
                          disabled={busy !== null}
                          onClick={() => {
                            if (armed !== m.id) return setArmed(m.id);
                            setArmed(null);
                            void act(m.id, 'stop');
                          }}
                        >
                          {armed === m.id ? (m.id === 'linux' ? 'Tap again: ends terminals' : 'Tap again to turn off') : 'Turn off'}
                        </button>
                      ) : (
                        <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void act(m.id, 'start')}>
                          Turn on
                        </button>
                      )}
                      {m.autoOff && on && (
                        <button type="button" className="btn small ghost" disabled={busy !== null} onClick={() => void act(m.id, 'extend')}>
                          Keep on {step} more min
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </Section>
  );
}

/** The orb: on or off, and whether it follows what matters or stays where you put it. */
export function OrbSection() {
  const settings = useShell((s) => s.settings);
  const updateSettings = useShell((s) => s.updateSettings);
  const on = settings.orb !== false;
  return (
    <Section
      title="Orb"
      caption="Tap the orb to talk. Hold it (or press hard) to tell it what to do: it uses Orbit for you and asks before anything that costs money or can't be undone. Fling it to a side to park it, throw it off the bottom to tuck it away, shake your phone to call it back or stop it. Ctrl ⇧ Space opens it from a keyboard."
    >
      <div className="list">
        <label className="row st-row st-click">
          <span className="st-main">
            <span className="st-label">Show the orb</span>
            <span className="st-sub">On every screen, beside what matters most.</span>
          </span>
          <Toggle checked={on} label="Show the orb" onChange={(v) => updateSettings({ orb: v })} />
        </label>
        {on && (
          <label className="row st-row st-click">
            <span className="st-main">
              <span className="st-label">Follow what matters</span>
              <span className="st-sub">Off: it stays where you put it.</span>
            </span>
            <Toggle checked={settings.orbFollow !== false} label="Orb follows what matters" onChange={(v) => updateSettings({ orbFollow: v })} />
          </label>
        )}
      </div>
    </Section>
  );
}

/** Cloud AI: NVIDIA's free models for quick jobs, so the orb is smart even with the AI machine off. */
export function CloudAiSection() {
  const on = useShell((s) => s.settings.cloudAi !== false);
  const writeHelp = useShell((s) => s.settings.writeHelp !== false);
  const prefer = useShell((s) => s.settings.cloudPrefer);
  const updateSettings = useShell((s) => s.updateSettings);
  const [status, setStatus] = useState<CloudStatus | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void cloudStatus(true).then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [prefer]);
  const providers = status?.providers ?? [];
  const state = status === undefined ? 'Checking…' : status?.configured ? 'Ready' : 'Not set up on the site yet';
  return (
    <Section
      title="Cloud AI"
      caption="Quick jobs (the orb planning a step, help writing, reading what's on screen), and chats while your AI machine is off, use free cloud models: NVIDIA first, then a backup if it is busy or down. Pictures and videos stay on your AI machine."
    >
      <div className="list">
        <label className="row st-row st-click">
          <span className="st-main">
            <span className="st-label">Use cloud AI</span>
            <span className="st-sub">Off: everything waits for your AI machine.</span>
          </span>
          <Toggle checked={on} label="Use cloud AI" onChange={(v) => updateSettings({ cloudAi: v })} />
        </label>
        <div className="row st-row" data-testid="cloud-ai-status">
          <span className="st-main">
            <span className="st-label">Status</span>
            <span className="st-sub">{on ? state : 'Off'}</span>
          </span>
        </div>
        {on && providers.length > 1 && (
          <div className="row st-row st-wrap">
            <span className="st-main st-shrink">
              <span className="st-label">Try first</span>
              <span className="st-sub">The others are the backups, tried in turn when this one is busy or down.</span>
            </span>
            <Segmented
              label="Cloud AI to try first"
              value={providers.some((p) => p.id === prefer) ? prefer! : providers[0].id}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => updateSettings({ cloudPrefer: id })}
            />
          </div>
        )}
        {on && (
          <label className="row st-row st-click">
            <span className="st-main">
              <span className="st-label">Writing help</span>
              <span className="st-sub">Grey ghost text finishes your sentence (Tab or tap to take it); select words to rewrite them.</span>
            </span>
            <Toggle checked={writeHelp} label="Writing help" onChange={(v) => updateSettings({ writeHelp: v })} />
          </label>
        )}
        {on && (
          <div className="row st-row">
            <span className="st-main">
              <span className="st-label">What is sent</span>
              <span className="st-sub">
                What you ask, the text on screen and, when it needs to look, a screenshot. Never passwords: password boxes are left out
                and anything that looks like a key or token is blanked first. The cloud keys stay on the site, never in this browser.
              </span>
            </span>
          </div>
        )}
      </div>
    </Section>
  );
}

const NOTIFY_NOTE: Record<NotifyState, string> = {
  unsupported: 'This browser cannot show notifications. Orbit still warns you on screen while it is open.',
  'home-screen': 'On iPhone and iPad: tap Share, then Add to Home Screen, open Orbit from your Home Screen, and turn this on there.',
  blocked: 'Notifications are blocked for Orbit. Allow them in your device settings (Notifications → Orbit) or the browser’s site settings.',
  off: 'Off: you only see the warning while Orbit is open.',
  on: `On: this device gets a notification ${AUTO_OFF.warnMinutes} minutes before the AI machine turns itself off. Tap it to keep the machine on.`,
};

/** "Turning off in 10 minutes" notifications from the AI machine. */
export function NotifySection() {
  const toast = useShell((s) => s.toast);
  const minutes = useAutoOffMinutes();
  const [state, setState] = useState<NotifyState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void notifyState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  const change = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const r = await enableNotify();
        setState(r.state);
        if (r.state === 'on') toast(r.saved ? 'Notifications on' : 'Notifications on. Your AI machine learns about this device the next time it is on.', 'success');
      } else {
        await disableNotify();
        setState('off');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
      setState(await notifyState());
    } finally {
      setBusy(false);
    }
  };
  const canToggle = state === 'on' || state === 'off';
  return (
    <Section
      title="Notifications"
      caption={`The AI machine ${autoOffSentence(minutes).toLowerCase()} The countdown starts once every download has finished. ${AUTO_OFF.warnMinutes} minutes before, it can tell you.`}
    >
      <div className="list">
        <label className={canToggle ? 'row st-row st-click' : 'row st-row'}>
          <span className="st-main">
            <span className="st-label">Before the AI machine turns off</span>
            <span className="st-sub" data-testid="notify-state">{state ? NOTIFY_NOTE[state] : 'Checking…'}</span>
          </span>
          {canToggle && <Toggle checked={state === 'on'} label="Notify before the AI machine turns off" onChange={(v) => !busy && void change(v)} />}
        </label>
      </div>
    </Section>
  );
}

/** The auto-off minutes from the site (the shared default until it answers). */
function useAutoOffMinutes() {
  const [minutes, setMinutes] = useState<number>(AUTO_OFF.defaultMinutes);
  useEffect(() => {
    let live = true;
    void fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<Status>) : null))
      .then((s) => live && s && setMinutes(autoOffMinutesOf(s.autoOff?.minutes, s.machines?.[0]?.autoOffMinutes)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return minutes;
}
