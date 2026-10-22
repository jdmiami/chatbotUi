# 07 · Layout and navigation

The screen model of an Orbit studio, as Orbit's `StudioApp.tsx` ran it. This document is the specification for the app shell that `src/components/Bars.tsx` (Root, TopBar, Stage, BottomBar) is set from; the decisions (what each button does per view) are written out here so a new app can re-implement them exactly.

## Contents

1. [The three bands](#1-the-three-bands)
2. [The View union and what each view shows](#2-views)
3. [Transitions](#3-transitions)
4. [One question at a time, and the trail](#4-one-question-at-a-time-and-the-trail)
5. [The bottom bar: Back, Home, Save draft](#5-the-bottom-bar)
6. [The top bar: masthead, Options, Gallery](#6-the-top-bar)
7. [Drafts save themselves](#7-drafts-save-themselves)
8. [The gate for adult studios](#8-the-gate)
9. [The gallery shelves](#9-the-gallery-shelves)
10. [The studio's look on `<html>`](#10-the-studios-look-on-html)
11. [iPhone and iPad behaviours](#11-iphone-and-ipad-behaviours)
12. [The orb on these screens](#12-the-orb-on-these-screens)
13. [State diagram](#13-state-diagram)

---

## 1. The three bands

```
┌──────────────────────────────────────────────┐  .st-root  position: fixed; inset: 0;
│ AN ORBIT STUDIO · 18+              [⚙] [≡]   │  .st-top   grid row 1 (auto)
│ After Dark                                   │
├──────────────────────────────────────────────┤
│                                              │  .st-stage grid row 2 (minmax(0,1fr)), overflow hidden
│   (the only part that moves)                 │    .st-view absolute inset 0
│                                              │      .st-scroll  the one column that scrolls
│                                              │
├──────────────────────────────────────────────┤
│   ← BACK          ⌂ HOME        ▣ SAVE DRAFT │  .st-bottom grid row 3 (auto), 3 equal columns
└──────────────────────────────────────────────┘
```

- `.st-root` is `display: grid; grid-template-rows: auto minmax(0, 1fr) auto`. It carries `data-view="{view}"`.
- **Top bar** (`.st-top`): a flex row, the masthead (`.st-flag`: `<small>` kicker, `<b>` roman half, `<i>` italic half in the accent) on the left and `.st-top-actions` (two 44 × 44 hairline squares `.st-sq`) on the right. Hidden actions on the gate. Padding includes `env(safe-area-inset-top/left/right)` plus the gutter.
- **Stage** (`.st-stage`): `position: relative; min-height: 0; overflow: hidden`. Each screen is a `.st-view` (`position: absolute; inset: 0`) so an exiting and an entering screen can overlap. Inside, `.st-scroll` is `height: 100%; overflow-y: auto; overscroll-behavior: contain`, with the side gutters; its children are centred at `max-width: var(--st-col)` (760 px). The gutter is `--st-gutter: clamp(18px, 6vw, 64px)`.
- **Bottom bar** (`.st-bottom`): three equal columns, hairline above, translucent (`color-mix(bg 80%)` + `backdrop-filter: blur(18px) saturate(1.3)`), padded for `env(safe-area-inset-bottom/left/right)`. Hidden on the gate. Buttons are 54 px tall, uppercase 11 px, 30 % opacity when disabled.
- Drawers (`.st-drawer-wrap`, `z-index: 60`) and toasts sit over everything; the orb cursor is mounted last inside `.st-root`.

Only the middle moves. The bars never animate between views.

---

## 2. Views

```ts
type View = 'gate' | 'home' | 'start' | 'walk' | 'make' | 'talk';
type Shelf = 'projects' | 'pictures' | 'videos' | 'movies' | 'characters';
```

| View | What is on the stage | Scroller |
|---|---|---|
| `gate` | `Gate` (adult studios only). Top-bar actions and the bottom bar are hidden. | wrapped in `.st-scroll` |
| `home` | `Home`: the contents page of projects. | wrapped |
| `start` | The "What shall we *make?*" page: kicker `Opening`, dek `Pick one. Every choice is a short walk, one question at a time.`, `Choices` of the four START items (`delay 0.2`), headline orb while `picked === null`. | wrapped |
| `walk` | `Walk` for the current step, or, when the flow has no question left (`nextStep` is null), the brief (`Make`). | `Walk` scrolls itself; the brief is wrapped |
| `make` | The brief / making / result (`Make` in Orbit; `Brief.tsx` pieces here). | wrapped |
| `talk` | `Talk`. | wrapped |

The four START choices and what they start:

| Label | Hint | Kind |
|---|---|---|
| Talk it through | Plan it with the writer first | `talk` → view `talk` |
| A picture | One frame, in under a minute | `image` |
| A video | A moving moment, with sound | `video` |
| A movie | Several scenes, cut together | `movie` |

Initial view: `'home'` unless `studio.adult`, in which case `localStorage.getItem('orbit:studio:{id}:adult') === '1' ? 'home' : 'gate'` (and `'gate'` when storage throws).

Derived values the shell keeps:

```ts
const flow = project ? studio.flows[project.kind] : null;
const step = view === 'walk' && flow && project ? nextStep(flow, project.answers) : null;
const stepKey = `${view}|${step?.id ?? ''}|${project?.id ?? ''}`;   // "where am I": effects key on it
const offered = step ? mergeChoices(predicted, step.choices) : [];
const rec = step && flow && project && step.kind !== 'script' ? recommend(flow, project.answers, step, offered, predicted) : null;
const canBack = view !== 'home' && view !== 'gate';
const canSave = (view === 'walk' || view === 'make') && project?.status === 'draft';
```

---

## 3. Transitions

The stage is one `AnimatePresence mode="wait" initial={false}` with a single `motion.div.st-view` keyed by

```ts
const screen = view === 'walk' && !walking ? 'make' : view;   // a walk with nothing left to ask looks like the brief
key = `${screen}|${project?.id ?? ''}`
```

`mode="wait"` means the old screen finishes leaving before the new one starts arriving: a keyed crossfade with a vertical drift and a blur. Full motion: enter from `{ opacity: 0, y: 28, filter: blur(14px) }` with `SPRING.smooth`; exit to `{ opacity: 0, y: -18, filter: blur(14px) }` with `{ ...SPRING.smooth, stiffness: 260 }` (a little quicker than the entrance). Lite/Off: opacity only, `transitionFor(level)`. Steps inside a walk do **not** change the stage key; the `Walk` animates its own section (`key={step.id}`) and the trail. See `docs/05-motion.md`.

Which view leads where:

| From | Action | To |
|---|---|---|
| gate | "I am 18 or older" | home (and the key is stored) |
| gate | "Take me back" | leaves the site (`history.back()` or `about:blank`) |
| home | Start something new | start |
| home | Talk with the writer | talk |
| home | a project row | walk if `status === 'draft'` and `nextStep` is not null, else make |
| start | A picture / A video / A movie | walk (a new project of that kind, saved at once) |
| start | Talk it through | talk |
| talk | Make it a picture / A video / A movie | walk (new project; for a movie the seed becomes `answers.premise`; for a picture or video the seed is not used as an answer) |
| walk | last answer given | make (`after()` sees `nextStep` null) |
| walk | "Finish it for me" | make |
| make | Make the … | stays on make (status `making`, then `done` or `error`) |
| any but home/gate | Home | home |
| gallery | a project row | closes the drawer, then as "a project row" above |

Going somewhere is just `setView(...)`; Orbit's `go(change)` wrapper exists only so every move passes one place.

---

## 4. One question at a time, and the trail

- The walk shows exactly one question: `nextStep(flow, answers)`, the first step (in flow order, among those whose `when` passes) with no answer yet.
- Above it, the **trail**: every answered step, in flow order, each a `st-trail-row` button labelled `"{key}: {answer}. Change it"`. Rows carry `data-depth` so the ones scrolling out of the middle sink and blur (`useScrollDepth`, mode `center`).
- **Tap to revisit** (`revisit(stepId)`): keep only the answers to steps that come *before* that step in the current order; everything from that step on is asked again.

  ```ts
  const order = stepsFor(flow, project.answers).map((s) => s.id);
  const cut = order.indexOf(stepId);
  keep({ ...project, answers: Object.fromEntries(Object.entries(project.answers).filter(([k]) => order.indexOf(k) < cut)) });
  ```

  So revisiting drops the tapped answer and all later ones (including a script approval), and the script is re-drafted only if its basis changed.
- **Picking** (`pick(label)`): ignored while a pick is in flight. Then `orbHome()`, `setPicked(label)`, wait `settle()` (`560 ms` full, `200 ms` lite, `0` off) for the other answers to leave, `setPicked(null)`, then `after(project, answer(flow, answers, step.id, label))`.
- **after(project, answers)**: (1) if `answers.script` is set and the project's script basis differs from `scriptBasis(answers)`, draft the script (`draftScript`) so "Finish it for me" past the script has one; (2) for every live step whose `key` is `Appearance`, `Lead` or `Partner` with a *new* answer, `keepCharacter(studio.id, "{key} · {title || studio.name}", answer)`; (3) `keep({ ...project, answers })` (save); (4) if `nextStep` is null, `setView('make')`.
- **Pick for me**: on a script step, approve it; otherwise `pick(pickFor(step, offered))` (a random one of what is on screen, writer's ideas included).
- **Finish it for me**: `after(project, finishAll(flow, answers))` — every remaining question answered with a random ready choice (the script taken as drafted), straight to the brief.
- **Own words**: the `st-own` form calls the same `pick(value)`; the value is stored verbatim and goes into the prompt as written.
- The script step: when `step.kind === 'script'`, the Walk's `desk` is `ScriptDesk`; `script` is passed only if `project.script.basis === scriptBasis(answers)` (else `undefined`, "Drafting the script…"), and an effect drafts it: `if (project.script?.basis !== basis) keep({ ...project, script: { basis, scenes: draftScript(answers), by: 'draft' } })`. Approving answers the step with `` `${scenes.length} scenes, approved` `` (`SCRIPT_OK` lower-cased).
- Titles: `titleOf(p)` is `answers.premise` for a movie, else `[answers.cast, answers.room].filter(Boolean).join(' · ')`; saved as `title` when non-empty.

---

## 5. The bottom bar

Copied logic (Orbit's `goBack`, `goHome`, `saveDraft`):

```ts
const goBack = () => {
  if (view === 'walk' && project && flow) {
    if (!Object.keys(project.answers).length) return void go(() => setView('start'));   // nothing answered: back to "What shall we make?"
    return void go(() => keep({ ...project, answers: backOne(flow, project.answers) }));  // forget the last answer
  }
  if (view === 'make' && project && flow && project.status === 'draft') {
    return void go(() => {
      keep({ ...project, answers: backOne(flow, project.answers) });   // reopen the last question
      setView('walk');
    });
  }
  if (view === 'start' || view === 'talk' || view === 'make') return void go(() => setView('home'));
};
const goHome = () => {
  if (view !== 'home' && view !== 'gate') void go(() => setView('home'));
};
const saveDraft = () => {
  if (project) keep(project);
  toast('Saved. It is waiting in your projects.', 'success');
  goHome();
};
```

Per view:

| View | Back | Home | Save draft |
|---|---|---|---|
| gate | bar hidden | bar hidden | bar hidden |
| home | disabled | disabled | disabled |
| start | → home | → home | disabled |
| walk, no answers yet | → start | → home | enabled (project is a draft): save, toast, → home |
| walk, some answers | forget the last answer (`back()`), stay on walk | → home | enabled: save, toast, → home |
| make, status draft | forget the last answer and → walk | → home | enabled |
| make, status making/done/error | → home | → home | disabled |
| talk | → home | → home | disabled (no project yet) |

`canBack = view !== 'home' && view !== 'gate'`; Home is disabled only on home; `canSave = (view === 'walk' || view === 'make') && project?.status === 'draft'`.

Note that `back()` from the engine forgets only the *last answered step in flow order*, which after `answer()` dropped stale answers is always the last question shown.

---

## 6. The top bar

- Masthead: `studio.kicker` small, then `studio.mark[0]` roman and `studio.mark[1]` italic in the accent colour. It is not a button.
- First square (`options` icon, `aria-label="Options"`): opens the Options drawer (house rules + one line about the orb).
- Second square (`menu` icon, `aria-label="Your gallery"`): opens the gallery drawer on the `projects` shelf.
- Both are hidden on the gate (`view !== 'gate'`).

---

## 7. Drafts save themselves

- A project exists from the moment a kind is chosen (`newProject(kind)` is saved at once in `startKind`).
- `keep(p)` is the one write path: `saveProject(studio.id, { ...p, title: titleOf(p) || p.title })`, then the in-memory `project` and the `projects` list are refreshed from storage. Every answer, every script change (`changeScript`), every revisit, every Back, and every status change of the making goes through it.
- So "Save draft" never saves anything new; it only confirms and leaves (toast + home).
- Storage: `localStorage['orbit:studio:{studio.id}:projects']`, newest first, at most 200 (`saveProject` slices). Characters: `orbit:studio:{studio.id}:characters`, at most 100, deduplicated by description. Both reads tolerate missing or broken storage (empty list) and writes swallow quota errors.
- Opening a project (`open(p)`): walk if it is a draft with a question left, otherwise the brief/result.

---

## 8. The gate

- Only when `studio.adult` is true. Key: `orbit:studio:{studio.id}:adult`, value `'1'`.
- The gate hides the top-bar actions and the whole bottom bar, so nothing can be reached around it.
- "I am 18 or older" writes the key (errors ignored: asked again next time) and goes home. "Take me back" goes to the previous page (`history.back()`) or, with no history, to `about:blank`.
- The rules shown on the gate are `studio.rules`; the same list appears in the Options drawer.

---

## 9. The gallery shelves

Drawer `aria-label="{studio.name}: your gallery"`, title `Your *gallery*`, tabs in order `Projects · Pictures · Videos · Movies · Characters` (icons `project picture video movie character`). Escape closes; the scrim's label is `Close the gallery`.

| Shelf | Source | Empty text |
|---|---|---|
| Projects | `projects` (same list as Home), rows numbered, meta `Picture / Video / Movie`; tap closes the drawer and opens the project | `No projects yet. Start one from Home.` |
| Pictures | the member's items where `kind === 'image'` and not part of a movie | `Nothing here yet.` |
| Videos | `kind === 'video'` and not part of a movie | `Nothing here yet.` |
| Movies | joined films | `Nothing here yet.` |
| Characters | `listCharacters(studio.id)` | `Characters you describe in a walkthrough are kept here, to cast again.` |

While items load: `Opening your gallery…`. If the item list cannot be fetched (Orbit: the machine was resting): `Your pictures and films show here while the studio is awake. Start something and it wakes up.` Items are fetched once when the drawer opens.

---

## 10. The studio's look on `<html>`

On mount (and whenever `studio` changes), Orbit set on `document.documentElement`:

| What | Value |
|---|---|
| `data-theme` | `'dark'` (the desk is always dark) |
| `data-skin` | `'o5'` |
| `data-studio` | `studio.id` (studio.css scopes `--st-gutter`/`--st-col` on `:root[data-studio]`) |
| `--st-paper`, `--st-ink`, `--st-ink2`, `--st-accent`, `--st-desk`, `--st-desk2` | from `studio.theme` |
| `--accent`, `--orb-a` | `theme.orbA` (on the dark page the accent is the orb's light tone) |
| `--orb-b` | `theme.orbB` |
| `document.title` | `studio.name` |

The display and text faces (Fraunces opsz + italic, Inter) were loaded lazily. See `docs/02-tokens.md` for the tokens and `src/styles/fonts.ts`.

---

## 11. iPhone and iPad behaviours

- **Visual viewport.** The shell runs `useVisualViewport()` (Orbit `src/hooks/useVisualViewport.ts`): on `visualViewport` resize/scroll, window resize, orientation change, focusin/focusout it writes `--app-height` (visible height), `--vv-offset-top` (how far iOS scrolled the visual viewport) and `--keyboard-inset` (≈ keyboard height) on `<html>`, and a `keyboardOpen` flag (keyboard > 150 px, or an editable focused on a coarse pointer with the visible height < 75 % of the layout height). On iPhone Safari 26+ it also reserves 76 px for the floating AutoFill bar above the keyboard. It also undoes iOS's scroll of `overflow: hidden` boxes when an input is focused (`scrollTop = 0` in a capturing `scroll` listener). Note that `.st-root` itself is `position: fixed; inset: 0` and is **not** sized to `--app-height` in `studio.css`; in Orbit the variables were consumed by the shell container (`.shell { height: var(--app-height); transform: translateY(var(--vv-offset-top)) }`) and by `.o5-spread { min-height: var(--app-height, 100dvh) }`. A new app that wants the studio pinned above the keyboard should give `.st-root` the same `height`/`transform` treatment.
- **Safe areas.** `.st-top` pads top/left/right, `.st-scroll` pads left/right, `.st-bottom` pads bottom/left/right, `.st-drawer` pads top/right/bottom, all with `env(safe-area-inset-*)`. Page bottoms leave room: `.st-sheet` ends at `safe-area-inset-bottom + 18vh`, `.st-now` at `+ 30vh`, so the question can sit mid-screen above the bar and the keyboard.
- **Square fields.** Inputs keep hairline square edges even where the base skin rounds them (`:root[data-skin='o5'] .st-root :is(input, textarea, select) { border-radius: 0 }`), and focus removes the ring (`outline: none; box-shadow: none`) in favour of the accent line.
- **Tap highlight.** `-webkit-tap-highlight-color: transparent` on every button.
- **Narrow screens** (`max-width: 560px`): the headline keeps 56 px of right padding for the orb; bottom-bar labels drop to 10 px.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the drawer slide, scrim fade, the predicting pulse and the busy bar sweep are turned off in CSS; the motion level handles the rest.
- **Scroll containment.** `.st-scroll` uses `overscroll-behavior: contain` so a flick never rubber-bands the whole page; `-webkit-overflow-scrolling: touch` for momentum.
- **Keyboard hints.** `enterkeyhint="next"` on the own-words box, `"send"` on Talk's box; `autocomplete="off"` everywhere.

---

## 12. The orb on these screens

The orb is a separate layer (`src/orb`); the shell talks to it only through `src/walkthrough/orbGuide.ts`:

- On every `stepKey` change the shell calls `orbHome()` at once and again after `650 ms` (full) / `120 ms` (otherwise), so a dragged orb comes back for the new question.
- What it would say (`orbNote`) per view, verbatim from Orbit:

| Where | Note | Panel button |
|---|---|---|
| gate | `This studio is for adults. Confirm and we’re in.` | — |
| start | `Pick what to make. A movie walks you through the story, the script and the storyboard.` | — |
| talk | `Pick a mood, or say your own. I’ll help shape it, then turn it into a picture, a video or a movie.` | — |
| home, with a draft | `Pick up “{draft.title || 'your draft'}”, or start something new.` | — |
| home, none | `Tap “Start something new” and I’ll walk you through it.` | — |
| walk, a question with a pick | `I’d go with “{rec.label}”. {rec.why}` | `Go with “{rec.label}”` → id `pick` |
| walk, the script step | `This draft follows your arc and your ending, one five-second shot per scene. Change any scene, or film it as it is.` | `This is the script` → id `approve-script` |
| make | see `docs/08-walkthrough-prd.md` §9 | `Make the {what}` / `Try again` / `Film it` |

- `orb:act` with `pick` runs `pick(rec.label)`; `approve-script` runs `approveScript`. On unmount `orbNote(null)`.
- `orbThink(0.7)` while predictions are being fetched; `null` after.
- Orbit also set `document.documentElement.dataset.orbContext` (a plain-language description of where the member is, used when the orb is tapped and asked) and routed the orb's own chat to the studio's writer. In this package that is the app's business: write the same context string if your orb can chat (`"You are the guide inside {studio.name}, a studio site; there are no Orbit apps or machines here, so never use "open", "setting" or "machine". {studio.writer} {where} Help them move forward: pick or type answers that match what they ask for, in as few steps as possible."`, with `{where}` either `The member is making {flow.label lower}. Answers so far: {k: v; …|none}. The question on screen: "{q without asterisks}". To answer it, click one of the listed answers, or type into "Or in your own words" and submit. "Pick for me" and "Finish it for me" are there too.` or `The member is on the {view} screen.`).

---

## 13. State diagram

```
                 [adult && no key]
   (load) ─────────────────────────────► GATE ──"18+"──► HOME
      │                                     │
      └──[else]────────────────────────────►│      "Take me back" → leaves the site
                                            ▼
   ┌───────────────────────────────────── HOME ◄────────────────────────── Home / Save draft (any view)
   │   "Start something new"               │ "Talk with the writer"          ▲
   │                                       ▼                                 │
   │                                     TALK ──"Make it a …"──┐              │
   ▼                                      ▲                    │              │
 START ──"Talk it through"────────────────┘                    │              │
   │ "A picture / A video / A movie"                           │              │
   ▼                                                           ▼              │
 WALK (project draft, step = nextStep) ◄──────────────── new project ─────────┘
   │  ▲   ▲
   │  │   └── Back (answers > 0): back() drops the last answer, stay
   │  └────── Back (answers = 0): → START
   │  pick / own words / Pick for me ─► answer() ─► keep() ─► nextStep? ──yes──► WALK (next question)
   │  trail tap ─► revisit(): drop that answer and all after it ─► WALK
   │  Finish it for me ─► finishAll() ─► keep()
   │                                       │ no question left
   ▼                                       ▼
 MAKE (draft) ──Back──► WALK (last answer dropped)
   │ "Make the …"
   ▼
 MAKE (making) ──done──► MAKE (done) ──Back/Home──► HOME
   │
   └──error──► MAKE (error) ──"Try again"──► MAKE (making)

 Overlays (any view but gate): Options drawer, Gallery drawer (projects → open a project → WALK or MAKE).
```

Invariants:

1. At most one question is on screen; the trail holds only answers to steps that still apply.
2. Every change to answers or script is saved before the screen moves on.
3. The stage is the only animated region; a stage key change always waits for the exit.
4. The orb is told where to be and what it may say on every `stepKey` change, and is brought home.
