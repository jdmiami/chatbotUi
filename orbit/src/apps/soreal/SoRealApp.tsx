import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../types';
import { Step, nextStep } from '../../shell/o5/Step';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { AppHeader, ConfirmSheet, EmptyState, IconButton, Segmented, Sheet } from '../../ui/components';
import {
  getLocalAi,
  type AiMachine,
  type AiMachineStatus,
  type HelperStatus,
  type Movie,
  type MovieShot,
  type StudioItem,
  type StudioMakerInfo,
} from '../../services/ai/LocalAi';
import { latestVideo, parseShots, planMessages } from './plan';
import '../ai/ai.css';
import './soreal.css';

const SIZES = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'square', label: 'Square' },
] as const;
const LENGTHS = [
  { value: '3', label: '3 s' },
  { value: '5', label: '5 s' },
  { value: '8', label: '8 s' },
];

const shotId = () => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
};
const newShot = (prompt = ''): MovieShot => ({ id: shotId(), prompt, itemId: null, status: 'todo', error: null });
const withParam = (url: string, param: string) => url + (url.includes('?') ? '&' : '?') + param;

function progressText(m: Movie) {
  const done = m.shots.filter((s) => s.status === 'done').length;
  if (m.running) {
    const at = m.shots.findIndex((s) => s.status === 'making');
    return `Making shot ${(at < 0 ? done : at) + 1} of ${m.shots.length}${m.runningOn === 'helper' ? ' on the helper' : ''}…`;
  }
  if (m.shots.some((s) => s.status === 'error')) return 'A shot needs a look';
  if (done && done === m.shots.length) return m.render ? 'Exported' : 'All shots made';
  return `${done} of ${m.shots.length} shots made`;
}

/**
 * soReal: make movies shot by shot. Every shot continues from the last frame of the shot before
 * (the first one from a gallery picture or video, if you like), so the movie flows without cuts.
 * The plan lives on the AI machine, which keeps making shots while the phone sleeps.
 */
