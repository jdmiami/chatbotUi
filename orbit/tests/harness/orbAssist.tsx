/**
 * Test page for the orb on a walkthrough (built only for the end-to-end tests, ORBIT_HARNESS=1):
 * three steps that register with useOrbAssist the way the Make walkthrough does — a box of several
 * lines, a group of choices, and a one-line box — sliding in from the right as you move on.
 */
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles/tokens.css';
import '../../src/styles/global.css';
import '../../src/styles/motion.css';
import '../../src/styles/glass.css';
import '../../src/styles/o5.css';
import '../../src/styles/orb.css';
import { MotionProvider } from '../../src/motion/MotionProvider';
import { useApplySettings } from '../../src/hooks/useApplySettings';
import { OrbCursor } from '../../src/shell/orb/OrbCursor';
import { WriteHelp } from '../../src/shell/orb/WriteHelp';
import { ideaFor, orbApprove, useOrbAssist, type AssistOption } from '../../src/shell/orb/assist';

const STYLES = [
  { id: 'ink', label: 'Dark brush' },
  { id: 'film', label: 'Film photo' },
  { id: 'paper', label: 'Paper cut' },
  { id: 'neon', label: 'Neon glow' },
];

const css = `
.hx { min-height: 100dvh; background: var(--bg); color: var(--text); overflow: hidden; font-family: var(--font-ui); }
.hx-step { padding: calc(var(--safe-top) + 28px) 16px 24px; max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
:root[data-motion='full'] .hx-step { animation: hx-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
:root[data-motion='lite'] .hx-step { animation: hx-fade 0.18s ease-out both; }
@keyframes hx-in { from { transform: translateX(100%); } }
@keyframes hx-fade { from { opacity: 0; } }
.hx-kicker { margin: 0; font: 600 11px/1 var(--font-ui); letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
.hx-title { margin: 0 0 6px; font-family: var(--font-display); font-weight: 400; font-size: calc(34px * var(--text-scale)); line-height: 1.05; }
.hx-box { width: 100%; box-sizing: border-box; padding: 14px 16px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font: 17px/1.45 var(--font-ui); }
textarea.hx-box { min-height: 150px; resize: none; }
.hx-row { display: flex; gap: 10px; flex-wrap: wrap; }
.hx-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.hx-choice { min-height: 96px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font: 400 20px/1.1 var(--font-display); text-align: left; padding: 14px; }
.hx-choice[aria-checked='true'] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.hx-done { font-family: var(--font-display); font-size: 22px; }
`;

function Harness() {
  useApplySettings();
  const [step, setStep] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<string | null>(null);
  const fills = useRef(0);
  const next = () => setStep((s) => s + 1);
  // Swipe left: the next step.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  return (
    <main
      className="hx"
      onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (s && s.x - e.clientX > 80 && Math.abs(e.clientY - s.y) < 60 && step < 3) next();
      }}
    >
      <style>{css}</style>
      {step === 0 && (
        <TextStep
          key="describe"
          id="test:describe"
          kicker="Step 1 of 3"
          title="Describe it"
          context={`Step 1 of 3, Describe it: a picture with the Photo maker, style ${STYLES.find((s) => s.id === style)?.label ?? 'not picked yet'}`}
          value={prompt}
          setValue={setPrompt}
          multi
          onNext={next}
          onFill={async () => setPrompt(await ideaFor('Step 1 of 3, Describe it: a picture with the Photo maker', prompt, fills.current++))}
        />
      )}
      {step === 1 && (
        <ChoiceStep
          selected={style}
          context={`Step 2 of 3, Style: the look for the picture "${prompt || 'a picture'}"`}
          onPick={async (id, el) => {
            setStyle(id);
            await orbApprove(el);
            next();
          }}
        />
      )}
      {step === 2 && (
        <TextStep
          key="name"
          id="test:name"
          kicker="Step 3 of 3"
          title="Name it"
          context={`Step 3 of 3, Name it: a short title for the picture "${prompt}"`}
          value={title}
          setValue={setTitle}
          onNext={next}
        />
      )}
      {step === 3 && (
        <section className="hx-step" aria-label="Done">
          <p className="hx-kicker">All set</p>
          <h1 className="hx-title">Check &amp; make</h1>
          <p className="hx-done" data-testid="summary">
            {prompt || '(no words)'} · {title || '(no name)'} · {STYLES.find((s) => s.id === style)?.label ?? '(no style)'}
          </p>
          <div className="hx-row">
            <button type="button" className="btn" onClick={() => setStep(0)}>
              Start again
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function TextStep(props: {
  id: string;
  kicker: string;
  title: string;
  context: string;
  value: string;
  setValue: (v: string) => void;
  multi?: boolean;
  onNext: () => void;
  onFill?: () => void;
}) {
  const [box, setBox] = useState<HTMLTextAreaElement | HTMLInputElement | null>(null);
  useOrbAssist({ id: props.id, context: props.context, target: box, kind: 'text', value: props.value, setValue: props.setValue });
  return (
    <section className="hx-step" aria-label={props.title}>
      <p className="hx-kicker">{props.kicker}</p>
      <h1 className="hx-title">{props.title}</h1>
      {props.multi ? (
        <textarea ref={setBox} className="hx-box" aria-label={props.title} placeholder="What should the picture show?" value={props.value} onChange={(e) => props.setValue(e.target.value)} />
      ) : (
        <input ref={setBox} className="hx-box" aria-label={props.title} placeholder="A short name" value={props.value} onChange={(e) => props.setValue(e.target.value)} />
      )}
      <div className="hx-row">
        {props.onFill && (
          <button type="button" className="btn" onClick={props.onFill}>
            Fill for me
          </button>
        )}
        <button type="button" className="btn primary" onClick={props.onNext}>
          Next
        </button>
      </div>
    </section>
  );
}

function ChoiceStep({ selected, context, onPick }: { selected: string | null; context: string; onPick: (id: string, el: HTMLElement | null) => void }) {
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLButtonElement>());
  const options: AssistOption[] = STYLES.map((s) => ({ id: s.id, label: s.label, el: els.current.get(s.id) ?? null }));
  useOrbAssist({ id: 'test:style', context, target: group, kind: 'choice', options, selected, choose: (id) => onPick(id, els.current.get(id) ?? null) });
  return (
    <section className="hx-step" aria-label="Style">
      <p className="hx-kicker">Step 2 of 3</p>
      <h1 className="hx-title">Style</h1>
      <div ref={setGroup} className="hx-choices" role="radiogroup" aria-label="Styles">
        {STYLES.map((s) => (
          <button
            key={s.id}
            ref={(el) => {
              if (el) els.current.set(s.id, el);
            }}
            type="button"
            role="radio"
            aria-checked={selected === s.id}
            className="hx-choice"
            onClick={(e) => onPick(s.id, e.currentTarget)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <Harness />
      <OrbCursor />
      <WriteHelp />
    </MotionProvider>
  </StrictMode>,
);
