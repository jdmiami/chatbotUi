# OrbitDesign

The Orbit look, motion and orb, as a package you can drop into a brand-new app.

- **Look:** magazine typography (Fraunces display, Inter UI) on thin hairlines, one accent colour,
  square corners, underlined inputs, square line icons, a dark desk.
- **Motion:** six named springs, three motion levels (Full, Lite, Off) decided per device and per
  user, scroll depth that blurs what you are not on, every list arriving one item at a time.
- **Screens:** a top bar and a bottom bar that never move, a middle stage that does; one question
  or one result per screen; a trail of answers above; drafts that save themselves.
- **The orb:** a physics-driven companion that sits on whatever the screen wants next, becomes the
  caret in text boxes, can be dragged, thrown, tucked and pinched, and keeps its words until tapped.
- **The flow engine:** a guided flow of questions with ready answers, your own words, "pick for me",
  "finish it for me", suggestions, a trail and a summary, all as pure functions with tests.
- **No AI inside.** Two small adapter interfaces (`OrbBrain` for the orb, `Assistant` for the
  flow) take any cloud API or local model. With both unset, everything still works.

## Contents

```
OrbitDesign/
  README.md                 this file
  docs/                     the full guide (read 01 first, then the one you need)
    01-philosophy.md        the eight rules everything follows
    02-tokens.md            every colour, size, radius, shadow, theme switch
    03-typography.md        typefaces and every text style
    04-surfaces-and-skins.md hairlines, glass, the magazine skin, element recipes, icons, grid
    05-motion.md            springs, levels, depth, per-component motion recipes
    06-components.md        each component: props, DOM, states, accessibility
    07-layout-and-navigation.md screens, bars, transitions, trail, drafts
    08-guided-flows-prd.md   the guided-flow engine as a functional spec
    09-orb.md               the orb: physics, modes, attention, caret, gestures, events, panel
    10-ai-adapter.md        the AI slot, with worked adapters
    11-checklist.md         what to verify before a screen ships
    12-new-app-guide.md     a new app in this style, step by step
  src/                      code to copy into an app (TypeScript + React 19 + motion 12)
    styles/                 tokens.css, base.css, o5.css, glass.css, pages.css, fonts.ts
    motion/                 springs, levels, provider, physics, feedback, tilt, depth, chrome, motion.css
    orb/                    OrbCursor, OrbFace, physics, attention, caret, events, orb.css
    components/             Sheets (Contents, Gate, Page), Choices, Walk, Conversation, Summary, Bars, Drawer, Toasts, icons
    flow/                   defs, engine, suggest, adapter, runs, orbGuide, guides/example.ts (Compass)
    ai/                     adapter interfaces and example adapters (no vendor code)
  example/                  Compass, a running sample app using all of the above
  skill/OrbitDesign/SKILL.md  instructions for an AI assistant applying this system
  package.json, tsconfig.json, vite.config.ts
```

**styles/** holds the stylesheets, in the order `src/styles/README.md` gives: the tokens, the base,
the glass, the magazine skin and `pages.css` (the page look: masthead, headline, answers, trail,
summary, dock, drawers), plus `fonts.ts`.

**components/** holds the screen pieces: `Sheets` (the orb's spot, the italic `Headline`, `Rows`,
the `Contents` page, an agreement `Gate`, a plain `Page`), `Choices` (answers on springs), `Walk`
(one question at a time with the trail above, and a slot for a custom step), `Conversation` (a chat
with ready openers, follow-ups and an actions slot), `Summary` (the summary list, the `Go` button in
its dock, `Progress`, `Result`), the bars, the drawer, toasts and the line icons.

**flow/** holds the engine: `defs` (Guide, Flow, Step, Choice, Run), `engine` (next step, answer,
back, pick for me, finish for me, summary, result, the orb's pick), `suggest` (choices suggested by an
assistant), `adapter` (the `Assistant` interface), `runs` (drafts on this device), `orbGuide` (the
window events the orb listens to) and `guides/example.ts`, the Compass sample guide.

## Run the example

```bash
cd OrbitDesign
npm install
npm run dev        # http://localhost:5300
npm run typecheck
```

## Use it in a new app

See `docs/12-new-app-guide.md`. The short version: install `motion`, `react`, `react-dom` and the
two `@fontsource-variable` fonts; copy `src/` into the app; import the CSS files in the order listed
in `src/styles/README.md`; wrap the app in `<MotionProvider>`; render `<OrbCursor brain={null} />`
once at the root; set `data-theme` and `data-skin` on `<html>`; build screens from `components/`.

## Requirements

Node 20+, React 19, `motion` 12. Phones and tablets are the first target: everything is checked at
390 × 844 and 768 × 1024 in a browser.
