import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useShell } from '../state/shell';
import { useMotionLevel } from '../motion/MotionProvider';
import { SPRING, transitionFor } from '../motion/springs';
import { useVisualViewport } from '../hooks/useVisualViewport';
import type { StudioItem } from '../services/ai/LocalAi';
import { studioAi } from './memberApi';
import { OrbCursor } from '../shell/orb/OrbCursor';
import { Toasts } from '../shell/Toasts';
import type { Answers, Choice, MakeKind, StudioDef } from './defs';
import { answer, back as backOne, finishAll, nextStep, pickFor, progressOf, stepsFor } from './engine';
import { mergeChoices, predictChoices } from './predict';
import { keepCharacter, listCharacters, listProjects, newProject, saveProject, type Project } from './projects';
import { CharacterList, Gate, Headline, Home } from './Sheets';
import { Choices } from './Choices';
import { Walk } from './Walk';
import { lineFor, nudgeFor, orbSay, orbThink } from './orbGuide';
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
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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
  const full = level === 'full';

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
      // On the dark page the accent is the orb's light tone; the deep one is for the paper drawers.
      '--accent': t.orbA,
      '--orb-a': t.orbA,
      '--orb-b': t.orbB,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    document.title = studio.name;
    void Promise.all([import('@fontsource-variable/fraunces/opsz.css'), import('@fontsource-variable/fraunces/opsz-italic.css'), import('@fontsource-variable/inter/index.css')]).catch(() => {});
  }, [studio]);

  const flow = project ? studio.flows[project.kind] : null;
  const step = view === 'walk' && flow && project ? nextStep(flow, project.answers) : null;
  const stepKey = `${view}|${step?.id ?? ''}|${project?.id ?? ''}`;

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
      if (list.length) orbSay(list.length === 1 ? 'I added an idea that fits what you picked.' : `I added ${list.length} ideas that fit what you picked.`);
    });
    return () => {
      on = false;
    };
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The orb guides: it reads each new question out (with a nod to your last answer), glows while the
  // writer thinks, and nudges if you sit on a question for a while.
  useEffect(() => {
    if (view === 'walk' && step && flow && project) {
      const t = setTimeout(() => orbSay(lineFor(flow, project.answers, step, project.id.length)), full ? 700 : 100);
      const nudge = setTimeout(() => orbSay(nudgeFor(step)), 14000);
      return () => {
        clearTimeout(t);
        clearTimeout(nudge);
      };
    }
    const lines: Partial<Record<View, string>> = {
      gate: 'This studio is for adults. Confirm and we’re in.',
      start: 'What are we making? Pick one and I’ll walk you through it.',
      talk: 'Tell me the mood, a story, a scene. I’ll help you shape it.',
      home: projects.find((p) => p.status === 'draft')
        ? `Welcome back. Pick up “${projects.find((p) => p.status === 'draft')!.title || 'your draft'}”, or start something new.`
        : projects.length
          ? 'Welcome back. What are we making tonight?'
          : 'Tap “Start something new” and I’ll walk you through it.',
    };
    const line = lines[view];
    if (!line) return;
    const t = setTimeout(() => orbSay(line), full ? 700 : 100);
    return () => clearTimeout(t);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    orbThink(predicting ? 0.7 : null);
    return () => orbThink(null);
  }, [predicting]);

  // When you tap the orb and ask, it knows it is this studio's guide and where you are in it.
  useEffect(() => {
    const where =
      view === 'walk' && step && flow && project
        ? `The member is making ${flow.label.toLowerCase()}. Answers so far: ${
            Object.entries(project.answers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('; ') || 'none'
          }. The question on screen: "${step.q.replace(/\*/g, '')}". To answer it, click one of the listed answers, or type into "Or in your own words" and submit. "Pick for me" and "Finish it for me" are there too.`
        : `The member is on the ${view} screen.`;
    document.documentElement.dataset.orbContext = `You are the guide inside ${studio.name}, a studio site; there are no Orbit apps or machines here, so never use "open", "setting" or "machine". ${studio.writer} ${where} Help them move forward: pick or type answers that match what they ask for, in as few steps as possible.`;
  }, [stepKey, view, studio]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void delete document.documentElement.dataset.orbContext, []);

  /** Move to another screen (it leaves and the next one arrives on springs, see the render). */
  const go = useCallback(async (change: () => void) => change(), []);
  /** Time for the other answers to leave one by one, before the picked one moves on. */
  const settle = () => wait(full ? 560 : level === 'lite' ? 200 : 0);

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

  /** Pick an answer: the orb flies onto it, the others leave one by one, then it moves up into the trail. */
  const pick = async (label: string) => {
    if (picked !== null) return;
    if (view === 'start') {
      setPicked(label);
      await settle();
      setPicked(null);
      return startKind(START_KIND[label]);
    }
    if (!project || !flow || !step) return;
    setPicked(label);
    await settle();
    setPicked(null);
    after(project, answer(flow, project.answers, step.id, label));
  };

  /** Tap an earlier answer: back to that question (the answers after it are asked again). */
  const revisit = (stepId: string) => {
    if (!project || !flow) return;
    const order = stepsFor(flow, project.answers).map((s) => s.id);
    const cut = order.indexOf(stepId);
    keep({ ...project, answers: Object.fromEntries(Object.entries(project.answers).filter(([k]) => order.indexOf(k) < cut)) });
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

  const confirmAdult = async (yes: boolean) => {
    setPicked(yes ? 'I am 18 or older' : 'Take me back');
    await settle();
    setPicked(null);
    if (!yes) {
      if (history.length > 1) history.back();
      else window.location.href = 'about:blank';
      return;
    }
    try {
      localStorage.setItem(adultKey, '1');
    } catch {
      /* asked again next time */
    }
    setView('home');
  };

  const canBack = view !== 'home' && view !== 'gate';
  const canSave = (view === 'walk' || view === 'make') && project?.status === 'draft';

  // The walkthrough scrolls itself (its trail above the question); every other screen is one column.
  let body: React.ReactNode = null;
  let walking = false;
  if (view === 'gate') body = <Gate studio={studio} picked={picked} onPick={(yes) => void confirmAdult(yes)} />;
  else if (view === 'home') body = <Home studio={studio} projects={projects} onOpen={open} onNew={() => void go(() => setView('start'))} onTalk={() => startKind('talk')} />;
  else if (view === 'start')
    body = (
      <article className="st-sheet" aria-labelledby="st-start-t">
        <p className="o5-kicker st-kick">
          <span>Opening</span>
        </p>
        <Headline text="What shall we *make?*" id="st-start-t" orb={picked === null} />
        <p className="st-dek">Pick one. Every choice is a short walk, one question at a time.</p>
        <Choices items={START} picked={picked} onPick={(l) => void pick(l)} delay={0.2} />
      </article>
    );
  else if (view === 'walk' && step && project && flow) {
    const { n, total } = progressOf(flow, project.answers);
    walking = true;
    body = (
      <Walk
        flow={flow}
        answers={project.answers}
        step={step}
        n={n}
        total={total}
        choices={mergeChoices(predicted, step.choices)}
        predicting={predicting}
        picked={picked}
        onPick={(l) => void pick(l)}
        onPickForMe={pickForMe}
        onFinishForMe={finishForMe}
        onRevisit={revisit}
      />
    );
  } else if ((view === 'make' || view === 'walk') && project) body = <Make studio={studio} project={project} onChange={keep} />;
  else if (view === 'talk') body = <Talk studio={studio} onMake={(k, seed) => startKind(k, seed)} />;
  const screen = view === 'walk' && !walking ? 'make' : view;

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
        {/* One screen leaves (sinking into a blur) before the next rises in. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${screen}|${project?.id ?? ''}`}
            className="st-view"
            initial={full ? { opacity: 0, y: 28, filter: 'blur(14px)' } : { opacity: 0 }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? SPRING.smooth : transitionFor(level) }}
            exit={full ? { opacity: 0, y: -18, filter: 'blur(14px)', transition: { ...SPRING.smooth, stiffness: 260 } } : { opacity: 0, transition: transitionFor(level) }}
          >
            {walking ? body : <div className="st-scroll">{body}</div>}
          </motion.div>
        </AnimatePresence>
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
  // Only ever this member's own work (the studio's AI keeps everyone's apart).
  useEffect(() => {
    studioAi
      .studioItems()
      .then(
        (list) => setItems(list),
        () => setError('Your pictures and films show here while the studio is awake. Start something and it wakes up.'),
      );
  }, []);
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
