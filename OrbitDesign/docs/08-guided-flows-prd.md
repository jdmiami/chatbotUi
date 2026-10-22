# 08 · Guided flows: functional PRD

A guided flow asks one question at a time, each with a few ready answers and a box for your own words, until the answers are complete; the app decides what the finished answers become (a trip, a recipe, a form, a plan). This document specifies the engine so it can be re-implemented anywhere: the data model, every rule, the assistant contract (the one place a language model may be plugged in), suggestions, custom steps, saved runs, the orb hooks, a complete worked example (the Compass guide, copied as tables), acceptance criteria with tests, and a checklist for writing a guide of your own. The code in `src/flow/` is the reference implementation.

## Contents

1. [Purpose and principles](#1-purpose-and-principles)
2. [Data model](#2-data-model)
3. [Engine rules](#3-engine-rules)
4. [Suggestions](#4-suggestions)
5. [Custom steps](#5-custom-steps)
6. [Runs](#6-runs)
7. [The orb hooks](#7-the-orb-hooks)
8. [The worked example: Compass](#8-the-worked-example-compass)
9. [Acceptance criteria](#9-acceptance-criteria)
10. [Writing a new guide](#10-writing-a-new-guide)

---

## 1. Purpose and principles

A guide is one product built on the engine: a name, colours, house rules and one or more flows. A flow is a list of questions. The engine knows nothing about what the answers are for; it only knows which question comes next, what the answers add up to, and which answer the orb would pick.

| Principle | What it means in the code |
|---|---|
| **One question at a time.** | `nextStep` returns the first unanswered question in flow order; the screen (`Walk`) shows only that one, with the answers so far stacked above it as a trail. |
| **Nobody is stuck.** | Every open question has three ways out besides its ready answers: **Pick for me** (`pickFor`, one of the answers on offer at random), **Finish it for me** (`finishAll`, every remaining question answered at once) and **your own words** (any string is a valid answer; it is stored as typed). A `closed` step has no own-words box because its answers are a fixed set (a yes/no, a size). |
| **Answers that stop applying are dropped.** | A step may carry `when(answers)`. `answer()` re-evaluates every step after each answer and forgets answers to steps that no longer exist, so the summary never shows a question that was never asked. |
| **The orb's pick.** | `recommend` names one answer per question and says why in one line. It sits on that answer; you still choose. The pick follows what was chosen before (`suits` words), then the assistant's suggestion, then the step's own `best`. |
| **Drafts save themselves.** | Every go through a flow is a `Run`. The app calls `saveRun` after every answer, so "Save draft" is only ever a way out, never a chore. Runs are kept per guide on this device; the functions are the contract, an app with accounts can move them elsewhere. |
| **Works with no assistant.** | The package makes no network calls. With `setAssistant(null)` (the default) every screen works: ready answers stand alone, `suggestChoices` returns `[]`, and the orb's pick falls back to `suits` and `best`. An assistant only adds suggestions, and only while it is awake. |
| **Custom steps.** | A step with `custom` is rendered by the app itself (a text box, a date picker, a map) and answered with whatever value the app gives. The engine treats it like any other step; "Finish it for me" marks it `Done`. |

The vocabulary used below:

| Word | Meaning |
|---|---|
| Guide | One product on the engine (`Guide`): name, mark, theme, rules, starters, follow-ups, flows. Each guide is its own site. |
| Flow | One list of questions (`Flow`): the way to one kind of result. |
| Step | One question (`Step`), with ready answers (`Choice[]`) and flags. |
| Answers | `Record<stepId, string>`: the state of a flow. |
| Summary | Every answer under its name, in order (`summaryOf`). |
| Result | The values of the answers as one line (`resultOf`). The app usually makes something richer of them. |
| Run | One go through a flow, saved from its start (`Run`). |
| Assistant | An optional language model behind the adapter (`Assistant`). Never required. |
| The orb | The guide on screen: it sits on the recommended answer and keeps a note until tapped. |

---

## 2. Data model

Reference: `src/flow/defs.ts`. Copied here field by field.

### Choice

One ready answer to a question.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `label` | `string` | — | What is shown, and what is stored as the answer. |
| `hint` | `string?` | — | One line under the label. |
| `value` | `string?` | the label, lower-cased | What the answer contributes to the result. |
| `suits` | `string[]?` | — | Words in the earlier answers that make this the orb's pick ("rain", "friends"…). |

### Step

One question of a flow.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | — | The answer's key in `Answers`. The engine reads no particular id. |
| `kick` | `string` | — | Running head over the question ("Chapter 02 · The season"). |
| `q` | `string` | — | The question, as the orb asks it. `*Words between asterisks*` are set in italics. |
| `dek` | `string?` | — | One line under the question. |
| `key` | `string` | — | Name of the answer on the summary ("Place", "Season"). Also named in the orb's reason ("in your place"). |
| `choices` | `Choice[]` | — | Ready answers. The assistant (if one is set) adds its own suggestions on top once at least one answer that is part of the result is in. Empty on a custom step. |
| `suggest` | `boolean?` | `true` | Ask the assistant for fresh choices that fit what was picked so far. |
| `when` | `((a: Answers) => boolean)?` | always | Shown only when this returns true for the answers so far. |
| `closed` | `boolean?` | `false` | No "own words" box (e.g. a yes/no), and no suggestions. |
| `meta` | `boolean?` | `false` | The answer is about the result (its length, its shape…), not part of it: left out of `resultOf`, and does not count as "something to go on" for suggestions. |
| `best` | `string?` | the first answer | The orb's pick when nothing earlier points elsewhere (a label). |
| `custom` | `string?` | — | A step the app renders itself (a text box, a date picker, a map…) and answers with its own value. The string names what it is, for the app to switch on ("notes"). Such a step has no ready answers; "Finish it for me" answers it with `CUSTOM_DONE`. |

### Flow

One list of questions: the way to one kind of result.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | — | The flow's key in `Guide.flows` and in a `Run`. |
| `label` | `string` | — | A noun phrase with its article ("A trip"), used in sentences and on the contents page. |
| `hint` | `string?` | — | One line under the label on the start page. |
| `steps` | `Step[]` | — | The questions, in the order they are asked. |

### Theme

The colours of a guide: paper, ink and accent for the page; the desk is always dark. All eight are CSS colour strings. The app sets them on `<html>` (`docs/02-tokens.md`, "The guide's theme").

| Field | Type | Meaning | CSS variable the example sets |
|---|---|---|---|
| `paper` | `string` | The page's background. | `--st-paper` |
| `ink` | `string` | The page's text. | `--st-ink` |
| `ink2` | `string` | The page's second text colour (deks, kickers). | `--st-ink2` |
| `accent` | `string` | The page's accent. | `--st-accent` |
| `desk` | `string` | The dark surface behind the page. | `--st-desk` |
| `desk2` | `string` | The desk's second tone. | `--st-desk2` |
| `orbA` | `string` | The orb's light colour. | `--orb-a` (and `--accent`) |
| `orbB` | `string` | The orb's deep colour. | `--orb-b` |

### Guide

A guide: one product built on the engine. Each guide is its own site.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | — | Storage key part; the site's id. |
| `name` | `string` | — | The guide's name ("Compass"); named in the assistant's instructions and the page title. |
| `mark` | `[string, string]` | — | The masthead in two halves; the second is set in italics ("Com", "pass"). |
| `kicker` | `string` | — | The small line over the masthead. |
| `theme` | `Theme` | — | The colours. |
| `rules` | `string[]?` | — | House rules, shown in the options drawer (and on a gate, if the app has one). |
| `starters` | `Choice[]?` | — | Ready ways to open a conversation, so nobody faces an empty box. |
| `followUps` | `Choice[]?` | — | Ready ways to carry a conversation on. |
| `flows` | `Record<string, Flow>` | — | The flows, keyed by their id. |

### Answers

```ts
/** The state of a flow: step id → the label picked, the words typed, or a custom step's value. */
export type Answers = Record<string, string>;
```

### Run

One go through a flow (see §6).

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | — | `'r' + Date.now().toString(36) + 4 random base-36 chars` (from `newRun`). |
| `flowId` | `string` | — | Which flow of the guide. |
| `title` | `string` | `''` | Given by the app (from the answers, usually). |
| `answers` | `Answers` | `{}` | The state. |
| `status` | `'draft' \| 'done'` | `'draft'` | `done` once the app has made something of the answers. |
| `createdAt` | `string` | now | ISO timestamp. |
| `updatedAt` | `string` | now | ISO timestamp; `saveRun` refreshes it. |
| `result` | `unknown?` | — | Whatever the app made of the finished answers. |

---

## 3. Engine rules

Reference: `src/flow/engine.ts`. All functions are pure; `rand` parameters default to `Math.random` and are injectable for tests. The public names are re-exported from `src/flow/index.ts`.

### stepsFor

The questions this run will ask, given the answers so far. A step with no `when` is always in; a step with `when` is in only while `when(answers)` is true. Order is the flow's.

```ts
export function stepsFor(flow: Flow, answers: Answers): Step[] {
  return flow.steps.filter((s) => !s.when || s.when(answers));
}
```

### nextStep

The first step of `stepsFor` whose `id` is not a key in `answers`; `null` when the flow is complete. A key with an empty string still counts as answered (the check is `in`, not truthiness).

```ts
export function nextStep(flow: Flow, answers: Answers): Step | null {
  return stepsFor(flow, answers).find((s) => !(s.id in answers)) ?? null;
}
```

### progressOf

`total` is the number of steps in `stepsFor`; `done` is how many of them have an answer; `n = min(done + 1, total)`, 1-based, for the running head "n of total". On the last question `n` is `total`; after it, still `total`.

```ts
export function progressOf(flow: Flow, answers: Answers): { n: number; total: number } {
  const steps = stepsFor(flow, answers);
  const done = steps.filter((s) => s.id in answers).length;
  return { n: Math.min(done + 1, steps.length), total: steps.length };
}
```

### answer, and the dropping rule

Set `answers[stepId] = value`, then keep only the keys whose step is in `stepsFor(flow, next)`. **Answers to questions that no longer apply are dropped.** Changing an earlier answer that a `when` depends on therefore removes the dependent step's answer in the same call; answering the same step again keeps its place in the map. The value can be a label, your own words, or a custom step's value; the engine does not check it against the choices.

```ts
export function answer(flow: Flow, answers: Answers, stepId: string, value: string): Answers {
  const next = { ...answers, [stepId]: value };
  const live = new Set(stepsFor(flow, next).map((s) => s.id));
  return Object.fromEntries(Object.entries(next).filter(([k]) => live.has(k)));
}
```

### back

Forget the last answer: the last answered step in `stepsFor` order is removed. With nothing answered, `answers` is returned unchanged. (The app's trail revisit is a wider cut, see §5 and §7: tapping an earlier answer drops it and every later one.)

```ts
export function back(flow: Flow, answers: Answers): Answers {
  const answered = stepsFor(flow, answers).filter((s) => s.id in answers);
  const last = answered[answered.length - 1];
  if (!last) return answers;
  const { [last.id]: _drop, ...rest } = answers;
  return rest;
}
```

### CUSTOM_DONE

How a custom step reads in the trail when it was finished for you (or skipped).

```ts
export const CUSTOM_DONE = 'Done';
```

### pickFor

"Pick for me": one of the ready answers, or of the answers on offer when the caller passes them (the app passes the merged list, so a suggestion can be picked). `list = offered.length ? offered : step.choices`; an empty list (a custom step) gives `CUSTOM_DONE`; else `list[floor(rand() · length) % length].label`.

```ts
export function pickFor(step: Step, offered: Choice[] = step.choices, rand: () => number = Math.random): string {
  const list = offered.length ? offered : step.choices;
  if (!list.length) return CUSTOM_DONE;
  return list[Math.floor(rand() * list.length) % list.length].label;
}
```

### finishAll

"Finish it for me": answer every question left. Repeat at most 40 times: `s = nextStep`; stop when `null`; answer it with `CUSTOM_DONE` when `s.custom`, else `pickFor(s, s.choices, rand)`. It uses the step's own ready answers, never suggestions, and never `best` (the pick is random). What was already answered is kept. The guard of 40 bounds a flow whose `when` rules could otherwise loop.

```ts
export function finishAll(flow: Flow, answers: Answers, rand: () => number = Math.random): Answers {
  let out = { ...answers };
  for (let guard = 0; guard < 40; guard++) {
    const s = nextStep(flow, out);
    if (!s) break;
    out = answer(flow, out, s.id, s.custom ? CUSTOM_DONE : pickFor(s, s.choices, rand));
  }
  return out;
}
```

### valueOf

What an answer contributes to the result. If `value` equals a ready answer's label: that choice's `value`, or its label lower-cased. Otherwise (own words, a suggestion, a custom value): `value` as written.

```ts
export function valueOf(step: Step, value: string): string {
  const c = step.choices.find((x) => x.label === value);
  return c ? (c.value ?? c.label.toLowerCase()) : value;
}
```

### summaryOf

The summary: every answer under its name, in flow order. Steps with no answer, or an empty one, are left out. Meta and custom steps are included (the summary is what you said; the result is what it adds up to).

```ts
export function summaryOf(flow: Flow, answers: Answers): { key: string; value: string }[] {
  return stepsFor(flow, answers)
    .filter((s) => answers[s.id])
    .map((s) => ({ key: s.key, value: answers[s.id] }));
}
```

### resultOf

The result the answers add up to, as one line: `valueOf` for every step in `stepsFor` that is not `meta` and has a truthy answer, joined with `', '`. A custom step that is not `meta` contributes its value verbatim (so a skipped one contributes `Done`; mark it `meta` if that is unwanted).

```ts
export function resultOf(flow: Flow, answers: Answers): string {
  return stepsFor(flow, answers)
    .filter((s) => !s.meta && answers[s.id])
    .map((s) => valueOf(s, answers[s.id]))
    .join(', ');
}
```

### recommend

The orb's pick for the question on screen, and why, in one line.

```ts
export interface Pick {
  label: string;
  /** Why, in one short line (shown when you tap the orb). */
  why: string;
}
```

`recommend(flow, answers, step, offered = step.choices, suggested = []) → Pick | null`. The scoring order:

1. If `offered` is empty → `null` (a custom step; the app does not call it for one).
2. `earlier` = the steps in `stepsFor` other than `step` that have a truthy answer; `said = [{ key: step.key, text: answer lower-cased }]` for each.
3. **Suits-word matches.** For each offered choice, `score` = the number of its `suits` words (each lower-cased) found as a substring in any earlier answer's text. The first matching word, and the `key` of the answer it was found in, are remembered for the reason. The choice with the highest score wins; **ties keep the earlier choice** (the comparison is strictly greater); **a score of 0 never wins**. Reason: `It fits “{word}” in your {key lower-cased}.`
4. **An assistant suggestion.** Else the first of `suggested` whose label is also in `offered`. Reason: `The assistant’s idea: {hint lower-cased}.`, or without a hint `The assistant thinks this fits what you picked.`
5. **step.best.** Else the offered choice whose label equals `step.best`…
6. **The first choice.** …or `offered[0]`. Reason for 5 and 6: `{hint}.` (the choice's own hint with a full stop), or `A strong place to start.` when it has none.

Because the match is a substring on lower-cased text, `"two"` matches "The two of us" and `"sun"` would match "Sunday"; choose `suits` words with that in mind (§10). The app passes `offered = mergeChoices(suggested, step.choices)`, so a ready answer cut from the merged list (§4) cannot be picked even if its `suits` words match.

```ts
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
```

---

## 4. Suggestions

Reference: `src/flow/suggest.ts` and `src/flow/adapter.ts`. The assistant reads what was picked so far and offers the answers you are most likely to want next. It answers only while it is awake; otherwise, or if it does not answer in time, the ready answers stand on their own.

### The Assistant adapter contract

The adapter is the one place a guide talks to any language model, filled in by the app owner. The package itself makes no calls.

```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Assistant {
  /**
   * Stream a reply: call `onText` with each piece of text as it arrives, resolve when the reply is
   * complete, reject on failure (an `Error` whose `name` is 'AbortError' when `signal` aborted it).
   * `maxTokens` is a hint for the longest reply wanted.
   */
  chat(messages: ChatMessage[], onText: (d: string) => void, signal?: AbortSignal, maxTokens?: number): Promise<void>;
  /** Whether the assistant can answer right now, without waking anything up (asking must be free). */
  awake(): boolean;
}
```

| Function | Rule |
|---|---|
| `setAssistant(a \| null)` | Plug an assistant in, or `null` to run without one (the default). Module-level; one per page. |
| `getAssistant()` | The assistant, or `null`. |
| `assistantAwake()` | `true` when an assistant is set and says it is awake. The app uses it to decide whether to show "Thinking of more…". |

| Rule | Why |
|---|---|
| `chat` streams pieces of text through `onText`, resolves when done, rejects on failure; an abort rejects with an error named `AbortError`. | Suggestions join the pieces into one reply and treat any rejection as silence. |
| `awake()` must be cheap and must not start anything. | Suggestions ask only when awake, and asking must never wake a sleeping model (that costs). |
| `maxTokens` is a hint: suggestions pass `300`. | Keeps the reply to one short list. |

How an app plugs one in (`src/ai/index.ts`): the orb's brain and the flow's assistant are usually the same model, so `assistantFromBrain(brain)` (`src/ai/bridge.ts`) wraps an `OrbBrain` as an `Assistant`. Its `awake()` reports the last answer of `brain.ready()`, refreshed in the background at most every `everyMs` (default 5000 ms), so it is free to call; its `chat` adds `Keep it under {maxTokens / 4} words.` to the system line when `maxTokens ≤ 400`, because the brain has no max-tokens field.

```ts
//   const brain = { ...httpChatBrain({ url, model, key }), ...webSpeech() };
//   <OrbCursor brain={brain} />                  // the orb thinks with it
//   setAssistant(assistantFromBrain(brain));     // the flow's suggestions and the conversation use it too
```

### wantsSuggestions

Whether this step would ask for suggestions at all: not when the step says no (`suggest === false`), is `closed` or is `custom`; and only once at least one answer that is part of the result is in (a `meta` answer like a length says nothing about it). The screen shows "Thinking of more…" on the same rule, plus the assistant being awake.

```ts
export function wantsSuggestions(flow: Flow, step: Step, answers: Answers): boolean {
  if (step.suggest === false || step.closed || step.custom) return false;
  return stepsFor(flow, answers).some((s) => !s.meta && answers[s.id]);
}
```

### suggestionMessages

The messages sent to the assistant for one question, exported so an app can test or reuse them. The summary lines are `"{key}: {value}"`, one per line, or `(nothing yet)`; the question has its asterisks removed; the examples are the step's own labels joined with `; `.

```ts
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
```

### suggestChoices

The assistant's suggestions for this question; empty when it has nothing to go on, when no
assistant is awake, or when it fails.

1. `[]` when `wantsSuggestions` is false, and `[]` when no assistant is awake (`assistantAwake()`),
   before the cache is looked at, so a question skipped while asleep is still asked once it wakes.
2. Cache key: `` `${guide.id}|${flow.id}|${step.id}|${JSON.stringify(answers)}` `` in a module-level `Map`. A hit is returned as is, empty lists included. (`JSON.stringify` keeps insertion order, so the same answers given in a different order are a different key.)
3. An `AbortController` is aborted after `timeoutMs` (default **9000 ms**).
4. Ask: `chat(messages, onText, signal, 300)`, the pieces joined. (`ask` checks awake-ness once more and answers `''` otherwise; asking never wakes an assistant.)
5. `parseChoices` the reply; cache; return.
6. **Any failure (a rejection, a timeout) → `[]`**, and nothing is cached. The timer is always cleared.

```ts
async function ask(msgs: ChatMessage[], signal: AbortSignal): Promise<string> {
  // Only while the assistant is awake: asking never wakes it (that costs).
  const a = getAssistant();
  if (!a || !a.awake()) return '';
  let text = '';
  await a.chat(msgs, (d) => (text += d), signal, 300);
  return text;
}

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
```

### parseChoices

Pull a JSON list of `{label, hint}` out of a reply (assistants wrap it in prose or code fences). Take the substring from the first `[` to the last `]`; `JSON.parse`; must be an array; a string item becomes `{ label }`; keep items whose `label` is a string of trimmed length > 1; `label` trimmed and cut to **60** characters; `hint` trimmed and cut to **70** (else `undefined`); **at most 4**. Any failure → `[]`.

```ts
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
```

### mergeChoices

The assistant's suggestions first, then the guide's ready answers, without repeats: walk `[...suggested, ...ready]`, skip a label already seen (compared lower-cased), stop at `max` (default **6**). With four suggestions, only the first two ready answers survive; the others are not shown for that question.

```ts
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
```

### How the screen shows "thinking of more"

The app (example/src/App.tsx) asks once per question, keyed on view, step and run:

```tsx
  useEffect(() => {
    setSuggested([]);
    if (!step || !flow || !run) return;
    let on = true;
    setSuggesting(assistantAwake() && wantsSuggestions(flow, step, run.answers));
    void suggestChoices(guide, flow, step, run.answers).then((list) => {
      if (!on) return;
      setSuggested(list);
      setSuggesting(false);
    });
    return () => {
      on = false;
    };
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

While `suggesting`, the orb glows and the question shows a line under its answers:

```tsx
  useEffect(() => {
    orbThink(suggesting ? 0.7 : null);
    return () => orbThink(null);
  }, [suggesting]);
```

```tsx
          {suggesting && !busy && !custom && <p className="st-predicting">Thinking of more…</p>}
```

The answers on offer are `mergeChoices(suggested, step.choices)`; they are passed to `Walk` as `choices` and to `recommend` as `offered`, with `suggested` alongside so the orb can credit the assistant. When the list arrives, the new answers join the ones already on screen (the ready answers are never hidden while waiting).

---

## 5. Custom steps

A step with `custom` set is one the app renders itself: a text box, a date picker, a map, anything that is not a list of answers. The string names what it is, so the app can switch on it; the engine never reads it beyond "is it set".

| Where | Rule |
|---|---|
| `Step.choices` | Empty. `recommend` returns `null` for it (nothing offered); the app does not call `recommend` for a custom step (`!step.custom`). |
| `wantsSuggestions` | `false`: no assistant request, no "Thinking of more…". |
| `Walk` | Takes a `custom?: ReactNode`. When given, it is rendered **in place of** `Choices`; the own-words box, the "Thinking of more…" line and the "Pick for me / Finish it for me" shortcuts are all hidden (`!custom`), and the orb spot leaves the headline (`orb={!busy && !recommended && !custom}`). The kicker, "n of total", question and dek still show. |
| Answering | The app calls `answer(flow, answers, step.id, value)` with its own value, exactly as a pick would. The value is stored as given and shows in the trail and on the summary under the step's `key`. |
| `pickFor` | With no choices offered → `CUSTOM_DONE`. The app's "Pick for me" on a custom step skips it instead (`takeNotes('')`). |
| `finishAll` | Answers it with `CUSTOM_DONE` (`'Done'`), never by picking. |
| `summaryOf` | Shows `{ key, value }` like any other answer: your text, or `Done`. |
| `resultOf` | Includes the value verbatim unless the step is `meta`. |

The example's custom step is `notes` (`custom: 'notes'`, `closed: true`, `suggest: false`, `choices: []`). The app renders its body in `Walk`'s `custom` slot and answers with the trimmed text, or `CUSTOM_DONE` when empty:

```tsx
  // The custom step (notes): the app renders a text box and answers with its value, or goes on without.
  const takeNotes = (text: string) => {
    if (!run || !flow || !step?.custom) return;
    orbHome();
    setNotes('');
    after(run, answer(flow, run.answers, step.id, text.trim() || CUSTOM_DONE));
  };
```

```tsx
        custom={
          step.custom === 'notes' ? (
            <form
              className="st-own"
              onSubmit={(e) => {
                e.preventDefault();
                takeNotes(notes);
              }}
            >
              <label className="o5-kicker" htmlFor="st-notes">
                Your notes
              </label>
              <textarea id="st-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything at all…" />
              <button type="submit">{notes.trim() ? 'Use these' : 'Nothing to add'}</button>
            </form>
          ) : undefined
        }
```

```tsx
  const pickForMe = () => (step?.custom ? takeNotes('') : step && void pick(pickFor(step, offered)));
```

The orb's note on a custom step offers the way past it as a button (§7). A conversation can seed it: `startFlow(flowId, seed)` keeps the seed as the first draft of the notes.

### The hand-off between engine and screen

`Walk` is the one screen of a flow. It takes the engine's outputs and returns the person's intent; it never calls `answer` itself.

| Prop | From | Meaning |
|---|---|---|
| `flow`, `answers` | the run | For the trail: `stepsFor(flow, answers)` filtered to answered steps, each a button `"{key}: {answer}. Change it"` that calls `onRevisit(step.id)`. |
| `step` | `nextStep` | The question in the middle: `kick`, `q` (`*italics*`), `dek`. |
| `n`, `total` | `progressOf` | The running head "n of total". |
| `choices` | `mergeChoices(suggested, step.choices)` | The answers on offer, each with `label` and `hint`. |
| `recommended` | `recommend(...)?.label` | Marked "The orb’s pick" with the orb spot on it; while set, the headline has no orb. |
| `suggesting` | the app's state | Shows "Thinking of more…". |
| `picked` | the app's state | The label just picked: it lifts while the others leave, and every button is disabled until the app clears it. |
| `custom` | the app | The custom step's body, instead of the choices. |
| `onPick(label)` | → `answer` | A ready answer tapped, or own words submitted (trimmed, non-empty). |
| `onPickForMe()` | → `pickFor` | The shuffle shortcut. |
| `onFinishForMe()` | → `finishAll` | The forward shortcut. |
| `onRevisit(stepId)` | → the app's cut | Go back to that question. |

`Choices` renders the list: each answer a button with `data-rec` on the orb's pick, `aria-pressed` on the picked one, and the orb spot on either; once `picked` is set only that answer stays on screen.

The app's revisit keeps the answers that come before the tapped step in `stepsFor` order and drops the rest:

```tsx
  const revisit = (stepId: string) => {
    if (!run || !flow) return;
    const order = stepsFor(flow, run.answers).map((s) => s.id);
    const cut = order.indexOf(stepId);
    keep({ ...run, answers: Object.fromEntries(Object.entries(run.answers).filter(([k]) => order.indexOf(k) < cut)) });
  };
```

And after every answer the app saves and moves on to the summary when nothing is left:

```tsx
  const after = (r: Run, answers: Answers) => {
    const f = guide.flows[r.flowId];
    const saved = keep({ ...r, answers });
    if (!nextStep(f, answers)) setView('summary');
    return saved;
  };
```

---

## 6. Runs

Reference: `src/flow/runs.ts`. Browser `localStorage`, per guide. Missing or broken storage (private mode, quota, blocked) never throws: reads give `[]`, writes are swallowed and the session simply is not remembered.

| Key | Holds | Limit |
|---|---|---|
| `` `orbit:guide:${guideId}:runs` `` | `Run[]`, newest first | 200; older ones fall off on save |

| Function | Rule |
|---|---|
| `newRun(flowId)` | A fresh, empty run: `{ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), flowId, title: '', answers: {}, status: 'draft', createdAt: now, updatedAt: now }`. Not saved yet. |
| `saveRun(guideId, r)` | `updatedAt = now` (ISO); remove any stored run with the same `id`; prepend; cut to **200**; write. Returns the saved copy (with the new `updatedAt`). The **title rule** is the app's: the example sets `title = titleOf(r) || r.title`, where `titleOf` joins the first two answers that are part of the result (not `meta`, not `custom`) with `' · '` ("A harbour town · High summer"). The contents page shows an empty title as `Untitled {flow label without its article}`. |
| `listRuns(guideId)` | Read; sort by `updatedAt` descending (string compare of ISO timestamps). Missing or broken storage → `[]`. |
| `removeRun(guideId, id)` | Filter it out and write. |
| `whenOf(iso, now = Date.now())` | When a run was touched, the way a contents page would say it (table below). |

```ts
export function saveRun(guideId: string, r: Run): Run {
  const now = { ...r, updatedAt: new Date().toISOString() };
  const rest = read(key(guideId)).filter((x) => x.id !== r.id);
  write(key(guideId), [now, ...rest].slice(0, 200));
  return now;
}
```

```ts
export function whenOf(iso: string, now = Date.now()): string {
  const d = (now - Date.parse(iso)) / 86_400_000;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
```

| `d` = days since `iso` | Result |
|---|---|
| `< 1` (including a timestamp in the future) | `Today` |
| `1 ≤ d < 2` | `Yesterday` |
| `2 ≤ d < 7` | `{floor(d)} days ago` ("3 days ago") |
| `≥ 7` | The short local date, e.g. `Sep 14` (locale-dependent) |

The contents page lists each run as `{flow label} · {Draft | Finished} · {whenOf(updatedAt)}`. The app saves on start, after every answer, on revisit, on Back, on "Save draft" and when the result is made; opening a run goes to the walk when it is a draft with a question left, else to the summary.

```tsx
  const keep = useCallback((r: Run) => {
    const saved = saveRun(guide.id, { ...r, title: titleOf(r) || r.title });
    setRun(saved);
    setRuns(listRuns(guide.id));
    return saved;
  }, []);
```

---

## 7. The orb hooks

Reference: `src/flow/orbGuide.ts`. The orb as the guide: it is quiet, sits on the thing a screen wants from you, glows while the app works, and keeps what it would say until you tap it. These are the only ways a flow reaches the orb: window `CustomEvent`s, so the orb (`src/orb`) and the screens never import each other. The orb never talks on its own in a flow.

| Function | Event | `detail` | Contract |
|---|---|---|---|
| `orbNote(text, act?)` | `orb:note` | `{ text, act?: { label, id } }` or `null` | What the orb would tell you here, kept until you tap it. `act` adds a button to its panel; pressing it dispatches `orb:act` with `detail = id`. `null` clears the note. |
| `orbThink(energy)` | `orb:energy` | `number 0..1` or `null` | The glow while it is busy for you; `null` to let it rest. |
| `orbHome()` | `orb:home` | — | Bring the orb back beside what matters (after you dragged or threw it). |
| `onOrbAct(handler)` | listens to `orb:act` | `string` (the id) | Returns the function that stops listening; use it as an effect's cleanup. |

```ts
export function orbNote(text: string | null, act?: { label: string; id: string }) {
  window.dispatchEvent(new CustomEvent('orb:note', { detail: text ? { text, act } : null }));
}
export function orbThink(energy: number | null) {
  window.dispatchEvent(new CustomEvent('orb:energy', { detail: energy }));
}
export function orbHome() {
  window.dispatchEvent(new CustomEvent('orb:home'));
}
export function onOrbAct(handler: (id: string) => void): () => void {
  const on = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener('orb:act', on);
  return () => window.removeEventListener('orb:act', on);
}
```

How the example drives them, line for line (example/src/App.tsx):

**orbNote with act buttons.** On a custom step the note offers the way past it; on any other question it names the orb's pick and offers to take it; on the other views it is a line without a button. The note is cleared when the app unmounts.

```tsx
  // The orb's pick, and the note it keeps until tapped (docs/09-orb.md, "Notes").
  const offered = step ? mergeChoices(suggested, step.choices) : [];
  const rec = step && flow && run && !step.custom ? recommend(flow, run.answers, step, offered, suggested) : null;
  useEffect(() => {
    if (view === 'walk' && step?.custom) return orbNote('Write anything the plan should remember, or go on without.', { label: 'Go on without notes', id: 'skip-notes' });
    if (view === 'walk' && rec) return orbNote(`I’d go with “${rec.label}”. ${rec.why}`, { label: `Go with “${rec.label}”`, id: 'pick' });
    const lines: Partial<Record<View, string>> = {
      start: 'Pick what to plan. Each one is a short walk, one question at a time.',
      talk: 'Pick a way to start, or say your own.',
      contents: runs.length ? 'Pick a draft up, or start something new.' : 'Tap “Start something new” and I’ll walk you through it.',
    };
    orbNote(lines[view] ?? null);
  }, [stepKey, rec?.label]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => orbNote(null), []);
```

On the summary the note changes with the run's state, and offers the save as a button while it is a draft:

```tsx
  // The summary screen's note for the orb.
  useEffect(() => {
    if (view !== 'summary' || !run) return;
    if (saving) orbNote(note ?? 'Putting it together.');
    else if (run.status === 'done') orbNote('Your plan is ready. It is in your drafts too.');
    else orbNote('Everything you picked, in one place. Tap “Save the plan” when it looks right.', { label: 'Save the plan', id: 'save' });
  }, [view, run?.status, saving, note]); // eslint-disable-line react-hooks/exhaustive-deps
```

| State | Note | Act |
|---|---|---|
| custom step | `Write anything the plan should remember, or go on without.` | `Go on without notes` → `skip-notes` |
| any other question | `I’d go with “{label}”. {why}` | `Go with “{label}”` → `pick` |
| start | `Pick what to plan. Each one is a short walk, one question at a time.` | — |
| talk | `Pick a way to start, or say your own.` | — |
| contents | `Pick a draft up, or start something new.` / `Tap “Start something new” and I’ll walk you through it.` | — |
| summary, draft | `Everything you picked, in one place. Tap “Save the plan” when it looks right.` | `Save the plan` → `save` |
| summary, saving | the current progress note, or `Putting it together.` | — |
| summary, done | `Your plan is ready. It is in your drafts too.` | — |

**onOrbAct.** One listener for the page; the handlers are kept in a ref so the listener never goes stale.

```tsx
  // The orb's panel buttons.
  const acts = useRef<Record<string, () => void>>({});
  acts.current = { pick: () => rec && void pick(rec.label), 'skip-notes': () => takeNotes(''), save: () => void save() };
  useEffect(() => onOrbAct((id) => acts.current[id]?.()), []);
```

**orbHome on every step.** Each new question brings a thrown orb home, once at once and again after the question's motion has settled; every pick also calls it.

```tsx
  // Each new question brings a thrown orb home.
  useEffect(() => {
    orbHome();
    const t = setTimeout(orbHome, full ? 650 : 120);
    return () => clearTimeout(t);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

**orbThink while suggesting** (`0.7`; see §4), and `0.55` while the app makes something of the answers:

```tsx
  useEffect(() => {
    orbThink(suggesting ? 0.7 : null);
    return () => orbThink(null);
  }, [suggesting]);
```

**data-orb-context.** What the orb's brain (if any) is told about this screen, set on `<html>` and removed on every change:

```tsx
  // What the orb's brain (if any) would be told about this screen.
  useEffect(() => {
    document.documentElement.dataset.orbContext = `You are the guide inside ${guide.name}, an app that plans a trip or an evening one question at a time. The person is on the ${view} screen${step ? `, at the question "${step.q.replace(/\*/g, '')}"` : ''}.`;
    return () => void delete document.documentElement.dataset.orbContext;
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

---

## 8. The worked example: Compass

Reference: `src/flow/guides/example.ts`, exported as `COMPASS`. A sample guide for planning a trip, or just an evening: two flows, every ready answer with a hint and with `suits` words so the orb's pick visibly follows what was chosen before, one custom step the app renders itself, and one meta step at the end of each flow. Copy it and change the words. Everything below is copied exactly.

### Header

| Field | Value |
|---|---|
| `id` | `compass` |
| `name` | `Compass` |
| `mark` | `['Com', 'pass']` |
| `kicker` | `A sample guide` |
| `theme.paper` | `#f4efe6` |
| `theme.ink` | `#1d2430` |
| `theme.ink2` | `#5b6472` |
| `theme.accent` | `#2a6f8f` |
| `theme.desk` | `#0b1016` |
| `theme.desk2` | `#141c25` |
| `theme.orbA` | `#cfe8f5` |
| `theme.orbB` | `#1f5570` |
| `rules` | `Real places, your own pace` · `Nothing is booked for you; the plan is yours to act on` · `Change any answer, any time` |

Starters:

| Label | Hint |
|---|---|
| Somewhere by the sea | Salt air, slow mornings |
| A big city weekend | Museums, late dinners |
| High and quiet | Mountains, clear air |
| A long road | One car, one horizon |

Follow-ups:

| Label | Hint |
|---|---|
| Take it further | What comes next |
| Give me three options | Different ways it could go |
| Make it cheaper | Same trip, less spent |
| Change the place | Same idea, somewhere new |

### Shared choice lists (flow `trip`)

**PLACE**

| Label | Hint | value | suits |
|---|---|---|---|
| A harbour town | Boats, gulls, fish for dinner | a small harbour town | sea, coast, boat, beach, fish |
| A mountain village | Stone roofs and clear air | a mountain village | snow, hike, walk, cold, alps |
| A big city | Museums, late dinners, a last train | a big city | museum, city, food, night, gallery |
| A desert road | One line to the horizon | a desert road trip | drive, car, sun, heat, alone |
| An old town in the rain | Cobbles, cafés, umbrellas | a rainy old town | rain, autumn, cafe, quiet |

**SEASON**

| Label | Hint | value | suits |
|---|---|---|---|
| Early spring | Few crowds, cool air | in early spring | quiet, walk, old town, village |
| High summer | Long days, warm nights | in high summer | harbour, sea, beach, sun, desert |
| Autumn | Colour and soft light | in autumn | rain, old town, cafe, city |
| Deep winter | Snow, fires, early dark | in deep winter | snow, mountain, cold, village |

**COMPANY**

| Label | Hint | value | suits |
|---|---|---|---|
| Just me | My own pace, my own hours | travelling alone | alone, solo, quiet, road, desert |
| The two of us | One other person | the two of us | together, two, couple, spring |
| A few friends | Three to five of us | a small group of friends | friends, group, city, summer |
| The whole family | All ages, all needs | the whole family | family, kids, children, beach |

**PACE**

| Label | Hint | value | suits |
|---|---|---|---|
| Slow | One thing a day, long lunches | a slow pace | alone, quiet, village, old town, autumn, rain |
| Steady | A plan, with room to wander | a steady pace | two of us, together, spring, family |
| Packed | See everything, sleep later | a packed schedule | city, friends, museum, summer |
| No plan at all | Decide each morning | no fixed plan | road, desert, drive |

**BUDGET**

| Label | Hint | value | suits |
|---|---|---|---|
| Shoestring | Hostels, markets, buses | on a shoestring | friends, road, just me, alone |
| Comfortable | A nice room, a few treats | on a comfortable budget | two of us, family, together, steady |
| Splash out | The good hotel, the long dinner | with money to spend | city, winter, slow |

**SHAPE**

| Label | Hint | value | suits |
|---|---|---|---|
| A day-by-day list | Morning, afternoon, evening | — (`a day-by-day list`) | — |
| A loose map | Places and ideas, no times | — (`a loose map`) | — |
| One page | The essentials only | — (`one page`) | — |

### Flow `trip` — label `A trip`, hint `A week away, planned in a few questions`

| # | id | kick | q | dek | key | choices | flags |
|---|---|---|---|---|---|---|---|
| 1 | where | Chapter 01 · The place | Where *to?* | The place sets the pace of everything after it. | Place | PLACE | — |
| 2 | when | Chapter 02 · The season | When do we *go?* | The season decides the light, the crowds and the coat. | Season | SEASON | — |
| 3 | who | Chapter 03 · The company | Who is *coming?* | — | Company | COMPANY | — |
| 4 | pace | Chapter 04 · The pace | How *fast?* | How many things a day, and how long a lunch. | Pace | PACE | best `Steady` |
| 5 | budget | Chapter 05 · The budget | How much to *spend?* | — | Budget | BUDGET | best `Comfortable` |
| 6 | notes | Chapter 06 · Notes | Anything *else?* | A place you must see, a date to avoid, a friend to visit. Or nothing at all. | Notes | (none) | custom `notes`, closed, suggest false |
| 7 | shape | Last · The plan | What *shape* should the plan take? | — | Shape | SHAPE | closed, suggest false, meta, best `A day-by-day list` |

### Flow `evening` — label `An evening`, hint `Tonight, sorted in three`

| # | id | kick | q | dek | key | choices | flags |
|---|---|---|---|---|---|---|---|
| 1 | mood | Chapter 01 · The mood | What kind of *evening?* | — | Mood | see MOOD | — |
| 2 | where | Chapter 02 · The place | In or *out?* | — | Place | see WHERE | — |
| 3 | hours | Last · The hours | How *long?* | — | Hours | see HOURS | closed, suggest false, meta, best `The evening` |

**MOOD**

| Label | Hint | value | suits |
|---|---|---|---|
| Quiet | A book, a bath, an early night | a quiet evening | rain, alone, tired, slow |
| Out with people | Dinner, a bar, a walk home | an evening out with people | friends, city, together |
| Something new | A class, a show, a place you have never been | trying something new | curious, city, new |
| Make something | Cook, build, draw | an evening making something | home, cook, craft |

**WHERE**

| Label | Hint | value | suits |
|---|---|---|---|
| At home | Nowhere to be | at home | quiet, book, bath, make, cook |
| Close by | Walking distance | somewhere close by | walk, out, people, dinner |
| Across town | Worth the trip | across town | new, show, class |

**HOURS**

| Label | Hint | value | suits |
|---|---|---|---|
| An hour | A small thing, done well | — (`an hour`) | — |
| The evening | Six till late | — (`the evening`) | — |
| All night | No alarm tomorrow | — (`all night`) | — |

### How recommend() chains through the trip

The orb's pick reads the earlier answers' labels (lower-cased) and looks for each candidate's `suits` words in them. The first question has nothing earlier, so its pick is the first answer (`A harbour town`, reason `Boats, gulls, fish for dinner.`). From there, one answer leads to the next:

**Chain one: a harbour town.** Place = `A harbour town` (text `a harbour town`).

| Question | Candidates with a match | Pick | Reason |
|---|---|---|---|
| Season | High summer: `harbour` (1) | **High summer** | `It fits “harbour” in your place.` |
| Company | A few friends: `summer` in the season (1) | **A few friends** | `It fits “summer” in your season.` |
| Pace | Packed: `friends` in the company, `summer` in the season (2) | **Packed** | `It fits “friends” in your company.` (the first matching word in the choice's own `suits` order names the reason) |
| Budget | Shoestring: `friends` (1) | **Shoestring** | `It fits “friends” in your company.` |
| Notes | — (custom; `recommend` is not called) | — | the note offers `Go on without notes` |
| Shape | no `suits` anywhere; no suggestions (closed) | **A day-by-day list** (the step's `best`) | `Morning, afternoon, evening.` |

**Chain two: an old town in the rain.** Place = `An old town in the rain`.

| Question | Candidates with a match | Pick | Reason |
|---|---|---|---|
| Season | Early spring: `old town` (1); Autumn: `rain`, `old town` (2) | **Autumn** | `It fits “rain” in your place.` |
| Company | none scores (no `alone`, `together`, `friends`, `family`… in "an old town in the rain" or "autumn") | **Just me** (no `best` on this step, so the first answer) | `My own pace, my own hours.` |
| Pace | Slow: `old town`, `autumn`, `rain` (3) | **Slow** | `It fits “old town” in your place.` |
| Budget | Shoestring: `just me` (1); Splash out: `slow` (1) | **Shoestring** (a tie keeps the earlier choice) | `It fits “just me” in your company.` |

**Chain three: a desert road.** Place = `A desert road`.

| Question | Candidates with a match | Pick | Reason |
|---|---|---|---|
| Season | High summer: `desert` (1) | **High summer** | `It fits “desert” in your place.` |
| Company | Just me: `road`, `desert` (2); A few friends: `summer` (1) | **Just me** | `It fits “road” in your place.` |
| Pace | Packed: `summer` (1); No plan at all: `road`, `desert` (2). Slow scores 0: its `alone` is not in "just me" | **No plan at all** | `It fits “road” in your place.` |
| Budget | Shoestring: `road`, `just me` (2) | **Shoestring** | `It fits “road” in your place.` |

**The evening flow** chains the same way: Mood `Out with people` → Place **Close by** (`out`, `people`; `It fits “out” in your mood.`); Mood `Quiet` or `Make something` → **At home** (`quiet` / `make`); Mood `Something new` → **Across town** (`new`); Hours has no `suits`, so its pick is its `best`, **The evening**, `Six till late.`

Own words join the chain too: a place typed as "my cousin's farm near the sea" makes High summer the season (`sea`), while "my cousin's farm" alone matches nothing, so the season falls back to its first answer, and the pace to its `best`, Steady.

Two things worth noticing in the example: PLACE's `suits` words can never match in the trip flow, because the place is asked first (they would only ever matter if the step were moved later); and words like `museum` match hints, not labels, so they only fire on own words. See §10.

---

## 9. Acceptance criteria

Each feature's criteria, numbered, then the tests that pin them. The tests are written for vitest against the public API (`src/flow/index.ts`) and the Compass guide; `fixed = () => 0` always picks the first choice. The runs tests stub `localStorage` so they run in a plain node environment. Suggested location: `tests/unit/flow-engine.test.ts`.

### Order and progress

1. The first unanswered step in flow order is asked; `null` when none is left.
2. Progress is `(answered + 1) of total`, and never exceeds `total`.
3. Every step of the trip is asked in the order `where, when, who, pace, budget, notes, shape`.

### Dependent steps and dropping

4. A step with `when` exists only while `when(answers)` holds; `stepsFor` lists exactly the steps that exist.
5. Changing an earlier answer removes the answers of steps that vanished, in the same `answer` call.
6. Answering a step again keeps its position; other answers are untouched.

### Back and revisit

7. `back` removes the last answered step in flow order; with nothing answered it returns the same answers.
8. The trail revisit (app) keeps only the answers before the tapped step.

### Pick for me

9. `pickFor` picks from the offered list; with an empty offered list, from the step's own; with neither, `CUSTOM_DONE`.
10. The pick is uniform over the list given `rand` (index `floor(rand · length)`).

### Finish it for me

11. `finishAll` fills every remaining step, keeps what was answered, and answers a custom step with `Done`.
12. It uses the step's ready answers only (never suggestions, never `best`), and stops at 40 steps.

### Values, summary, result

13. `valueOf` gives a ready answer's `value`, else its label lower-cased, else the words as written.
14. `summaryOf` lists `{ key, value }` for every non-empty answer, in flow order, including meta and custom steps.
15. `resultOf` joins the values of non-meta answers with `', '`; a meta answer never appears.

### The orb's pick

16. A choice whose `suits` word appears in an earlier answer wins; the reason names the first matching word and the answer's `key` lower-cased.
17. More matches beat fewer; ties keep the earlier choice; zero matches never win.
18. With no match, the first assistant suggestion that is on offer wins, credited as `The assistant’s idea: {hint}.` or `The assistant thinks this fits what you picked.`
19. With no suggestion, the step's `best` wins, else the first choice; the reason is the choice's hint with a full stop, or `A strong place to start.`
20. With nothing on offer (a custom step), `null`.

### Suggestions

21. `parseChoices` reads a JSON list out of prose or a code fence; strings become labels; items without a string label longer than one character are dropped; labels are cut to 60 and hints to 70 characters; at most 4; anything else gives `[]`.
22. `mergeChoices` puts suggestions first, drops repeats regardless of case, and stops at 6.
23. `wantsSuggestions` is false for a closed, custom or `suggest: false` step, and false until at least one non-meta answer is in.
24. `suggestionMessages` sends the guide's name in the system line and the flow, the summary, the question without asterisks and the example labels in the user line.
25. With no assistant, or one that is asleep, `suggestChoices` makes no request and gives `[]`.
26. A failing or timed-out assistant gives `[]` and nothing is cached; a parsed reply is cached per `(guide, flow, step, answers)` and never asked twice. An asleep assistant caches nothing either.

### Custom steps

27. A custom step is answered with whatever the app passes to `answer`, and shows on the summary under its key.
28. `finishAll` marks it `Done`; `pickFor` with nothing to offer gives `Done`; no suggestions are asked; `recommend` is `null`.

### Runs

29. `newRun` is an empty draft of one flow with equal `createdAt` and `updatedAt`.
30. `saveRun` stores under `orbit:guide:{id}:runs`, refreshes `updatedAt`, replaces by id, and returns the saved copy.
31. `listRuns` is newest first by `updatedAt`; broken storage gives `[]`.
32. At most 200 runs are kept; the oldest fall off.
33. `removeRun` forgets one run.
34. `whenOf` says `Today`, `Yesterday`, `N days ago` or a short date.

### Tests

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPASS,
  CUSTOM_DONE,
  answer,
  back,
  finishAll,
  listRuns,
  mergeChoices,
  newRun,
  nextStep,
  parseChoices,
  pickFor,
  progressOf,
  recommend,
  removeRun,
  resultOf,
  saveRun,
  setAssistant,
  stepsFor,
  suggestChoices,
  suggestionMessages,
  summaryOf,
  valueOf,
  wantsSuggestions,
  whenOf,
  type Flow,
} from '../../src/flow';

const trip = COMPASS.flows.trip;
const evening = COMPASS.flows.evening;
const fixed = () => 0; // always the first choice
const stepIn = (flow: Flow, id: string) => flow.steps.find((s) => s.id === id)!;

/** A small flow with a dependent step, since Compass has none. */
const gated: Flow = {
  id: 'gated',
  label: 'A gated flow',
  steps: [
    { id: 'kind', kick: 'One', q: 'Which *kind?*', key: 'Kind', choices: [{ label: 'Simple' }, { label: 'Detailed' }], closed: true },
    { id: 'detail', kick: 'Two', q: 'Which *detail?*', key: 'Detail', choices: [{ label: 'This' }, { label: 'That' }], when: (a) => a.kind === 'Detailed' },
    { id: 'last', kick: 'Three', q: 'And *finally?*', key: 'Last', choices: [{ label: 'Yes' }, { label: 'No' }] },
  ],
};

describe('the flow engine', () => {
  it('asks the questions in order, one at a time', () => {
    expect(nextStep(trip, {})?.id).toBe('where');
    const a = answer(trip, {}, 'where', 'A harbour town');
    expect(nextStep(trip, a)?.id).toBe('when');
    expect(progressOf(trip, a)).toEqual({ n: 2, total: 7 });
    expect(stepsFor(trip, {}).map((s) => s.id)).toEqual(['where', 'when', 'who', 'pace', 'budget', 'notes', 'shape']);
  });

  it('asks a dependent question only while its condition holds', () => {
    expect(stepsFor(gated, answer(gated, {}, 'kind', 'Simple')).map((s) => s.id)).toEqual(['kind', 'last']);
    expect(stepsFor(gated, answer(gated, {}, 'kind', 'Detailed')).map((s) => s.id)).toEqual(['kind', 'detail', 'last']);
  });

  it('drops answers to questions that no longer apply', () => {
    let a = answer(gated, {}, 'kind', 'Detailed');
    a = answer(gated, a, 'detail', 'This');
    expect(a.detail).toBe('This');
    a = answer(gated, a, 'kind', 'Simple');
    expect(a).toEqual({ kind: 'Simple' });
    expect(nextStep(gated, a)?.id).toBe('last');
  });

  it('goes back one answer at a time', () => {
    let a = answer(trip, {}, 'where', 'A harbour town');
    a = answer(trip, a, 'when', 'High summer');
    expect(back(trip, a)).toEqual({ where: 'A harbour town' });
    expect(back(trip, {})).toEqual({});
  });

  it('picks one of the answers on offer, else a ready one, else Done', () => {
    const where = stepIn(trip, 'where');
    expect(pickFor(where, where.choices, fixed)).toBe('A harbour town');
    expect(pickFor(where, [], fixed)).toBe('A harbour town');
    expect(pickFor(where, [{ label: 'Somewhere else' }], fixed)).toBe('Somewhere else');
    expect(pickFor(where, where.choices, () => 0.99)).toBe('An old town in the rain');
    expect(pickFor(stepIn(trip, 'notes'), undefined, fixed)).toBe(CUSTOM_DONE);
  });

  it('finishes the rest on request, keeping what was answered and marking a custom step done', () => {
    const done = finishAll(trip, { where: 'A desert road' }, fixed);
    expect(nextStep(trip, done)).toBeNull();
    expect(done).toEqual({ where: 'A desert road', when: 'Early spring', who: 'Just me', pace: 'Slow', budget: 'Shoestring', notes: CUSTOM_DONE, shape: 'A day-by-day list' });
    expect(progressOf(trip, done)).toEqual({ n: 7, total: 7 });
  });

  it('turns an answer into its value: the ready answer’s value, its lower-cased label, or your own words', () => {
    const where = stepIn(trip, 'where');
    expect(valueOf(where, 'A harbour town')).toBe('a small harbour town');
    expect(valueOf(stepIn(trip, 'shape'), 'One page')).toBe('one page');
    expect(valueOf(where, 'My cousin’s farm')).toBe('My cousin’s farm');
  });

  it('sums the answers up under their names, and joins their values into one line without the meta ones', () => {
    const a = finishAll(trip, { where: 'A harbour town', when: 'High summer', notes: 'Avoid the 14th', shape: 'One page' }, fixed);
    expect(summaryOf(trip, a)).toEqual([
      { key: 'Place', value: 'A harbour town' },
      { key: 'Season', value: 'High summer' },
      { key: 'Company', value: 'Just me' },
      { key: 'Pace', value: 'Slow' },
      { key: 'Budget', value: 'Shoestring' },
      { key: 'Notes', value: 'Avoid the 14th' },
      { key: 'Shape', value: 'One page' },
    ]);
    expect(resultOf(trip, a)).toBe('a small harbour town, in high summer, travelling alone, a slow pace, on a shoestring, Avoid the 14th');
    expect(resultOf(trip, a)).not.toContain('One page');
    expect(summaryOf(trip, { where: '' })).toEqual([]);
  });
});

describe('the orb’s pick', () => {
  it('picks the answer whose suits word is in an earlier answer, and says why', () => {
    expect(recommend(trip, { where: 'A harbour town' }, stepIn(trip, 'when'))).toEqual({ label: 'High summer', why: 'It fits “harbour” in your place.' });
  });

  it('counts every matching word, and the first word names the reason', () => {
    const a = { where: 'A harbour town', when: 'High summer', who: 'A few friends' };
    expect(recommend(trip, a, stepIn(trip, 'pace'))).toEqual({ label: 'Packed', why: 'It fits “friends” in your company.' });
  });

  it('keeps the earlier answer on a tie', () => {
    const a = { where: 'An old town in the rain', when: 'Autumn', who: 'Just me', pace: 'Slow' };
    expect(recommend(trip, a, stepIn(trip, 'budget'))).toEqual({ label: 'Shoestring', why: 'It fits “just me” in your company.' });
  });

  it('falls back to the assistant’s suggestion that is on offer, then to the step’s best, then to the first answer', () => {
    const when = stepIn(trip, 'when');
    const farm = { where: 'My cousin’s farm' }; // matches no suits word
    const idea = { label: 'Late spring', hint: 'Blossom and long evenings' };
    expect(recommend(trip, farm, when, [idea, ...when.choices], [idea])).toEqual({ label: 'Late spring', why: 'The assistant’s idea: blossom and long evenings.' });
    const bare = { label: 'Late spring' };
    expect(recommend(trip, farm, when, [bare, ...when.choices], [bare])?.why).toBe('The assistant thinks this fits what you picked.');
    expect(recommend(trip, farm, when, when.choices, [idea])).toEqual({ label: 'Early spring', why: 'Few crowds, cool air.' });
    expect(recommend(trip, farm, stepIn(trip, 'pace'))).toEqual({ label: 'Steady', why: 'A plan, with room to wander.' });
    expect(recommend(trip, {}, stepIn(trip, 'where'))).toEqual({ label: 'A harbour town', why: 'Boats, gulls, fish for dinner.' });
  });

  it('prefers a match over a suggestion, and gives nothing for a custom step', () => {
    const when = stepIn(trip, 'when');
    const idea = { label: 'Late spring', hint: 'Blossom' };
    expect(recommend(trip, { where: 'A big city' }, when, [idea, ...when.choices], [idea])?.label).toBe('Autumn');
    expect(recommend(trip, { where: 'A harbour town' }, stepIn(trip, 'notes'))).toBeNull();
  });

  it('chains through the evening flow', () => {
    expect(recommend(evening, { mood: 'Out with people' }, stepIn(evening, 'where'))).toEqual({ label: 'Close by', why: 'It fits “out” in your mood.' });
    expect(recommend(evening, { mood: 'Make something' }, stepIn(evening, 'where'))?.label).toBe('At home');
    expect(recommend(evening, { mood: 'Quiet', where: 'At home' }, stepIn(evening, 'hours'))).toEqual({ label: 'The evening', why: 'Six till late.' });
  });
});

describe('suggested choices', () => {
  it('reads a JSON list out of a chatty reply', () => {
    const list = parseChoices('Sure! ```json\n[{"label":"A lake house","hint":"Still water, early swims"},"A sleeper train"]\n```');
    expect(list).toEqual([{ label: 'A lake house', hint: 'Still water, early swims' }, { label: 'A sleeper train', hint: undefined }]);
    expect(parseChoices('no list here')).toEqual([]);
    expect(parseChoices('{"label": "not a list"}')).toEqual([]);
  });

  it('keeps at most four, trims long labels and hints, and drops what is not an answer', () => {
    const five = JSON.stringify([1, 2, 3, 4, 5].map((n) => ({ label: `Answer ${n}`, hint: 'h' })));
    expect(parseChoices(five)).toHaveLength(4);
    const long = parseChoices(JSON.stringify([{ label: 'x'.repeat(80), hint: 'y'.repeat(80) }]));
    expect(long[0].label).toHaveLength(60);
    expect(long[0].hint).toHaveLength(70);
    expect(parseChoices('["a", "", 7, {"hint": "no label"}]')).toEqual([]);
  });

  it('puts the assistant first, drops repeats regardless of case, and stops at six', () => {
    const merged = mergeChoices([{ label: 'Quiet' }, { label: 'New one' }], [{ label: 'quiet' }, { label: 'Packed' }]);
    expect(merged.map((c) => c.label)).toEqual(['Quiet', 'New one', 'Packed']);
    const four = ['One', 'Two', 'Three', 'Four'].map((label) => ({ label }));
    const six = mergeChoices(four, stepIn(trip, 'where').choices);
    expect(six).toHaveLength(6);
    expect(six.slice(4).map((c) => c.label)).toEqual(['A harbour town', 'A mountain village']);
  });

  it('asks only on open steps, once an answer that is part of the result is in', () => {
    const when = stepIn(trip, 'when');
    expect(wantsSuggestions(trip, when, {})).toBe(false);
    expect(wantsSuggestions(trip, when, { where: 'A harbour town' })).toBe(true);
    expect(wantsSuggestions(trip, stepIn(trip, 'shape'), { where: 'A harbour town' })).toBe(false);
    expect(wantsSuggestions(trip, stepIn(trip, 'notes'), { where: 'A harbour town' })).toBe(false);
    expect(wantsSuggestions(evening, stepIn(evening, 'mood'), { hours: 'An hour' })).toBe(false);
  });

  it('tells the assistant what was chosen and what the question is', () => {
    const [system, user] = suggestionMessages(COMPASS, trip, stepIn(trip, 'when'), { where: 'A harbour town' });
    expect(system).toEqual({ role: 'system', content: 'You suggest answers for a step-by-step guided flow in Compass. Reply with only a JSON array.' });
    expect(user.role).toBe('user');
    expect(user.content).toContain('We are working on a trip.\nChosen so far:\nPlace: A harbour town');
    expect(user.content).toContain('Next question: When do we go?');
    expect(user.content).toContain('Examples of answers: Early spring; High summer; Autumn; Deep winter');
    expect(suggestionMessages(COMPASS, trip, stepIn(trip, 'where'), {})[1].content).toContain('Chosen so far:\n(nothing yet)');
  });

  it('gives an empty list with no assistant, or one that is asleep', async () => {
    setAssistant(null);
    await expect(suggestChoices(COMPASS, trip, stepIn(trip, 'when'), { where: 'A harbour town' })).resolves.toEqual([]);
    let asked = 0;
    setAssistant({ awake: () => false, chat: async () => void asked++ });
    await expect(suggestChoices(COMPASS, trip, stepIn(trip, 'when'), { where: 'An old town in the rain' })).resolves.toEqual([]);
    expect(asked).toBe(0);
    setAssistant(null);
  });

  it('gives an empty list when the assistant fails or times out', async () => {
    setAssistant({ awake: () => true, chat: () => Promise.reject(new Error('down')) });
    await expect(suggestChoices(COMPASS, trip, stepIn(trip, 'when'), { where: 'A desert road' })).resolves.toEqual([]);
    setAssistant({
      awake: () => true,
      chat: (_m, _t, signal) => new Promise<void>((_r, rej) => signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    });
    await expect(suggestChoices(COMPASS, trip, stepIn(trip, 'when'), { where: 'A big city' }, 10)).resolves.toEqual([]);
    setAssistant(null);
  });

  it('parses the assistant’s reply and remembers it for the same answers', async () => {
    let asked = 0;
    setAssistant({
      awake: () => true,
      chat: async (_m, onText) => {
        asked++;
        onText('Here you go: [{"label":"Late spring","hint":"Blossom"}]');
      },
    });
    const a = { where: 'A mountain village' };
    expect(await suggestChoices(COMPASS, trip, stepIn(trip, 'when'), a)).toEqual([{ label: 'Late spring', hint: 'Blossom' }]);
    await suggestChoices(COMPASS, trip, stepIn(trip, 'when'), a);
    expect(asked).toBe(1);
    setAssistant(null);
  });
});

describe('custom steps', () => {
  it('is answered with whatever the app gives, and finished for you with Done', () => {
    const notes = stepIn(trip, 'notes');
    const a = answer(trip, {}, 'notes', 'Avoid the 14th');
    expect(summaryOf(trip, a)).toEqual([{ key: 'Notes', value: 'Avoid the 14th' }]);
    expect(valueOf(notes, 'Avoid the 14th')).toBe('Avoid the 14th');
    expect(finishAll(trip, {}, fixed).notes).toBe(CUSTOM_DONE);
    expect(pickFor(notes)).toBe(CUSTOM_DONE);
    expect(wantsSuggestions(trip, notes, { where: 'A harbour town' })).toBe(false);
    expect(recommend(trip, { where: 'A harbour town' }, notes)).toBeNull();
  });
});

describe('runs', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    return () => vi.useRealTimers();
  });

  it('starts a run empty, as a draft of one flow', () => {
    const r = newRun('trip');
    expect(r).toMatchObject({ flowId: 'trip', title: '', answers: {}, status: 'draft' });
    expect(r.id.startsWith('r')).toBe(true);
    expect(r.createdAt).toBe('2026-10-22T10:00:00.000Z');
    expect(r.updatedAt).toBe(r.createdAt);
    expect(listRuns('compass')).toEqual([]);
  });

  it('keeps runs under the guide’s key, newest first, replacing by id', () => {
    const a = saveRun('compass', newRun('trip'));
    vi.setSystemTime(new Date('2026-10-22T11:00:00Z'));
    const b = saveRun('compass', newRun('evening'));
    expect(JSON.parse(store.get('orbit:guide:compass:runs')!)).toHaveLength(2);
    expect(listRuns('compass').map((r) => r.id)).toEqual([b.id, a.id]);
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const again = saveRun('compass', { ...a, answers: { where: 'A harbour town' } });
    expect(again.updatedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(listRuns('compass').map((r) => r.id)).toEqual([a.id, b.id]);
    expect(listRuns('compass')[0].answers).toEqual({ where: 'A harbour town' });
  });

  it('keeps at most 200 runs, dropping the oldest', () => {
    const first = saveRun('compass', newRun('trip'));
    for (let i = 0; i < 204; i++) {
      vi.advanceTimersByTime(1000);
      saveRun('compass', newRun('trip'));
    }
    expect(listRuns('compass')).toHaveLength(200);
    expect(listRuns('compass').some((r) => r.id === first.id)).toBe(false);
  });

  it('forgets a run, and survives broken storage', () => {
    const r = saveRun('compass', newRun('trip'));
    removeRun('compass', r.id);
    expect(listRuns('compass')).toEqual([]);
    store.set('orbit:guide:compass:runs', 'not json');
    expect(listRuns('compass')).toEqual([]);
    store.set('orbit:guide:compass:runs', '{"not":"a list"}');
    expect(listRuns('compass')).toEqual([]);
  });

  it('says when a run was touched the way a contents page would', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
    expect(whenOf(at(3), now)).toBe('Today');
    expect(whenOf(at(-3), now)).toBe('Today');
    expect(whenOf(at(30), now)).toBe('Yesterday');
    expect(whenOf(at(24 * 3 + 1), now)).toBe('3 days ago');
    expect(whenOf(at(24 * 20), now)).toBe(new Date(at(24 * 20)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  });
});
```

### Shell-level criteria (from `docs/07-layout-and-navigation.md`, not covered by unit tests)

| Feature | Criteria |
|---|---|
| Trail revisit | Tapping an answered step drops that answer and every later one; the question is asked again with the same ready answers. |
| Auto-save | After every pick, own-words submit, custom answer, revisit and Back, `listRuns` returns the run with the new answers and a fresh `updatedAt`. |
| Save draft | Shows the toast `Saved. It is waiting in your drafts.` and goes home; nothing is lost that was not already saved. |
| Custom step | Its body replaces the answers; no own-words box, no shortcuts, no "Thinking of more…"; the orb's note offers the way past it. |
| The orb's pick | Marked on the answer, with the orb spot on it; the orb's note says `I’d go with “{label}”. {why}` and its button picks it. |
| Assistant absent | Everything above works with `setAssistant(null)`: no suggestions, no "Thinking of more…", the pick from `suits` and `best`, the conversation on the app's own `onSend`. |

---

## 10. Writing a new guide

Copy `src/flow/guides/example.ts`, change the words, and check each line:

- [ ] **One `*italic*` word per question.** `q` carries exactly one word (or short phrase) between asterisks, the one that matters: `Where *to?*`, `How *fast?*`. The assistant sees the question with the asterisks removed.
- [ ] **One-sentence deks.** `dek` is one short sentence or nothing; it says why the question matters, not how to answer it.
- [ ] **A hint on every choice.** `hint` is one line under the label; it is also the orb's reason when the choice is picked as `best` or first (`{hint}.`), so it must read as a sentence with a full stop added.
- [ ] **`suits` words that actually appear in earlier labels.** Matching is a lower-cased substring search over the *labels* of earlier answers (and own words), never over hints. Take the words from earlier labels (`harbour`, `friends`, `just me`), and keep in mind that a short word matches inside longer ones (`two` in "the two of us"; `sun` in "Sunday"). Words that appear in no earlier label only ever fire on own words, which is fine when intended. The first step's `suits` never fire.
- [ ] **A `value` where the label does not read well in a sentence.** `resultOf` joins values with commas; `A harbour town` becomes `a small harbour town`. Without a `value`, the label is lower-cased.
- [ ] **`meta` for anything that is not part of the result.** A length, a shape, a format: it shows on the summary but stays out of `resultOf`, and does not count as "something to go on" for suggestions.
- [ ] **`closed` for yes/no and fixed sets.** No own-words box, no suggestions. Usually with `suggest: false` for clarity.
- [ ] **`when` for dependent steps.** A step that only makes sense after a particular earlier answer; its answer is dropped automatically when that answer changes. Keep `when` a pure function of the answers.
- [ ] **A `best` on steps whose first choice is not the sensible default.** The orb's fallback pick is the first choice; set `best` (a label that exists in `choices`) when another is the better default. `finishAll` ignores it (random pick).
- [ ] **`custom` for a step the app renders.** `choices: []`, `closed: true`, `suggest: false`; the app switches on the string and answers with `answer(flow, answers, step.id, value)`. Mark it `meta` unless its value belongs in `resultOf` (a skipped one contributes `Done`).
- [ ] **Flow `label` as a noun phrase with its article** (`A trip`, `An evening`): it is used in sentences ("We are working on a trip") and on the contents page (`Untitled trip`).
- [ ] **A `key` per step that reads as a possessive.** It appears as `Place: A harbour town` on the summary and as `in your place` in the orb's reason.
- [ ] **Step ids unique within the flow.** They are the keys of `Answers` and the trail's layout ids; the engine reads none of them.
- [ ] **`starters` and `followUps`** so nobody faces an empty conversation box; `rules` for the options drawer.
- [ ] **Eight theme colours**, and a `mark` that splits the name where the italic half starts.
- [ ] **Walk every chain.** For each flow, follow the orb's pick from the first answer to the last (§8) and check that each reason reads well: the first `suits` word of a choice is the one the orb will name.
