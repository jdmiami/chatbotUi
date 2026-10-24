import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShell } from '../../state/shell';
import { cue } from '../../motion/feedback';
import { Icon } from '../../ui/Icon';
import { ConfirmSheet } from '../../ui/components';
import { TextArea } from '../../ui/TextArea';
import { useOrbAssist, type AssistOption, type OrbAssist } from '../../shell/orb/assist';
import { sheetComplete, thumbOf, type Character, type CharactersApi, type SheetRun } from '../../services/ai/Characters';
import { StepDeck, type DeckStep } from './StepDeck';
import { FillButton, TalkButton } from './StepTools';
import type { IdeaBox } from './ideas';
import { GENDERS, OPTIONS, STYLES, TRAIT_LABEL, ageProblem, designFromIdea, draftOf, emptyDraft, inputOf, missingFor, type Draft, type TraitKey } from './characterOptions';
import './characters.css';

/**
 * Make a character, one part per screen like Make's own steps (swipe left for the next, right to go
 * back): name and age, look, face and hair, outfit, personality, the reference sheet (made on the AI
 * machine, view by view), then save. Hold to talk and Fill for me are on every typing step, and the
 * orb helps with each. The machine checks every rule (grown-ups only, nobody real, nothing sexual).
 */
type StepId = 'who' | 'look' | 'face' | 'outfit' | 'personality' | 'sheet' | 'save';
const STEP_NAME: Record<StepId, string> = { who: 'Name & age', look: 'Look', face: 'Face & hair', outfit: 'Outfit', personality: 'Personality', sheet: 'Reference sheet', save: 'Save' };
const STEP_ORDER: StepId[] = ['who', 'look', 'face', 'outfit', 'personality', 'sheet', 'save'];

const about = (sec: number) => (sec < 90 ? 'less than 2 min' : `about ${Math.round(sec / 60)} min`);

