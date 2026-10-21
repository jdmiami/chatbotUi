import { forwardRef, useState } from 'react';
import type { Choice, StepDef, StudioDef } from './defs';
import type { Character, Project } from './projects';
import { whenOf } from './projects';
import { SqIcon } from './icons';

/**
 * A place kept for the orb: it sits centred on it (see shell/orb/attention.ts). Not aria-hidden,
 * since the orb skips anything hidden; it is an empty span, so there is nothing to read.
 */
export function OrbSpot({ size = 52, className = 'st-orb-spot' }: { size?: number; className?: string }) {
  return <span className={className} data-orb-spot="" data-orb-size={size} role="presentation" />;
}

/** "Where are *we?*": words between asterisks are set in italics, the magazine way. The orb waits beside it. */
export function Headline({ text, id, orb = true }: { text: string; id?: string; orb?: boolean }) {
  const parts = text.split('*');
  return (
    <div className="st-qwrap">
      <h2 className="st-q" id={id}>
        {parts.map((p, i) => (i % 2 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}
      </h2>
      {orb && <OrbSpot />}
    </div>
  );
}

const LETTERS = 'ABCDEFGHIJ';

/** One question: the ready and predicted answers, your own words, and the shortcuts. */
export const Question = forwardRef<
  HTMLElement,
  {
    step: StepDef;
    n: number;
    total: number;
    choices: Choice[];
    predicting: boolean;
    picked: string | null;
    onPick: (label: string) => void;
    onPickForMe?: () => void;
    onFinishForMe?: () => void;
  }
>(function Question({ step, n, total, choices, predicting, picked, onPick, onPickForMe, onFinishForMe }, ref) {
  const [own, setOwn] = useState('');
  const busy = picked !== null;
  return (
    <article className="st-sheet" ref={ref} aria-labelledby={`q-${step.id}`}>
      <p className="st-kick">
        <span>{step.kick}</span>
        <span className="st-num">
          {String(n).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </p>
      {/* The orb hovers beside the question until an answer is picked, then flies to the answer. */}
      <Headline text={step.q} id={`q-${step.id}`} orb={picked === null} />
      {step.dek && <p className="st-dek">{step.dek}</p>}
      <ol className="st-choices" aria-label="Answers" aria-busy={predicting || undefined}>
        {choices.map((c, i) => (
          <li key={c.label}>
            <button
              type="button"
              className="st-choice"
              aria-pressed={picked === c.label}
              disabled={busy}
              onClick={() => onPick(c.label)}
            >
              <span className="st-lt" aria-hidden>
                {LETTERS[i]}
              </span>
              <span className="st-lb">{c.label}</span>
              {c.hint && <span className="st-ht">{c.hint}</span>}
              {/* Picked: the orb flies onto the answer and taps it. */}
              {picked === c.label && <OrbSpot size={40} className="st-choice-spot" />}
            </button>
          </li>
        ))}
        {predicting && (
          <li className="st-predicting" aria-live="polite">
            <span className="st-ht">The writer is thinking of more…</span>
          </li>
        )}
      </ol>
      {!step.closed && (
        <form
          className="st-own"
          onSubmit={(e) => {
            e.preventDefault();
            const v = own.trim();
            if (v && !busy) onPick(v);
          }}
        >
          <label htmlFor={`own-${step.id}`}>Or in your own words</label>
          <input id={`own-${step.id}`} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Something else…" autoComplete="off" enterKeyHint="next" disabled={busy} />
          <button type="submit" disabled={!own.trim() || busy}>
            Use this
          </button>
        </form>
      )}
      {(onPickForMe || onFinishForMe) && (
        <p className="st-shortcuts">
          {onPickForMe && (
            <button type="button" onClick={onPickForMe} disabled={busy}>
              <SqIcon name="shuffle" /> Pick for me
            </button>
          )}
          {onFinishForMe && (
            <button type="button" onClick={onFinishForMe} disabled={busy}>
              <SqIcon name="forward" /> Finish it for me
            </button>
          )}
        </p>
      )}
    </article>
  );
});

const KIND_NAME: Record<Project['kind'], string> = { image: 'Picture', video: 'Video', movie: 'Movie' };
const STATUS: Record<Project['status'], string> = { draft: 'Draft', making: 'Being made', done: 'Finished', error: 'Stopped' };

/** Home: the member's projects, as a magazine contents page. */
export const Home = forwardRef<HTMLElement, { studio: StudioDef; projects: Project[]; onOpen: (p: Project) => void; onNew: () => void; onTalk: () => void }>(function Home(
  { studio, projects, onOpen, onNew, onTalk },
  ref,
) {
  return (
    <article className="st-sheet st-home" ref={ref} aria-labelledby="st-home-t">
      <p className="st-kick">
        <span>Contents</span>
        <span className="st-num">{projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : 'New here'}</span>
      </p>
      <Headline text={projects.length ? 'Your *projects*' : `Welcome to ${studio.mark[0]} *${studio.mark[1]}*`} id="st-home-t" />
      <p className="st-dek">{projects.length ? 'Pick one up where you left it, or start something new.' : 'Everything you make lives here, sorted by project. Start your first one.'}</p>
      <ol className="st-contents">
        <li>
          <button type="button" className="st-row st-row-new" onClick={onNew}>
            <SqIcon name="plus" framed />
            <span className="st-row-t">Start something new</span>
            <span className="st-row-m">Picture, video or movie</span>
          </button>
        </li>
        <li>
          <button type="button" className="st-row" onClick={onTalk}>
            <SqIcon name="talk" framed />
            <span className="st-row-t">Talk with the writer</span>
            <span className="st-row-m">Plan it in conversation</span>
          </button>
        </li>
        {projects.map((p, i) => (
          <li key={p.id}>
            <button type="button" className="st-row" onClick={() => onOpen(p)}>
              <span className="st-row-n" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="st-row-t">{p.title || `Untitled ${KIND_NAME[p.kind].toLowerCase()}`}</span>
              <span className="st-row-m">
                {KIND_NAME[p.kind]} · {STATUS[p.status]} · {whenOf(p.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </article>
  );
});

/** 18+: the first page of an adult studio. */
export const Gate = forwardRef<HTMLElement, { studio: StudioDef; onYes: () => void; onNo: () => void }>(function Gate({ studio, onYes, onNo }, ref) {
  return (
    <article className="st-sheet" ref={ref} aria-labelledby="st-gate-t">
      <p className="st-kick">
        <span>Before we begin</span>
        <span className="st-num">18+</span>
      </p>
      <Headline text="Adults *only.*" id="st-gate-t" />
      <p className="st-dek">{studio.name} makes adult pictures, videos and films. Confirm you are 18 or older, and that you agree to the house rules.</p>
      <ul className="st-rules">
        {studio.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <ol className="st-choices st-choices-2">
        <li>
          <button type="button" className="st-choice" onClick={onYes}>
            <span className="st-lt" aria-hidden>
              A
            </span>
            <span className="st-lb">I am 18 or older</span>
            <span className="st-ht">And I agree to the rules</span>
          </button>
        </li>
        <li>
          <button type="button" className="st-choice" onClick={onNo}>
            <span className="st-lt" aria-hidden>
              B
            </span>
            <span className="st-lb">Take me back</span>
            <span className="st-ht">Leave {studio.name}</span>
          </button>
        </li>
      </ol>
    </article>
  );
});

export function CharacterList({ list }: { list: Character[] }) {
  if (!list.length) return <p className="st-empty">Characters you describe in a walkthrough are kept here, to cast again.</p>;
  return (
    <ol className="st-contents">
      {list.map((c) => (
        <li key={c.id}>
          <div className="st-row st-row-static">
            <SqIcon name="character" framed />
            <span className="st-row-t">{c.name}</span>
            <span className="st-row-m">{c.description}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
