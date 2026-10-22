# 09 · The orb

The orb is a small round companion that floats over every screen of an app. It is one living
object: it sits beside whatever the page says matters, becomes the text caret while you type, can
be dragged, thrown, parked at an edge or tucked away, pinched to change the text size, pressed to
open a small panel, and tapped to talk. It glows while the page works for you, and it keeps what a
page wants to tell you until you tap it.

This document describes the orb as it is in `src/orb/`, which is a port of the source app's
orb with every physics, attention, caret, gesture, caption, note, panel and energy
feature intact, and every service of the source app removed. The only intelligence it has is whatever the app
plugs into one adapter, `OrbBrain` (see `docs/10-ai-adapter.md`). With the adapter set to `null`,
everything except answering a question still works.

Every number in this document is copied from the source. Where the port had to differ from the source app,
the difference is called out in a "Port note" or in the list at the end.

---

## 1. Design intent

- **A quiet companion.** It never talks on its own inside a page built on this package. A page leaves it a
  *note*; the person sees it only when they tap the orb. Captions (one-line speech bubbles) are
  optional, and a page triggers them deliberately (`orb:say`).
- **It sits on what the screen wants.** Each page marks the thing it wants the person to look at or
  do next (`data-orb-focus`, `data-orb-spot`, a primary button). The orb goes there and waits beside
  it, never covering it or another control.
- **It is a real object.** Its movement is all springs with momentum, rubber-banding at the edges,
  and squash-and-stretch along its speed, so it reads as a slightly liquid ball rather than a cursor.
- **It is the caret.** When you type in a box, the orb glides over, narrows into a sliver the height
  of the line, and rides each letter. The box's own caret is hidden.
- **It is also a touch cursor.** Drag it over a button and the button lights up; set it down and the
  button is pressed. Set it down in a text box and the caret lands between the letters you chose.
- **No AI inside.** Explaining the screen and answering a typed or spoken question go through the
  adapter. Nothing else does.

---

## 2. Files

| Package file | Source (the source app) | What it is |
|---|---|---|
| `src/orb/OrbCursor.tsx` | `src/shell/orb/OrbCursor.tsx` | The component: frame loop, modes, gestures, caret, captions, notes, panel. The source app's services replaced by the `brain` prop. |
| `src/orb/physics.ts` | `src/shell/orb/physics.ts` | Springs, momentum, rubber band, squash, landing, shake, deep press. Verbatim copy. |
| `src/orb/attention.ts` | `src/shell/orb/attention.ts` | Where to go: `findFocus`, `besideRect`, `coversControl`, `restSpot`. Verbatim copy. |
| `src/orb/caret.ts` | `src/shell/orb/caret.ts` | Measuring the text caret: `caretField`, `caretOf`, `caretsAt`, `caretAt`, `offsetAt`. Verbatim copy. |
| `src/orb/write.ts` | `src/shell/orb/write.ts` | Text insertion and writing-help helpers (`insertText`, `writable`, …). Its two imports from the source app's agent module (`privateField`, `labelOf`) are inlined. |
| `src/orb/screen.ts` | `src/shell/orb/look.ts`, part of `agent.ts` | DOM-only: `screenText`, `isExplain`, `EXPLAIN_PROMPT`, `snapshot`. |
| `src/orb/OrbFace.tsx` | `src/apps/ai/AiOrb.tsx` | The drawn face (WebGL shader, CSS fallback). Takes `level` as a prop instead of the source app's motion context. |
| `src/orb/face.css` | part of `src/apps/ai/ai.css` | The CSS fallback sphere (`.ai-orb`, `.ai-orb-eyes`). |
| `src/orb/orb.css` | `src/styles/orb.css` | The orb's stylesheet. Verbatim copy, selectors unchanged. |
| `src/orb/events.tsx` | the source app's `orbGuide.ts` and `OrbSpot` (also in this package as `src/flow/orbGuide.ts` and `src/components/Sheets.tsx`) | Typed helpers for the events a page sends, and the `OrbSpot` component. |
| `src/orb/index.ts` | — | Re-exports. |
| `src/motion/feedback.ts` | `src/motion/feedback.ts` | `cue()` and `tick()` (sound and vibration), configured with `configureFeedback({ sound, haptics })`. Written by the motion part of this package; the orb imports it. |

---

## 3. Mounting it

```tsx
import { OrbCursor, type OrbBrain } from 'orbit-design/orb';
import 'orbit-design/orb/orb.css';
import 'orbit-design/orb/face.css';

const brain: OrbBrain | null = null; // or an adapter, see docs/10-ai-adapter.md

<OrbCursor brain={brain} settings={{ follow: true, sound: true, haptics: true, level: 'full' }} />
```

Mount it once, last in the tree (it is `position: fixed` and covers the viewport with
`pointer-events: none`, so it does not block the page; only the ball and the panel take pointer
events).

