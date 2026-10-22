# 06 · Components

Every screen piece of an Orbit studio, as it exists in `src/components/` of this package. Each entry gives the purpose, the props, the DOM it renders (class names are the ones `src/styles/studio.css` expects), its states, the data attributes the orb reads, accessibility, and a usage snippet. Motion details are summarised and cross-referenced to `docs/05-motion.md`; the props that control motion are listed here.

Where this document says "Orbit did X", it describes the source these components were copied from (`orbit/src/studio/*.tsx`). Nothing here calls a network or a model: writers come in through `setWriter()` (see `src/walkthrough/adapter.ts`) and the making of pictures is the app's own code.

## Contents

1. [Conventions](#1-conventions)
2. [Sheets: OrbSpot, Headline, Rows, Row, Page](#2-sheets)
3. [Home](#3-home)
4. [Gate](#4-gate)
5. [CharacterList](#5-characterlist)
6. [Choices](#6-choices)
7. [Walk](#7-walk)
8. [ScriptDesk and SceneForm](#8-scriptdesk-and-sceneform)
9. [Brief pieces (what Make was made of)](#9-brief-pieces)
10. [Talk](#10-talk)
11. [Drawer, the gallery and the options](#11-drawer)
12. [Top bar, stage and bottom bar](#12-top-bar-stage-and-bottom-bar)
13. [Toasts](#13-toasts)
14. [Orbit 0.5 home and index: Path, IndexMenu, Handle, Step](#14-orbit-05-home-and-index)
15. [Magazine helpers](#15-magazine-helpers)
16. [SqIcon](#16-sqicon)
17. [Data attributes the orb reads](#17-data-attributes-the-orb-reads)

---

## 1. Conventions

| Convention | Meaning |
|---|---|
| `*italic*` in a headline | `Headline` splits its `text` on `*`; every odd part is wrapped in `<em>`. "Where are *we?*" renders `<span>Where are </span><em>we?</em>`. The studio's masthead uses the same idea through `mark: [roman, italic]`. |
| `o5-kicker` | The small uppercase running head from Orbit 0.5's magazine look (defined in `src/styles/o5.css`). Studio components add `st-kick` for the two-ended version (left: chapter, right: `st-num`). |
| Square everything | Buttons, inputs and icons have no rounded corners (`.st-sq`, `.st-ico`, `strokeLinecap="square"`). |
| `picked` | On every list of choices, `picked` is `null` at rest and the chosen label while the pick animation plays. While it is not null, the list is `disabled`. |
| Motion level | Components read `useMotionLevel()` from `../motion`: `'full'` gives springs and blur, `'lite'` short tweens, `'off'` quick fades. See `docs/05-motion.md`. |
| `delay` props | Seconds before the first item of a staggered list arrives. Items then follow at `+0.055 s` each. |

---

## 2. Sheets

File: `src/components/Sheets.tsx`.

### OrbSpot

A place kept for the orb. The orb sits centred on it, grown to `size` px. It is an empty span (nothing to read), and it is not `aria-hidden`, because the orb skips hidden elements.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `size` | `number` | `52` | The orb's diameter on this spot, in px. |
| `className` | `string` | `'st-orb-spot'` | Use `'st-choice-spot'` on an answer or a primary button. |

DOM: `<span class="{className}" data-orb-spot="" data-orb-size="{size}" role="presentation"/>`.

### Headline

The question or title of a page, in the display face, with the orb waiting beside it.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `text` | `string` | — | The headline; `*words*` become `<em>`. |
| `id` | `string` | — | Id of the `<h2>`, used by the page's `aria-labelledby`. |
| `orb` | `boolean` | `true` | Keep an `OrbSpot` (52 px) beside the headline. Screens turn it off when the orb should sit somewhere else (on the recommended answer, on the primary button, on the picked answer). |

DOM:

```html
<div class="st-qwrap">
  <h2 class="st-q" id="{id}"><span>Where are </span><em>we?</em></h2>
  <span class="st-orb-spot" data-orb-spot="" data-orb-size="52" role="presentation"></span> <!-- when orb -->
</div>
```

### Rows

A list whose rows arrive one after another on a spring, out of a blur.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `children` | `ReactNode[]` | — | One element per row (usually `Row`). Keys are the index. |
| `label` | `string` | — | `aria-label` of the `<ol>`. |
| `delay` | `number` | `0.12` | Seconds before the first row. |

DOM: `<ol class="st-contents" aria-label="{label}"><li>…</li>…</ol>`. Motion: full → `initial {opacity 0, y 22, blur 10px}`, animate with `SPRING.bouncy` and `delay + i·0.055`; otherwise fade with `transitionFor(level)`.

### Row

One row of a contents page: a framed icon or a two-digit folio, a title, a line of meta.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `icon` | `IconName` | — | Framed icon on the left. When absent, `n` is shown instead. |
| `n` | `number` | — | Folio number, printed as `01`, `02`… (`aria-hidden`). |
| `title` | `string` | — | |
| `meta` | `string` | — | "Picture · Draft · Today". |
| `onClick` | `() => void` | — | With it the row is a `<button class="st-row">` (`whileTap` scale 0.98); without, a `<div class="st-row st-row-static">`. |

DOM inside: `<span class="st-ico">svg</span>` or `<span class="st-row-n" aria-hidden>01</span>`, then `<span class="st-row-t">`, `<span class="st-row-m">`.

### Page (added in this package)

A plain page in the studio's shape. Orbit wrote this markup inline for the Start, Brief and Talk screens.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | — | Headline id; the `<article>` is `aria-labelledby` it. |
| `kick` | `string` | — | Left part of the running head ("Opening"). |
| `num` | `string` | — | Right part (`st-num`), e.g. "Ready". |
| `title` | `string` | — | Headline with `*italics*`. |
| `orb` | `boolean` | `true` | Passed to `Headline`. |
| `dek` | `string` | — | One line under the headline (`st-dek`). |
| `className` | `string` | `''` | Added to `st-sheet` (`st-home`, `st-brief`, `st-talk`). |

DOM: `<article class="st-sheet {className}" aria-labelledby="{id}"><p class="o5-kicker st-kick"><span>{kick}</span><span class="st-num">{num}</span></p>{Headline}<p class="st-dek">{dek}</p>{children}</article>`.

```tsx
<Page id="st-start-t" kick="Opening" title="What shall we *make?*" orb={picked === null} dek="Pick one. Every choice is a short walk, one question at a time.">
  <Choices items={START} picked={picked} onPick={pick} delay={0.2} />
</Page>
```

---

## 3. Home

The member's projects, as a magazine contents page.

| Prop | Type | Meaning |
|---|---|---|
| `studio` | `StudioDef` | For the welcome headline (`mark`). |
| `projects` | `Project[]` | Newest first (`listProjects` sorts by `updatedAt`). |
| `onOpen` | `(p: Project) => void` | Tap a project row. |
| `onNew` | `() => void` | "Start something new". |
| `onTalk` | `() => void` | "Talk with the writer". |

Copy, exactly:

| Element | With projects | Without |
|---|---|---|
| `st-num` | `"{n} project"` / `"{n} projects"` | `"New here"` |
| Headline | `Your *projects*` | `Welcome to {mark[0]} *{mark[1]}*` |
| `st-dek` | `Pick one up where you left it, or start something new.` | `Everything you make lives here, sorted by project. Start your first one.` |

Rows (in `Rows label="Contents"`): `Row icon="plus" title="Start something new" meta="Picture, video or movie"`, `Row icon="talk" title="Talk with the writer" meta="Plan it in conversation"`, then one numbered row per project: title `p.title || "Untitled {picture|video|movie}"`, meta `"{Picture|Video|Movie} · {Draft|Being made|Finished|Stopped} · {whenOf(updatedAt)}"`.

DOM root: `<article class="st-sheet st-home" aria-labelledby="st-home-t">`. Headline id `st-home-t`, `orb` default (true).

---

## 4. Gate

The first page of an adult studio (`studio.adult === true`).

| Prop | Type | Meaning |
|---|---|---|
| `studio` | `StudioDef` | Name and `rules`. |
| `picked` | `string \| null` | The label being picked (animation in flight). |
| `onPick` | `(yes: boolean) => void` | `true` for "I am 18 or older". |

DOM: `<article class="st-sheet" aria-labelledby="st-gate-t">`; kicker `Before we begin` / `st-num` `18+`; `Headline "Adults *only.*"` with `orb={picked === null}`; `st-dek`: `"{name} makes adult pictures, videos and films. Confirm you are 18 or older, and that you agree to the house rules."`; `<ul class="st-rules">` one `<li>` per rule; `Choices` with two items `{ label: 'I am 18 or older', hint: 'And I agree to the rules' }` and `{ label: 'Take me back', hint: 'Leave {name}' }`, `delay={0.3}`.

What the app does with the answer (Orbit's `confirmAdult`): set `picked`, wait `settle()`, clear it; on no → `history.back()` if `history.length > 1`, else `location.href = 'about:blank'`; on yes → `localStorage.setItem('orbit:studio:{studio.id}:adult', '1')` (ignored if storage throws) and go to `home`.

---

## 5. CharacterList

| Prop | Type | Meaning |
|---|---|---|
| `list` | `Character[]` | From `listCharacters(studio.id)`. |

Empty: `<p class="st-empty">Characters you describe in a walkthrough are kept here, to cast again.</p>`. Otherwise `Rows label="Characters"` of `Row icon="character" title={c.name} meta={c.description}` (static rows, no `onClick`).

---

## 6. Choices

File: `src/components/Choices.tsx`. The answers to one question, each its own piece on a spring.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `items` | `Choice[]` | — | The answers shown, in order. |
| `picked` | `string \| null` | — | The label being picked. While set, only that item stays; the rest leave. |
| `onPick` | `(label: string) => void` | — | |
| `layoutPrefix` | `string` | — | The picked item gets `layoutId={layoutPrefix}` so it can fly to a matching `layoutId` elsewhere (the trail uses `ans-{stepId}`). |
| `delay` | `number` | `0.08` | Seconds before the first answer arrives. |
| `label` | `string` | `'Answers'` | `aria-label` of the list. |
| `recommended` | `string \| null` | — | The orb's pick: that item is marked and carries an `OrbSpot`. Only while `picked === null`. |

DOM:

```html
<ul class="st-choices" aria-label="Answers">
  <li>  <!-- motion.li -->
    <button type="button" class="st-choice" data-rec aria-pressed="false" disabled?>
      <span class="st-rec">The orb’s pick</span>         <!-- only when recommended -->
      <span class="st-lb">{label}</span>
      <span class="st-ht">{hint}</span>                  <!-- only with a hint -->
      <span class="st-choice-spot" data-orb-spot="" data-orb-size="40" role="presentation"/> <!-- chosen or recommended -->
    </button>
  </li>
</ul>
```

States:

| State | How it shows |
|---|---|
| Rest | `aria-pressed="false"`, enabled. |
| Recommended | `data-rec` set, `st-rec` label "The orb’s pick", an `OrbSpot(40)` so the orb sits on it. CSS: `.st-choice[data-rec]`. |
| Picked (chosen) | `aria-pressed="true"`, scale 1.03 with `SPRING.playful`, `OrbSpot(40)`; the others exit left (`x: -36`, blur 12 px, `SPRING.smooth`, `delay i·0.04`). CSS: `.st-choice[aria-pressed='true'] .st-lb::after` draws the rule under it. |
| Disabled | Every button is `disabled` while `picked !== null`. |
| Orb hover/press | The orb sets `data-orb-hover` / `data-orb-pressed` on the button it is over or tapping (styled in studio.css); the component itself does not set these. |

Motion props: `delay`, `layoutPrefix`; level-aware via `useMotionLevel()`. Entrance (full): `{opacity 0, y 26, blur 10}` → `SPRING.bouncy` with `delay + i·0.055`; `whileTap` scale 0.97 while enabled. See `docs/05-motion.md`.

```tsx
<Choices items={offered} picked={picked} onPick={pick} layoutPrefix={`ans-${step.id}`} delay={0.3} recommended={rec?.label ?? null} />
```

---

## 7. Walk

File: `src/components/Walk.tsx`. A walkthrough as one scroll: the trail of answers so far at the top, the current question in the middle.

| Prop | Type | Meaning |
|---|---|---|
| `flow` | `Flow` | The flow being walked. |
| `answers` | `Answers` | So far. The trail is `stepsFor(flow, answers)` filtered to answered steps, in flow order. |
| `step` | `StepDef` | The question on screen (`nextStep`). |
| `n`, `total` | `number` | From `progressOf`: "3 of 8". |
| `choices` | `Choice[]` | What to offer: `mergeChoices(predicted, step.choices)`. |
| `predicting` | `boolean` | Show "The writer is thinking of more…". |
| `picked` | `string \| null` | Pick animation in flight. |
| `onPick` | `(label) => void` | A ready answer or your own words. |
| `onPickForMe` | `() => void` | Shortcut. |
| `onFinishForMe` | `() => void` | Shortcut. |
| `onRevisit` | `(stepId) => void` | Tap an answered step in the trail. |
| `recommended` | `string \| null` | Passed to `Choices`. When set, the headline has no orb spot (the orb sits on the answer). |
| `desk` | `ReactNode` | A step that is not a list (the script desk) brings its own body; the own-words form, the shortcuts and the predicting line are hidden. |

DOM:

```html
<div class="st-scroll">                          <!-- the scroller; useScrollDepth(scroller, true, 'center') -->
  <ol class="st-trail" aria-label="Your answers so far">   <!-- only when something is answered -->
    <li data-depth="">
      <button type="button" class="st-trail-row" aria-label="{key}: {answer}. Change it">
        <span class="o5-kicker">{key}</span>
        <span class="st-trail-ans">{answer}</span>   <!-- motion.span layoutId="ans-{stepId}" -->
      </button>
    </li>
  </ol>
  <section class="st-now" aria-labelledby="q-{stepId}">   <!-- motion.section keyed by step.id -->
    <p class="o5-kicker st-kick"><span>{kick}</span><span class="st-num">{n} of {total}</span></p>
    {Headline text=step.q id="q-{stepId}" orb={!busy && !recommended && !desk}}
    <p class="st-dek">{dek}</p>
    {desk ?? Choices …}
    <p class="st-predicting">The writer is thinking of more…</p>      <!-- predicting && !busy && !desk -->
    <form class="st-own">                                          <!-- !step.closed && !busy && !desk -->
      <label class="o5-kicker" for="own-{stepId}">Or in your own words</label>
      <input id="own-{stepId}" placeholder="Something else…" autocomplete="off" enterkeyhint="next">
      <button type="submit" disabled={!own.trim()}>Use this</button>
    </form>
    <p class="st-shortcuts">                                       <!-- !busy && !desk -->
      <button type="button">{shuffle icon} Pick for me</button>
      <button type="button">{forward icon} Finish it for me</button>
    </p>
  </section>
</div>
```

Behaviour:

- `busy = picked !== null`.
- On every `step.id` change (`useLayoutEffect`): the own-words box is cleared and the scroller scrolls so the current section sits 20 % down: `scrollTo({ top: max(0, section.offsetTop − clientHeight·0.2), behavior: full ? 'smooth' : 'auto' })`.
- `useScrollDepth(scroller, true, 'center')` sets `--p`/`--ap` on each `[data-depth]` trail row so CSS sinks and blurs the rows leaving the middle.
- Own words: submitting a non-empty trimmed value calls `onPick(value)`.
- `Choices` gets `layoutPrefix="ans-{stepId}"` and `delay = done.length ? 0.3 : 0.12`, so the picked answer flies to its `st-trail-ans` when the next step renders (both are inside one `LayoutGroup`).

Motion (full): section enters `{opacity 0, y 40, blur 12}` → `SPRING.smooth` with `delay 0.18` when there is a trail; own-words form `{opacity 0, y 16, blur 8}` → `SPRING.smooth` `delay 0.5`; shortcuts fade in at `delay 0.6`; trail answers use `SPRING.default` for the layout flight. See `docs/05-motion.md`.

---

## 8. ScriptDesk and SceneForm

File: `src/components/Script.tsx`. The film scene by scene, each one a five-second shot. Rendered as the `desk` of a step with `kind: 'script'`.

### ScriptDesk

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `studio` | `StudioDef` | — | For the writer's system prompt. |
| `answers` | `Answers` | — | For `castOf`, `anotherTake` and the writer's brief. |
| `script` | `Project['script'] \| undefined` | — | `{ basis, scenes, by }`. `undefined` shows `<p class="st-predicting">Drafting the script…</p>` (the app drafts it when `scriptBasis(answers)` differs from `script.basis`). |
| `awake` | `boolean` | — | Whether the writer can rewrite now (`writerAwake()`); shows the writer buttons. |
| `onChange` | `(scenes, by) => void` | — | `by` is `'draft'`, `'writer'` or `'you'`. |
| `onApprove` | `() => void` | — | "This is the script". |
| `rewrites` | `Rewrite[]` | `DEFAULT_REWRITES` | Per-scene writer buttons: `{ label, how }`. The source's two: `More heat` → `"more intense and sensual, still tasteful and consenting"`, `Softer` → `"softer, more tender"`. |

DOM:

```html
<div class="st-script">
  <p class="st-script-meta">
    <span>{answers.premise || 'Untitled'}</span>
    <span>{n} scenes · about {n·5} seconds</span>
    <span>{cast names joined ' & '}</span>
    <span>First draft | Written with the writer | Your edit</span>
  </p>
  <ol class="st-scenes">
    <li class="st-scene" aria-busy="false">       <!-- motion.li -->
      <p class="o5-kicker st-scene-head"><span>Scene 01</span><span>{heading}</span></p>
      <!-- reading: -->
      <p class="st-action">{action}</p>
      <p class="st-ends"><span>Ends on</span> {end}</p>
      <p class="st-says">{says}</p>                    <!-- only when says -->
      <p class="st-scene-tools">
        <button>{shuffle} Another take | Writing…</button>
        <button>More heat</button><button>Softer</button>   <!-- only when awake; from `rewrites` -->
        <button>Edit</button>
      </p>
      <!-- or editing: SceneForm -->
    </li>
  </ol>
  <p class="st-error" role="alert">{error}</p>
  <div class="st-script-go">
    <button class="st-go" disabled={working !== null || editing !== null}>This is the script {OrbSpot 40 st-choice-spot}</button>
    <button class="st-ghost">Rewrite it all with the writer | The writer is writing…</button>   <!-- awake -->
    <p class="st-ht">The studio’s writer can rewrite scenes once the studio is awake. This draft is ready to film as it is.</p>  <!-- not awake -->
  </div>
</div>
```

Behaviour:

| Action | Awake | Not awake |
|---|---|---|
| Another take (scene i) | `rewriteScene(…, i, 'a fresh take on the same moment')` → `onChange(next, 'writer')` | `onChange(anotherTake(answers, scenes, i), script.by)` (the next beat variant, no writer) |
| More heat / Softer | `rewriteScene(…, i, how)` | button not shown |
| Edit | opens `SceneForm`; on Done, `onChange(…, 'you')` only if action, end or says changed | same |
| Rewrite it all | `writeScript(studio, answers)`; empty result → error `The writer came back empty. Your draft is still here.` | not shown |

- `working` is `i`, `'all'` or `null`; while not null every tool is disabled and the scene is `aria-busy`. The orb glows: `orbThink(0.7)` while working, `orbThink(null)` after.
- Errors (except `AbortError`) show `err.message || 'The writer could not answer. Your draft is still here.'`. With no writer set the adapter throws `No writer is plugged in. Your draft is still here.`
- Unmounting aborts the in-flight request.

Motion: scenes enter `{opacity 0, y 22, blur 8}` → `SPRING.bouncy`, `delay 0.15 + i·0.07`.

### SceneForm

| Prop | Type | Meaning |
|---|---|---|
| `scene` | `Scene` | Initial values. |
| `onDone` | `(s: Scene) => void` | On submit: `action` trimmed (falls back to the old action when empty), `end` and `says` trimmed. |

DOM: `<form class="st-scene-form">` with labelled fields `act-{id}` (textarea, 3 rows, "What we see"), `end-{id}` (input, "It ends on"), `says-{id}` (input, "What is said", placeholder `Mara, softly: "Stay."`), `<button type="submit">Done</button>`.

---

## 9. Brief pieces

File: `src/components/Brief.tsx`. Orbit's `Make.tsx` was one component that showed the brief, woke its machine, started the job, polled it and showed the result. The network part belongs to the app; these are the pieces it was drawn with. The headline and kicker come from `Page`.

### How Make composed them (for a faithful re-make)

| `project.status` | Kicker `st-num` | Headline | Orb spot on headline | Body |
|---|---|---|---|---|
| `draft` | `Ready` | `Here is your *brief.*` | no (`orb={false}`; the orb sits on the Go button) | `BriefList` (answers minus `Script`), `ScriptPreview` if a movie has a script, `Go "Make the {picture|video|movie}"` |
| `making` | `Being made` | `Making your *{what}…*` (or `Your *storyboard.*` in review) | yes, except in review | `Making` (progress bar) or, in review, `Storyboard` + `Go` (`Draw it again` / `Draw these {n} again` when some are selected, else `Looks right, film it`) |
| `done` | `Finished` | `Here is your *{what}.*` | yes | `Result` |
| `error` | `Ready` | `Here is your *brief.*` | no | `BriefList`, `ErrorLine`, `Go "Try again"` |

`what` is `'picture'` for images, else the kind. Making notes Orbit showed: `Warming up the studio. The first one of the day takes a few minutes.`, `Warming up the studio: loading its tools.`, `In line: {n} ahead of you.`, `About {m} min left.`, `Making it now.`, and the `PHASE` names for films. The orb notes it sent are in `docs/08-walkthrough-prd.md` §9.

### BriefList

`items: { key: string; value: string }[]` → `<dl class="st-brieflist"><div><dt>{key}</dt><dd>{value}</dd></div>…</dl>`. Orbit passed `briefOf(flow, answers).filter(b => b.key !== 'Script')`.

### Go

The one button a screen wants pressed next, with a place for the orb on it.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `label` | `string` | — | |
| `onClick` | `() => void` | — | |
| `disabled` | `boolean` | — | |
| `review` | `boolean` | `false` | Adds `st-review-go` (the storyboard check's variant). |
| `children` | `ReactNode` | — | A `Ghost` button or a hint line beside it. |

DOM: `<div class="st-script-go [st-review-go]"><button type="button" class="st-go">{label}<span class="st-choice-spot" data-orb-spot data-orb-size="40"/></button>{children}</div>`.

### Ghost

`<button type="button" class="st-ghost">{label}</button>`; props `label`, `onClick`, `disabled`.

### Making

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `progress` | `number \| null` | — | 0–100, or null while unknown (bar gets `st-bar-busy`, a sweeping animation). |
| `note` | `string \| null` | — | Shown in `st-dek`; `null` shows `Starting…`. |
| `hint` | `string \| null` | `You can leave this page. It keeps going, and it will be in your gallery when it is done.` | `st-ht` line; `null` hides it. |
| `idle` | `number` | `8` | Bar width (%) while progress is unknown. Orbit used 20 once a film had started. |

DOM: `<div class="st-making" role="status"><div class="st-bar" aria-hidden><span style="width:{p}%" class="st-bar-busy?"/></div><p class="st-dek">…</p><p class="st-ht">…</p></div>`.

### Storyboard

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `frames` | `{ id: string; url: string \| null }[]` | — | `url` null while a picture is still being drawn. |
| `selected` | `Set<string>` | — | Ids marked to draw again. |
| `onToggle` | `(id) => void` | — | |
| `dek` | `string \| null` | `Where each scene starts and ends. Tap a picture to draw it again.` | |
| `nameOf` | `(i) => string` | `frameName` | `Opening`, then `Scene {i} ends`. |

DOM: optional `<p class="st-dek">`, then `<ol class="st-frames" aria-label="Storyboard">`; each `<li>` holds `<button type="button" aria-pressed={selected}><img src alt="{name}"><span class="st-num">{name}</span></button>` or, while drawing, `<span class="st-frame-wait" aria-hidden/><span class="st-num">{name} · drawing</span>`.

### Result

`kind: 'image' | 'video'`, `url`, `alt` → `<figure class="st-result">` with `<img>` (alt = the prompt in Orbit) or `<video controls playsinline loop>`.

### ScriptPreview

`scenes: Scene[]` → `<ol class="st-scenes" aria-label="The script">` of `<li class="st-scene">` with `st-scene-head` (`Scene 01`, heading), `st-action`, optional `st-says`. Read-only (no tools, no "Ends on").

### ErrorLine

`<p class="st-error" role="alert">{children}</p>`.

### PHASE

The on-screen names of a film's phases: `draft: Getting ready`, `story: Writing the story`, `lead: Casting the lead`, `storyboard: Drawing the storyboard`, `review: Storyboard ready for you`, `shots: Filming the scenes`, `final: Cutting the film`, `done: Finished`, `stopped: Stopped`, `error: Stopped`.

```tsx
<Page id="st-brief-t" kick="The brief" num="Ready" title="Here is your *brief.*" orb={false} className="st-brief">
  <BriefList items={briefOf(flow, project.answers).filter((b) => b.key !== 'Script')} />
  <Go label="Make the picture" onClick={make} />
</Page>
```

---

## 10. Talk

File: `src/components/Talk.tsx`. A conversation with the studio's writer, typed or spoken; at any point it becomes a walkthrough seeded with what was said. `forwardRef<HTMLElement>` to the `<article>`.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `studio` | `StudioDef` | — | `writer` (system prompt), `talk.starters`, `talk.followUps`. |
| `onMake` | `(kind: 'image'\|'video'\|'movie', seed: string) => void` | — | Seed = the last thing you said, first 120 characters. |
| `onSend` | `(text, history: ChatMessage[], signal?) => Promise<string>` | — | Answer one turn with the whole reply. `history` starts with the system message and holds the turns before this one. |
| `mic` | `Mic` | — | The mic slot: `{ canListen(): boolean; listen(handlers): { finish(); cancel() } }`. No mic → no mic button. |
| `onWake` | `() => void` | — | Called when the adapter's writer is not awake (so the app can start waking it). |

Without `onSend`, Talk streams through the adapter's `Writer` (`getWriter().chat(...)`). With neither it shows `No writer is plugged in yet.` and keeps your words in the box.

The system message is `"{studio.writer}\nTalk like a creative partner: short replies, one idea at a time, and offer two or three directions to take it."`

DOM:

```html
<article class="st-sheet st-talk" aria-labelledby="st-talk-t">
  <p class="o5-kicker st-kick"><span>Talk</span><span class="st-num">The writer</span></p>
  {Headline "What are you *in the mood for?*" | "Talking with the *writer*"}      <!-- empty thread | after -->
  <div class="st-thread" aria-live="polite">
    <p class="st-said">{you}</p> <p class="st-reply">{writer or …}</p> …
    <div/>  <!-- scroll anchor -->
  </div>
  <p class="st-error" role="alert">{error}</p>
  {Choices items=starters|followUps label="Moods"|"Where to take it" delay=0.2|0.1}   <!-- !busy; key = msgs.length -->
  <p class="st-shortcuts" aria-label="Make it">                                       <!-- seed && !busy -->
    <button>{picture} Make it a picture</button><button>{video} A video</button><button>{movie} A movie</button>
  </p>
  <form class="st-own">
    <label class="o5-kicker" for="st-talk-in">Say it or type it | Listening…</label>
    <input id="st-talk-in" placeholder="A slow-burn story about…" autocomplete="off" enterkeyhint="send">
    <button type="button" class="st-mic" aria-pressed={hearing} aria-label="Speak|Stop listening">{mic}</button>  <!-- mic?.canListen() -->
    <button type="submit" disabled={!text.trim() || busy}>Send</button>
  </form>
</article>
```

Behaviour:

- Starters: picking one says `I'm in the mood for: {label lower-cased} ({hint lower-cased}).` for you. Follow-ups send their label as typed. Either way the pick lifts for `520 ms` (full), `200 ms` (lite) or `0` before sending.
- A new turn calls `orbHome()`; the thread scrolls to its end on each change.
- Sending: an empty assistant message is added at once and filled as text streams. On failure with nothing received, the empty reply is removed and your words are put back in the box; the error's message is shown. Aborts are silent.
- Mic: `onLevel` drives `orbThink(level)`; `onPartial` fills the box; `onDone` sends; `onError` shows the message. Orbit's mic (Web Speech or MediaRecorder) is not in this package.

---

## 11. Drawer

File: `src/components/Drawer.tsx`. Drawers slide in from the right over a blur. Orbit had two, Gallery and Options; here one generic `Drawer` with optional tabs, plus the shelf pieces.

### Drawer

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `label` | `string` | — | `aria-label` of the dialog (`"{studio.name}: your gallery"`, `"Options"`). |
| `title` | `ReactNode` | — | The `<h3>`; italic half in `<em>` (`Your <em>gallery</em>`, `House <em>rules</em>`). |
| `onClose` | `() => void` | — | Escape, the scrim and the close button. |
| `closeLabel` | `string` | `'Close'` | |
| `scrimLabel` | `string` | `'Close'` | Orbit: `Close the gallery` / `Close options`. |
| `tabs` | `DrawerTab[]` | — | `{ id, label, icon }`. With tabs the children sit in `<div class="st-shelf">`. |
| `tab`, `onTab` | | | The pressed tab and the change handler. |
| `tabsLabel` | `string` | `'Shelves'` | |

DOM:

```html
<div class="st-drawer-wrap" role="dialog" aria-modal="true" aria-label="{label}">
  <button type="button" class="st-scrim" aria-label="{scrimLabel}"/>
  <aside class="st-drawer">
    <div class="st-drawer-head"><h3>{title}</h3><button class="st-sq st-sq-ink" aria-label="Close">{close}</button></div>
    <nav class="st-tabs" aria-label="Shelves"><button aria-pressed><span class="st-ico">svg</span><span>Projects</span></button>…</nav>
    <div class="st-shelf">{children}</div>
  </aside>
</div>
```

The entrance is CSS (`st-fade` 300 ms on the scrim, `st-slide` 520 ms on the aside); there is no exit animation. Focus is not trapped (Orbit's gallery did not trap it either).

### The gallery, as Orbit filled it

`SHELVES` (in order): `projects` (icon `project`), `pictures` (`picture`), `videos` (`video`), `movies` (`movie`), `characters` (`character`). The gallery button in the top bar opens the `projects` shelf.

| Shelf | Content |
|---|---|
| projects | `ContentsList` of projects (title `p.title || 'Untitled'`, meta `Picture|Video|Movie`), or `Empty`: `No projects yet. Start one from Home.` Tapping a row closes the drawer and opens the project. |
| characters | `CharacterList(listCharacters(studio.id))`. |
| pictures / videos / movies | The member's items from the app's store, filtered: pictures = `kind === 'image' && !movie`, videos = `kind === 'video' && !movie`, movies = joined films. Loading: `Opening your gallery…`; nothing: `Nothing here yet.`; load error: `Your pictures and films show here while the studio is awake. Start something and it wakes up.` Shown in `MediaGrid`. |

### ContentsList, MediaGrid, Empty

- `ContentsList rows=[{id,title,meta,onClick}]` → `<ol class="st-contents">` of `<button class="st-row">` with `st-row-n` folio, `st-row-t`, `st-row-m` (no entrance motion in a drawer).
- `MediaGrid items=[{id, kind, url, alt}]` → `<ul class="st-grid">` of `<img loading="lazy">` or `<video muted playsinline loop controls preload="metadata">`.
- `Empty` → `<p class="st-empty">`.

### OptionsDrawer

`rules: string[]`, `note` (default `Tap the orb any time to ask it something, or hold it to talk.`), `onClose`. Title `House <em>rules</em>`, `<ul class="st-rules">`, then `<p class="st-dek">{note}</p>`.

---

## 12. Top bar, stage and bottom bar

File: `src/components/Bars.tsx`. Extracted from Orbit's `StudioApp`. What each button does per view is specified in `docs/07-layout-and-navigation.md`.

### Root

`<div class="st-root" data-view="{view}">` — fixed, full screen, a three-row grid (top bar, stage, bottom bar). Props: `view: string`, `children`.

### TopBar

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `kicker` | `string` | — | `<small>` over the masthead (`studio.kicker`, e.g. "An Orbit studio · 18+"). |
| `mark` | `[string, string]` | — | Masthead: `<b>{mark[0]} <i>{mark[1]}</i></b>`. |
| `actions` | `boolean` | `true` | Show the two square buttons. Orbit hid them on the gate. |
| `onOptions`, `onGallery` | `() => void` | — | |
| `optionsLabel` | `string` | `'Options'` | `aria-label` of the first square (icon `options`). |
| `galleryLabel` | `string` | `'Your gallery'` | `aria-label` of the second (icon `menu`). |
| `label` | `string` | `'Studio'` | `aria-label` of the `<nav>`. |

DOM: `<header class="st-top"><div class="st-flag"><small/><b>… <i/></b></div><nav class="st-top-actions" aria-label="Studio"><button class="st-sq" aria-label="Options"/><button class="st-sq" aria-label="Your gallery"/></nav></header>`.

### Stage

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `screenKey` | `string` | — | When it changes, the old screen leaves before the new one enters. Orbit used `` `${screen}|${project?.id ?? ''}` `` where `screen` is the view, except that a `walk` view with no question left counts as `make`. |
| `walking` | `boolean` | `false` | A `Walk` brings its own `st-scroll`; anything else is wrapped in `<div class="st-scroll">`. |

DOM: `<main class="st-stage" id="st-stage"><div class="st-view">…</div></main>` inside `AnimatePresence mode="wait" initial={false}`. Motion (full): enter `{opacity 0, y 28, blur 14}` → `SPRING.smooth`; exit `{opacity 0, y −18, blur 14}` with `{...SPRING.smooth, stiffness: 260}`. Lite/off: fades via `transitionFor(level)`.

### BottomBar

| Prop | Type | Default |
|---|---|---|
| `canBack`, `canHome`, `canSave` | `boolean` | — |
| `onBack`, `onHome`, `onSave` | `() => void` | — |
| `backLabel`, `homeLabel`, `saveLabel` | `string` | `'Back'`, `'Home'`, `'Save draft'` |

DOM: `<footer class="st-bottom">` with three `<button type="button" class="st-bar-btn" disabled?>{icon} <span>{label}</span></button>` (icons `back`, `home`, `save`). Disabled buttons are 30 % opacity. Orbit hid the whole bar on the gate.

```tsx
<Root view={view}>
  <TopBar kicker={studio.kicker} mark={studio.mark} actions={view !== 'gate'} onOptions={() => setOptions(true)} onGallery={() => setShelf('projects')} />
  <Stage screenKey={`${screen}|${project?.id ?? ''}`} walking={walking}>{body}</Stage>
  {view !== 'gate' && <BottomBar canBack={canBack} canHome={view !== 'home'} canSave={canSave} onBack={goBack} onHome={goHome} onSave={saveDraft} />}
  <Toasts />
</Root>
```

---

## 13. Toasts

File: `src/components/Toasts.tsx`. A self-contained store (`useSyncExternalStore`, no state library).

| Export | Meaning |
|---|---|
| `toast(text, tone = 'info')` | Shows a toast for `TOAST_MS` (3200 ms). Tones: `'info' \| 'error' \| 'success'`. Returns the id. |
| `dismissToast(id)` | Early dismissal (a tap does this). |
| `useToasts()` | The current list. |
| `<Toasts/>` | `<div class="toasts" role="status" aria-live="polite">` of `<div class="toast glass">` with inline `borderColor: var(--danger)` + `color` for errors, `borderColor: var(--success)` for success. |

Orbit's one studio toast: `toast('Saved. It is waiting in your projects.', 'success')` from "Save draft". The `.toasts`/`.toast` styles are in `src/styles/base.css` (copied from Orbit's global stylesheet), not in `studio.css`.

---

## 14. Orbit 0.5 home and index

These four live in Orbit's shell (`orbit/src/shell/o5/`) and are **not copied** into this package, because they are wired to Orbit's app registry and shell store. They are documented so a new app can build the same screens.

### Path (the home)

A single vertical walk through everything, like a magazine: a cover, numbered chapters, a colophon.

- Root: `<main class="o5-path" data-hidden aria-hidden inert aria-label="Home">` (the `hidden` prop sets all three), with `useScrollDepth(scroller, !hidden)` (mode `'center'`).
- Cover: `<section class="o5-spread o5-cover" data-depth aria-labelledby="o5-hello">` → `o5-page` → `o5-kicker` ("Orbit 0.5 · {weekday, day month}"), `<h1 class="o5-display o5-hero" id="o5-hello">` greeting (`Good night.` < 5 h, `Good morning.` < 12, `Good afternoon.` < 18, else `Good evening.`), `o5-dek` status line, `<button class="o5-cue">Begin {down icon}</button>` scrolling to the first chapter.
- Chapter: `<section class="o5-spread" id data-depth aria-labelledby="{id}-t">` → `<span class="o5-numeral" aria-hidden>01</span>`, `<div class="o5-page">` with `o5-kicker` ("01 — Title", the dash `aria-hidden`), `<h2 class="o5-display" id="{id}-t">`, `o5-dek`, `<ul class="o5-links">`.
- Link (`Go`): `<li><button class="o5-go" data-art?><AppArt class="o5-go-art" size=44/><span class="o5-go-label"/><span class="o5-go-hint"/><Icon forward 20/></button></li>`.
- Colophon: `<footer class="o5-colophon"><p>That's everything. The line at the bottom of the screen opens the index from anywhere.</p></footer>`.
- Orbit's chapters: 01 Continue, 02 Talk, 03 Make, 04 Build, 05 Desktops, 06 Tune.

### IndexMenu (the one menu)

A full-screen contents page: `<div class="o5-index" role="dialog" aria-modal="true" aria-label="Index">` → `o5-index-scroll` → `<header class="o5-index-head">` (`o5-kicker` "Index", `<button class="o5-index-close" aria-label="Close the index">`), optional `<section class="o5-index-open" aria-label="Open now">` (rows `o5-open-go` with `aria-current`, `o5-open-name`, `o5-go-hint`, and `o5-open-close` `aria-label="Close {app}"`), `<nav aria-label="Everything"><ol class="o5-index-list">` with `<li style="--i: n">` → `<button class="o5-index-go" aria-current?>` → `o5-index-n` ("00" is Home), `AppArt o5-index-art 48`, `o5-index-title`, `o5-go-hint`; `<footer class="o5-index-switches" aria-label="Quick settings">` with `o5-switch` buttons (Dark/Light with `aria-pressed`, "Motion · Auto|Full|Lite|Off" cycling full→lite→reduce→system→full, Classic look, Switch workspace link). Focus is trapped with a `keydown` capture on Tab; the close button is focused on open; focus returns on close. `folioOf(app)` gives `"04 · Terminal"` from the entry's position.

### Handle

Orbit 0.5 has no dock: one thin line at the bottom. `<button class="o5-handle" data-home={activeApp === null} data-hidden={keyboardOpen || index open} aria-label="Index" | "Index. Swipe up to go home." aria-expanded={index open}>` with `<span class="o5-handle-word">Index</span>` on the home, or the folio `<span class="o5-handle-word o5-folio" aria-hidden>04 · Terminal</span>` inside an app, and `<span class="o5-handle-line" aria-hidden/>`. Tap opens the index; inside an app, swipe up goes home. It hides while the keyboard is open.

### Step

One step of an app's own walk-through: `<section class="o5-step" id aria-labelledby="{id}-t"><p class="o5-kicker">{n}</p><h3 class="o5-step-title" id="{id}-t">{title}</h3>{children}</section>`; with `on={false}` it renders only the children. `nextStep(on, id)` scrolls `#id` into view (`smooth`, `start`) on the next frame.

---

## 15. Magazine helpers

From `orbit/src/ui/Magazine.tsx` (not copied; Orbit-specific `Icon`). Pieces for pages that read like the home screen:

| Helper | DOM |
|---|---|
| `MagCover { kicker, title, dek?, children? }` | `<header class="mag-cover" data-depth><p class="o5-kicker"/><h2 class="mag-title"/><p class="mag-dek"/>{children}</header>` |
| `MagContents { chapters: {id,title}[] }` | `<nav class="mag-contents" aria-label="Contents">` of `<button><span class="mag-contents-n">01</span> {title}{down icon 14}</button>` that scrolls `#id` into view. |
| `MagChapter { n, id, title, dek?, children }` | `<section class="mag-chapter" id data-depth aria-labelledby="{id}-t"><span class="mag-numeral" aria-hidden>01</span><p class="o5-kicker">01 — Title</p><h3 class="mag-head" id="{id}-t"/><p class="mag-dek"/>{children}</section>` |

They rely on `useScrollDepth(body, true, 'edges')` from the enclosing sheet (Orbit's `Sheet page`), which gives `[data-depth]` children `--p`/`--ap`.

Orbit's `ui/components.tsx` (IconButton, AppHeader, Sheet with the drag-to-dismiss grip, ConfirmSheet, PromptSheet, Toggle, Segmented, EmptyState) belongs to the classic app shell and is not part of the studio screens; the studio's drawers replace `Sheet`.

---

## 16. SqIcon

File: `src/components/icons.tsx`. Thin square-cut line drawings on a 24-unit grid: `stroke="currentColor"`, `strokeWidth 1.5`, `strokeLinecap="square"`, `strokeLinejoin="miter"`, rendered `20×20`.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `name` | `IconName` | — | `menu close back home save options picture video movie project character talk mic shuffle forward plus`. |
| `framed` | `boolean` | `false` | Wrap in `<span class="st-ico">` (a hairline square). |
| `label` | `string` | — | With a label: `role="img" aria-label`; without: `aria-hidden="true"`. |

The exact path for each name is in the file and must not be redrawn.

---

## 17. Data attributes the orb reads

Set by these components; consumed by `src/orb` (see Orbit's `attention.ts` for the order of what matters).

| Attribute | Where | Meaning |
|---|---|---|
| `data-orb-spot=""` | `OrbSpot` | A place kept for the orb; it sits centred on it. (`data-orb-spot="stage"` is a different, voice-mode use; not set by any studio component.) |
| `data-orb-size="{px}"` | `OrbSpot` | The orb's size on that spot: 52 beside a headline, 40 on an answer or primary button. |
| `data-orb-focus` | not set by these components | Orbit's other apps mark "the thing you're on" with it; the studio uses spots instead. The orb goes to `[data-orb-focus]` before a spot. |
| `data-rec` | `Choices` | The orb's pick; the recommended answer also carries a spot so the orb sits on it. |
| `data-orb-hover`, `data-orb-pressed` | set by the orb | On the control the orb is over or tapping (`.st-choice[data-orb-hover]`). |
| `data-depth=""` | `Walk` trail rows, `Path` spreads, Magazine pieces | `useScrollDepth` writes `--p`/`--ap` on them. |
| `data-view` | `Root` | The current view, for CSS hooks. |

The orb is reached only through window events (`orb:note`, `orb:energy`, `orb:home`, `orb:act`), see `src/walkthrough/orbGuide.ts` and `docs/08-walkthrough-prd.md` §9.
