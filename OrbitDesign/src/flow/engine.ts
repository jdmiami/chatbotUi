/**
 * The flow engine: which question comes next, what the answers add up to, and which answer the orb
 * would pick. Pure functions, so every guide behaves the same and the rules are easy to test.
 */
import type { Answers, Choice, Flow, Step } from './defs';

/** The questions this run will ask, given the answers so far (some only appear for some answers). */
export function stepsFor(flow: Flow, answers: Answers): Step[] {
  return flow.steps.filter((s) => !s.when || s.when(answers));
}

/** The first question not answered yet, or null when the flow is complete. */
export function nextStep(flow: Flow, answers: Answers): Step | null {
  return stepsFor(flow, answers).find((s) => !(s.id in answers)) ?? null;
}

/** Where the flow is: n of total (1-based), for the running head. */
export function progressOf(flow: Flow, answers: Answers): { n: number; total: number } {
  const steps = stepsFor(flow, answers);
  const done = steps.filter((s) => s.id in answers).length;
  return { n: Math.min(done + 1, steps.length), total: steps.length };
}

/** Answer a question. Answers to questions that no longer apply are dropped. */
export function answer(flow: Flow, answers: Answers, stepId: string, value: string): Answers {
  const next = { ...answers, [stepId]: value };
  const live = new Set(stepsFor(flow, next).map((s) => s.id));
  return Object.fromEntries(Object.entries(next).filter(([k]) => live.has(k)));
}

/** Go back one question: forget the last answer. */
export function back(flow: Flow, answers: Answers): Answers {
  const answered = stepsFor(flow, answers).filter((s) => s.id in answers);
  const last = answered[answered.length - 1];
  if (!last) return answers;
  const { [last.id]: _drop, ...rest } = answers;
  return rest;
}

/** How a custom step reads in the trail when it was finished for you (or skipped). */
export const CUSTOM_DONE = 'Done';

/** "Pick for me": one of the ready answers (or the suggested ones, when there are some). */
export function pickFor(step: Step, offered: Choice[] = step.choices, rand: () => number = Math.random): string {
  const list = offered.length ? offered : step.choices;
  if (!list.length) return CUSTOM_DONE;
  return list[Math.floor(rand() * list.length) % list.length].label;
}

/** "Finish it for me": answer every question left (a custom step is taken as done). */
export function finishAll(flow: Flow, answers: Answers, rand: () => number = Math.random): Answers {
  let out = { ...answers };
  for (let guard = 0; guard < 40; guard++) {
    const s = nextStep(flow, out);
    if (!s) break;
    out = answer(flow, out, s.id, s.custom ? CUSTOM_DONE : pickFor(s, s.choices, rand));
  }
  return out;
}

/** What an answer contributes to the result: the ready answer's value, or your words as you wrote them. */
export function valueOf(step: Step, value: string): string {
  const c = step.choices.find((x) => x.label === value);
  return c ? (c.value ?? c.label.toLowerCase()) : value;
}

/** The summary: every answer under its name, in order. */
export function summaryOf(flow: Flow, answers: Answers): { key: string; value: string }[] {
  return stepsFor(flow, answers)
    .filter((s) => answers[s.id])
    .map((s) => ({ key: s.key, value: answers[s.id] }));
}

/** The result the answers add up to, as one line: the values of every non-meta answer, joined with ', '. */
export function resultOf(flow: Flow, answers: Answers): string {
  return stepsFor(flow, answers)
    .filter((s) => !s.meta && answers[s.id])
    .map((s) => valueOf(s, answers[s.id]))
    .join(', ');
}

export interface Pick {
  label: string;
  /** Why, in one short line (shown when you tap the orb). */
  why: string;
}

/**
 * The orb's pick for the question on screen: the answer that fits best with what was chosen so far
 * (its `suits` words found in earlier answers; ties go to the first), else the first of the
 * assistant's suggestions that is on offer, else the step's own `best`, else the first answer.
 * It sits on that answer; you still choose.
 */
export function recommend(flow: Flow, answers: Answers, step: Step, offered: Choice[] = step.choices, suggested: Choice[] = []): Pick | null {
  if (!offered.length) return null;
  const earlier = stepsFor(flow, answers).filter((s) => s.id !== step.id && answers[s.id]);
  const said = earlier.map((s) => ({ key: s.key, text: answers[s.id].toLowerCase() }));
  let best: { c: Choice; score: number; word: string; key: string } | null = null;
  for (const c of offered) {
    let score = 0;
    let word = '';
    let key = '';
    for (const w of c.suits ?? []) {
      const hit = said.find((x) => x.text.includes(w.toLowerCase()));
      if (hit) {
        score += 1;
        if (!word) [word, key] = [w, hit.key];
      }
    }
    if (score > (best?.score ?? 0)) best = { c, score, word, key };
  }
  if (best) return { label: best.c.label, why: `It fits “${best.word}” in your ${best.key.toLowerCase()}.` };
  const fromAssistant = suggested.find((p) => offered.some((c) => c.label === p.label));
  if (fromAssistant) return { label: fromAssistant.label, why: fromAssistant.hint ? `The assistant’s idea: ${fromAssistant.hint.toLowerCase()}.` : 'The assistant thinks this fits what you picked.' };
  const own = offered.find((c) => c.label === step.best) ?? offered[0];
  return { label: own.label, why: own.hint ? `${own.hint}.` : 'A strong place to start.' };
}
