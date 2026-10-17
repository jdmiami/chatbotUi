# Orbit motion language

One physical world for every screen. Every animation in Orbit, the site pages and the status pill
follows these rules. If a motion doesn't explain a change or confirm a touch, it is cut.

## 1. Light

- **One light source**, above the screen and slightly to the left (about 10 o'clock, 60° up).
- Surfaces facing it catch a **highlight**: a thin bright top edge and a soft sheen in the top-left.
- Everything casts its **shadow down and slightly right**, away from the light.
- When you tilt the phone (or move the mouse on a computer), the light appears to stay put while the
  screen moves: highlights slide across surfaces and shadows shift the other way. This is what makes
  flat things read as 3D.

## 2. Depth layers

Five fixed layers. Something higher casts a longer, softer shadow, takes more of the tilt, and sits
on more blur. Nothing moves between layers except by lifting (press/drag) or by the transitions in §4.

| Layer | What lives there | Shadow | Tilt parallax |
|---|---|---|---|
| 0 · Far | Wallpaper and its light | none | moves against the tilt, 14 px |
| 1 · Surface | Cards, widgets, list rows, gallery tiles, app icons at rest | `--depth-1` | 2 px |
| 2 · Raised | Dock, app windows, the composer, a card while held | `--depth-2` | 4 px |
| 3 · Floating | Sheets, menus, the open task manager | `--depth-3` | 6 px |
| 4 · Top | Status pill, toasts | `--depth-4` | 8 px |

- **Lift**: holding something raises it one layer (shadow grows, scale 1.02). Letting go drops it back with the `bouncy` spring.
- **Press**: tapping pushes it *down* (shadow shrinks, scale 0.95), like a real button, then springs back.

## 3. Springs (in iOS terms)

Apple describes springs by **response** (how long the motion takes, in seconds) and **damping**
(1 = no overshoot, lower = more bounce). Ours, with the physics they turn into (mass 1):

| Name | Response | Damping | Stiffness / friction | Used for |
|---|---|---|---|---|
| `snappy` | 0.30 | 0.86 | 439 / 36 | presses, toggles, small controls |
| `smooth` | 0.50 | 1.00 | 158 / 25 | fades of large areas, things leaving |
| `default` | 0.55 | 0.825 | 131 / 19 | app windows opening and closing (SwiftUI's default spring) |
| `bouncy` | 0.50 | 0.70 | 158 / 18 | sheets, cards, messages arriving |
| `playful` | 0.45 | 0.58 | 195 / 16 | the status pill, icons popping in |
| `flick` | 0.40 | 0.80 | 247 / 25 | anything you let go of mid-drag (keeps your finger's speed) |

CSS gets the same curves as `linear()` easings (`--spring-*` in `motion.css`); script animations use
the same numbers (`motion/springs.ts`). Lite swaps every spring for a 180 ms ease; Off swaps them for
a 150 ms cross-fade (see §6).

## 4. Where things come from and go

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

## 5. Storyboards (what each motion explains, what was cut)

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

## 6. Reduce Motion (designed, not just switched off)

When the device asks for reduced motion, or Settings → Motion is **Off**:

- Nothing slides, scales, tilts or bounces. Depth stays (shadows and highlights remain, so the
  layers still read), but it is still.
- Changes **cross-fade** in 150 ms, so you can still see what changed and where.
- Parallax and the GPU background are off. The countdown and live numbers still update.

## 7. Performance rules

- Only `transform`, `opacity` and (sparingly) `filter` animate; never layout.
- One GPU canvas at most, and only on the home screen; it stops when covered, hidden or on Lite/Off.
- Tilt is read once per frame and written to two CSS variables; nothing else listens to the sensor.
- Every touch answers within one frame; no animation blocks input.
