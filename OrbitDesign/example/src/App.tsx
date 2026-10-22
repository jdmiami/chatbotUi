/**
 * Postcard: a whole studio screen flow in the Orbit style, with no network and no AI. It follows
 * docs/07-layout-and-navigation.md to the letter (the Views, the bars, the trail, drafts) and shows
 * the orb sitting on what each screen wants next. "Making" is pretended with a timer and a drawn
 * picture, so every screen can be seen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BottomBar,
  BriefList,
  Choices,
  ContentsList,
  Drawer,
  Empty,
  Go,
  Headline,
  Home,
  Making,
  OptionsDrawer,
  Page,
  Result,
  Root,
  SHELVES,
  ScriptDesk,
  ScriptPreview,
  Stage,
  Talk,
  Toasts,
  TopBar,
  Walk,
  toast,
  useVisualViewport,
  type Shelf,
} from 'orbit-design/components';
import { useMotionLevel } from 'orbit-design/motion';
import {
  POSTCARD,
  SCRIPT_OK,
  answer,
  back as backOne,
  briefOf,
  draftScript,
  finishAll,
  keepCharacter,
  listProjects,
  mergeChoices,
  newProject,
  nextStep,
  onOrbAct,
  orbHome,
  orbNote,
  orbThink,
  pickFor,
  predictChoices,
  progressOf,
  promptOf,
  recommend,
  saveProject,
  scriptBasis,
  stepsFor,
  writerAwake,
  type Answers,
  type Choice,
  type MakeKind,
  type Project,
  type Scene,
} from 'orbit-design/walkthrough';

type View = 'home' | 'start' | 'walk' | 'make' | 'talk';
const studio = POSTCARD;

const START: Choice[] = [
  { label: 'Talk it through', hint: 'Plan it with the writer first' },
  { label: 'A postcard', hint: 'One frame, in under a minute' },
  { label: 'A video', hint: 'A moving moment, with sound' },
  { label: 'A short film', hint: 'A story, a script, then the film' },
];
const START_KIND: Record<string, MakeKind> = { 'Talk it through': 'talk', 'A postcard': 'image', 'A video': 'video', 'A short film': 'movie' };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const titleOf = (p: Project) => (p.kind === 'movie' ? (p.answers.premise ?? '') : [p.answers.world, p.answers.light].filter(Boolean).join(' · '));

/** A stand-in for a made picture: a drawn gradient, so the result screen can be seen offline. */
function pretendPicture(seed: string): string {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 400;
  const g = c.getContext('2d')!;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const grad = g.createLinearGradient(0, 0, 640, 400);
  grad.addColorStop(0, `hsl(${h % 360} 40% 30%)`);
  grad.addColorStop(1, `hsl(${(h + 60) % 360} 50% 70%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 400);
  return c.toDataURL('image/png');
}

export function App() {
  useVisualViewport();
  const level = useMotionLevel();
  const full = level === 'full';
  const [view, setView] = useState<View>('home');
  const [projects, setProjects] = useState(() => listProjects(studio.id));
  const [project, setProject] = useState<Project | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [predicted, setPredicted] = useState<Choice[]>([]);
  const [predicting, setPredicting] = useState(false);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [options, setOptions] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // The studio's colours on <html> (docs/02-tokens.md, "The studio theme").
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    root.dataset.skin = 'o5';
    root.dataset.studio = studio.id;
    const t = studio.theme;
    const vars: Record<string, string> = { '--st-paper': t.paper, '--st-ink': t.ink, '--st-ink2': t.ink2, '--st-accent': t.accent, '--st-desk': t.desk, '--st-desk2': t.desk2, '--accent': t.orbA, '--orb-a': t.orbA, '--orb-b': t.orbB };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    document.title = studio.name;
  }, []);

  const flow = project ? studio.flows[project.kind] : null;
  const step = view === 'walk' && flow && project ? nextStep(flow, project.answers) : null;
  const stepKey = `${view}|${step?.id ?? ''}|${project?.id ?? ''}`;

  // Predictions (only with a writer set and awake; otherwise the ready answers stand alone).
  useEffect(() => {
    setPredicted([]);
    if (!step || !flow || !project) return;
    let on = true;
    setPredicting(writerAwake() && step.predict !== false && !step.closed && Object.keys(project.answers).some((k) => k !== 'cut'));
    void predictChoices(studio, flow, step, project.answers).then((list) => {
      if (!on) return;
      setPredicted(list);
      setPredicting(false);
    });
    return () => {
      on = false;
    };
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The orb's pick, and the note it keeps until tapped (docs/09-orb.md, "Notes").
  const offered = step ? mergeChoices(predicted, step.choices) : [];
  const rec = step && flow && project && step.kind !== 'script' ? recommend(flow, project.answers, step, offered, predicted) : null;
  useEffect(() => {
    if (view === 'walk' && step?.kind === 'script') return orbNote('This draft follows your choices, one five-second shot per scene. Change any scene, or film it as it is.', { label: 'This is the script', id: 'approve-script' });
    if (view === 'walk' && rec) return orbNote(`I’d go with “${rec.label}”. ${rec.why}`, { label: `Go with “${rec.label}”`, id: 'pick' });
    const lines: Partial<Record<View, string>> = {
      start: 'Pick what to make. A short film walks you through the story, the script and the storyboard.',
      talk: 'Pick a mood, or say your own.',
      home: projects.length ? 'Pick a project up, or start something new.' : 'Tap “Start something new” and I’ll walk you through it.',
    };
    orbNote(lines[view] ?? null);
  }, [stepKey, rec?.label]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => orbNote(null), []);
  // Each new question brings a thrown orb home.
  useEffect(() => {
    orbHome();
    const t = setTimeout(orbHome, full ? 650 : 120);
    return () => clearTimeout(t);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    orbThink(predicting ? 0.7 : null);
    return () => orbThink(null);
  }, [predicting]);
  // What the orb's brain (if any) would be told about this screen.
  useEffect(() => {
    document.documentElement.dataset.orbContext = `You are the guide inside ${studio.name}. ${studio.writer} The member is on the ${view} screen${step ? `, at the question "${step.q.replace(/\*/g, '')}"` : ''}.`;
    return () => void delete document.documentElement.dataset.orbContext;
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const settle = () => wait(full ? 560 : level === 'lite' ? 200 : 0);
  const keep = useCallback((p: Project) => {
    const saved = saveProject(studio.id, { ...p, title: titleOf(p) || p.title });
    setProject(saved);
    setProjects(listProjects(studio.id));
    return saved;
  }, []);

  const startKind = (kind: MakeKind, seed?: string) => {
    if (kind === 'talk') return setView('talk');
    const p = newProject(kind);
    if (seed) p.answers = kind === 'movie' ? { premise: seed } : {};
    setProject(keep(p));
    setView('walk');
  };

  const after = (p: Project, answers: Answers) => {
    const f = studio.flows[p.kind];
    if (answers.script && p.script?.basis !== scriptBasis(answers)) p = { ...p, script: { basis: scriptBasis(answers), scenes: draftScript(answers), by: 'draft' } };
    for (const s of stepsFor(f, answers)) if (s.key === 'Traveller' && answers[s.id] && !(s.id in p.answers)) keepCharacter(studio.id, `${s.key} · ${titleOf({ ...p, answers }) || studio.name}`, answers[s.id]);
    const saved = keep({ ...p, answers });
    if (!nextStep(f, answers)) setView('make');
    return saved;
  };

  const pick = async (label: string) => {
    if (picked !== null) return;
    orbHome();
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

  // The script step: drafted from the answers, again whenever the answers it came from change.
  useEffect(() => {
    if (step?.kind !== 'script' || !project) return;
    const basis = scriptBasis(project.answers);
    if (project.script?.basis !== basis) keep({ ...project, script: { basis, scenes: draftScript(project.answers), by: 'draft' } });
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeScript = (scenes: Scene[], by: NonNullable<Project['script']>['by']) => project?.script && keep({ ...project, script: { ...project.script, scenes, by } });
  const approveScript = () => {
    if (!project || !flow || !step || step.kind !== 'script') return;
    orbHome();
    after(project, answer(flow, project.answers, step.id, `${project.script?.scenes.length ?? ''} scenes, ${SCRIPT_OK.toLowerCase()}`.trim()));
  };

  // The orb's panel buttons.
  const acts = useRef<Record<string, () => void>>({});
  acts.current = { pick: () => rec && void pick(rec.label), 'approve-script': approveScript, make: () => void make() };
  useEffect(() => onOrbAct((id) => acts.current[id]?.()), []);

  const revisit = (stepId: string) => {
    if (!project || !flow) return;
    const order = stepsFor(flow, project.answers).map((s) => s.id);
    const cut = order.indexOf(stepId);
    keep({ ...project, answers: Object.fromEntries(Object.entries(project.answers).filter(([k]) => order.indexOf(k) < cut)) });
  };
  const pickForMe = () => (step?.kind === 'script' ? approveScript() : step && void pick(pickFor(step, offered)));
  const finishForMe = () => project && flow && after(project, finishAll(flow, project.answers));

  const goBack = () => {
    if (view === 'walk' && project && flow) {
      if (!Object.keys(project.answers).length) return setView('start');
      return keep({ ...project, answers: backOne(flow, project.answers) });
    }
    if (view === 'make' && project && flow && project.status === 'draft') {
      keep({ ...project, answers: backOne(flow, project.answers) });
      return setView('walk');
    }
    if (view === 'start' || view === 'talk' || view === 'make') setView('home');
  };
  const goHome = () => view !== 'home' && setView('home');
  const saveDraft = () => {
    if (project) keep(project);
    toast('Saved. It is waiting in your projects.', 'success');
    goHome();
  };
  const open = (p: Project) => {
    setProject(p);
    setResult(null);
    setView(p.status === 'draft' && nextStep(studio.flows[p.kind], p.answers) ? 'walk' : 'make');
  };

  /** Pretend to make it: a progress bar for a moment, then a drawn picture. A real app calls its own service here. */
  const make = async () => {
    if (!project || !flow) return;
    keep({ ...project, status: 'making', error: null });
    orbThink(0.55);
    const notes = ['Warming up the studio.', 'Making it now.', 'Nearly there.'];
    for (const n of notes) {
      setNote(n);
      await wait(full ? 900 : 300);
    }
    orbThink(null);
    setNote(null);
    setResult(pretendPicture(promptOf(studio, flow, project.answers)));
    keep({ ...project, status: 'done', items: ['pretend'] });
  };

  // The brief screen's note for the orb.
  useEffect(() => {
    if (view !== 'make' || !project) return;
    const what = project.kind === 'image' ? 'postcard' : project.kind === 'video' ? 'video' : 'film';
    if (project.status === 'making') orbNote(note ?? 'Making it now.');
    else if (project.status === 'done') orbNote(`Your ${what} is ready.`);
    else orbNote(`Everything you picked, in one place. Tap “Make the ${what}” when it looks right.`, { label: `Make the ${what}`, id: 'make' });
  }, [view, project?.status, note]); // eslint-disable-line react-hooks/exhaustive-deps

  const canBack = view !== 'home';
  const canSave = (view === 'walk' || view === 'make') && project?.status === 'draft';
  let body: React.ReactNode = null;
  let walking = false;
  if (view === 'home') body = <Home studio={studio} projects={projects} onOpen={open} onNew={() => setView('start')} onTalk={() => startKind('talk')} />;
  else if (view === 'start')
    body = (
      <Page id="st-start-t" kick="Opening" title="What shall we *make?*" orb={picked === null} dek="Pick one. Every choice is a short walk, one question at a time.">
        <Choices items={START} picked={picked} onPick={(l) => void pick(l)} delay={0.2} />
      </Page>
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
        choices={offered}
        recommended={rec?.label ?? null}
        desk={step.kind === 'script' ? <ScriptDesk studio={studio} answers={project.answers} script={project.script?.basis === scriptBasis(project.answers) ? project.script : undefined} awake={writerAwake()} onChange={changeScript} onApprove={approveScript} /> : undefined}
        predicting={predicting}
        picked={picked}
        onPick={(l) => void pick(l)}
        onPickForMe={pickForMe}
        onFinishForMe={() => void finishForMe()}
        onRevisit={revisit}
      />
    );
  } else if ((view === 'make' || view === 'walk') && project && flow) {
    const what = project.kind === 'image' ? 'postcard' : project.kind === 'video' ? 'video' : 'film';
    const done = project.status === 'done' && result;
    body = (
      <article className="st-sheet st-brief" aria-labelledby="st-brief-t">
        <p className="o5-kicker st-kick">
          <span>The brief</span>
          <span className="st-num">{project.status === 'done' ? 'Finished' : project.status === 'making' ? 'Being made' : 'Ready'}</span>
        </p>
        {done ? <Headline text={`Here is your *${what}.*`} id="st-brief-t" /> : project.status === 'making' ? <Headline text={`Making your *${what}…*`} id="st-brief-t" /> : <Headline text="Here is your *brief.*" id="st-brief-t" orb={false} />}
        {done && <Result kind="image" url={result} alt={promptOf(studio, flow, project.answers)} />}
        {!done && <BriefList items={briefOf(flow, project.answers).filter((b) => b.key !== 'Script')} />}
        {project.status === 'draft' && project.kind === 'movie' && project.script && <ScriptPreview scenes={project.script.scenes} />}
        {project.status === 'making' && <Making progress={null} note={note} />}
        {project.status === 'draft' && <Go label={`Make the ${what}`} onClick={() => void make()} />}
      </article>
    );
  } else if (view === 'talk')
    body = (
      <Talk
        studio={studio}
        onMake={(k, seed) => startKind(k, seed)}
        // No AI in the sample: a canned reply. Replace with a Writer (setWriter) or your own onSend.
        onSend={async (text) => {
          await wait(600);
          return `“${text.slice(0, 60)}” — lovely. Picture the light first: is it morning, dusk or neon? Then tell me who is there, or tap “Make it a postcard”.`;
        }}
      />
    );
  const screen = view === 'walk' && !walking ? 'make' : view;

  return (
    <Root view={view}>
      <TopBar kicker={studio.kicker} mark={studio.mark} onOptions={() => setOptions(true)} onGallery={() => setShelf('projects')} />
      <Stage screenKey={`${screen}|${project?.id ?? ''}`} walking={walking}>
        {body}
      </Stage>
      <BottomBar canBack={canBack} canHome={view !== 'home'} canSave={Boolean(canSave)} onBack={goBack} onHome={goHome} onSave={saveDraft} />
      {shelf && (
        <Drawer label={`${studio.name}: your gallery`} title={<>Your <em>gallery</em></>} onClose={() => setShelf(null)} tabs={SHELVES} tab={shelf} onTab={setShelf}>
          {shelf === 'projects' ? (
            projects.length ? (
              <ContentsList rows={projects.map((p) => ({ id: p.id, title: p.title || 'Untitled', meta: p.kind, onClick: () => (setShelf(null), open(p)) }))} />
            ) : (
              <Empty>No projects yet. Start one from Home.</Empty>
            )
          ) : (
            <Empty>Nothing here yet.</Empty>
          )}
        </Drawer>
      )}
      {options && <OptionsDrawer rules={studio.rules} onClose={() => setOptions(false)} />}
      <Toasts />
    </Root>
  );
}
