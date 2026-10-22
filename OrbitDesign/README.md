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
- **The walkthrough engine:** questions, ready answers, "pick for me", predictions, a rule-based
  script writer, a storyboard check, all as pure functions with tests.
- **No AI inside.** Two small adapter interfaces (`OrbBrain` for the orb, `Writer` for the
  walkthrough) take any cloud API or local model. With both unset, everything still works.

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
    08-walkthrough-prd.md   the walkthrough engine as a functional spec
    09-orb.md               the orb: physics, modes, attention, caret, gestures, events, panel
    10-ai-adapter.md        the AI slot, with worked adapters
    11-checklist.md         what to verify before a screen ships
    12-new-app-guide.md     a new app in this style, step by step
  src/                      code to copy into an app (TypeScript + React 19 + motion 12)
    styles/                 tokens.css, base.css, o5.css, glass.css, studio.css, fonts.ts
    motion/                 springs, levels, provider, physics, feedback, tilt, depth, chrome, motion.css
    orb/                    OrbCursor, OrbFace, physics, attention, caret, events, orb.css
    components/             Headline, Choices, Walk, ScriptDesk, Talk, Brief, bars, Drawer, Toasts, icons
    walkthrough/            defs, engine, predict, writer, projects, orbGuide, studios/example.ts
    ai/                     adapter interfaces and example adapters (no vendor code)
  example/                  a running sample app using all of the above
  skill/OrbitDesign/SKILL.md  instructions for an AI assistant applying this system
  package.json, tsconfig.json, vite.config.ts
```

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
