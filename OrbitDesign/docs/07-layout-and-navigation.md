# 07 · Layout and navigation

The screen model, as the example app (`example/src/App.tsx`) implements it on the frame in `src/components/Bars.tsx` (`Root`, `TopBar`, `Stage`, `BottomBar`). The components give the three bands and the crossfade; the decisions (which view shows what, what each button does, when a run is saved, where the orb goes) are the app's, and they are written out here with the code so a new app can make the same ones. The component props and DOM are in `docs/06-components.md`; the motion in `docs/05-motion.md`; the orb in `docs/09-orb.md`.

## Contents

1. [The three bands](#1-the-three-bands)
2. [The views](#2-the-views)
3. [The stage crossfade](#3-the-stage-crossfade)
4. [One question at a time, and the trail](#4-one-question-at-a-time-and-the-trail)
5. [The bottom bar: Back, Home, Save draft](#5-the-bottom-bar)
6. [The top bar](#6-the-top-bar)
7. [Runs save themselves](#7-runs-save-themselves)
8. [A gate as an optional first screen](#8-a-gate-as-an-optional-first-screen)
9. [The drawers](#9-the-drawers)
10. [The theme on `<html>`](#10-the-theme-on-html)
11. [Phones and tablets](#11-phones-and-tablets)
12. [The orb on these screens](#12-the-orb-on-these-screens)
13. [State diagram](#13-state-diagram)

---

## 1. The three bands

```
┌──────────────────────────────────────────────┐  .st-root   position: fixed; inset: 0; grid
│ A SAMPLE GUIDE                     [⚙] [≡]   │  .st-top    grid row 1 (auto)
│ Com pass                                     │
├──────────────────────────────────────────────┤
│                                              │  .st-stage  grid row 2 (minmax(0, 1fr)), overflow hidden
│   (the only part that moves)                 │    .st-view   absolute inset 0, one per screen
│                                              │      .st-scroll  the one column that scrolls
│                                              │
├──────────────────────────────────────────────┤
│   ← BACK          ⌂ HOME        ▣ SAVE DRAFT │  .st-bottom grid row 3 (auto), 3 equal columns
└──────────────────────────────────────────────┘
```

- `.st-root` is `display: grid; grid-template-rows: auto minmax(0, 1fr) auto` and carries `data-view="{view}"`.
- **Top bar** (`.st-top`): a flex row; the masthead (`.st-flag`: `<small>` kicker, `<b>` roman half, `<i>` italic half in the accent) on the left and `.st-top-actions` (two 44 × 44 hairline squares, `.st-sq`) on the right. Padding includes `env(safe-area-inset-top/left/right)` plus the gutter `--st-gutter: clamp(18px, 6vw, 64px)`.
- **Stage** (`.st-stage`): `position: relative; min-height: 0; overflow: hidden`. Each screen is a `.st-view` (`position: absolute; inset: 0`) so a leaving and an arriving screen can overlap. Inside, `.st-scroll` is `height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain`, padded with the gutter and the side safe areas; its children are centred at `max-width: var(--st-col)` (760 px).
- **Bottom bar** (`.st-bottom`): three equal columns, hairline above, translucent (`color-mix(in srgb, var(--bg) 80%, transparent)` + `backdrop-filter: blur(18px) saturate(1.3)`), padded for `env(safe-area-inset-bottom/left/right)`. Buttons are 54 px tall, uppercase 11 px, 30 % opacity when disabled.
- Drawers (`.st-drawer-wrap`, `z-index: 60`) and toasts (`.toasts`, `z-index: 90`) sit over everything inside `.st-root`; the orb (`<OrbCursor/>`) is mounted after the app, outside `.st-root` (`example/src/main.tsx`).

**Only the stage moves.** The bars never animate between views; they change only their enabled states.

---

## 2. The views

```ts
type View = 'contents' | 'start' | 'walk' | 'summary' | 'talk';
```

| View | What is on the stage | Scroller |
|---|---|---|
| `contents` | `Contents`: the welcome, "Start something new", "Talk it through", then every run as a numbered row. | wrapped in `.st-scroll` |
| `start` | A `Page` (`id="st-start-t"`, kick `Opening`, title `What shall we *plan?*`, dek `Pick one. Every choice is a short walk, one question at a time.`, headline orb while `picked === null`) with `Choices` of `START` (`delay 0.2`). | wrapped |
| `walk` | `Walk` for the current step (`nextStep`), with the custom body when `step.custom === 'notes'`. When the flow has no question left the summary is shown instead (below). | `Walk` scrolls itself |
| `summary` | The summary: `SummaryList` and `Go "Save the plan"` while the run is a draft; `Progress` while saving; `Result` once done. | wrapped |
| `talk` | `Conversation` with the guide's `starters` and `followUps`, two actions that start a flow from what was said, and (in the sample) a canned `onSend`. | wrapped |

The `START` list is the conversation first, then one answer per flow:

```ts
const TALK = 'Talk it through';
const START: Choice[] = [{ label: TALK, hint: 'Plan it in conversation first' }, ...flows.map((f) => ({ label: f.label, hint: f.hint }))];
```

The initial view is `'contents'` (`useState<View>('contents')`). Derived values the app keeps:

```ts
  const flow = run ? guide.flows[run.flowId] : null;
  const step = view === 'walk' && flow && run ? nextStep(flow, run.answers) : null;
  const stepKey = `${view}|${step?.id ?? ''}|${run?.id ?? ''}`;
```

```ts
  const offered = step ? mergeChoices(suggested, step.choices) : [];
  const rec = step && flow && run && !step.custom ? recommend(flow, run.answers, step, offered, suggested) : null;
```

```ts
  const canBack = view !== 'contents';
  const canSave = (view === 'walk' || view === 'summary') && run?.status === 'draft' && !saving;
```

`stepKey` is "where am I": every effect that follows the person (suggestions, the orb's note, bringing the orb home, the orb context) keys on it.

The summary body is rendered for `view === 'summary'`, and also for a `walk` view that has no step left (`(view === 'summary' || view === 'walk') && run && flow`), so a run can never show an empty stage:

```tsx
  } else if ((view === 'summary' || view === 'walk') && run && flow) {
    const done = run.status === 'done' && result;
```

Suggestions are asked for on every `stepKey` change, only while an assistant is set and awake (otherwise the ready answers stand alone):

```ts
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

---

## 3. The stage crossfade

The stage is one `AnimatePresence mode="wait" initial={false}` with a single `motion.div.st-view` keyed by `screenKey` (`src/components/Bars.tsx`):

```tsx
    <main className="st-stage" id="st-stage">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={screenKey}
          className="st-view"
          initial={full ? { opacity: 0, y: 28, filter: 'blur(14px)' } : { opacity: 0 }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? SPRING.smooth : transitionFor(level) }}
          exit={full ? { opacity: 0, y: -18, filter: 'blur(14px)', transition: { ...SPRING.smooth, stiffness: 260 } } : { opacity: 0, transition: transitionFor(level) }}
        >
          {walking ? children : <div className="st-scroll">{children}</div>}
        </motion.div>
      </AnimatePresence>
    </main>
```

`mode="wait"` means the old screen finishes leaving before the new one starts arriving: a keyed crossfade with a vertical drift and a blur, the exit a little quicker than the entrance (`stiffness: 260`). Lite/off: opacity only. `initial={false}` means the first screen does not animate in. See `docs/05-motion.md` §12.3.

**The `screenKey` rule.** The key is the screen and the run, not the step:

```ts
  const screen = view === 'walk' && !walking ? 'summary' : view;
```

```tsx
      <Stage screenKey={`${screen}|${run?.id ?? ''}`} walking={walking}>
```

- A `walk` view with nothing left to ask looks like, and is keyed as, the summary, so moving from the last answer to the summary does not crossfade twice.
- Steps inside a walk do **not** change the stage key: the `Walk` animates its own section (`key={step.id}`) and the trail, and the answer flies up within one scroller.
- Opening a different run changes the key even when the view stays the same (two walks crossfade).
- `walking` is `true` only when a `Walk` is rendered (`view === 'walk' && step && run && flow`).

Which view leads where:

| From | Action | To |
|---|---|---|
| contents | Start something new | start |
| contents | Talk it through | talk |
| contents | a run's row (`open`) | walk if `status === 'draft'` and `nextStep` is not null, else summary |
| start | a flow's label | walk (a new run of that flow, saved at once) |
| start | Talk it through | talk |
| talk | an action ("Plan a trip from this", "Just an evening") | walk (a new run; the seed becomes the first draft of the notes) |
| walk | last answer given | summary (`after()` sees `nextStep` null) |
| walk | Finish it for me | summary |
| summary | Save the plan | stays on summary (`saving`, then `status === 'done'`) |
| any but contents | Home | contents |
| gallery drawer | a draft's row | closes the drawer, then as `open` above |

Going somewhere is just `setView(...)`.

---

## 4. One question at a time, and the trail

- The walk shows exactly one question: `nextStep(flow, answers)`, the first step in flow order, among those whose `when` passes, with no answer yet.
- Above it, the **trail**: every answered step in flow order, each a `st-trail-row` button labelled `"{key}: {answer}. Change it"`. Rows carry `data-depth` so the ones scrolling out of the middle sink and blur (`useScrollDepth(scroller, true, 'center')`; `docs/05-motion.md` §9).
- **Tap to revisit** (`revisit(stepId)`): keep only the answers to steps that come *before* the tapped step in the current order; everything from that step on is asked again.

```ts
  const revisit = (stepId: string) => {
    if (!run || !flow) return;
    const order = stepsFor(flow, run.answers).map((s) => s.id);
    const cut = order.indexOf(stepId);
    keep({ ...run, answers: Object.fromEntries(Object.entries(run.answers).filter(([k]) => order.indexOf(k) < cut)) });
  };
```

  So revisiting drops the tapped answer **and every later one**. The view stays `walk`; `nextStep` now returns the tapped step, and the trail shortens to the answers before it.

- **Picking** (`pick(label)`): ignored while a pick is in flight. Then `orbHome()`, `setPicked(label)`, wait `settle()` for the other answers to leave, `setPicked(null)`, then answer and move on. On the start screen the same function starts a flow or opens the conversation:

```ts
  const settle = () => wait(full ? 560 : level === 'lite' ? 200 : 0);
```

```ts
  const pick = async (label: string) => {
    if (picked !== null) return;
    orbHome();
    if (view === 'start') {
      setPicked(label);
      await settle();
      setPicked(null);
      if (label === TALK) return setView('talk');
      const f = flows.find((x) => x.label === label);
      return f && startFlow(f.id);
    }
    if (!run || !flow || !step) return;
    setPicked(label);
    await settle();
    setPicked(null);
    after(run, answer(flow, run.answers, step.id, label));
  };
```

- **after(run, answers)**: save, then go to the summary when nothing is left to ask.

```ts
  const after = (r: Run, answers: Answers) => {
    const f = guide.flows[r.flowId];
    const saved = keep({ ...r, answers });
    if (!nextStep(f, answers)) setView('summary');
    return saved;
  };
```

- **Own words**: the `st-own` form in `Walk` calls the same `onPick(value)`; the value is stored verbatim and `valueOf` passes it through unchanged into the result.
- **Pick for me**: on a custom step, answer it as done; otherwise `pick(pickFor(step, offered))`, a random one of what is on screen, suggestions included. **Finish it for me**: `finishAll` answers every remaining question with a random ready answer (a custom step with `CUSTOM_DONE`), straight to the summary.

```ts
  const pickForMe = () => (step?.custom ? takeNotes('') : step && void pick(pickFor(step, offered)));
  const finishForMe = () => run && flow && after(run, finishAll(flow, run.answers));
```

- **The custom step.** A step with `custom` has no ready answers; the app renders its own body in the `Walk`'s `custom` slot and answers with its own value. The sample's `'notes'` step is a text box; an empty box answers `CUSTOM_DONE` (`'Done'`), which is how it reads in the trail:

```ts
  const takeNotes = (text: string) => {
    if (!run || !flow || !step?.custom) return;
    orbHome();
    setNotes('');
    after(run, answer(flow, run.answers, step.id, text.trim() || CUSTOM_DONE));
  };
```

- **Titles.** A run's title is set on every save from its answers: the first two answers that are part of the result, joined with ` · `.

```ts
const titleOf = (r: Run) => {
  const f = guide.flows[r.flowId];
  return f
    ? stepsFor(f, r.answers)
        .filter((s) => !s.meta && !s.custom && r.answers[s.id])
        .slice(0, 2)
        .map((s) => r.answers[s.id])
        .join(' · ')
    : '';
};
```

---

## 5. The bottom bar

The three handlers, verbatim from the example:

```ts
  const goBack = () => {
    if (view === 'walk' && run && flow) {
      if (!Object.keys(run.answers).length) return setView('start');
      return keep({ ...run, answers: backOne(flow, run.answers) });
    }
    if (view === 'summary' && run && flow && run.status === 'draft') {
      keep({ ...run, answers: backOne(flow, run.answers) });
      return setView('walk');
    }
    if (view === 'start' || view === 'talk' || view === 'summary') setView('contents');
  };
  const goHome = () => view !== 'contents' && setView('contents');
  const saveDraft = () => {
    if (run) keep(run);
    toast('Saved. It is waiting in your drafts.', 'success');
    goHome();
  };
```

(`backOne` is the engine's `back`, imported as `back as backOne`: it forgets the *last answered step in flow order*, which, because `answer()` drops answers to steps that no longer apply, is always the last question shown.)

Enabled states: `canBack = view !== 'contents'`; Home is `view !== 'contents'`; `canSave = (view === 'walk' || view === 'summary') && run?.status === 'draft' && !saving`.

Per view:

| View | Back | Home | Save draft |
|---|---|---|---|
| contents | disabled | disabled | disabled |
| start | → contents | → contents | disabled |
| walk, no answers yet | → start | → contents | enabled (the run is a draft): save, toast, → contents |
| walk, some answers | forget the last answer (`backOne`), stay on walk | → contents | enabled: save, toast, → contents |
| summary, draft, not saving | forget the last answer and → walk (the last question opens again) | → contents | enabled |
| summary, saving | as above (Back is not blocked by `saving`) | → contents | disabled (`!saving`) |
| summary, done | → contents | → contents | disabled (status is `done`) |
| talk | → contents | → contents | disabled (no run on this view) |

"Save draft" never saves anything new (§7); it confirms and leaves.

---

## 6. The top bar

```tsx
      <TopBar kicker={guide.kicker} mark={guide.mark} onOptions={() => setOptions(true)} onGallery={() => setTab('drafts')} />
```

- Masthead: `guide.kicker` small, then `guide.mark[0]` roman and `guide.mark[1]` italic in the accent. It is not a button.
- First square (`options` icon, `aria-label="Options"`): opens the options drawer (house rules and one line about the orb).
- Second square (`menu` icon, `aria-label="Your gallery"`): opens the gallery drawer on the `drafts` tab.
- The example shows both on every view. An app with a gate passes `actions={false}` there (§8).

---

## 7. Runs save themselves

A run exists from the moment a flow is chosen, and every answer saves it; "Save draft" is only ever a way out, never a chore.

- `keep(r)` is the one write path: it saves, refreshes the in-memory run and the list from storage, and returns the saved copy. Every answer, every revisit, every Back, every custom step, every status change goes through it.

```ts
  const keep = useCallback((r: Run) => {
    const saved = saveRun(guide.id, { ...r, title: titleOf(r) || r.title });
    setRun(saved);
    setRuns(listRuns(guide.id));
    return saved;
  }, []);
```

- Starting a flow saves an empty run at once (`newRun(flowId)`); a `seed` from the conversation is kept as the first draft of the notes:

```ts
  const startFlow = (flowId: string, seed = '') => {
    setNotes(seed);
    setResult(null);
    setRun(keep(newRun(flowId)));
    setView('walk');
  };
```

- Opening a run goes to the walk if it is a draft with a question left, otherwise to the summary:

```ts
  const open = (r: Run) => {
    setRun(r);
    setResult(typeof r.result === 'string' ? r.result : null);
    setView(r.status === 'draft' && nextStep(guide.flows[r.flowId], r.answers) ? 'walk' : 'summary');
  };
```

- Storage (`src/flow/runs.ts`): one key per guide in `localStorage`, newest first, at most 200.

```ts
const key = (guide: string) => `orbit:guide:${guide}:runs`;
```

```ts
/** Every run of this guide, newest first. Missing or broken storage gives []. */
export function listRuns(guideId: string): Run[] {
  return read(key(guideId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Keep a run (replacing one with the same id); at most 200 are kept. Returns the saved copy. */
export function saveRun(guideId: string, r: Run): Run {
  const now = { ...r, updatedAt: new Date().toISOString() };
  const rest = read(key(guideId)).filter((x) => x.id !== r.id);
  write(key(guideId), [now, ...rest].slice(0, 200));
  return now;
}
```

  Reads tolerate missing or broken storage (an empty list); writes swallow quota and private-mode errors, so the session still works, it just is not remembered. `removeRun(guideId, id)` deletes one. An app with accounts can move runs to its own storage; the functions are the contract.

- The list on the contents page and in the drafts tab is `runs` (`listRuns(guide.id)`, refreshed by `keep`). The "Made" tab is `runs.filter((r) => typeof r.result === 'string')`.

---

## 8. A gate as an optional first screen

The example has no gate; the `Gate` component (`docs/06-components.md` §8) is there for an app that must ask one yes/no before anything else (house rules, an age check, terms). How an app gates:

1. Add `'gate'` to its `View` union and start there when nothing is remembered.
2. Render `<TopBar actions={false} …/>` and no `<BottomBar/>` on that view, so nothing can be reached around it.
3. On yes, remember it and go to `contents`; on no, leave (`history.back()` when there is history, else `location.href = 'about:blank'`).
4. Show `guide.rules` on the gate; the same list appears in the options drawer.

The storage pattern, in the shape of `src/flow/runs.ts` (a sketch, not copied from a file):

```ts
const GATE = `orbit:guide:${guide.id}:agreed`;
const agreed = () => {
  try {
    return localStorage.getItem(GATE) === '1';
  } catch {
    return false;
  }
};
const [view, setView] = useState<View>(() => (agreed() ? 'contents' : 'gate'));
const agree = async (yes: boolean) => {
  setPicked(yes ? YES.label : NO.label);
  await settle();
  setPicked(null);
  if (!yes) return history.length > 1 ? history.back() : (location.href = 'about:blank');
  try {
    localStorage.setItem(GATE, '1');
  } catch {
    /* asked again next time */
  }
  setView('contents');
};
```

The orb waits beside the gate's headline until a choice is made (`orb={picked === null}`), then sits on the chosen answer.

---

## 9. The drawers

Both drawers are conditional renders over the frame, closed by Escape, the scrim or the close button (`docs/06-components.md` §14).

**The gallery** (`tab !== null`): `label` `"{guide.name}: your gallery"`, title `Your <em>gallery</em>`, `tabs={TABS}`; the top bar opens it on `drafts`.

| Tab (`TABS`) | Icon | Content | Empty text |
|---|---|---|---|
| `drafts` "Drafts" | `folder` | `ContentsList` of `runs`: title `r.title \|\| 'Untitled'`, meta the flow's label; tapping a row closes the drawer and calls `open(r)` | `No drafts yet. Start one from the contents page.` |
| `items` "Made" | `picture` | `MediaGrid` of the runs whose `result` is a string (`kind: 'image'`, `alt: r.title`) | `Nothing made yet. Finish a plan and save it.` |
| `about` "About" | `options` | `<ul class="st-rules">` of `guide.rules`, then a `st-dek` line about the sample | — |

**The options drawer** (`options === true`): `<OptionsDrawer rules={guide.rules ?? []} onClose={() => setOptions(false)} />`, title `House <em>rules</em>`, the rules, then `Tap the orb any time to ask it something, or hold it to talk.`

The orb hides while either is open (they are `aria-modal="true"`).

---

## 10. The theme on `<html>`

The document starts with the attributes already set, so the first paint is in the right skin (`example/index.html`):

```html
<html lang="en" data-theme="dark" data-skin="o5" data-guide="compass">
```

On mount the app writes the same attributes and the guide's colours (the exact effect from the example):

```ts
  // The guide's colours on <html> (docs/02-tokens.md, "The guide's theme").
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    root.dataset.skin = 'o5';
    root.dataset.guide = guide.id;
    const t = guide.theme;
    const vars: Record<string, string> = { '--st-paper': t.paper, '--st-ink': t.ink, '--st-ink2': t.ink2, '--st-accent': t.accent, '--st-desk': t.desk, '--st-desk2': t.desk2, '--accent': t.orbA, '--orb-a': t.orbA, '--orb-b': t.orbB };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    document.title = guide.name;
  }, []);
```

| What | Value |
|---|---|
| `data-theme` | `'dark'` (the desk is always dark) |
| `data-skin` | `'o5'` (the magazine skin) |
| `data-guide` | `guide.id` (`pages.css` scopes `--st-gutter`/`--st-col` on `:root[data-guide]`) |
| `--st-paper`, `--st-ink`, `--st-ink2`, `--st-accent`, `--st-desk`, `--st-desk2` | from `guide.theme` |
| `--accent`, `--orb-a` | `theme.orbA` (on the dark page the accent is the orb's light tone) |
| `--orb-b` | `theme.orbB` |
| `document.title` | `guide.name` |

`data-motion` is written by `MotionProvider` (`docs/05-motion.md` §3.4). The fonts are loaded by `loadFonts()` in `main.tsx`. See `docs/02-tokens.md` §14 and §15.

---

## 11. Phones and tablets

Phones and tablets are the first target; everything is checked at 390 × 844 and 768 × 1024.

- **The visual viewport.** The app calls `useVisualViewport()` once (`docs/06-components.md` §16). It writes `--app-height`, `--vv-offset-top` and `--keyboard-inset` on `<html>` and computes `keyboardOpen`: the keyboard counts as open when the visual viewport is more than **150 px** shorter than the layout viewport, or when an editable element is focused on a coarse pointer and the visible height is under 75 % of the layout height. On phones whose browser floats a bar above the keyboard it reserves `FLOATING_BAR` (76 px). The **unshift rule** puts back any `overflow: hidden` box the browser scrolled to reveal a focused input (`scrollTop = 0` in a capturing `scroll` listener). `pages.css` does not consume the variables: `.st-root` is `position: fixed; inset: 0`. An app that wants the frame pinned above the keyboard adds `.st-root { height: var(--app-height); transform: translateY(var(--vv-offset-top)); }` itself.
- **The viewport meta** (`example/index.html`): `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`, so the safe areas are available and the keyboard resizes the layout where the browser honours it.
- **Safe areas.** `.st-top` pads top/left/right, `.st-scroll` pads left/right, `.st-bottom` pads bottom/left/right, `.st-drawer` pads top/right/bottom, all with `env(safe-area-inset-*)`. Page bottoms leave room: `.st-sheet` ends at `safe-area-inset-bottom + 18vh`, `.st-now` at `+ 30vh`, so the question can sit mid-screen above the bar and the keyboard. See `docs/02-tokens.md` §5.
- **44 px targets.** The square buttons are 44 × 44; the bottom-bar buttons 54 px tall; the own-words, shortcut and ghost buttons `min-height: 44px`; answers `min-height: 68px`; rows `72px`; the Go button 52 px.
- **Square fields.** Inputs keep hairline square edges even where the base skin rounds them (`:root[data-skin='o5'] .st-root :is(input, textarea, select):not([type='range']):not([type='checkbox']) { border-radius: 0 }`), and focus removes the ring (`outline: none; box-shadow: none`) in favour of the accent underline.
- **Tap highlight.** `-webkit-tap-highlight-color: transparent` on every button in `.st-root`.
- **Narrow screens** (`max-width: 560px`): the headline keeps 56 px of right padding for the orb; bottom-bar labels drop to 10 px.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the drawer slide, scrim fade, the suggesting pulse and the busy bar sweep are turned off in CSS; the motion level handles the rest.
- **Scroll containment.** `.st-scroll` uses `overscroll-behavior: contain` so a flick never rubber-bands the whole page, with `-webkit-overflow-scrolling: touch` for momentum.
- **Keyboard hints.** `enterkeyhint="next"` on the own-words box, `"send"` on the conversation's box; `autocomplete="off"` on both.

---

## 12. The orb on these screens

The orb is a separate layer (`src/orb`, mounted once with `<OrbCursor brain={null} />` in `main.tsx`); the app talks to it only through `orbNote`, `orbThink`, `orbHome` and `onOrbAct` from `src/flow` (`docs/09-orb.md` §12 to §14).

- On every `stepKey` change the app calls `orbHome()` at once and again after `650 ms` (full) / `120 ms` (otherwise), so a dragged orb comes back for the new question:

```ts
  useEffect(() => {
    orbHome();
    const t = setTimeout(orbHome, full ? 650 : 120);
    return () => clearTimeout(t);
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

- What it would say (`orbNote`), kept until tapped, verbatim from the example:

```ts
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

```ts
  // The summary screen's note for the orb.
  useEffect(() => {
    if (view !== 'summary' || !run) return;
    if (saving) orbNote(note ?? 'Putting it together.');
    else if (run.status === 'done') orbNote('Your plan is ready. It is in your drafts too.');
    else orbNote('Everything you picked, in one place. Tap “Save the plan” when it looks right.', { label: 'Save the plan', id: 'save' });
  }, [view, run?.status, saving, note]); // eslint-disable-line react-hooks/exhaustive-deps
```

| Where | Note | Panel button → `orb:act` id |
|---|---|---|
| contents, with drafts | `Pick a draft up, or start something new.` | — |
| contents, none | `Tap “Start something new” and I’ll walk you through it.` | — |
| start | `Pick what to plan. Each one is a short walk, one question at a time.` | — |
| talk | `Pick a way to start, or say your own.` | — |
| walk, a question with a pick | `I’d go with “{rec.label}”. {rec.why}` | `Go with “{rec.label}”` → `pick` |
| walk, the custom step | `Write anything the plan should remember, or go on without.` | `Go on without notes` → `skip-notes` |
| summary, draft | `Everything you picked, in one place. Tap “Save the plan” when it looks right.` | `Save the plan` → `save` |
| summary, saving | the current progress note, or `Putting it together.` | — |
| summary, done | `Your plan is ready. It is in your drafts too.` | — |

- The panel's buttons come back as `orb:act`; the app maps the ids to its handlers through a ref so the listener is set once:

```ts
  const acts = useRef<Record<string, () => void>>({});
  acts.current = { pick: () => rec && void pick(rec.label), 'skip-notes': () => takeNotes(''), save: () => void save() };
  useEffect(() => onOrbAct((id) => acts.current[id]?.()), []);
```

- The glow: `orbThink(0.7)` while suggestions are being fetched, `null` after; `orbThink(0.55)` while the summary is being saved, `null` when it is done (`save()`). `Conversation` drives it from the mic level itself.

```ts
  useEffect(() => {
    orbThink(suggesting ? 0.7 : null);
    return () => orbThink(null);
  }, [suggesting]);
```

- Where it sits, per view (through the spots the components render, `docs/09-orb.md` §8): contents, start, talk: beside the headline; start while picking: on the chosen answer; walk: on the recommended answer, or beside the question when there is none, or on the chosen answer while picking, or on the custom body's submit button; summary, draft: on the `Go` button; summary, saving or done: beside the headline. The orb hides while a drawer is open.

- The context the orb's own brain (if one is plugged in) would be told, written on `<html>` as `data-orb-context` on every `stepKey` change:

```ts
  useEffect(() => {
    document.documentElement.dataset.orbContext = `You are the guide inside ${guide.name}, an app that plans a trip or an evening one question at a time. The person is on the ${view} screen${step ? `, at the question "${step.q.replace(/\*/g, '')}"` : ''}.`;
    return () => void delete document.documentElement.dataset.orbContext;
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
```

---

## 13. State diagram

```
   (load) ───────────────────────────────► CONTENTS ◄──────────────── Home / Save draft (any other view)
                                            │  │  │                       ▲
          "Start something new" ◄───────────┘  │  └── a run's row (open) ─┼──► WALK (draft, question left)
                    │                          │                          │    or SUMMARY (otherwise)
                    ▼          "Talk it through"                          │
                  START ◄──────────────────────┘                          │
                    │  "Talk it through" ──────────────► TALK             │
                    │                                     │ action (seed) │
                    │ a flow's label                      │               │
                    ▼                                     ▼               │
                  WALK (run draft, step = nextStep) ◄── startFlow(): newRun() saved at once
                    │  ▲   ▲
                    │  │   └── Back (answers > 0): backOne() drops the last answer, stay
                    │  └────── Back (answers = 0): → START
                    │  pick / own words / Pick for me / custom step ─► answer() ─► keep() ─► nextStep? ──yes──► WALK (next question)
                    │  trail tap ─► revisit(): drop that answer and all after it ─► WALK (that question)
                    │  Finish it for me ─► finishAll() ─► keep()
                    │                                     │ no question left
                    ▼                                     ▼
                  SUMMARY (draft) ──Back──► WALK (last answer dropped)
                    │ "Save the plan" (Go, or the orb's "save")
                    ▼
                  SUMMARY (saving: Progress, orbThink 0.55) ──done──► SUMMARY (done: Result, status 'done') ──Back/Home──► CONTENTS

 Overlays (any view): the options drawer; the gallery drawer (drafts → open → WALK or SUMMARY; made; about).
```

Invariants:

1. At most one question is on screen; the trail holds only answers to steps that still apply.
2. Every change to the answers is saved (`keep`) before the screen moves on; "Save draft" adds nothing.
3. The stage is the only animated region; a stage key change always waits for the exit; a step change never changes the key.
4. The orb is told where to be and what it may say on every `stepKey` change, and is brought home.
5. The bars never move; they only enable and disable.
