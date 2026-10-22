# 05 · Motion

One physical world for every screen. Every animation in the Orbit look follows the rules below. If a motion
doesn't explain a change or confirm a touch, it is cut.

This document is the complete motion language, copied value for value from the source app. The
portable code lives in `src/motion/`; the file map is in §0. Colours, typography and the orb's own
physics are covered by other documents (see §14).

---

## 0. What is where

| Package file (`src/motion/`) | Copied from (the source app) | What it is |
|---|---|---|
| `springs.ts` | `motion/springs.ts` | `ios()`, the six named springs, `transitionFor()` |
| `level.ts` | `motion/level.ts` | `MotionPref`, `MotionLevel`, `resolveLevel()`, the frame probe and its cache |
| `MotionProvider.tsx` | `motion/MotionProvider.tsx` | Resolves the level, sets `<html data-motion>`, starts tilt; `useMotionLevel()`, `useSpringTransition()` |
| `useMediaQuery.ts` | `hooks/useApplySettings.ts` | The `useMediaQuery` hook the provider needs |
| `physics.ts` | `motion/physics.ts` | `springValue()`, the standalone spring integrator |
| `feedback.ts` | `motion/feedback.ts` | `cue()`, `tick()`, synthesised sounds and vibration patterns |
| `morph.ts` | `motion/morph.ts` | App windows growing out of / shrinking into an icon, the swipe-home drag, the page turn |
| `tilt.ts` | `motion/tilt.ts` | Sensor and mouse → `--tx` / `--ty`; permission flow; `recentTap()` |
| `useTilt.ts` | `motion/useTilt.ts` | Cards leaning toward the pointer (`--rx` / `--ry`) |
| `depth.ts` | `shell/o5/depth.ts` | `useScrollDepth()` → `--p` / `--ap` on every `[data-depth]` |
| `chrome.ts` | `shell/o5/chrome.ts` | `useChromeOnScroll()` → `data-chrome` on the app window |
| `motion.css` | `styles/motion.css` | Spring easings, durations, depth shadows, presses, keyframes, Lite/Off overrides (verbatim) |
| `depth.css` | `styles/o5.css` + the page stylesheet (extracts; the page rules are also in `src/styles/pages.css`) | Every rule that consumes `--p` / `--ap` / `data-chrome` |
| `index.ts` | — | Re-exports everything |

What changed in the copies (nothing else did):

- `level.ts` declares `MotionPref` locally instead of importing it from the source app's shell store. The type is identical: `'system' | 'full' | 'lite' | 'reduce'`.
- `feedback.ts` no longer reads `useShell.getState().settings`; call `configureFeedback({ sound, haptics })`. Both default to `false`, as in the source app's settings.
- `morph.ts` takes its two app-specific selectors from `configureMorph()`; the defaults are the source app's own strings.
- `chrome.ts` takes the window selector as an optional second argument, default `'.app-window'`.
- `MotionProvider` takes `pref`, `tilt` and `tiltGranted` as props instead of reading them from the store.

---

## 1. Principles (from the source app's motion notes)

### 1.1 Light

