# Live Draw studio: Phase 1

Live Draw's drawing side, rebuilt as a full drawing studio. The AI side (the drawing machine, Live,
Paint over, Keep, Bring to life, Regions, Pose, Style reference, Finish, the sketch reader) is
unchanged, and so is its contract (DESIGN.md §5.1): layers marked **Lines** are sent as `sketch`
(black lines, each stroke's centre line), layers marked **Colour** as `color` (as they look).

Everything lives under `orbit/src/apps/livedraw/`. No shared Orbit file was changed.

## 1. GPU brush engine

- **WebGL2** (`engine/gl.ts`, shaders in `engine/shaders.ts`). Every layer and layer mask is a
  texture. A stroke's dabs are stamped (instanced quads, up to 4096 per draw) into a stroke buffer,
  then baked onto its layer once, so a stroke's own dabs never build past its opacity (flow vs
  opacity, like Procreate). Bakes are scissored to the stroke's box. Each frame blends the visible
  layers in order (one pass per layer), previews the live stroke on its layer, and draws the dabs
  **predicted** ahead of the pen (`getPredictedEvents`) for that frame only. Every coalesced sample
  (`getCoalescedEvents`) is used, so a 240 Hz Pencil draws every point; drawing is driven by
  `requestAnimationFrame`, so 120 Hz screens get 120 frames.
- If iOS takes the GPU away (`webglcontextlost`, e.g. after backgrounding) the engine rebuilds every
  layer from the drawing when it comes back.
- **Fallback**: a 2D-canvas engine with the same API (`engine/canvas2d.ts`), used where WebGL2 is
  missing (or with `localStorage['orbit:livedraw:engine'] = '2d'`), and for brush previews.
  WebGPU is not used yet (WebGL2 runs on every iPad and iPhone Safari Orbit supports).
- **Stamp brushes** (`brushes/types.ts`, `brushes/dabs.ts`): tip shape (procedural round with
  hardness, or a texture: lead, charcoal, chisel, bristle, splatter, spray), roundness, angle,
  rotation (fixed, along the stroke, Pencil azimuth, random), spacing, size / opacity / angle /
  scatter jitter, count (spray), streamline, start/end taper (the end taper is applied on lift, when
  the length is known), grain (paper, canvas, charcoal, fibre, noise; canvas-anchored), a dual
  texture, and **dynamics**: pressure (through an editable cubic-bezier curve), tilt and speed each
  drive size, opacity, flow and scatter (`brushes/dynamics.ts`), plus tilt-widening and
  tilt-flattening (shading with the side of the lead). The walk is seeded, so a stroke draws the
  same again after undo, a resize or for export.
- **Textures are made in code** (`engine/textures.ts`): tileable value-noise grains and the tips. No
  picture files, nothing borrowed.
- **Built-in set** (`brushes/presets.ts`): Technical pen, Ink pen, Pencil HB, Pencil 6B, Charcoal,
  Marker, Gouache, Soft airbrush, Hard airbrush, Spray, Eraser, Textured eraser, Blend and Smudge
  (smudge picks up the paint under the previous dab and mixes it in: `L·(1−k) + P·k`).
- Any brush can be used by the Brush, Eraser or Smudge tool; each tool remembers its own brush.

## 2. Brush maker and library

- `brushes/BrushMaker.tsx`: every setting in five tabs (Stroke, Tip, Grain, Pressure & tilt,
  Paint) with a live preview stroke; the pressure curve has two draggable handles and presets.
- Built-in brushes stay as they are: **Save as my brush** makes your copy; **Duplicate**, rename,
  **Use without saving**, **Take it away** (a small `.brush.json`) and **Bring in a brush**.
- `brushes/library.ts`: your brushes in `localStorage` (`orbit:livedraw:brushes`); files are read
  strictly (every value clamped, unknown fields dropped, a fresh id), so a bad file can only fail.
- `brushes/BrushPanel.tsx`: the library, each brush shown by the stroke it makes.

## 3. Precision ink

- **Steady lines** (`ink/stabilizer.ts`): streamline (per brush) plus a **pulled string** (lazy
  rope, adjustable in Guides): the line trails the pen by a fixed string; wobbles inside it never
  reach the line. The string is drawn while you draw.
- **Ink layers** (`ink/vector.ts`): strokes are kept as control points (Ramer–Douglas–Peucker),
  drawn as a smooth Catmull–Rom curve with pressure width. **Edit ink** selects a stroke: drag a
  point or the whole stroke, change its width or colour, delete it. The ink eraser removes whole
  strokes. They become pixels only when saved (PNG / PSD).
- **Shape snapping** (`ink/quickshape.ts`): hold still at the end of a stroke and it becomes a
  clean line, arc, ellipse/circle or rectangle; keep holding and move to adjust (a line's end
  follows the pen, other shapes scale).

## 4. Guides

- **Perspective** (`guides/perspective.ts`): 1, 2 or 3 vanishing points, a grid of rays and the
  horizon; **Move the points** makes them draggable (44 px handles). **Snap strokes to
  perspective**: once a stroke has moved 1.5 % of the canvas it locks to the closest guide (toward a
  vanishing point, or level/upright where the grid has them) and every later point slides onto it.
- **Symmetry** (`guides/symmetry.ts`): left and right, top and bottom, four ways, radial (2–24
  parts, kaleidoscope), each with a **rotational** option; the centre can be moved. A symmetric
  stroke is one stroke with its transforms (`mirrors`), so undo takes all copies at once.
- `guides/GuidesPanel.tsx` holds both, the pulled string and the shape-snap switch.

## 5. Layers

