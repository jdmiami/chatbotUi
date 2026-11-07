# Flipbook: the big plan

The owner's choices from the questionnaire (6 November 2026), and the rounds that build them.
Everything runs on the iPad itself: no paid machines.

## The owner's choices

**Paper and feel**
- Paper: a picker in each flipbook (sticky note, sketch paper, lined, grid, dark).
- Riffle: starts when you move fast **or** drag past 3 notes; the corner is a riffle handle too.
- Sound: soft paper sounds, on, with a switch.
- Extras: light moves with the iPad's tilt, paper grain and worn edges, a soft landing wobble. (No motion blur.)

**Menus and help**
- Home: a shelf of pads, each playing its animation when pressed.
- Main menu: a menu bar along the top (File, Edit, View, Frame, Character, Play, Window, Help).
- Views: timeline, light table, full-screen preview, camera view.
- Help: guided tour, gesture card, and iPad gesture shortcuts (two-finger tap undo, three-finger tap redo, and more).

**Drawing**
- Shapes: basic shapes, draw-and-hold to snap, action effects (speed lines, impact, explosion, aura, fire,
  lightning, dust, swoosh), speech and thought bubbles.
- Mirror: left-right, up-down, around a centre (3 to 12 copies), flip a pose.
- Layers: as many as you like on each note, plus a shared background.
- Brushes: 5 favourites up front, Live Draw's whole library one tap away.

**Faces, parts and forms**
- Ready-made faces in two styles: simple cartoon and anime.
- Emotion wheel per note, eyes and mouth picked separately, automatic blink, talking mouth.
- Mouth tracking: record yourself talking with the camera; the face tracking (on the iPad, nothing sent
  anywhere) drives the character's mouth, as its own track you can add to the animation or leave off.
- Forms (transformations) per note, with switchable effects: flash, glow aura, sparks, screen shake.
- A form can change the body's size and shape, smoothly.

**Motion**
- In-betweens: automatic, with easing (slow in, slow out, bounce), each one fixable by hand.
- Motion paths, squash and stretch, trails, camera (pan, zoom, turn, shake).
- Up to 4 characters per flipbook.

## Rounds

1. **Real paper and riffle** — paper rendered on the graphics chip: each note a fine mesh that bends
   (lifted from its bottom edge, corner first), lit with a sheen along the bend, a darker back, shadows on the
   desk, grain and worn edges, light following the iPad's tilt, a soft landing wobble, paper sounds, the
   paper picker; riffle when fast or past 3 notes, coasting after you let go, a hard flick keeps playing,
   and the corner riffle handle. The flat version stays for Reduce Motion.
2. **Home and menus** — the shelf, the menu bar, files and versions, start over, the views (timeline,
   light table, full-screen preview), the guided tour, gesture card and gesture shortcuts.
3. **Drawing tools** — brushes, shapes, snap, action effects, bubbles, mirrors, layers, select and move.
4. **Faces and parts** — the two face sets, the emotion wheel, blink, talking mouth, mouth tracking,
   part stamps and part looks.
5. **Forms** — transformations per note with their effects, and body size changes.
6. **Motion** — the ready-made moves, in-betweens, motion paths, squash and stretch, trails, camera, up
   to 4 characters.
7. **Backup and export** — account backup, the iPhone viewer, video, GIF, frames, sprite sheet, project file.

## Done so far

- Round 1, real paper and riffle: built (#162).
- Owner asked next (7 November): visible Save, Clear and Edit, and dramatic action moves from an outside source.
  - **Menu bar** along the top: File (new, open, save, save a version, versions, rename, make a copy,
    start over, delete), Edit (undo, redo, copy, paste, wipe, tear off, slip in), View (onion, paper,
    full-screen preview), Frame, Character (action moves, characters, pose, draw parts), Play (play, preview,
    speed), Help (gestures and shortcuts). Two-finger tap undoes, three-finger tap redoes.
  - **Action Pack**: 28 recorded moves from the CMU Graphics Lab Motion Capture Database (free for
    research and commercial projects): backflips, monkey flip, front handspring, side flip, cartwheels, jump,
    spin and flying kicks, kick flip, handstand kicks, front kick, punch combo, boxing, dive roll, falls,
    360 jump, jump twist, long and high jump, run and walk. `orbit/scripts/mocap/cmu_to_flipbook.py`
    turns them into stick-figure joints; Flipbook fits any character's skeleton to them, one pose per note,
    at real speed, slow motion or fast, mirrored or not, travelling or in the middle.
