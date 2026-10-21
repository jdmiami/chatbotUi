import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectMarks, rememberItems } from '../../ui/nsfwFlags';
import type { AppProps } from '../types';
import { useShell } from '../../state/shell';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import { AppHeader, IconButton, Segmented } from '../../ui/components';
import { TextArea } from '../../ui/TextArea';
import { getLocalAi, type AiMachine, type AiMachineStatus, type HelperStatus, type Movie, type StudioItem } from '../../services/ai/LocalAi';
import { canListen, listen, type Listening } from '../../shell/orb/listen';
import { BANNER_KICKER } from '../ai/banner';
import { LENGTHS, TEMPLATES, aboutTime, phaseLine, type TemplateId } from './plan';
import { Walkthrough } from './Walkthrough';
import { MovieView } from './MovieView';
import '../ai/ai.css';
import './soreal.css';

type View = { kind: 'home' } | { kind: 'walk'; id: string } | { kind: 'movie'; id: string };

/** A draft is a new movie that hasn't been started: it opens in the walkthrough. */
const isDraft = (m: Movie) => m.flow === 'auto' && (m.phase ?? 'draft') === 'draft' && !m.running;

function listHint(m: Movie) {
  if (isDraft(m)) return 'Not made yet · continue setting it up';
  const line = phaseLine(m);
  return m.running && m.etaSeconds ? `${line} · ${aboutTime(m.etaSeconds)} left` : line;
}

/**
 * soReal: say what your movie is about, pick a length, and Make. The AI on your machine writes the
 * story, designs the lead, draws a storyboard and makes every shot between two storyboard pictures,
 * then joins them. "Walk me through it" goes step by step with the orb as the guide. The movie lives
 * on the AI machine, so it keeps going while the phone sleeps.
 */
