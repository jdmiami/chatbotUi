import { useCallback, useEffect, useState } from 'react';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import type { AiMachineStatus, LocalAi, StudioMakerInfo } from '../../services/ai/LocalAi';
import { IconButton } from '../../ui/components';
import { aiMakers, canResume, catalogMaker, ordinal, pickGroups, progressText, progressWhy } from '../ai/makerCatalog';
import { formatSize } from '../ai/models';

/**
 * The bar at the top of Make: what is still loading. While the AI machine wakes up, its models
 * coming down; once it is on, every maker still downloading, with its own bar, and Resume on one
 * that stopped (nothing fetching it, or it gave up on a full disk). Hide puts it away for this set
 * of downloads (remembered on this device); it comes back when something new starts loading.
 *
 * The AI machine on GPU.ai loads nothing until you pick: here you pick what loads first (even while
 * it is still starting), what comes next, and move one to the front of the line. Every maker it can
 * run is there to pick, yours first, the rest by what they make.
 */
const HIDE_KEY = 'orbit:make:loading-hidden';

export function MakeDownloads({
  ai,
  status,
  machineOn,
  isActive,
  first: firstNow,
  onFirst,
}: {
  ai: LocalAi;
  status: AiMachineStatus | null;
  machineOn: boolean;
  isActive: boolean;
  /** What loads first while the machine starts, in order (Make keeps it: the makers menu sets it too). */
  first: string[];
  onFirst: (ids: string[]) => void;
}) {
  const toast = useShell((s) => s.toast);
  const [makers, setMakers] = useState<StudioMakerInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return localStorage.getItem(HIDE_KEY);
    } catch {
      return null;
    }
  });

  const load = useCallback(() => ai.studioMakers().then(setMakers, () => {}), [ai]);
  const loading = makers.filter((m) => m.wanted && !m.installed).sort((a, b) => (a.line ?? 99) - (b.line ?? 99));
  const loadable = makers.filter((m) => m.loadable);
  const picks = status?.picks;
  // While it starts, the full list stays folded: the makers menu (step 2) sets the order too, and the
  // list would fill a phone's screen.
  const [allOpen, setAllOpen] = useState(false);
  useEffect(() => {
    if (!isActive || !machineOn) return;
    void load();
    // Quicker while something is coming down, and at once when the makers menu puts one in line.
    const t = setInterval(() => void load(), loading.length ? 4000 : 20000);
    const now = () => void load();
    window.addEventListener('orbit:makers-changed', now);
    return () => {
      clearInterval(t);
      window.removeEventListener('orbit:makers-changed', now);
    };
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

  const pick = async (m: StudioMakerInfo, toFront = false) => {
    setBusy(m.id);
    try {
      setMakers(await ai.loadStudioMaker(m.id, toFront));
      toast(toFront ? `${m.name} loads next.` : `Loading ${m.name}.`, 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  /** While it starts: tap to add to (or take out of) what loads first, in the order tapped. */
  const pickEarly = (id: string) => onFirst(firstNow.includes(id) ? firstNow.filter((x) => x !== id) : [...firstNow, id]);

  const launch = useShell((s) => s.launch);
  const openManager = () => {
    useWorkspace.getState().sendIntent({ app: 'store', type: 'open', shelf: 'downloads' });
    launch('store');
  };

  const waking = status?.state === 'starting' || status?.state === 'downloading';
  // What this bar is about right now: the machine waking, or these makers. Hide applies to just that.
  const about = waking && !machineOn ? 'waking' : `${loading.map((m) => m.id).sort().join(',')}|${loadable.map((m) => m.id).sort().join(',')}`;
  const hide = () => {
    setHidden(about);
    try {
      localStorage.setItem(HIDE_KEY, about);
    } catch {
      /* private mode */
    }
  };
  const hideButton = <IconButton icon="close" label="Hide" onClick={hide} />;
  if (hidden === about) return null;

  if (waking && !machineOn) {
    const pull = status?.pulling;
    return (
      <section className="make-loading" role="status" aria-label="Loading">
        <p className="make-loading-head">
          <span>
            {status?.state === 'starting' ? 'Your AI machine is starting…' : 'Loading the models…'}
            {pull ? <span className="ai-muted"> {pull.model}: {pull.percent}%</span> : null}
          </span>
          {hideButton}
        </p>
        <div className={`ai-bar${pull ? '' : ' make-bar-busy'}`} aria-hidden>
          <span style={{ width: `${pull ? pull.percent : 30}%` }} />
        </div>
        {picks ? (
          <>
            <p className="make-pick-head make-pick-summary">
              <span>
                {firstNow.length
                  ? `Loads first: ${firstNow.map((id, i) => `${ordinal(i + 1)} ${catalogMaker(id)?.name ?? id}`).join(', ')}.`
                  : 'Nothing loads until you pick. Tap makers in step 2 in the order you want, or here.'}
              </span>
              <button type="button" className="make-loading-all" aria-expanded={allOpen} onClick={() => setAllOpen((o) => !o)}>
                {allOpen ? 'Fold the list' : 'All makers'}
              </button>
            </p>
            {allOpen && (
              <div className="make-pick-groups" role="group" aria-label="Pick what loads first">
                {pickGroups(aiMakers(), picks.library).map((g) => (
                  <div key={g.label} className="make-pick-group" role="group" aria-label={g.label}>
                    <p className="make-pick-label">{g.label}</p>
                    <div className="make-pick">
                      {g.makers.map((m) => {
                        const at = firstNow.indexOf(m.id);
                        return (
                          <button key={m.id} type="button" className="make-pick-chip" aria-pressed={at >= 0} onClick={() => pickEarly(m.id)}>
                            {at >= 0 ? <span className="make-pick-n">{ordinal(at + 1)}</span> : null}
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>
    );
  }
  if (!machineOn || (!loading.length && !loadable.length)) return null;
  const allButton = loadable.length ? (
    <button type="button" className="make-loading-all" aria-expanded={allOpen} onClick={() => setAllOpen((o) => !o)}>
      {allOpen ? 'Fold the list' : 'All makers'}
    </button>
  ) : null;
  const chips = loadable.length && allOpen ? (
    <div className="make-pick-groups" role="group" aria-label={loading.length ? 'Load next' : 'Pick what to load'}>
      {pickGroups(loadable, status?.picks?.library ?? []).map((g) => (
        <div key={g.label} className="make-pick-group" role="group" aria-label={g.label}>
          <p className="make-pick-label">{g.label}</p>
          <div className="make-pick">
            {g.makers.map((m) => (
              <button key={m.id} type="button" className="make-pick-chip" disabled={busy === m.id} onClick={() => void pick(m)}>
                {m.name}
                {m.size ? <span className="ai-muted"> · {formatSize(m.size)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  ) : null;
  if (!loading.length) {
    const any = makers.some((m) => m.installed && !m.builtIn) || makers.some((m) => m.installed && m.wanted);
    return (
      <section className="make-loading" aria-label="Pick what to load">
        <p className="make-loading-head">
          <span>{any ? 'Load another maker: tap one in step 2, or see them all.' : 'Nothing is loaded yet. Tap makers in step 2 in the order you want, or see them all.'}</span>
          <span className="make-loading-acts">
            {allButton}
            {hideButton}
          </span>
        </p>
        {chips}
      </section>
    );
  }
  const all = loading.reduce((t, m) => t + (m.size || 0), 0);
  const done = loading.reduce((t, m) => t + ((m.size || 0) * m.percent) / 100, 0);
  const overall = all ? Math.floor((done / all) * 100) : Math.floor(loading.reduce((t, m) => t + m.percent, 0) / loading.length);
  return (
    <section className="make-loading" aria-label="Makers loading">
      <p className="make-loading-head">
        <span role="status">
          {loading.length === 1 ? `Loading ${loading[0].name}` : `Loading ${loading.length} makers`}
          <span className="ai-muted"> · {overall}%</span>
        </span>
        <span className="make-loading-acts">
          <button type="button" className="make-loading-all" onClick={openManager}>
            Download manager
          </button>
          {allButton}
          {hideButton}
        </span>
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
            ) : m.line && m.line > 1 ? (
              <button type="button" className="btn small" disabled={busy === m.id} onClick={() => void pick(m, true)} aria-label={`Load ${m.name} next`}>
                Next
              </button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
      {chips ? (
        <>
          <p className="make-pick-head">Load next:</p>
          {chips}
        </>
      ) : null}
    </section>
  );
}