- **One light source**, above the screen and slightly to the left (about 10 o'clock, 60° up).
- Surfaces facing it catch a **highlight**: a thin bright top edge and a soft sheen in the top-left.
- Everything casts its **shadow down and slightly right**, away from the light.
- When you tilt the phone (or move the mouse on a computer), the light appears to stay put while the
  screen moves: highlights slide across surfaces and shadows shift the other way. This is what makes
  flat things read as 3D.

### 1.2 Depth layers

Five fixed layers. Something higher casts a longer, softer shadow, takes more of the tilt, and sits
on more blur. Nothing moves between layers except by lifting (press/drag) or by the transitions in §1.3.

| Layer | What lives there | Shadow | Tilt parallax |
|---|---|---|---|
| 0 · Far | Wallpaper and its light | none | moves against the tilt, 14 px |
| 1 · Surface | Cards, widgets, list rows, gallery tiles, app icons at rest | `--depth-1` | 2 px |
| 2 · Raised | Dock, app windows, the composer, a card while held | `--depth-2` | 4 px |
| 3 · Floating | Sheets, menus, the open task manager | `--depth-3` | 6 px |
| 4 · Top | Status pill, toasts | `--depth-4` | 8 px |

- **Lift**: holding something raises it one layer (shadow grows, scale 1.02). Letting go drops it back with the `bouncy` spring.
- **Press**: tapping pushes it *down* (shadow shrinks, scale 0.95), like a real button, then springs back.

Note on the table versus the CSS: the parallax column is the design intent as written in the source app's motion notes.
The CSS actually shipped (§4.3) moves the far layer by `-14px`, the classic home grid by `2px`, and
the dock by `3px` horizontally / `2px` vertically; layers 3 and 4 have no parallax rule in the CSS.
The shadow offsets do take the tilt (`--sx` / `--sy`), which is where most of the "higher layers
take more tilt" feeling comes from. Both are recorded here; the CSS is what runs.

### 1.3 Where things come from and go

- **Apps** grow out of the icon you tapped (home screen or dock) and shrink back into it. Switching
  apps: the new one grows from its dock icon, the old one sinks back a layer.
- **Going home by gesture**: drag up on the dock; the app follows your finger, shrinking. Let go
  quickly or far enough and it flies into its icon at your finger's speed; otherwise it springs back.
- **Sheets and menus** grow out of the button that opened them, then settle at their place
  (bottom on phones, centre on iPad). Drag the handle down to throw them away.
- **The status pill** opens out of itself into the task manager and closes back into the pill.
- **Pictures** in Create grow from their tile into the viewer and return to it.
- **Messages**: yours rise from the message box; replies grow from the avatar.
- **Toasts** drop from under the status pill.

### 1.4 Screen by screen (what each motion explains, what was cut)

**Home screen.** Icons pop in once, left to right (`playful`), so you see the layout settle.
Cards tilt toward your finger and catch the light. *Cut:* the constant floating of icons and the
drifting background blob — they moved without saying anything. The background now moves only with
your tilt (depth), not on its own.

**Opening / closing an app.** Window grows from the icon (`default`), the home screen sinks back and
dims (it's now further away). Closing reverses it into the icon. Interruptible: tap Home mid-flight
and it turns around from wherever it is.

**AI chat.** Your message rises from the composer (`bouncy`); the send button pushes down and
launches; the reply grows from the avatar; the orb swells while you type. *Cut:* the shimmer on idle
text.

**Create.** A finished picture develops from blur; tiles drop in; tapping a tile flies it into the
viewer. *Cut:* the gallery's endless loading shimmer once pictures have arrived.

**Sheets.** Grow from the tapped button; drag to dismiss with your speed; a sheet that's let go early
springs back with the `flick` spring.

**Status pill.** Lives on the top layer; opens out of itself (`playful`), cards inside settle one
after another. Numbers that change give a small tick.

### 1.5 Reduce Motion (designed, not just switched off)

When the device asks for reduced motion, or Settings → Motion is **Off**:

- Nothing slides, scales, tilts or bounces. Depth stays (shadows and highlights remain, so the
  layers still read), but it is still.
- Changes **cross-fade** in 150 ms, so you can still see what changed and where.
- Parallax and the GPU background are off. The countdown and live numbers still update.

### 1.6 Performance rules

- Only `transform`, `opacity` and (sparingly) `filter` animate; never layout.
- One GPU canvas at most, and only on the home screen; it stops when covered, hidden or on Lite/Off.
- Tilt is read once per frame and written to two CSS variables; nothing else listens to the sensor.
- Every touch answers within one frame; no animation blocks input.

---

## 2. Springs

Apple describes springs by **response** (how long the motion takes, in seconds) and **damping**
(1 = no overshoot, lower = more bounce). The conversion to the physics the `motion` library uses,
for a unit mass:

```ts
// springs.ts
export function ios(response: number, damping: number) {
  return {
    type: 'spring' as const,
    stiffness: (2 * Math.PI / response) ** 2,
    damping: (4 * Math.PI * damping) / response,
    mass: 1,
  };
}
```

| Name | Response (s) | Damping | Stiffness (computed) | Friction / `damping` (computed) | Mass | Used for |
|---|---|---|---|---|---|---|
| `snappy` | 0.30 | 0.86 | 438.65 | 36.02 | 1 | presses, toggles, small controls; the app window shrinking back into its icon |
| `smooth` | 0.50 | 1.00 | 157.91 | 25.13 | 1 | fades of large areas, things leaving; the page look's screen crossfade and question entrance |
| `default` | 0.55 | 0.825 | 130.51 | 18.85 | 1 | app windows opening (SwiftUI's default spring); the page turn; the answer's `layoutId` flight into the trail |
| `bouncy` | 0.50 | 0.70 | 157.91 | 17.59 | 1 | sheets, cards and messages arriving; staggered rows and answers |
| `playful` | 0.45 | 0.58 | 194.96 | 16.20 | 1 | the status pill, icons popping in; the picked answer lifting |
| `flick` | 0.40 | 0.80 | 246.74 | 25.13 | 1 | anything let go mid-drag (keeps the finger's speed): the sheet springing back, the swipe-home drag |

The source app's motion notes round these to 439/36, 158/25, 131/19, 158/18, 195/16 and 247/25. The code uses the
unrounded values.

The same curves exist for CSS as `linear()` easings with a settle duration (§4.1), and the
standalone integrator (§5) takes the same `{ stiffness, damping, mass }` objects.

---

## 3. Motion levels

### 3.1 The three levels and the pref

```ts
export type MotionPref  = 'system' | 'full' | 'lite' | 'reduce';   // the person's setting
export type MotionLevel = 'full' | 'lite' | 'off';                 // what runs
```

| Level | Meaning |
|---|---|
| `full` | springs, morphs, tilt, blur |
| `lite` | short fades and moves (180 ms ease) |
| `off` | nothing moves; things that appear cross-fade in 150 ms |

Resolution, in priority order:

```ts
export function resolveLevel(pref: MotionPref, osReduce: boolean, probe: 'full' | 'lite'): MotionLevel {
  if (pref === 'reduce') return 'off';
  if (pref === 'full') return 'full';
  if (pref === 'lite') return 'lite';
  return osReduce ? 'off' : probe;      // pref === 'system'
}
```

`osReduce` is `matchMedia('(prefers-reduced-motion: reduce)')`, followed live. The source app's default
setting was `motion: 'full'` (and a stored `'system'` that the person never explicitly picked is
migrated to `'full'`), so the probe only matters for people who choose Auto.

### 3.2 The frame probe (`measureFrames`)

Safari can't tell a page about Low Power Mode or the device's speed, so the probe measures:

- Sample `requestAnimationFrame` timestamps for **550 ms** (`measureFrames(ms = 550)`).
- Drop the **first 3** timestamps (page still loading), compute the gaps between the rest, drop the first (always 0) gap, sort.
- Take the **median gap**; if no gaps, assume 16 ms.
- **median > 24 ms → `'lite'`**, otherwise `'full'`. (Low Power Mode caps iPhones at 30 fps, a 33 ms gap.)
- Without `requestAnimationFrame` the result is `'full'`.

The result is cached in `localStorage` under the key `orbit:motion:probe:v1` as
`{ level, at: Date.now() }` and reused for **7 days** (`7 * 24 * 3600 * 1000` ms). Storage errors
are swallowed. The provider starts from the cached value (or `'full'`) and re-measures on every
mount while `pref === 'system'`.

### 3.3 What each level swaps springs for

```ts
export function transitionFor(level: MotionLevel, name: SpringName = 'bouncy') {
  if (level === 'off')  return { duration: 0.15, ease: 'easeOut' as const };
  if (level === 'lite') return { type: 'tween' as const, duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const };
  return SPRING[name];
}
```

| Level | Returned transition |
|---|---|
| `full` | the named spring (default `bouncy`) |
| `lite` | `{ type: 'tween', duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }` |
| `off` | `{ duration: 0.15, ease: 'easeOut' }` |

Components use the pattern `full ? { ...SPRING.x, delay } : transitionFor(level)`: at Lite and Off
they drop every `y`, `scale`, `x` and `filter` from their `initial`/`exit` objects and keep only
`opacity`, so the tween is a plain fade (see every recipe in §12).

`useSpringTransition(name)` is the memoised hook form of `transitionFor(level, name)`.

### 3.4 `data-motion` on `<html>` and how CSS reads it

The provider writes `document.documentElement.dataset.motion = level` on every change. CSS then
scopes with `:root[data-motion='full']`, `:root[data-motion='lite']`, `:root[data-motion='off']` and
`:root:not([data-motion='full'])`. See §4.4 for the Off and Lite blocks.

The source app's settings hook also wrote a second attribute, outside the motion package, which the host app
should reproduce if it uses the token durations (`--dur-fast` 140 ms, `--dur-med` 240 ms):

```ts
// useApplySettings (the source app; quoted in docs/02-tokens.md §14)
root.dataset.reduceMotion = settings.motion === 'system' ? '' : settings.motion === 'reduce' ? 'true' : 'false';
if (settings.motion === 'system') delete root.dataset.reduceMotion;
```

```css
/* tokens.css */
@media (prefers-reduced-motion: reduce) {
  :root:not([data-reduce-motion='false']) { --dur-fast: 0ms; --dur-med: 0ms; }
}
:root[data-reduce-motion='true'] { --dur-fast: 0ms; --dur-med: 0ms; }
```

So: Off zeroes the token durations; Full and Lite opt out of the OS media query; Auto leaves the
media query in charge.

### 3.5 The provider

```tsx
<MotionProvider pref="system" tilt={false} tiltGranted={false}>…</MotionProvider>
```

- `pref` (default `'system'`), `tilt` (default `false`), `tiltGranted` (default `false`).
- Tilt runs only while `level === 'full' && tilt`; `startTilt({ askOnTap: Boolean(tiltGranted) })` is started and its stop function returned from the effect.
- `useMotionLevel()` returns the level (context default `'full'` outside a provider).
- `useMotionLevel() === 'off'` is exactly the source app's `useReducedMotion()` (`pref === 'reduce' || (pref === 'system' && osReduce)`), since the probe never yields `off`.

---

## 4. CSS motion (`motion.css`, verbatim copy)

### 4.1 Spring easings and durations

Fallbacks for browsers without `linear()`:

```css
:root {
  --spring-snappy: cubic-bezier(0.2, 0.9, 0.3, 1);
  --spring-smooth: cubic-bezier(0.25, 0.8, 0.25, 1);
  --spring-default: cubic-bezier(0.25, 1.05, 0.4, 1);
  --spring-bouncy: cubic-bezier(0.3, 1.25, 0.5, 1);
  --spring-playful: cubic-bezier(0.34, 1.56, 0.64, 1);
  --spring-flick: cubic-bezier(0.25, 1.1, 0.4, 1);
  --ease-soft: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-bounce: var(--spring-playful);
}
```

The iOS springs of §2 sampled into CSS curves (duration = time to settle):

```css
@supports (transition-timing-function: linear(0, 1)) {
  :root {
    --spring-snappy: linear(0, 0.122, 0.331, 0.533, 0.696, 0.814, 0.893, 0.942, 0.972, 0.99, 0.997, 1.001, 1.002, 1.002, 1.002, 1.001, 1.001, 1);
    --spring-smooth: linear(0, 0.048, 0.145, 0.279, 0.393, 0.497, 0.589, 0.667, 0.743, 0.795, 0.837, 0.871, 0.898, 0.923, 0.94, 0.953, 0.963, 0.971, 0.979, 0.983, 0.987, 0.99, 0.992, 0.994, 0.995, 0.996, 0.997, 0.998, 0.998, 0.999, 1);
    --spring-default: linear(0, 0.042, 0.131, 0.243, 0.363, 0.478, 0.584, 0.676, 0.766, 0.828, 0.877, 0.916, 0.945, 0.966, 0.982, 0.992, 0.999, 1.004, 1.006, 1.007, 1.007, 1.007, 1.006, 1.005, 1.004, 1.004, 1.003, 1.002, 1.002, 1.001, 1.001, 1);
    --spring-bouncy: linear(0, 0.051, 0.16, 0.298, 0.466, 0.601, 0.719, 0.817, 0.893, 0.951, 0.996, 1.021, 1.034, 1.04, 1.041, 1.038, 1.032, 1.026, 1.02, 1.015, 1.01, 1.006, 1.003, 1.001, 1, 0.999, 0.998, 0.998, 0.998, 0.999, 0.999, 1);
    --spring-playful: linear(0, 0.063, 0.2, 0.371, 0.548, 0.711, 0.867, 0.967, 1.036, 1.078, 1.097, 1.1, 1.092, 1.077, 1.059, 1.042, 1.024, 1.011, 1.002, 0.995, 0.992, 0.99, 0.99, 0.991, 0.993, 0.994, 0.996, 0.998, 0.999, 1, 1.001, 1);
    --spring-flick: linear(0, 0.075, 0.222, 0.389, 0.547, 0.682, 0.803, 0.879, 0.932, 0.968, 0.99, 1.002, 1.008, 1.011, 1.01, 1.009, 1.007, 1.006, 1.004, 1.003, 1.002, 1.001, 1.001, 1);
  }
}
```

| Duration token | Value | Pair with |
|---|---|---|
| `--dur-snappy` | 0.43s | `--spring-snappy` |
| `--dur-smooth` | 0.78s | `--spring-smooth` |
| `--dur-default` | 0.78s | `--spring-default` |
| `--dur-bouncy` | 0.8s | `--spring-bouncy` |
| `--dur-playful` | 0.79s | `--spring-playful` |

There is no `--dur-flick`; the flick spring is only used from JavaScript (`springValue`). Other
duration/ease tokens motion.css refers to come from the token layer (tokens.css): `--dur-fast: 140ms`,
`--dur-med: 240ms`, `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`; and Orbit 0.5's house ease
`--ease-o5: cubic-bezier(0.22, 1, 0.36, 1)`, `--dur-o5: 520ms` (o5.css; also declared in `depth.css`).

### 4.2 Light and depth shadows

`--tx` / `--ty` (−1…1) come from tilt (§7). Shadows swing away from the light, highlights slide toward it.

```css
:root {
  --sx: calc(var(--tx, 0) * -3px);
  --sy: calc(var(--ty, 0) * -3px);
  --depth-1: var(--lit), calc(1px + var(--sx)) calc(2px + var(--sy)) 4px rgb(0 0 0 / 0.22), calc(2px + var(--sx) * 2) calc(6px + var(--sy) * 2) 14px rgb(0 0 0 / 0.18);
  --depth-1-pressed: var(--lit), 0 1px 2px rgb(0 0 0 / 0.3);
  --depth-2: var(--lit), calc(2px + var(--sx) * 2) calc(4px + var(--sy) * 2) 8px rgb(0 0 0 / 0.22), calc(4px + var(--sx) * 3) calc(14px + var(--sy) * 3) 30px rgb(0 0 0 / 0.24);
  --depth-3: var(--lit), 3px 8px 16px rgb(0 0 0 / 0.22), 8px 28px 60px rgb(0 0 0 / 0.36);
  --depth-4: var(--lit), 3px 10px 20px rgb(0 0 0 / 0.25), 10px 32px 70px rgb(0 0 0 / 0.4);
}
:root[data-theme='light'] {
  --depth-1: var(--lit), calc(1px + var(--sx)) calc(2px + var(--sy)) 4px rgb(15 23 42 / 0.1), calc(2px + var(--sx) * 2) calc(6px + var(--sy) * 2) 14px rgb(15 23 42 / 0.1);
  --depth-1-pressed: var(--lit), 0 1px 2px rgb(15 23 42 / 0.14);
  --depth-2: var(--lit), calc(2px + var(--sx) * 2) calc(4px + var(--sy) * 2) 8px rgb(15 23 42 / 0.1), calc(4px + var(--sx) * 3) calc(14px + var(--sy) * 3) 30px rgb(15 23 42 / 0.14);
  --depth-3: var(--lit), 3px 8px 16px rgb(15 23 42 / 0.12), 8px 28px 60px rgb(15 23 42 / 0.2);
  --depth-4: var(--lit), 3px 10px 20px rgb(15 23 42 / 0.14), 10px 32px 70px rgb(15 23 42 / 0.22);
}
```

`--lit` is the inset rim highlight from `glass.css` (the colour layer). Without it the
whole `box-shadow` is invalid and falls back to none, so the colour layer must define it.

Who sits on which layer (selectors as shipped):

| Layer | Selectors | Rule |
|---|---|---|
| 1 | `.app-icon .glyph, .home .widget, .ai-card, .ai-suggest-btn, .ai-tile, .cc-tile` | `box-shadow: var(--depth-1)` |
| 2 | `.dock, .ai-composer-card`; `.app-window:not([data-placement='full']):not([data-placement^='split'])` | `box-shadow: var(--depth-2)` |
| 3 | `.sheet` | `box-shadow: var(--depth-3)` |
| 4 | `.toast` | `box-shadow: var(--depth-4)` |

The sheen (a radial highlight whose centre slides with the tilt):

```css
.app-icon .glyph::after, .home .widget::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: radial-gradient(120% 80% at calc(25% - var(--tx, 0) * 30%) calc(0% - var(--ty, 0) * 30%), rgb(255 255 255 / 0.26), transparent 55%);
  mix-blend-mode: soft-light;
}
:root[data-theme='light'] .home .widget::after { background: radial-gradient(120% 80% at calc(25% - var(--tx, 0) * 30%) calc(0% - var(--ty, 0) * 30%), rgb(255 255 255 / 0.7), transparent 60%); mix-blend-mode: normal; }
```

### 4.3 Parallax (Full only)

```css
:root[data-motion='full'] .home-inner { translate: calc(var(--tx, 0) * 2px) calc(var(--ty, 0) * 2px); }
:root[data-motion='full'] .dock { translate: calc(var(--tx, 0) * 3px) calc(var(--ty, 0) * 2px); }
.shell::before {   /* the far layer: two accent blobs behind everything */
  content: ''; position: absolute; inset: -30px; z-index: -1; pointer-events: none;
  background:
    radial-gradient(40% 36% at 22% 18%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 70%),
    radial-gradient(36% 34% at 80% 72%, color-mix(in srgb, #06b6d4 20%, transparent), transparent 70%);
  translate: calc(var(--tx, 0) * -14px) calc(var(--ty, 0) * -14px);
  opacity: 0.75;
}
:root[data-theme='light'] .shell::before { opacity: 0.45; }
.home-light { … opacity: 0; animation: mo-light-in 0.6s ease-out forwards; }
@keyframes mo-light-in { to { opacity: 1; } }
```

| Layer | Parallax in CSS |
|---|---|
| Far (`.shell::before`) | `−14px × tx`, `−14px × ty` (against the tilt) |
| Classic home grid (`.home-inner`) | `2px × tx`, `2px × ty` |
| Dock | `3px × tx`, `2px × ty` |

### 4.4 Pressing (Full only)

```css
:root[data-motion='full'] :is(.btn, .icon-btn, .segmented button, button.chip, .cc-tile, button.row, .ai-suggest-btn, .ai-model-row, .ai-model-chip, .ai-send, .ai-tile, .dock-item .glyph, .app-icon .glyph) {
  transition-property: transform, background-color, border-color, box-shadow, color, opacity;
  transition-duration: var(--dur-playful), 0.15s, 0.15s, 0.2s, 0.15s, 0.15s;
  transition-timing-function: var(--spring-playful), ease, ease, ease, ease, ease;
}
/* Press = pushed into the surface: smaller and its shadow tucks in. */
:root[data-motion='full'] :is(.app-icon, .dock-item):active .glyph,
:root[data-motion='full'] :is(.ai-suggest-btn, .ai-tile, .cc-tile):active { box-shadow: var(--depth-1-pressed); transition-duration: var(--dur-snappy), 0.1s, 0.1s, 0.1s, 0.1s, 0.1s; transition-timing-function: var(--spring-snappy); }
:root[data-motion='full'] :is(.btn, .icon-btn, .segmented button, button.chip, .cc-tile, button.row, .ai-suggest-btn, .ai-model-row, .ai-model-chip, .ai-send, .ai-tile):active:not(:disabled) { transform: scale(0.92); }
:root[data-motion='full'] .app-icon:active .glyph,
:root[data-motion='full'] .dock-item:active .glyph { transform: scale(0.8); }
```

So a press goes *down* at `snappy` (0.43 s curve, 0.1 s for colours) and comes *back* at `playful`
(0.79 s curve). Buttons press to scale 0.92; icons in the grid and dock to 0.8. (the source app's motion notes say
0.95; the CSS shipped 0.92 / 0.8.)

### 4.5 Every keyframe

```css
@keyframes mo-light-in  { to { opacity: 1; } }
@keyframes mo-icon-pop  { from { opacity: 0; transform: translateY(26px) scale(0.55); } }
@keyframes mo-fade-up   { from { opacity: 0; transform: translateY(10px); } }
@keyframes mo-sheet-in  { from { transform: translateY(60px) scale(0.98); opacity: 0; } }
@keyframes mo-toast-in  { from { opacity: 0; transform: translateY(-14px) scale(0.92); } }
@keyframes mo-xfade     { from { opacity: 0; } }
@keyframes mo-shimmer   { to { background-position: -200% 0; } }
@keyframes mo-viewer-in { from { transform: scale(0.82); opacity: 0; } }
@keyframes mo-bob       { 50% { transform: translateY(-2px) scale(1.12); } }
@keyframes mo-pop-right { from { opacity: 0; transform: translate(26px, 14px) scale(0.7); } }
@keyframes mo-pop-left  { from { opacity: 0; transform: translate(-14px, 14px) scale(0.92); } }
@keyframes mo-breathe   { 50% { transform: scale(1.14); } }
@keyframes mo-chip-pop  { 40% { transform: scale(1.12); } }
@keyframes mo-launch {
  30%  { transform: translate(-3px, 3px) scale(0.78) rotate(8deg); }
  65%  { transform: translate(7px, -9px) scale(0.9) rotate(-12deg); opacity: 0.4; }
  100% { transform: translate(0, 0) scale(1) rotate(0); }
}
```

(`ai-spin` is referenced by `.ai-avatar-live` and `.ai-job-art` but defined in another stylesheet; it is a plain rotation.)

Where each is used:

| Selector | Level | Animation |
|---|---|---|
| `.home-grid .app-icon` | full | `mo-icon-pop var(--dur-playful) var(--spring-playful) both`, delay `calc(var(--i, 0) * 55ms + 100ms)` |
| `.home .widget` | full | `mo-fade-up 0.6s var(--ease-soft) both`; `:nth-child(1/2/3)` delays 0.45s / 0.52s / 0.59s |
| `.home-grid .app-icon` | lite | `mo-fade-up 0.25s var(--ease-soft) both`, delay `calc(var(--i, 0) * 25ms)` |
| `.app-window` | full | `transition: left var(--dur-med) var(--ease-out), right var(--dur-med) var(--ease-out)` (JavaScript animates the rest) |
| `.home` | full | `transition: transform var(--dur-default) var(--spring-default), opacity 0.3s var(--ease-soft), filter 0.3s ease` |
| `.home[data-hidden='true']` | full | `transform: scale(0.92); filter: brightness(0.7)` (an app is in front: home is further away) |
| `.sheet:not([data-grown])` | full | `mo-sheet-in var(--dur-bouncy) var(--spring-bouncy) backwards` |
| `.toast` | full | `mo-toast-in var(--dur-playful) var(--spring-playful) both` |
| `.sheet-scrim` | full | `animation-duration: 0.3s` |
| `.ai-dev` (a picture developing) | full | `transition: filter 1.1s var(--ease-soft), transform 1s var(--ease-bounce), opacity 0.5s ease`; while `[data-loaded='false']`: `filter: blur(24px) saturate(0) brightness(0.75); transform: scale(1.1); opacity: 0.55` |
| `.ai-dev` | lite | `transition: opacity 0.25s ease`; not loaded → `opacity: 0` |
| `.ai-tile:has(.ai-dev[data-loaded='false'])` | full | `mo-shimmer 1.8s linear infinite` over a `linear-gradient(110deg, var(--surface-3) 30%, var(--surface-2) 50%, var(--surface-3) 70%)` at `background-size: 200% 100%` |
| `.ai-gallery li` | full | `mo-icon-pop 0.65s var(--ease-bounce) both`, delay `calc(var(--i, 0) * 45ms)` |
| `.ai-gallery li` | lite | `mo-fade-up 0.25s var(--ease-soft) both`, delay `calc(var(--i, 0) * 20ms)` |
| `.sheet:not([data-grown]) .ai-viewer img/video` | full | `mo-viewer-in 0.7s var(--ease-bounce) backwards` |
| `.ai-job-art[data-live='true']::before` | full | conic gradient `#8b5cf6, #06b6d4, #22c55e, #f59e0b, #8b5cf6`, opacity 0.35, `ai-spin 3s linear infinite` |
| `.ai-job-art[data-live='true'] svg` | full | `mo-bob 1.4s ease-in-out infinite` |
| `.ai-job` | full | `mo-fade-up 0.45s var(--ease-bounce) both` |
| `.ai-msg` | full | `mo-pop-left 0.6s var(--ease-bounce) both`, `transform-origin: left bottom` |
| `.ai-msg-user` | full | `animation-name: mo-pop-right`, `transform-origin: right bottom` |
| `.ai-avatar-live` | full | `ai-spin 2.4s linear infinite, mo-breathe 1.1s ease-in-out infinite` |
| `.ai-hello .ai-orb` | full | `transition: transform 0.7s var(--ease-bounce), box-shadow 0.4s ease`; while `[data-typing='true']`: `transform: scale(1.25); box-shadow: 0 0 70px rgb(6 182 212 / 0.6)` |
| `.ai-model-chip-name` | full | `mo-chip-pop 0.5s var(--ease-bounce)` |
| `.ai-send[data-launch='true']` | any but off | `mo-launch 0.55s var(--ease-soft)`; off → `animation: none` |
| `.ai-card` | full | `animation-timing-function: var(--ease-bounce)` |

### 4.6 Tilt class (set by `useTilt`)

```css
.tilt { transform: perspective(700px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform 0.6s var(--ease-bounce); }
.tilt[data-tilting='true'] { transition: transform 0.08s linear; }
:root:not([data-motion='full']) .tilt { transform: none; }
```

### 4.7 Lite and Off overrides

Lite has no blanket rule; each selector gets its own shorter animation (the `lite` rows above:
`mo-fade-up 0.25s`, 20–25 ms staggers, `opacity`-only transitions). On the JavaScript side, Lite is the
180 ms tween of §3.3.

Off is a blanket rule, then a designed cross-fade for the things that appear:

```css
:root[data-motion='off'] *,
:root[data-motion='off'] *::before,
:root[data-motion='off'] *::after {
  animation-duration: 0.001ms !important;
  animation-delay: 0ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  transition-delay: 0ms !important;
}
/* Off is designed, not empty: nothing moves, but things that appear cross-fade. */
@keyframes mo-xfade { from { opacity: 0; } }
:root[data-motion='off'] :is(.sheet, .sheet-scrim, .toast, .cc-panel, .switcher) {
  animation: mo-xfade 0.15s ease-out both !important;
  animation-duration: 0.15s !important;
}
```

### 4.8 Odds and ends in motion.css

- `.dock { touch-action: none; }` — the dock is swiped up to go home, so the browser must not scroll on it.
- `.sheet-grip { touch-action: none; cursor: grab; }` and `.sheet-grip .icon-btn { cursor: pointer; }` — the sheet's handle and title are the drag area.
- `.shell, .app-host, .app-window { overflow: clip; }` — `clip` can never be scrolled, not even by the browser bringing a focused field into view while an app is still sliding open.
- Glass Island: `.shell[data-island='true'] { --island-top: calc(env(safe-area-inset-top, 0px) + 44px); }` (40px at `max-height: 520px`); `.app-host`, `.home`, `.shell-topbar` start at `--island-top` with `--safe-top: 0px`; `.toasts` sit at `calc(var(--island-top) + 8px)`.

---

## 5. The standalone spring integrator (`physics.ts`)

A real spring for things you let go of mid-gesture. Unlike a CSS/WAAPI curve it starts at the
finger's speed, so a flick carries on at the pace you threw it. It integrates in small fixed steps
each frame, and can be stopped at any point (to grab it again).

Algorithm:

1. State `x = from`, `v = velocity` (units per second, same units as `from`/`to`), `mass = spring.mass ?? 1`.
2. Each animation frame, `elapsed` = time since the previous frame in seconds, **capped at 0.064 s**; the first frame uses **1/60 s**.
3. Integrate semi-implicit Euler in **fixed 1/240 s sub-steps** (the last sub-step is the remainder): `a = (−k·(x − to) − c·v) / m; v += a·dt; x += v·dt`.
4. Rest test, relative to `range = max(1e-6, |to − from|)`: `|x − to| / range < rest` **and** `|v| / range < rest · 60`, with `rest = 0.0005` by default. At rest it writes exactly `to` and resolves `finished` with `true`.
5. `stop()` cancels the frame and resolves `finished` with `false`.

```ts
export function springValue({ from, to, velocity = 0, spring, onUpdate, rest = 0.0005 }: {
  from: number; to: number; velocity?: number; spring: SpringParams; onUpdate: (value: number) => void; rest?: number;
}) {
  const mass = spring.mass ?? 1;
  let x = from;
  let v = velocity;
  let raf = 0;
  let last = 0;
  let resolve: (finished: boolean) => void = () => {};
  const finished = new Promise<boolean>((r) => (resolve = r));
  const step = (t: number) => {
    const elapsed = last ? Math.min(0.064, (t - last) / 1000) : 1 / 60;
    last = t;
    for (let left = elapsed; left > 0; left -= 1 / 240) {
      const dt = Math.min(1 / 240, left);
      const a = (-spring.stiffness * (x - to) - spring.damping * v) / mass;
      v += a * dt;
      x += v * dt;
    }
    const range = Math.max(1e-6, Math.abs(to - from));
    if (Math.abs(x - to) / range < rest && Math.abs(v) / range < rest * 60) {
      onUpdate(to);
      return resolve(true);
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { finished, stop() { cancelAnimationFrame(raf); resolve(false); } };
}
```

Callers always pass `SPRING.flick` and convert pointer velocity from px/ms to px/s with `* 1000`
(the sheet spring-back, `homeCancel`, `flyFromDrag`).

---

## 6. Feedback (`feedback.ts`)

Optional sound and vibration for key moments. Both are off until switched on:
`configureFeedback({ sound: true, haptics: true })` (a settings screen; defaults `false`/`false`).
Sounds are sine notes made with the Web Audio API; no files.

| Cue | Notes `[start Hz, end Hz, seconds, volume]`, played in a row | Vibration (`navigator.vibrate`) |
|---|---|---|
| `tap` | `[520, 420, 0.05, 0.04]` | `6` ms |
| `pop` | `[380, 760, 0.09, 0.07]` | `10` ms |
| `send` | `[420, 640, 0.07, 0.06]`, `[640, 980, 0.1, 0.05]` | `14` ms |
| `done` | `[660, 660, 0.08, 0.06]`, `[880, 880, 0.14, 0.06]` | `[12, 40, 12]` |
| `error` | `[260, 170, 0.18, 0.07]` | `[30, 50, 30]` |

How a note plays: frequency ramps exponentially from start to end over `dur`; gain starts at 0.0001,
ramps exponentially to `vol` in 0.012 s, then back to 0.0001 at `dur`; the oscillator stops at
`dur + 0.02`; the next note starts `dur × 0.8` later (notes overlap by 20 %). A suspended
`AudioContext` is resumed on use. `webkitAudioContext` is accepted.

Vibration: `navigator.vibrate(pattern)` where available. Safari on iPhone can't vibrate, so a hidden
`<input type="checkbox" switch>` (1×1 px, fixed, off-screen, `aria-hidden`, `tabIndex −1`) is
clicked instead, which gives a light tap on iOS 17.4+.

API: `cue(name)` plays sound and/or buzz according to the config; `tick()` is vibration only, the
`tap` pattern, for the orb passing over something it can press.

Who calls what in the source app: `send` on sending a chat message; `done` when a reply or a picture
finishes; `error` on failure (unless the person stopped it); `pop` when a switch is turned on in
Settings and when the orb opens/lands; `tap` when the orb presses; `tick()` as the orb hovers.

---

## 7. Tilt and parallax (`tilt.ts`, `useTilt.ts`)

### 7.1 Global tilt → `--tx` / `--ty`

`startTilt({ askOnTap })` writes two numbers on `<html>`, `--tx` and `--ty` in −1…1, once per
frame while they change. Nothing else listens to the sensor. CSS (§4.2–4.3) turns them into shadow
offsets, the sheen position and parallax.

- **Smoothing**: each frame `tx += (gx − tx) × 0.12` (same for y); the frame loop stops once `|gx − tx| + |gy − ty| ≤ 0.002`; written with 3 decimals.
- **Sensor** (`deviceorientation`): the first reading becomes "level" (`base`); the base then follows the grip slowly, `base += (reading − base) × 0.01` per event. `gx = clamp((gamma − base.gamma) / 18)`, `gy = clamp((beta − base.beta) / 18)` — 18° of tilt is full travel.
- **Mouse fallback**, only when `(pointer: fine)` matches and `pointerType === 'mouse'`: `gx = clamp(clientX / innerWidth × 2 − 1)`, `gy = clamp(clientY / innerHeight × 2 − 1)`; `pointerleave` on the document returns both to 0.
- **Stop** removes the listeners, cancels the frame and removes `--tx` / `--ty`.

Permission flow (iPhone/iPad Safari): `tiltNeedsPermission()` is true when
`DeviceOrientationEvent.requestPermission` exists. `requestTiltPermission()` must run from a tap and
resolves `true` on `'granted'` (or when no permission is needed; `false` on error). With
`askOnTap: true` (the source app: `settings.tiltGranted`), the first `pointerup` of the visit asks again
silently. In the source app the Settings "Tilt effects" toggle asked the first time, from its own tap:
`requestTiltPermission().then((ok) => updateSettings({ tilt: true, tiltGranted: ok || settings.tiltGranted }))`;
the toggle shows as on only when `settings.tilt && (!tiltNeedsPermission() || tiltGranted)`. The
setting defaults to `tilt: true`.

`recentTap(withinMs = 700)` is a side service of the same module: a capturing `pointerdown`
listener records where the last tap landed, so sheets can grow from it (§12.12).

### 7.2 Per-card tilt (`useTilt(maxDeg = 7)`)

Spread the returned props on a card (`className: 'tilt'`, pointer handlers). On pointer down, and on
move while a button is held or the pointer is a mouse, it writes once per frame:

```
x = (clientX − left) / width − 0.5        y = (clientY − top) / height − 0.5
--ry = x × maxDeg × 2 deg                 --rx = −y × maxDeg × 2 deg
data-tilting = 'true'
```

So the edge under the pointer dips by up to `maxDeg` degrees. Up/leave/cancel reset both to 0deg
and `data-tilting='false'`. Does nothing unless the level is `full`. The CSS (§4.6) applies
`perspective(700px) rotateX(--rx) rotateY(--ry)` with `transition: transform 0.6s var(--ease-bounce)`
at rest and `0.08s linear` while tilting; outside Full the transform is `none`.

The source app's classic home uses `useTilt(5)` on its three glass widgets.

---

## 8. Morph (`morph.ts`)

Apps grow out of the icon you tapped and shrink back into it. It is a uniform scale (text is never
squashed) plus a `clip-path` that crops the window down to the icon's shape. Everything animates
with `animate` from `motion/mini`; one live animation per element (a newer one cancels the older).

Geometry (`frame(el, icon)`), with `transform-origin: 0 0`:

```
s          = min(1, icon.width / win.width)
tx, ty     = icon.left − win.left, icon.top − win.top
cropBottom = max(0, win.height − icon.height / s)
radius     = round(icon.width × 0.225 / s)
from.transform = translate(tx px, ty px) scale(s)
from.clip      = inset(0px 0px cropBottom px 0px round radius px)
OPEN           = { clip: 'inset(0px 0px 0px 0px round 0px)', transform: 'translate(0px, 0px) scale(1)' }
```

| Function | Level | Keyframes | Options |
|---|---|---|---|
| `morphIn(el, id, level)` | full, icon found | `transform: [from, OPEN]`, `clipPath: [from, OPEN]`, `opacity: [0.2, 1, 1]` | `{ ...SPRING.default, opacity: { duration: 0.18 } }` |
| | full without icon, or lite | `opacity: [0, 1]`, `transform: ['scale(0.97)', 'scale(1)']` | `{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }` |
| | off | `opacity: [0, 1]` | `{ duration: 0.15, ease: 'easeOut' }` |
| `morphOut(el, id, level, toIcon)` | full, flung (see below), icon | `flyFromDrag` | `SPRING.flick` via `springValue` |
| | full, icon (`toIcon` true) | `transform: [OPEN, to]`, `clipPath: [OPEN, to]`, `opacity: [1, 1, 0]` | `{ ...SPRING.snappy, opacity: { duration: 0.26, times: [0, 0.7, 1] } }` |
| | otherwise (lite, or another app taking over) | `opacity: [1, 0]`, `transform: ['scale(1)', 'scale(0.97)']` | `{ duration: 0.16, ease: 'easeIn' }` |
| | off | `opacity: [1, 0]` | `{ duration: 0.15, ease: 'easeOut' }` |

`cancelMorph(el)` stops the live animation, removes `transform`, `opacity`, `clip-path`,
`visibility`, `transform-origin`, `filter` from the element, and un-scrolls any clipping ancestor
named in `scrollRoots` (default `['shell', 'app-host']`) that the browser scrolled to reveal a
focused field mid-animation. `morphOut` first forces `visibility: visible; opacity: 1`.

`iconRect(id)` tries, in order (default `configureMorph().iconSelectors`):
`.home:not([data-hidden='true']) [data-app-id="${id}"] .glyph`, `.dock [data-app-id="${id}"] .glyph`,
`[data-app-id="${id}"] .glyph`; the first with a non-zero rect wins.

### 8.1 Swipe up to go home

- `homeDrag(el, up)` poses the window for a drag of `up` px: `s = max(0.4, 1 − (up / h) × 0.9)`, `tx = w(1 − s)/2`, `ty = h(1 − s) − up × 0.35`, no crop, corner radius `28 / s` px (so it reads as 28 px on screen). Scaled about its bottom centre, lifted a little.
- `homeFling(el, up, velocity)` records `{ up, v }` for the coming `morphOut`.
- `homeCancel(el, up, velocity)` springs `up → 0` with `SPRING.flick`, `velocity × 1000` (px/ms → px/s), applying `dragPose` each frame; on a finished spring it calls `cancelMorph`.
- `flyFromDrag` (inside `morphOut`): interpolates pose `a` (the drag pose) to pose `b` (the icon frame) on a 0→1 spring, `SPRING.flick`, with initial velocity `min(8, v × 1000 / dist)` where `dist = max(40, hypot(Δtx, Δty))`; opacity fades `(1 − t) / 0.2` clamped, so the window is gone by 80 % of the way.

The thresholds that decide fling versus cancel live in the Dock (§12.9).

### 8.2 Turning the page (Orbit 0.5, app → app)

| Function | Level | Keyframes | Options |
|---|---|---|---|
| `pageTurnIn` | full | `transform: ['perspective(1600px) translateX(22%) rotateY(-16deg)', 'perspective(1600px) translateX(0%) rotateY(0deg)']`, `opacity: [0, 1, 1]`, `filter: ['brightness(1.12)', 'brightness(1)']`; `transform-origin: 0% 50%` | `{ ...SPRING.default, opacity: { duration: 0.22, times: [0, 0.6, 1] }, filter: { duration: 0.5 } }` |
| | lite | `transform: ['translateX(6%)', 'translateX(0%)']`, `opacity: [0, 1]` | `{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }` |
| | off | `opacity: [0, 1]` | `{ duration: 0.15, ease: 'easeOut' }` |
| `pageTurnOut` | full | `transform: ['perspective(1600px) translateX(0%) scale(1)', 'perspective(1600px) translateX(-14%) scale(0.94)']`, `opacity: [1, 0]`, `filter: ['brightness(1)', 'brightness(0.7)']`; `transform-origin: 100% 50%` | `{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }` |
| | lite | `transform: ['translateX(0%)', 'translateX(-4%)']`, `opacity: [1, 0]` | `{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }` |
| | off | `opacity: [1, 0]` | `{ duration: 0.15, ease: 'easeOut' }` |

---

## 9. Scroll depth (`depth.ts` + `depth.css`)

`useScrollDepth(scrollerRef, enabled = true, mode = 'center' | 'edges')` gives every `[data-depth]`
descendant of the scroller two inline custom properties, recomputed at most once per frame on
`scroll` (passive) and window `resize`, and once on mount:

- `--p`: −1 (above) … 0 (in place) … 1 (below), 3 decimals.
- `--ap`: `|--p|`.

Disabled when `enabled` is false or the level is `off`; on cleanup both properties are removed.
CSS keeps Lite to an opacity fade. The computation, exactly:

```ts
const box = el.getBoundingClientRect();
const mid = box.top + box.height / 2;
for (const child of el.querySelectorAll<HTMLElement>('[data-depth]')) {
  const r = child.getBoundingClientRect();
  const raw =
    mode === 'edges'
      ? r.top < box.top && r.bottom < box.bottom
        ? (r.top - box.top) / box.height            // sliding off the top
        : r.bottom > box.bottom && r.top > box.top
          ? (r.bottom - box.bottom) / box.height    // sliding off the bottom
          : 0                                       // fully in view (or spanning): crisp
      : r.height < box.height
      ? (r.top + r.height / 2 - mid) / box.height   // 'center': distance of its middle from the middle
      : r.top > box.top
        ? (r.top - box.top) / box.height            // taller than the screen: only once its top edge shows
        : r.bottom < box.bottom
          ? (r.bottom - box.bottom) / box.height    // …or its bottom edge
          : 0;
  const p = Math.max(-1, Math.min(1, raw));
  child.style.setProperty('--p', p.toFixed(3));
  child.style.setProperty('--ap', Math.abs(p).toFixed(3));
}
```

`'center'` is for pages a screen tall (the Orbit 0.5 home, the page look's flow); `'edges'` for
shorter sections (page sheets: any `Sheet` with `page`) that must stay crisp while fully
in view.

Every rule that consumes `--p` / `--ap` (all copied into `depth.css`):

| Where | Level | transform | opacity | filter |
|---|---|---|---|---|
| Home path `.o5-spread .o5-page` | full | `translate3d(0, calc(var(--p) * -6vh), calc(var(--ap) * -260px)) rotateX(calc(var(--p) * 9deg))` | `calc(1 - var(--ap) * 0.85)` | `blur(calc(var(--ap) * 3px))` |
| | lite | — | `calc(1 - var(--ap) * 0.7)` | — |
| Home chapter numeral `.o5-numeral` | any | `translate3d(0, calc(-50% + var(--p) * 22vh), -1px)` (drifts slower, far behind) | — | — |
| Page sheet `.sheet[data-page] [data-depth] > :not(.mag-numeral)` | full (`data-skin='o5'`) | `translate3d(0, calc(var(--p) * -3vh), calc(var(--ap) * -160px)) rotateX(calc(var(--p) * 6deg))` | `calc(1 - var(--ap) * 0.7)` | `blur(calc(var(--ap) * 2.5px))` |
| | lite | — | `calc(1 - var(--ap) * 0.55)` | — |
| Page sheet numeral `.mag-numeral` | any (`data-skin='o5'`) | `translate3d(0, calc(var(--p) * 10vh), -1px)`, `z-index: -1` | — | — |
| Page trail `.st-scroll [data-depth] > *` | full | `translate3d(0, calc(var(--p) * -2vh), 0) scale(calc(1 - var(--ap) * 0.06))`, `transform-origin: 0 50%` | `calc(1 - var(--ap) * 0.62)` | `blur(calc(var(--ap) * 3px))` |
| | lite | — | `calc(1 - var(--ap) * 0.5)` | — |

Supporting rules: the home scroller `.o5-path` has `perspective: 1400px; perspective-origin: 50% 50%`,
`scroll-snap-type: y proximity` (none at `max-height: 520px`), and when hidden behind an app
`.o5-path[data-hidden='true'] { opacity: 0; transform: scale(0.94); filter: blur(6px) }` over
`transition: opacity/transform/filter var(--dur-o5) var(--ease-o5)`. Each `.o5-spread` is
`transform-style: preserve-3d`; `.o5-page` is `will-change: transform, opacity`. The depth always
moves a chapter's *contents*, never the `[data-depth]` element itself, so measuring it sees where it
really is.

Also in o5.css (not driven by `--p`, but the same idea for lists): where
`animation-timeline: view()` is supported, at Full, `.ai-msg, .ag-msg, .sr-shot, .o5-go` run
`o5-depth linear both` over `entry 0% exit 100%`:
`0% { opacity: 0.2; transform: perspective(900px) translate3d(0, 26px, -90px) rotateX(-8deg) } 16%, 84% { opacity: 1; transform: none }`.

---

## 10. Chrome on scroll (`chrome.ts` + `depth.css`)

`useChromeOnScroll(enabled, windowSelector = '.app-window')` tucks an app's header away as you
read down and brings it back as you come up. It sets `data-chrome="shown" | "hidden"` on the
closest `windowSelector` ancestor of the element that scrolled. The source app enabled it only in the 0.5
look (`useChromeOnScroll(o5)` in its Shell).

Rules, with the exact numbers:

- Only *your own* scrolling counts: a capturing listener on `touchmove`, `wheel` and `keydown` (only `ArrowDown`, `ArrowUp`, `PageDown`, `PageUp`, `Home`, `End`, space; and not when the key target is inside `button, a, input, textarea, select, [role="slider"], [contenteditable="true"]`) records the time and the target. A scroll event more than **600 ms** after the last input, or whose scroller does not contain that input's target, only updates the remembered position and changes nothing (an app following a reply, or opening at the bottom, doesn't hide the header).
- The scroller must have at least **160 px** of scrollable range (`scrollHeight − clientHeight ≥ 160`).
- `top < 24` px, or a move up of more than **10 px** since the last scroll event (`top − prev < −10`) → `shown`.
- A move down of more than **10 px** (`top − prev > 10`) → `hidden`.
- Cleanup removes `data-chrome` from every matching window.

What CSS does with it (Orbit 0.5):

```css
:root[data-skin='o5'] .app-header { min-height: calc(var(--safe-top) + 60px); max-height: calc(var(--safe-top) + 140px); overflow: hidden;
  transition: max-height var(--dur-o5) var(--ease-o5), opacity var(--dur-o5) var(--ease-o5), padding var(--dur-o5) var(--ease-o5), min-height var(--dur-o5) var(--ease-o5); }
:root[data-skin='o5'] .app-window[data-chrome='hidden'] .app-header { max-height: var(--safe-top); min-height: var(--safe-top); padding-top: var(--safe-top); padding-bottom: 0; opacity: 0; pointer-events: none; }
:root[data-skin='o5'] .app-window[data-chrome='hidden'] .o5-ai-bar { max-height: var(--safe-top); padding-top: var(--safe-top); padding-bottom: 0; opacity: 0; pointer-events: none; }
.o5-runhead { opacity: 0; transform: translateY(-100%); transition: opacity 0.25s ease, transform 0.35s var(--ease-o5); }
.app-window[data-chrome='hidden'] .o5-runhead { opacity: 1; transform: none; }
:root[data-motion='off'] .o5-runhead { transition: none; }
```

The running head ("Orbit · 04 · Terminal") slides down from the top edge to replace the header.
Note the header transition animates `max-height`/`min-height`/`padding` — a deliberate exception
to the transform/opacity rule, bounded to one element.

---

## 11. The Orbit 0.5 house ease

Everything in the 0.5 look that is not a spring uses one ease and one duration:
`--ease-o5: cubic-bezier(0.22, 1, 0.36, 1)`, `--dur-o5: 520ms`. pages.css copies the same numbers
inline (`520ms cubic-bezier(0.22, 1, 0.36, 1)`). It appears in the handle, the index, the home path,
the opener, link hovers and the headers. Treat it as a seventh, CSS-only curve: a strong ease-out
with no overshoot.

---

## 12. Recipes

Conventions in every recipe: `full = level === 'full'`; at Lite/Off the `initial`/`exit` objects
collapse to `{ opacity: 0 }` and the transition is `transitionFor(level)` (§3.3). Stagger indices
`i` are zero-based. `y`, `x` are px. Blur values are the `filter: 'blur(Npx)'` strings.

### 12.1 `components/Choices.tsx` — answers arriving, one lifting, the rest leaving, the flight into the trail

Props: `items`, `picked` (label or `null`), `onPick`, `layoutPrefix?`, `delay = 0.08`, `label = 'Answers'`, `recommended?`.

Structure: `<ul class="st-choices"><AnimatePresence initial custom={0}>` → one `motion.li` per
shown item (`key = label`; `shown = picked ? only the picked one : all`), each holding a
`motion.button.st-choice`.

Per `motion.li` (index `i` = the item's index in the full list, not in `shown`):

| Prop | Full | Lite / Off |
|---|---|---|
| `layoutId` | `layoutPrefix` on the chosen one only (`chosen && layoutPrefix ? layoutPrefix : undefined`) | same |
| `layout` | `'position'` | `false` |
| `custom` | `i` | `i` |
| `initial` | `{ opacity: 0, y: 26, filter: 'blur(10px)' }` | `{ opacity: 0 }` |
| `animate`, not chosen | `{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { ...SPRING.bouncy, delay: delay + i * 0.055 } }` | `{ …same values, transition: transitionFor(level) }` |
| `animate`, chosen | `{ opacity: 1, y: 0, scale: 1.03, filter: 'blur(0px)', transition: SPRING.playful }` | not chosen branch (chosen && full only) |
| `exit` | `{ opacity: 0, x: -36, filter: 'blur(12px)', transition: { ...SPRING.smooth, delay: i * 0.04 } }` | `{ opacity: 0, transition: transitionFor(level) }` |

Per `motion.button`: `whileTap = full && picked === null ? { scale: 0.97 } : undefined`;
`disabled = picked !== null`; `aria-pressed = chosen`; `data-rec` while it is the orb's pick.

CSS on `.st-choice`: `transition: color var(--dur-fast, 0.15s), padding 520ms cubic-bezier(0.22, 1, 0.36, 1)`;
`[aria-pressed='true']` (and the orb's press) gets `padding-left: 12px` and its label turns italic
with a ` ✦` in the accent colour. The first item carries the top hairline.

Timing in words (Full): the list mounts → answer *i* arrives out of a 10 px blur, 26 px below its
place, on `bouncy`, starting at `delay + 55 ms × i` → on pick, the chosen one lifts to scale 1.03 on
`playful` while each other answer leaves to the left by 36 px into a 12 px blur on `smooth`, starting
at `40 ms × i` (original index) → the caller waits (§12.3 `settle`) → when `picked` resets and the
list unmounts, the chosen `li` shares its `layoutId` with the trail entry and flies there (§12.2).

Ambiguity: `custom={0}` on `AnimatePresence` and `custom={i}` on the items are passed, but the exit
objects are literals, not variant functions, so `custom` has no effect in the code as shipped.

Callers and their `delay`: Walk `done.length ? 0.3 : 0.12`; the Start screen `0.2`; the `Gate`
`0.3`; the Conversation `msgs.length ? 0.1 : 0.2`.

### 12.2 `components/Walk.tsx` — the trail, the current step, scroll-to-20 %, `useScrollDepth('center')`

Structure: `<div class="st-scroll" ref={scroller}><LayoutGroup>` → `<ol class="st-trail">` of
answered steps (each `<li data-depth="">` → `button.st-trail-row` → `motion.span.st-trail-ans`
with `layoutId = ans-${s.id}` and `transition = full ? SPRING.default : transitionFor(level)`) →
`motion.section.st-now` keyed by `step.id`.

- `useScrollDepth(scroller, true, 'center')`: the trail rows sink/blur per the page rule in §9 (`-2vh`, scale `1 − 0.06·ap`, opacity `1 − 0.62·ap`, blur `3px·ap`). `.st-trail` has `padding-top: 16vh`; `.st-now` has `min-height: 80%` and bottom padding `safe-bottom + 30vh` so the question can sit at the top fifth.
- Scroll on every new step (`useLayoutEffect` on `step.id`): `box.scrollTo({ top: max(0, section.offsetTop − box.clientHeight × 0.2), behavior: full ? 'smooth' : 'auto' })`. The question lands 20 % down the screen with the last answers peeking above it. The "own words" field is cleared at the same time.
- The current step section: `initial = full ? { opacity: 0, y: 40, filter: 'blur(12px)' } : { opacity: 0 }`; `animate = { opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.smooth, delay: done.length ? 0.18 : 0 } : transitionFor(level) }`.
- Inside it: `<Choices … layoutPrefix={ans-${step.id}} delay={done.length ? 0.3 : 0.12} />`.
- The "Or in your own words" form: `initial = full ? { opacity: 0, y: 16, filter: 'blur(8px)' } : { opacity: 0 }`; `animate = { opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.smooth, delay: 0.5 } : transitionFor(level) }`. Hidden while busy or on a closed step.
- The shortcuts row ("Pick for me", "Finish it for me"): `initial = { opacity: 0 }`; `animate = { opacity: 1, transition: full ? { ...SPRING.smooth, delay: 0.6 } : transitionFor(level) }`.
- The flight: the chosen answer's `li` (`layoutId = ans-${step.id}`) unmounts in the same render that adds the trail row whose `span` has the same `layoutId`; inside the `LayoutGroup`, Motion animates the shared element from the choice to the trail row with `SPRING.default` (the trail span's transition).

Timing in words (Full, a step after the first): the previous answers are already in the trail →
the new section rises 40 px out of a 12 px blur on `smooth` after 180 ms → its answers arrive at
300 ms + 55 ms × i on `bouncy` → the own-words form fades up 16 px from an 8 px blur at 500 ms →
the shortcuts fade in at 600 ms → meanwhile the scroller smooth-scrolls so the section sits 20 %
down. On the first step the section has no delay and the answers start at 120 ms.

### 12.3 `components/Bars.tsx` `Stage`, and the example app's `settle()` — screen crossfade with blur and y

```tsx
<AnimatePresence mode="wait" initial={false}>
  <motion.div
    key={screenKey}   /* the example app passes `${screen}|${run?.id ?? ''}` */
    className="st-view"
    initial={full ? { opacity: 0, y: 28, filter: 'blur(14px)' } : { opacity: 0 }}
    animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? SPRING.smooth : transitionFor(level) }}
    exit={full ? { opacity: 0, y: -18, filter: 'blur(14px)', transition: { ...SPRING.smooth, stiffness: 260 } } : { opacity: 0, transition: transitionFor(level) }}
  >
```

- `mode="wait"`: the old screen finishes leaving before the new one enters. `initial={false}`: the first screen does not animate in.
- Leaving: up 18 px into a 14 px blur on `smooth` with its stiffness raised to 260 (damping stays 25.13, mass 1 → a damping ratio of about 0.78 and a response of about 0.39 s instead of 0.5 s: quicker, nearly critical).
- Entering: rises 28 px out of a 14 px blur on plain `smooth`.
- `screen` is the view name, except that the walk view without a current step shows the summary screen; a changed `run.id` also crossfades.

`settle()` — the wait between a pick and the state change that moves on:

```ts
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const settle = () => wait(full ? 560 : level === 'lite' ? 200 : 0);
```

`pick(label)`: ignore if already picked → `orbHome()` (the orb comes back to tap the answer) →
`setPicked(label)` → `await settle()` (560 ms Full / 200 Lite / 0 Off: time for the other answers to
leave one by one) → `setPicked(null)` → commit the answer (`after`), which advances the step (or
switches to the summary screen when the flow is finished), or on the Start screen starts the chosen
flow. The `Gate` uses the same `settle()`.

Orb timing: on every step change `orbHome()` runs at once and again after `full ? 650 : 120` ms
(see the orb document for what `orbHome` does).

### 12.4 `components/Sheets.tsx` — `Rows` stagger, `Row` press

`Rows({ children, label, delay = 0.12 })` → `<ol class="st-contents">` of `motion.li` (`key = i`):

- `initial = full ? { opacity: 0, y: 22, filter: 'blur(10px)' } : { opacity: 0 }`
- `animate = { opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.bouncy, delay: delay + i * 0.055 } : transitionFor(level) }`

A clickable `Row` is a `motion.button.st-row` with `whileTap={{ scale: 0.98 }}` at every level (it
is not gated by `full`). `Contents` uses the default delay 0.12.

`Headline` keeps an `OrbSpot` (52 px) at its right for the orb to sit on; a choice keeps a 40 px one.

### 12.5 `components/Conversation.tsx` — conversation with ready answers

- `Choices` is mounted with `key={msgs.length}` so each turn's answers animate in afresh; `delay = msgs.length ? 0.1 : 0.2`; it is hidden while busy.
- `choose(label)`: `orbHome()` → `setPicked(label)` → wait `level === 'full' ? 520 : level === 'lite' ? 200 : 0` ms → `setPicked(null)` → send. Note the 520 ms here versus `settle()`'s 560 ms in the example app; both are as shipped.
- New messages: `end.scrollIntoView({ block: 'end', behavior: 'smooth' })`; `orbHome()` on every change of `msgs.length`.
- Messages themselves (`.st-said` / `.st-reply`) have no entrance animation.

### 12.6 `shell/o5/Path.tsx` — the home as a magazine

- `<main ref={scroller} class="o5-path" data-hidden={hidden}>`; `useScrollDepth(scroller, !hidden)` in `'center'` mode. Every `<section class="o5-spread" data-depth>` (the cover and six chapters) gets the §9 home rule: `−6vh × p`, `−260px × ap` in z, `rotateX(9deg × p)`, opacity `1 − 0.85·ap`, blur `3px·ap`; the chapter numeral behind it drifts `22vh × p`.
- Hidden behind an app: `opacity: 0; transform: scale(0.94); filter: blur(6px)`, transitioned over `--dur-o5` with `--ease-o5`; `inert` and `aria-hidden`.
- "Begin" cue arrow: `.o5-cue svg { animation: o5-bob 2.4s var(--ease-o5) infinite }`, `@keyframes o5-bob { 50% { transform: translateY(5px); } }`.
- Links (`.o5-go`): `transition: color var(--dur-fast), padding var(--dur-o5) var(--ease-o5)`; `:active { padding-left: 8px }`; the arrow `translateX(6px)` and the app art `scale(1.06) rotate(-3deg)` on hover/focus, over `--dur-o5`. Where `view()` timelines exist, links also run the `o5-depth` scroll animation (§9).
- Jumping to a chapter: `scrollIntoView({ behavior: 'smooth', block: 'start' })`; the scroller snaps `y proximity`.
- Reduced motion / Off: `.o5-cue svg` animation off.

### 12.7 `shell/o5/IndexMenu.tsx` — the full-screen index

- `.o5-index { animation: o5-fade var(--dur-o5) var(--ease-o5) both; perspective: 1200px; backdrop-filter: blur(28px) saturate(140%) }`, `@keyframes o5-fade { from { opacity: 0 } }`.
- Each `li` in `.o5-index-list` carries `style={{ '--i': n }}`: `0` for Home, `i + 1` for the entries, and runs `o5-rise var(--dur-o5) var(--ease-o5) both` with `animation-delay: calc(var(--i, 0) * 45ms)`; `@keyframes o5-rise { from { opacity: 0; transform: translate3d(0, 28px, -120px) rotateX(-18deg); } }`.
- Hover/focus: title `translateX(8px)`, art `scale(1.06) rotate(-3deg)`, over `--dur-o5`.
- `@media (prefers-reduced-motion: reduce)` and `:root[data-motion='off']`: `animation: none` on `.o5-cue svg, .o5-index-list li, .o5-index`.
- Focus is trapped inside while open and returned afterwards; Escape closes via the confirm sheet rules.

Timing in words: the index fades in over 520 ms while its rows rise 28 px from 120 px back and an
18° backward lean, one every 45 ms (Home at 0 ms, the 14th app at 630 ms).

### 12.8 `shell/o5/Handle.tsx` — the line at the bottom

A single `button.o5-handle` with `data-home` and `data-hidden`:

- `transition: opacity var(--dur-o5) var(--ease-o5), transform var(--dur-o5) var(--ease-o5)`.
- `.o5-handle-line { width: 128px; height: 5px; transition: width var(--dur-o5) var(--ease-o5), background var(--dur-fast) }`; hover/focus `width: 150px`.
- On the home (`data-home='true'`): `padding-bottom: 14px`; the line is `40px × 3px` in the accent colour and the word "Index" shows.
- In an app (`data-home='false'`): `opacity: 0.55`, `1` on hover; the folio ("04 · Terminal") replaces the word.
- `data-hidden='true'` (keyboard open or the index showing): `opacity: 0; transform: translate(-50%, 20px); pointer-events: none`.
- It takes `useSwipeHome` from the Dock (§12.9) so swiping it up goes home with the same physics; `touch-action: none`.

### 12.9 `shell/Dock.tsx` — the dock and `useSwipeHome`

The dock itself: layer 2 (`--depth-2`), parallax `3px × tx, 2px × ty` at Full, `touch-action: none`.
While the keyboard is open it slides away: `.dock { transition: transform var(--dur-med) var(--ease-out), opacity var(--dur-med) var(--ease-out) }`,
`.dock[data-hidden='true'] { transform: translate(-50%, 140%); opacity: 0; pointer-events: none }`
(global.css; 240 ms). Dock glyphs press to `scale(0.8)` with `snappy` and rebound with `playful` (§4.4).

`useSwipeHome(activeApp, splitShowing, goHome)` — enabled only at Full, inside an app, not in split view:

1. `pointerdown` (primary button): remember `x0, y0`, start listening to `pointermove`/`pointerup`/`pointercancel` on the window.
2. On move, until the window element is found: ignore while `up = y0 − clientY < 10` or the horizontal travel exceeds `up` (`|clientX − x0| > up`). Then find `.app-window[data-app="${activeApp}"]` (give up if missing).
3. Each move: `dt = max(1, Δt ms)`; smoothed speed `v = v × 0.4 + ((lastY − clientY) / dt) × 0.6` (px/ms, positive upward); `homeDrag(el, up)`.
4. On release: `speed = 0` if `pointercancel` or the last sample is older than **80 ms**, else `v`. If not cancelled and (`speed > 0.45` px/ms **or** `up > el.offsetHeight × 0.22`): `homeFling(el, up, max(0, speed))` then `goHome()` (the window flies into its icon, §8.1). Otherwise `homeCancel(el, up, −speed)` (spring back on `flick`).
5. The next click is swallowed (`onClickCapture`) so the release does not also tap a dock item.

### 12.10 `components/Toasts.tsx` — toasts

Plain `div.toast.glass` elements in `div.toasts[role=status][aria-live=polite]`, no JavaScript motion:

- Base: `.toasts` is centred at `top: calc(var(--safe-top) + 60px)` (or `calc(var(--island-top) + 8px)` under the Glass Island), width `min(420px, 100% − 24px)`, gap 8 px. `.toast { animation: sheet-up var(--dur-med) var(--ease-out) }` (240 ms, from `translateY(24px)`, opacity 0).
- Full: `.toast { animation: mo-toast-in var(--dur-playful) var(--spring-playful) both }` — drops from under the status pill: from `translateY(-14px) scale(0.92)`, opacity 0, over 0.79 s on `playful`. Layer 4 shadow.
- Off: `mo-xfade 0.15s ease-out both`.
- Lifetime: the toast store dismisses a toast after **3200 ms** (`TOAST_MS`); a click dismisses it at once. There is no exit animation.

### 12.11 `shell/AppHost.tsx` — app open / close / switch

Every open app is rendered exactly once as `section.app-window[data-app][data-placement]` and never
re-parented; only `placement` changes (`'full' | 'hidden' | 'split-left' | 'split-right'`). A
`useLayoutEffect` watches the previous placement:

| From → to | Call |
|---|---|
| any split involved | `cancelMorph(el)` (no animation; split panes just resize) |
| `hidden` → visible | `turning ? pageTurnIn(el, level) : morphIn(el, id, level)` |
| visible → `hidden` | `turning ? pageTurnOut(el, level) : morphOut(el, id, level, goingHome)` |

- `goingHome = activeApp === null` — close into the icon; otherwise ease away (another app is taking over).
- `turning = o5 && lastApp !== null && activeApp !== null && lastApp !== activeApp` — in the 0.5 look, going straight from one app to another turns the page (§8.2) instead of growing from an icon.
- A window mounts already in place (first open) and is treated as coming from `hidden`, so it morphs in.
- Interruptible: a newer morph cancels the live one from wherever it is (`live` map in morph.ts).
- Behind it, the classic home sinks: `.home[data-hidden='true'] { transform: scale(0.92); filter: brightness(0.7) }` on `--dur-default --spring-default` (§4.5); the 0.5 home blurs (§12.6).
- The 0.5 chapter opener (title card) runs on each open at Full/Lite (`opener` counter), ignores taps, and clears itself on `animationend`:
  `.o5-opener { animation: o5-opener-out 0.95s var(--ease-o5) both }` — `0%, 52% { opacity: 1 } 100% { opacity: 0; transform: translateY(-4%) }`;
  `.o5-opener-n { animation: o5-opener-drift 0.95s }` — `translateY(6%) → translateY(-2%)`;
  `.o5-opener-title`, `.o5-opener-line` (`+0.03s`): `o5-opener-title 0.95s` — `0% { opacity: 0; translateY(24px) } 28%, 52% { opacity: 1 } 100% { opacity: 0; translateY(-48px) }`;
  Lite: `o5-opener-quick 0.45s ease` (`0%, 40% { opacity: 1 } 100% { opacity: 0 }`), children not animated; Off: `display: none`.

### 12.12 `ui/components.tsx` `Sheet` — growing from the tap, drag to dismiss (uses `SPRING.bouncy`, `springValue`)

Not in the list above but it is the remaining `SPRING`/`springValue` user, and the reference for §1.3 "sheets grow out of the button":

- Origin, decided once at first render (Full only): the `origin` rect if given (centre and size), else `recentTap()` within 700 ms (a point), else none (`data-grown` absent → the CSS `mo-sheet-in` / `o5-sheet` entrance runs instead).
- Grow: `s = origin.w ? max(0.08, min(1, w / sheetW, h / sheetH)) : 0.12`; `animate(sheet, { transform: ['translate(dx px, dy px) scale(s)', 'translate(0px, 0px) scale(1)'], opacity: [w ? 1 : 0, 1, 1] }, { ...SPRING.bouncy, opacity: { duration: 0.16 } })`, then the inline transform is removed.
- Close: scrim `opacity 1 → 0` in 0.2 s; sheet `translateY(fromY) → translateY(fromY + travel)` and `opacity 1 → 0` over `0.22 s` (Full) / `0.15 s` (Lite), `easeIn`; `travel` is 48 px normally, 600 px when thrown. Off: no animation, close at once.
- Drag (handle/title, `.sheet-grip`): grabbing stops any spring-back and any running animation and continues from the current `translateY` (read from the computed matrix). Upward travel is rubber-banded to `raw × 0.06`; downward is 1:1. Velocity in px/ms from the last two samples; a sample older than 80 ms at release means no throw. Release: `dy > 110` px **or** `v > 0.7` px/ms → close (thrown, travel 600); otherwise `springValue({ from: dy, to: 0, velocity: v × 1000, spring: SPRING.flick })`.
- CSS entrance when not grown: Full `.sheet:not([data-grown]) { animation: mo-sheet-in var(--dur-bouncy) var(--spring-bouncy) backwards }` (from `translateY(60px) scale(0.98)`, opacity 0); 0.5 look `o5-sheet var(--dur-o5) var(--ease-o5) both` (from `perspective(1200px) translate3d(0, 60px, -140px) rotateX(10deg)`, opacity 0); base `sheet-up var(--dur-med) var(--ease-out)`; Off `mo-xfade 0.15s`. Scrim: `fade-in var(--dur-med) var(--ease-out)`, 0.3 s at Full.
- A `page` sheet runs `useScrollDepth(body, true, 'edges')` for its `[data-depth]` chapters (§9).

### 12.13 Classic home (CSS only, for completeness)

Icons `mo-icon-pop` on `playful` with `--i × 55ms + 100ms` (Full) / `mo-fade-up 0.25s` with `--i × 25ms` (Lite);
widgets `mo-fade-up 0.6s --ease-soft` at 0.45 / 0.52 / 0.59 s; widgets tilt with `useTilt(5)`.

---

## 13. Rules for new animations

```
1. Every motion must explain a change or confirm a touch. If it does neither, cut it.
   Nothing idles, floats, drifts or shimmers once content has arrived.

2. Only transform, opacity and (sparingly) filter animate. Never layout. The one shipped
   exception (the 0.5 app header's max-height) is bounded to a single element.

3. Pick the spring by what the thing is doing:
     press / toggle / small control / shrinking back into its icon ... snappy
     a large area fading, something leaving, a screen crossfade ........ smooth
     a window opening, a page turning, a shared-element flight ......... default
     something arriving (row, answer, card, message, sheet) ............ bouncy
     something popping in or being chosen (icon, status pill, the pick)  playful
     anything released mid-drag ........................................ flick (through springValue, with the finger's velocity × 1000)

4. Arrivals come from where they belong: from below (y 22–40, blur 8–14) for content,
   from the icon/tile/tap for windows, sheets and viewers, from above (y −14) for toasts.
   Departures go the other way (y −18 on a screen leaving, x −36 for a rejected answer).

5. Stagger lists at 55 ms (bouncy) — 45 ms for the index and gallery,
   40 ms for things leaving. First item after a delay (0.08–0.3 s) so the heading reads first.

6. Everything is interruptible. A new state must take over from wherever the old animation is:
   use layoutId / AnimatePresence for React, the `live` map pattern (cancel then replace) for
   JavaScript, and read the current transform back before grabbing (the sheet). Never await an
   animation before accepting input.

7. Respect the level, always:
     full → the spring.
     lite → transitionFor(level): a 180 ms tween, and the initial/exit objects drop y/x/scale/blur.
     off  → a 150 ms ease-out cross-fade and nothing else moves; CSS zeroes every duration
            and the designed mo-xfade keeps appearances visible. Depth (shadows, highlights)
            stays. Parallax, tilt, scroll depth and the GPU background are off.
   The 'off' contract: a person on Off must still see *what* changed and *where*; they must
   never see it move.

8. Write per-level props the way the components do:
     initial={full ? { opacity: 0, y: 26, filter: 'blur(10px)' } : { opacity: 0 }}
     animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: full ? { ...SPRING.bouncy, delay } : transitionFor(level) }}
   and gate whileTap / layout / tilt / parallax on `full`.

9. Waits that exist to let an animation finish (settle: 560 ms full, 200 lite, 0 off) scale
   with the level. Never a fixed wait.

10. Tilt is read once per frame into --tx/--ty; nothing else listens to the sensor. Scroll depth
    is written once per frame into --p/--ap; CSS does the rest. New effects consume these
    variables, they do not add listeners.

11. Keep the five layers. New things go on a layer and take its shadow (--depth-N); lifting
    is one layer up at scale 1.02 and comes down on bouncy; pressing goes down (scale 0.92
    for buttons, 0.8 for icons) on snappy and returns on playful.

12. Sound and haptics are off by default and only ever confirm an action the person took
    (send, done, error, a switch turning on) or the orb touching something.
```

---

## 14. Cross-references

- **The orb's own physics** (`shell/orb/physics.ts`, `OrbCursor`): a separate set of springs defined by `response` and `dampingRatio` with `damping = 2 · ratio · ω` (not the `4π·d/r` form used here), momentum projection, rubber-banding and squash-and-stretch. The orb calls `cue('tap' | 'pop' | 'done' | 'error')` and `tick()` from this package, and the example app's `orbHome()` / `orbThink()` timings in §12.3 and §12.5 belong to it. See the orb document.
- **Colours, glass and typography** (`--lit`, `--accent`, `--surface-*`, `--dur-fast`, `--dur-med`, `--ease-out`, the `o5` skin): the styles document. `motion.css` needs `--lit` for its shadows.
- **The source app's motion notes** are the source of §1; §2–§12 are read from the code and CSS, which win wherever the two differ (noted inline: press scale, parallax pixels).
