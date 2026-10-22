# 01 · What OrbitDesign is, and the rules behind it

OrbitDesign is the look, the motion and the companion (the orb) of Orbit, lifted out so a new app
can be built the same way without sharing any of Orbit's code. This document is the "why". The
other documents are the "what" (exact values) and the "how" (code you can copy).

Read this first. Every later rule follows from the eight principles here. When a new screen does
not know what to do, come back to these.

## The eight principles

### 1. The screen belongs to the content

There is almost no chrome. A screen is a magazine page: a running head (the *kicker*), one big
headline, a standfirst (the *dek*), and the content set between thin hairlines. Boxes, cards and
borders are the exception, not the default. Buttons are words with an underline, or one solid
block of ink for the single most important action on the page.

In practice:
- Headlines are set in a display serif (Fraunces); everything else in a quiet sans (Inter).
- One accent colour. It is used for emphasis (the italic half of a headline), the orb's light,
  the primary button on hover, and little else.
- Corners are square in the magazine skin. Inputs are a single underline, not a box.
- Scrolling down tucks the header away; scrolling up brings it back.

### 2. One thing at a time

Each screen asks one question or shows one result. A guided flow never shows a form; it shows a
question, a short list of ready answers, and a line for your own words. Everything you already
answered stacks small above it (the *trail*) and can be tapped to go back.

In practice:
- Running head reads "Chapter 03 · Mood" and "4 of 9" so you always know where you are.
- Answers are words first, pictures only where a picture explains more than words.
- "Pick for me" and "Finish it for me" exist on every question, so nobody is stuck.
- Drafts save themselves after every answer. "Save draft" is a way out, never a chore.

### 3. Everything is a physical thing

Nothing fades in from nowhere or snaps. Every element arrives on a spring, from a direction that
says where it came from, and leaves the way it came. A picked answer lifts; the others leave one by
one; the picked one flies up into the trail. A whole page never flies out as one block.

In practice:
- Six springs, named for how they feel (`snappy`, `smooth`, `default`, `bouncy`, `playful`,
  `flick`). See `05-motion.md` for the exact numbers. Do not invent a seventh.
- Lists arrive staggered, 55 ms apart, out of a blur.
- Anything you let go of mid-gesture carries your finger's speed (`flick`).
- Only `transform`, `opacity` and (sparingly) `filter` animate. Never layout.

### 4. Depth tells you what matters

The thing you are on is sharp. What you have finished, or what is next, sinks back and blurs as it
leaves the middle of the screen. Light comes from one place (above, slightly left); shadows fall
down and right. Tilting the phone moves the light, not the content.

In practice:
- `useScrollDepth` writes `--p` (how far from the middle) and `--ap` (its absolute value) onto every
  `[data-depth]` child; CSS turns that into blur, scale and opacity.
- The current question never carries `data-depth`; only the trail does.
- Five depth layers, four shadow tokens. Nothing moves between layers except by lifting or pressing.

### 5. The orb is the guide, and it is quiet

A round companion floats over every screen. It goes to whatever the page marks as wanting
attention: beside the headline, on the answer it would pick, on the primary button, inside the text
box as the caret while you type. It never speaks unless you tap it. When you do, it tells you why it
sits where it sits and offers one button to go with its pick.

In practice:
- Pages mark spots with `data-orb-spot`, `data-orb-focus`, `data-orb-size`. The orb finds them
  itself; screens never position the orb.
- The orb has no intelligence of its own. Any model, cloud or local, plugs into one adapter
  (`10-ai-adapter.md`). With no adapter it still moves, points, becomes the caret, and shows notes.
- Drag it, throw it, tuck it at the edge, pinch it to zoom. Every next step of what you are doing
  brings it home again.

### 6. Motion is designed three times

Every animation has a Full, a Lite and an Off version, decided once per device and once per user
preference. Off is not "no animation": it is a 150 ms cross-fade so you can still see what changed.
Lite is a short ease. Full is the springs.

In practice:
- Never branch on the level in a hundred places. Use `transitionFor(level, name)`.
- Measure the device once (frame probe) and remember it for a week.
- Honour `prefers-reduced-motion` as Off.

### 7. Built for a thumb on a phone first

Everything must work on an iPhone and an iPad in a browser, with the keyboard open, in portrait
and landscape. Then it works on a desk.

In practice:
- 16 px side gutters; 44 px minimum touch targets; no horizontal scroll ever.
- The layout uses the visual viewport (the keyboard shrinks it) and the safe-area insets.
- Top bar: masthead left, two square icon buttons right. Bottom bar: Back, Home, Save draft.
  Only the middle moves.
- Icons are square line icons, one stroke weight, no fills.

### 8. Plain words

Labels and copy are written the way you would say them to a friend. No jargon in the interface, no
status codes, no "machine", "model", "prompt" or "token". Something is "resting", "waking up",
"thinking of more", "ready". Errors say what happened and what to do next, in one line.

## What is deliberately not here

- No AI, no network calls, no accounts. The package is presentation, motion and an engine for
  guided flows. Where the original app used a model (suggested answers, the orb's explanations),
  the package has an empty slot with a documented contract.
- No domain. The system came out of one product, but nothing in it belongs to that product: no
  screens, words or data from it remain. The sample guide in `src/flow/guides/example.ts` (a
  trip planner called Compass) exists only to show every piece working together; replace it.

## How the documents fit together

| Document | What it gives you |
|---|---|
| `01-philosophy.md` | The rules (this file) |
| `02-tokens.md` | Every colour, size, radius, shadow and theme switch, with exact values |
| `03-typography.md` | The two typefaces and every text style |
| `04-surfaces-and-skins.md` | Hairlines, glass, the magazine skin, element recipes, icons, layout grid |
| `05-motion.md` | Springs, levels, depth scroll, every component's motion recipe |
| `06-components.md` | Each component: props, DOM, states, accessibility |
| `07-layout-and-navigation.md` | Screens, bars, transitions, the trail, saved runs |
| `08-guided-flows-prd.md` | The guided-flow engine as a functional spec, re-implementable anywhere |
| `09-orb.md` | The orb: physics, modes, attention, caret, gestures, events, panel |
| `10-ai-adapter.md` | The one slot where any AI plugs in, with worked adapters |
| `11-checklist.md` | What to verify before shipping a screen |
| `12-new-app-guide.md` | Step by step: a new app in this style, from empty folder to first screen |
