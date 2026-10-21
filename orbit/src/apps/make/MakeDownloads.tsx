import { useCallback, useEffect, useState } from 'react';
import { useShell } from '../../state/shell';
import type { AiMachineStatus, LocalAi, StudioMakerInfo } from '../../services/ai/LocalAi';
import { canResume, progressText, progressWhy } from '../ai/makerCatalog';

/**
 * The bar at the top of Make: what is still loading. While the AI machine wakes up, its models
 * coming down; once it is on, every maker still downloading, with its own bar, and Resume on one
 * that stopped (nothing fetching it, or it gave up on a full disk).
 */
export function MakeDownloads({ ai, status, machineOn, isActive }: { ai: LocalAi; status: AiMachineStatus | null; machineOn: boolean; isActive: boolean }) {
  const toast = useShell((s) => s.toast);
  const [makers, setMakers] = useState<StudioMakerInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => ai.studioMakers().then(setMakers, () => {}), [ai]);
  const loading = makers.filter((m) => m.wanted && !m.installed);
  useEffect(() => {
    if (!isActive || !machineOn) return;
    void load();
    // Quicker while something is coming down.
    const t = setInterval(() => void load(), loading.length ? 4000 : 20000);
    return () => clearInterval(t);
  }, [isActive, machineOn, load, loading.length]);

  const resume = async (m: StudioMakerInfo) => {
    setBusy(m.id);
    try {
      setMakers(await ai.installStudioMaker(m.id));
      toast(`Resuming ${m.name}.`, 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const waking = status?.state === 'starting' || status?.state === 'downloading';
  if (waking && !machineOn) {
    const pull = status?.pulling;
    return (
      <section className="make-loading" role="status" aria-label="Loading">
        <p className="make-loading-head">
          {status?.state === 'starting' ? 'Your AI machine is starting…' : 'Loading the models…'}
          {pull ? <span className="ai-muted"> {pull.model}: {pull.percent}%</span> : null}
        </p>
        <div className={`ai-bar${pull ? '' : ' make-bar-busy'}`} aria-hidden>
          <span style={{ width: `${pull ? pull.percent : 30}%` }} />
        </div>
      </section>
    );
  }
  if (!machineOn || !loading.length) return null;
  const all = loading.reduce((t, m) => t + (m.size || 0), 0);
  const done = loading.reduce((t, m) => t + ((m.size || 0) * m.percent) / 100, 0);
  const overall = all ? Math.floor((done / all) * 100) : Math.floor(loading.reduce((t, m) => t + m.percent, 0) / loading.length);
  return (
    <section className="make-loading" aria-label="Makers loading">
      <p className="make-loading-head" role="status">
        {loading.length === 1 ? `Loading ${loading[0].name}` : `Loading ${loading.length} makers`}
        <span className="ai-muted"> · {overall}%</span>
      </p>
      <ul className="make-loading-list">
        {loading.map((m) => (
          <li key={m.id} title={progressWhy(m, machineOn)}>
            <span className="make-loading-name">{m.name}</span>
            <div className="ai-bar" aria-hidden>
              <span style={{ width: `${m.percent}%` }} />
            </div>
            <span className="make-loading-pct">{progressText(m, machineOn)}</span>
            {canResume(m, machineOn) ? (
              <button type="button" className="btn small primary" disabled={busy === m.id} onClick={() => void resume(m)} aria-label={`Resume ${m.name}`}>
                Resume
              </button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
