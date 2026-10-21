import { useCallback, useEffect, useState } from 'react';
import { useShell } from '../../state/shell';
import type { AiMachineStatus, LocalAi, StudioDownloads } from '../../services/ai/LocalAi';

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1e6))} MB`);
const rate = (b: number | null | undefined) => (b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB/s` : `${Math.round(b / 1e6)} MB/s`);
function eta(s: number | null | undefined) {
  if (s == null) return '—';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s % 3600) / 60)} min`;
}
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

const HEAD: Record<StudioDownloads['state'], string> = {
  downloading: 'Downloading',
  saving: 'Saving to cloud storage',
  paused: 'Paused',
  retrying: 'Trying again',
  starting: 'Starting',
  blocked: 'Stuck',
  idle: 'All done',
};

/**
 * The AI Store's download manager: everything coming down to the AI machine, how fast, what waits
 * behind what and why, what gave up, and what happened lately; pause and resume all of it. A copy of
 * the report goes to the clipboard to paste into a chat when something looks wrong.
 */
export function DownloadManager({ ai, status, machineOn, isActive }: { ai: LocalAi; status: AiMachineStatus | null; machineOn: boolean; isActive: boolean }) {
  const toast = useShell((s) => s.toast);
  const [d, setD] = useState<StudioDownloads | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      ai.studioDownloads().then(
        (r) => {
          setD(r);
          setError(null);
        },
        (err: Error) => setError(err.message),
      ),
    [ai],
  );
  useEffect(() => {
    if (!isActive || !machineOn) return;
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [isActive, machineOn, load]);

  const act = async (action: 'pause' | 'resume') => {
    setBusy(true);
    try {
      setD(await ai.setStudioDownloads(action));
      toast(action === 'pause' ? 'Downloads paused. What came down so far stays.' : 'Downloads resumed.', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const report = { at: new Date().toISOString(), machine: status?.state, chatModels: status?.pulling ?? null, ...d, log: d?.log.slice(-15) };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast('Report copied. Paste it into a chat to get help with it.', 'success');
    } catch {
      toast("Couldn't copy here. Take a screenshot of this page instead.", 'info');
    }
  };

  if (!machineOn)
    return (
      <section className="dm" aria-label="Downloads">
        <p className="dm-off">
          {status?.state === 'starting' || status?.state === 'downloading'
            ? 'Your AI machine is waking up. Downloads show here the moment it is on.'
            : 'Your AI machine is off: nothing downloads. Turn it on and everything carries on from where it stopped.'}
        </p>
      </section>
    );
  if (!d)
    return (
      <section className="dm" aria-label="Downloads">
        <p className="dm-off">{error ? `Can't read the downloads: ${error}` : 'Reading the downloads…'}</p>
      </section>
    );

  const c = d.current;
  const stuck = d.queue.filter((q) => q.problem);
  const waiting = d.queue.filter((q) => !q.problem);
  const pull = status?.pulling;
  return (
    <section className="dm" aria-label="Downloads">
      <div className="dm-head">
        <div>
          <p className="o5-kicker">Download manager</p>
          <h3 className="dm-title" role="status">
            {HEAD[d.state]}
            {d.state !== 'idle' && d.bytesLeft ? <span className="ai-muted"> · {gb(d.bytesLeft)} to go</span> : null}
          </h3>
        </div>
        <div className="dm-actions">
          {d.paused ? (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void act('resume')}>
              Resume all
            </button>
          ) : d.state !== 'idle' && d.state !== 'blocked' ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void act('pause')}>
              Pause all
            </button>
          ) : null}
          {!d.paused && stuck.length > 0 && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void act('resume')}>
              Try stuck ones again
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => void copy()}>
            Copy report
          </button>
        </div>
      </div>

      <p className="dm-why" aria-label="What is happening">
        {d.bottleneck}
      </p>

      <dl className="dm-stats">
        <div>
          <dt>Speed</dt>
          <dd>{rate(c?.bytesPerSec)}</dd>
        </div>
        <div>
          <dt>Time left</dt>
          <dd>{eta(d.etaSeconds)}</dd>
        </div>
        <div>
          <dt>Network in</dt>
          <dd>{rate(d.network?.rxPerSec)}</dd>
        </div>
        <div>
          <dt>Network out</dt>
          <dd>{rate(d.network?.txPerSec)}</dd>
        </div>
        <div>
          <dt>Disk free</dt>
          <dd>{d.diskFree == null ? '—' : gb(d.diskFree)}</dd>
        </div>
        <div>
          <dt>Files done</dt>
          <dd>{d.done}</dd>
        </div>
      </dl>

      {c && (
        <div className="dm-card" aria-label={`Now: ${c.name}`}>
          <p className="dm-card-name">
            <strong>{c.name}</strong>
            <span className="ai-muted"> {c.saving ? 'saving to cloud storage' : `from ${c.source}`}</span>
          </p>
          {c.makers.length > 0 && <p className="ai-muted dm-for">For {c.makers.join(', ')}</p>}
          <div className="ai-bar" aria-hidden>
            <span style={{ width: `${c.percent}%` }} />
          </div>
          <p className="dm-card-nums">
            <span>
              {gb(c.completed)} of {gb(c.total)} · {c.percent}%
            </span>
            <span>
              {rate(c.bytesPerSec)} · {eta(c.etaSeconds)} left
            </span>
          </p>
        </div>
      )}

      {pull && (
        <div className="dm-card" aria-label="Chat models">
          <p className="dm-card-name">
            <strong>Chat models</strong>
            <span className="ai-muted">
              {' '}
              {pull.model}
              {pull.status ? ` · ${pull.status}` : ''}
            </span>
          </p>
          <div className="ai-bar" aria-hidden>
            <span style={{ width: `${pull.percent}%` }} />
          </div>
          <p className="dm-card-nums">
            <span>{pull.percent}%</span>
            <span>Alongside the makers</span>
          </p>
        </div>
      )}

      {stuck.length > 0 && (
        <>
          <h4 className="dm-sub">Stuck ({stuck.length})</h4>
          <ul className="dm-list" aria-label="Stuck downloads">
            {stuck.map((q) => (
              <li key={q.name} className="dm-stuck">
                <span className="dm-name">{q.name}</span>
                <span className="ai-muted">{q.problem}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {waiting.length > 0 && (
        <>
          <h4 className="dm-sub">Next in line ({waiting.length})</h4>
          <ol className="dm-list" aria-label="Next in line">
            {waiting.map((q) => (
              <li key={q.name}>
                <span className="dm-name">{q.name}</span>
                <span className="ai-muted">
                  {gb(q.size)}
                  {q.have ? ` · ${gb(q.have)} already here` : ''}
                  {q.makers.length ? ` · for ${q.makers.join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {d.log.length > 0 && (
        <>
          <h4 className="dm-sub">What happened</h4>
          <ol className="dm-log" aria-label="What happened" reversed>
            {[...d.log].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`} data-kind={e.kind}>
                <time dateTime={e.at}>{time(e.at)}</time>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
