/**
 * Compass: a whole app in the Orbit style, with no network and no AI. It follows
 * docs/07-layout-and-navigation.md to the letter (the views, the bars, the trail, drafts) and shows
 * the orb sitting on what each screen wants next. "Saving the plan" is pretended with a timer and a
 * drawn picture, so every screen can be seen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BottomBar,
  Choices,
  Contents,
  ContentsList,
  Conversation,
  Drawer,
  Empty,
  Go,
  Headline,
  MediaGrid,
  OptionsDrawer,
  Page,
  Progress,
  Result,
  Root,
  Stage,
  SummaryList,
  TABS,
  Toasts,
  TopBar,
  Walk,
  toast,
  useVisualViewport,
  type Tab,
} from 'orbit-design/components';
import { useMotionLevel } from 'orbit-design/motion';
import {
  COMPASS,
  CUSTOM_DONE,
  answer,
  assistantAwake,
  back as backOne,
  finishAll,
  listRuns,
  mergeChoices,
  newRun,
  nextStep,
  onOrbAct,
  orbHome,
  orbNote,
  orbThink,
  pickFor,
  progressOf,
  recommend,
  resultOf,
  saveRun,
  stepsFor,
  suggestChoices,
  summaryOf,
  wantsSuggestions,
  type Answers,
  type Choice,
  type Run,
} from 'orbit-design/flow';

type View = 'contents' | 'start' | 'walk' | 'summary' | 'talk';
const guide = COMPASS;
const flows = Object.values(guide.flows);

const TALK = 'Talk it through';
const START: Choice[] = [{ label: TALK, hint: 'Plan it in conversation first' }, ...flows.map((f) => ({ label: f.label, hint: f.hint }))];
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A run's title: its first two answers that are part of the result ("A harbour town · High summer"). */
const titleOf = (r: Run) => {
  const f = guide.flows[r.flowId];
  return f
    ? stepsFor(f, r.answers)
        .filter((s) => !s.meta && !s.custom && r.answers[s.id])
        .slice(0, 2)
        .map((s) => r.answers[s.id])
        .join(' · ')
    : '';
};

