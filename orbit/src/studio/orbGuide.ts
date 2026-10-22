/**
 * The orb as the studio's guide: it reacts to what is on screen. It says one short line when a new
 * question arrives (picking up your last answer), glows while the writer is thinking, nudges when you
 * hesitate, and tells you when something is ready. Lines go out through the orb's own caption.
 */
import type { Answers, Flow, StepDef } from './defs';
import { stepsFor } from './engine';

export function orbSay(text: string) {
  if (text.trim()) window.dispatchEvent(new CustomEvent('orb:say', { detail: text.trim() }));
}

/** The orb's glow: 0..1 while it is busy for you, null to let it rest. */
export function orbThink(energy: number | null) {
  window.dispatchEvent(new CustomEvent('orb:energy', { detail: energy }));
}

const plain = (q: string) => q.replace(/\*/g, '');
const lower = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

const NODS = ['Love it', 'Good', 'Nice', 'Perfect', 'Great pick', 'Yes'];

/** What the orb says as a question arrives: a nod to your last answer (the question is already on screen). */
export function lineFor(flow: Flow, answers: Answers, step: StepDef, seed = 0): string {
  const answered = stepsFor(flow, answers).filter((s) => s.id in answers && !s.meta);
  const last = answered[answered.length - 1];
  if (!last) return step.dek ?? plain(step.q);
  const nod = NODS[(seed + answered.length) % NODS.length];
  return `${nod}: ${lower(answers[last.id])}.`;
}

/** After a pause on the same question. */
export function nudgeFor(step: StepDef): string {
  return step.closed ? 'Take your time. Tap the one that fits.' : 'Not sure? Tap “Pick for me”, or tell me in your own words.';
}
