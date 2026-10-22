import { LayoutGroup, motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useMotionLevel } from '../motion/MotionProvider';
import { SPRING, transitionFor } from '../motion/springs';
import { useScrollDepth } from '../shell/o5/depth';
import type { Answers, Choice, Flow, StepDef } from './defs';
import { stepsFor } from './engine';
import { Choices } from './Choices';
import { Headline } from './Sheets';
import { SqIcon } from './icons';

/**
 * A walkthrough as one scroll: the answers so far stacked small at the top (blurred as they leave
 * the middle, tap one to go back to it), and the question you're on in the middle. A picked answer
 * flies up into the stack; the next question comes in below it.
 */
export function Walk({
  flow,
  answers,
  step,
  n,
  total,
  choices,
  predicting,
  picked,
  onPick,
  onPickForMe,
  onFinishForMe,
  onRevisit,
}: {
  flow: Flow;
  answers: Answers;
  step: StepDef;
  n: number;
  total: number;
  choices: Choice[];
  predicting: boolean;
  picked: string | null;
  onPick: (label: string) => void;
  onPickForMe: () => void;
  onFinishForMe: () => void;
  onRevisit: (stepId: string) => void;
}) {
  const level = useMotionLevel();
  const full = level === 'full';
  const scroller = useRef<HTMLDivElement>(null);
  const now = useRef<HTMLElement>(null);
  const [own, setOwn] = useState('');
  useScrollDepth(scroller, true, 'center');
  const done = stepsFor(flow, answers).filter((s) => s.id in answers);

  // The question you're on comes to the middle, with the last answers peeking above it.
  useLayoutEffect(() => {
    setOwn('');
    const el = now.current;
    const box = scroller.current;
    if (!el || !box) return;
    box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.2), behavior: full ? 'smooth' : 'auto' });
  }, [step.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = picked !== null;
  return (
    <div className="st-scroll" ref={scroller}>
      <LayoutGroup>
        {done.length > 0 && (
          <ol className="st-trail" aria-label="Your answers so far">
            {done.map((s) => (
              <li key={s.id} data-depth="">
                <button type="button" className="st-trail-row" onClick={() => onRevisit(s.id)} aria-label={`${s.key}: ${answers[s.id]}. Change it`}>
                  <span className="o5-kicker">{s.key}</span>
                  <motion.span layoutId={`ans-${s.id}`} className="st-trail-ans" transition={full ? SPRING.default : transitionFor(level)}>
                    {answers[s.id]}
                  </motion.span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <motion.section
          key={step.id}
          ref={now}
          className="st-now"
          aria-labelledby={`q-${step.id}`}
          initial={full ? { opacity: 0, y: 40, filter: 'blur(12px)' } : { opacity: 0 }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.smooth, delay: done.length ? 0.18 : 0 } : transitionFor(level) }}
        >
          <p className="o5-kicker st-kick">
            <span>{step.kick}</span>
            <span className="st-num">
              {n} of {total}
            </span>
          </p>
          <Headline text={step.q} id={`q-${step.id}`} orb={!busy} />
          {step.dek && <p className="st-dek">{step.dek}</p>}
          <Choices items={choices} picked={picked} onPick={onPick} layoutPrefix={`ans-${step.id}`} delay={done.length ? 0.3 : 0.12} />
          {predicting && !busy && <p className="st-predicting">The writer is thinking of more…</p>}
          {!step.closed && !busy && (
            <motion.form
              className="st-own"
              initial={full ? { opacity: 0, y: 16, filter: 'blur(8px)' } : { opacity: 0 }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.smooth, delay: 0.5 } : transitionFor(level) }}
              onSubmit={(e) => {
                e.preventDefault();
                const v = own.trim();
                if (v) onPick(v);
              }}
            >
              <label className="o5-kicker" htmlFor={`own-${step.id}`}>
                Or in your own words
              </label>
              <input id={`own-${step.id}`} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Something else…" autoComplete="off" enterKeyHint="next" />
              <button type="submit" disabled={!own.trim()}>
                Use this
              </button>
            </motion.form>
          )}
          {!busy && (
            <motion.p
              className="st-shortcuts"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: full ? { ...SPRING.smooth, delay: 0.6 } : transitionFor(level) }}
            >
              <button type="button" onClick={onPickForMe}>
                <SqIcon name="shuffle" /> Pick for me
              </button>
              <button type="button" onClick={onFinishForMe}>
                <SqIcon name="forward" /> Finish it for me
              </button>
            </motion.p>
          )}
        </motion.section>
      </LayoutGroup>
    </div>
  );
}