/** A stand-in for a saved plan: a drawn gradient with the summary on it, so the result screen can be seen offline. */
function pretendPlan(seed: string, lines: { key: string; value: string }[]): string {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 400;
  const g = c.getContext('2d')!;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const grad = g.createLinearGradient(0, 0, 640, 400);
  grad.addColorStop(0, `hsl(${h % 360} 40% 24%)`);
  grad.addColorStop(1, `hsl(${(h + 60) % 360} 50% 60%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 400);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '600 13px sans-serif';
  lines.slice(0, 7).forEach((l, i) => g.fillText(`${l.key.toUpperCase()}  ${l.value}`.slice(0, 70), 32, 48 + i * 34));
  return c.toDataURL('image/png');
}

export function App() {
  useVisualViewport();
  const level = useMotionLevel();
  const full = level === 'full';
  const [view, setView] = useState<View>('contents');
  const [runs, setRuns] = useState(() => listRuns(guide.id));
  const [run, setRun] = useState<Run | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Choice[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [options, setOptions] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  // The guide's colours on <html> (docs/02-tokens.md, "The guide's theme").
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    root.dataset.skin = 'o5';
    root.dataset.guide = guide.id;
    const t = guide.theme;
    const vars: Record<string, string> = { '--st-paper': t.paper, '--st-ink': t.ink, '--st-ink2': t.ink2, '--st-accent': t.accent, '--st-desk': t.desk, '--st-desk2': t.desk2, '--accent': t.orbA, '--orb-a': t.orbA, '--orb-b': t.orbB };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    document.title = guide.name;
  }, []);

  const flow = run ? guide.flows[run.flowId] : null;
  const step = view === 'walk' && flow && run ? nextStep(flow, run.answers) : null;
  const stepKey = `${view}|${step?.id ?? ''}|${run?.id ?? ''}`;

  // Suggestions (only with an assistant set and awake; otherwise the ready answers stand alone).
  useEffect(() => {
    setSuggested([]);
    if (!step || !flow || !run) return;
    let on = true;
    setSuggesting(assistantAwake() && wantsSuggestions(flow, step, run.answers));
    void suggestChoices(guide, flow, step, run.answers).then((list) => {
      if (!on) return;
      setSuggested(list);
      setSuggesting(false);
    });
    return () => {
      on = false;
    };
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The orb's pick, and the note it keeps until tapped (docs/09-orb.md, "Notes").
  const offered = step ? mergeChoices(suggested, step.choices) : [];
  const rec = step && flow && run && !step.custom ? recommend(flow, run.answers, step, offered, suggested) : null;
  useEffect(() => {
    if (view === 'walk' && step?.custom) return orbNote('Write anything the plan should remember, or go on without.', { label: 'Go on without notes', id: 'skip-notes' });
    if (view === 'walk' && rec) return orbNote(`I’d go with “${rec.label}”. ${rec.why}`, { label: `Go with “${rec.label}”`, id: 'pick' });
    const lines: Partial<Record<View, string>> = {
      start: 'Pick what to plan. Each one is a short walk, one question at a time.',
      talk: 'Pick a way to start, or say your own.',
      contents: runs.length ? 'Pick a draft up, or start something new.' : 'Tap “Start something new” and I’ll walk you through it.',
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
    orbThink(suggesting ? 0.7 : null);
    return () => orbThink(null);
  }, [suggesting]);
  // What the orb's brain (if any) would be told about this screen.
  useEffect(() => {
    document.documentElement.dataset.orbContext = `You are the guide inside ${guide.name}, an app that plans a trip or an evening one question at a time. The person is on the ${view} screen${step ? `, at the question "${step.q.replace(/\*/g, '')}"` : ''}.`;
    return () => void delete document.documentElement.dataset.orbContext;
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const settle = () => wait(full ? 560 : level === 'lite' ? 200 : 0);
  const keep = useCallback((r: Run) => {
    const saved = saveRun(guide.id, { ...r, title: titleOf(r) || r.title });
    setRun(saved);
    setRuns(listRuns(guide.id));
    return saved;
  }, []);

  /** Start a flow; `seed` (from a conversation) is kept as the first draft of the notes. */
  const startFlow = (flowId: string, seed = '') => {
    setNotes(seed);
    setResult(null);
    setRun(keep(newRun(flowId)));
    setView('walk');
  };

  const after = (r: Run, answers: Answers) => {
    const f = guide.flows[r.flowId];
    const saved = keep({ ...r, answers });
    if (!nextStep(f, answers)) setView('summary');
    return saved;
  };

  const pick = async (label: string) => {
    if (picked !== null) return;
    orbHome();
    if (view === 'start') {
      setPicked(label);
      await settle();
      setPicked(null);
      if (label === TALK) return setView('talk');
      const f = flows.find((x) => x.label === label);
      return f && startFlow(f.id);
    }
    if (!run || !flow || !step) return;
    setPicked(label);
    await settle();
    setPicked(null);
    after(run, answer(flow, run.answers, step.id, label));
  };

  // The custom step (notes): the app renders a text box and answers with its value, or goes on without.
  const takeNotes = (text: string) => {
    if (!run || !flow || !step?.custom) return;
    orbHome();
    setNotes('');
    after(run, answer(flow, run.answers, step.id, text.trim() || CUSTOM_DONE));
  };

  // The orb's panel buttons.
  const acts = useRef<Record<string, () => void>>({});
  acts.current = { pick: () => rec && void pick(rec.label), 'skip-notes': () => takeNotes(''), save: () => void save() };
  useEffect(() => onOrbAct((id) => acts.current[id]?.()), []);

  const revisit = (stepId: string) => {
    if (!run || !flow) return;
    const order = stepsFor(flow, run.answers).map((s) => s.id);
    const cut = order.indexOf(stepId);
    keep({ ...run, answers: Object.fromEntries(Object.entries(run.answers).filter(([k]) => order.indexOf(k) < cut)) });
  };
  const pickForMe = () => (step?.custom ? takeNotes('') : step && void pick(pickFor(step, offered)));
  const finishForMe = () => run && flow && after(run, finishAll(flow, run.answers));

  const goBack = () => {
    if (view === 'walk' && run && flow) {
      if (!Object.keys(run.answers).length) return setView('start');
      return keep({ ...run, answers: backOne(flow, run.answers) });
    }
    if (view === 'summary' && run && flow && run.status === 'draft') {
      keep({ ...run, answers: backOne(flow, run.answers) });
      return setView('walk');
    }
    if (view === 'start' || view === 'talk' || view === 'summary') setView('contents');
  };
  const goHome = () => view !== 'contents' && setView('contents');
  const saveDraft = () => {
    if (run) keep(run);
    toast('Saved. It is waiting in your drafts.', 'success');
    goHome();
  };
  const open = (r: Run) => {
    setRun(r);
    setResult(typeof r.result === 'string' ? r.result : null);
    setView(r.status === 'draft' && nextStep(guide.flows[r.flowId], r.answers) ? 'walk' : 'summary');
  };

  /** Pretend to save the plan: a progress bar for a moment, then a drawn picture. A real app calls its own service here. */
  const save = async () => {
    if (!run || !flow || saving) return;
    setSaving(true);
    orbThink(0.55);
    const notes = ['Putting it together.', 'Checking the dates.', 'Nearly there.'];
    for (const n of notes) {
      setNote(n);
      await wait(full ? 900 : 300);
    }
    orbThink(null);
    setNote(null);
    const picture = pretendPlan(resultOf(flow, run.answers), summaryOf(flow, run.answers));
    setResult(picture);
    setSaving(false);
    keep({ ...run, status: 'done', result: picture });
  };

  // The summary screen's note for the orb.
  useEffect(() => {
    if (view !== 'summary' || !run) return;
    if (saving) orbNote(note ?? 'Putting it together.');
    else if (run.status === 'done') orbNote('Your plan is ready. It is in your drafts too.');
    else orbNote('Everything you picked, in one place. Tap “Save the plan” when it looks right.', { label: 'Save the plan', id: 'save' });
  }, [view, run?.status, saving, note]); // eslint-disable-line react-hooks/exhaustive-deps

  // Not while a plan is being saved: backing out mid-save would let the save overwrite the new answers.
  const canBack = view !== 'contents' && !saving;
  const canSave = (view === 'walk' || view === 'summary') && run?.status === 'draft' && !saving;
  let body: React.ReactNode = null;
  let walking = false;
  if (view === 'contents') body = <Contents guide={guide} runs={runs} onOpen={open} onNew={() => setView('start')} onTalk={() => setView('talk')} />;
  else if (view === 'start')
    body = (
      <Page id="st-start-t" kick="Opening" title="What shall we *plan?*" orb={picked === null} dek="Pick one. Every choice is a short walk, one question at a time.">
        <Choices items={START} picked={picked} onPick={(l) => void pick(l)} delay={0.2} />
      </Page>
    );
  else if (view === 'walk' && step && run && flow) {
    const { n, total } = progressOf(flow, run.answers);
    walking = true;
    body = (
      <Walk
        flow={flow}
        answers={run.answers}
        step={step}
        n={n}
        total={total}
        choices={offered}
        recommended={rec?.label ?? null}
        custom={
          step.custom === 'notes' ? (
            <form
              className="st-own"
              onSubmit={(e) => {
                e.preventDefault();
                takeNotes(notes);
              }}
            >
              <label className="o5-kicker" htmlFor="st-notes">
                Your notes
              </label>
              <textarea id="st-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything at all…" />
              <button type="submit">{notes.trim() ? 'Use these' : 'Nothing to add'}</button>
            </form>
          ) : undefined
        }
        suggesting={suggesting}
        picked={picked}
        onPick={(l) => void pick(l)}
        onPickForMe={pickForMe}
        onFinishForMe={() => void finishForMe()}
        onRevisit={revisit}
      />
    );
  } else if ((view === 'summary' || view === 'walk') && run && flow) {
    const done = run.status === 'done' && result;
    body = (
      <article className="st-sheet st-summary-page" aria-labelledby="st-summary-t">
        <p className="o5-kicker st-kick">
          <span>The summary</span>
          <span className="st-num">{run.status === 'done' ? 'Finished' : saving ? 'Saving' : 'Ready'}</span>
        </p>
        {done ? <Headline text="Here is your *plan.*" id="st-summary-t" /> : saving ? <Headline text="Saving your *plan…*" id="st-summary-t" /> : <Headline text="Here is your *summary.*" id="st-summary-t" orb={false} />}
        {done && <Result kind="image" url={result} alt={resultOf(flow, run.answers)} />}
        {!done && <SummaryList items={summaryOf(flow, run.answers)} />}
        {saving && <Progress progress={null} note={note} />}
        {run.status === 'draft' && !saving && <Go label="Save the plan" onClick={() => void save()} />}
      </article>
    );
  } else if (view === 'talk')
    body = (
      <Conversation
        title="Where shall we *go?*"
        kicker="Talk"
        num={guide.name}
        starters={guide.starters ?? []}
        followUps={guide.followUps ?? []}
        placeholder="A week somewhere warm…"
        actions={[
          { label: 'Plan a trip from this', icon: 'forward', onClick: (seed) => startFlow('trip', seed) },
          { label: 'Just an evening', icon: 'talk', onClick: (seed) => startFlow('evening', seed) },
        ]}
        // No AI in the sample: a canned reply. Replace with an Assistant (setAssistant) or your own onSend.
        onSend={async (text) => {
          await wait(600);
          return `“${text.slice(0, 60)}” — good. Picture the season first: spring, summer or autumn? Then tell me who is coming, or tap “Plan a trip from this”.`;
        }}
      />
    );
  const screen = view === 'walk' && !walking ? 'summary' : view;
  const made = runs.filter((r) => typeof r.result === 'string');

  return (
    <Root view={view}>
      <TopBar kicker={guide.kicker} mark={guide.mark} onOptions={() => setOptions(true)} onGallery={() => setTab('drafts')} />
      <Stage screenKey={`${screen}|${run?.id ?? ''}`} walking={walking}>
        {body}
      </Stage>
      <BottomBar canBack={canBack} canHome={view !== 'contents'} canSave={Boolean(canSave)} onBack={goBack} onHome={goHome} onSave={saveDraft} />
      {tab && (
        <Drawer label={`${guide.name}: your gallery`} title={<>Your <em>gallery</em></>} onClose={() => setTab(null)} tabs={TABS} tab={tab} onTab={setTab}>
          {tab === 'drafts' ? (
            runs.length ? (
              <ContentsList rows={runs.map((r) => ({ id: r.id, title: r.title || 'Untitled', meta: guide.flows[r.flowId]?.label ?? r.flowId, onClick: () => (setTab(null), open(r)) }))} />
            ) : (
              <Empty>No drafts yet. Start one from the contents page.</Empty>
            )
          ) : tab === 'items' ? (
            made.length ? (
              <MediaGrid items={made.map((r) => ({ id: r.id, kind: 'image', url: r.result as string, alt: r.title }))} />
            ) : (
              <Empty>Nothing made yet. Finish a plan and save it.</Empty>
            )
          ) : (
            <>
              <ul className="st-rules">
                {(guide.rules ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="st-dek">{guide.name} is a sample of the OrbitDesign look: one question at a time, with the orb beside the answer it would pick.</p>
            </>
          )}
        </Drawer>
      )}
      {options && <OptionsDrawer rules={guide.rules ?? []} onClose={() => setOptions(false)} />}
      <Toasts />
    </Root>
  );
}
