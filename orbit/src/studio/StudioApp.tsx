import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShell } from '../state/shell';
import { useMotionLevel } from '../motion/MotionProvider';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { getLocalAi, type StudioItem } from '../services/ai/LocalAi';
import { OrbCursor } from '../shell/orb/OrbCursor';
import { Toasts } from '../shell/Toasts';
import type { Answers, Choice, MakeKind, StudioDef } from './defs';
import { answer, back as backOne, finishAll, nextStep, pickFor, progressOf, stepsFor } from './engine';
import { mergeChoices, predictChoices } from './predict';
import { keepCharacter, listCharacters, listProjects, newProject, saveProject, type Project } from './projects';
import { carryIn, carryOut, wait } from './carry';
import { CharacterList, Gate, Home, Question } from './Sheets';
import { Make } from './Make';
import { Talk } from './Talk';
import { SqIcon, type IconName } from './icons';
import './studio.css';

type View = 'gate' | 'home' | 'start' | 'walk' | 'make' | 'talk';
type Shelf = 'projects' | 'pictures' | 'videos' | 'movies' | 'characters';

const START: Choice[] = [
  { label: 'Talk it through', hint: 'Plan it with the writer first' },
  { label: 'A picture', hint: 'One frame, in under a minute' },
  { label: 'A video', hint: 'A moving moment, with sound' },
  { label: 'A movie', hint: 'Several scenes, cut together' },
];
const START_KIND: Record<string, MakeKind> = { 'Talk it through': 'talk', 'A picture': 'image', 'A video': 'video', 'A movie': 'movie' };
const CHARACTER_KEYS = new Set(['Appearance', 'Lead', 'Partner']);

function titleOf(p: Project): string {
  const a = p.answers;
  if (p.kind === 'movie') return a.premise ?? '';
  return [a.cast, a.room].filter(Boolean).join(' · ');
}

/**
 * A studio: its own site, with one question on screen at a time and the orb beside it. Top bar:
 * the masthead and the gallery. Bottom bar: back, home, save for later. Only the middle moves.
 */