export default function SoRealApp({ isActive, compact, placement }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const o5 = useShell((s) => s.settings.skin === 'o5');
  const setSummary = useWorkspace((s) => s.setSummary);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [powering, setPowering] = useState(false);
  const [helper, setHelper] = useState<HelperStatus | null>(null);
  const [helperBusy, setHelperBusy] = useState(false);
  const [makeOn, setMakeOn] = useState<AiMachine>('main');
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [makers, setMakers] = useState<StudioMakerInfo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Movie | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [watching, setWatching] = useState<StudioItem[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Movie | null>(null);
  const edits = useRef(0);
  const openRef = useRef<string | null>(null);
  openRef.current = openId;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ready = status?.state === 'on';
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const h3 = makers.find((m) => m.id === 'h3-max');

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await ai.status());
    } catch {
      /* shown as off */
    }
  }, [ai]);

  useEffect(() => {
    if (!isActive) return;
    void refreshStatus();
    const t = setInterval(refreshStatus, status && status.state !== 'on' && status.state !== 'off' ? 5000 : 30000);
    return () => clearInterval(t);
  }, [isActive, refreshStatus, status?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const [list, gallery] = await Promise.all([ai.movies(), ai.studioItems()]);
      setMovies(list);
      setItems(gallery);
      setLoadError(null);
      ai.studioMakers().then(setMakers, () => {});
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [ai]);

  useEffect(() => {
    if (isActive && ready) void load();
  }, [isActive, ready, load]);

  // The helper machine: a second GPU that makes another movie at the same time.
  const refreshHelper = useCallback(async () => {
    try {
      setHelper(await ai.helperStatus());
    } catch {
      /* hidden until it answers */
    }
  }, [ai]);
  // Watched even while the main machine is off: the helper may still be on (and billing).
  useEffect(() => {
    if (!isActive) return;
    void refreshHelper();
    const t = setInterval(refreshHelper, helper?.state === 'starting' ? 5000 : 30000);
    return () => clearInterval(t);
  }, [isActive, refreshHelper, helper?.state]);
  const helperOn = helper?.state === 'on';
  useEffect(() => {
    if (!helperOn) setMakeOn('main');
  }, [helperOn]);
  const helperPower = async (action: 'start' | 'stop') => {
    setHelperBusy(true);
    try {
      setHelper(await ai.helperPower(action));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setHelperBusy(false);
    }
  };

  // Other movies being made (on either machine) keep their progress up to date in the list.
  const othersRunning = Boolean(movies?.some((m) => m.running && m.id !== openId));
  useEffect(() => {
    if (!othersRunning || !isActive) return;
    const t = setInterval(() => {
      ai.movies().then(
        (list) => setMovies((prev) => list.map((m) => (m.id === openId ? (prev?.find((p) => p.id === m.id) ?? m) : m))),
        () => {},
      );
    }, 8000);
    return () => clearInterval(t);
  }, [othersRunning, isActive, ai, openId]);

  // Open the first movie on wide screens.
  useEffect(() => {
    if (!compact && !o5 && !openId && movies?.length) setOpenId(movies[0].id);
  }, [compact, o5, openId, movies]);

  // The open movie, kept in sync with the machine (closely while it is making shots).
  const current = movies?.find((m) => m.id === openId) ?? null;
  useEffect(() => {
    if (!current) return setDraft(null);
    if (!draft || draft.id !== current.id) setDraft(current);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const putMovie = useCallback((m: Movie) => {
    setMovies((prev) => (prev ? [m, ...prev.filter((x) => x.id !== m.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [m]));
  }, []);

  const running = Boolean(draft?.running);
  useEffect(() => {
    if (!running || !draft || !isActive) return;
    const id = draft.id;
    const t = setInterval(async () => {
      try {
        const m = await ai.movie(id);
        putMovie(m);
        setDraft(m);
        if (m.shots.some((s) => s.itemId && !itemById.has(s.itemId)) || !m.running) setItems(await ai.studioItems());
      } catch {
        /* try again next tick */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [running, draft?.id, isActive, ai, putMovie, itemById]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSummary('soreal', running && draft ? progressText(draft) : movies?.length ? `${movies.length} movie${movies.length === 1 ? '' : 's'}` : '');
  }, [running, draft, movies?.length, setSummary]);

  // Edits save themselves a moment after you stop typing.
  const save = useCallback(
    async (m: Movie) => {
      const v = edits.current;
      try {
        const saved = await ai.updateMovie(m.id, { title: m.title, look: m.look, maker: m.maker, size: m.size, seconds: m.seconds, start: m.start, shots: m.shots });
        putMovie(saved);
        // Only if nothing changed since, and the same movie is still open.
        if (edits.current === v && openRef.current === saved.id) setDraft(saved);
        return saved;
      } catch (err) {
        toast((err as Error).message, 'error');
        return null;
      }
    },
    [ai, putMovie, toast],
  );
  const edit = (fn: (m: Movie) => Movie) => {
    if (!draft || draft.running) return;
    const next = fn(draft);
    edits.current++;
    setDraft(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save(next);
    }, 700);
  };
  const flush = async () => {
    if (!draft) return null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return save(draft);
    }
    return draft;
  };

  const power = async () => {
    setPowering(true);
    try {
      setStatus(await ai.power('start'));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPowering(false);
    }
  };

  const create = async (from?: Partial<Movie>) => {
    setBusy('new');
    try {
      const latest = latestVideo(items);
      const m = await ai.createMovie({
        title: 'Untitled movie',
        start: latest?.id ?? null,
        ...from,
        shots: from?.shots ?? [newShot()],
      });
      putMovie(m);
      setOpenId(m.id);
      setDraft(m);
      nextStep(o5, 'o5-sr-name');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const act = async (what: 'run' | 'stop' | 'render') => {
    const m = await flush();
    if (!m) return;
    setBusy(what);
    try {
      if (what === 'render') {
        const r = await ai.renderMovie(m.id);
        putMovie(r.movie);
        setDraft(r.movie);
        setItems((prev) => [r.item, ...prev]);
        setWatching([r.item]);
        toast('Your movie is in the gallery.', 'success');
      } else {
        const next = what === 'run' ? await ai.runMovie(m.id, makeOn) : await ai.stopMovie(m.id, m.runningOn ?? 'main');
        putMovie(next);
        setDraft(next);
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: Movie) => {
    setConfirmDelete(null);
    try {
      await ai.deleteMovie(m.id);
      setMovies((prev) => prev?.filter((x) => x.id !== m.id) ?? null);
      if (openId === m.id) setOpenId(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const doneShots = draft?.shots.filter((s) => s.status === 'done' && s.itemId && itemById.has(s.itemId)) ?? [];
  const lastDone = doneShots[doneShots.length - 1];

  // ---- views

  const machineBanner = !ready && (
    <div className={`ai-banner ai-banner-${status?.state ?? 'off'}`} role="status">
      {(!status || status.state === 'off') && (
        <>
          <p>soReal makes your movies on your AI machine, which is off. It takes 2–4 minutes to turn on{status?.costPerHour ? ` and costs $${status.costPerHour.toFixed(2)}/h while on` : ''}.</p>
          <button type="button" className="btn primary" onClick={() => void power()} disabled={powering}>
            {powering ? 'Turning on…' : 'Turn on'}
          </button>
        </>
      )}
      {(status?.state === 'starting' || status?.state === 'downloading') && <p>Starting your AI machine… usually 2–4 minutes.</p>}
      {status?.state === 'unconfigured' && <p>{status.detail ?? 'The AI machine is not set up yet.'}</p>}
      {status?.state === 'error' && <p>{status.detail ?? 'The AI machine has a problem.'}</p>}
    </div>
  );

  // Orbit 0.5: the movies are a contents page, one big line each, the newest first.
  const contents = (
    <div className="sr-contents">
      <header className="o5-gallery-head">
        <p className="o5-kicker">soReal</p>
        <h2 className="o5-chapter-title">Your movies</h2>
        <p className="o5-dek">Write what happens, shot by shot. Each shot picks up from the last frame of the one before, so it flows like one take.</p>
      </header>
      <ul className="o5-links">
        <li>
          <button type="button" className="o5-go" onClick={() => void create()} disabled={!ready || busy === 'new'}>
            <span className="o5-go-label">Start a new movie</span>
            <span className="o5-go-hint">{ready ? 'Name it, set the look, write the shots' : 'Turn the AI machine on first'}</span>
            <Icon name="plus" size={20} />
          </button>
        </li>
        {movies?.map((m) => (
          <li key={m.id}>
            <button type="button" className="o5-go" onClick={() => setOpenId(m.id)}>
              <span className="o5-go-label">{m.title}</span>
              <span className="o5-go-hint">{progressText(m)}</span>
              <Icon name="forward" size={20} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const list = (
    <div className="sr-list">
      <button type="button" className="ai-new" onClick={() => void create()} disabled={!ready || busy === 'new'}>
        <Icon name="plus" size={16} /> New movie
      </button>
      {movies && movies.length === 0 && <p className="ai-muted">No movies yet. Start one: write what happens, shot by shot.</p>}
      <ul>
        {movies?.map((m) => {
          const thumb = [...m.shots].reverse().find((s) => s.itemId && itemById.has(s.itemId));
          return (
            <li key={m.id}>
              <button type="button" className="sr-list-item" aria-current={m.id === openId || undefined} onClick={() => setOpenId(m.id)}>
                <span className="sr-thumb" aria-hidden>
                  {thumb ? <video src={itemById.get(thumb.itemId!)!.url} muted playsInline preload="metadata" /> : <Icon name="film" size={18} />}
                </span>
                <span className="sr-list-text">
                  <span className="ai-list-title">{m.title}</span>
                  <span className="ai-muted">{progressText(m)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const startItem = draft?.start ? itemById.get(draft.start) : null;
  const editor = draft && (
    <div className="sr-editor">
      <Step on={o5} n="01" id="o5-sr-name" title="Name it, set the look">
        <label className="sr-field">
          <span>Title</span>
          <input className="input" value={draft.title} maxLength={120} disabled={running} onChange={(e) => edit((m) => ({ ...m, title: e.target.value }))} />
        </label>
        <label className="sr-field">
          <span>Look and characters</span>
          <textarea
            className="input"
            rows={3}
            value={draft.look}
            maxLength={2000}
            disabled={running}
            placeholder="Who is in it and the style, e.g. “A woman in a red coat, neon city at night, 35 mm film look.” Added to every shot so it stays consistent."
            onChange={(e) => edit((m) => ({ ...m, look: e.target.value }))}
          />
        </label>
      </Step>

      <Step on={o5} n="02" id="o5-sr-how" title="How it's shot">
        <div className="sr-options">
          <div className="sr-field">
            <span>Video maker</span>
            <Segmented
              label="Video maker"
              value={draft.maker}
              onChange={(v) => {
                if (v === 'h3-max' && !h3?.installed) return toast('Add H3 Max first: AI → Create → Makers.', 'info');
                edit((m) => ({ ...m, maker: v }));
              }}
              options={[
                { value: 'ltx', label: 'LTX · fast, sound' },
                { value: 'h3-max', label: h3?.installed ? 'H3 Max · best' : 'H3 Max (add it)' },
              ]}
            />
          </div>
          <div className="sr-field">
            <span>Shape</span>
            <Segmented label="Shape" value={draft.size} onChange={(v) => edit((m) => ({ ...m, size: v }))} options={SIZES.map((s) => ({ ...s }))} />
          </div>
          <div className="sr-field">
            <span>Each shot</span>
            <Segmented label="Shot length" value={String(draft.seconds)} onChange={(v) => edit((m) => ({ ...m, seconds: Number(v) }))} options={LENGTHS} />
          </div>
        </div>

        {draft.shots.some((s) => s.status === 'done') && !running && (
          <p className="ai-muted">Changing the look, maker, shape, length or starting point remakes every shot.</p>
        )}
      </Step>

      <Step on={o5} n="03" id="o5-sr-start" title="Where it begins">

        <div className="sr-field">
          <span>First shot starts from</span>
          <div className="sr-start">
            <span className="sr-thumb sr-thumb-lg" aria-hidden>
              {startItem ? startItem.kind === 'video' ? <video src={startItem.url} muted playsInline preload="metadata" /> : <img src={startItem.url} alt="" /> : <Icon name="text" size={20} />}
            </span>
            <p className="ai-muted sr-start-text">
              {startItem ? `${startItem.kind === 'video' ? 'The last frame of' : 'The picture'} “${startItem.prompt.slice(0, 80)}”` : 'Nothing: the first shot is made from words alone.'}
            </p>
            <div className="sr-start-actions">
              <button
                type="button"
                className="btn"
                disabled={running || !latestVideo(items)}
                onClick={() => {
                  edit((m) => ({ ...m, start: latestVideo(items)?.id ?? null }));
                  nextStep(o5, 'o5-sr-shots');
                }}
              >
                Latest video
              </button>
              <button type="button" className="btn" disabled={running || !items.length} onClick={() => setPicking(true)}>
                Pick…
              </button>
              {draft.start && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={running}
                  onClick={() => {
                    edit((m) => ({ ...m, start: null }));
                    nextStep(o5, 'o5-sr-shots');
                  }}
                >
                  None
                </button>
              )}
            </div>
          </div>
        </div>
      </Step>

      <Step on={o5} n="04" id="o5-sr-shots" title="The shots">
        <div className="sr-shots-head">
          <h2 className="o5-hide">Shots</h2>
          <button type="button" className="btn" disabled={running} onClick={() => setPlanning(true)}>
            <Icon name="sparkle" size={16} /> Plan with AI
          </button>
        </div>
        <ol className="sr-shots">
          {draft.shots.map((s, i) => {
            const item = s.itemId ? itemById.get(s.itemId) : null;
            return (
              <li key={s.id} className="sr-shot" data-status={s.status}>
                <div className="sr-shot-media">
                  {item ? (
                    <video src={item.url} controls playsInline preload="metadata" aria-label={`Shot ${i + 1}`} />
                  ) : (
                    <span className="sr-shot-num" aria-hidden>
                      {s.status === 'making' ? <span className="sr-spin" /> : i + 1}
                    </span>
                  )}
                </div>
                <div className="sr-shot-body">
                  <div className="sr-shot-top">
                    <span className="sr-shot-label">
                      Shot {i + 1}
                      {i > 0 || draft.start ? <span className="ai-muted"> · picks up from the last frame</span> : null}
                    </span>
                    <span className={`sr-badge sr-badge-${s.status}`}>{{ todo: 'To make', making: 'Making…', done: 'Made', error: 'Problem' }[s.status]}</span>
                  </div>
                  <textarea
                    className="input"
                    rows={2}
                    value={s.prompt}
                    disabled={running}
                    aria-label={`What happens in shot ${i + 1}`}
                    placeholder="What happens, and how the camera moves"
                    onChange={(e) => edit((m) => ({ ...m, shots: m.shots.map((x) => (x.id === s.id ? { ...x, prompt: e.target.value } : x)) }))}
                  />
                  {s.error && <p className="ai-error">{s.error}</p>}
                  {s.status === 'done' && !running && <p className="ai-muted">Change the words to remake this shot (and the ones after it).</p>}
                </div>
                <IconButton
                  icon="trash"
                  label={`Remove shot ${i + 1}`}
                  disabled={running || draft.shots.length === 1}
                  onClick={() => edit((m) => ({ ...m, shots: m.shots.filter((x) => x.id !== s.id) }))}
                />
              </li>
            );
          })}
        </ol>
        <button type="button" className="ai-new sr-add" disabled={running || draft.shots.length >= 60} onClick={() => edit((m) => ({ ...m, shots: [...m.shots, newShot()] }))}>
          <Icon name="plus" size={16} /> Add shot
        </button>
      </Step>

      <Step on={o5} n="05" id="o5-sr-go" title="Make it">
        <div className="sr-bar">
          <p className="ai-muted sr-bar-text" role="status">
            {progressText(draft)}
            {!running && draft.shots.some((s) => s.status !== 'done') ? ' · each shot takes a few minutes' : ''}
          </p>
          {!running && helperOn && (
            <Segmented
              label="Make on"
              value={makeOn}
              onChange={setMakeOn}
              options={[
                { value: 'main', label: 'Main machine' },
                { value: 'helper', label: 'Helper' },
              ]}
            />
          )}
          {running ? (
            <button type="button" className="btn" onClick={() => void act('stop')} disabled={busy === 'stop'}>
              <Icon name="stop" size={16} /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void act('run')}
              disabled={!ready || busy === 'run' || !draft.shots.some((s) => s.status !== 'done' && s.prompt.trim())}
            >
              <Icon name="play" size={16} /> {draft.shots.some((s) => s.status === 'done') ? 'Make the rest' : 'Make the movie'}
            </button>
          )}
          <button type="button" className="btn" disabled={!doneShots.length} onClick={() => setWatching(doneShots.map((s) => itemById.get(s.itemId!)!))}>
            <Icon name="film" size={16} /> Watch
          </button>
          <button type="button" className="btn" disabled={running || !doneShots.length || busy === 'render'} onClick={() => void act('render')}>
            <Icon name="download" size={16} /> {busy === 'render' ? 'Joining…' : 'Export'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!lastDone || busy === 'new'}
            onClick={() =>
              void create({ title: `${draft.title} · part 2`, look: draft.look, maker: draft.maker, size: draft.size, seconds: draft.seconds, start: lastDone!.itemId })
            }
          >
            <Icon name="forward" size={16} /> Continue in a new movie
          </button>
          <IconButton icon="trash" label="Delete movie" onClick={() => setConfirmDelete(draft)} />
        </div>
      </Step>
    </div>
  );

  // 0.5 is one page at a time: the contents, or one movie's walk-through.
  const single = compact || o5;
  const showList = !single || !openId;
  const showEditor = !single || Boolean(openId);

  return (
    <div className="ag-root sr-root" data-placement={placement}>
      <AppHeader
        title="soReal"
        subtitle="Movies, shot by shot"
        leading={single && openId ? <IconButton icon="back" label="All movies" onClick={() => void flush().then(() => setOpenId(null))} /> : undefined}
        actions={ready && compact && !o5 && !openId ? <IconButton icon="plus" label="New movie" onClick={() => void create()} disabled={busy === 'new'} /> : undefined}
      />
      {machineBanner}
      {helper && helper.state !== 'unconfigured' && (ready || helper.state !== 'off') && (
        <div className={`ai-banner sr-helper ai-banner-${helper.state}`} role="status" aria-label="Helper machine">
          <p>
            {helper.state === 'off' && `Helper machine: off. Turn it on to make two movies at once ($${helper.pricePerHour.toFixed(2)}/h while on).`}
            {helper.state === 'starting' && 'Helper machine: starting… usually 2–4 minutes.'}
            {helper.state === 'on' &&
              `Helper machine: on${helper.costPerHour ? ` · $${helper.costPerHour.toFixed(2)}/h` : ''} · turns itself off after ${helper.idle?.limitMinutes ?? 30} minutes unused.`}
            {helper.state === 'error' && `Helper machine: ${helper.detail ?? 'has a problem.'}`}
          </p>
          {(helper.state === 'off' || helper.state === 'error') && (
            <button type="button" className="btn" onClick={() => void helperPower('start')} disabled={helperBusy}>
              {helperBusy ? 'Turning on…' : 'Turn on helper'}
            </button>
          )}
          {(helper.state === 'on' || helper.state === 'starting') && (
            <button type="button" className="btn ghost" onClick={() => void helperPower('stop')} disabled={helperBusy}>
              Turn off helper
            </button>
          )}
        </div>
      )}
      {loadError && ready && <p className="ai-error sr-pad">{loadError}</p>}
      <div className="sr-layout">
        {showList && <aside className={single ? 'sr-side sr-side-full' : 'sr-side'}>{o5 ? contents : list}</aside>}
        {showEditor && (
          <section className="sr-main" aria-label={draft?.title ?? 'Movie'}>
            {draft ? (
              editor
            ) : (
              <EmptyState icon="film" title="Make a movie">
                Write what happens shot by shot. Each shot picks up from the last frame of the one before, so it flows like one take.
              </EmptyState>
            )}
          </section>
        )}
      </div>

      {picking && draft && (
        <Sheet title="Start from" onClose={() => setPicking(false)}>
          <ul className="ai-gallery sr-pick">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  className="ai-tile"
                  aria-label={`${it.kind === 'video' ? 'Video' : 'Picture'}: ${it.prompt}`}
                  onClick={() => {
                    edit((m) => ({ ...m, start: it.id }));
                    setPicking(false);
                    nextStep(o5, 'o5-sr-shots');
                  }}
                >
                  {it.kind === 'video' ? <video src={it.url} muted playsInline preload="metadata" /> : <img src={it.url} alt="" loading="lazy" />}
                  {it.kind === 'video' && <span className="ai-tile-badge">{it.seconds ? `${it.seconds}s` : 'Video'}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}

      {planning && draft && (
        <PlanSheet
          movie={draft}
          onClose={() => setPlanning(false)}
          onPlan={(prompts, replace) => {
            edit((m) => {
              const kept = replace ? m.shots.filter((s) => s.status === 'done') : m.shots.filter((s) => s.prompt.trim() || s.status === 'done');
              return { ...m, shots: [...kept, ...prompts.map((p) => newShot(p))].slice(0, 60) };
            });
            setPlanning(false);
            nextStep(o5, 'o5-sr-shots');
          }}
        />
      )}

      {watching && <WatchSheet clips={watching} title={draft?.title ?? 'Movie'} onClose={() => setWatching(null)} />}

      {confirmDelete && (
        <ConfirmSheet
          title="Delete this movie?"
          message="The plan is deleted. Shots and exported movies stay in your gallery."
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/** Ask a chat model on the AI machine to write the shots. */
function PlanSheet({ movie, onClose, onPlan }: { movie: Movie; onClose: () => void; onPlan: (prompts: string[], replace: boolean) => void }) {
  const ai = useMemo(() => getLocalAi(), []);
  const [idea, setIdea] = useState('');
  const [count, setCount] = useState('6');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const plan = async () => {
    setWorking(true);
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const models = await ai.listModels();
      if (!models.length) throw new Error('Add a chat model first (AI → model store).');
      let text = '';
      await ai.chat(models[0], planMessages(idea, movie.look, Number(count), movie.seconds), { onText: (d) => (text += d) }, ctrl.signal);
      const shots = parseShots(text);
      if (!shots.length) throw new Error('The model did not write any shots. Try again or change the idea.');
      setResult(shots);
    } catch (err) {
      if (!ctrl.signal.aborted) setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const hasShots = movie.shots.some((s) => s.prompt.trim() && s.status !== 'done');
  return (
    <Sheet title="Plan with AI" onClose={onClose}>
      <div className="stack">
        {!result ? (
          <>
            <label className="sr-field">
              <span>What is the movie about?</span>
              <textarea className="input" rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A courier races across a rainy city to deliver a mysterious box before midnight." />
            </label>
            <div className="sr-field">
              <span>Shots</span>
              <Segmented label="Number of shots" value={count} onChange={setCount} options={['4', '6', '8', '12'].map((v) => ({ value: v, label: v }))} />
            </div>
            {error && <p className="ai-error">{error}</p>}
            <button type="button" className="btn primary" disabled={!idea.trim() || working} onClick={() => void plan()}>
              {working ? 'Writing the shots…' : 'Write the shots'}
            </button>
          </>
        ) : (
          <>
            <ol className="sr-plan">
              {result.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
            <div className="row-inline" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn ghost" onClick={() => setResult(null)}>
                Try again
              </button>
              {hasShots && (
                <button type="button" className="btn" onClick={() => onPlan(result, false)}>
                  Add after my shots
                </button>
              )}
              <button type="button" className="btn primary" onClick={() => onPlan(result, true)}>
                {hasShots ? 'Replace my shots' : 'Use these shots'}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Play the shots one after another, like the finished movie. */
function WatchSheet({ clips, title, onClose }: { clips: StudioItem[]; title: string; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const clip = clips[Math.min(at, clips.length - 1)];
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="ai-viewer">
        <video key={clip.id} src={clip.url} controls playsInline autoPlay onEnded={() => setAt((i) => (i + 1 < clips.length ? i + 1 : i))} />
        {clips.length > 1 && (
          <p className="ai-muted" role="status">
            Shot {at + 1} of {clips.length}
          </p>
        )}
        <div className="ai-viewer-actions">
          {clips.length > 1 && (
            <button type="button" className="btn" onClick={() => setAt(0)}>
              <Icon name="refresh" size={16} /> From the start
            </button>
          )}
          {clips.length === 1 && (
            <a className="btn" href={withParam(clip.url, 'download=1')} download>
              <Icon name="download" size={16} /> Save
            </a>
          )}
        </div>
      </div>
    </Sheet>
  );
}
