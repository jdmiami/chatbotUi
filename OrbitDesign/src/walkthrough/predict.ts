/**
 * Predicted choices: the studio's writer reads what was picked so far and offers the answers you
 * are most likely to want next. The writer (see ./adapter) answers while it is awake; otherwise,
 * or if it doesn't answer in time, the ready answers stand on their own.
 * Copied from Orbit Studios (src/studio/predict.ts); the only change is where the writer comes from.
 */
import { getWriter, type ChatMessage } from './adapter';
import type { Answers, Choice, Flow, StepDef, StudioDef } from './defs';
import { briefOf } from './engine';

const cache = new Map<string, Choice[]>();

/** Pull a JSON list of {label, hint} out of a reply (writers wrap it in prose or code fences). */
export function parseChoices(text: string): Choice[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => (typeof r === 'string' ? { label: r } : (r as { label?: unknown; hint?: unknown })))
      .filter((r): r is { label: string; hint?: unknown } => typeof r?.label === 'string' && r.label.trim().length > 1)
      .map((r) => ({ label: r.label.trim().slice(0, 60), hint: typeof r.hint === 'string' ? r.hint.trim().slice(0, 70) : undefined }))
      .slice(0, 4);
  } catch {
    return [];
  }
}

/** The writer's suggestions first, then the studio's ready answers, without repeats. */
export function mergeChoices(predicted: Choice[], ready: Choice[], max = 6): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const c of [...predicted, ...ready]) {
    const k = c.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** The messages sent to the writer for one question (exported so an app can test or reuse them). */
export function predictionMessages(studio: StudioDef, flow: Flow, step: StepDef, answers: Answers): ChatMessage[] {
  const so = briefOf(flow, answers)
    .map((b) => `${b.key}: ${b.value}`)
    .join('\n');
  const q = step.q.replace(/\*/g, '');
  return [
    { role: 'system', content: `${studio.writer}\nYou suggest answers for a step-by-step creative walkthrough. Reply with only a JSON array.` },
    {
      role: 'user',
      content: `We are making ${flow.label.toLowerCase()}.\nChosen so far:\n${so || '(nothing yet)'}\n\nNext question: ${q}\nExamples of answers: ${step.choices.map((c) => c.label).join('; ')}\n\nSuggest 4 new answers that fit everything chosen so far, as [{"label": "at most 6 words", "hint": "at most 8 words"}].`,
    },
  ];
}

async function ask(msgs: ChatMessage[], signal: AbortSignal): Promise<string> {
  // Only while the writer is awake: asking never wakes it (that costs).
  const w = getWriter();
  if (!w || !w.awake()) return '';
  let text = '';
  await w.chat(msgs, (d) => (text += d), signal, 300);
  return text;
}

/** The writer's suggestions for this question (empty when it has nothing to go on, or fails). */
export async function predictChoices(studio: StudioDef, flow: Flow, step: StepDef, answers: Answers, timeoutMs = 9000): Promise<Choice[]> {
  if (step.predict === false || step.closed) return [];
  const picked = briefOf(flow, answers).filter((b) => b.key !== 'Cut');
  if (!picked.length) return [];
  const key = `${studio.id}|${flow.kind}|${step.id}|${JSON.stringify(answers)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const list = parseChoices(await ask(predictionMessages(studio, flow, step, answers), ctrl.signal));
    cache.set(key, list);
    return list;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