/** One trait: common choices as chips, or your own words. */
function TraitRow({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const own = value !== '' && !options.some((o) => o.toLowerCase() === value.toLowerCase());
  const [custom, setCustom] = useState(false);
  const showInput = custom || own;
  return (
    <div className="mk-row chr-trait">
      <p className="o5-kicker">{label}</p>
      <div className="mk-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === o.toLowerCase()}
            className="mk-chip"
            data-assist-option={`${id}:${o}`}
            onClick={() => {
              onChange(value.toLowerCase() === o.toLowerCase() ? '' : o);
              setCustom(false);
              cue('pop');
            }}
          >
            {o}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={showInput} className="mk-chip" onClick={() => setCustom(true)}>
          Own words
        </button>
      </div>
      {showInput && <input className="input ai-target chr-own" aria-label={`${label}, in your own words`} value={value} maxLength={100} onChange={(e) => onChange(e.target.value)} placeholder={`${label}, in your own words`} enterKeyHint="done" />}
    </div>
  );
}

export function CharacterWizard({
  api,
  machineOn,
  isActive,
  existing,
  onSaved,
  onChanged,
}: {
  api: CharactersApi;
  machineOn: boolean;
  isActive: boolean;
  /** Editing this character, or continuing an unfinished one; null: a new one. */
  existing: Character | null;
  /** Saved: the character, ready to use. */
  onSaved: (c: Character) => void;
  /** The machine now has (or changed) this character: the library refreshes. */
  onChanged: (c: Character) => void;
}) {
  const toast = useShell((s) => s.toast);
  const [step, setStep] = useState<StepId>(existing ? (existing.sheet.length ? 'sheet' : 'who') : 'who');
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<Draft>(() => (existing ? draftOf(existing) : emptyDraft()));
  const [charId, setCharId] = useState<string | null>(existing?.id ?? null);
  const [character, setCharacter] = useState<Character | null>(existing);
  /** What the machine has saved, to tell when the look changed and the sheet no longer fits. */
  const [saved, setSaved] = useState<Draft | null>(existing ? draftOf(existing) : null);
  const [run, setRun] = useState<SheetRun | null>(null);
  const [extras, setExtras] = useState(true);
  const [busy, setBusy] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [serverProblem, setServerProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmFront, setConfirmFront] = useState(false);
  const designTries = useRef(0);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const go = useCallback((id: string) => {
    setStep(id as StepId);
    cue('tap');
  }, []);

  /* ---------------------------------------------------------------- the rules, said as you type */
  const typed = JSON.stringify(inputOf(draft));
  useEffect(() => {
    if (!machineOn) return;
    const input = inputOf(draft);
    if (!input.name && !input.idea && !input.traits.hair && !input.traits.marks && !input.traits.outfits?.length && !input.traits.personality) return setServerProblem(null);
    let live = true;
    const t = setTimeout(() => {
      api.check({ ...input, age: input.age || undefined }).then(
        (p) => live && setServerProblem(p),
        () => live && setServerProblem(null),
      );
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typed, machineOn, api]); // eslint-disable-line react-hooks/exhaustive-deps
  const problem = ageProblem(draft.age) ?? serverProblem;
  const missing = missingFor(draft);
  const problemLine = problem ? (
    <p className="chr-problem" role="alert">
      {problem}
    </p>
  ) : null;

  /* ---------------------------------------------------------------- the machine's sheet */
  const running = run?.status === 'running';
  useEffect(() => {
    if (!charId || !isActive) return;
    let live = true;
    // Pick up a sheet that was already being made (an unfinished character opened again).
    api.sheet(charId).then(
      (r) => {
        if (!live) return;
        setRun(r.run);
        setCharacter(r.character);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [charId, isActive, api]);
  useEffect(() => {
    if (!charId || !running || !isActive) return;
    const t = setInterval(() => {
      api.sheet(charId).then(
        (r) => {
          setRun(r.run);
          setCharacter(r.character);
          if (r.run.status !== 'running') {
            onChanged(r.character);
            cue(r.run.status === 'done' ? 'done' : 'error');
          }
        },
        () => {},
      );
    }, 2000);
    return () => clearInterval(t);
  }, [charId, running, isActive, api, onChanged]);

  /** The words are saved on the machine (a new draft, or the changes), so the sheet can be made. */
  const ensureSaved = async (): Promise<Character> => {
    const input = inputOf(draft);
    const c = charId ? await api.update(charId, input) : await api.create(input);
    setCharId(c.id);
    setCharacter(c);
    setSaved(draftOf(c));
    onChanged(c);
    return c;
  };

  const explain = (err: unknown) => (err as Error).message || 'That did not work.';

  const startSheet = async (redo = false) => {
    if (busy) return;
    if (missing) {
      setFailure(missing);
      go('who');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const c = await ensureSaved();
      setRun(await api.startSheet(c.id, { extras, redo: redo || Boolean(c.sheetStale) }));
      cue('send');
    } catch (err) {
      setFailure(explain(err));
      cue('error');
    } finally {
      setBusy(false);
    }
  };
  const stopSheet = async () => {
    if (!charId) return;
    try {
      setRun(await api.stopSheet(charId));
    } catch (err) {
      toast(explain(err), 'error');
    }
  };
  const redoView = async (view: string) => {
    if (!charId) return;
    setFailure(null);
    try {
      setRun(await api.redoView(charId, view));
    } catch (err) {
      setFailure(explain(err));
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      let c = await ensureSaved();
      if (c.status !== 'ready') c = await api.accept(c.id);
      cue('done');
      onSaved(c);
    } catch (err) {
      setFailure(explain(err));
      cue('error');
    } finally {
      setBusy(false);
    }
  };

  /** A whole character from the one line. */
  const design = async () => {
    if (!draft.idea.trim() || designing) return;
    setDesigning(true);
    cue('tap');
    try {
      const d = await designFromIdea(draft.idea, designTries.current++);
      setDraft((prev) => ({ ...d, idea: prev.idea }));
      toast('Designed. Look through each step and change anything you like.', 'info');
      cue('pop');
    } finally {
      setDesigning(false);
    }
  };
  const surprise = () => {
    const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
    setDraft((d) => ({ ...d, build: pick(OPTIONS.build), height: pick(OPTIONS.height), skin: pick(OPTIONS.skin), face: pick(OPTIONS.face), eyes: pick(OPTIONS.eyes), hair: pick(OPTIONS.hair) }));
    cue('pop');
  };

  /* ---------------------------------------------------------------- for the orb */
  const stepNo = STEP_ORDER.indexOf(step) + 1;
  const context = `Character maker, step ${stepNo} of ${STEP_ORDER.length}, ${STEP_NAME[step]}: a made-up adult character${draft.name ? ` called ${draft.name}` : ''}`;
  const target = () => pane?.querySelector<HTMLElement>('[data-assist-target]') ?? null;
  const optionEl = (id: string) => pane?.querySelector<HTMLElement>(`[data-assist-option="${CSS.escape(id)}"]`) ?? null;
  const styleOptions: AssistOption[] = STYLES.map((s) => ({ id: s.id, label: s.label }));
  // The look (not the name, the personality or the other outfits) decides whether the sheet still fits.
  const looks = (d: Draft) => [d.style, d.gender, d.age, d.build, d.height, d.skin, d.face, d.eyes, d.hair, d.marks, d.outfits[0] ?? ''].map((x) => x.trim().toLowerCase()).join('|');
  const stale = Boolean(character?.sheetStale) || Boolean(saved && character?.sheet.length && looks(saved) !== looks(draft));
  const canAccept = Boolean(character) && sheetComplete(character!) && !running && !stale;
  const assist: OrbAssist | null = useMemo(() => {
    if (!isActive || !pane) return null;
    const t = target();
    switch (step) {
      case 'who':
        return { id: 'character:who', context: `${context}. A one-line idea for the whole character.`, target: t, kind: 'text', value: draft.idea, setValue: (v) => set('idea', v) };
      case 'look':
        return { id: 'character:look', context, target: t, kind: 'choice', options: styleOptions.map((o) => ({ ...o, el: optionEl(`style:${o.id}`) })), selected: draft.style, choose: (id) => set('style', id as Draft['style']) };
      case 'face':
        return { id: 'character:face', context: `${context}. Distinguishing marks such as a scar, freckles or glasses.`, target: t, kind: 'text', value: draft.marks, setValue: (v) => set('marks', v) };
      case 'outfit':
        return { id: 'character:outfit', context: `${context}. Everyday clothes, fully dressed.`, target: t, kind: 'text', value: draft.outfits[0] ?? '', setValue: (v) => setDraft((d) => ({ ...d, outfits: [v, ...d.outfits.slice(1)] })) };
      case 'personality':
        return { id: 'character:personality', context: `${context}. Personality notes: traits and habits.`, target: t, kind: 'text', value: draft.personality, setValue: (v) => set('personality', v) };
      case 'sheet':
        return { id: 'character:sheet', context: `${context}. ${running ? 'The sheet is being made.' : 'Make the reference sheet.'}`, target: t, kind: 'choice', options: running || canAccept ? [] : [{ id: 'make', label: 'Make the sheet', el: t }], selected: null, choose: () => void startSheet() };
      case 'save':
        return { id: 'character:save', context, target: t, kind: 'choice', options: [{ id: 'save', label: 'Save the character', el: t }], selected: null, choose: () => void save() };
    }
  }, [isActive, pane, step, context, draft, running, canAccept]); // eslint-disable-line react-hooks/exhaustive-deps
  useOrbAssist(assist);

  const tools = (box: IdeaBox, id: string, value: string, setValue: (v: string) => void, what: string) => (
    <div className="mk-tools" role="group" aria-label={`Help with ${what}`}>
      <TalkButton value={value} onChange={setValue} what={what} />
      <FillButton box={box} id={id} context={`${context}. ${what}.`} value={value} onChange={setValue} />
    </div>
  );

  /* ---------------------------------------------------------------- the steps */
  const whoStep: DeckStep = {
    id: 'who',
    name: STEP_NAME.who,
    title: 'Who are they?',
    dek: 'A made-up grown-up, 25 or older. Short on ideas? Give the orb one line and it designs the whole character.',
    body: (
      <>
        <div className="mk-field" data-assist-target>
          <p className="o5-kicker">One line to start from (optional)</p>
          <TextArea value={draft.idea} onChange={(e) => set('idea', e.target.value)} rows={2} aria-label="A one-line idea" placeholder="e.g. a retired lighthouse keeper who restores old clocks" />
          <div className="mk-tools" role="group" aria-label="Help with the idea">
            <TalkButton value={draft.idea} onChange={(v) => set('idea', v)} what="the idea" />
            <FillButton box="charidea" id="character:idea" context={`${context}. A one-line idea for a character.`} value={draft.idea} onChange={(v) => set('idea', v)} />
            <button type="button" className="mk-tool chr-design" disabled={!draft.idea.trim() || designing} aria-busy={designing} onClick={() => void design()}>
              <Icon name="sparkle" size={18} />
              <span className="mk-tool-word">{designing ? 'Designing…' : 'Design it for me'}</span>
            </button>
          </div>
        </div>
        <div className="mk-field chr-name">
          <p className="o5-kicker">Name</p>
          <input className="input ai-target" value={draft.name} onChange={(e) => set('name', e.target.value)} aria-label="Name" placeholder="A name you invent" maxLength={40} enterKeyHint="next" autoComplete="off" />
          {tools('charname', 'character:name', draft.name, (v) => set('name', v), 'their name')}
        </div>
        <div className="mk-field chr-age">
          <p className="o5-kicker">Age</p>
          <input className="input ai-target" value={draft.age} onChange={(e) => set('age', e.target.value.replace(/[^\d]/g, '').slice(0, 3))} aria-label="Age" inputMode="numeric" placeholder="25 or older" enterKeyHint="done" autoComplete="off" />
        </div>
        {problemLine}
      </>
    ),
  };

  const lookStep: DeckStep = {
    id: 'look',
    name: STEP_NAME.look,
    title: 'How do they look?',
    dek: 'Pick what fits. Everything can be changed later.',
    body: (
      <>
        <div className="mk-row" data-assist-target>
          <p className="o5-kicker">Style</p>
          <div className="mk-chips" role="radiogroup" aria-label="Style">
            {STYLES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={draft.style === s.id} className="mk-chip" data-assist-option={`style:${s.id}`} title={s.hint} onClick={() => (set('style', s.id), cue('pop'))}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mk-row">
          <p className="o5-kicker">Shown as</p>
          <div className="mk-chips" role="radiogroup" aria-label="Shown as">
            {GENDERS.map((g) => (
              <button key={g.id} type="button" role="radio" aria-checked={draft.gender === g.id} className="mk-chip" onClick={() => (set('gender', g.id), cue('pop'))}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {(['build', 'height', 'skin'] as TraitKey[]).map((k) => (
          <TraitRow key={k} id={k} label={TRAIT_LABEL[k]} value={draft[k]} options={OPTIONS[k]} onChange={(v) => set(k, v)} />
        ))}
        <div className="mk-tools">
          <button type="button" className="mk-tool" onClick={surprise}>
            <Icon name="shuffle" size={18} />
            <span className="mk-tool-word">Surprise me</span>
          </button>
        </div>
      </>
    ),
  };

  const faceStep: DeckStep = {
    id: 'face',
    name: STEP_NAME.face,
    title: 'Face and hair',
    body: (
      <>
        {(['face', 'eyes', 'hair'] as TraitKey[]).map((k) => (
          <TraitRow key={k} id={k} label={TRAIT_LABEL[k]} value={draft[k]} options={OPTIONS[k]} onChange={(v) => set(k, v)} />
        ))}
        <div className="mk-field" data-assist-target>
          <p className="o5-kicker">Distinguishing marks (optional)</p>
          <TextArea value={draft.marks} onChange={(e) => set('marks', e.target.value)} rows={2} aria-label="Distinguishing marks" placeholder="e.g. a small scar over the left eyebrow, freckles" maxLength={200} />
          {tools('charmarks', 'character:marks', draft.marks, (v) => set('marks', v), 'their distinguishing marks')}
        </div>
        {problemLine}
      </>
    ),
  };

  const outfitStep: DeckStep = {
    id: 'outfit',
    name: STEP_NAME.outfit,
    title: 'What do they wear?',
    dek: 'Everyday clothes, fully dressed. Other outfits get their own picture on the sheet.',
    body: (
      <>
        <div className="mk-field" data-assist-target>
          <p className="o5-kicker">Everyday outfit</p>
          <TextArea
            value={draft.outfits[0] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, outfits: [e.target.value, ...d.outfits.slice(1)] }))}
            rows={2}
            aria-label="Everyday outfit"
            placeholder="e.g. a charcoal wool coat over a cream sweater and dark jeans"
            maxLength={140}
          />
          {tools('charoutfit', 'character:outfit', draft.outfits[0] ?? '', (v) => setDraft((d) => ({ ...d, outfits: [v, ...d.outfits.slice(1)] })), 'their outfit')}
        </div>
        {draft.outfits.slice(1).map((o, i) => (
          <div key={i} className="chr-outfit-more">
            <input
              className="input ai-target"
              aria-label={`Another outfit ${i + 1}`}
              value={o}
              maxLength={140}
              placeholder="Another outfit"
              onChange={(e) => setDraft((d) => ({ ...d, outfits: d.outfits.map((x, k) => (k === i + 1 ? e.target.value : x)) }))}
            />
            <button type="button" className="mk-tool" aria-label={`Remove outfit ${i + 2}`} onClick={() => setDraft((d) => ({ ...d, outfits: d.outfits.filter((_, k) => k !== i + 1) }))}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
        {problemLine}
        {draft.outfits.length < 3 && (
          <div className="mk-tools">
            <button type="button" className="mk-tool" onClick={() => setDraft((d) => ({ ...d, outfits: [...d.outfits, ''] }))}>
              <Icon name="plus" size={18} />
              <span className="mk-tool-word">Add another outfit</span>
            </button>
          </div>
        )}
      </>
    ),
  };

  const personalityStep: DeckStep = {
    id: 'personality',
    name: STEP_NAME.personality,
    title: 'What are they like?',
    dek: 'Notes for you and the orb. They do not change the pictures.',
    body: (
      <div className="mk-field" data-assist-target>
        <TextArea value={draft.personality} onChange={(e) => set('personality', e.target.value)} rows={3} aria-label="Personality notes" placeholder="e.g. dry humour, fiercely loyal, hates early mornings" maxLength={500} />
        {tools('charpersonality', 'character:personality', draft.personality, (v) => set('personality', v), 'their personality')}
        {problemLine}
      </div>
    ),
  };

  /* ---- the reference sheet */
  const views = run && run.entries.length ? run.entries : (character?.sheet ?? []).map((v) => ({ view: v.view, label: v.label, core: v.core, status: 'done' as const, progress: 100, attempt: 1, error: null, position: 0, etaSeconds: null, identity: v.identity ?? null }));
  const planned = 5 + (extras ? 2 + Math.min(2, Math.max(0, draft.outfits.filter(Boolean).length - 1)) : 0);
  const complete = Boolean(character) && sheetComplete(character!);
  const doneCount = views.filter((v) => v.status === 'done').length;
  const line = (() => {
    if (!run || run.status === 'idle') return null;
    if (run.status === 'running') {
      if (run.checking) return 'Checking that every view is the same person…';
      const next = run.entries.find((e) => e.status === 'making');
      const wait = next?.position ? `${next.position === 1 ? 'Next' : `${next.position}th`} in line · ` : '';
      return `${wait}${doneCount} of ${run.entries.length} done · ready in ${about(run.etaSeconds)}`;
    }
    if (run.status === 'stopped') return 'Stopped. Make the rest, or save what is there.';
    if (run.status === 'error') return run.message || 'The sheet could not be finished.';
    return null;
  })();

  const sheetStep: DeckStep = {
    id: 'sheet',
    name: STEP_NAME.sheet,
    title: 'Their reference sheet',
    dek: 'The same person seen from the front, the side, the back and up close, so they look the same every time.',
    body: (
      <div className="chr-sheet" data-assist-target>
        {!machineOn && <p className="ai-muted chr-note">Turn on the AI machine to make the sheet. It is made there.</p>}
        {stale && (
          <p className="chr-problem" role="status">
            You changed how they look, so the old pictures no longer fit. Make the sheet again.
          </p>
        )}
        {views.length === 0 && !running && (
          <div className="chr-prep">
            <p className="chr-note">
              {extras ? 'The front, three-quarter, side, back and a face close-up, then smiling, serious and your other outfits.' : 'The front, three-quarter, side, back and a face close-up.'} About {planned} {planned === 1 ? 'minute' : 'minutes'} on your AI machine.
            </p>
            <label className="chr-check">
              <input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} />
              <span>Also make smiling, serious and other outfits (a few minutes longer)</span>
            </label>
          </div>
        )}
        {views.length > 0 && (
          <ul className="chr-tiles" aria-label="Reference sheet">
            {views.map((e) => {
              const pic = character?.sheet.find((v) => v.view === e.view);
              const again = e.status === 'making' && Boolean(pic);
              return (
                <li key={e.view} className="chr-tile" data-status={e.status} data-view={e.view}>
                  <div className="chr-tile-art">
                    {pic ? <img src={pic.url} alt={`${e.label} view`} loading="lazy" /> : <span className="chr-tile-wait" aria-hidden />}
                    {(e.status === 'making' || e.status === 'todo') && (
                      <span className="chr-tile-state" role="status">
                        {e.status === 'todo' ? 'Waiting' : e.position ? `${e.position === 1 ? 'Next' : `${e.position}th`} in line` : `${again ? 'Again' : 'Making'} · ${Math.max(1, Math.round(e.progress))}%`}
                      </span>
                    )}
                    {e.status === 'error' && !pic && (
                      <span className="chr-tile-state" data-bad role="status" title={e.error ?? ''}>
                        Did not work
                      </span>
                    )}
                    {e.status === 'stopped' && !pic && <span className="chr-tile-state">Stopped</span>}
                  </div>
                  <div className="chr-tile-foot">
                    <span className="chr-tile-label">{e.label}</span>
                    {e.identity?.checked && (
                      <span className="chr-tile-id" data-low={e.identity.score < 60 || undefined} title={`Same-person check: ${e.identity.score} of 100`}>
                        {e.identity.score < 60 ? 'Check this' : 'Matches'}
                      </span>
                    )}
                    {!running && pic && machineOn && (
                      <button type="button" className="chr-redo" aria-label={`Make the ${e.label} view again`} onClick={() => (e.view === 'front' ? setConfirmFront(true) : void redoView(e.view))}>
                        <Icon name="refresh" size={16} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {line && (
          <p className="ai-muted chr-line" role="status" data-bad={run?.status === 'error' || undefined}>
            {line}
          </p>
        )}
        {problemLine}
        {failure && (
          <p className="chr-problem" role="alert">
            {failure}
          </p>
        )}
        <div className="chr-acts">
          {running ? (
            <button type="button" className="btn" onClick={() => void stopSheet()}>
              <Icon name="stop" size={16} /> Stop
            </button>
          ) : !complete && !stale ? (
            <button type="button" className="btn primary" disabled={busy || !machineOn || Boolean(missing) || Boolean(problem)} onClick={() => void startSheet(false)}>
              <Icon name="sparkle" size={16} /> {views.length ? 'Make the rest' : busy ? 'Starting…' : 'Make the reference sheet'}
            </button>
          ) : null}
          {stale && !running && (
            <button type="button" className="btn primary" disabled={busy || !machineOn} onClick={() => void startSheet(true)}>
              <Icon name="refresh" size={16} /> Make the sheet again
            </button>
          )}
          {canAccept && (
            <button type="button" className="btn primary" onClick={() => go('save')}>
              <Icon name="check" size={16} /> Looks good
            </button>
          )}
          {missing && views.length === 0 && <span className="ai-muted chr-note">{missing}</span>}
        </div>
      </div>
    ),
  };

  const saveStep: DeckStep = {
    id: 'save',
    name: STEP_NAME.save,
    title: 'Save your character',
    dek: 'They are kept on your AI machine and in cloud storage, and show up in Make as soon as they are saved.',
    body: (
      <div className="chr-save" data-assist-target>
        <div className="chr-save-card">
          {character && thumbOf(character) ? <img src={thumbOf(character)!} alt={`${draft.name || 'Character'}, face`} /> : <span className="chr-save-blank" aria-hidden />}
          <div>
            <p className="chr-save-name">{draft.name || 'No name yet'}</p>
            <p className="ai-muted">
              Made-up adult · {draft.age || '?'} · {STYLES.find((s) => s.id === draft.style)?.label}
            </p>
            <p className="ai-muted">{character ? `${character.sheet.length} pictures on the sheet` : 'No sheet yet'}</p>
          </div>
        </div>
        {!canAccept && character?.status !== 'ready' && <p className="chr-problem">The sheet is not finished yet. Go back and make it first.</p>}
        {failure && (
          <p className="chr-problem" role="alert">
            {failure}
          </p>
        )}
        <div className="chr-acts">
          <button type="button" className="btn primary" disabled={busy || running || !machineOn || (!canAccept && character?.status !== 'ready')} onClick={() => void save()}>
            <Icon name="save" size={16} /> {busy ? 'Saving…' : existing?.status === 'ready' ? 'Save changes' : 'Save character'}
          </button>
        </div>
      </div>
    ),
  };

  const steps = [whoStep, lookStep, faceStep, outfitStep, personalityStep, sheetStep, saveStep];

  return (
    <div className="mk chr-wizard" data-testid="character-wizard">
      <StepDeck steps={steps} current={step} onGo={go} onActivePane={setPane} label="Make a character, step by step" />
      {confirmFront && (
        <ConfirmSheet
          title="Make the front again?"
          message="Every other view is made from the front, so they will all be made again too. It takes a few minutes."
          confirmLabel="Make them all again"
          onConfirm={() => {
            setConfirmFront(false);
            void redoView('front');
          }}
          onCancel={() => setConfirmFront(false)}
        />
      )}
    </div>
  );
}
