---
name: OrbitDesign
description: Build or restyle an app in the Orbit look: magazine typography on hairlines, six named springs with Full/Lite/Off levels, scroll depth, one-question-at-a-time walkthroughs, and the quiet orb companion that sits on what the screen wants next. Use whenever a request mentions Orbit, OrbitDesign, "the orb", "the studio look", the magazine skin, or asks for a new app, screen or walkthrough in this style.
---

# OrbitDesign

You are applying a complete, documented design system. It lives next to this file in the
`OrbitDesign/` package: `docs/` (the rules and every exact value), `src/` (code to copy into the
app), `example/` (a running app). Never guess a value: open the document that holds it.

## Before writing anything

1. Read `docs/01-philosophy.md` once per session. It is short and every rule below comes from it.
2. Open the document for the thing you are about to build:
   - a colour, size, radius or shadow → `docs/02-tokens.md`
   - a headline, label, kicker or any text style → `docs/03-typography.md`
   - a button, input, row, drawer, bar, icon or the layout grid → `docs/04-surfaces-and-skins.md`
   - anything that moves → `docs/05-motion.md` (springs table and per-component recipes)
   - a component's props and DOM → `docs/06-components.md`
   - screens, bars, Back/Home/Save, the trail, drafts → `docs/07-layout-and-navigation.md`
   - a guided walkthrough (questions, answers, predictions, scripts) → `docs/08-walkthrough-prd.md`
   - the orb (placement, caret, gestures, notes, events) → `docs/09-orb.md`
   - plugging an AI into the orb or the walkthrough → `docs/10-ai-adapter.md`
3. For a brand-new app, follow `docs/12-new-app-guide.md` step by step.
4. Before you say a screen is done, go through `docs/11-checklist.md` line by line.

## Non-negotiables

- Use the package's CSS and tokens as they are. Add app CSS on top; do not fork the files.
- Use only the six named springs through `transitionFor(level, name)`. Never a bare `duration`.
- One question or one result per screen. A trail above, the current thing sharp, finished things
  with `data-depth`.
- The orb is never positioned by a screen. Mark what the screen wants with `data-orb-spot`
  (or `data-orb-focus`), set `data-orb-context` on `<html>`, set an `orbNote` for the screen, call
  `orbHome()` on every step. The orb never talks on its own.
- No AI inside the package. Any model is attached through `OrbBrain` (the orb) and `Writer`
  (the walkthrough). With both set to `null`, everything still works.
- Phone first: 390 px wide with the keyboard open must work before anything else.
- Plain words in the interface. No vendor, model, machine or token names.

## Quick start (copying into a new app)

```bash
# in the new app
npm i motion react react-dom @fontsource-variable/fraunces @fontsource-variable/inter
cp -r OrbitDesign/src ./src/orbit-design
```

```tsx
// main.tsx
import 'orbit-design/styles/tokens.css';
import 'orbit-design/styles/base.css';
import 'orbit-design/motion/motion.css';
import 'orbit-design/styles/glass.css';
import 'orbit-design/styles/o5.css';
import 'orbit-design/orb/face.css';
import 'orbit-design/orb/orb.css';
import 'orbit-design/motion/depth.css';
import 'orbit-design/styles/studio.css';
import { loadFonts } from 'orbit-design/styles/fonts';
import { MotionProvider } from 'orbit-design/motion';
import { OrbCursor } from 'orbit-design/orb';

loadFonts();
document.documentElement.dataset.theme = 'dark';
document.documentElement.dataset.skin = 'o5';

createRoot(el).render(
  <MotionProvider pref="system">
    <App />
    <OrbCursor brain={null} />
  </MotionProvider>,
);
```

Then build screens from `src/components` (Headline, Choices, Walk, ScriptDesk, Talk, Brief,
TopBar, BottomBar, Drawer, Toasts) and define a studio in the shape of
`src/walkthrough/studios/example.ts`.

## When the request is a change to an existing Orbit-style app

- Find the component in `docs/06-components.md` and the motion recipe in `docs/05-motion.md` first;
  change values only where the docs say they are meant to vary (studio theme, step definitions,
  copy). If a value is fixed in the docs, do not change it; propose it to the owner instead.
- Keep class names and data attributes. The CSS and the orb depend on them.

## When the owner asks for a new studio or walkthrough

- Write a `StudioDef` (see `docs/08-walkthrough-prd.md`, data model): `theme`, `tail`, `talk`
  starters and follow-ups, and `flows` with `StepDef`s. Give every ready answer a `hint` and, where
  it should become the orb's pick, `suits` words that appear in earlier answers. Mark `meta` steps
  (length, shape) and `closed` steps (yes/no). Add `when` for steps that depend on earlier answers.
- Keep questions to one line with one `*italic*` word. Keep deks to one sentence.
- Add engine tests for `when`, `meta` and `recommend` on the new steps.

## Reporting back

Say which documents you applied, which values you took from them, and which checklist lines you
verified (with screenshot sizes). If you had to invent a value because the docs did not have it,
say so explicitly so it can be added to the docs.
