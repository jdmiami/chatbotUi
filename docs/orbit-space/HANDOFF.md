# Orbit Space: handoff for a new chat

Start here. This branch, `claude/orbit-space`, is the fork for the next big upgrade.
The live site on `main` stays exactly as it is today and must not change until the owner says so.

- Base: `main` at commit `0f02ea0` (AI Store app, PR #58). Nothing from this upgrade is on `main` or live.
- Branch for all upgrade work: `claude/orbit-space`. Open PRs into this branch, or keep a long-running draft PR from it, but do not merge into `main` without the owner's explicit go.
- Prototype to read first: `docs/orbit-space/samples.html` (also published at https://claude.ai/artifact/97oncjdWzqqfhToLXAGM3N).

## 1. The idea in one paragraph

Orbit becomes a blank, endless 3D space where the orb lives. Everything is a node, and every node is a flat 2D magazine page: prompts, replies, files, pictures, videos, machine logs, menus and whole apps. The orb travels to whatever you are working on. A decision layer, the Compass, guesses your next step and offers three choices as pages placed in 3D, nearest first. You answer by voice, a tap, or typing. Pages can turn flat and fill the screen whenever 2D works better, then fold back into the space. An AI agent builds new interfaces on demand: questions, forms, galleries and small apps, all from one shared kit of saved assets so everything looks uniform.

## 2. The owner's ideas, organized

### A. The space
- A blank canvas world, navigable naturally: drag to look, pinch to move, tap to approach. AR and headset come later in the same world.
- Everything is a node: prompts, replies, files, logs, folders (rooms), apps and menus.
- Nodes are 2D paper pages in a 3D world. This is the main visual rule.
- Branching is 3D, not a flat list. The three forks stand at different depths.

### B. The orb
- The orb is the user's presence and cursor in the space.
- It approaches every node it works on: it travels, the page turns to face you, unfolds, and lifts to reading distance.
- It listens by voice. Rings breathe with your voice level.

### C. The Compass (decision AI)
- Every request first goes through a fast "what do they probably want next" model.
- It uses a harness prompt built on the phone from your average intents (habits, current room, time of day, machine state).
- It returns scored intents. The **scores are never shown**. Only the order and the distance show them: first is nearest.
- The top three become forks. The orb goes to the first. You say yes, a number, or more words.
- It never starts paid jobs, turns machines on, or sends messages by itself. Those are always a fork you confirm.

### D. Reorganizing many cards (newest request)
When a node has many children, such as choices, results, files or pictures, the user can switch how they are laid out:
- **List:** a column of pages, like a contents page.
- **Stack:** a deck you flip through, one card at a time.
- **Grid:** a contact sheet, best for pictures, videos and apps.
- The layout morphs in 3D between the three: cards fly to their new places, they don't pop.
- The system picks a sensible default per content type. For example, pictures open as a grid and choices open as a stack with the first on top.

### E. A generative canvas (newest request)
- The agent can create interactive things on the fly, the way this chat creates artifacts: interactive questions, forms, sliders, pickers, comparisons, small tools and whole apps.
- "Every app in one, created by AI as you need it."
- Image and video makers act as independent AIs the agent can call and place results from.
- Apps "pop on" when asked for and are pages in the space like anything else.

### F. 2D ⇄ 3D
- Any node can go from 3D page to a perfect, flat, full-screen 2D view and back: list to app to menu.
- Reading and typing should happen in 2D comfort. Overview and choosing happen in 3D.
- A graphic layer sits on top and makes everything highly interactive.

### G. Saved assets for uniformity
- Keep a shared library of assets: type, colors, page frames, ornaments, icons, motion curves and reusable components.
- Anything the agent generates must be built from this library so the whole OS stays uniform.

### H. Style rules (already decided)
- Magazine look: Fraunces for reading, Inter for controls, small spaced caps for kickers.
- Square corners everywhere. Only the orb, its rings and status dots are round.
- Paper feel: grain, hairline frames with an inner rule, double rules under headers, fleurons, folios, crop marks, drop caps.
- Colors: ink `#0e0d0b`, paper `#171411`, cream `#f3eee6`, stone `#8f877b`, soft `#c9c1b4`, orb indigo `#6c7cff`, sage `#8fd3ad` (on, done), amber `#e8b86b` (needs you), coral `#ef8f80` (stop).
- No percentages or scores on screen.

## 3. What already exists to build from

- **Prototype engine** in `docs/orbit-space/samples.html`. It is about 900 lines of dependency-free JS:
  - It is a tiny CSS-3D engine. A camera with position and look-at, a lens that scales with the screen, pages as real HTML with 3D transforms, depth sorting, fog by distance, and fading of pages that pass the camera.
  - A canvas layer behind the pages draws threads with a slight sag, square knots, dust, a floor grid, floor shadows and the orb's light pool.
  - The look controller handles drag, pinch, wheel, arrow keys, tap to approach, and back to overview. The orb travels on a spring path with an arc.
  - Motion scenes are pure functions of time, so they can be scrubbed.
  - It runs at phone and desktop sizes and respects reduced motion.
- **Three looks** in the prototype: A Ink Constellation (dark, hanging pages and threads), B Paper Atelier (white studio, pages standing on a floor), C Folio Corridor (history receding, big chapter numerals).
- **Three motion studies:** Approach, Fork bloom, Everything is a page.
- **Earlier design canvas** (magazine boards: Path, Forks, Chosen, Voice, World, Room, Options, Motion timings, Compass, Rules): https://claude.ai/artifact/5izda4JUk3wznvWoXtRn3h
- **Simplification report** proposing one AI app that merges chat, make, store and agents: Claude Doc "Orbit, simplified: one AI app".

### Motion timings already agreed

| Moment | Time | Curve |
|---|---|---|
| Orb listens | 2400 ms loop | sine |
| Words land | 320 ms, 40 ms per word | settle |
| Forks unfold | 480 ms, 70 ms apart | settle |
| Orb travels | 520 ms | spring |
| Orb hops to another fork | 380 ms | spring |
| Yes: page turn | 620 ms, others sink 320 ms | settle |
| Into the world | 700 ms, 60 ms stagger | settle |
| Step into a room | 560 ms | settle |
| File a card | 240 ms | spring |

Settle is `cubic-bezier(.22,1,.36,1)`. Spring is stiffness 180, damping 22.

## 4. Questions still open for the owner

Ask these first. Their answers set the build.
1. Which look: A, B, C, or a mix?
2. Which motion study feels right, and should it be faster or slower?
3. Should Orbit open straight into the space, or keep a flat home you pinch out of?
4. When reading or typing, should the page stay angled or go flat and full-screen? The current idea is flat.
5. Touch only, or also tilt-to-peek? AR or headset now, or later?
6. Who arranges the space: the orb, the user, or both?
7. Should logs and replies always be pages, or only things the user made, with logs tucked in rooms?
8. Should threads show all connections, or only the current path?
9. Should the camera follow the orb, or roam freely?
10. Sound and haptics on travel and page turns?
11. For list, stack and grid: one gesture to switch, a control on the parent node, or the agent decides?
12. For generated apps: should they be saved as reusable apps in a room, or disposable by default?

## 5. Suggested build order (only after the owner answers)

1. Port the prototype engine into Orbit as a `space` module (`orbit/src/space/`). Keep it dependency-free, or move to three.js with CSS3DRenderer if needed.
2. Node model: one type for every node (kind, content, parent, children, layout = list | stack | grid, position). Store it locally first.
3. The 2D ⇄ 3D morph. Any node goes flat full-screen and back, reusing existing Orbit 0.5 screens as the 2D views.
4. List, stack and grid layouts for children, with animated transitions.
5. Compass: a fast cloud model returns scored intents, then three forks, then the orb travels. Scores stay hidden.
6. Generative canvas: the agent returns a UI spec built only from the saved-asset kit. A renderer turns the spec into a page. Image and video makers plug in as tools.
7. Asset library: tokens, frames, ornaments and components that the generator must use.
8. Tests on iPhone and iPad sizes, then a preview deploy from this branch. Merge to `main` only when the owner approves.

## 6. Repo facts the next chat needs

- Next.js site at the root (`app/`, `lib/`, `proxy.ts`). The Orbit React and Vite app lives in `orbit/` and is served at `/orbit`. The AI machine gate is `ai/gate` (Node, no dependencies). The Linux gateway lives in `gateway/`.
- Orbit commands, run in `orbit/`: `npm run typecheck`, `npm test` (vitest), `npm run test:e2e` (Playwright on 4 viewports). Gate tests: `node --test` in `ai/gate`. The root build is `npm run build`.
- Playwright uses `/opt/pw-browsers/chromium` in cloud sessions. Do not run `playwright install`.
- Known flaky tests: the gate's R2 gallery test, and one motion e2e test. Both pass on re-run.
- Model and maker catalog: `ai/gate/catalog.json`, shared by the gate and Orbit (`orbit/src/apps/store/catalog.ts`).

## 7. Rules from the owner (keep)

- Never ask the owner to paste keys or tokens. Secrets live in Vercel and Runpod settings. Never read out or log `DESKTOP_PASSWORD`, `GATEWAY_SECRET` or other secret values. `NVIDIA_API_KEY` is server-side only, and passwords or secret-looking text are never sent to NVIDIA.
- Ask before creating paid infrastructure, making anything public, or deleting things. Starting and stopping the existing pods is allowed without asking; tell the owner when they are on. Auto-off after 20 minutes idle.
- Explain things in plain language. Everything must work on iPhone and iPad.
- Content rules for the studio: always refuse sexual content involving minors, and never sexualize or undress uploaded photos.
- Process: every change ships as a PR. Draft first, ready when the Vercel preview succeeds, then squash-merge. For this upgrade, merge only into `claude/orbit-space` until the owner approves going live.
