/**
 * The walkthrough engine: which question comes next, what the answers add up to, and the job they
 * become. Pure functions, so every studio behaves the same and the rules are easy to test.
 * Copied from Orbit Studios (src/studio/engine.ts); only the job types now come from ./jobs.
 */
import type { MovieDraft, MovieSound, StudioRequest } from './jobs';
import type { Answers, Choice, Flow, MakeKind, Scene, StepDef, StudioDef } from './defs';
import { castOf, describe, openingOf } from './writer';

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

/** "Pick for me": one of the ready answers (or the writer's, when there are some). */
export function pickFor(step: StepDef, offered: Choice[] = step.choices, rand: () => number = Math.random): string {
  const list = offered.length ? offered : step.choices;
  if (!list.length) return SCRIPT_OK;
  return list[Math.floor(rand() * list.length) % list.length].label;
}

/** How an approved script reads in the trail of answers. */
export const SCRIPT_OK = 'Approved';

/** "Finish it for me": answer every question left (the script is taken as drafted). */
export function finishAll(flow: Flow, answers: Answers, rand: () => number = Math.random): Answers {
  let out = { ...answers };
  for (let guard = 0; guard < 40; guard++) {
    const s = nextStep(flow, out);
    if (!s) break;
    out = answer(flow, out, s.id, s.kind === 'script' ? SCRIPT_OK : pickFor(s, s.choices, rand));
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
export function jobOf(studio: StudioDef, kind: Exclude<MakeKind, 'talk'>, answers: Answers, installed: string[] | null = null, script: Scene[] | null = null): Job {
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
  const scenes = script?.length || Number.parseInt(answers.scenes ?? '', 10);
  const length = scenes && (director || script?.length) ? Math.min(30, scenes * 5) : 15;
  const sound: MovieSound = ({ Music: 'music', 'Their voices': 'shots', Quiet: 'quiet' } as Record<string, MovieSound>)[answers.msound] ?? 'auto';
  const cast = castOf(answers);
  const lead = script?.length
    ? cast
        .filter((p) => p.look)
        .map((p) => `${p.name}: ${p.look}`)
        .join('; ')
    : [answers.lead, answers.partner && `with ${answers.partner}`].filter(Boolean).join(', ');
  const idea = briefOf(flow, answers)
    .filter((b) => !['Cut', 'Scenes', 'Sound', 'Storyboard', 'Look', 'Script'].includes(b.key))
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
      // Your script, scene by scene: the studio films it as written instead of writing its own.
      ...(script?.length
        ? {
            opening: openingOf(answers),
            shots: script.map((s) => ({ prompt: describe(s.action, cast), end: describe(s.end, cast), says: s.says })),
          }
        : {}),
    },
  };
}

export interface Pick {
  label: string;
  /** Why, in one short line (shown when you tap the orb). */
  why: string;
}

/**
 * The orb's pick for the question on screen: the answer that fits best with what was chosen so far
 * (its `suits` words found in earlier answers), else the writer's first idea, else the step's own
 * best. It sits on that answer; you still choose.
 */
export function recommend(flow: Flow, answers: Answers, step: StepDef, offered: Choice[] = step.choices, predicted: Choice[] = []): Pick | null {
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
  const fromWriter = predicted.find((p) => offered.some((c) => c.label === p.label));
  if (fromWriter) return { label: fromWriter.label, why: fromWriter.hint ? `The writer’s idea: ${fromWriter.hint.toLowerCase()}.` : 'The writer thinks this fits what you picked.' };
  const own = offered.find((c) => c.label === step.best) ?? offered[0];
  return { label: own.label, why: own.hint ? `${own.hint}.` : 'A strong place to start.' };
}
