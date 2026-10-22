# 08 · The walkthrough engine: functional PRD

A guided walkthrough asks one question at a time, each with a few ready answers and a box for your own words, until a brief is complete; the brief becomes a job (a picture, a video or a film). This document specifies the engine so it can be re-implemented anywhere: the data model, every rule, the writer contract (the one place a language model may be plugged in), the writers' room that drafts a film script without any model, storage, the orb hooks, and a complete worked example (the After Dark studio, copied as tables). The TypeScript in `src/walkthrough/` is the reference implementation and passes the unit tests quoted in §11.

## Contents

1. [Vocabulary](#1-vocabulary)
2. [Data model](#2-data-model)
3. [Engine functions](#3-engine-functions)
4. [The orb's pick (recommend)](#4-the-orbs-pick)
5. [Predicted choices](#5-predicted-choices)
6. [The writers' room](#6-the-writers-room)
7. [The writer adapter](#7-the-writer-adapter)
8. [Projects and characters (storage)](#8-projects-and-characters)
9. [Orb guide hooks](#9-orb-guide-hooks)
10. [Worked example: After Dark](#10-worked-example-after-dark)
11. [Acceptance criteria and the unit tests](#11-acceptance-criteria-and-the-unit-tests)

---

## 1. Vocabulary

| Word | Meaning |
|---|---|
| Studio | One product built on the engine: a name, colours, a writer's persona, house rules and three flows. Each studio is its own site. |
| Flow | The list of questions for one kind of thing to make: `image`, `video` or `movie`. |
| Step | One question. Has ready answers (choices) and flags. |
| Answers | A map `stepId → string`, the state of a walkthrough. |
| Brief | The answers under their names, in order. |
| Prompt | The words the answers add up to, plus the studio's tail. |
| Job | What the finished brief becomes: a request to a maker, or a movie draft. |
| Writer | An optional language model behind an adapter. The engine never requires one. |
| Writers' room | The rule-based script drafter (no model). |
| The orb | The guide: it sits on the recommended answer and keeps a line until tapped. |

---

## 2. Data model

Reference: `src/walkthrough/defs.ts`, `jobs.ts`, `projects.ts`.

### Choice

| Field | Type | Meaning |
|---|---|---|
| `label` | `string` | What is shown and what is stored as the answer. |
| `hint` | `string?` | One line under the label. |
| `adds` | `string?` | What it adds to the prompt. Default: the label lower-cased. |
| `suits` | `string[]?` | Words that, when found in earlier answers, make this the orb's pick. |

### StepDef

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | — | The answer's key in `Answers`. Some ids are read by the engine (see §3 `jobOf`) and the writers' room (§6). |
| `kick` | `string` | — | Running head ("Chapter 02 · The room"). |
| `q` | `string` | — | The question; `*words*` are italic. |
| `dek` | `string?` | — | One line under the question. |
| `key` | `string` | — | The answer's name on the brief ("Mood"). Some keys are special: `Cut` is left out of prediction context; `Appearance`, `Lead`, `Partner` are kept as characters; `Cut Scenes Sound Storyboard Look Script` are left out of a movie's idea; `Script` is left out of the brief list on screen. |
| `choices` | `Choice[]` | — | Ready answers. Empty on a script step. |
| `predict` | `boolean?` | `true` | Ask the writer for fresh choices. |
| `when` | `(a: Answers) => boolean?` | always | The step exists only when this is true for the current answers. |
| `closed` | `boolean?` | `false` | No "own words" box, and no predictions. |
| `meta` | `boolean?` | `false` | Not part of the prompt (length, shape…), only of the job. |
| `best` | `string?` | first choice | The orb's pick when nothing earlier points elsewhere. |
| `kind` | `'choose' \| 'script'?` | `'choose'` | `'script'`: the step shows the script desk; its answer is a short approval line. |

### Flow

`{ kind: 'image' | 'video' | 'movie' (| 'talk'); label: string; hint: string; steps: StepDef[] }`. `label` is used in sentences ("We are making a picture"), so it is a noun phrase with its article.

### StudioDef

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Storage key part; the site's id. |
| `name` | `string` | "After Dark". |
| `mark` | `[string, string]` | Masthead halves; the second is italic. |
| `kicker` | `string` | Small line over the masthead. |
| `adult` | `boolean` | Gate first; rules shown on it. |
| `theme` | `{ paper, ink, ink2, accent, desk, desk2, orbA, orbB }` | Colours (CSS strings). |
| `writer` | `string` | The writer's persona: the system prompt for predictions, script rewrites and Talk. |
| `tail` | `string` | Appended to every prompt. |
| `characters` | `string` | What the gallery calls characters. |
| `makers` | `{ image: string[]; video: string[]; movie: 'ltx' \| 'h3-max' }` | Preferred makers in order (app-defined ids). |
| `rules` | `string[]` | House rules. |
| `talk` | `{ starters: Choice[]; followUps: Choice[] }` | Ready openers and follow-ups for Talk. |
| `flows` | `{ image: Flow; video: Flow; movie: Flow }` | |

### Answers

`Record<string, string>`: step id → the label picked, or the words typed, or the script approval line.

### Scene

`{ id: 's1'…; heading: 'INT. PLACE — TIME'; action: string; end: string; says: string }`.

### Project

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | `'p' + Date.now().toString(36) + 4 random base-36 chars`. |
| `kind` | `'image' \| 'video' \| 'movie'` | |
| `title` | `string` | Derived by the app (`titleOf`). |
| `answers` | `Answers` | |
| `script` | `{ basis: string; scenes: Scene[]; by: 'draft' \| 'writer' \| 'you' }?` | Movies only. `basis = scriptBasis(answers)` at drafting time. |
| `status` | `'draft' \| 'making' \| 'done' \| 'error'` | |
| `jobId`, `movieId` | `string?` | The app's job handles. |
| `items` | `string[]` | Ids of what it made. |
| `error` | `string \| null?` | |
| `createdAt`, `updatedAt` | ISO strings | |

### Character

`{ id: 'c' + Date.now().toString(36); name: string; description: string; itemId?: string | null; createdAt: ISO }`.

### Job (output)

```ts
type Job =
  | { kind: 'image' | 'video'; req: StudioRequest }          // { kind, maker, prompt, size, seconds? }
  | { kind: 'movie'; draft: MovieDraft; review: boolean };
```

`MovieDraft` (the portable subset): `title, idea, look, maker, size: 'landscape', length (s), sound: 'auto'|'shots'|'music'|'quiet', reviewStoryboard, lead: { mode: 'ai'|'auto', description? }, opening?, shots?: { prompt, end, says }[]`.

---

## 3. Engine functions

Reference: `src/walkthrough/engine.ts`. All are pure; `rand` parameters default to `Math.random` and are injectable for tests.

| Function | Rule |
|---|---|
| `stepsFor(flow, answers)` | `flow.steps` filtered to those with no `when` or whose `when(answers)` is true. Order is the flow's. |
| `nextStep(flow, answers)` | The first step of `stepsFor` whose `id` is not a key in `answers`; `null` when none. |
| `progressOf(flow, answers)` | `total = stepsFor(...).length`; `done` = number of those with an answer; `n = min(done + 1, total)`. 1-based "n of total". |
| `answer(flow, answers, stepId, value)` | `next = { ...answers, [stepId]: value }`; keep only keys whose step is in `stepsFor(flow, next)`. **Answers to steps that no longer apply are dropped.** (Example: switching cast from "A couple" to "A woman" drops `partner`.) |
| `back(flow, answers)` | The last answered step in `stepsFor` order is removed; with none, `answers` is returned unchanged. |
| `pickFor(step, offered = step.choices, rand)` | `list = offered.length ? offered : step.choices`; empty → `SCRIPT_OK`; else `list[floor(rand() · length) % length].label`. |
| `SCRIPT_OK` | The constant `'Approved'`: how an approved script reads in the trail. |
| `finishAll(flow, answers, rand)` | Repeat up to 40 times: `s = nextStep`; stop when null; `answer(..., s.id, s.kind === 'script' ? SCRIPT_OK : pickFor(s, s.choices, rand))`. Uses the step's own choices, not predictions. |
| `wordsOf(step, value)` (private) | If `value` equals a choice's label: `choice.adds ?? label.toLowerCase()`; else `value` verbatim. |
| `promptOf(studio, flow, answers)` | For each step in `stepsFor` that is not `meta` and has a truthy answer, `wordsOf`; then append `studio.tail`; join with `', '`. |
| `briefOf(flow, answers)` | `[{ key: step.key, value: answers[id] }]` for each step in `stepsFor` with a truthy answer, in order. |
| `makerFor(list, installed)` | With `installed` given: the first id in `list` that `installed` contains, if any; else `list[0]`. |
| `jobOf(studio, kind, answers, installed = null, script = null)` | See below. |

### jobOf

`SHAPES = { Portrait: 'portrait', Square: 'square', Landscape: 'landscape' }`.

- **image**: `{ kind: 'image', req: { kind: 'image', maker: makerFor(studio.makers.image, installed), prompt: promptOf(...), size: SHAPES[answers.shape] ?? 'portrait' } }`.
- **video**: `seconds = parseInt(answers.length ?? '5', 10) || 5` (so "8 seconds" → 8); `{ kind: 'video', req: { kind: 'video', maker: makerFor(studio.makers.video, installed), prompt, seconds, size: SHAPES[answers.vshape] ?? 'landscape' } }`.
- **movie**:
  - `director = answers.cut === "Director's cut"`.
  - `scenes = script?.length || parseInt(answers.scenes ?? '', 10)` ("4 scenes" → 4; NaN when absent).
  - `length = scenes && (director || script?.length) ? min(30, scenes · 5) : 15`.
  - `sound = { Music: 'music', 'Their voices': 'shots', Quiet: 'quiet' }[answers.msound] ?? 'auto'`.
  - `cast = castOf(answers)` (§6).
  - `lead`: with a script, `cast.filter(p => p.look).map(p => "{name}: {look}").join('; ')`; without, `[answers.lead, answers.partner && "with {partner}"].filter(Boolean).join(', ')`.
  - `idea = briefOf(flow, answers)` minus keys `Cut, Scenes, Sound, Storyboard, Look, Script`, as `"{key}: {value}"` joined with `'. '`.
  - `look = [wordsOf(finishStep, answers.finish ?? ''), studio.tail].filter(Boolean).join(', ')` where `finishStep` is the flow's step with `id === 'finish'` (it must exist in a movie flow).
  - `review = director && answers.review !== 'No, make it all'`.
  - Draft: `title = answers.premise?.slice(0, 60) ?? "{studio.name} film"`, `idea`, `look`, `maker: studio.makers.movie`, `size: 'landscape'`, `length`, `sound`, `reviewStoryboard: review`, `lead: lead ? { mode: 'ai', description: lead } : { mode: 'auto' }`, and **only with a script**: `opening = openingOf(answers)`, `shots = script.map(s => ({ prompt: describe(s.action, cast), end: describe(s.end, cast), says: s.says }))`.
  - Returns `{ kind: 'movie', review, draft }`.

Answer ids the engine reads: `shape`, `vshape`, `length`, `cut`, `scenes`, `msound`, `finish`, `review`, `premise`, `lead`, `partner` (and, through the writers' room, `cast`, `world`, `time`, `tone`, `beats`, `ending`).

---

## 4. The orb's pick

`recommend(flow, answers, step, offered = step.choices, predicted = []) → { label, why } | null`.

1. If `offered` is empty → `null`.
2. `earlier` = steps in `stepsFor` other than `step` with a truthy answer; `said = [{ key: step.key, text: answer.toLowerCase() }]`.
3. For each offered choice, `score` = number of its `suits` words found (`text.includes(word.toLowerCase())`) in any earlier answer; remember the **first** matching word and the key of the answer it was found in. The choice with the highest score wins; ties keep the earlier choice; a score of 0 never wins.
4. If a winner: `why = "It fits “{word}” in your {key lower-cased}."`.
5. Else the first `predicted` choice whose label is in `offered`: `why = "The writer’s idea: {hint lower-cased}."` or, without a hint, `"The writer thinks this fits what you picked."`.
6. Else the offered choice whose label equals `step.best`, or `offered[0]`: `why = "{hint}."` or `"A strong place to start."`.

The shell passes `offered = mergeChoices(predicted, step.choices)` and never calls it for a script step. Order of precedence: suits-word matches → writer prediction → step.best → first.

---

## 5. Predicted choices

Reference: `src/walkthrough/predict.ts`.

- `parseChoices(text)`: take the substring from the first `[` to the last `]`; `JSON.parse`; must be an array; strings become `{ label }`; keep objects whose `label` is a string of trimmed length > 1; `label` trimmed and cut to 60 chars, `hint` trimmed and cut to 70 (else `undefined`); at most 4. Any failure → `[]`.
- `mergeChoices(predicted, ready, max = 6)`: walk `[...predicted, ...ready]`, skip labels already seen (case-insensitive), stop at `max`. Writer first, no repeats.
- `predictChoices(studio, flow, step, answers, timeoutMs = 9000)`:
  1. `[]` if `step.predict === false` or `step.closed`.
  2. `[]` if `briefOf(flow, answers)` minus key `Cut` is empty (nothing to go on).
  3. Cache key `` `${studio.id}|${flow.kind}|${step.id}|${JSON.stringify(answers)}` `` (module-level `Map`); a hit is returned as is (also empty lists).
  4. An `AbortController` aborted after `timeoutMs`; ask the writer; parse; cache; return. Any error → `[]`. The timer is always cleared.
- Asking: **only when the writer is awake** (`writer.awake()`), with `maxTokens 300`; otherwise the reply is `''`. Asking must never wake a sleeping writer (that costs).
- The messages (`predictionMessages`), verbatim:

  - system: `{studio.writer}\nYou suggest answers for a step-by-step creative walkthrough. Reply with only a JSON array.`
  - user: `We are making {flow.label lower-cased}.\nChosen so far:\n{"{key}: {value}" per line, or "(nothing yet)"}\n\nNext question: {step.q without asterisks}\nExamples of answers: {choice labels joined "; "}\n\nSuggest 4 new answers that fit everything chosen so far, as [{"label": "at most 6 words", "hint": "at most 8 words"}].`

- The shell shows "The writer is thinking of more…" while `step.predict !== false && !step.closed && some answer key other than 'cut' exists`, and `orbThink(0.7)` meanwhile.

---

## 6. The writers' room

Reference: `src/walkthrough/writer.ts`. A film worked out backwards: the walkthrough asks for the arc, the ending, the people and the place, then this drafts a script with no model at all.

### castOf(answers) → Person[]

- `hash(s)`: FNV-1a 32-bit (`h = 2166136261; for each char: h = Math.imul(h ^ code, 16777619); return h >>> 0`), seeded from `answers.premise ?? ''`. So the same story always gets the same names.
- `WOMEN = [Mara, Elena, Simone, Vera, Noor, Celeste, Ines, Livia]`, `MEN = [Julian, Theo, Rafael, Dorian, Silas, Marco, Adrien, Luca]`; `w(k) = WOMEN[(seed + k) % 8]`, `m(k) = MEN[(seed + k) % 8]`.
- `look` of the lead is `answers.lead ?? ''`, of the partner `answers.partner ?? ''`. On `cast = answers.cast lower-cased`:

| cast | Result |
|---|---|
| `a woman` | `[w(0)]` |
| `a man` | `[m(0)]` |
| `two women` | `[w(0), w(3) as partner]` |
| `two men` | `[m(0), m(3) as partner]` |
| matches `/alone\|solo/` | `[w(0)]` |
| anything else (incl. "A couple", missing) | `[w(0), m(0) as partner]` |

### The beat tables

A beat is `{ a: string[] (ways the scene can go; "Another take" moves to the next), end, says }`. Placeholders: `{A}` lead's name, `{B}` partner's name (or `a stranger`), `{place}` the setting with an article.

**ARCS** (five beats each; index 5 is always the ending from ENDINGS):

`slow`
| # | a[0] | a[1] | end | says |
|---|---|---|---|---|
| 0 | {A} and {B} notice each other across {place}. Neither looks away first. | {A} catches {B} watching from across {place}, and lets the look last a beat too long. | {A} turns away, smiling. | {B}, quietly: "Do I know you?" |
| 1 | A careful conversation, close but never touching. | {A} and {B} share a drink and talk about nothing, every word loaded. | Their hands rest an inch apart. | {A}: "You should go." |
| 2 | {B} brushes a strand of hair from {A}'s face. The room goes still. | {B} reaches out and straightens {A}'s collar, slowly, deliberately. | {A} closes both eyes. | {B}, softly: "Tell me to stop." |
| 3 | They stop talking. {A} pulls {B} closer by the collar. | {A} steps into {B}'s space and holds there, waiting. | Foreheads touching, breath held. | {A}, barely a whisper: "Don't stop." |
| 4 | The kiss: slow at first, then hungry, the room blurring behind them. | They finally kiss, and everything they held back comes out at once. | They break apart, breathless. | (empty) |

`argument`
| # | a[0] | a[1] | end | says |
|---|---|---|---|---|
| 0 | {A} confronts {B} in {place}, old anger in every word. | {A} storms into {place} and finds {B} already waiting. | {B} slams a hand on the table. | {A}: "You left without a word." |
| 1 | Voices rise. They circle each other like fighters. | Every accusation lands; neither backs down an inch. | Face to face, far too close. | {B}: "I came back, didn't I?" |
| 2 | {A} turns to leave. {B} catches {A}'s wrist. | {A} reaches the door; {B} says the one thing that stops {A} cold. | Neither lets go. | {B}: "Stay. Just tonight." |
| 3 | The anger melts. {A} kisses {B}, hard. | One look, and the fight turns into something else entirely. | The kiss deepens. | (empty) |
| 4 | They stumble against the wall, laughing between kisses. | Clothes, breath and old jokes, tangled together. | A lamp tips over and falls. | {A}, laughing: "I hate you." |

`game`
| # | a[0] | a[1] | end | says |
|---|---|---|---|---|
| 0 | {A} catches {B} watching from across {place} and raises a glass. | A note arrives for {B}: a room number, in {A}'s handwriting. | {B} raises a glass back. | (empty) |
| 1 | A dare: {A} slides a key across the table toward {B}. | {A} whispers the rules of the game into {B}'s ear. | {B} pockets the key. | {A}: "Only if you're brave." |
| 2 | {B} finds {A} waiting in the half-light, playing it cool. | {B} lets the door click shut; {A} doesn't turn around yet. | A slow smile. | {A}: "You're late." |
| 3 | Each move answered: a button undone, a step closer, a glance away. | They trade moves like chess players, closer with every turn. | Nose to nose. | {B}: "Your move." |
| 4 | {A} gives in first and kisses {B}. | {B} breaks the rules and pulls {A} in. | {B} grins against {A}'s lips. | {B}: "I win." |

`reunion`
| # | a[0] | a[1] | end | says |
|---|---|---|---|---|
| 0 | {A} waits alone in {place}, glancing at the door. | {A} sets two glasses on the table in {place} and waits. | The door opens. | (empty) |
| 1 | {B} steps in, older now, the same eyes. | {B} stands in the doorway, a little out of breath. | They stand still, an arm's length apart. | {B}: "Hi." |
| 2 | They talk about the lost years, laughing, then quiet. | Old stories, old names, and the silence after them. | {A} reaches out. | {A}: "I kept your letters." |
| 3 | A long embrace that turns into a kiss. | They hold each other as if the years never happened, then kiss. | Neither wants to let go. | (empty) |
| 4 | Slow dancing with no music, foreheads together. | They sway in the low light to a song only they remember. | {B} turns {A} gently. | {B}: "I never stopped." |

`solo`
| # | a[0] | a[1] | end | says |
|---|---|---|---|---|
| 0 | {A} arrives in {place} alone, shaking off the night. | {A} lets the door fall shut and leans against it, alone at last in {place}. | The coat slides from {A}'s shoulders. | (empty) |
| 1 | {A} pours a drink and looks out, thinking of someone. | {A} stands at the glass, the city light across {A}'s skin. | A reflection in the glass. | {A}, to no one: "One more night." |
| 2 | At the mirror, {A} gets ready, slow and deliberate. | {A} chooses what to wear, then changes the mind, then smiles. | A last look in the mirror. | (empty) |
| 3 | {A} lies back, lost in a memory, warm light across the skin. | {A} stretches out across the sheets, unhurried, eyes half closed. | Eyes half closed. | (empty) |
| 4 | {A} turns and looks straight into the lens. | {A} notices the camera and, instead of hiding, steps closer. | A knowing smile. | {A}: "Were you watching?" |

**ENDINGS** (keyed by the `ending` answer; each has a `pair` and a `solo` beat):

| Ending | pair a[0] | pair a[1] | pair end | pair says | solo a[0] | solo a[1] | solo end | solo says |
|---|---|---|---|---|---|---|---|---|
| Together at dawn | Morning light finds {A} and {B} tangled in the sheets, asleep. | Dawn through the curtains; {B} watches {A} sleep. | {A} wakes and smiles. | (empty) | Morning light finds {A} asleep, smiling at the memory. | Dawn; {A} wakes slowly, wrapped in white linen. | {A} stretches into the sun. | (empty) |
| One last look, then gone | {B} dresses in the grey light and stops at the door for one last look. | At first light {A} slips out of bed and lingers in the doorway. | The door closes; one of them is alone. | {B}: "Goodbye." | {A} dresses in the grey light and stops at the door for one last look back. | {A} leaves the key on the pillow and walks out. | The door closes. | (empty) |
| A twist | While {B} sleeps, {A} slips something from {B}'s jacket: it was never what it seemed. | {B} wakes to find {A} gone, and a photograph left on the pillow. | {A} walks out into the night, smiling. | {A}: "Nothing personal." | {A} opens the envelope on the bed: someone has been watching all along. | {A} finds a second key on the dresser that wasn't there before. | {A} looks up, startled, then smiles. | (empty) |
| Left wanting more | Just as it begins, {A} pulls away and walks to the door. | {A} stops {B} with a finger to the lips and leaves. | A look back over the shoulder. | {A}: "Next time." | {A} switches off the lamp; only a silhouette and a smile remain. | {A} draws the curtain closed, eyes on the lens. | Darkness, and a laugh. | {A}: "Next time." |

**Label maps**

| Map | Entries |
|---|---|
| `ARC_OF` (from `beats`) | `Slow burn to a kiss → slow`, `Argument turns to passion → argument`, `A game of seduction → game`, `Tender reunion → reunion` |
| `TONE_ARC` (from `tone`) | `Slow burn → slow`, `Playful → game`, `Romantic → reunion`, `Intense → argument`, `Dark and dangerous → argument` |
| `TONE_END` (from `tone`) | `Slow burn → Left wanting more`, `Playful → Left wanting more`, `Romantic → Together at dawn`, `Intense → One last look, then gone`, `Dark and dangerous → A twist` |
| `TIME` (from `time`) | `Late night, after the rain → NIGHT`, `Golden hour → SUNSET`, `Snowed-in winter → WINTER NIGHT`, `1950s, jazz and smoke → NIGHT, 1955` |

### Functions

| Function | Rule |
|---|---|
| `beatsFor(n)` | Which beat indexes a film of `n` scenes keeps, `n` clamped to 1..6: `1 → [5]`, `2 → [0, 5]`, `3 → [0, 3, 5]`, `4 → [0, 2, 4, 5]`, `5 → [0, 1, 3, 4, 5]`, `6 → [0, 1, 2, 3, 4, 5]`. The last is always the ending. |
| `sceneCount(answers)` | `3` unless `cut === "Director's cut"`, then `clamp(1, 6, parseInt(answers.scenes) || 4)`. |
| `placeOf(answers)` (private) | `answers.world ?? 'a quiet room'` with trailing full stops removed. |
| `withThe(p)` (private) | If `p` starts with `a `, `an ` or `the ` (case-insensitive) → `p` lower-cased; else `the {p lower-cased}`. |
| `headingOf(answers)` | `` `INT. ${placeOf upper-cased} — ${TIME[answers.time] ?? 'NIGHT'}` `` (an em dash). |
| `fill(text, cast, answers)` (private) | Replace `{A}` with `cast[0]?.name ?? 'The lead'`, `{B}` with `cast[1]?.name ?? 'a stranger'`, `{place}` with `withThe(placeOf)`. |
| `beatList(answers)` (private) | `solo = castOf(answers).length < 2`; `arc = solo ? 'solo' : ARC_OF[beats] ?? TONE_ARC[tone] ?? 'slow'`; `ending = ENDINGS[ending] ?? ENDINGS[TONE_END[tone] ?? 'Left wanting more']`; result `[...ARCS[arc], solo ? ending.solo : ending.pair]` (6 beats). |
| `draftScript(answers)` | `voices = msound !== 'Music' && msound !== 'Quiet'`; for each `k` of `beatsFor(sceneCount)`, at position `i`: `{ id: 's{i+1}', heading: headingOf, action: fill(beat.a[0]), end: fill(beat.end), says: voices ? fill(beat.says) : '' }`. |
| `anotherTake(answers, scenes, i)` | `k = beatsFor(scenes.length)[i]`; beat `beatList(answers)[k]` (if missing, return `scenes`); `takes = beat.a.map(fill)`; `at = takes.indexOf(scenes[i].action)`; new action `takes[(at + 1) % takes.length]` (so an edited action, not found, goes to `takes[0]`); only scene `i` changes. Cycles: take → next take → first take. |
| `scriptBasis(answers)` | `JSON.stringify` of `[cut, premise, tone, cast, lead, partner, motive, world, time, beats, ending, scenes]` values (`''` when missing). When it changes, the draft is written again; camera, sound, look and storyboard answers do not change it. |
| `describe(text, cast)` | For each cast member with a `look`: at the first occurrence of the name, insert ` ({look lower-cased})` after it. Unchanged when the name is absent. |
| `openingOf(answers)` | `` `Establishing shot of ${withThe(placeOf)}, ${(TIME[time] ?? 'night').toLowerCase()}. ${premise ?? ''}`.trim() ``. |
| `parseScenes(text, fallbackHeading)` | Substring from the first `[` to the last `]`; `JSON.parse`; array of objects; each → `{ id: 's{i+1}', heading: str(80) \|\| fallbackHeading, action: str(500), end: str(240), says: str(240) }` where `str` trims and cuts; keep scenes with `action.length > 3`; at most 6. Any failure → `[]`. |
| `brief(answers)` (private) | Lines `Story: premise`, `Tone: tone`, `Characters: "{name} ({look})" joined " and "`, `What the lead wants: motive`, `Place: world`, `Time: time`, `Arc: beats`, `Ending: ending`, only those with a value, joined by newlines. |

### The prompts sent to a writer, verbatim

`SHAPE = [{"heading":"INT. PLACE — TIME","action":"what we see, one or two visual sentences","end":"the exact final moment, one sentence","says":"Name: \"one short line\" or empty"}]`

**writeScript(studio, answers, signal)** — `maxTokens 1200`; result `parseScenes(text, headingOf(answers)).slice(0, sceneCount)`:

- system: `{studio.writer}\nYou write short film scripts. Each scene becomes a 5-second shot, so keep each one to a single visual action. Reply with only a JSON array.`
- user: `{brief(answers)}\n\nWrite exactly {n} scenes, the last one the ending, as {SHAPE}. Use the characters' names.`

**rewriteScene(studio, answers, scenes, i, how, signal)** — the script is listed as `"{j+1}. {heading}. {action} Ends on: {end}{ " " + says if any}"` per line; result: the first parsed scene (fallback heading = the old scene's) replaces scene `i`, keeping its `id`; nothing parsed → `scenes` unchanged:

- system: `{studio.writer}\nYou revise one scene of a short film script. Reply with only a JSON array holding the one new scene.`
- user: `{brief(answers)}\n\nThe script:\n{script}\n\nRewrite scene {i+1} so it is {how}. Keep it one visual action that leads into the next scene, as {SHAPE}.`

The `how` strings the desk uses: `a fresh take on the same moment` (Another take, when awake), plus the configurable rewrites (source defaults: `more intense and sensual, still tasteful and consenting`, `softer, more tender`).

With no writer plugged in, both functions reject with `No writer is plugged in. Your draft is still here.`

---

## 7. The writer adapter

Reference: `src/walkthrough/adapter.ts`. The only seam for a language model.

```ts
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
interface Writer {
  chat(messages: ChatMessage[], onText: (d: string) => void, signal?: AbortSignal, maxTokens?: number): Promise<void>;
  awake(): boolean;
}
setWriter(w: Writer | null); getWriter(); writerAwake();
```

Contract:

| Rule | Why |
|---|---|
| `chat` streams pieces of text through `onText` and resolves when done; rejects on failure; an abort rejects with an error whose `name` is `'AbortError'`. | The screens show text as it arrives and treat aborts as silence. |
| `awake()` must be cheap and must not start anything. | Predictions ask only when awake; they must never wake (cost). |
| `maxTokens` is a hint: 300 for predictions, 1200 for scripts, Talk leaves it to the writer. | |
| With no writer, predictions return `[]`, the script desk hides the writer buttons (`awake` false) and Talk reports `No writer is plugged in yet.` | The walkthrough is complete without a model. |

Who uses it: `predictChoices` (awake-gated), `writeScript` / `rewriteScene` (not gated; the desk only shows them when awake), `Talk` (when no `onSend` prop is given; if not awake it calls `onWake` and shows `The writer is waking up with the studio. Try again in a couple of minutes.`).

---

## 8. Projects and characters

Reference: `src/walkthrough/projects.ts`. Browser `localStorage`, per studio.

| Key | Holds | Limit |
|---|---|---|
| `orbit:studio:{studioId}:projects` | `Project[]`, newest first | 200 (older ones fall off on save) |
| `orbit:studio:{studioId}:characters` | `Character[]`, newest first | 100 |

| Function | Rule |
|---|---|
| `listProjects(studio)` | Read; sort by `updatedAt` descending (string compare of ISO). Missing/broken storage → `[]`. |
| `saveProject(studio, p)` | `updatedAt = now`; remove any with the same id; prepend; cut to 200; write (quota errors swallowed); return the saved copy. |
| `removeProject(studio, id)` | Filter out. |
| `newProject(kind)` | `{ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, title: '', answers: {}, status: 'draft', items: [], createdAt: now, updatedAt: now }`. |
| `listCharacters(studio)` | Read. |
| `keepCharacter(studio, name, description)` | If any character has the same `description`, return the list unchanged; else prepend `{ id: 'c' + Date.now().toString(36), name, description, createdAt }`, cut to 100, write. |
| `whenOf(iso, now = Date.now())` | `d = (now − Date.parse(iso)) / 86 400 000` days: `< 1 → 'Today'`, `< 2 → 'Yesterday'`, `< 7 → '{floor(d)} days ago'`, else `toLocaleDateString(undefined, { month: 'short', day: 'numeric' })`. |

The app saves after every answer (see `docs/07-layout-and-navigation.md` §7).

---

## 9. Orb guide hooks

Reference: `src/walkthrough/orbGuide.ts`. Window `CustomEvent`s; the orb layer listens, the screens dispatch. The orb never talks on its own in a studio.

| Function | Event | `detail` | Contract |
|---|---|---|---|
| `orbNote(text, act?)` | `orb:note` | `{ text, act?: { label, id } }` or `null` | What the orb would say here, kept until tapped. `act` adds a button to its panel; pressing it dispatches `orb:act` with `detail = id`. `null` clears. |
| `orbThink(energy)` | `orb:energy` | `number 0..1` or `null` | The glow while busy for you; `null` to rest. Also used for the mic level in Talk. |
| `orbHome()` | `orb:home` | — | Bring the orb back beside what matters (after it was dragged or thrown). |
| `onOrbAct(handler)` | listens to `orb:act` | `string` id | Returns the unsubscribe. (Added in this package; Orbit inlined the listener.) |

Notes Orbit's brief screen (Make) sent, verbatim, by state:

| State | Note | Act |
|---|---|---|
| storyboard review | `Here is the storyboard: where each scene starts and ends. Tap any picture to draw it again, or film it as it is.` | `Film it` → `film` |
| making | the current progress note, or `Making it now.` | — |
| done | `Your {what} is ready. It is in your gallery too.` | — |
| error | `{project.error}` or `It stopped. Try again.` | `Try again` → `make` |
| draft | `Everything you picked, in one place. Tap “Make the {what}” when it looks right.` | `Make the {what}` → `make` |

And `orbThink(0.55)` while making (except in review); the script desk uses `0.7` while the writer works; predictions `0.7`.

---

## 10. Worked example: After Dark

The adult studio Orbit shipped, reproduced here as the complete reference of a StudioDef. It is **not** included in the package's code (the package's sample is `src/walkthrough/studios/example.ts`, a travel-postcard studio). Everything below is copied exactly.

### Header

| Field | Value |
|---|---|
| `id` | `afterdark` |
| `name` | `After Dark` |
| `mark` | `['After', 'Dark']` |
| `kicker` | `An Orbit studio · 18+` |
| `adult` | `true` |
| `theme.paper` | `#f1e6e3` |
| `theme.ink` | `#1f1320` |
| `theme.ink2` | `#634f5f` |
| `theme.accent` | `#7a2d68` |
| `theme.desk` | `#0e0a0e` |
| `theme.desk2` | `#1a121a` |
| `theme.orbA` | `#ffd0e6` |
| `theme.orbB` | `#6b2a5c` |
| `writer` | `You are the writer of After Dark, an adult studio for sensual and erotic pictures, videos and short films. Every character is a fictional adult aged 25 or older. Never involve minors or anyone young-looking, real or famous people, or anything without clear consent. Write vivid, tasteful, cinematic suggestions.` |
| `tail` | `fictional adults aged 25 or older, consenting, cinematic lighting, high detail` |
| `characters` | `Characters` |
| `makers` | `image: ['qwen-real', 'krea-real', 'qwen']`, `video: ['h3-max', 'ltx']`, `movie: 'h3-max'` |
| `rules` | `Fictional adults only, every one 25 or older` · `No real or famous people, and no photos of real people` · `Consent always` · `Nothing involving minors, ever` |

Talk starters:

| Label | Hint |
|---|---|
| Slow-burn tension | Glances, waiting, the long build-up |
| Strangers after midnight | A hotel bar, one more drink |
| Lovers reunited | Years apart, one night back |
| Something forbidden | A secret neither should keep |
| Playful and teasing | Light, flirty, a little wicked |
| Dark and intense | Power, rain, neon, no small talk |

Talk follow-ups:

| Label | Hint |
|---|---|
| Take it further | What happens next |
| Make it more intense | Turn the heat up |
| Give me three directions | Different ways it could go |
| Turn it into a scene | Who, where, the moment |
| Change the setting | Same story, somewhere new |

### Shared choice lists

**CAST**
| Label | Hint | adds | suits |
|---|---|---|---|
| A woman | One lead, all eyes on her | one adult woman | — |
| A man | One lead, all eyes on him | one adult man | — |
| A couple | A woman and a man | an adult couple, a woman and a man | strangers, lovers, wedding, reunit, affair, masquerade, couple, romantic |
| Two women | Two leads together | two adult women together | her muse, two women |
| Two men | Two leads together | two adult men together | — |

**LOOKS**
| Label | Hint |
|---|---|
| Late twenties, dark curls, freckles | Soft and natural |
| Thirties, sharp jaw, silver rings | Confident, a little dangerous |
| Athletic, sun-kissed, short hair | Outdoorsy and warm |
| Curvy, red lipstick, sleek bob | Old-Hollywood glamour |

**MOOD**
| Label | Hint | suits |
|---|---|---|
| Slow burn | Glances, tension, distance | strangers, cabin, snow, tension, slow |
| Playful | Laughter and warm light | game, masquerade, tease, play, flirt |
| Romantic | Close, tender, unhurried | reunit, lovers, wedding, years, tender |
| Intense | Shadows and heat | forbidden, secret, dark, neon, power |

**ROOM**
| Label | Hint | suits |
|---|---|---|
| Penthouse at night | City lights through glass | power, game, glossy, thirties |
| Velvet lounge | Low lamps, deep colour | intense, forbidden, secret, lipstick |
| Rainy hotel window | Reflections and neon | slow burn, strangers, midnight, rain, neon |
| Candlelit studio | Painterly and soft | romantic, muse, photographer, painting, freckles |
| Sunlit bedroom | White linen, morning light | playful, tender, sun-kissed, morning |

**WARDROBE**
| Label | Hint |
|---|---|
| Evening wear | Fully dressed, dressed up |
| Lingerie | Lace, silk, sheer |
| Implied nude | Sheets, shadows, strategic |
| Nude, artistic | Fine-art nude |

**FINISH**
| Label | Hint | adds | suits |
|---|---|---|---|
| Film noir | Black and white, hard light | film noir, black and white, hard light, deep shadows | rain, noir, 1950s, twist, dark, forbidden |
| Glossy editorial | Fashion-magazine polish | glossy fashion editorial photograph, studio polish | penthouse, photographer, muse, game, glamour |
| Candlelit painting | Oil, warm and grainy | oil painting look, warm candlelight, visible grain | candle, cabin, venice, palazzo, romantic |
| Super 8 memory | Faded, flickering | super 8 film, faded colours, soft flicker | reunion, reunit, years, letters, memory |
| Polaroid flash | Direct flash, instant film | polaroid, direct flash, instant film colours | playful, party, sunlit |

**SHAPE**
| Label | Hint |
|---|---|
| Portrait | Tall, for phones |
| Square | Even all round |
| Landscape | Wide, cinematic |

Helpers: `solo(a) = /alone|^a (woman|man)$/i.test(a.cast ?? '')`; `director(a) = a.cut === "Director's cut"`.

### Flow `image` — label `A picture`, hint `One frame, made in under a minute`

| # | id | kick | q | dek | key | choices | flags |
|---|---|---|---|---|---|---|---|
| 1 | cast | Chapter 01 · The cast | Who is *in it?* | Everyone here is a fictional adult. | Cast | CAST | — |
| 2 | looks | Chapter 02 · Their look | Describe *them.* | Face, hair, build. The more you say, the more it feels like them. | Appearance | LOOKS | — |
| 3 | mood | Chapter 03 · Mood | What is the *mood?* | This sets the pace and the light. | Mood | MOOD | — |
| 4 | room | Chapter 04 · The room | Where are *we?* | The place does half the work. | Setting | ROOM | — |
| 5 | wardrobe | Chapter 05 · Wardrobe | How *dressed?* | From evening wear to nothing at all. | Wardrobe | WARDROBE | — |
| 6 | moment | Chapter 06 · The moment | What are they *doing?* | — | Moment | Looking into the lens (A direct, knowing gaze) · An embrace (Close, skin to skin) · Getting ready (A mirror, a zip, a glance back) · Lying back, relaxed (Unhurried, at ease) | — |
| 7 | finish | Chapter · The look | How should it *look?* | The finish of every frame. | Look | FINISH | — |
| 8 | shape | Last · The frame | Which *shape?* | — | Shape | SHAPE | closed, predict false, meta |

### Flow `video` — label `A video`, hint `A few seconds, moving, with sound`

| # | id | kick | q | dek | key | choices | flags |
|---|---|---|---|---|---|---|---|
| 1 | cast | Chapter 01 · The cast | Who is *in it?* | Everyone here is a fictional adult. | Cast | CAST | — |
| 2 | looks | Chapter 02 · Their look | Describe *them.* | Face, hair, build. The more you say, the more it feels like them. | Appearance | LOOKS | — |
| 3 | mood | Chapter 03 · Mood | What is the *mood?* | This sets the pace and the light. | Mood | MOOD | — |
| 4 | room | Chapter 04 · The room | Where are *we?* | The place does half the work. | Setting | ROOM | — |
| 5 | wardrobe | Chapter 05 · Wardrobe | How *dressed?* | From evening wear to nothing at all. | Wardrobe | WARDROBE | — |
| 6 | action | Chapter 06 · The action | What *happens?* | — | Action | A slow dance (Swaying close) · A first kiss (The moment before, then it) · A slow undress (One piece at a time) · Turning to the camera (A look over the shoulder) | — |
| 7 | camera | Chapter 07 · Camera | How does the *camera* move? | — | Camera | Slow push-in (Drawing closer; adds `slow push-in camera move`) · Handheld, close (Intimate and alive; `handheld close-up camera`) · Circling them (A slow orbit; `camera slowly circling around them`) · Locked off (Still frame, they move; `static locked-off camera`) | — |
| 8 | sound | Chapter 08 · Sound | What do we *hear?* | — | Sound | Room tone and breath (Quiet and close; `sound: quiet room tone and soft breathing`) · Soft music (Slow, low strings; `sound: soft slow music`) · Whispered words (A line or two; `sound: whispered words`) · Rain outside (On the window; `sound: rain on the window`) | — |
| 9 | finish | Chapter · The look | How should it *look?* | The finish of every frame. | Look | FINISH | — |
| 10 | length | Last · Length | How *long?* | — | Length | 3 seconds (A glance) · 5 seconds (A moment) · 8 seconds (A whole beat) | closed, predict false, meta |
| 11 | vshape | Last · The frame | Which *shape?* | — | Shape | Landscape · Portrait · Square (SHAPE reordered) | closed, predict false, meta |

### Flow `movie` — label `A movie`, hint `Story, script, storyboard, film`

| # | id | kick | q | dek | key | choices | flags |
|---|---|---|---|---|---|---|---|
| 1 | cut | Opening · The cut | Quick film or *director’s cut?* | Quick asks five questions and drafts a three-scene script. Director’s cut builds every part with you: the people, the arc, the ending, the script and the storyboard. | Cut | Quick film (Five questions, about 15 seconds of film) · Director's cut (Characters, script and storyboard, up to 30 seconds) | best `Director's cut`, closed, predict false, meta |
| 2 | premise | Chapter 01 · The idea | What is the *story?* | One line is enough. Everything after builds on it. | Story | Strangers snowed in at a cabin (One fire, one bed) · Ex-lovers meet at a wedding (Unfinished business) · A photographer and her muse (The shoot runs late) · A masquerade in Venice (Masks on, rules off) · A forbidden affair at the office (After hours, blinds down) | — |
| 3 | tone | Chapter 02 · The tone | How should it *feel?* | The tone sets the pace, the light and how the script talks. | Tone | MOOD + Dark and dangerous (Secrets, power, a little fear; suits forbidden, office, secret, affair) | — |
| 4 | cast | Chapter 01 · The cast | Who is the *cast?* | Everyone here is a fictional adult. | Cast | CAST | — |
| 5 | lead | Chapter 04 · The lead | Describe the *lead.* | Face, hair, build. The more you say, the more it feels like them. | Lead | LOOKS | when director |
| 6 | motive | Chapter 05 · The want | What does the lead *want?* | A character who wants something is worth watching. This drives every scene. | Want | One night to forget (No names, no tomorrow; suits strangers, snowed, masquerade, forbidden) · To win the game (Control, then surrender; game, playful, office, masquerade) · To be truly seen (Undone by attention; photographer, muse, romantic) · To say what was never said (Old feelings, finally out; ex-lovers, wedding, reunit, years) | when director |
| 7 | partner | Chapter 06 · The partner | And the *other one?* | Face, hair, build. The more you say, the more it feels like them. | Partner | LOOKS | when director && !solo; best `Thirties, sharp jaw, silver rings` |
| 8 | world | Chapter 07 · The world | Where does it *happen?* | One place, so every scene feels like the same film. | Setting | Snowed-in cabin (Firelight, frost on the glass; suits cabin, snow) · Venetian palazzo (Candles, masks, old gold; venice, masquerade, mask) · Wedding hotel suite (Champagne and loose ties; wedding, ex-lovers) · Photo studio after hours (Backdrop paper, one hot light; photographer, muse, shoot) · Corner office at night (City below, blinds half down; office, affair, forbidden) · then ROOM | — |
| 9 | time | Chapter 08 · The hour | When is *it?* | — | Time | Late night, after the rain (Wet streets, neon; suits rain, intense, dark, office, penthouse) · Golden hour (Warm, low sun; playful, romantic, photographer, sunlit) · Snowed-in winter (Blue outside, gold inside; cabin, snow) · 1950s, jazz and smoke (A period piece; venice, palazzo, masquerade, velvet) | when director |
| 10 | beats | Chapter 09 · The arc | How does it *unfold?* | The shape of the story, start to finish. | Arc | Slow burn to a kiss (Tension, then release; suits slow burn, strangers, snowed, forget) · Argument turns to passion (Heat both ways; ex-lovers, intense, dark, never said) · A game of seduction (Who gives in first; game, playful, masquerade, win) · Tender reunion (Years apart, one night; romantic, reunit, wedding, seen) | when director && !solo; predict false |
| 11 | ending | Chapter 10 · The ending | How does it *end?* | We write towards this, so every scene leads here. | Ending | Together at dawn (Sunlight, sheets, a smile; suits romantic, tender, reunion, golden) · One last look, then gone (Bittersweet; strangers, forget, masquerade, snowed) · A twist (Nothing was what it seemed; dark, forbidden, game, office) · Left wanting more (Cut before the end; slow burn, playful) | when director; closed; predict false |
| 12 | scenes | Chapter 11 · Length | How many *scenes?* | Each scene is a five-second shot. | Scenes | 3 scenes (About 15 seconds) · 4 scenes (About 20 seconds) · 6 scenes (About 30 seconds, the whole arc) | when director; best `4 scenes`; closed; predict false; meta |
| 13 | script | Chapter 12 · The script | Here is the *script.* | Scene by scene: what we see, the moment it ends on and what is said. Change anything. | Script | (none) | kind `script`; closed; predict false; meta |
| 14 | mcamera | Chapter 13 · Camera | How is it *shot?* | — | Camera | Classic and slow (Long, patient takes; adds `slow classic camera work, long takes`; suits slow burn, romantic, reunion, 1950s) · Handheld and intimate (Close, breathing with them; `intimate handheld camera, close-ups`; intense, argument, dark, cabin) · Music-video gloss (Slow motion, glints; `glossy music-video style, slow motion`; playful, game, masquerade, penthouse) | when director |
| 15 | msound | Chapter 14 · Sound | What do we *hear?* | Their voices speak the lines in the script. | Sound | Their voices (The lines, spoken in the shots; suits argument, game, never said) · Music (A score under every scene; slow burn, romantic, masquerade, reunion) · Quiet (Only the room; dark) · You choose (The writer picks per scene) | when director; closed; predict false; meta |
| 16 | finish | Chapter 15 · The look | How should it *look?* | The finish of every frame. | Look | FINISH | — |
| 17 | review | Last · Storyboard | See the *storyboard* first? | One picture where each scene starts and ends. Redraw any of them before the film is made. | Storyboard | Yes, show me first (Approve before filming) · No, make it all (Straight to the film) | when director; closed; predict false; meta |

Note the script step (13) has no `when`: a Quick film also shows the script desk (three scenes drafted from the tone), while steps 5–7, 9–12, 14, 15 and 17 appear only in a Director's cut. A Quick film therefore asks: cut, premise, tone, cast, world, script, finish — the "five questions" of the dek plus the cut and the script.

---

## 11. Acceptance criteria and the unit tests

Each feature with its criteria, followed by the test from `orbit/tests/unit/studio-engine.test.ts` that pins it (these tests pass unchanged against `src/walkthrough/`; `fixed = () => 0` picks the first choice; `movie`/`image` are After Dark's flows).

### Order and progress

- The first unanswered step in flow order is asked; progress is `(answered + 1) of total`.

```ts
it('asks the questions in order, one at a time', () => {
  expect(nextStep(image, {})?.id).toBe('cast');
  const a = answer(image, {}, 'cast', 'A couple');
  expect(nextStep(image, a)?.id).toBe('looks');
  expect(progressOf(image, a)).toEqual({ n: 2, total: image.steps.length });
});
```

### Conditional steps

- A step with `when` exists only while `when(answers)` holds.

```ts
it('only asks the director questions in a director’s cut', () => {
  const quick = answer(movie, {}, 'cut', 'Quick film');
  const director = answer(movie, {}, 'cut', "Director's cut");
  expect(stepsFor(movie, quick).map((s) => s.id)).not.toContain('beats');
  expect(stepsFor(movie, director).map((s) => s.id)).toEqual(expect.arrayContaining(['lead', 'world', 'beats', 'scenes', 'review']));
});
```

### Dropping answers that no longer apply

- Changing an earlier answer removes answers to steps that vanished.

```ts
it('skips the partner for a solo cast and forgets answers that no longer apply', () => {
  let a = answer(movie, {}, 'cut', "Director's cut");
  a = answer(movie, a, 'cast', 'A couple');
  a = answer(movie, a, 'partner', 'Thirties, sharp jaw, silver rings');
  expect(a.partner).toBeDefined();
  a = answer(movie, a, 'cast', 'A woman');
  expect(a.partner).toBeUndefined();
  expect(stepsFor(movie, a).map((s) => s.id)).not.toContain('partner');
});
```

### Back

```ts
it('goes back one answer at a time', () => {
  let a = answer(image, {}, 'cast', 'A woman');
  a = answer(image, a, 'looks', 'Freckles');
  expect(back(image, a)).toEqual({ cast: 'A woman' });
  expect(back(image, {})).toEqual({});
});
```

### Finish it for me

- Fills every remaining step; keeps what was answered; the script step is `Approved`.

```ts
it('finishes the rest on request', () => {
  const done = finishAll(image, { cast: 'Two women' }, fixed);
  expect(nextStep(image, done)).toBeNull();
  expect(done.cast).toBe('Two women');
});
it('“Finish it for me” takes the script as drafted', () => {
  const a = finishAll(movie, { cut: 'Quick film' }, fixed);
  expect(a.script).toBe(SCRIPT_OK);
});
```

### Prompt and image job

- Prompt = `adds`/lower-cased labels of non-meta answers + tail; meta answers (shape) never appear; the first installed maker wins.

```ts
it('builds a prompt from the words, not the meta answers, and always adds the house rules', () => {
  const a = finishAll(image, { cast: 'A couple', shape: 'Landscape' }, fixed);
  const p = promptOf(AFTER_DARK, image, a);
  expect(p).toContain('an adult couple');
  expect(p).not.toContain('Landscape');
  expect(p.endsWith(AFTER_DARK.tail)).toBe(true);
  const job = jobOf(AFTER_DARK, 'image', a, ['krea-real']);
  expect(job.kind === 'image' && job.req.size).toBe('landscape');
  expect(job.kind === 'image' && job.req.maker).toBe('krea-real');
});
```

### Movie job

- Director's cut with 6 scenes → 30 s, sound mapped, review on by default; Quick film → 15 s, no review.

```ts
it('turns a director’s cut into a movie with a storyboard to approve', () => {
  let a = answer(movie, {}, 'cut', "Director's cut");
  a = finishAll(movie, { ...a, scenes: '6 scenes', msound: 'Music' }, fixed);
  const job = jobOf(AFTER_DARK, 'movie', a);
  expect(job.kind).toBe('movie');
  if (job.kind !== 'movie') return;
  expect(job.review).toBe(true);
  expect(job.draft.length).toBe(30);
  expect(job.draft.sound).toBe('music');
  expect(job.draft.idea).toContain('Story:');
  expect(briefOf(movie, a)[0]).toEqual({ key: 'Cut', value: "Director's cut" });
});
it('makes a quick film without a storyboard stop', () => {
  const a = finishAll(movie, { cut: 'Quick film' }, fixed);
  const job = jobOf(AFTER_DARK, 'movie', a);
  expect(job.kind === 'movie' && job.review).toBe(false);
  expect(job.kind === 'movie' && job.draft.length).toBe(15);
});
```

### Predicted choices

```ts
it('reads a JSON list out of a chatty reply', () => {
  const list = parseChoices('Sure! ```json\n[{"label":"Velvet booth","hint":"Low red light"},"A rooftop pool"]\n```');
  expect(list).toEqual([{ label: 'Velvet booth', hint: 'Low red light' }, { label: 'A rooftop pool', hint: undefined }]);
  expect(parseChoices('no list here')).toEqual([]);
});
it('puts the writer first and drops repeats', () => {
  const merged = mergeChoices([{ label: 'Playful' }, { label: 'New one' }], [{ label: 'playful' }, { label: 'Romantic' }]);
  expect(merged.map((c) => c.label)).toEqual(['Playful', 'New one', 'Romantic']);
});
```

Further criteria (not pinned by a test): no request when the writer is not awake; a 9 s timeout yields `[]`; identical `(studio, flow, step, answers)` never asks twice.

### The orb's pick

```ts
it('picks the answer that fits what was chosen before, and says why', () => {
  const a = { cut: "Director's cut", premise: 'Strangers snowed in at a cabin', tone: 'Slow burn', cast: 'A couple' };
  const world = movie.steps.find((s) => s.id === 'world')!;
  expect(recommend(movie, a, world)).toEqual({ label: 'Snowed-in cabin', why: 'It fits “cabin” in your story.' });
  const ending = movie.steps.find((s) => s.id === 'ending')!;
  expect(recommend(movie, a, ending)?.label).toBe('One last look, then gone');
});
it('falls back to the writer’s idea, then to the step’s best', () => {
  const scenes = movie.steps.find((s) => s.id === 'scenes')!;
  expect(recommend(movie, { cut: "Director's cut" }, scenes)?.label).toBe('4 scenes');
  const premise = movie.steps.find((s) => s.id === 'premise')!;
  const idea = { label: 'A heist that turns personal', hint: 'Partners in crime' };
  expect(recommend(movie, { cut: 'Quick film' }, premise, [idea, ...premise.choices], [idea])).toEqual({ label: idea.label, why: 'The writer’s idea: partners in crime.' });
});
```

### The writers' room

```ts
const director = { cut: "Director's cut", premise: 'Ex-lovers meet at a wedding', tone: 'Intense', cast: 'A couple', lead: 'Curvy, red lipstick, sleek bob', partner: 'Thirties, sharp jaw, silver rings', world: 'Wedding hotel suite', time: 'Late night, after the rain', beats: 'Argument turns to passion', ending: 'A twist', scenes: '4 scenes', msound: 'Their voices' };
it('names the cast the same way every time', () => {
  const cast = castOf(director);
  expect(cast).toHaveLength(2);
  expect(castOf(director)).toEqual(cast);
  expect(castOf({ cast: 'A woman' })).toHaveLength(1);
});
it('drafts one scene per shot, ending on the chosen ending', () => {
  const s = draftScript(director);
  expect(s).toHaveLength(4);
  expect(beatsFor(4)).toEqual([0, 2, 4, 5]);
  expect(s[0].heading).toBe('INT. WEDDING HOTEL SUITE — NIGHT');
  expect(s[0].action).toContain(castOf(director)[0].name);
  expect(s[3].says).toContain('Nothing personal');
  expect(draftScript({ ...director, msound: 'Music' })[0].says).toBe('');
  expect(draftScript({ cut: 'Quick film', premise: 'x', cast: 'A woman', tone: 'Playful' })).toHaveLength(3);
});
it('gives another take, and redrafts only when the story changes', () => {
  const s = draftScript(director);
  const t = anotherTake(director, s, 1);
  expect(t[1].action).not.toBe(s[1].action);
  expect(anotherTake(director, t, 1)[1].action).toBe(s[1].action);
  expect(scriptBasis({ ...director, mcamera: 'Classic and slow' })).toBe(scriptBasis(director));
  expect(scriptBasis({ ...director, ending: 'Together at dawn' })).not.toBe(scriptBasis(director));
});
it('reads a script out of a chatty reply', () => {
  const s = parseScenes('Here:\n[{"heading":"INT. CABIN — NIGHT","action":"Mara opens the door.","end":"Snow blows in.","says":""}]', 'H');
  expect(s).toEqual([{ id: 's1', heading: 'INT. CABIN — NIGHT', action: 'Mara opens the door.', end: 'Snow blows in.', says: '' }]);
});
it('films your script as written, with who is who at the first mention', () => {
  const a = { ...director, script: `4 scenes, ${SCRIPT_OK.toLowerCase()}`, mcamera: 'Classic and slow', finish: 'Film noir', review: 'Yes, show me first' };
  const script = draftScript(a);
  const job = jobOf(AFTER_DARK, 'movie', a, null, script);
  if (job.kind !== 'movie') throw new Error('not a movie');
  expect(job.draft.shots).toHaveLength(4);
  expect(job.draft.length).toBe(20);
  expect(job.draft.opening).toMatch(/^Establishing shot of the wedding hotel suite/);
  const [lead] = castOf(a);
  expect(job.draft.shots![0].prompt).toContain(`${lead.name} (curvy, red lipstick, sleek bob)`);
  expect(job.draft.lead).toEqual({ mode: 'ai', description: expect.stringContaining(lead.name) });
  expect(describeCast('No one here', castOf(a))).toBe('No one here');
});
```

### Shell-level criteria (from `docs/07-layout-and-navigation.md`, not covered by unit tests)

| Feature | Criteria |
|---|---|
| Trail revisit | Tapping an answered step drops that answer and every later one; the question is asked again with the same ready choices. |
| Auto-save | After every pick, own-words submit, revisit, Back and script change, `listProjects` returns the project with the new answers and a fresh `updatedAt`. |
| Save draft | Shows the toast `Saved. It is waiting in your projects.` and goes home; nothing is lost that was not already saved. |
| Characters | An answer to a step keyed `Appearance`, `Lead` or `Partner` is kept once per description, named `"{key} · {title or studio name}"`. |
| Script step | The desk shows "Drafting the script…" until `script.basis === scriptBasis(answers)`; approving stores `"{n} scenes, approved"`; "Pick for me" on this step approves. |
| Gate | An adult studio shows the gate until `orbit:studio:{id}:adult === '1'`; no bars or drawers are reachable before it. |
| Writer absent | Everything above works with `setWriter(null)`: no predictions, no writer buttons, the rule-based draft, Talk reporting there is no writer. |
