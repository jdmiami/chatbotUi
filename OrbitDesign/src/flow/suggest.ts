/**
 * Suggested choices: the assistant reads what was picked so far and offers the answers you are most
 * likely to want next. The assistant (see ./adapter) answers while it is awake; otherwise, or if it
 * doesn't answer in time, the ready answers stand on their own.
 */
import { assistantAwake, getAssistant, type ChatMessage } from './adapter';
import type { Answers, Choice, Flow, Guide, Step } from './defs';
import { stepsFor, summaryOf } from './engine';

const cache = new Map<string, Choice[]>();

/** Pull a JSON list of {label, hint} out of a reply (assistants wrap it in prose or code fences). */
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

/** The assistant's suggestions first, then the guide's ready answers, without repeats. */
export function mergeChoices(suggested: Choice[], ready: Choice[], max = 6): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const c of [...suggested, ...ready]) {
    const k = c.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** The messages sent to the assistant for one question (exported so an app can test or reuse them). */
export function suggestionMessages(guide: Guide, flow: Flow, step: Step, answers: Answers): ChatMessage[] {
  const so = summaryOf(flow, answers)
    .map((b) => `${b.key}: ${b.value}`)
    .join('\n');
  const q = step.q.replace(/\*/g, '');
  return [
    { role: 'system', content: `You suggest answers for a step-by-step guided flow in ${guide.name}. Reply with only a JSON array.` },
    {
      role: 'user',
      content: `We are working on ${flow.label.toLowerCase()}.\nChosen so far:\n${so || '(nothing yet)'}\n\nNext question: ${q}\nExamples of answers: ${step.choices.map((c) => c.label).join('; ')}\n\nSuggest 4 new answers that fit everything chosen so far, as [{"label": "at most 6 words", "hint": "at most 8 words"}].`,
    },
  ];
}

async function ask(msgs: ChatMessage[], signal: AbortSignal): Promise<string> {
  // Only while the assistant is awake: asking never wakes it (that costs).
  const a = getAssistant();
  if (!a || !a.awake()) return '';
  let text = '';
  await a.chat(msgs, (d) => (text += d), signal, 300);
  return text;
}

/**
 * Whether this step would ask for suggestions at all: not when the step says no, is closed or is
 * custom, and only once at least one answer that is part of the result is in (a meta answer like
 * a length says nothing about it). The shell shows "thinking of more…" on the same rule.
 */
export function wantsSuggestions(flow: Flow, step: Step, answers: Answers): boolean {
  if (step.suggest === false || step.closed || step.custom) return false;
  return stepsFor(flow, answers).some((s) => !s.meta && answers[s.id]);
}

/**
 * The assistant's suggestions for this question: empty when it has nothing to go on, when no
 * assistant is awake (asking never wakes one, and nothing is remembered, so the question is asked
 * once it is awake), or when it fails.
 */
export async function suggestChoices(guide: Guide, flow: Flow, step: Step, answers: Answers, timeoutMs = 9000): Promise<Choice[]> {
  if (!wantsSuggestions(flow, step, answers) || !assistantAwake()) return [];
  const key = `${guide.id}|${flow.id}|${step.id}|${JSON.stringify(answers)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const list = parseChoices(await ask(suggestionMessages(guide, flow, step, answers), ctrl.signal));
    cache.set(key, list);
    return list;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