- `layers/model.ts`: unlimited layers (bottom first), each with ops (strokes, fills, merged pictures),
  blend mode (normal, multiply, darken, colour burn, screen, lighten, add, colour dodge, overlay,
  soft light, hard light, difference, exclusion, hue, saturation, colour, luminosity), opacity,
  layer mask (paint hides, erase shows), clipping (to the nearest unclipped layer below), alpha lock,
  and what the drawing machine reads it as (Lines / Colour / Not read). Every change makes a new
  state; undo/redo step through states (slider drags fold into one step). The renderer redraws only
  the layers whose ops changed (a new stroke on top is drawn incrementally, anything else replays
  that layer).
- **Memory-aware cap** (`layerCap`): a share of the device's memory (4 GB assumed on iOS) over the
  size of one layer texture; past it, a plain message asks to merge or delete one.
- `layers/LayersPanel.tsx`: thumbnails, drag the grip to reorder (or Up/Down), rename, blend,
  opacity, lock, clip, mask, duplicate, merge down, clear, delete; Picture and Reference rows below.
- Blend maths: `engine/blend.ts` (the W3C compositing formulas; the shader copies them). Fills are
  bounded by the lines on every other visible layer and stored as pixels (so they replay exactly).
- **PSD** keeps every layer with its name, blend mode, opacity, visibility, clipping, alpha lock and
  mask (`canvas/exporters.ts`, ag-psd), over Paper, Picture and Reference.
- `layers/machine.ts`: the drawing machine's `sketch` / `color` from the layers.

## 6. Adaptive interface and gestures

- **iPad sideways / desktop**: a two-column rail on the left (tools, the brush in hand, colour, quick
  menu, tall Size and Opacity sliders, undo/redo, whole canvas, hide tools) and side panels on the
  right (Brushes, Colour, Layers, Guides, Picture, History) that slide in and can be hidden.
- **iPhone (and iPad upright)**: a tool row above the canvas (Brush, Eraser, Smudge, more, colour,
  undo, redo), Size and Opacity under it, everything else in the Tools sheet.
- **Gestures** (`ui/gestures.ts`, `canvas/Stage.tsx`): two-finger tap undo, three-finger tap redo,
  four-finger tap hides everything but the canvas, two-finger pinch zooms and twists (the point
  under the fingers stays put); on lifting, a pinch in snaps back to the whole canvas and a turn
  within 7° of upright or a quarter turn settles onto it. Press and hold still: eyedropper with a
  loupe. Two fingers held still (or one finger while a Pencil is in use, or a right-click): the
  **quick menu** at the Pencil's tip (last brushes, last colours, undo, redo, size, opacity).
  Apple Pencil double-tap and squeeze are not available to web pages, so the hold is the way in.
- **Pencil hover** (pen events with no buttons) shows the brush's size where it would land.
- **Palm rejection**: once a Pencil is seen, fingers move the canvas and never draw.
- **Colour** (`ui/ColorPanel.tsx`, `ui/color.ts`): a hue ring with a saturation/brightness square,
  hex, harmonies (complementary, analogous, triad, split), recent colours, palettes (Basics, Skin,
  Earth, Pastel, Ink and paper, and your own).
- Keyboard: ⌘Z / ⇧⌘Z, B E S G I V for the tools, [ and ] for size.
- Look: Orbit 0.5's MagStyle (`livedraw.css`, `ui/studio.css`), plain words, 44 px targets, the orb
  spot on the brush maker's Save, `orbNote` for guides, masks and ink layers.

## 7. File map

| Path | What |
|---|---|
| `LiveDrawApp.tsx` | the app: machine, AI link, studio state, panels, exports |
| `canvas/Stage.tsx` | the canvas: pointer pipeline, gestures, overlays, hover, loupe |
| `canvas/*` (other) | unchanged helpers: lines for the machine, masks, pose, history, exporters |
| `engine/renderer.ts` | renderer base: layer sync, live stroke, snapshots, merge, factory |
| `engine/gl.ts`, `engine/shaders.ts` | the WebGL2 engine |
| `engine/canvas2d.ts` | the 2D engine and brush previews |
| `engine/blend.ts`, `engine/textures.ts` | blend maths and names; procedural tips and grains |
| `brushes/*` | brush types, dynamics, the dab walk, presets, library, panel, maker |
| `ink/*` | stabilizer, shape snapping, vector ink |
| `guides/*` | perspective, symmetry, their panel |
| `layers/*` | the drawing model and history, what the machine reads, the layers panel |
| `ui/*` | gestures maths, colour, controls, toolbars, quick menu, icons, studio styles |

## 8. Tests

- Unit (`orbit/tests/unit/livedrawStudio.test.ts`): pressure curve and dynamics, the dab walk
  (spacing, incremental = whole, determinism, tapers, count), brush JSON round trip and clamping,
  stabilizer, shape recognition, vector ink, perspective snapping, symmetry transforms, blend modes
  and stack order, the layer model and undo, the layer cap, what the machine reads, textures,
  view maths, colour.
- Playwright (`orbit/tests/e2e/livedraw.spec.ts`, iPhone portrait and iPad landscape, 0.5 look):
  the AI flow as before (now also `color` from a Colour layer), GPU brushes, colour, two/three/four
  finger taps, pinch and snap-back, long-press eyedropper, hover, palm rejection, the quick menu,
  layers (blend, lock, mask, duplicate, merge, reorder) and the PSD's layers, ink editing, guides,
  shape snapping, the brush maker with file export and import.

## 9. Not yet (Phase 2 candidates)

- WebGPU path; wet-paint mixing beyond smudge; per-dab colour jitter.
- Tiled undo (now: states + replay of the changed layer; very long sessions replay more).
- Layer groups, selection/transform tools, text.
- The drawing is not saved between visits yet (export PSD to keep layers).
