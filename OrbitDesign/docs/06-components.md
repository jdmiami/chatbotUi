# 06 · Components

Every component exported from `src/components/index.ts`, in the order below. For each: what it is for, its props as the code declares them, the DOM it renders with every class name and data attribute, its states, the motion it exposes, accessibility, and a usage snippet taken from `example/src/App.tsx` where one exists.

Nothing in `src/components` calls a network. An assistant reaches `Conversation` either through its `onSend` prop or through `setAssistant()` (`src/flow/adapter.ts`); the orb is reached only through window events (`src/orb/events.tsx`, `src/flow/orbGuide.ts`). The orb itself is documented in `docs/09-orb.md` and the springs, levels and scroll depth in `docs/05-motion.md`; this document points to them and does not restate them.

**The `st-` prefix is historical; keep it, the CSS and the orb depend on it.** The class names and data attributes are the contract between these components, `src/styles/pages.css` and `src/orb`. Renaming one breaks the look or the orb's attention.

## Contents

1. [Conventions](#1-conventions)
2. [SqIcon](#2-sqicon)
3. [OrbSpot](#3-orbspot)
4. [Headline](#4-headline)
5. [Page](#5-page)
6. [Rows and Row](#6-rows-and-row)
7. [Contents](#7-contents)
8. [Gate](#8-gate)
9. [Choices](#9-choices)
10. [Walk](#10-walk)
11. [Conversation](#11-conversation)
12. [SummaryList, Go, Ghost, Progress, Result, ErrorLine](#12-summary-pieces)
13. [Root, TopBar, Stage, BottomBar](#13-root-topbar-stage-bottombar)
14. [Drawer, TABS, ContentsList, MediaGrid, Empty, OptionsDrawer](#14-drawers)
15. [Toasts and toast](#15-toasts-and-toast)
16. [useVisualViewport](#16-usevisualviewport)
17. [Data attributes the orb reads](#17-data-attributes-the-orb-reads)

---

## 1. Conventions

| Convention | Meaning |
|---|---|
| `*italic*` in a headline | `Headline` splits its `text` on `*`; every odd part becomes `<em>`, every even part `<span>`. `"Where *to?*"` renders `<span>Where </span><em>to?</em>`. The masthead uses the same idea through `mark: [roman, italic]` (see `TopBar`). |
| `o5-kicker` | The small uppercase running head of the magazine skin (`src/styles/o5.css`). Pages add `st-kick` for the two-ended version: a `<span>` on the left, `<span class="st-num">` (tabular numerals) on the right. |
| Square everything | Buttons, inputs and icons have no rounded corners (`.st-sq`, `.st-ico`, `strokeLinecap="square"`; `pages.css` forces `border-radius: 0` on fields under `data-skin='o5'`). |
| `picked` | On every list of answers, `picked` is `null` at rest and the chosen label while the pick animation plays. While it is not null the list is `disabled`. The app owns this state and clears it after `settle()` (see `docs/07-layout-and-navigation.md` §4). |
| Motion level | Components read `useMotionLevel()` from `../motion`: `'full'` gives springs and blur, `'lite'` short tweens, `'off'` quick fades, always through `transitionFor(level)`. See `docs/05-motion.md` §3. |
| `delay` props | Seconds before the first item of a staggered list arrives. Items then follow at `+0.055 s` each. |
| `Choice` | `{ label: string; hint?: string; value?: string; suits?: string[] }` from `src/flow/defs.ts`. Components show `label` and `hint`; `value` and `suits` belong to the engine. |
| Copy | Every default string is in the code and in the tables below. Change it through the prop, not the file. |

---

## 2. SqIcon

File: `src/components/icons.tsx`. Thin square-cut line drawings on a 24-unit grid, like the marks in a magazine's contents. No rounded corners anywhere.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `name` | `IconName` | — | One of the names below. |
| `framed` | `boolean` | `false` | Wrap the drawing in `<span class="st-ico">`, a 40 × 40 hairline square. |
| `label` | `string` | — | With a label the icon is an image (`role="img" aria-label`); without one it is decoration (`aria-hidden="true"`). |

Size and stroke are fixed: the `<svg>` is `viewBox="0 0 24 24" width="20" height="20"`, the one `<path>` is `fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter"`. The icon takes the text colour of its parent. There is no `size` prop; scale the parent's `font-size`/`color` or wrap it.

`IconName` (every key of `PATHS`, in the file's order):

| Name | Used by |
|---|---|
| `menu` | `TopBar` (the gallery button) |
| `close` | `Drawer` (the close button) |
| `back` | `BottomBar` |
| `home` | `BottomBar` |
| `save` | `BottomBar` |
| `options` | `TopBar` (the options button); `TABS` "About" |
| `picture` | `TABS` "Made" |
| `video` | — |
| `reel` | — |
| `folder` | `TABS` "Drafts" (a folder shape) |
| `person` | — |
| `talk` | `Contents` (the "Talk it through" row); the example's conversation actions |
| `mic` | `Conversation` (the mic button) |
| `shuffle` | `Walk` ("Pick for me") |
| `forward` | `Walk` ("Finish it for me"); the example's conversation actions |
| `plus` | `Contents` (the "Start something new" row) |

DOM:

```html
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">            <!-- no label -->
<svg viewBox="0 0 24 24" width="20" height="20" role="img" aria-label="{label}"> <!-- with a label -->
  <path d="{PATHS[name]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/>
</svg>
<span class="st-ico">{svg}</span>   <!-- framed -->
```

The exact path for each name is in the file and must not be redrawn. `.st-ico` (`pages.css`): 40 × 40, `display: grid; place-items: center`, hairline border, `color: var(--text-2)`; inside a pressed tab the frame and the stroke turn accent (`.st-tabs button[aria-pressed='true'] .st-ico`).

Accessibility: an icon inside a button with visible text (the bottom bar, the shortcuts) is hidden from readers; an icon that is the whole button gets its name from the button's `aria-label` (the square buttons) rather than from `label`.

```tsx
<button type="button" onClick={onPickForMe}>
  <SqIcon name="shuffle" /> Pick for me
</button>
```

---

## 3. OrbSpot

Files: `src/components/Sheets.tsx` and, identically, `src/orb/events.tsx`. A place kept for the orb: it sits centred on it, grown to `size` px (`docs/09-orb.md` §8, priority 3). It is an empty span, so there is nothing to read; it is **not** `aria-hidden`, because the orb skips hidden elements.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `size` | `number` | `52` | The orb's diameter on this spot, in px (`data-orb-size`). |
| `className` | `string` | `'st-orb-spot'` | The class that positions and sizes it. Use `'st-choice-spot'` on an answer or on the `Go` button. |

DOM:

```html
<span class="{className}" data-orb-spot="" data-orb-size="{size}" role="presentation"></span>
```

CSS (`pages.css`): `.st-orb-spot` is `position: absolute; top: 0; right: 4px; width: 52px; height: 52px` inside `.st-qwrap`; `.st-choice-spot` is `position: absolute; top: 50%; right: 6px; width: 40px; height: 40px; margin-top: -20px` inside an answer or the `Go` button (in the dock, `.st-dock .st-choice-spot { right: 6px }`).

States: none of its own. Whether a spot exists is the whole signal: a screen that wants the orb somewhere else removes the headline's spot (`orb={false}`) and renders one there.

---

## 4. Headline

File: `src/components/Sheets.tsx`. The question or title of a page, in the display face, with the orb waiting beside it.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `text` | `string` | — | The headline; `*words*` become `<em>`. |
| `id` | `string` | — | Id of the `<h2>`; the page's `aria-labelledby` points at it. |
| `orb` | `boolean` | `true` | Keep an `OrbSpot` (52 px) at the top right of the headline. Screens turn it off when the orb should sit somewhere else: on the recommended answer, on the picked answer, on the `Go` button, on a custom step's own control. |

DOM:

```html
<div class="st-qwrap">
  <h2 class="st-q" id="{id}"><span>Where </span><em>to?</em></h2>
  <span class="st-orb-spot" data-orb-spot="" data-orb-size="52" role="presentation"></span> <!-- when orb -->
</div>
```

The split is `text.split('*')`: parts at odd indexes are `<em key={i}>`, the rest `<span key={i}>`. An unbalanced `*` leaves the tail in italics. CSS: `.st-q` keeps `padding-right: 64px` (56 px under 560 px wide) so the orb never covers the last word; `.st-q em` is italic, weight 300, in the accent.

Motion: none of its own; the enclosing screen or step animates. Accessibility: a real `<h2>`; one per screen, and it names the `<article>`.

```tsx
{done ? <Headline text="Here is your *plan.*" id="st-summary-t" /> : saving ? <Headline text="Saving your *plan…*" id="st-summary-t" /> : <Headline text="Here is your *summary.*" id="st-summary-t" orb={false} />}
```

---

## 5. Page

File: `src/components/Sheets.tsx`. A plain page in the guide's shape: the running head, the headline, an optional dek, then whatever follows. The start, summary and conversation screens are all set this way (the example writes the summary's markup inline with the same classes).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | — | The headline's id; the `<article>` is `aria-labelledby` it. |
| `kick` | `string` | — | The running head ("Opening", "The summary"). |
| `num` | `string` | — | The right-hand part of the running head ("Ready", "3 of 8"). Omitted when absent. |
| `title` | `string` | — | The headline; `*words*` are italic. |
| `orb` | `boolean` | `true` | Passed to `Headline`. |
| `dek` | `string` | — | One line under the headline (`st-dek`). |
| `className` | `string` | `''` | Added after `st-sheet`. |
| `children` | `ReactNode` | — | The body. |

DOM:

```html
<article class="st-sheet {className}" aria-labelledby="{id}">
  <p class="o5-kicker st-kick"><span>{kick}</span><span class="st-num">{num}</span></p>  <!-- st-num only with num -->
  {Headline text={title} id={id} orb={orb}}
  <p class="st-dek">{dek}</p>   <!-- only with dek -->
  {children}
</article>
```

CSS: `.st-sheet` is a column with `gap: 16px` and `padding: clamp(28px, 7vh, 64px) 0 calc(env(safe-area-inset-bottom, 0px) + 18vh)`, so the page ends well above the bottom bar and the keyboard. `.st-dek` is the display face at `clamp(18px, 2.4vw, 22px)`, `max-width: 34ch`, `color: var(--text-2)`.

Motion: none of its own (the `Stage` moves the whole screen). Accessibility: `<article>` named by its headline.

```tsx
<Page id="st-start-t" kick="Opening" title="What shall we *plan?*" orb={picked === null} dek="Pick one. Every choice is a short walk, one question at a time.">
  <Choices items={START} picked={picked} onPick={(l) => void pick(l)} delay={0.2} />
</Page>
```

---

## 6. Rows and Row

File: `src/components/Sheets.tsx`.

### Rows

A list whose rows come in one after another on a spring, out of a blur.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `children` | `ReactNode[]` | — | One element per row (usually `Row`). Keys are the index, so give the array a stable order. |
| `label` | `string` | — | `aria-label` of the `<ol>`. |
| `delay` | `number` | `0.12` | Seconds before the first row. |

DOM: `<ol class="st-contents" aria-label="{label}"><li>…</li>…</ol>` (each `<li>` is a `motion.li`).

Motion (full): `initial { opacity: 0, y: 22, filter: blur(10px) }` → `animate { opacity: 1, y: 0, filter: blur(0px) }` with `{ ...SPRING.bouncy, delay: delay + i * 0.055 }`; lite/off: the same target with `transitionFor(level)`. See `docs/05-motion.md` §12.4.

### Row

One row of a contents list: a framed icon or a two-digit folio, a title and a line of meta. A button when it has `onClick`.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `icon` | `IconName` | — | Framed icon on the left. When absent, `n` is shown instead. |
| `n` | `number` | — | Folio, printed `String(n).padStart(2, '0')` (`01`, `02`…), `aria-hidden`. Give one or the other: with neither, the folio prints `undefined`. |
| `title` | `string` | — | |
| `meta` | `string` | — | `"A trip · Draft · Today"`. |
| `onClick` | `() => void` | — | With it the row is a `<button type="button" class="st-row">` (`motion.button`, `whileTap { scale: 0.98 }`); without, a `<div class="st-row st-row-static">`. |

DOM:

```html
<button type="button" class="st-row">            <!-- or <div class="st-row st-row-static"> -->
  <span class="st-ico">svg</span>                 <!-- icon -->
  <span class="st-row-n" aria-hidden>01</span>   <!-- or n -->
  <span class="st-row-t">{title}</span>
  <span class="st-row-m">{meta}</span>
</button>
```

CSS: `.st-row` is a two-column grid (`44px minmax(0, 1fr)`), `min-height: 72px`, hairline below (and above the first row of a list); the first child spans both text rows. On hover the title turns accent. `.st-row-n` is the display face, italic, 26 px, in the accent.

Accessibility: a tappable row is a real button whose name is the title and meta together; the folio is hidden.

```tsx
<Rows label="Contents">
  {[
    <Row key="new" icon="plus" title={newLabel} meta={newHint ?? flows.map((f) => f.label).join(' or ')} onClick={onNew} />,
    ...(onTalk ? [<Row key="talk" icon="talk" title={talkLabel} meta={talkHint} onClick={onTalk} />] : []),
    ...runs.map((r, i) => {
      const flow = guide.flows[r.flowId];
      return (
        <Row
          key={r.id}
          n={i + 1}
          title={r.title || `Untitled ${(flow?.label ?? 'run').toLowerCase().replace(/^(a|an|the) /, '')}`}
          meta={`${flow?.label ?? r.flowId} · ${statusLabel[r.status]} · ${whenOf(r.updatedAt)}`}
          onClick={() => onOpen(r)}
        />
      );
    }),
  ]}
</Rows>
```

(`Sheets.tsx` also exports `statusLabel`, how a run's status reads on screen: `{ draft: 'Draft', done: 'Finished' }`.)

---

## 7. Contents

File: `src/components/Sheets.tsx`. The contents page: the guide's welcome, a row to start something new, an optional row to talk it through, then every run as a numbered row. It is the usual first screen.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `guide` | `Guide` | — | For the welcome headline (`mark`) and the flows' labels. |
| `runs` | `Run[]` | — | Newest first (`listRuns` sorts by `updatedAt`). |
| `onOpen` | `(r: Run) => void` | — | Tap a run's row. |
| `onNew` | `() => void` | — | The first row. |
| `newLabel` | `string` | `'Start something new'` | The first row's title. |
| `newHint` | `string` | — | The first row's meta. Default: the flows' labels joined with `' or '` (`"A trip or An evening"`). |
| `onTalk` | `() => void` | — | With it, a second row opens a conversation. |
| `talkLabel` | `string` | `'Talk it through'` | |
| `talkHint` | `string` | `'Plan it in conversation'` | |

Copy, exactly (`count = runs.length`):

| Element | With runs | Without |
|---|---|---|
| `st-num` | `"{count} draft"` / `"{count} drafts"` | `"New here"` |
| Headline | `Your *drafts*` | `Welcome to {mark[0]} *{mark[1]}*` |
| `st-dek` | `Pick one up where you left it, or start something new.` | `Everything you make lives here. Start your first one.` |

Rows (`Rows label="Contents"`): `Row icon="plus"` (`newLabel`, `newHint`), then `Row icon="talk"` when `onTalk` is given, then one numbered row per run with title `r.title || "Untitled {flow label, lower-cased, leading a/an/the removed}"` and meta `"{flow.label} · {Draft|Finished} · {whenOf(updatedAt)}"` (`whenOf` from `src/flow/runs.ts`: `Today`, `Yesterday`, `{n} days ago`, else a short date).

DOM root: `<article class="st-sheet st-home" aria-labelledby="st-home-t">`, kicker `<span>Contents</span>`, headline id `st-home-t` with the orb spot (default), then `st-dek`, then the `Rows`. `.st-home` has no rule of its own in `pages.css`; it is a hook.

Motion: the rows stagger (`Rows`, default `delay 0.12`). Accessibility: as `Page` and `Row`.

```tsx
if (view === 'contents') body = <Contents guide={guide} runs={runs} onOpen={open} onNew={() => setView('start')} onTalk={() => setView('talk')} />;
```

---

## 8. Gate

File: `src/components/Sheets.tsx`. An agreement gate: a page that asks one yes/no before anything else (house rules, an age check, terms). The orb waits beside the headline until a choice is made. The app decides when to show it and what to remember (`docs/07-layout-and-navigation.md` §8).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `title` | `string` | — | The headline; `*words*` are italic. |
| `dek` | `string` | — | One line under the headline. |
| `rules` | `string[]` | — | Shown as `<ul class="st-rules">` under the dek (omitted when empty). |
| `yes` | `Choice` | — | The agreeing answer. |
| `no` | `Choice` | — | The declining answer. |
| `picked` | `string \| null` | — | The label just picked (lifts while the other leaves), or null. |
| `onPick` | `(agreed: boolean) => void` | — | `true` when the label picked is `yes.label`. |
| `kick` | `string` | `'Before we begin'` | The running head. |
| `num` | `string` | — | The right-hand part of the running head ("Step 1", "v2"). |

DOM:

```html
<article class="st-sheet" aria-labelledby="st-gate-t">
  <p class="o5-kicker st-kick"><span>{kick}</span><span class="st-num">{num}</span></p>
  {Headline text={title} id="st-gate-t" orb={picked === null}}
  <p class="st-dek">{dek}</p>
  <ul class="st-rules"><li>{rule}</li>…</ul>
  {Choices items={[yes, no]} picked={picked} onPick={(l) => onPick(l === yes.label)} delay={0.3}}
</article>
```

States: `picked === null` (both answers shown, orb on the headline) → `picked` set (the chosen answer lifts, the other leaves, the headline's spot is gone so the orb moves onto the chosen answer's spot).

Motion: through `Choices` with `delay 0.3`. Accessibility: `<article>` named by `st-gate-t`; the rules are a real list; the two answers are buttons with `aria-pressed`.

The example app has no gate. A minimal use:

```tsx
<Gate
  title="Before we *begin.*"
  dek="Two things to agree to."
  rules={guide.rules ?? []}
  yes={{ label: 'I agree', hint: 'And I am ready to start' }}
  no={{ label: 'Take me back' }}
  picked={picked}
  onPick={(agreed) => void agree(agreed)}
/>
```

(Not from the example; `agree` is the app's own handler, see `docs/07-layout-and-navigation.md` §8.)

---

## 9. Choices

File: `src/components/Choices.tsx`. The answers to one question, each its own piece on a spring. They come in one after another out of a blur; pick one and it lifts while the others leave one by one, and (with `layoutPrefix`) it then flies into the trail of answers above.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `items` | `Choice[]` | — | The answers shown, in order. |
| `picked` | `string \| null` | — | The label being picked. While set, only that item stays (`shown = items.filter(c => c.label === picked)`); the rest exit. |
| `onPick` | `(label: string) => void` | — | |
| `layoutPrefix` | `string` | — | The picked item gets `layoutId={layoutPrefix}` so it can fly to a matching `layoutId` elsewhere (`Walk` uses `ans-{stepId}`). |
| `delay` | `number` | `0.08` | Seconds before the first answer arrives (after the question). |
| `label` | `string` | `'Answers'` | `aria-label` of the list. |
| `recommended` | `string \| null` | — | The orb's pick: that item is marked and carries an `OrbSpot`, only while `picked === null`. |

DOM:

```html
<ul class="st-choices" aria-label="Answers">
  <li>  <!-- motion.li, key = label -->
    <button type="button" class="st-choice" data-rec aria-pressed="false" disabled?>   <!-- motion.button -->
      <span class="st-rec">The orb’s pick</span>         <!-- only when recommended -->
      <span class="st-lb">{label}</span>
      <span class="st-ht">{hint}</span>                  <!-- only with a hint -->
      <span class="st-choice-spot" data-orb-spot="" data-orb-size="40" role="presentation"></span> <!-- chosen or recommended -->
    </button>
  </li>
</ul>
```

States:

| State | Condition | How it shows |
|---|---|---|
| Rest | `picked === null`, not recommended | `aria-pressed="false"`, enabled, `color: var(--text-2)`; hover turns `var(--text)`. |
| Recommended | `picked === null && recommended === label` | `data-rec=""`, `<span class="st-rec">The orb’s pick</span>` (accent, uppercase), an `OrbSpot(40, 'st-choice-spot')` so the orb sits on it. CSS `.st-choice[data-rec]` brightens the words. |
| Chosen | `picked === label` | `aria-pressed="true"`, `OrbSpot(40)`; CSS: `padding-left: 12px`, the label italic with ` ✦` appended in the accent (`.st-choice[aria-pressed='true'] .st-lb::after`). |
| Disabled | `picked !== null` | every button `disabled`. |
| Orb hover / press | set by the orb, not here | `data-orb-hover` / `data-orb-pressed` on the control the dragged orb is over or was dropped on (`.st-choice[data-orb-hover]` matches the hover colour; see `docs/09-orb.md` §9). |

Motion props: `delay`, `layoutPrefix`; level-aware through `useMotionLevel()`. In full: each `<li>` enters from `{ opacity: 0, y: 26, filter: blur(10px) }` with `{ ...SPRING.bouncy, delay: delay + i * 0.055 }`; the chosen one animates to `scale: 1.03` with `SPRING.playful`; the others exit to `{ opacity: 0, x: -36, filter: blur(12px) }` with `{ ...SPRING.smooth, delay: i * 0.04 }`; `layout="position"` lets the survivor slide; `whileTap { scale: 0.97 }` while enabled. Lite/off: fades with `transitionFor(level)`, no layout animation. The list is one `AnimatePresence initial custom={0}`. See `docs/05-motion.md` §12.1.

Accessibility: a real `<ul>` with a name; each answer a `<button>` whose name is the label and hint; `aria-pressed` tells the state; the "The orb’s pick" kicker is read as part of the button.

```tsx
<Choices items={choices} picked={picked} onPick={onPick} layoutPrefix={`ans-${step.id}`} delay={done.length ? 0.3 : 0.12} recommended={recommended} />
```

---

## 10. Walk

File: `src/components/Walk.tsx`. A flow as one scroll: the answers so far stacked small at the top (blurred as they leave the middle; tap one to go back to it) and the question you are on in the middle. A picked answer flies up into the stack; the next question comes in below it. It brings its own scroller, so `Stage` gets `walking`.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `flow` | `Flow` | — | The flow being walked. |
| `answers` | `Answers` | — | So far. The trail is `stepsFor(flow, answers)` filtered to answered steps, in flow order. |
| `step` | `Step` | — | The question on screen (`nextStep`). |
| `n` | `number` | — | Where the flow is, for the running head ("3 of 7"). |
| `total` | `number` | — | |
| `choices` | `Choice[]` | — | The answers on offer (the assistant's suggestions merged over the step's own, `mergeChoices`). |
| `suggesting` | `boolean` | `false` | Whether the assistant is still thinking of more answers; shows "Thinking of more…". |
| `picked` | `string \| null` | — | The label just picked (it lifts while the others leave), or null. |
| `onPick` | `(label: string) => void` | — | A ready answer or your own words. |
| `onPickForMe` | `() => void` | — | The first shortcut. |
| `onFinishForMe` | `() => void` | — | The second shortcut. |
| `onRevisit` | `(stepId: string) => void` | — | Tap an earlier answer: go back to that question. |
| `recommended` | `string \| null` | — | The orb's pick for this question; passed to `Choices`. When set the headline keeps no spot. |
| `custom` | `ReactNode` | — | A custom step (one that is not a list of answers) brings its own body here; the app renders it. With it the answers, the own-words form, the shortcuts and the suggesting line are all hidden. |

DOM:

```html
<div class="st-scroll">                                         <!-- ref: scroller; useScrollDepth(scroller, true, 'center') -->
  <!-- LayoutGroup -->
  <ol class="st-trail" aria-label="Your answers so far">        <!-- only when done.length > 0 -->
    <li data-depth="">
      <button type="button" class="st-trail-row" aria-label="{key}: {answer}. Change it">
        <span class="o5-kicker">{key}</span>
        <span class="st-trail-ans">{answer}</span>              <!-- motion.span layoutId="ans-{stepId}" -->
      </button>
    </li>
  </ol>
  <section class="st-now" aria-labelledby="q-{stepId}">         <!-- motion.section key=step.id, ref: now -->
    <p class="o5-kicker st-kick"><span>{step.kick}</span><span class="st-num">{n} of {total}</span></p>
    {Headline text={step.q} id="q-{stepId}" orb={!busy && !recommended && !custom}}
    <p class="st-dek">{step.dek}</p>                             <!-- only with dek -->
    {custom ?? Choices items={choices} picked={picked} onPick={onPick} layoutPrefix="ans-{stepId}" delay={done.length ? 0.3 : 0.12} recommended={recommended}}
    <p class="st-predicting">Thinking of more…</p>              <!-- suggesting && !busy && !custom -->
    <form class="st-own">                                        <!-- motion.form: !step.closed && !busy && !custom -->
      <label class="o5-kicker" for="own-{stepId}">Or in your own words</label>
      <input id="own-{stepId}" placeholder="Something else…" autocomplete="off" enterkeyhint="next">
      <button type="submit" disabled={!own.trim()}>Use this</button>
    </form>
    <p class="st-shortcuts">                                     <!-- motion.p: !busy && !custom -->
      <button type="button"><SqIcon name="shuffle"/> Pick for me</button>
      <button type="button"><SqIcon name="forward"/> Finish it for me</button>
    </p>
  </section>
</div>
```

Behaviour:

- `busy = picked !== null`; `done = stepsFor(flow, answers).filter((s) => s.id in answers)`.
- On every `step.id` change (`useLayoutEffect`): the own-words box is cleared and the scroller scrolls so the current section sits 20 % down: `box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight * 0.2), behavior: full ? 'smooth' : 'auto' })`.
- `useScrollDepth(scroller, true, 'center')` writes `--p`/`--ap` on each `[data-depth]` trail row; `pages.css` sinks, shrinks and blurs rows leaving the middle under `data-motion='full'` and only fades them under `'lite'` (`docs/05-motion.md` §9).
- Own words: submitting a non-empty trimmed value calls `onPick(value)`; the app stores it verbatim.
- The trail's answer and the picked answer share `layoutId="ans-{stepId}"` inside one `LayoutGroup`, so when the next step renders the picked answer flies to its row.
- Where the orb goes: with `recommended`, onto the recommended answer's spot; while busy, onto the chosen answer's spot; with `custom`, there is no spot and no recommended answer, so the orb falls back to the custom body's `button[type="submit"]` (`docs/09-orb.md` §8, priority 4); otherwise it waits beside the headline.

States: a trail or none; the question at rest, busy (`picked` set), suggesting, closed (`step.closed`: no own-words form), custom (`custom` set).

Motion (full): the section enters from `{ opacity: 0, y: 40, filter: blur(12px) }` with `{ ...SPRING.smooth, delay: done.length ? 0.18 : 0 }`; the own-words form from `{ opacity: 0, y: 16, filter: blur(8px) }` with `{ ...SPRING.smooth, delay: 0.5 }`; the shortcuts fade in with `{ ...SPRING.smooth, delay: 0.6 }`; trail answers use `SPRING.default` for the layout flight. Lite/off: fades with `transitionFor(level)`. `.st-predicting` pulses by CSS (`st-pulse`, off under reduced motion). See `docs/05-motion.md` §12.2.

Accessibility: the trail is a named list of buttons, each telling the key, the answer and that tapping changes it; the question is a `<section>` named by its `<h2>`; the own-words field has a visible `<label>`; `enterkeyhint="next"`.

```tsx
<Walk
  flow={flow}
  answers={run.answers}
  step={step}
  n={n}
  total={total}
  choices={offered}
  recommended={rec?.label ?? null}
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
  suggesting={suggesting}
  picked={picked}
  onPick={(l) => void pick(l)}
  onPickForMe={pickForMe}
  onFinishForMe={() => void finishForMe()}
  onRevisit={revisit}
/>
```

---

## 11. Conversation

File: `src/components/Conversation.tsx`. A conversation, typed or spoken: a thread, ready openers and follow-ups as answers on springs, and the actions an app wants to offer from what was said. `forwardRef<HTMLElement>` to the `<article>`.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `title` | `string` | — | The headline; `*words*` are italic. |
| `kicker` | `string` | — | The running head over the headline. |
| `num` | `string` | — | The right-hand part of the running head. |
| `starters` | `Choice[]` | — | Ready openers, shown while nothing has been said. |
| `followUps` | `Choice[]` | — | Ready ways to carry on, shown after each reply. |
| `system` | `string` | `'Talk like a helpful companion: short replies, one idea at a time, and offer two or three directions to take it.'` | The assistant's instructions for this conversation (the first, system message). |
| `onSend` | `(text: string, history: ChatMessage[], signal?: AbortSignal) => Promise<string>` | — | Answer one turn with the whole reply. |
| `mic` | `Mic` | — | The mic slot (below). Without it there is no mic button. |
| `onWake` | `() => void` | — | Called when the adapter's assistant is not awake; the app may start waking it. |
| `actions` | `ConversationAction[]` | `[]` | Buttons under the thread once something has been said. |
| `placeholder` | `string` | `'Say what you have in mind…'` | The box's placeholder. |

The two slots:

```ts
/** A microphone, if the app has one: the "mic slot". Without it there is no mic button. */
export interface Mic {
  /** Whether this device can listen at all. */
  canListen(): boolean;
  /**
   * Start listening. `onLevel` gets the mic level (0…1) for the orb's glow; `onPartial` the words so
   * far; `onDone(text)` once you stop talking (or `finish()`); `onError` with a plain message.
   */
  listen(h: { onLevel: (v: number) => void; onPartial: (text: string) => void; onDone: (text: string) => void; onError: (message: string) => void }): {
    /** Stop listening and use what was heard so far. */
    finish(): void;
    /** Stop and throw it away. */
    cancel(): void;
  };
}

/** A button under the thread once something has been said ("Plan it", "Save this"). */
export interface ConversationAction {
  label: string;
  icon?: IconName;
  /** Called with the last thing you said (up to 120 characters), so the app can start from it. */
  onClick: (seed: string) => void;
}
```

**`onSend` vs the Assistant adapter.** Either give `onSend` (the whole reply at once), or set an `Assistant` through `setAssistant()` (streamed, `src/flow/adapter.ts`). With neither, sending shows `No assistant is plugged in yet.` and keeps your words in the box. The two paths differ in what they are handed:

| Path | Messages given | Reply |
|---|---|---|
| `onSend(v, [first, ...msgs], signal)` | the system message, then the turns **before** this one; `v` is the new text, passed separately | resolved string, shown at once |
| `a.chat([first, ...history], onText, signal)` | the system message, then every turn **including** the new one | streamed; each piece appends to the reply |

Before the adapter is used: `getAssistant()` null → error `No assistant is plugged in yet.`; `!a.awake()` → `onWake?.()` then error `The assistant is waking up. Try again in a couple of minutes.` (the error carries `status: 503`).

DOM:

```html
<article class="st-sheet st-talk" aria-labelledby="st-talk-t">
  <p class="o5-kicker st-kick"><span>{kicker}</span><span class="st-num">{num}</span></p>
  {Headline text={title} id="st-talk-t"}                                         <!-- orb spot, always -->
  <div class="st-thread" aria-live="polite">
    <p class="st-said">{you}</p> <p class="st-reply">{reply or …}</p> …           <!-- one <p> per message, key = index -->
    <div></div>                                                                   <!-- scroll anchor -->
  </div>
  <p class="st-error" role="alert">{error}</p>                                    <!-- only with an error -->
  {Choices items={msgs.length ? followUps : starters} label="Ways to start"|"Where to take it" delay={0.2|0.1}}  <!-- !busy; key = msgs.length -->
  <p class="st-shortcuts" aria-label="Next">                                      <!-- seed && !busy && actions.length > 0 -->
    <button type="button"><SqIcon name={icon}/> {label}</button>…
  </p>
  <form class="st-own">
    <label class="o5-kicker" for="st-talk-in">Say it or type it | Listening…</label>
    <input id="st-talk-in" placeholder="{placeholder}" autocomplete="off" enterkeyhint="send">
    <button type="button" class="st-mic" aria-pressed={!!hearing} aria-label="Speak|Stop listening"><SqIcon name="mic"/></button>  <!-- mic?.canListen() -->
    <button type="submit" disabled={!text.trim() || busy}>Send</button>
  </form>
</article>
```

Behaviour:

- **Starters and follow-ups.** While the thread is empty the `Choices` are `starters` (`label="Ways to start"`, `delay 0.2`); after that, `followUps` (`label="Where to take it"`, `delay 0.1`). The list is keyed by `msgs.length`, so it re-enters after every turn, and it is hidden while `busy`. Picking one (`choose`): ignored while a pick is in flight or busy; `orbHome()`; `picked` is set for `520 ms` (full), `200 ms` (lite) or `0` (off), then cleared; a starter is sent as `` `Let's start with: ${label.toLowerCase()}${hint ? ` (${hint.toLowerCase()})` : ''}.` ``, a follow-up as its label.
- **Sending** (`send`): ignored when empty or busy. The box is cleared, the error removed, your turn and an empty assistant turn are added at once, `busy` is set and an `AbortController` made. Streamed text fills the assistant turn as it arrives.
- **The empty-reply rule.** On failure with nothing received (`!reply`), the thread is put back to what it was before the send (`setMsgs(msgs)`, which removes both your turn and the empty reply) and your words go back into the box (`setText(v)`); the error's message is shown. If some text had arrived it stays. An `AbortError` is silent. Unmounting aborts the request in flight.
- An empty assistant turn renders as `…`; the thread scrolls to its anchor on every change (`scrollIntoView({ block: 'end', behavior: 'smooth' })`); every change in `msgs.length` calls `orbHome()`.
- **The mic slot.** The mic button shows only when `mic?.canListen()`. Tap: if already hearing, `hearing.finish()`; else `mic.listen({...})` with `onLevel → orbThink(v)`, `onPartial → setText(t)`, `onDone → setHearing(null); orbThink(null); send(t)`, `onError → setHearing(null); setError(m)`. While hearing the label reads `Listening…` and the button is `aria-pressed="true"` (accent, `.st-mic[aria-pressed='true']`). No microphone code is in the package; `src/ai/webSpeech.ts` is one way to fill the slot.
- **The actions slot.** `seed` is the last thing you said, first 120 characters. When there is a seed, nothing is busy and `actions` is not empty, a `<p class="st-shortcuts" aria-label="Next">` shows one button per action; pressing it calls `onClick(seed)`.

States: empty thread (starters) · after a reply (follow-ups, actions) · busy (no answers, Send disabled, the reply filling) · error (`st-error`) · hearing.

Motion: through `Choices`; the thread itself does not animate. See `docs/05-motion.md` §12.6.

Accessibility: the thread is `aria-live="polite"` so replies are read as they land; errors are `role="alert"`; the field has a visible label; the mic button reports its state with `aria-pressed` and changes its name; `enterkeyhint="send"`.

```tsx
<Conversation
  title="Where shall we *go?*"
  kicker="Talk"
  num={guide.name}
  starters={guide.starters ?? []}
  followUps={guide.followUps ?? []}
  placeholder="A week somewhere warm…"
  actions={[
    { label: 'Plan a trip from this', icon: 'forward', onClick: (seed) => startFlow('trip', seed) },
    { label: 'Just an evening', icon: 'talk', onClick: (seed) => startFlow('evening', seed) },
  ]}
  // No AI in the sample: a canned reply. Replace with an Assistant (setAssistant) or your own onSend.
  onSend={async (text) => {
    await wait(600);
    return `“${text.slice(0, 60)}” — good. Picture the season first: spring, summer or autumn? Then tell me who is coming, or tap “Plan a trip from this”.`;
  }}
/>
```

---

## 12. Summary pieces

File: `src/components/Summary.tsx`. The summary and what comes after it, as presentational pieces. The app composes them around whatever it does with the finished answers; nothing here talks to a network.

### SummaryList

Every answer under its name, in order (from `summaryOf(flow, answers)`).

| Prop | Type | Meaning |
|---|---|---|
| `items` | `{ key: string; value: string }[]` | |

DOM: `<dl class="st-summary"><div><dt>{key}</dt><dd>{value}</dd></div>…</dl>`. CSS: each `<div>` is a grid `minmax(96px, 30%) minmax(0, 1fr)` with a hairline below; `<dt>` uppercase 11 px, `<dd>` the display face at 20 px.

### Go

The one button a screen wants pressed next, in a band that stays in reach at the foot of the page, with a place for the orb on it. `children` go beside it (a `Ghost` button or a line of hint).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `label` | `string` | — | |
| `onClick` | `() => void` | — | |
| `disabled` | `boolean` | — | |
| `children` | `ReactNode` | — | Beside the button, inside the dock. |

DOM:

```html
<div class="st-dock">
  <button type="button" class="st-go" disabled?>{label}<span class="st-choice-spot" data-orb-spot="" data-orb-size="40" role="presentation"></span></button>
  {children}
</div>
```

CSS: `.st-dock` is `position: sticky; bottom: 0; z-index: 2` with a gradient to the page background so the button never floats over text; `.st-go` is ink on paper (`background: var(--text); color: var(--bg)`), 52 px tall, uppercase 12 px, accent on hover, `padding-right: 64px` in the dock for the orb.

### Ghost

A second, quieter action beside the primary one ("Start again").

| Prop | Type |
|---|---|
| `label` | `string` |
| `onClick` | `() => void` |
| `disabled` | `boolean` |

DOM: `<button type="button" class="st-ghost">{label}</button>`: underlined uppercase 11 px, 44 px tall, 40 % opacity when disabled.

### Progress

While the app works: a bar (known progress in %, or a busy sweep when `progress` is null), the current note and a line saying you can leave.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `progress` | `number \| null` | — | 0..100, or null while nothing is known yet. |
| `note` | `string \| null` | — | Shown in `st-dek`; `null` shows `Starting…`. |
| `hint` | `string \| null` | `'You can leave this page. It keeps going, and it will be in your drafts when it is done.'` | The `st-ht` line; `null` hides it. |
| `idle` | `number` | `8` | The bar's width (%) while progress is unknown. |

DOM:

```html
<div class="st-making" role="status">
  <div class="st-bar" aria-hidden><span style="width: {progress ?? idle}%" class="st-bar-busy?"></span></div>
  <p class="st-dek">{note ?? 'Starting…'}</p>
  <p class="st-ht">{hint}</p>   <!-- unless hint is null -->
</div>
```

States: known progress (the bar's width tweens over 600 ms) · unknown (`st-bar-busy`, a sweep by CSS keyframes `st-busy`, off under reduced motion). Accessibility: `role="status"`, so the note is announced as it changes; the bar is decoration.

### Result

What came out: a picture (`kind: 'image'`), a video with controls (`kind: 'video'`), or anything else the app renders as `children` (a list, a map, a document).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `kind` | `'image' \| 'video'` | — | |
| `url` | `string` | — | |
| `alt` | `string` | `''` | The image's alt text. |
| `children` | `ReactNode` | — | Rendered when `kind`/`url` do not give an image or a video. |

DOM: `<figure class="st-result">` with `<img src alt>`, or `<video src controls playsinline loop>`, or the children. CSS: media is `width: 100%; max-height: 64vh; object-fit: contain; background: #000`.

### ErrorLine

One line of error, announced: `<p class="st-error" role="alert">{children}</p>` (a 2 px accent-red rule on the left).

Motion: none of their own; the summary screen is moved by the `Stage`. The pieces as the example composes them:

```tsx
<article className="st-sheet st-summary-page" aria-labelledby="st-summary-t">
  <p className="o5-kicker st-kick">
    <span>The summary</span>
    <span className="st-num">{run.status === 'done' ? 'Finished' : saving ? 'Saving' : 'Ready'}</span>
  </p>
  {done ? <Headline text="Here is your *plan.*" id="st-summary-t" /> : saving ? <Headline text="Saving your *plan…*" id="st-summary-t" /> : <Headline text="Here is your *summary.*" id="st-summary-t" orb={false} />}
  {done && <Result kind="image" url={result} alt={resultOf(flow, run.answers)} />}
  {!done && <SummaryList items={summaryOf(flow, run.answers)} />}
  {saving && <Progress progress={null} note={note} />}
  {run.status === 'draft' && !saving && <Go label="Save the plan" onClick={() => void save()} />}
</article>
```

Note the orb: while the run is a draft the headline has no spot (`orb={false}`) and the orb sits on the `Go` button; while saving and once done it returns to the headline.

---

## 13. Root, TopBar, Stage, BottomBar

File: `src/components/Bars.tsx`. The frame of every screen: a top bar (the masthead and two square buttons), the stage in the middle (the only part that moves) and a bottom bar (Back, Home, Save draft). The screen logic that decides what each button does stays in the app: `docs/07-layout-and-navigation.md` §5 and §6.

### Root

The fixed, full-screen root: top bar, stage and bottom bar in a three-row grid.

| Prop | Type | Meaning |
|---|---|---|
| `view` | `string` | Written as `data-view`, a CSS hook for the current screen. |
| `children` | `ReactNode` | The bars, the stage, the drawers, the toasts. |

DOM: `<div class="st-root" data-view="{view}">…</div>`. CSS: `position: fixed; inset: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto`, the page background (`var(--o5-glow), var(--bg)`); every button inside inherits font and colour and loses the tap highlight; `:focus-visible` is a 2 px accent outline, offset 3 px.

### TopBar

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `kicker` | `string` | — | The small line over the masthead ("A sample guide"). |
| `mark` | `[string, string]` | — | The masthead: the roman half and the italic half ("Com", "pass"). |
| `actions` | `boolean` | `true` | Show the two square buttons (hide them on a gate). |
| `onOptions` | `() => void` | — | The first square. |
| `onGallery` | `() => void` | — | The second square. |
| `optionsLabel` | `string` | `'Options'` | `aria-label` of the first square (icon `options`). |
| `galleryLabel` | `string` | `'Your gallery'` | `aria-label` of the second square (icon `menu`). |
| `label` | `string` | `'Site'` | The `<nav>`'s accessible name. |

DOM:

```html
<header class="st-top">
  <div class="st-flag"><small>{kicker}</small><b>{mark[0]} <i>{mark[1]}</i></b></div>
  <nav class="st-top-actions" aria-label="Site">                                   <!-- when actions -->
    <button type="button" class="st-sq" aria-label="Options"><SqIcon name="options"/></button>
    <button type="button" class="st-sq" aria-label="Your gallery"><SqIcon name="menu"/></button>
  </nav>
</header>
```

CSS: a flex row, hairline below, padded `calc(env(safe-area-inset-top, 0px) + 10px)` on top and the gutter plus the side safe areas left and right; `.st-flag b` is the display face at 26 px, `.st-flag i` italic in the accent; `.st-sq` is a 44 × 44 hairline square. The masthead is not a button.

### Stage

One screen at a time. When `screenKey` changes the old screen leaves (sinking into a blur) before the next rises in (`AnimatePresence mode="wait"`). A walking screen brings its own scroller; every other screen is wrapped in one column (`.st-scroll`).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `screenKey` | `string` | — | When it changes, the old screen exits fully before the new one enters. The example uses `` `${screen}|${run?.id ?? ''}` `` (`docs/07-layout-and-navigation.md` §3). |
| `walking` | `boolean` | `false` | `true` when the child is a `Walk` (it has its own `st-scroll`). |
| `children` | `ReactNode` | — | The screen. |

DOM:

```html
<main class="st-stage" id="st-stage">
  <!-- AnimatePresence mode="wait" initial={false} -->
  <div class="st-view">                 <!-- motion.div key={screenKey} -->
    <div class="st-scroll">…</div>      <!-- unless walking -->
  </div>
</main>
```

Motion (full): enter from `{ opacity: 0, y: 28, filter: blur(14px) }` with `SPRING.smooth`; exit to `{ opacity: 0, y: -18, filter: blur(14px) }` with `{ ...SPRING.smooth, stiffness: 260 }`. Lite/off: opacity only, `transitionFor(level)`. `initial={false}` means the first screen does not animate in. See `docs/05-motion.md` §12.3.

CSS: `.st-stage` is `position: relative; min-height: 0; overflow: hidden`; `.st-view` is `position: absolute; inset: 0; will-change: transform, opacity, filter` (so the leaving and arriving screens overlap); `.st-scroll` is `height: 100%; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain` with the side gutters, and its children are centred at `max-width: var(--st-col)` (760 px).

Accessibility: one `<main>`; the landmark's content is the current screen's `<article>`.

### BottomBar

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `canBack`, `canHome`, `canSave` | `boolean` | — | Enable each button. |
| `onBack`, `onHome`, `onSave` | `() => void` | — | |
| `backLabel` | `string` | `'Back'` | |
| `homeLabel` | `string` | `'Home'` | |
| `saveLabel` | `string` | `'Save draft'` | |

DOM:

```html
<footer class="st-bottom">
  <button type="button" class="st-bar-btn" disabled?><SqIcon name="back"/> <span>Back</span></button>
  <button type="button" class="st-bar-btn" disabled?><SqIcon name="home"/> <span>Home</span></button>
  <button type="button" class="st-bar-btn" disabled?><SqIcon name="save"/> <span>Save draft</span></button>
</footer>
```

CSS: three equal columns, hairline above, translucent (`color-mix(in srgb, var(--bg) 80%, transparent)` with `backdrop-filter: blur(18px) saturate(1.3)`), padded for the bottom and side safe areas; buttons 54 px tall, uppercase 11 px (10 px under 560 px wide), 30 % opacity when disabled, accent on hover.

Motion: the bars never animate between views. Accessibility: a `<footer>` of three real buttons with visible text; disabled, not hidden, when they do nothing.

```tsx
<Root view={view}>
  <TopBar kicker={guide.kicker} mark={guide.mark} onOptions={() => setOptions(true)} onGallery={() => setTab('drafts')} />
  <Stage screenKey={`${screen}|${run?.id ?? ''}`} walking={walking}>
    {body}
  </Stage>
  <BottomBar canBack={canBack} canHome={view !== 'contents'} canSave={Boolean(canSave)} onBack={goBack} onHome={goHome} onSave={saveDraft} />
  …
  <Toasts />
</Root>
```

---

## 14. Drawers

File: `src/components/Drawer.tsx`. Drawers slide in from the right over a blur: the gallery (with tabs across the top) and the options. One generic `Drawer` plus the pieces it is usually filled with. Escape and the scrim close it.

### Drawer

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `label` | `string` | — | The dialog's accessible name ("Compass: your gallery"). |
| `title` | `ReactNode` | — | The heading; put the italic half in `<em>` (`<>Your <em>gallery</em></>`). |
| `onClose` | `() => void` | — | Escape, the scrim and the close button. |
| `closeLabel` | `string` | `'Close'` | `aria-label` of the close button. |
| `scrimLabel` | `string` | `'Close'` | `aria-label` of the scrim. |
| `tabs` | `DrawerTab<T>[]` | — | `{ id: T; label: string; icon: IconName }[]` across the top; omit for a plain drawer. |
| `tab` | `T` | — | The pressed tab. |
| `onTab` | `(id: T) => void` | — | |
| `tabsLabel` | `string` | `'Tabs'` | `aria-label` of the tab `<nav>`. |
| `children` | `ReactNode` | — | With tabs, wrapped in `<div class="st-shelf">`; without, rendered as is. |

DOM:

```html
<div class="st-drawer-wrap" role="dialog" aria-modal="true" aria-label="{label}">
  <button type="button" class="st-scrim" aria-label="{scrimLabel}"></button>
  <aside class="st-drawer">
    <div class="st-drawer-head">
      <h3>{title}</h3>
      <button type="button" class="st-sq st-sq-ink" aria-label="{closeLabel}"><SqIcon name="close"/></button>
    </div>
    <nav class="st-tabs" aria-label="Tabs">                                     <!-- when tabs -->
      <button type="button" aria-pressed={tab === id}><span class="st-ico">svg</span><span>{label}</span></button>…
    </nav>
    <div class="st-shelf">{children}</div>                                     <!-- when tabs; else children directly -->
  </aside>
</div>
```

Behaviour: a `keydown` listener on `window` calls `onClose()` on `Escape` for as long as the drawer is mounted. Opening and closing are the app's conditional render; there is no exit animation. Focus is not trapped and not moved; the orb hides itself behind any `aria-modal="true"` dialog (`docs/09-orb.md` §8).

CSS: `.st-drawer-wrap` is `position: fixed; inset: 0; z-index: 60`; `.st-scrim` blurs the page (`backdrop-filter: blur(12px)`, `st-fade` 300 ms); `.st-drawer` is `width: min(460px, 92vw)` on the right, scrolls on its own, padded for the top, right and bottom safe areas, slides in with `st-slide` 520 ms (both animations off under reduced motion); the `<h3>` is the display face at 36 px with `<em>` in the accent; `.st-tabs` is an auto-fit grid of column buttons whose pressed one is `var(--text)` with an accent frame. `.st-shelf` and `.st-sq-ink` have no rules in `pages.css`; they are hooks.

Accessibility: `role="dialog" aria-modal="true"` with a name; the scrim is a labelled button, so a reader can close the drawer; tabs report `aria-pressed`.

### TABS

An example set of tabs for the gallery drawer. Define your own the same way.

```ts
export type Tab = 'drafts' | 'items' | 'about';
export const TABS: DrawerTab<Tab>[] = [
  { id: 'drafts', label: 'Drafts', icon: 'folder' },
  { id: 'items', label: 'Made', icon: 'picture' },
  { id: 'about', label: 'About', icon: 'options' },
];
```

### ContentsList

A numbered contents list inside a tab (the drafts tab). Rows arrive without motion here.

| Prop | Type | Meaning |
|---|---|---|
| `rows` | `{ id: string; title: string; meta: string; onClick: () => void }[]` | |
| `label` | `string` | `aria-label` of the `<ol>`. |

DOM: `<ol class="st-contents" aria-label="{label}"><li><button type="button" class="st-row"><span class="st-row-n" aria-hidden>01</span><span class="st-row-t">{title}</span><span class="st-row-m">{meta}</span></button></li>…</ol>`.

### MediaGrid

Pictures and videos, two across, 3:4.

| Prop | Type |
|---|---|
| `items` | `{ id: string; kind: 'image' \| 'video'; url: string; alt?: string }[]` |

DOM: `<ul class="st-grid"><li><img src alt loading="lazy"></li>` or `<li><video src muted playsinline loop controls preload="metadata"></li>…</ul>`. Missing `alt` becomes `""`.

### Empty

"Nothing here yet." → `<p class="st-empty">{children}</p>` (italic, `var(--text-3)`).

### OptionsDrawer

The options drawer: the house rules and one line about the orb.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `rules` | `string[]` | — | One `<li>` each. |
| `note` | `string` | `'Tap the orb any time to ask it something, or hold it to talk.'` | The `st-dek` line under the rules. |
| `onClose` | `() => void` | — | |

Renders `Drawer` with `label="Options"`, `title={<>House <em>rules</em></>}`, `scrimLabel="Close options"`, and children `<ul class="st-rules"><li>{rule}</li>…</ul><p class="st-dek">{note}</p>`. `.st-rules li` has a 7 px accent square on the left and a hairline below.

```tsx
{tab && (
  <Drawer label={`${guide.name}: your gallery`} title={<>Your <em>gallery</em></>} onClose={() => setTab(null)} tabs={TABS} tab={tab} onTab={setTab}>
    {tab === 'drafts' ? (
      runs.length ? (
        <ContentsList rows={runs.map((r) => ({ id: r.id, title: r.title || 'Untitled', meta: guide.flows[r.flowId]?.label ?? r.flowId, onClick: () => (setTab(null), open(r)) }))} />
      ) : (
        <Empty>No drafts yet. Start one from the contents page.</Empty>
      )
    ) : tab === 'items' ? (
      made.length ? (
        <MediaGrid items={made.map((r) => ({ id: r.id, kind: 'image', url: r.result as string, alt: r.title }))} />
      ) : (
        <Empty>Nothing made yet. Finish a plan and save it.</Empty>
      )
    ) : (
      <>
        <ul className="st-rules">
          {(guide.rules ?? []).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="st-dek">{guide.name} is a sample of the OrbitDesign look: one question at a time, with the orb beside the answer it would pick.</p>
      </>
    )}
  </Drawer>
)}
{options && <OptionsDrawer rules={guide.rules ?? []} onClose={() => setOptions(false)} />}
```

---

## 15. Toasts and toast

File: `src/components/Toasts.tsx`. Transient status messages, announced politely to screen readers. A self-contained store (`useSyncExternalStore`, no state library): `toast()` from anywhere, `<Toasts/>` once near the root.

| Export | Meaning |
|---|---|
| `toast(text, tone = 'info'): number` | Shows a message for `TOAST_MS`; returns its id. `tone` is `'info' \| 'error' \| 'success'` (`ToastTone`). |
| `TOAST_MS` | `3200` ms. |
| `dismissToast(id)` | Early dismissal (a tap does this). Ignored for an unknown id. |
| `useToasts(): Toast[]` | The current list (`{ id: number; text: string; tone: ToastTone }`), for tests or a custom view. |
| `<Toasts/>` | The view. |

DOM:

```html
<div class="toasts" role="status" aria-live="polite">
  <div class="toast glass" style="…">{text}</div>   <!-- one per toast; click dismisses -->
</div>
```

Inline style by tone: `error` → `borderColor: var(--danger); color: var(--danger)`; `success` → `borderColor: var(--success)`; `info` → none. The styles are in `src/styles/base.css` (`.toasts`: `position: absolute; left: 50%; top: calc(var(--safe-top) + 60px); z-index: 90; width: min(420px, calc(100% - 24px)); pointer-events: none`; `.toast`: padded, `var(--radius-md)`, enters with `sheet-up`) and `src/styles/glass.css` (`.glass`), not in `pages.css`. Rendered inside `.st-root` (fixed), the stack sits under the top bar.

Motion: the CSS `sheet-up` entrance; see `docs/05-motion.md` §12.11. Accessibility: one live region; every toast is read once as it is added; a toast is not focusable and goes away by itself.

```tsx
const saveDraft = () => {
  if (run) keep(run);
  toast('Saved. It is waiting in your drafts.', 'success');
  goHome();
};
```

---

## 16. useVisualViewport

File: `src/components/useVisualViewport.ts`. Tracks the *visual* viewport, which on phones shrinks when the on-screen keyboard opens (the layout viewport does not).

| Parameter | Type | Meaning |
|---|---|---|
| `onChange` | `(v: { width: number; height: number; keyboardOpen: boolean }) => void` | Optional; called after every update. |

What it sets on `<html>` (`document.documentElement.style`), rounded to whole px:

| Variable | Value |
|---|---|
| `--app-height` | the visible height, less the floating keyboard bar when one is reserved |
| `--vv-offset-top` | how far the browser has scrolled the visual viewport |
| `--keyboard-inset` | the keyboard height plus the reserved bar |

Rules, from the code:

```ts
const visible = vv?.height ?? window.innerHeight;
const offsetTop = vv?.offsetTop ?? 0;
const layoutHeight = window.innerHeight;
const keyboard = Math.max(0, layoutHeight - visible - offsetTop);
// A soft keyboard is at least ~150px; smaller differences are browser chrome changing.
const editing = isEditableFocused();
const keyboardOpen = keyboard > 150 || (editing && isCoarsePointer() && visible < layoutHeight * 0.75);
```

- **The 150 px rule.** The keyboard counts as open when the visual viewport is more than 150 px shorter than the layout viewport, or when an editable element is focused on a coarse pointer and the visible height is under 75 % of the layout height.
- **The floating bar.** On phones whose browser floats a bar (autofill, hide keyboard) above the keyboard (`floatingKeyboardBar`, detected from the user agent in the file), `FLOATING_BAR = 76` px is taken off `--app-height` and added to `--keyboard-inset` while the keyboard is open.
- **The unshift rule.** Some phone browsers scroll even `overflow: hidden` boxes to reveal a focused input under the keyboard, which leaves part of the app shifted out of view. A capturing `scroll` listener puts such boxes straight back:

```ts
const unshift = (e: Event) => {
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.scrollTop === 0) return;
  if (getComputedStyle(el).overflowY === 'hidden') el.scrollTop = 0;
};
document.addEventListener('scroll', unshift, true);
```

- Updates run once on mount and on `visualViewport` `resize` and `scroll`, `window` `resize` and `orientationchange`, and `document` `focusin` and `focusout`, coalesced to one per animation frame. Everything is removed on unmount.
- `isEditableFocused()` is true for `contentEditable`, `INPUT` or `TEXTAREA`; `isCoarsePointer()` is `matchMedia('(pointer: coarse)')`.

Note: `pages.css` does not consume these variables. `.st-root` is `position: fixed; inset: 0`, and `tokens.css` sets `--app-height: 100dvh` and `--keyboard-inset: 0px` as defaults. An app that wants the frame pinned above the keyboard gives `.st-root` `height: var(--app-height); transform: translateY(var(--vv-offset-top))` itself (see `docs/07-layout-and-navigation.md` §11). The example app calls the hook with no callback.

```tsx
export function App() {
  useVisualViewport();
```

---

## 17. Data attributes the orb reads

Set by these components; consumed by `src/orb` (`docs/09-orb.md` §8 for the order of what matters, §9 for the full list).

| Attribute | Where | Meaning |
|---|---|---|
| `data-orb-spot=""` | `OrbSpot` (in `Headline`, `Choices`, `Go`) | A place kept for the orb; it sits centred on it. (`data-orb-spot="stage"` is a different, voice-mode use; no component here sets it.) |
| `data-orb-size="{px}"` | `OrbSpot` | The orb's size on that spot: 52 beside a headline, 40 on an answer or the `Go` button. |
| `data-orb-focus` | not set by these components | An app may mark "the thing you're on" with it; the orb goes there before any spot. These screens use spots instead. |
| `data-rec` | `Choices` | The orb's pick; the recommended answer also carries a spot so the orb sits on it. |
| `data-orb-hover`, `data-orb-pressed` | set by the orb | On the control the orb is over or was dropped on (`.st-choice[data-orb-hover]`). |
| `data-depth=""` | `Walk` trail rows | `useScrollDepth` writes `--p`/`--ap` on them; `pages.css` sinks and blurs them. |
| `data-view` | `Root` | The current view, for CSS hooks. |
| `data-orb-context` | set by the app on `<html>` | A plain-language line about where the person is, appended to the orb's own requests (the example sets it; `docs/07-layout-and-navigation.md` §12). |
| `aria-modal="true"` | `Drawer` | The orb hides while such a dialog is open. |

The orb is reached only through window events (`orb:say`, `orb:energy`, `orb:home`, `orb:note`, `orb:run`; it answers with `orb:act`), wrapped by `orbSay`, `orbThink`, `orbHome`, `orbNote`, `orbRun` and `onOrbAct` in `src/orb/events.tsx` (the four a flow needs are re-exported from `src/flow/orbGuide.ts`). `Conversation` calls `orbHome()` and `orbThink()` itself; everything else is the app's doing. See `docs/09-orb.md` §12.
