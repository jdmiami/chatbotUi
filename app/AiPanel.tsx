'use client';

import { useCallback, useEffect, useState } from 'react';

type State = 'unconfigured' | 'off' | 'starting' | 'downloading' | 'on' | 'error';
interface Status {
  state: State;
  costPerHour: number | null;
  detail?: string;
  pulling?: { model: string; percent: number } | null;
  models?: string[];
  url?: string;
  consoleUrl?: string;
}

const LABEL: Record<State, string> = {
  unconfigured: 'Not set up',
  off: 'Off',
  starting: 'Starting…',
  downloading: 'Downloading models…',
  on: 'On',
  error: 'Problem',
};

/** AI machine (GPU) power and links: status, cost, Turn on / Turn off, open it directly, Runpod page. */
export default function AiPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/ai', { cache: 'no-store' });
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
    const moving = status?.state === 'starting' || status?.state === 'downloading';
    const t = setInterval(refresh, moving ? 5000 : 30000);
    return () => clearInterval(t);
  }, [refresh, status?.state]);

  const act = async (action: 'start' | 'stop') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai', {
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
      setBusy(false);
    }
  };

  if (!status || status.state === 'unconfigured') return null;
  const dot = status.state === 'downloading' ? 'starting' : status.state;
  const cost = `$${(status.costPerHour ?? 0.59).toFixed(2)}/hour while on, off by itself after 30 min unused`;

  return (
    <section className="machine-panel" aria-labelledby="ai-machine-title">
      <div className="machine-row">
        <span className={`dot state-${dot}`} aria-hidden />
        <div className="machine-text">
          <h2 id="ai-machine-title">AI machine (GPU)</h2>
          <p className="muted" role="status" aria-live="polite">
            {busy ? 'Working…' : LABEL[status.state]}
            {status.pulling ? ` · ${status.pulling.model} ${status.pulling.percent}%` : ''}
          </p>
        </div>
        {(status.state === 'off' || status.state === 'error') && (
          <button type="button" onClick={() => void act('start')} disabled={busy}>
            Turn on
          </button>
        )}
        {(status.state === 'on' || status.state === 'starting' || status.state === 'downloading') && (
          <button type="button" className="secondary" onClick={() => void act('stop')} disabled={busy}>
            Turn off
          </button>
        )}
      </div>
      <p className="muted small">{cost}.</p>
      {status.models && status.models.length > 0 && <p className="muted small">Models: {status.models.join(', ')}</p>}
      <div className="row ai-links">
        {status.url && (
          <a className="button secondary" href={status.state === 'on' ? status.url : '/ai'} target="_blank" rel="noopener">
            Open AI machine ↗
          </a>
        )}
        {status.consoleUrl && (
          <a className="button secondary" href={status.consoleUrl} target="_blank" rel="noopener">
            Runpod page ↗
          </a>
        )}
      </div>
      {status.state === 'error' && status.detail && <p className="error small">{status.detail}</p>}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
