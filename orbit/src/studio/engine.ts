/**
 * The walkthrough engine: which question comes next, what the answers add up to, and the job they
 * become. Pure functions, so every studio behaves the same and the rules are easy to test.
 */
import type { MovieDraft, MovieSound, StudioRequest } from '../services/ai/LocalAi';
import type { Answers, Choice, Flow, MakeKind, StepDef, StudioDef } from './defs';

/** The questions this run will ask, given the answers so far (some only appear for some answers). */
export function stepsFor(flow: Flow, answers: Answers): StepDef[] {
  return flow.steps.filter((s) => !s.when || s.when(answers));
}

/** The first question not answered yet, or null when the brief is complete. */
export function nextStep(flow: Flow, answers: Answers): StepDef | null {
  return stepsFor(flow, answers).find((s) => !(s.id in answers)) ?? null;
}

/** Where the walkthrough is: n of total (1-based), for the running head. */
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

/** "Pick for me": one of the ready answers (or the AI's, when there are some). */
export function pickFor(step: StepDef, offered: Choice[] = step.choices, rand: () => number = Math.random): string {
  const list = offered.length ? offered : step.choices;
  return list[Math.floor(rand() * list.length) % list.length].label;
}

/** "Finish it for me": answer every question left. */
export function finishAll(flow: Flow, answers: Answers, rand: () => number = Math.random): Answers {
  let out = { ...answers };
  for (let guard = 0; guard < 40; guard++) {
    const s = nextStep(flow, out);
    if (!s) break;
    out = answer(flow, out, s.id, pickFor(s, s.choices, rand));
  }
  return out;
}

/** What an answer adds to the prompt: the ready answer's words, or yours as you wrote them. */
function wordsOf(step: StepDef, value: string): string {
  const c = step.choices.find((x) => x.label === value);
  return c ? (c.adds ?? c.label.toLowerCase()) : value;
}

/** The prompt the answers add up to (meta answers like length and shape aren't words). */
export function promptOf(studio: StudioDef, flow: Flow, answers: Answers): string {
  const parts = stepsFor(flow, answers)
    .filter((s) => !s.meta && answers[s.id])
    .map((s) => wordsOf(s, answers[s.id]));
  return [...parts, studio.tail].join(', ');
}

/** The brief: every answer under its name, in order. */
export function briefOf(flow: Flow, answers: Answers): { key: string; value: string }[] {
  return stepsFor(flow, answers)
    .filter((s) => answers[s.id])
    .map((s) => ({ key: s.key, value: answers[s.id] }));
}

const SHAPES: Record<string, string> = { Portrait: 'portrait', Square: 'square', Landscape: 'landscape' };

/** The first maker of the studio's list that the machine has, else the studio's first choice. */
export function makerFor(list: string[], installed: string[] | null): string {
  if (installed) {
    const have = list.find((m) => installed.includes(m));
    if (have) return have;
  }
  return list[0];
}

export type Job =
  | { kind: 'image' | 'video'; req: StudioRequest }
  | { kind: 'movie'; draft: MovieDraft; review: boolean };

/** The job a finished brief becomes. */
export function jobOf(studio: StudioDef, kind: Exclude<MakeKind, 'talk'>, answers: Answers, installed: string[] | null = null): Job {
  const flow = studio.flows[kind];
  const prompt = promptOf(studio, flow, answers);
  if (kind === 'image') {
    return { kind, req: { kind: 'image', maker: makerFor(studio.makers.image, installed), prompt, size: SHAPES[answers.shape] ?? 'portrait' } };
  }
  if (kind === 'video') {
    const seconds = Number.parseInt(answers.length ?? '5', 10) || 5;
    return { kind, req: { kind: 'video', maker: makerFor(studio.makers.video, installed), prompt, seconds, size: SHAPES[answers.vshape] ?? 'landscape' } };
  }
  const director = answers.cut === "Director's cut";
  const scenes = Number.parseInt(answers.scenes ?? '', 10);
  const length = director && scenes ? Math.min(30, scenes * 5) : 15;
  const sound: MovieSound = ({ Music: 'music', 'Their voices': 'shots', Quiet: 'quiet' } as Record<string, MovieSound>)[answers.msound] ?? 'auto';
  const lead = [answers.lead, answers.partner && `with ${answers.partner}`].filter(Boolean).join(', ');
  const idea = briefOf(flow, answers)
    .filter((b) => !['Cut', 'Scenes', 'Sound', 'Storyboard', 'Look'].includes(b.key))
    .map((b) => `${b.key}: ${b.value}`)
    .join('. ');
  const look = [wordsOf(flow.steps.find((s) => s.id === 'finish')!, answers.finish ?? ''), studio.tail].filter(Boolean).join(', ');
  const review = director && answers.review !== 'No, make it all';
  return {
    kind: 'movie',
    review,
    draft: {
      title: answers.premise ? answers.premise.slice(0, 60) : `${studio.name} film`,
      idea,
      look,
      maker: studio.makers.movie,
      size: 'landscape',
      length,
      sound,
      reviewStoryboard: review,
      lead: lead ? { mode: 'ai', description: lead } : { mode: 'auto' },
    },
  };
}