### Props

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `brain` | `OrbBrain \| null` | required | The adapter. `null` = no intelligence. |
| `settings.follow` | `boolean` | `true` | Follow what matters on the page. `false` = it stays where it is put (the source app's `orbFollow` setting). |
| `settings.sound` | `boolean` | `false` | Play the synthesised cues (`cue('tap' \| 'pop' \| 'done' \| 'error')`). |
| `settings.haptics` | `boolean` | `false` | Vibrate on cues, and the lightest `tick()` when passing over a control. |
| `settings.level` | `'full' \| 'lite' \| 'off'` | `'full'` | Motion level. `full`: springs, squash, GPU face. `lite`: springs, no squash, CSS face with eyes. `off`: it jumps instead of moving, no face. |
| `settings.textScale` | `number` | `1` | The page's current text scale (the source app: Settings → Text size, 0.9…1.3). A pinch steps from here. |
| `onTextScale` | `(scale: number) => void` | — | Called when a pinch lands on a new scale. **Port note:** when absent, the orb sets `--text-scale` on `<html>` itself. |
| `hidden` | `boolean` | `false` | Hide it. **Port note:** the source app hid it while its app index overlay was open (`overlay === 'index'`); this prop replaces that. A dialog with `aria-modal="true"` hides it on its own. |
| `suggestions` | `string[]` | `['Explain this screen', 'What can I do here?']` | Chips in an empty panel. The source app's list had four more entries, all commands for its own apps. |
| `explainPrompt` | `string` | `EXPLAIN_PROMPT` (the source app's, unchanged) | System prompt for "explain this screen". `data-orb-context` is appended. |
| `askPrompt` | `string` | `ASK_PROMPT` (port addition, see §15) | System prompt for any other question. `data-orb-context` is appended. |

`settings.sound` and `settings.haptics` are passed to `configureFeedback` whenever they change.

---

## 4. Geometry and drawing

| Constant | Value | Where |
|---|---|---|
| `SIZE` | `56` px | the ball's box (`.orb-cursor` is 56×56) |
| `R` | `SIZE / 2 = 28` | its radius; positions are centre points |
| `CARET_W` | `2.5` px | its width as the caret |
| ring | `inset: -5px`, border `1.5px` | `.orb-cursor-ring`, outside the ball |
| caption | 260 px wide, 130 px left of the orb's centre, 82 px above it | `.orb-caption` (see §16) |
| panel | bottom sheet, `max-width: 460px` | `.orb-panel` |
| z-index | `70` | `.orb-layer` |

### The layer

```html
<div class="orb-layer" data-caret? data-hidden? data-listening? data-running? data-face="…" data-slim? data-flying? data-typing?
     style="--orb-x: …px; --orb-y: …px">
  <button class="orb-cursor" aria-label="Orb: tap to talk, hold to ask it to do something" aria-expanded="false" style="transform: …; --depth: 0">
    <canvas class="ai-orb ai-orb-gpu orb-cursor-face" />   <!-- or <div class="ai-orb orb-cursor-face"> -->
    <span class="orb-cursor-ring" aria-hidden />
  </button>
  <p class="orb-caption" role="status" aria-live="polite">…</p>        <!-- while there is a caption and the panel is closed -->
  <div class="orb-panel" role="dialog" aria-label="Ask the orb">…</div> <!-- while open -->
</div>
```

Attributes on the layer:

| Attribute | Set when |
|---|---|
| `data-caret` | mode is `caret` (React state `caretOn`) |
| `data-hidden` | an `aria-modal="true"` dialog is open that is not the orb's own and does not contain a `[data-orb-spot="stage"]`, or the `hidden` prop is true |
| `data-listening` | the adapter's `listen()` is running |
| `data-running` | a question is being answered |
| `data-face` | the current expression (see §5) |
| `data-slim` | `morph.value > 0.2` (it is more caret than ball; written from the frame loop, only when it changes) |
| `data-flying` | it is gliding over to become the caret (`flight` is set) |
| `data-typing` | set on every `input`/`keydown` (capture), removed 650 ms after the last one |

### How it is drawn

Every frame the loop writes, on the button:

```
transform: translate3d(x − 28px, y − 28px, 0)
           scale(cw, ch)                       ← caret morph × grow × pinch
           rotate(angle) scale(s·press, press/s) rotate(−angle)   ← squash along its velocity, press-in
--depth: max(0, depth)
```

and on the layer `--orb-x: x px`, `--orb-y: y px`, which the caption uses to place itself. A
`useLayoutEffect` writes the first transform and the two variables before the first paint, so it
never flashes in the corner.

The CSS variables `--tx` / `--ty` on `<html>` (the page's tilt, if the app sets them, −1…1) shift
the face by `4px` each (`.orb-cursor-face { translate: calc(var(--tx) * 4px) … }`) and move the
shader's light.

---

## 5. The face (`OrbFace`)

`OrbFace` is the source app's `AiOrb` with the motion level as a prop. Props:

| Prop | Type | Effect |
|---|---|---|
| `typing` | `boolean` | energy target `1` when true (the liquid stirs fast) |
| `energy` | `number?` | when given, overrides: clamped to `0.15…1`. The orb passes `energy ?? stageEnergy ?? (running ? 0.8 : undefined)` (mic level, then `orb:energy`, then 0.8 while thinking) |
| `resolution` | `number` | draws the canvas sharper than its box: `canvas.width = clientWidth × min(2, devicePixelRatio) × resolution`. The orb sets it from `grow`: `g > 1.2 ? min(3.5, ceil(g·2)/2) : 1` |
| `face` | `OrbFaceState?` | `{ on, gaze: [x, y], mood (−1…1), talk, sleepy }` |
| `level` | `'full' \| 'lite' \| 'off'` | `full` + WebGL → the shader. Otherwise the CSS sphere (`face.css`); `lite` adds two eyes that follow `gaze` (`translate(gaze.x·18%, −gaze.y·14%)`) and blink; `off` has no eyes |

Idle energy is `0.25`. The shader eases energy at `dt·6`, face-on at `dt·5`, gaze and mood at
`dt·7`, talk at `dt·10`, sleepy at `dt·3`. It blinks `1500–5000 ms` after start and then every
`2200–6200 ms`; a blink lasts `160 ms` (`420 ms` when sleepy > 0.5). Idle (energy < 0.4 and no
face) it draws at most every 32 ms (~30 fps); it does not draw while off screen or the tab is
hidden. It sets `data-face="on"|"off"` and `data-live="true"` on the canvas, and `data-fallback="true"`
if WebGL fails (CSS then shows the sphere through `.ai-orb`).

### Expressions

Computed in this order (first match wins), and written as `data-face` on the layer:

| `data-face` | When |
|---|---|
| `done` | `moodFlash > 0` (a happy flash, 1800 ms) |
| `error` | `moodFlash < 0` (a sad flash, 1800 ms) — after a failed answer |
| `listening` | the mic is on |
| `thinking` | a question is being answered |
| `speaking` | `talking` (from `say()`, for `min(4000, 600 + len·40)` ms) |
| `sleepy` | the panel is open and the adapter is missing or `ready()` returned false |
| `idle` | the panel is open |
| `off` | otherwise: no face is drawn |

The face state the orb hands `OrbFace`:

```
on     = expression !== 'off' && level !== 'off'
gaze   = running && !talking ? [0.35, 0.45] : [0, 0]      // thinking looks up and aside
mood   = moodFlash || (talking ? 0.35 : (running || listening) ? 0 : 0.15)
talk   = talking
sleepy = expression === 'sleepy'
```

Port note: in the source app, while the agent flew to a control, `gaze` pointed at it for 1400 ms. The agent
is not ported, so that branch is gone.

---

## 6. Physics (`physics.ts`)

Units are CSS pixels and seconds. Everything is plain math.

### Springs

`spring(response, dampingRatio)` → `{ stiffness: w², damping: 2·ζ·w }` with `w = 2π / response`,
unit mass. `response` is roughly how long a move takes; `dampingRatio` 1 = no overshoot, lower =
more bounce.

| Name | response | damping | For |
|---|---|---|---|
| `SPRINGS.track` | 0.09 | 0.92 | under the finger while dragging |
| `SPRINGS.follow` | 0.62 | 0.86 | drifting to what matters (`moveTo` default) |
| `SPRINGS.land` | 0.42 | 0.68 | after a throw or drop, into its spot; one small bounce. Also `rest()` when not following, and `activate()` |
| `SPRINGS.press` | 0.16 | 0.58 | the `depth` value (sinking under a press) |
| `SPRINGS.jelly` | 0.32 | 0.38 | squash/stretch recovery; loose so the wobble shows |
| `SPRINGS.summon` | 0.5 | 0.55 | a shake brings it to the middle with energy |
| `CARET` | 0.075 | 1 | riding the caret letter by letter; never overshoots |
| `MORPH` | 0.34 | 0.9 | the ball ⇄ caret shape value |
| `GLIDE` | 0.48 | 0.96 | gliding over to become the caret, back home afterwards, onto and off a stage |
| `GROW` | 0.55 | 0.72 | growing into a spot or stage, and back |
| `PINCH_TRACK` | 0.09 | 1 | pinch size follows the fingers without lag |
| `BOUNCE` | 0.6 | 0.34 | let go of a pinch: bounces back to size, overshooting a few times |
| `AIM` | 0.36 | 0.84 | **source app only**: flying to a control the agent is about to press. Not used in the port. |

### `SpringValue`

One value with `value`, `velocity`, `target`, `spring`.

- `step(dt)`: semi-implicit Euler in substeps of `1/240` s; `dt` capped at `0.064` s.
  `a = −stiffness·(value − target) − damping·velocity; velocity += a·h; value += velocity·h`.
- `resting(eps = 0.05)`: `|value − target| < eps && |velocity| < eps·20`.
- `set(v)`: jump, no animation (velocity 0).

### `VelocityTracker(windowMs = 100)`

Keeps the finger samples of the last 100 ms (always at least 2) and returns the least-squares slope
in px/s, which ignores single-frame jitter and the slow-down just before lift-off. `reset()` clears
it on each pointer down.

### Momentum and landing

- `DECELERATION = 0.998` (UIScrollView's normal rate, per ms).
- `project(v, rate)` = `(v/1000 · rate) / (1 − rate)`: where something at `v` px/s would coast to.
- `landing(pos, vel, bounds, size)`:
  - `px = pos.x + project(vel.x)`, `py = pos.y + project(vel.y)`, `r = size/2`
  - `minX = bounds.x + r`, `maxX = bounds.x + bounds.w − r`, same for y
  - **tuck** = `vel.y > 2400 && py > maxY + size` (a hard throw off the bottom)
  - `y = clamp(py, minY, maxY)`; `x = px < bounds.x + bounds.w/2 ? minX : maxX` (snap to the nearer side, keeping the height thrown to)

### Rubber band

- `rubberBand(overshoot, dimension, c = 0.55)` = `(1 − 1/((overshoot·c)/dimension + 1)) · dimension` (the iOS constant 0.55; never more than `dimension`).
- `rubberClamp(v, min, max, dimension)`: inside → `v`; below → `min − rubberBand(min − v)`; above → `max + rubberBand(v − max)`.
- While dragging: `x.target = rubberClamp(tx, v.x + R, v.x + v.w − R, v.w · 0.25)` and the same for y with `v.h · 0.25`.

### Squash and stretch

`stretchFor(vx, vy, max = 0.22)` → `stretch = 1 + min(0.22, speed / 5200)`, `angle = atan2(vy, vx)`.
Applied only at `level === 'full'` and not in caret mode. The frame loop clamps `s = max(0.6, jelly.value)`.

### Pinch size

```
stretchOf(r):  s = r^0.75;  s > 2 ? 2 + (s − 2)·0.2 : s < 0.5 ? 0.5 − (0.5 − s)·0.2 : s
```
(`r` = finger distance now / at the start; rubber-banded beyond 2× and under 0.5×.)

### `ShakeDetector(threshold = 13, needed = 3, windowMs = 800, cooldownMs = 1200)`

Fed `(t, ax, ay, az)` in m/s² without gravity. Ignores `|a| < 13`. Takes the sign of the dominant
axis (x if `|ax| ≥ |ay|`, else y); a peak is recorded only when the sign reverses. Three such
reversing peaks within 800 ms = one shake, then 1200 ms of cooldown.

### `DEEP_PRESS`

`{ force: 0.55, holdMs: 420, slopPx: 8 }`: a press is deep when pointer pressure reaches 0.55, or
when it is held 420 ms without moving more than 8 px.

### The frame loop

Runs on `requestAnimationFrame` only while something moves (`kick()` starts it; it stops itself).

```
dt = last ? min(0.05, (t − last)/1000) : 1/60
x.step, y.step, depth.step
if flight:                                 // on the way to become the caret
  d = |target − value|; p = 1 − min(1, d / flight.d0)
  k = clamp((p − 0.45) / 0.55, 0, 1); morph.target = k²·(3 − 2k)     // round for 45 % of the trip, then narrows
  if d < 0.75: flight = null; morph.target = 1; x.spring = y.spring = CARET
morph.step, grow.step, pinch.step
v = mode === 'drag' ? tracker.velocity() : (x.velocity, y.velocity)
{stretch, angle} = full && mode !== 'caret' ? stretchFor(v) : {1, 0}
jelly.target = stretch; jelly.step
s = max(0.6, jelly.value);  press = 1 − max(0, depth.value)·0.16
m = clamp(morph.value, 0, 1.15);  g = max(0.2, grow.value · pinch.value)
cw = (1 + (2.5/56 − 1)·m)·g;  ch = (1 + (caretH/56 − 1)·m)·g
transform = translate3d(x−28, y−28, 0) scale(cw, ch) rotate(angle) scale(s·press, press/s) rotate(−angle)
--depth = max(0, depth.value)
--orb-x, --orb-y on the layer;  data-slim = morph.value > 0.2;  data-flying = !!flight
still = !flight && x.resting() && y.resting() && depth.resting(0.002) && jelly.resting(0.002)
        && morph.resting(0.002) && grow.resting(0.002) && pinch.resting(0.002)
next frame if mode === 'drag' || !still
```

`moveTo(px, py, spring = SPRINGS.follow)` sets both springs and targets and kicks; at
`level === 'off'` it uses `set()` (jumps). `jelly.velocity += n` is the "nod" used throughout
(values in the gesture tables).

---

## 7. Modes

`type Mode = 'follow' | 'parked' | 'tucked' | 'drag' | 'acting' | 'caret'`

| Mode | Meaning |
|---|---|
| `follow` | goes wherever `findFocus` says, re-checked every 700 ms and on page events |
| `parked` | stays where it was put (`spot`), or at `restSpot` when `spot` is null |
| `tucked` | sits half off the right edge (`x = right − R·0.5`, `y = bottom − 150`) |
| `drag` | under the finger |
| `acting` | moving on its own (a shake's summon); refocus leaves it alone |
| `caret` | it is the text caret; `caretMode` holds the mode to return to |

### Every transition

| From | Trigger | To | Exact behaviour |
|---|---|---|---|
| (start) | mount | `follow` if `settings.follow !== false`, else `parked` | starts at `restSpot(viewport, 56)` |
| any | `settings.follow` changes | `follow` / `parked` | `refocus()` |
| `follow`/`parked`/`tucked` | pointer moves > 8 px before a deep press | `drag` | hold timer cleared; `sizeTo(1)`; `seat = null`; `onStage = false`; `depth.target = 0.12`; springs → `track` |
| `drag` | pointer up, finger **stopped** (> 150 ms since last move) over a control it had hovered > 160 ms | `follow`/`parked` (per setting) | `activate(el)` — see §11 |
| `drag` | pointer up, speed `< 350` px/s | `parked` | target clamped inside `[v.x + R, v.x + v.w − R]` × `[v.y + R, v.y + v.h − R]`; springs → `land`; velocity = finger velocity (0 if stopped); `spot = target`; `cue('tap')` |
| `drag` | pointer up, speed `≥ 350`, `landing().tuck` false | `parked` | target = `landing()` result (nearest side, height kept); `spot = target`; `cue('tap')` |
| `drag` | pointer up, `landing().tuck` true (`vel.y > 2400` and projected past the bottom by a full size) | `tucked` | target `(v.x + v.w − 14, v.y + v.h − 150)`; says "Tucked away. Tap the edge or shake to bring me back."; `spot = target`; `cue('tap')` |
| `drag` (after a pinch) | pointer up | `parked` | target clamped inside the screen; `spot = target`; not a tap, not a throw |
| `drag` | pointer cancel | `parked` | pinch cancelled (`pinch` → `BOUNCE`, target 1); hover cleared; `depth.target = 0` |
| `tucked` | tap | `follow` / `parked` | `spot = null`; `jelly.velocity += 3`; `rest()` |
| `parked`/`tucked` | `orb:home` | `follow` | `spot = null`; `lastFocus = null`; `refocus()` |
| `caret` (returning to `parked`/`tucked`) | `orb:home` | stays `caret`; `caretMode = 'follow'` | deferred: it goes home when it stops being the caret |
| `follow`/`drag`/`acting`/`caret` | `orb:home` | no change | — |
| `follow`/`parked`/`tucked` (not `drag`/`acting`) | a field gets focus and `caretOf` returns a rect | `caret` | `caretMode = previous`; `data-orb-caret` on `<html>`; glide (see §10) |
| `caret` | focus leaves / no rect | `caretMode ?? (follow setting ? 'follow' : 'parked')` | rounds out in place (`morph.target = 0`, targets = current values), then `rest()` once `morph ≤ 0.3` (polled every 40 ms), springs → `GLIDE` |
| any (not `drag`/`caret`/`acting`) | a `[data-orb-spot="stage"]` is visible | mode unchanged, `onStage = true` | `jelly.velocity += 1.2` on arrival; `seat = stage`; `sizeTo(size/56)`; `moveTo(centre, GLIDE)` |
| `onStage` | the stage goes away | `onStage = false` | `sizeTo(1)`; if not `follow`, `moveTo(spot ?? restSpot, GLIDE)` |
| any | shake (or `summon()`) | `acting` for 900 ms, then `follow`/`parked` | aborts a running answer (says "Stopped."); `cue('pop')`; `x.velocity += ±1400` (random sign); `y.velocity −= 900`; `jelly.velocity += 5`; `moveTo(v.x + v.w/2, v.y + v.h·0.42, SPRINGS.summon)`; after 900 ms `spot = null`, `rest()` |
| `drag` | `activate()` on a dropped control | `follow`/`parked` | springs → `land`; `depth.target = 0.9` then `0` after 140 ms; `jelly.velocity += 2`; `cue('tap')`; after a press (not a text box) `rest()` after 320 ms if mode is `follow` or `parked` |
| after an answer finishes | `run()` finally | `before` (or `follow`/`parked` if `before` was `acting`/`drag`) | after 250 ms: `rest()` then `syncCaret()` |

`rest()`: in `follow` → `refocus()`; otherwise `moveTo(spot ?? restSpot, SPRINGS.land)`.

---

## 8. Attention (`attention.ts`)

`refocus()` runs every **700 ms** (`setInterval`) and, debounced by **120 ms**, on `resize`,
`visualViewport` `resize`/`scroll`, any `scroll` (capture), `focusin`, `focusout` and `click`
(capture). It first computes `hidden` (an `aria-modal="true"` dialog that is not inside the orb's
layer and has no `[data-orb-spot="stage"]`, or the `hidden` prop). It returns early while
`leaving` (rounding out after caret mode).

Port note: in the source app, `findFocus` was followed by a `MutationObserver` only for the caret (xterm and
CodeMirror cursors, §10); attention itself relies on the interval and the events above.

### `findFocus(view, size, self)` — priorities

Returns `{ x, y, el, kind, size? }`. First hit wins:

| # | kind | What | Placement |
|---|---|---|---|
| 0 | `stage` | the first visible `[data-orb-spot="stage"]` | centred on it, grown to `data-orb-size` (px) or its width |
| 1 | `marked` | `[data-orb-focus]`, **newest first** (document order reversed) | beside it |
| 2 | `typing` | `document.activeElement` if it is a textarea, an input that is not button/checkbox/radio/range/submit, or contenteditable, and not inside the orb | beside it |
| 3 | `spot` | the first visible `[data-orb-spot]:not([data-orb-spot="stage"])` | centred, grown to `data-orb-size` or its width |
| 4 | `action` | `PRIMARY = '[data-orb-focus], .btn.primary, button[type="submit"], .ai-make, .ai-send'`, not disabled, not in the orb, sorted by `top` **descending** (the lowest on screen first: usually "the next step") | beside it |
| 5 | `latest` | `LATEST = '.ai-msg-assistant, .ag-msg, .sr-shot, .o5-step'`, newest first, only the last 4 | beside it |
| 6 | `rest` | `restSpot(view, size)` | `x = view.x + view.w − size/2 − 14`, `y = view.y + view.h − size/2 − 96` (low right, above a dock/home handle and the keyboard) |

`.ai-make`, `.ai-send`, `.ai-msg-assistant`, `.ag-msg`, `.sr-shot`, `.o5-step` are the source app's own
class names, kept as copied. In a new app, use `data-orb-focus` (priority 1) or `.btn.primary` /
`button[type="submit"]` (priority 4), or reuse those class names.

### `visible(el, view)`

Null unless: width and height ≥ 4; `bottom ≥ view.y + 8`, `top ≤ view.y + view.h − 8`, `right ≥ 0`,
`left ≤ view.w`; computed `visibility` not hidden, `display` not none, `opacity` not 0; not inside
`[inert]`, `[aria-hidden="true"]` or `[data-hidden="true"]`.

A spot or stage must also be really on top at its centre: `elementsFromPoint(cx, cy)` (ignoring the
orb) must return the spot itself or something inside it.

### `besideRect(r, view, size, avoid)`

`gap = 10`, `half = size/2`. Candidates in order:

1. right, top-aligned: `(r.right + 10 + half, r.top + half)`
2. above, right end: `(r.right − half, r.top − 10 − half)`
3. left: `(r.left − 10 − half, r.top + half)`
4. below, right end: `(r.right − half, r.bottom + 10 + half)`

A candidate must be inside the view with a 4 px margin on every side, and `avoid(x, y)` must be
false. Null if none fits (then the next priority is tried).

### `coversControl(x, y, size, self)` — the avoid list

Samples the centre and four points `q = size·0.38` away (left, right, up, down). At each,
`elementsFromPoint` (ignoring the orb): true if it is inside
`button, a, input, textarea, select, [role="button"], [contenteditable="true"]`, or inside
`p, h1, h2, h3, h4, li, blockquote` with non-empty text (it must not sit over words you are reading).

### In `refocus()`

- Not `follow` (and not on a stage): only resets `grow` to 1 if it is free and grown; otherwise returns.
- `follow`: if `f.el` changed, `lastFocus = f.el` and, at `level === 'full'` and `f.el` not null, a nod `jelly.velocity += 1.6`.
  `seat = f.kind === 'spot' ? f.el : null`; `sizeTo(f.kind === 'spot' && f.size ? f.size/56 : 1)`; `moveTo(f.x, f.y)` with `SPRINGS.follow`.
- A **stage** wins whatever the mode as long as it is free (not `drag`/`caret`/`acting`). On a stage that is a `<button>`, a tap on the orb (and Enter/Space) clicks that button.

---

## 9. Marking a page

| Attribute | On | Value | Effect |
|---|---|---|---|
| `data-orb-focus` | any element | none | priority 1: the orb waits beside it (newest in the DOM first). Also in `PRIMARY`. |
| `data-orb-spot` | an empty element (use `OrbSpot`) | `""` | priority 3: the orb sits **centred** on it, grown to its size |
| `data-orb-spot` | a dialog's orb button | `"stage"` | priority 0: the orb becomes that element (centred, grown) whatever its mode; a tap on the orb clicks it if it is a `<button>`; an `aria-modal` dialog containing it does not hide the orb; `orb:energy` drives its glow |
| `data-orb-size` | with `data-orb-spot` | px | how big the orb grows there (`grow = size/56`); defaults to the element's width |
| `data-orb-context` | `<html>` | text | appended after the system prompt of every adapter call (what the page is, where the person is) |
| `data-own-caret` | a field or ancestor | none | the orb never becomes this field's caret |
| `data-no-write-help` | a field or ancestor | none | `writable()` returns null (no ghost text / rewrite) |
| `data-private` | a field or ancestor | none | its text is never read by `screenText` or `snapshot`, and `writable()` returns null |
| `data-hidden` | any | `"true"` | treated as invisible by attention |
| `.btn.primary`, `button[type="submit"]` | buttons | — | priority 4 |

Set by the orb (read-only for the page):

| Attribute | On | When |
|---|---|---|
| `data-orb-caret` | `<html>` | the orb is the caret (CSS hides the field's own caret) |
| `data-orb-hover` | the control under a dragged orb | while over it |
| `data-orb-pressed` | the control it was dropped on | 260 ms |
| `--text-scale` | `<html>` (port only, when no `onTextScale`) | after a pinch |

### Examples

A headline the orb should wait beside (it goes to the top right of the headline block):

```tsx
<div className="st-qwrap">
  <h2 className="st-q">Where <em>to?</em></h2>
  <OrbSpot />   {/* <span class="st-orb-spot" data-orb-spot="" data-orb-size="52" role="presentation"> */}
</div>
```
```css
.st-qwrap { position: relative; }
.st-orb-spot { position: absolute; top: 0; right: 4px; width: 52px; height: 52px; }
```

A recommended answer (the orb rests on the answer it would pick until one is chosen; this is
`src/components/Choices.tsx`):

```tsx
<button type="button" className="st-choice" data-rec={rec || undefined} aria-pressed={chosen} disabled={picked !== null}>
  {rec && <span className="st-rec">The orb’s pick</span>}
  <span className="st-lb">{c.label}</span>
  {(chosen || rec) && <OrbSpot size={40} className="st-choice-spot" />}
</button>
```
```css
.st-choice-spot { position: absolute; top: 50%; right: 6px; width: 40px; height: 40px; margin-top: -20px; }
.st-choice[data-orb-hover] { color: var(--text) !important; }
.st-choice[data-orb-pressed] { color: var(--text) !important; padding-left: 12px; }
```

A primary button (nothing to add: it is in `PRIMARY`):

```html
<button type="submit" class="btn primary">Save the plan</button>
```

A spot kept for it on an empty chat (the source app's chat):

```html
<div class="ai-hello-spot" data-orb-spot="hello" data-orb-size="76"></div>
```
(any non-"stage" value counts as a spot; `.ai-hello-spot { width: 76px; height: 76px; flex: none; }`)

A stage (the source app's voice mode; the orb becomes the voice orb and the page drives its glow):

```tsx
<div className="ai-voice" role="dialog" aria-modal="true" aria-label="Voice chat">
  <button type="button" className="ai-voice-orb" data-orb-spot="stage" data-orb-size="180" onClick={tapOrb} aria-label="Voice orb">
    <span className="ai-voice-spot" aria-hidden />   {/* 180×180, round */}
  </button>
</div>
```
```ts
useEffect(() => { orbThink(energy); }, [energy]);          // 0.75 speaking, 0.5 thinking, 0.15 paused, 0.2 + level·0.8 hearing
useEffect(() => () => orbThink(null), []);
```

Something the page wants to say, kept until the orb is tapped, with a button:

```ts
orbNote('I’d go with “A harbour town”. It suits the summer you picked.', { label: 'Go with “A harbour town”', id: 'pick' });
const stop = onOrbAct((id) => { if (id === 'pick') pick(rec.label); });
```

Telling the orb what the page is:

```ts
document.documentElement.dataset.orbContext = 'You are the guide inside Compass, an app that plans a trip or an evening one question at a time. The person is on the walk screen, at the question "Where to?".';
```

---

## 10. Caret mode (`caret.ts` and `syncCaret`)

### Which fields (`caretField(el, skip)`)

Null if `el` is inside `skip` (the orb's layer) or inside `[data-own-caret]`. Then:

- a `<textarea class="xterm-helper-textarea">` (a terminal) → yes, even read-only
- a `<textarea>` → yes unless `readOnly`
- an `<input>` → yes if `type` is one of `text, search, url, email, tel, password, number, ""` and not `readOnly`
- an element with `isContentEditable` → yes
- anything else → null

### Measuring (`caretOf(el)`) → `{ x, y, h }` (left of the caret, top of its line, line height)

- Null if the box is under 2×2.
- `h = min(lineHeight, box.height)` where `lineHeight` = computed `line-height` or `fontSize × 1.25`.
- **Terminal** (`.xterm-helper-textarea`): the hidden box sits on the cursor cell; its rect is the caret. Null if it is outside `.xterm-screen` by more than 1 px (scrolled away).
- **Code editor** (`.cm-editor`): the rect of `.cm-cursor-primary` (or `.cm-cursor`); null if outside `.cm-scroller`.
- **`<input>` / `<textarea>`**: `caretAt(el, selectionEnd ?? value.length)` (number inputs have no selection: the end).
- **contenteditable**: the selection's collapsed range rect. An empty line has no rect: use the line element's left (plus its `padding-left`) and top, or the field's own padding box. Height `max(rect.height, h·0.8)`.

### `caretsAt(el, from, to)` — the hidden copy

A `div` is laid out at the box's position with these styles copied: `boxSizing, width, height,
border*Width, padding*, fontStyle, fontVariant, fontWeight, fontStretch, fontSize, fontFamily,
lineHeight, textAlign, textTransform, textIndent, letterSpacing, wordSpacing, tabSize, wordBreak,
overflowWrap, direction`; `position: fixed`, hidden, `overflow: hidden`, `white-space: pre` (input)
or `pre-wrap` + `overflow-wrap: break-word` (textarea). Password values become `•` per character.
A zero-width-space `<span>` marker goes before each position; surrogate pairs are never split (the
second half gets `null`).

**Scaling fix:** `sx = box.width / offsetWidth`, `sy = box.height / offsetHeight` (a box inside a
scaled ancestor draws smaller or larger than it lays out), so measurements are made unscaled and
multiplied back.

**Top of the line:**
- input: `box.top + (borderTop + paddingTop + max(0, (offsetHeight − borderTop − borderBottom − paddingTop − paddingBottom − lineHeight)/2)) · sy` (a single-line input centres its line inside its padding, which is often uneven)
- textarea: `box.top + (mark.top − box.top − scrollTop) · sy`

`x = clamp(box.left + (mark.left − box.left − scrollLeft)·sx, box.left, box.right − 2)`;
`y = clamp(top, box.top, box.bottom − h)`.

### `offsetAt(el, x, y)` — where a dropped orb's caret goes

- RTL or any Hebrew/Arabic-range character (`/[֐-ࣿיִ-﷿ﹰ-﻿]/`) or computed `direction: rtl`: find the line by binary search (first position whose line bottom is below `y`, last whose top is above), measure every position on that line in one pass, take the nearest by `|cx − x| + |cy + h/2 − y|·4`.
- Otherwise: binary search for the last position whose caret is before the point in reading order (line first, then x), then pick the nearer of the two gaps if they are on the same line (`|b.y − a.y| < 1`).

### `syncCaret()` in the orb

Called on the next animation frame after `focusin` (then also re-arms the MutationObserver),
`focusout`, `selectionchange`, `input` and `keydown` (capture; these also set `data-typing` for 650 ms),
any `scroll` (capture), `resize`, and `visualViewport` `resize`/`scroll`. The MutationObserver
watches the terminal's hidden textarea (`style` attribute) and the code editor's `.cm-cursorLayer`
(attributes, children, subtree), because they move without a selection event.

While the orb is the caret, a rAF loop also compares the field's bounding rect (rounded to half
pixels) each frame and calls `syncCaret()` when it changes (springs settling, content above leaving).

When there is a caret rect `c` and the mode is not `drag`/`acting`:

```
caretH = clamp(c.h, 12, 48);  sizeTo(1);  seat = null
cx = c.x + 2.5/2;  cy = c.y + c.h/2            // on the gap before the next letter, halfway down the line
level 'off':       morph.set(1); x.set(cx); y.set(cy)
entering, or a different field:  flight = { d0: max(1, distance) }; springs → GLIDE; targets = (cx, cy)
already the caret, landed:       springs → CARET; morph.target = 1; targets = (cx, cy)
already the caret, still flying: targets = (cx, cy)   (keeps gliding)
```

Leaving (no rect, mode is `caret`): see the mode table. `data-orb-caret` is removed from `<html>`
(also on unmount).

### Text insertion (`write.ts`)

`insertText(el, text)` puts text at the caret (or over the selection) the way typing would:
`document.execCommand('insertText')` when supported, else the native value setter + `setSelectionRange`
+ an `input` event (inputs/textareas), or a text node into the selection range (contenteditable).
Also exported: `writable(el)` (a box writing help may work in: not inside `[data-no-write-help]`,
`.cm-editor`, `.xterm`, `[data-own-caret]`; not private; inputs only of type `text`/`search`/`""`
with `autocomplete` off/on/empty), `textOf`, `caretAtEnd`, `selectionIn`, `wantsGhost`,
`cleanReply`, `joinGhost`, `GHOST_PROMPT`, `REWRITES`, `rewritePrompt`. These are plain text
utilities; the orb itself only uses `privateField`/`labelOf` from this file. No AI is called.

---

## 11. Gestures

All on the `.orb-cursor` button with pointer events (`touch-action: none`; right-click is
suppressed). `setPointerCapture` keeps the pointer.

### Pointer down (`button === 0` only)

1. `tracker.reset()`, add the first sample.
2. Record `press = { id, x0, y0, cx, cy, tMove, dx: x − clientX, dy: y − clientY, t0, moved: false, deep: false, pinching: false, pinched: false }`.
3. Bind the window-level second-finger listeners (`bindOthers`).
4. `depth.target = 0.35`.
5. Hold timer: after **420 ms** without moving → `deepPress()`.
6. Asks `DeviceMotionEvent.requestPermission()` if the browser has it (for shake).

### Pointer move

1. Add to the tracker; update `cx, cy, tMove`.
2. If pinching → `pinchUpdate()` and return.
3. **Pressure**: if `pressure > 0 && pressure !== 0.5` (0.5 is a mouse's constant) and not moved: `depth.target = 0.35 + pressure · 0.6`; at `pressure ≥ 0.55` → `deepPress()`.
4. **Slop**: if not moved, distance from `(x0, y0)` > **8 px**, and not deep → `moved = true`, hold timer cleared, mode `drag`, `sizeTo(1)`, `seat = null`, `onStage = false`, `depth.target = 0.12`, springs → `track`.
5. While moved:
   - `tx = clientX + dx`, `ty = clientY + dy` (the grab offset is kept).
   - `over = pressableAt(tx, ty)`: `elementsFromPoint` ignoring the orb; a hit inside `.cm-editor` resolves to its `.cm-content`; else `closest(PRESSABLE)` where `PRESSABLE = 'button, a[href], input, textarea, select, label, summary, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [contenteditable="true"]'`; null if `disabled`, `aria-disabled="true"`, or inside `[inert]`/`[aria-hidden="true"]`.
   - `setHover(over)`: see below.
   - **Magnet**: if `over` is not a text box and its rect is `< 240` wide and `< 120` tall, `tx += (centreX − tx)·0.3`, `ty += (centreY − ty)·0.3`.
   - `x.target = rubberClamp(tx, v.x + 28, v.x + v.w − 28, v.w·0.25)`, same for y with `v.h·0.25`.

### Hover (`setHover(el)`)

Leaving the previous: remove `data-orb-hover`, dispatch `pointerout` + `mouseout` (bubbling,
`relatedTarget` = the new one). Entering: set `data-orb-hover`, dispatch `pointerover` + `mouseover`,
`tick()` (haptic only), `grow.target = 1.12` (leans in), `jelly.velocity += 1.4`, and after **240 ms**
a caption with the control's `aria-label` / `placeholder` / text (collapsed whitespace; over 48
characters → first 47 + "…"). Leaving everything: `grow.target = 1`, caption cleared. `hover.since`
records when it arrived.

### Deep press (`deepPress()`)

Once per press: `deep = true`, `cue('pop')`, `depth.target = 0.9`, `jelly.velocity += 4`, open the
panel. A deep press is not a tap and not a drag (moving after it does nothing).

### Pointer up

1. Clear the press, hold timer and second-finger listeners; `depth.target = 0`; remember `over`, then `setHover(null)`.
2. **After a pinch** (`pinched`): `endPinch()`; if it was also moved, mode `parked`, target clamped inside, `spot = target`. Return.
3. **Moved** (a drag):
   - `stopped = timeStamp − tMove > 150 ms`; `vel = stopped ? 0 : tracker.velocity()`; `speed = |vel|`.
   - **Drop to press / drop to type**: if `over && stopped && now − over.since > 160 ms` → `activate(over.el, x.target, y.target)` and return. (A throw that ends over a button never presses it.)
   - springs → `land`; `x.velocity = vel.x`, `y.velocity = vel.y` (the throw carries on).
   - `speed < 350` → set down: clamp inside, mode `parked`.
   - else `landing({x: x.target, y: y.target}, vel, viewport, 56)`: tuck → mode `tucked`, target `(right − 14, bottom − 150)`, says "Tucked away. Tap the edge or shake to bring me back."; else mode `parked`, target = landing.
   - `spot = target`; `cue('tap')`.
4. **Deep** → nothing more.
5. **Tap** (nothing else happened):
   - on a stage whose element is a `<button>`: `jelly.velocity += 2.5`, click it.
   - `tucked`: mode `follow`/`parked`, `spot = null`, `jelly.velocity += 3`, `rest()`.
   - otherwise `jelly.velocity += 2.5`; if there is a **note** and the mic is not running → open the panel; else `toggleVoice()`.

### `activate(el, px, py)` — dropped on something

Mode → `follow`/`parked`; springs → `land`; `depth.target = 0.9`, back to `0` after 140 ms;
`jelly.velocity += 2`; `cue('tap')`. Then:

- a text `<input>`/`<textarea>`: `at = offsetAt(el, px, py)` **measured before focusing** (focusing can move things), `focus({ preventScroll: true })`, `setSelectionRange(at, at)` (ignored for `type=number`). It becomes the caret from there.
- contenteditable: focus, then `caretPositionFromPoint` / `caretRangeFromPoint` at `(px, py)`; if the range is inside the element, select it collapsed.
- anything else: `data-orb-pressed` for 260 ms; a `<select>` is focused and `showPicker()`ed; everything else `.click()`ed. After 320 ms, `rest()` if the mode is `follow` or `parked`.

### Pointer cancel

Clears the press and listeners; pinch cancelled (`pinch.spring = BOUNCE`, target 1); hover cleared;
`depth.target = 0`; `drag` → `parked`.

### Pinch (second finger anywhere while one finger holds the orb)

Bound on `window` in the capture phase while a press is held:

- **down** (another pointer, no pinch yet): `preventDefault`, `stopPropagation`; `pinchRef = { id, x, y, d0: max(24, distance to the holding finger), r: 1 }`; `pinching = pinched = true`; hold timer cleared; hover cleared; `depth.target = 0.2`.
- **move**: `r = max(0.2, distance / d0)`; `pinch.spring = PINCH_TRACK`; `pinch.target = stretchOf(r)`; caption `"Zoom in · text N%"` / `"Zoom out · text N%"` with `N = zoomFor(r, textScale)·100`.
- **up/cancel** of that finger → `endPinch()`: `finishZoom(r)`, then swallow the next `click` for 500 ms (the second finger must not tap what it landed on).
- `touchmove` (non-passive), `gesturestart`, `gesturechange` are `preventDefault`ed while pinching or with more than one touch, so the page does not scroll or zoom.

`zoomFor(r, now)`: `steps = round(ln r / ln 1.2)`; `clamp(round((now + steps·0.05)·100)/100, 0.9, 1.3)`
(`ZOOM = { min: 0.9, max: 1.3, step: 0.05, per: 1.2 }`: one step per 1.2× of finger distance).

`finishZoom(r)`: `next = zoomFor(r, now)`; if it changed, `onTextScale(next)` (or `--text-scale` on `<html>`);
`cue('pop')`; `pinch.spring = BOUNCE`, target 1; `jelly.velocity += 2.5`; caption `"Text N%"`, or
`"Already the biggest text"` / `"Already the smallest text"` when unchanged, cleared after 1600 ms.

**Trackpad pinch / Ctrl+wheel over the orb**: `acc = clamp(acc · e^(−deltaY·0.01), 0.25, 4)`;
same `PINCH_TRACK` tracking and caption; `finishZoom(acc)` 200 ms after the last wheel event, then
`acc = 1`.

### Shake

`devicemotion` → `ShakeDetector.push(now, ax, ay, az)` → `summon()` (see the mode table).

### Keyboard

- Focus the orb and press **Enter** or **Space**: with **Shift** → open the panel; on a stage button → click it; else `toggleVoice()`.
- **Ctrl+Shift+Space** anywhere (capture) → toggle the panel.
- The orb's `onClick` ignores pointer clicks (`detail !== 0`); taps are handled by the pointer handlers. Keyboard clicks (`detail === 0`) are prevented too, since the `keydown` handler already acted.

---

## 12. Events

### From the page to the orb

| Event | `detail` | Behaviour |
|---|---|---|
| `orb:say` | `string` | trimmed, ignored if empty → `say(line)` |
| `orb:energy` | `number` (0…1) or `null` | `stageEnergy` for the face's `energy` prop (`null` → undefined = idle) |
| `orb:home` | — | see the mode table: `parked`/`tucked` → `follow` with `spot = null`, `lastFocus = null`, `refocus()`. In `caret` mode with `caretMode` `parked`/`tucked`, `caretMode` becomes `follow` (it goes home after leaving the caret). Never pulls it out of a drag or out of a box being typed in. |
| `orb:note` | `{ text, act?: { label, id } }` or `null` | kept as the note (ignored unless `text` is a non-empty string) |
| `orb:run` | `string` | opens the panel and `run(goal)`. **Port note:** was `orbit:orb-run` in Orbit. |

### From the orb to the page

| Event | `detail` | When |
|---|---|---|
| `orb:act` | the note's `act.id` | the note's button in the panel is pressed (the panel closes) |
| `pointerover`/`mouseover`, `pointerout`/`mouseout` | — | dispatched on controls as a dragged orb passes over them |
| `click` | — | on the control it is dropped on; on a stage button when tapped |

### `say(text, spoken)`

- appends `{ who: 'orb', text }` to the log (keeps the last 30 + this one)
- `talking = true` for `min(4000, 600 + text.length · 40)` ms
- caption = text for `min(9000, 2200 + text.length · 45)` ms (replaces any pending caption timer)
- if `spoken` and the adapter has `speak`, `brain.speak(text)`

Captions are hidden while the panel is open (`caption && !panel`) and in caret mode (CSS).

---

## 13. The panel

Opened by: a deep press (hold 420 ms or pressure ≥ 0.55), a tap when there is a note, a tap when
there is no `listen` on the adapter, Shift+Enter/Space on the orb, Ctrl+Shift+Space, `orb:run`.
Closed by its ✕, by the note's button, by the mic button (it closes and starts listening). Closing
also answers a pending confirm with `false`.

Structure, top to bottom (`role="dialog"`, `aria-label="Ask the orb"`):

1. `.orb-panel-head`: title "What should I do?" and the close button (`.icon-btn`).
2. `.orb-note` (if a note): its text, and a `.btn.primary` with `act.label` that dispatches `orb:act` and closes.
3. `.orb-log` (if any lines): the last **8** lines, `<li data-who="you|orb">`.
4. `.orb-found` — **not ported** (Orbit's "find my chats/files/sessions" results).
5. Either `.orb-confirm` (`role="alertdialog"`: text, "No", "Yes, do it") **or**:
   - `.orb-suggest` chips — only when the log is empty **and there is no note**. "What can I do here?" is answered locally (`pageHelp()`: the first 8 labels from `snapshot()`); any other chip goes to `run()`.
   - `.orb-ask` form: `.input` (autofocus, `enterKeyHint="go"`), then while running a "Stop" button (aborts), else the mic `.icon-btn` (only if `brain.listen` exists) and "Go" (`.btn.primary`, disabled while the draft is blank).

The confirm block is kept from Orbit, where the agent asked before risky taps; nothing in the port
triggers it (see §17).

**Sleepy:** when the panel opens, `brain ? await brain.ready() : false`; false → `sleepy = true`
(the face's expression `sleepy`, heavy lids).

**Port note on the input's placeholder:** the source app's was "Open Code, make a video of waves, dark mode…";
the port's is "Ask about this screen…". Button and title strings are unchanged.

The panel uses these class names from the source app's global stylesheet (base.css here), which `orb.css` does not define:
`.btn`, `.btn.primary`, `.btn.ghost`, `.icon-btn`, `.chip`, `.input`, `.row-inline`. Provide them
(this package's components stylesheet does) or restyle under `.orb-panel`.

---

## 14. Energy and the glow

- `orb:energy` (via `orbThink(n)`) sets the face's energy: the shader's liquid stirs faster
  (`speed = 0.25 + energy·0.9`), the sphere swells (`size = 0.86 + energy·0.1`). The example app
  sends `0.7` while suggesting answers, `0.55` while saving, `null` to rest.
- While listening, the mic level `v` drives `energy = 0.25 + v·0.75` (updated at most every 70 ms)
  and `depth.target = −v · 0.25` (it swells a little; negative depth is never drawn as a press).
- While running, energy is `0.8` and `typing` is true.
- The ring (`.orb-cursor-ring`) shows with press depth (`opacity: depth·1.2`, `scale: 1 + depth·0.18`),
  pulses while listening and spins dashed while running.

---

## 15. What needs the adapter

| Feature | Needs `brain`? | Notes |
|---|---|---|
| follow / attention, spots, stages, notes, `orb:say`, `orb:energy`, `orb:home` | no | |
| caret mode, drop-to-type, `insertText` | no | |
| drag, throw, park, tuck, shake, pinch zoom, hover, drop-to-press | no | |
| captions, face expressions, energy | no | the face is **sleepy** in the panel when `brain` is null or not ready |
| the panel, note button, log, chips | no | "What can I do here?" is local (`snapshot()`) |
| "Explain this screen" (`isExplain(goal)`) | **yes** | `brain.chat([system: explainPrompt + context, user: goal + "Text on screen:" + screenText(body, 5000)])`; answer shown with `<think>…</think>` stripped, or "I couldn’t make sense of this screen." |
| any other typed or spoken question | **yes** | `brain.chat([system: askPrompt + context, …last 8 log lines as user/assistant, user: goal])`, or "I couldn’t work out how to answer that." |
| voice in (tap to talk) | `brain.listen` | without it, a tap opens the panel instead |
| voice out | `brain.speak` | only for answers to spoken questions (`spoken = true`) |
| act on a goal ("open X", "tap Y", "type Z") | **not ported** | Orbit's agent; see §17 |

With `brain` null, a question gets the line "There is nothing for me to think with here yet."
With `brain.ready()` false, it gets `brain.why` (or the same line).

`ASK_PROMPT` (port addition): *"You are the orb, a small guide that floats over this page. Answer
the owner in plain, friendly language: 2 to 5 short sentences, no jargon, no markdown headings.
Never repeat passwords or keys."*

`EXPLAIN_PROMPT` (the source app's, unchanged): *"You are the orb in Orbit, a web workspace. You see what is
on the owner's screen (its text, and sometimes pictures). Answer their question about it in plain,
friendly language: 2 to 5 short sentences, no jargon, no markdown headings. If something looks
wrong (an error, a warning), say what it means and one thing to try. Never repeat passwords or
keys."* — pass `explainPrompt` to name your own app.

Running an answer: `running = true`, the user line is logged, the previous answer is aborted
(`AbortController`), errors → `cue('error')`, `flash(−1)`, the message is said. In `finally`:
`running = false`, the mode is restored, and after 250 ms `rest()` + `syncCaret()`. A shake aborts
and says "Stopped.".

---

## 16. CSS (`orb.css`, every rule)

The copy is verbatim. Variables it expects from the app's tokens: `--accent`, `--surface`,
`--surface-2`, `--border`, `--border-strong`, `--text`, `--text-2`, `--text-3`, `--accent-soft`,
`--fs-sm`, `--fs-md`, `--font-ui`, `--font-display`, `--safe-top/right/bottom/left`, `--glass-strong`,
`--ease-o5`, `--text-scale`, and `--tx`/`--ty` (tilt, optional).

```css
.orb-layer { position: fixed; inset: 0; z-index: 70; pointer-events: none; --orb-x: -100px; --orb-y: -100px; }
```
The full-screen layer. It takes no pointer events itself; `--orb-x/--orb-y` start off screen until the first layout effect writes them.

```css
.orb-layer[data-hidden] .orb-cursor, .orb-layer[data-hidden] .orb-caption { opacity: 0; pointer-events: none; }
.orb-layer[data-hidden] .orb-panel { display: none; }
```
Hidden behind a modal dialog (or the `hidden` prop): the ball and caption fade (0.25 s, see `.orb-cursor { transition }`), the panel is removed so it never covers the dialog.

```css
.orb-cursor { --depth: 0; position: absolute; left: 0; top: 0; width: 56px; height: 56px; padding: 0; border: 0; border-radius: 50%; background: none;
  pointer-events: auto; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  cursor: grab; will-change: transform; transition: opacity 0.25s ease;
  filter: drop-shadow(0 calc(10px - var(--depth) * 8px) calc(18px - var(--depth) * 12px) rgb(0 0 0 / calc(0.32 + var(--depth) * 0.18))); }
.orb-cursor:active { cursor: grabbing; }
.orb-cursor:focus-visible { outline: none; }
.orb-cursor:focus-visible .orb-cursor-ring { opacity: 1; }
```
The ball: a 56 px button positioned by its per-frame transform. The contact shadow is 10 px down / 18 px blur at rest and tightens to 2 px / 6 px, darkening from 0.32 to 0.50, as `--depth` goes to 1. Keyboard focus shows the ring instead of an outline.

```css
.orb-cursor-face { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; translate: calc(var(--tx, 0) * 4px) calc(var(--ty, 0) * 4px); }
.orb-cursor .orb-cursor-face:not(canvas) { width: 100%; height: 100%; }
.orb-cursor canvas.orb-cursor-face { width: 100%; height: 100%; margin: 0; }
```
The face fills the button and parallaxes 4 px with the tilt. The two overrides beat `face.css`'s own sizes (`.ai-orb` 64 px, `.ai-orb-gpu` 88 px with −12 px margin) so the cursor's face is exactly the button.

```css
.orb-cursor-ring { position: absolute; inset: -5px; border-radius: 50%; border: 1.5px solid color-mix(in srgb, var(--accent) 70%, white);
  opacity: calc(var(--depth) * 1.2); scale: calc(1 + var(--depth) * 0.18); pointer-events: none; }
.orb-layer[data-listening] .orb-cursor-ring { opacity: 0.9; animation: orb-listen 1.4s ease-in-out infinite; }
.orb-layer[data-running] .orb-cursor-ring { opacity: 0.7; border-style: dashed; animation: orb-spin 2.4s linear infinite; }
@keyframes orb-listen { 50% { scale: 1.22; opacity: 0.35; } }
@keyframes orb-spin { to { rotate: 1turn; } }
```
A thin accent ring 5 px outside the ball. Normally invisible; it appears and grows with press depth. Listening: it pulses (1.4 s). Running: dashed and spinning (2.4 s per turn).

```css
.orb-caption { position: absolute; left: clamp(12px, calc(var(--orb-x) - 130px), calc(100vw - 272px)); top: max(calc(var(--safe-top, 0px) + 8px), calc(var(--orb-y) - 82px));
  width: 260px; margin: 0; padding: 10px 14px; border-radius: 16px; background: color-mix(in srgb, var(--surface) 88%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); border: 0.5px solid var(--border);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.25); color: var(--text); font-size: var(--fs-sm); line-height: 1.35; pointer-events: none; animation: orb-caption-in 0.22s ease-out; }
@keyframes orb-caption-in { from { opacity: 0; translate: 0 6px; } }
```
The speech bubble: 260 px wide, centred over the orb (130 px to its left), 82 px above its centre, kept 12 px inside the screen edges and below the safe-area top. Glass background. Fades/rises in over 0.22 s.

```css
.orb-panel { position: absolute; left: max(12px, var(--safe-left, 0px)); right: max(12px, var(--safe-right, 0px)); bottom: calc(max(12px, var(--safe-bottom, 0px)) + 8px);
  max-width: 460px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 22px;
  background: color-mix(in srgb, var(--surface) 92%, transparent); -webkit-backdrop-filter: blur(24px) saturate(170%); backdrop-filter: blur(24px) saturate(170%);
  border: 0.5px solid var(--border); box-shadow: 0 24px 60px rgb(0 0 0 / 0.35); pointer-events: auto; animation: orb-panel-in 0.28s cubic-bezier(0.2, 0.9, 0.25, 1.15); }
@keyframes orb-panel-in { from { opacity: 0; translate: 0 18px; scale: 0.97; } }
.orb-panel-head { display: flex; align-items: center; justify-content: space-between; }
.orb-panel-title { margin: 0; font-weight: 600; font-size: var(--fs-md, 1rem); }
```
The bottom sheet: 12 px (or the safe inset) from the sides, 8 px above the bottom inset, at most 460 px wide and centred. Springs up over 0.28 s with a slight overshoot.

```css
.orb-note { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; font-size: var(--fs-md, 15px); color: var(--text); }
.orb-note p { margin: 0; line-height: 1.45; }
```
The page's note and its button.

```css
.orb-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 32vh; overflow-y: auto; font-size: var(--fs-sm); }
.orb-log li[data-who='you'] { align-self: flex-end; color: var(--text); background: var(--accent-soft); padding: 4px 10px; border-radius: 12px; }
.orb-log li[data-who='orb'] { color: var(--text-2); }
```
The exchange: your lines as soft accent bubbles on the right, the orb's as plain muted text on the left. Scrolls after 32 vh.

```css
.orb-suggest { display: flex; flex-wrap: wrap; gap: 6px; }
.orb-suggest .chip { min-height: 36px; }
.orb-ask { display: flex; gap: 8px; align-items: center; }
.orb-ask .input { flex: 1; min-width: 0; min-height: 44px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--border-strong); background: var(--surface-2, var(--surface)); color: var(--text); font: inherit; font-size: 16px; }
.orb-ask .btn, .orb-ask .icon-btn { min-height: 44px; min-width: 44px; }
.orb-confirm p { margin: 0 0 10px; }
.orb-confirm .row-inline { justify-content: flex-end; }
```
Chips, the ask row (16 px input text so phones do not zoom; 44 px touch targets) and the confirm buttons.

```css
:root[data-skin='o5'] .orb-panel, :root[data-skin='o5'] .orb-caption { border-radius: 6px; }
:root[data-skin='o5'] .orb-panel-title { font-family: var(--font-display); font-weight: 400; font-size: calc(24px * var(--text-scale, 1)); }
```
The Orbit 0.5 magazine skin: square corners and a display-face title. Harmless if your app never sets `data-skin`.

```css
@media (prefers-reduced-motion: reduce) { .orb-layer[data-listening] .orb-cursor-ring, .orb-layer[data-running] .orb-cursor-ring { animation: none; } }
```

```css
.orb-layer[data-caret] .orb-cursor { pointer-events: none; cursor: text; }
.orb-cursor-face { transition: filter 0.22s ease, box-shadow 0.22s ease; }
.orb-layer[data-slim] .orb-cursor { filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 60%, transparent)); }
.orb-layer[data-slim] .orb-cursor-face { filter: none; box-shadow: none; }
.orb-layer[data-slim] .orb-cursor-ring { opacity: 0; }
.orb-layer[data-caret] .orb-caption { display: none; }
.orb-layer[data-caret][data-slim]:not([data-typing], [data-flying]) .orb-cursor-face { animation: orb-caret-breathe 1.1s ease-in-out 0.4s infinite; }
@keyframes orb-caret-breathe { 50% { opacity: 0.3; } }
```
As the caret: taps pass through to the text; the glow would stretch into a streak so it swaps to a 3 px accent halo while slim (`data-slim` follows the shape, not the mode, so it fades at the right moment); the ring and captions are off; once landed and not typing, it breathes like a caret blink (1.1 s, 0.4 s delay).

```css
:root[data-orb-caret] :is(input, textarea, .ta-plain, [contenteditable='true']):focus { caret-color: transparent; }
:root[data-orb-caret] .cm-editor.cm-focused .cm-cursorLayer { visibility: hidden; }
:root[data-orb-caret] .xterm.focus .xterm-rows .xterm-cursor { background-color: transparent !important; color: inherit !important; outline: none !important; box-shadow: none !important; animation: none !important; }
@media (prefers-reduced-motion: reduce) { .orb-layer[data-caret][data-slim] .orb-cursor-face { animation: none; } }
```
While the orb is the caret, the field's own caret steps aside: text boxes (`.ta-plain` is the source app's textarea class, kept in base.css), CodeMirror's cursor layer, and xterm's block cursor.

```css
[data-orb-hover] { outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent); outline-offset: 3px; transition: outline-offset 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
:root[data-skin='o5'] [data-orb-hover] { outline-color: color-mix(in srgb, var(--text) 45%, transparent); outline-width: 1.5px; }
[data-orb-pressed] { scale: 0.96; transition: scale 0.12s ease-out; }
@media (prefers-reduced-motion: reduce) { [data-orb-hover], [data-orb-pressed] { transition: none; scale: none; } }
```
The touch cursor: a 2 px accent outline (following each control's own corners) while the orb is over it; a 0.96 squeeze for 260 ms when it is dropped on it.

```css
.wh-ui { position: fixed; z-index: 9400; }
.wh-ghost { … } .wh-ghost-key { … } .wh-chip { … } .wh-chip[role='menu'] { … } .wh-chip button { … } .wh-chip button:hover:not(:disabled) { … } .wh-chip-main span { … }
@keyframes wh-in { … } :root[data-motion='off'] :is(.wh-ghost, .wh-chip) { animation: none; }
@media (pointer: coarse) { .wh-ghost-key { display: none; } }
```
The source app's writing help (ghost text and the Rewrite chip, `WriteHelp.tsx`), which is **not ported**. The rules are kept in the verbatim copy and are unused unless you build on `write.ts`.

```css
.orb-found { … } .orb-found button { … } .orb-found button:hover { … } .orb-found-kind { … } .orb-found-title { … } .orb-found-snippet { … }
```
The source app's "find …" results list in the panel, **not ported**; kept in the copy, unused.

`face.css` adds `.ai-orb` (64 px conic-gradient sphere, spinning 8 s and breathing 4 s), `.ai-orb-gpu`
(88 px canvas with −12 px margin, no CSS effects; overridden to 100 % inside `.orb-cursor`),
`.ai-orb-eyes` (lite-motion eyes, blink every 4.6 s; sleepy: 7 s and `scaleY(0.45)`), and turns the
animations off under `prefers-reduced-motion`.

---

## 17. What is not in the port, and what changed

Left out on purpose (specific to the source app, or AI beyond the adapter):

- **The do-it-for-me agent** (`agent.ts`: `parseCommand`, `PLANNER_PROMPT`, `Step`, `exec`, `plan`, `aimAt` with the `AIM` spring, the "Typed …"/"Tapped …" log lines, `needsConfirm` and the confirm dialog's use). It opened the source app's own apps, changed its settings and switched its servers. A future `act` hook on the adapter (for example `act?(goal, page: PageItem[]): Promise<Step | null>`) could bring back step-by-step acting; `snapshot()` and `labelOf()` are already here for the "what is on screen" side, and `activate()` shows how the orb presses something.
- **Find / bring** (`find.ts`: searching the source app's chats, files and sessions; the `.orb-found` list; "bring me …" into the last text box via `insertText`).
- **Pictures** for "explain this screen" (`screenPictures`): the adapter takes text only.
- **`pageChat`** (a page lending its own AI): replaced by the `brain` prop.
- **Speech and listening modules**: replaced by `brain.speak` / `brain.listen`. `docs/10-ai-adapter.md` ports the browser Web Speech parts.
- **`useShell`** (settings, overlay, app names), **`useMotionLevel`** (now `settings.level`), the **`Icon`** component (two inline SVG paths instead, same geometry).
- **The `orbit:orb-run` event name** (now `orb:run`).

Changed strings: the suggestions list; the input placeholder; `pageHelp()` says "On this screen: …. Ask me about any of it." / "Ask me about this screen." (the source app's ended "Ask me to tap, type, open or change anything." / "Ask me to open an app, change a setting or make something.", which would be untrue here). New strings: `ASK_PROMPT`, "There is nothing for me to think with here yet.", "Thinking…", "I couldn’t work out how to answer that.".

Everything else — every spring, threshold, timing, size, selector, attribute and mode rule — is as in the source app.