export default function SoRealApp({ isActive, placement }: AppProps) {
  const ai = useMemo(() => getLocalAi(), []);
  // A shot or picture held to blur is saved on the AI machine from here too.
  useEffect(() => connectMarks(ai), [ai]);
  const toast = useShell((s) => s.toast);
  const setSummary = useWorkspace((s) => s.setSummary);
  const [status, setStatus] = useState<AiMachineStatus | null>(null);
  const [powering, setPowering] = useState(false);
  const [helper, setHelper] = useState<HelperStatus | null>(null);
  const [helperBusy, setHelperBusy] = useState(false);
  const [makeOn, setMakeOn] = useState<AiMachine>('main');
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [view, setView] = useState<View>({ kind: 'home' });

  const ready = status?.state === 'on';
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

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

  const refreshItems = useCallback(async () => {
    try {
      const gallery = await ai.studioItems();
      rememberItems(gallery);
      setItems(gallery);
    } catch {
      /* the next look tries again */
    }
  }, [ai]);
  const load = useCallback(async () => {
    try {
      const [list, gallery] = await Promise.all([ai.movies(), ai.studioItems()]);
      rememberItems(gallery);
      setMovies(list);
      setItems(gallery);
      setLoadError(null);
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

  const putMovie = useCallback((m: Movie) => {
    setMovies((prev) => (prev ? [m, ...prev.filter((x) => x.id !== m.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [m]));
  }, []);

  const openId = view.kind === 'home' ? null : view.id;
  const open = movies?.find((m) => m.id === openId) ?? null;

  // The open movie follows the machine closely while it is being made; the list more slowly.
  const openRunning = Boolean(open?.running);
  const known = useRef(itemById);
  known.current = itemById;
  useEffect(() => {
    if (!openRunning || !openId || !isActive) return;
    const t = setInterval(async () => {
      try {
        const m = await ai.movie(openId);
        putMovie(m);
        const ids = [m.lead?.itemId, m.render?.itemId, ...(m.frames ?? []).map((f) => f.itemId), ...m.shots.map((s) => s.itemId)].filter(Boolean) as string[];
        if (ids.some((id) => !known.current.has(id)) || !m.running) void refreshItems();
      } catch {
        /* try again next tick */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [openRunning, openId, isActive, ai, putMovie, refreshItems]);
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

  useEffect(() => {
    const making = movies?.find((m) => m.running);
    setSummary('soreal', making ? phaseLine(making) : movies?.length ? `${movies.length} movie${movies.length === 1 ? '' : 's'}` : '');
  }, [movies, setSummary]);

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

  const machineBanner = !ready && (
    <div className={`ai-banner ai-banner-${status?.state ?? 'off'}`} role="status">
      <p className="ai-banner-kicker">{BANNER_KICKER[status?.state ?? 'off'] ?? 'Your AI machine'}</p>
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

  const helperBanner = helper && ['off', 'starting', 'on', 'error'].includes(helper.state) && (ready || helper.state !== 'off') && (
    <div className={`ai-banner sr-helper ai-banner-${helper.state}`} role="status" aria-label="Helper machine">
      <p className="ai-banner-kicker">The helper</p>
      <p>
        {helper.state === 'off' && `Helper machine: off. Turn it on to make two movies at once ($${helper.pricePerHour.toFixed(2)}/h while on).`}
        {helper.state === 'starting' && 'Helper machine: starting… usually 2–4 minutes.'}
        {helper.state === 'on' && `Helper machine: on${helper.costPerHour ? ` · $${helper.costPerHour.toFixed(2)}/h` : ''} · turns itself off after ${helper.idle?.limitMinutes ?? 30} minutes unused.`}
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
  );

  const openMovie = (m: Movie) => setView(isDraft(m) ? { kind: 'walk', id: m.id } : { kind: 'movie', id: m.id });

  return (
    <div className="ag-root sr-root" data-placement={placement}>
      <AppHeader
        title="soReal"
        subtitle="A movie from one idea"
        leading={view.kind !== 'home' ? <IconButton icon="back" label="All movies" onClick={() => setView({ kind: 'home' })} /> : undefined}
      />
      {machineBanner}
      {helperBanner}
      {loadError && ready && <p className="ai-error sr-pad">{loadError}</p>}
      <main className="sr-scroll">
        {view.kind === 'home' && (
          <StartPage
            ready={ready}
            movies={movies}
            makeOn={makeOn}
            helperOn={helperOn}
            setMakeOn={setMakeOn}
            onCreated={(m, walk) => {
              putMovie(m);
              setView(walk ? { kind: 'walk', id: m.id } : { kind: 'movie', id: m.id });
            }}
            onOpen={openMovie}
          />
        )}
        {view.kind === 'walk' && open && (
          <Walkthrough
            key={open.id}
            movie={open}
            itemById={itemById}
            ready={ready}
            helperOn={helperOn}
            makeOn={makeOn}
            setMakeOn={setMakeOn}
            onMovie={putMovie}
            onItems={refreshItems}
            onMade={(m) => {
              putMovie(m);
              setView({ kind: 'movie', id: m.id });
            }}
          />
        )}
        {view.kind === 'movie' && open && (
          <MovieView
            key={open.id}
            movie={open}
            itemById={itemById}
            ready={ready}
            helperOn={helperOn}
            makeOn={makeOn}
            setMakeOn={setMakeOn}
            onMovie={putMovie}
            onItems={refreshItems}
            onItem={(it) => setItems((prev) => [it, ...prev.filter((x) => x.id !== it.id)])}
            onEdit={() => setView({ kind: 'walk', id: open.id })}
            onDeleted={() => {
              setMovies((prev) => prev?.filter((x) => x.id !== open.id) ?? null);
              setView({ kind: 'home' });
            }}
          />
        )}
        {view.kind !== 'home' && !open && <p className="ai-muted sr-pad">{movies ? 'This movie is gone.' : 'Loading…'}</p>}
      </main>
    </div>
  );
}

/** The start: one box, a length, a shape, Make. Or walk through it step by step. */
function StartPage({
  ready,
  movies,
  makeOn,
  helperOn,
  setMakeOn,
  onCreated,
  onOpen,
}: {
  ready: boolean;
  movies: Movie[] | null;
  makeOn: AiMachine;
  helperOn: boolean;
  setMakeOn: (v: AiMachine) => void;
  onCreated: (m: Movie, walk: boolean) => void;
  onOpen: (m: Movie) => void;
}) {
  const ai = useMemo(() => getLocalAi(), []);
  const toast = useShell((s) => s.toast);
  const [idea, setIdea] = useState('');
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [length, setLength] = useState(20);
  const [size, setSize] = useState<'portrait' | 'landscape'>('portrait');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState<'make' | 'walk' | null>(null);
  const [listening, setListening] = useState(false);
  const listenRef = useRef<Listening | null>(null);
  useEffect(() => () => listenRef.current?.cancel(), []);

  // How long it takes, from the machine's own timings.
  useEffect(() => {
    if (!ready) return setEstimate(null);
    let live = true;
    const t = setTimeout(() => {
      ai.estimateMovie({ length, size }).then(
        (e) => live && setEstimate(e.seconds),
        () => live && setEstimate(null),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ai, ready, length, size]);

  const speak = () => {
    if (listening) return listenRef.current?.finish();
    const before = idea.trim();
    setListening(true);
    listenRef.current = listen({
      onLevel: () => {},
      onPartial: (t) => setIdea(before ? `${before} ${t}` : t),
      onDone: (t) => {
        setIdea(before ? `${before} ${t}` : t);
        setListening(false);
      },
      onError: (msg) => {
        setListening(false);
        toast(msg, 'info');
      },
    });
  };

  const pick = (id: TemplateId) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    if (template === id) return setTemplate(null);
    setTemplate(id);
    setLength(t.length);
    if (!idea.trim()) setIdea(t.example);
  };

  const start = async (walk: boolean) => {
    setBusy(walk ? 'walk' : 'make');
    try {
      const m = await ai.createMovie({ idea: idea.trim(), template, length, size });
      if (walk) return onCreated(m, true);
      try {
        onCreated(await ai.runMovie(m.id, makeOn), false);
      } catch (err) {
        toast((err as Error).message, 'error');
        onCreated(m, false);
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const placeholder = template ? TEMPLATES.find((t) => t.id === template)!.example : 'A lighthouse keeper finds a door at the bottom of the sea';
  return (
    <div className="sr-page">
      <header className="sr-cover">
        <p className="o5-kicker">soReal</p>
        <h2 className="sr-display" id="sr-idea-label">
          What’s your movie about?
        </h2>
      </header>
      <div className="sr-idea">
        <TextArea
          className="input sr-idea-box"
          rows={3}
          value={idea}
          maxLength={2000}
          aria-label="What’s your movie about?"
          placeholder={placeholder}
          onChange={(e) => setIdea(e.target.value)}
        />
        {canListen() && (
          <button type="button" className={`sr-mic${listening ? ' is-on' : ''}`} aria-label={listening ? 'Stop listening' : 'Speak your idea'} aria-pressed={listening} onClick={speak}>
            <Icon name="mic" size={22} />
          </button>
        )}
      </div>
      <div className="sr-chips" role="group" aria-label="Quick starts">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="sr-chip" aria-pressed={template === t.id} onClick={() => pick(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="sr-pickers">
        <div className="sr-field">
          <span>Length</span>
          <Segmented label="Length" value={String(length)} onChange={(v) => setLength(Number(v))} options={LENGTHS.map((l) => ({ value: String(l), label: `${l} s` }))} />
        </div>
        <div className="sr-field">
          <span>Shape</span>
          <Segmented
            label="Shape"
            value={size}
            onChange={setSize}
            options={[
              { value: 'portrait', label: 'Vertical' },
              { value: 'landscape', label: 'Wide' },
            ]}
          />
        </div>
        {helperOn && (
          <div className="sr-field">
            <span>Make on</span>
            <Segmented
              label="Make on"
              value={makeOn}
              onChange={setMakeOn}
              options={[
                { value: 'main', label: 'Main machine' },
                { value: 'helper', label: 'Helper' },
              ]}
            />
          </div>
        )}
      </div>
      <p className="sr-estimate" role="status">
        {!ready ? 'Turn your AI machine on to make a movie.' : estimate != null ? `Takes ${aboutTime(estimate)} on your AI machine. It keeps going if your phone sleeps.` : ' '}
      </p>
      <div className="sr-actions">
        <button type="button" className="btn primary sr-make" disabled={!ready || !idea.trim() || busy !== null} onClick={() => void start(false)}>
          <Icon name="film" size={18} /> {busy === 'make' ? 'Starting…' : 'Make'}
        </button>
        <button type="button" className="btn sr-walk" disabled={!ready || busy !== null} onClick={() => void start(true)}>
          <Icon name="sparkle" size={18} /> Walk me through it
        </button>
      </div>

      <section className="sr-library" aria-labelledby="sr-movies-t">
        <h3 className="sr-section-title" id="sr-movies-t">
          Your movies
        </h3>
        {movies && movies.length === 0 && <p className="ai-muted">Nothing yet. Your first movie starts above.</p>}
        <ul className="o5-links">
          {movies?.map((m) => (
            <li key={m.id}>
              <button type="button" className="o5-go" onClick={() => onOpen(m)}>
                <span className="o5-go-label">{m.title}</span>
                <span className="o5-go-hint">{listHint(m)}</span>
                <Icon name="forward" size={20} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
