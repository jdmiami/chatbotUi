'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type State = 'unconfigured' | 'off' | 'starting' | 'downloading' | 'on' | 'error';
interface Status {
  state: State;
  costPerHour: number | null;
  detail?: string;
  pulling?: { model: string; percent: number } | null;
  models?: string[];
  idle?: { limitMinutes: number; idleMinutes: number } | null;
}

const STEPS: { key: string; label: string }[] = [
  { key: 'power', label: 'Turning on the GPU machine' },
  { key: 'services', label: 'Starting the AI services' },
  { key: 'models', label: 'Getting the models ready' },
  { key: 'open', label: 'Opening' },
];

function stepIndex(s: Status | null, opening: boolean) {
  if (opening) return 3;
  if (!s || s.state === 'off') return 0;
  if (s.state === 'starting') return 1;
  if (s.state === 'downloading') return 2;
  return 3;
}

/**
 * Opens the AI playground (target "chat": Open WebUI on the AI machine) or the coding workspace
 * (target "code": VS Code + agent on the Linux machine, with the AI machine as its model). Turns the
 * AI machine on when needed and shows progress until it's ready, then signs in and goes there.
 */
export default function AiLauncher({ target, next }: { target: 'chat' | 'code'; next?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [codeNote, setCodeNote] = useState<string | null>(null);
  const started = useRef(false);
  const leaving = useRef(false);

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) window.location.href = '/login';
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  };

  const go = useCallback(async () => {
    if (leaving.current) return;
    setOpening(true);
    try {
      const { url } = await post(target === 'chat' ? '/api/ai/session' : '/api/code/session', { next });
      if (url) {
        leaving.current = true;
        window.location.href = url;
      } else {
        setOpening(false);
        if (target === 'code') setCodeNote('The Linux machine needs to be on for coding. Turn it on from the start screen.');
      }
    } catch (err) {
      setOpening(false);
      setError((err as Error).message);
    }
  }, [target, next]);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/ai', { cache: 'no-store' });
    if (res.status === 401) return void (window.location.href = '/login');
    if (!res.ok) return;
    const s: Status = await res.json();
    setStatus(s);
    if (target === 'chat' && s.state === 'on') void go();
  }, [go, target]);

  const start = useCallback(async () => {
    setError(null);
    try {
      setStatus(await post('/api/ai', { action: 'start' }));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // First look: turn the machine on if it's off. Coding opens right away (the editor doesn't need
  // the model to load; the agent uses it once the AI machine is up).
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/ai', { cache: 'no-store' });
      if (res.status === 401) return void (window.location.href = '/login');
      const s: Status = await res.json().catch(() => ({ state: 'error', costPerHour: null }));
      setStatus(s);
      if (started.current) return;
      started.current = true;
      if (s.state === 'off' || s.state === 'error') await start();
      if (target === 'code') await go();
      else if (s.state === 'on') await go();
    })();
  }, [go, start, target]);

  useEffect(() => {
    if (!status || status.state === 'unconfigured') return;
    const busy = status.state === 'starting' || status.state === 'downloading' || status.state === 'off';
    const t = setInterval(refresh, busy ? 4000 : 20000);
    return () => clearInterval(t);
  }, [status, refresh]);

  const stop = async () => {
    setError(null);
    try {
      setStatus(await post('/api/ai', { action: 'stop' }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const idx = stepIndex(status, opening);
  const cost = status?.costPerHour != null ? `$${status.costPerHour.toFixed(2)}/hour while on` : '$0.59/hour while on';
  const title = target === 'chat' ? 'AI playground' : 'Coding with your own AI';

  return (
    <main className="center">
      <div className="card ai-card">
        <div className="brand">
          <span className="ai-glyph" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l2.2 5.3L20 10.5l-5.8 2.2L12 18l-2.2-5.3L4 10.5l5.8-2.2z" fill="currentColor" />
              <circle cx="19" cy="19" r="2" fill="currentColor" />
            </svg>
          </span>
          <h1>{title}</h1>
        </div>

        {status?.state === 'unconfigured' ? (
          <p className="muted">{status.detail}</p>
        ) : (
          <>
            <ol className="ai-steps" aria-live="polite">
              {STEPS.map((s, i) => (
                <li key={s.key} className={i < idx ? 'done' : i === idx ? 'now' : ''}>
                  <span className="ai-step-dot" aria-hidden />
                  <span>
                    {s.label}
                    {s.key === 'models' && i === idx && status?.pulling ? (
                      <span className="muted small ai-progress">
                        {' '}
                        · downloading {status.pulling.model} ({status.pulling.percent}%)
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {status?.pulling && (
              <div className="ai-bar" role="progressbar" aria-valuenow={status.pulling.percent} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${status.pulling.percent}%` }} />
              </div>
            )}
            <p className="muted small">
              {status?.state === 'starting' || status?.state === 'off'
                ? 'Usually 2–4 minutes. The very first start also downloads the models (about 40 GB), which can take 10–15 minutes.'
                : status?.state === 'downloading'
                  ? 'First start: downloading the models to the machine’s storage. This only happens once.'
                  : status?.state === 'on'
                    ? 'Ready.'
                    : ''}
            </p>
            <p className="muted small">
              {cost}. It turns itself off after {status?.idle?.limitMinutes ?? 30} minutes unused; your chats and models are kept.
            </p>
          </>
        )}

        {codeNote && <p className="error small">{codeNote}</p>}
        {status?.state === 'error' && status.detail && <p className="error small">{status.detail}</p>}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          {target === 'chat' && status?.state === 'downloading' && (
            <button type="button" onClick={() => void go()} disabled={opening}>
              Open now
            </button>
          )}
          {target === 'code' && (
            <button type="button" onClick={() => void go()} disabled={opening}>
              Open VS Code
            </button>
          )}
          {(status?.state === 'error' || error) && (
            <button type="button" onClick={() => void start()}>
              Try again
            </button>
          )}
          {status && status.state !== 'off' && status.state !== 'unconfigured' && (
            <button type="button" className="secondary" onClick={() => void stop()}>
              Turn off AI machine
            </button>
          )}
          <a className="button secondary" href="/?choose=1">
            Workspaces
          </a>
        </div>
      </div>
    </main>
  );
}
