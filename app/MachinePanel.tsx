'use client';

import { useCallback, useEffect, useState } from 'react';

type State = 'unconfigured' | 'off' | 'starting' | 'on' | 'error' | 'unknown';
interface Status {
  state: State;
  costPerHour: number | null;
  canControl: boolean;
  detail?: string;
}

const LABEL: Record<State, string> = {
  unconfigured: 'Not set up',
  off: 'Off',
  starting: 'Starting…',
  on: 'On',
  error: 'Problem',
  unknown: 'Unknown',
};

/** Linux machine power: status, hourly cost, Turn on / Turn off. Polls while starting. */
export default function MachinePanel({ initial }: { initial: Status }) {
  const [status, setStatus] = useState<Status>(initial);
  const [busy, setBusy] = useState<null | 'start' | 'stop'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/machine', { cache: 'no-store' });
    if (res.status === 401) return void (window.location.href = '/login');
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    const ms = status.state === 'starting' || busy ? 5000 : 30000;
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [status.state, busy, refresh]);

  // Let the workspace buttons know whether the machine is usable.
  useEffect(() => {
    document.documentElement.dataset.machine = status.state;
  }, [status.state]);

  const act = async (action: 'start' | 'stop') => {
    setBusy(action);
    setError(null);
    setConfirmOff(false);
    try {
      const res = await fetch('/api/machine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setStatus(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cost = status.costPerHour != null ? `$${status.costPerHour.toFixed(2)}/hour while on` : null;

  return (
    <section className="machine-panel" aria-labelledby="machine-title">
      <div className="machine-row">
        <span className={`dot state-${status.state}`} aria-hidden />
        <div className="machine-text">
          <h2 id="machine-title">Linux machine</h2>
          <p className="muted" role="status" aria-live="polite">
            {busy === 'start' ? 'Turning on…' : busy === 'stop' ? 'Turning off…' : LABEL[status.state]}
            {cost && status.state !== 'unconfigured' ? ` · ${cost}` : ''}
          </p>
        </div>
        {status.canControl && (status.state === 'off' || status.state === 'error') && (
          <button type="button" onClick={() => act('start')} disabled={busy !== null}>
            Turn on
          </button>
        )}
        {status.canControl && (status.state === 'on' || status.state === 'starting') && (
          <button type="button" className="secondary" onClick={() => setConfirmOff(true)} disabled={busy !== null}>
            Turn off
          </button>
        )}
      </div>
      {status.state === 'starting' && (
        <p className="muted small">Usually ready in 1–3 minutes. This page updates by itself.</p>
      )}
      {status.state === 'off' && (
        <p className="muted small">Orbit and the Linux desktop need the machine on. Your saved files are kept while it&apos;s off.</p>
      )}
      {!status.canControl && status.detail && <p className="muted small">{status.detail}</p>}
      {status.canControl && status.state === 'error' && status.detail && <p className="error small">{status.detail}</p>}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {confirmOff && (
        <div className="confirm" role="alertdialog" aria-labelledby="off-title">
          <p id="off-title">Turn off the Linux machine? Open Orbit and desktop sessions disconnect. Saved files are kept.</p>
          <div className="row">
            <button type="button" onClick={() => act('stop')}>
              Turn off
            </button>
            <button type="button" className="secondary" onClick={() => setConfirmOff(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