export function StudioApp({ studio }: { studio: StudioDef }) {
  useVisualViewport();
  const level = useMotionLevel();
  const toast = useShell((s) => s.toast);
  const adultKey = `orbit:studio:${studio.id}:adult`;
  const [view, setView] = useState<View>(() => {
    if (!studio.adult) return 'home';
    try {
      return localStorage.getItem(adultKey) === '1' ? 'home' : 'gate';
    } catch {
      return 'gate';
    }
  });
  const [projects, setProjects] = useState(() => listProjects(studio.id));
  const [project, setProject] = useState<Project | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [predicted, setPredicted] = useState<Choice[]>([]);
  const [predicting, setPredicting] = useState(false);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [options, setOptions] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  const moving = useRef(false);

  // The studio's look: its colours on <html>, a dark desk, the magazine faces.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    root.dataset.skin = 'o5';
    root.dataset.studio = studio.id;
    const t = studio.theme;
    const vars: Record<string, string> = {
      '--st-paper': t.paper,
      '--st-ink': t.ink,
      '--st-ink2': t.ink2,
      '--st-accent': t.accent,
      '--st-desk': t.desk,
      '--st-desk2': t.desk2,
      '--accent': t.accent,
      '--orb-a': t.orbA,
      '--orb-b': t.orbB,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    document.title = studio.name;
    void Promise.all([import('@fontsource-variable/fraunces/opsz.css'), import('@fontsource-variable/fraunces/opsz-italic.css'), import('@fontsource-variable/inter/index.css')]).catch(() => {});
  }, [studio]);

  const flow = project ? studio.flows[project.kind] : null;
  const step = view === 'walk' && flow && project ? nextStep(flow, project.answers) : null;
  const stepKey = `${view}|${step?.id ?? ''}|${project?.id ?? ''}|${view === 'make' ? project?.status : ''}`;

  // The next sheet comes out of the orb.
  useLayoutEffect(() => {
    carryIn(sheet.current, level);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The writer's predictions for the question on screen.
  useEffect(() => {
    setPredicted([]);
    if (!step || !flow || !project) return;
    let on = true;
    setPredicting(step.predict !== false && !step.closed && Object.keys(project.answers).some((k) => k !== 'cut'));
    void predictChoices(studio, flow, step, project.answers).then((list) => {
      if (!on) return;
      setPredicted(list);
      setPredicting(false);
    });
    return () => {
      on = false;
    };
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Move to another screen: the old sheet goes into the orb first. */
  const go = useCallback(
    async (change: () => void) => {
      if (moving.current) return;
      moving.current = true;
      try {
        await carryOut(sheet.current, level);
        change();
      } finally {
        moving.current = false;
      }
    },
    [level],
  );

  const keep = useCallback(
    (p: Project) => {
      const saved = saveProject(studio.id, { ...p, title: titleOf(p) || p.title });
      setProject(saved);
      setProjects(listProjects(studio.id));
      return saved;
    },
    [studio.id],
  );

  const startKind = (kind: MakeKind, seed?: string) => {
    if (kind === 'talk') return void go(() => setView('talk'));
    const p = newProject(kind);
    // From a conversation: the story (or the subject) is already said.
    if (seed) p.answers = kind === 'movie' ? { premise: seed } : {};
    void go(() => {
      setProject(keep(p));
      setView('walk');
    });
  };

  const after = (p: Project, answers: Answers) => {
    const f = studio.flows[p.kind];
    for (const s of stepsFor(f, answers)) {
      if (CHARACTER_KEYS.has(s.key) && answers[s.id] && !(s.id in p.answers)) keepCharacter(studio.id, `${s.key} · ${titleOf({ ...p, answers }) || studio.name}`, answers[s.id]);
    }
    const saved = keep({ ...p, answers });
    if (!nextStep(f, answers)) setView('make');
    return saved;
  };

  /** Pick an answer: the orb flies to it, taps it, and carries the page away. */
  const pick = async (label: string) => {
    if (view === 'start') {
      setPicked(label);
      await wait(level === 'off' ? 0 : 420);
      setPicked(null);
      return startKind(START_KIND[label]);
    }
    if (!project || !flow || !step) return;
    setPicked(label);
    await wait(level === 'off' ? 0 : 420);
    await go(() => {
      setPicked(null);
      after(project, answer(flow, project.answers, step.id, label));
    });
  };

  const pickForMe = () => {
    if (step) void pick(pickFor(step, mergeChoices(predicted, step.choices)));
  };
  const finishForMe = () => {
    if (!project || !flow) return;
    void go(() => after(project, finishAll(flow, project.answers)));
  };

  const goBack = () => {
    if (view === 'walk' && project && flow) {
      if (!Object.keys(project.answers).length) return void go(() => setView('start'));
      return void go(() => keep({ ...project, answers: backOne(flow, project.answers) }));
    }
    if (view === 'make' && project && flow && project.status === 'draft') {
      return void go(() => {
        keep({ ...project, answers: backOne(flow, project.answers) });
        setView('walk');
      });
    }
    if (view === 'start' || view === 'talk' || view === 'make') return void go(() => setView('home'));
  };
  const goHome = () => {
    if (view !== 'home' && view !== 'gate') void go(() => setView('home'));
  };
  const saveDraft = () => {
    if (project) keep(project);
    toast('Saved. It is waiting in your projects.', 'success');
    goHome();
  };

  const open = (p: Project) =>
    void go(() => {
      setProject(p);
      setView(p.status === 'draft' && nextStep(studio.flows[p.kind], p.answers) ? 'walk' : 'make');
    });

  const confirmAdult = () =>
    void go(() => {
      try {
        localStorage.setItem(adultKey, '1');
      } catch {
        /* asked again next time */
      }
      setView('home');
    });

  const canBack = view !== 'home' && view !== 'gate';
  const canSave = (view === 'walk' || view === 'make') && project?.status === 'draft';

  let body: React.ReactNode = null;
  if (view === 'gate') body = <Gate ref={sheet} studio={studio} onYes={confirmAdult} onNo={() => (window.location.href = 'about:blank')} />;
  else if (view === 'home') body = <Home ref={sheet} studio={studio} projects={projects} onOpen={open} onNew={() => void go(() => setView('start'))} onTalk={() => startKind('talk')} />;
  else if (view === 'start')
    body = (
      <Question
        ref={sheet}
        step={{ id: 'start', kick: 'Opening', q: 'What shall we *make?*', dek: 'Pick one. Every choice is a short walk, one question at a time.', key: 'Making', choices: START, closed: true }}
        n={1}
        total={1}
        choices={START}
        predicting={false}
        picked={picked}
        onPick={(l) => void pick(l)}
      />
    );
  else if (view === 'walk' && step && project && flow) {
    const { n, total } = progressOf(flow, project.answers);
    body = (
      <Question
        key={step.id}
        ref={sheet}
        step={step}
        n={n}
        total={total}
        choices={mergeChoices(predicted, step.choices)}
        predicting={predicting}
        picked={picked}
        onPick={(l) => void pick(l)}
        onPickForMe={pickForMe}
        onFinishForMe={finishForMe}
      />
    );
  } else if ((view === 'make' || view === 'walk') && project) body = <Make ref={sheet} studio={studio} project={project} onChange={keep} />;
  else if (view === 'talk') body = <Talk ref={sheet} studio={studio} onMake={(k, seed) => startKind(k, seed)} />;

  return (
    <div className="st-root" data-view={view}>
      <header className="st-top">
        <div className="st-flag">
          <small>{studio.kicker}</small>
          <b>
            {studio.mark[0]} <i>{studio.mark[1]}</i>
          </b>
        </div>
        {view !== 'gate' && (
          <nav className="st-top-actions" aria-label="Studio">
            <button type="button" className="st-sq" aria-label="Options" onClick={() => setOptions(true)}>
              <SqIcon name="options" />
            </button>
            <button type="button" className="st-sq" aria-label="Your gallery" onClick={() => setShelf('projects')}>
              <SqIcon name="menu" />
            </button>
          </nav>
        )}
      </header>

      <main className="st-stage" id="st-stage">
        {body}
      </main>

      {view !== 'gate' && (
        <footer className="st-bottom">
          <button type="button" className="st-bar-btn" onClick={goBack} disabled={!canBack}>
            <SqIcon name="back" /> <span>Back</span>
          </button>
          <button type="button" className="st-bar-btn" onClick={goHome} disabled={view === 'home'}>
            <SqIcon name="home" /> <span>Home</span>
          </button>
          <button type="button" className="st-bar-btn" onClick={saveDraft} disabled={!canSave}>
            <SqIcon name="save" /> <span>Save draft</span>
          </button>
        </footer>
      )}

      {shelf && <Gallery studio={studio} shelf={shelf} setShelf={setShelf} projects={projects} onOpen={(p) => (setShelf(null), open(p))} />}
      {options && <Options studio={studio} onClose={() => setOptions(false)} />}
      <Toasts />
      <OrbCursor />
    </div>
  );
}

const SHELVES: { id: Shelf; label: string; icon: IconName }[] = [
  { id: 'projects', label: 'Projects', icon: 'project' },
  { id: 'pictures', label: 'Pictures', icon: 'picture' },
  { id: 'videos', label: 'Videos', icon: 'video' },
  { id: 'movies', label: 'Movies', icon: 'movie' },
  { id: 'characters', label: 'Characters', icon: 'character' },
];

/** The gallery: everything this member made in this studio, by project and by kind. */
function Gallery({ studio, shelf, setShelf, projects, onOpen }: { studio: StudioDef; shelf: Shelf; setShelf: (s: Shelf | null) => void; projects: Project[]; onOpen: (p: Project) => void }) {
  const [items, setItems] = useState<StudioItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = useMemo(() => new Set(projects.flatMap((p) => p.items)), [projects]);
  useEffect(() => {
    getLocalAi()
      .studioItems()
      .then(
        (list) => setItems(list.filter((i) => mine.has(i.id))),
        () => setError('Your pictures and films show here while the studio is awake. Start something and it wakes up.'),
      );
  }, [mine]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setShelf(null);
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [setShelf]);
  const kind = shelf === 'pictures' ? 'image' : shelf === 'videos' ? 'video' : null;
  const shown = (items ?? []).filter((i) => (shelf === 'movies' ? i.maker === 'soreal' || !!i.movie : kind ? i.kind === kind && !i.movie : false));
  return (
    <div className="st-drawer-wrap" role="dialog" aria-modal="true" aria-label={`${studio.name}: your gallery`}>
      <button type="button" className="st-scrim" aria-label="Close the gallery" onClick={() => setShelf(null)} />
      <aside className="st-drawer">
        <div className="st-drawer-head">
          <h3>
            Your <em>gallery</em>
          </h3>
          <button type="button" className="st-sq st-sq-ink" aria-label="Close" onClick={() => setShelf(null)}>
            <SqIcon name="close" />
          </button>
        </div>
        <nav className="st-tabs" aria-label="Shelves">
          {SHELVES.map((s) => (
            <button key={s.id} type="button" aria-pressed={shelf === s.id} onClick={() => setShelf(s.id)}>
              <SqIcon name={s.icon} framed />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="st-shelf">
          {shelf === 'projects' &&
            (projects.length ? (
              <ol className="st-contents">
                {projects.map((p, i) => (
                  <li key={p.id}>
                    <button type="button" className="st-row" onClick={() => onOpen(p)}>
                      <span className="st-row-n" aria-hidden>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="st-row-t">{p.title || 'Untitled'}</span>
                      <span className="st-row-m">{p.kind === 'image' ? 'Picture' : p.kind === 'video' ? 'Video' : 'Movie'}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="st-empty">No projects yet. Start one from Home.</p>
            ))}
          {shelf === 'characters' && <CharacterList list={listCharacters(studio.id)} />}
          {(shelf === 'pictures' || shelf === 'videos' || shelf === 'movies') &&
            (error ? (
              <p className="st-empty">{error}</p>
            ) : items === null ? (
              <p className="st-empty">Opening your gallery…</p>
            ) : shown.length ? (
              <ul className="st-grid">
                {shown.map((i) => (
                  <li key={i.id}>{i.kind === 'image' ? <img src={i.url} alt={i.prompt} loading="lazy" /> : <video src={i.url} muted playsInline loop controls preload="metadata" />}</li>
                ))}
              </ul>
            ) : (
              <p className="st-empty">Nothing here yet.</p>
            ))}
        </div>
      </aside>
    </div>
  );
}

function Options({ studio, onClose }: { studio: StudioDef; onClose: () => void }) {
  return (
    <div className="st-drawer-wrap" role="dialog" aria-modal="true" aria-label="Options">
      <button type="button" className="st-scrim" aria-label="Close options" onClick={onClose} />
      <aside className="st-drawer">
        <div className="st-drawer-head">
          <h3>
            House <em>rules</em>
          </h3>
          <button type="button" className="st-sq st-sq-ink" aria-label="Close" onClick={onClose}>
            <SqIcon name="close" />
          </button>
        </div>
        <ul className="st-rules">
          {studio.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="st-dek">Tap the orb any time to ask it something, or hold it to talk.</p>
      </aside>
    </div>
  );
}
