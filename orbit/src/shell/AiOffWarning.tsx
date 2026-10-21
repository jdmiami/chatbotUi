import { useCallback, useEffect, useRef, useState } from 'react';
import { useShell } from '../state/shell';
import { keepAiOn, onNotifyMessage, syncNotify } from '../services/notify';
import { AUTO_OFF } from '../services/autoOff';

/**
 * "Your AI machine turns off in 10 minutes": a banner with a Keep-on button while Orbit is open
 * (the AI machine also sends it as a notification, for when Orbit is closed). A tap on that
 * notification opens Orbit with ?keep=ai, which keeps the machine on right away.
 */
const WARN_MS = AUTO_OFF.warnMinutes * 60_000;

interface AiCard {
  id: string;
  state: string;
  offAt?: string | null;
}

export function AiOffWarning() {
  const toast = useShell((s) => s.toast);
  const [offAt, setOffAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState<number | null>(null); // the turn-off time "Let it rest" was tapped for
  const [busy, setBusy] = useState(false);
  const synced = useRef(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const ai = ((await res.json()) as { machines?: AiCard[] }).machines?.find((m) => m.id === 'ai');
      const on = ai?.state === 'on' || ai?.state === 'downloading';
      setOffAt(on && ai?.offAt ? Date.parse(ai.offAt) : null);
      // The AI machine keeps the list of devices to notify; sign this one up once it can hear it.
      if (on && !synced.current) synced.current = await syncNotify().catch(() => false);
    } catch {
      /* offline, or Orbit opened without the site */
    }
  }, []);

  const keep = useCallback(async () => {
    setBusy(true);
    try {
      const at = await keepAiOn(AUTO_OFF.keepOnMinutes);
      if (at) setOffAt(Date.parse(at));
      toast(at ? `AI machine stays on until ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'AI machine kept on', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  // Status every 2 minutes while Orbit is on screen; every 15 seconds for the countdown.
  useEffect(() => {
    void check();
    const poll = setInterval(() => document.visibilityState === 'visible' && void check(), 120_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const back = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', back);
    };
  }, [check]);

  // From the notification: opened with ?keep=ai, or tapped while Orbit was already open.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('keep') === 'ai') {
      url.searchParams.delete('keep');
      window.history.replaceState(window.history.state, '', url);
      void keep();
    }
    return onNotifyMessage((type) => (type === 'keep' ? void keep() : void check()));
  }, [keep, check]);

  const left = offAt === null ? null : offAt - now;
  if (left === null || left > WARN_MS || left <= 0 || hidden === offAt) return null;
  const minutes = Math.max(1, Math.round(left / 60_000));
  return (
    <div className="ai-offwarn glass" role="alert" data-testid="ai-offwarn">
      <p className="ai-offwarn-text">
        <strong>Your AI machine turns off in {minutes} min.</strong> Nothing is using it.
      </p>
      <div className="ai-offwarn-actions">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => void keep()}>
          Keep on {AUTO_OFF.keepOnMinutes} more min
        </button>
        <button type="button" className="btn small ghost" onClick={() => setHidden(offAt)}>
          Let it rest
        </button>
      </div>
    </div>
  );
}
