# 12 · A new app in this style, step by step

This is the path from an empty folder to a first screen that looks, moves and guides like Orbit.
Every step names the document that holds the details. Follow the order; each step assumes the
one before. The sample app in `example/` (a trip planner called Compass) is this guide, done.

## 0. What you need

- Node 20 or newer.
- A React 19 + Vite app (any starter), or the `example/` folder of this package copied whole.
- No AI, no accounts, no server. Those come later, through the adapters in `10-ai-adapter.md`.

## 1. Install

```bash
npm i react react-dom motion @fontsource-variable/fraunces @fontsource-variable/inter
```

Copy `OrbitDesign/src` into your app, for example as `src/orbit-design`, and add an alias so the
imports read `orbit-design/...` (Vite: `resolve.alias`; TypeScript: `paths`). The package's own
`vite.config.ts` and `tsconfig.json` show exactly how.

## 2. The page

`index.html` needs the viewport line (safe areas and the keyboard depend on it) and the three
attributes that pick the look:

```html
<html lang="en" data-theme="dark" data-skin="o5" data-guide="myapp">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
```

What each attribute does: `02-tokens.md`, "How theme and skin are switched".

## 3. The entry file

CSS in this order (it matters; `src/styles/README.md` explains the cascade), then fonts, then the
motion provider, then your app, then one orb:

```tsx
import 'orbit-design/styles/tokens.css';
import 'orbit-design/styles/base.css';
import 'orbit-design/motion/motion.css';
import 'orbit-design/styles/glass.css';
import 'orbit-design/styles/o5.css';
import 'orbit-design/orb/face.css';
import 'orbit-design/orb/orb.css';
import 'orbit-design/motion/depth.css';
import 'orbit-design/styles/pages.css';
import { loadFonts } from 'orbit-design/styles/fonts';
import { MotionProvider } from 'orbit-design/motion';
import { OrbCursor } from 'orbit-design/orb';

loadFonts();
createRoot(document.getElementById('root')!).render(
  <MotionProvider pref="system">
    <App />
    <OrbCursor brain={null} />
  </MotionProvider>,
);
```

`pref` can be `'system' | 'full' | 'lite' | 'reduce'`; `'system'` measures the device once and
honours Reduce Motion (`05-motion.md`, "Motion levels").

## 4. Your app's colours

Define a `Theme` (eight colours, `02-tokens.md`, "The app theme") and write it onto `<html>` once,
exactly as the example does in `example/src/App.tsx`:

```ts
const t = guide.theme;
for (const [k, v] of Object.entries({ '--st-paper': t.paper, '--st-ink': t.ink, '--st-ink2': t.ink2, '--st-accent': t.accent, '--st-desk': t.desk, '--st-desk2': t.desk2, '--accent': t.orbA, '--orb-a': t.orbA, '--orb-b': t.orbB })) root.style.setProperty(k, v);
```

Only `--accent` (from `orbA`) changes the page's accent today; the others are kept for the paper
drawers and the orb's two tones.

## 5. The frame

Every screen sits in the same three bands (`07-layout-and-navigation.md`):

```tsx
<Root view={view}>
  <TopBar kicker="A sample app" mark={['Com', 'pass']} onOptions={…} onGallery={…} />
  <Stage screenKey={`${view}|${run?.id ?? ''}`} walking={view === 'walk'}>{body}</Stage>
  <BottomBar canBack canHome canSave onBack={goBack} onHome={goHome} onSave={saveDraft} />
  <Toasts />
</Root>
```

Only the stage moves. `goBack`, `goHome` and `saveDraft` must follow the per-view table in
`07-layout-and-navigation.md`; copy them from the example.

## 6. A plain screen

A screen is a kicker, a headline, a dek and content between hairlines. Use `Page` for the shell and
`Choices` or `Rows` for the body (`06-components.md`):

```tsx
<Page id="start-t" kick="Opening" title="What shall we *plan?*" dek="Pick one. Every choice is a short walk.">
  <Choices items={START} picked={picked} onPick={pick} delay={0.2} />
</Page>
```

The `*asterisks*` make the italic accent half of the headline. `Page` keeps a spot beside the
headline for the orb (`orb={false}` when the screen's primary button should take it instead).

## 7. A guided flow

1. Write a `Guide` in the shape of `src/flow/guides/example.ts`: its name and masthead, its
   `theme`, optional `rules`, `starters` and `followUps` for a conversation screen, and `flows`.
   Each `Step` is one question: `id`, `kick`, `q` (one `*italic*` word), optional `dek`, `key`
   (its name on the summary), `choices` (each with a `hint`, optionally `value` for what it adds to
   the result and `suits` words that make it the orb's pick), and flags `when`, `closed`, `meta`,
   `best`, `custom`. Rules and examples: `08-guided-flows-prd.md`.
2. Drive it with the engine: `nextStep`, `answer`, `back`, `progressOf`, `recommend`, `pickFor`,
   `finishAll`, `summaryOf`, `resultOf`. They are pure functions; the example's `App.tsx` shows the
   whole loop, including a `custom` step the app renders itself and the orb's pick.
3. Render the current step with `Walk` (trail above, question in the middle) and the end with
   `SummaryList` + `Go`.
4. Save after every answer with `saveRun`; list with `listRuns`.

## 8. The orb on every screen

For each screen, four lines (`09-orb.md`):

- Mark what the screen wants with `data-orb-spot` (`OrbSpot` does it): the headline while reading,
  the recommended answer (`Choices recommended=…` does it), the primary button when the page is done.
- `orbNote('…', { label, id })` with what the orb would say and the one button it offers; clear it
  on leave. Handle the button with `onOrbAct`.
- `orbHome()` on every forward or backward step.
- `document.documentElement.dataset.orbContext = '…'` describing where the user is, so a brain can
  explain the screen.

The orb never speaks on its own. `orbSay` is for genuine interruptions only.

## 9. Motion on anything new

Use the named springs only, through the level:

```tsx
const level = useMotionLevel();
<motion.li initial={{ opacity: 0, y: 26, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: level === 'full' ? { ...SPRING.bouncy, delay: 0.12 + i * 0.055 } : transitionFor(level) }} />
```

Lists stagger at 55 ms; leaving items go `x: -36`, `blur(12px)`, 40 ms apart; a chosen item lifts
to `scale: 1.03` with `playful`. Full recipes: `05-motion.md`.

## 10. Plugging in an AI (later, optional)

```ts
import { httpChatBrain, webSpeech, assistantFromBrain } from 'orbit-design/ai';
import { setAssistant } from 'orbit-design/flow';

const brain = { ...httpChatBrain({ url: 'YOUR_ENDPOINT/v1/chat/completions', model: 'YOUR_MODEL', key }), ...webSpeech() };
setAssistant(assistantFromBrain(brain));   // suggested answers in flows, the conversation screen
<OrbCursor brain={brain} />                 // explain this screen, answer questions
```

With nothing plugged in, every screen still works: ready answers, the orb's picks and notes.

## 11. Check before you ship

Go through `11-checklist.md`. At minimum: 390 × 844 and 768 × 1024 in a browser, keyboard open,
Motion Full and Off, the orb on the right thing on every screen, and plain words everywhere.
