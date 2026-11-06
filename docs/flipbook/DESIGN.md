# Flipbook

Stick-figure animation in Orbit, drawn with the pen on a pad of square paper notes.
Code: `orbit/src/apps/flipbook/`. Tests: `orbit/tests/unit/flipbook.test.ts`, `orbit/tests/e2e/flipbook.spec.ts`.

## What the owner chose

| Question | Choice |
| --- | --- |
| Which way the iPad is held | Both ways. Upright, the U is taller and narrower |
| iPhone | Viewer only: it plays animations, no drawing |
| Fingers | Only the pen draws. One finger turns the notes, two fingers on the note zoom. A "Draw with a finger" switch lets a finger draw on the note |
| Letting go of a half-lifted note | It springs back to the note you were on |
| Rig and hand drawing | Both: each note shows the rigged character posed for that frame, and you can draw extras on that note |
| Rig detail | Three levels: Simple (15 parts), Detailed (adds neck, shoulders, a bendy spine), Full (adds every finger joint and the toes) |
| Face | Yes: draw a few eyes and mouths once, pick which show on each frame |
| Drawing each part | Once to start; side and back views later |
| Ready-made moves | 8 basics: walk, run, jump, backflip, cartwheel, handstand, punch, kick, at 12 frames a second, made by hand, no paid machine |
| Characters in a scene | Up to 4, each with its own colour on the note edge |
| Saving | On the iPad as you draw, plus a backup to the owner's account, so the iPhone viewer can play them |
| Export | Video to Photos, GIF, and into the gallery (where Make can restyle or animate it) |

## The desk (stage 1, built)

```
 next notes (top left)                       done notes (top right)
      \                                           /
       \____________ the note you draw on _______/
                      (bottom middle)
```

- A note's place is a pure function of its distance from the middle (`layout.ts`, `placeNote`). While a
  thumb moves the pad that distance is fractional, so every note between a stack and the middle is
  caught mid-flight at the thumb's speed. At rest the nearest two notes each side sit up the arms,
  so the pad reads as a U.
- Turning forward: the note in the middle is lifted by its bottom edge (as you lift a note to see the
  one under it), then flaps up the right arm into the done stack. The next note comes down the left arm
  and waits under the middle.
- Thumb up or right turns forward, down or left turns back (`scrub.ts`). One note per a third of the
  note's width. Letting go keeps every whole note turned and springs a partly lifted one back.
  A quick flick turns one more (or a few for a fast one). The pad gives a little at both ends.
- The pad never runs out: one blank note always waits after the last frame, and drawing on it makes it
  a frame.
- Onion view lays the notes either side out flat as cards, next on the left and done on the right,
  and shows them faintly under the note you draw on (before in red, after in blue-green), 1 to 3 each side.
  Upright there is no room beside the note, so the cards sit above it in the corners.
- Ink is Live Draw's vector ink and pen smoothing (`livedraw/ink/vector.ts`, `stabilizer.ts`), kept in
  note units (0..1) so a note looks the same from the corner stack to the middle. The eraser removes
  whole strokes.
- Saved on the device in IndexedDB (`store.ts`), a moment after each change and when the app goes to the
  background. Undo and redo keep the last 100 changes.
- The note in the middle is drawn sharp (up to 2× pixels) on its own canvas once the pad is at rest. The
  other notes are drawn once each, at 1×, and only moved after that, so turning stays smooth.

## Stages

1. **The desk** (built): the U of notes in both directions, turning with the thumb, peeking, onion cards,
   pen and eraser, colours and line widths, play at 8, 12 or 24 frames a second, undo, saving on the
   device, and the iPhone viewer's empty state.
2. **The rig**: the skeleton at three levels plus the face, and a walkthrough that has you draw each
   part in turn. Each part's drawing rides on its bone. Unfinished parts show as plain stick lines.
3. **Moves and characters**: the 8 ready-made moves as poses per frame, putting your character on any
   of them, and up to 4 characters per scene.
4. **Backup and export**: account backup (so the iPhone viewer has something to play), then video to
   Photos, GIF, and sending it to the gallery.

## Not checked yet

- Real Apple Pencil, palm rejection and Safari's own touch handling on an iPad. The tests use
  Chromium with emulated devices and pointer events marked "pen" and "touch".

## Its own site

Flipbook is also a site of its own, with no sign-in: `orbit/flipbook-site/` (the page, icons, web
manifest and an offline worker) with `orbit/src/flipbook-main.tsx`, built by `npm run build:flipbook`
(in `orbit/`) into `orbit/dist-flipbook/`. It is the same app as inside Orbit. It talks to no server:
drawings stay on the device. Add it to the iPad's home screen (Share → Add to Home Screen) and it opens
full screen with its own icon, and works offline once it has been opened. Tests:
`npm run test:flipbook-site` (`playwright.flipbook.config.ts`, `tests/flipbook-site/`).

Hosted as its own Vercel project, `flipbook`: root directory `orbit`, build command
`npm run build:flipbook`, output `dist-flipbook`, deployed from `main`.
