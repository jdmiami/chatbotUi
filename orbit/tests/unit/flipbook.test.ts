import { describe, expect, it } from 'vitest';
import {
  addStroke,
  commit,
  duplicate,
  historyOf,
  insertBlank,
  newScene,
  padLength,
  playable,
  redo,
  removeFrame,
  removeStrokes,
  sanitize,
  undo,
} from '../../src/apps/flipbook/model';
import { deskOf, onPaper, placeNote, STACK_DEPTH, visibleRange } from '../../src/apps/flipbook/layout';
import { dragFrames, lockAxis, rubber, settle, velocity } from '../../src/apps/flipbook/scrub';
import type { VStroke } from '../../src/apps/livedraw/ink/vector';

const line = (id: number): VStroke => ({ id, width: 0.01, color: '#000', points: [{ x: 0.1, y: 0.1, p: 0.5, tilt: 0 }, { x: 0.9, y: 0.9, p: 0.5, tilt: 0 }] });
const off = { on: false, count: 1 };

describe('flipbook: the pad of notes', () => {
  it('always has one blank note waiting after the last frame, which becomes a frame when drawn on', () => {
    let s = newScene();
    expect(s.frames).toHaveLength(1);
    expect(padLength(s)).toBe(2);
    s = addStroke(s, 1, line(1));
    expect(s.frames).toHaveLength(2);
    expect(s.frames[1].strokes).toHaveLength(1);
    expect(padLength(s)).toBe(3);
  });

  it('copies a note onto the next, slips in blanks, tears notes off but never the last one', () => {
    let s = addStroke(newScene(), 0, line(1));
    s = duplicate(s, 0);
    expect(s.frames).toHaveLength(2);
    expect(s.frames[1].strokes[0].points).toEqual(s.frames[0].strokes[0].points);
    expect(s.frames[1].id).not.toBe(s.frames[0].id);
    s = insertBlank(s, 1);
    expect(s.frames.map((f) => f.strokes.length)).toEqual([1, 0, 1]);
    s = removeFrame(removeFrame(removeFrame(s, 0), 0), 0);
    expect(s.frames).toHaveLength(1);
    expect(s.frames[0].strokes).toHaveLength(0);
  });

  it('erases strokes by id, and plays up to the last note with ink on it', () => {
    let s = addStroke(addStroke(newScene(), 0, line(1)), 0, line(2));
    s = removeStrokes(s, 0, new Set([1]));
    expect(s.frames[0].strokes.map((x) => x.id)).toEqual([2]);
    s = addStroke(insertBlank(insertBlank(s, 1), 1), 3, line(3));
    expect(playable(s)).toEqual([0, 1, 2, 3]);
    expect(playable(newScene())).toEqual([0]);
  });

  it('undoes and redoes whole changes', () => {
    let h = historyOf(newScene());
    h = commit(h, addStroke(h.now, 0, line(1)));
    h = commit(h, addStroke(h.now, 0, line(2)));
    h = undo(h);
    expect(h.now.frames[0].strokes).toHaveLength(1);
    h = redo(h);
    expect(h.now.frames[0].strokes).toHaveLength(2);
    h = commit(undo(h), duplicate(h.now, 0));
    expect(h.future).toHaveLength(0);
  });

  it('reads back stored scenes safely', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize({ id: 'x' })).toBeNull();
    const s = sanitize({ id: 'x', frames: [{ strokes: [line(1), { bad: true }] }], fps: 99 })!;
    expect(s.fps).toBe(12);
    expect(s.frames[0].strokes).toHaveLength(1);
    expect(s.name).toBe('My flipbook');
  });
});

describe('flipbook: the U of notes', () => {
  for (const [name, w, h] of [
    ['iPad sideways', 1194, 760],
    ['iPad upright', 834, 1080],
  ] as const) {
    describe(name, () => {
      const desk = deskOf(w, h);

      it('fits the drawing note at the bottom middle and the two stacks in the top corners, all on the desk', () => {
        expect(desk.paper.x).toBe(w / 2);
        expect(desk.paper.y + desk.size / 2).toBeLessThanOrEqual(h);
        expect(desk.paper.x - desk.size / 2).toBeGreaterThanOrEqual(0);
        const half = (desk.size * desk.k) / 2;
        // The stacks sit above the note, one each side.
        expect(desk.next.y + half).toBeLessThan(desk.paper.y - desk.size / 2);
        expect(desk.next.x).toBeLessThan(w / 2);
        expect(desk.done.x).toBeGreaterThan(w / 2);
        expect(desk.next.x - half).toBeGreaterThanOrEqual(0);
        expect(desk.done.x + half).toBeLessThanOrEqual(w);
      });

      it('puts the note in the middle at full size, next notes on the left arm, done notes on the right', () => {
        const here = placeNote(5, 5, desk, off);
        expect(here).toMatchObject({ x: desk.paper.x, y: desk.paper.y, s: 1 });
        const next = placeNote(7, 5, desk, off);
        const done = placeNote(3, 5, desk, off);
        expect(next.x).toBeLessThan(desk.paper.x);
        expect(done.x).toBeGreaterThan(desk.paper.x);
        // On the way up: higher than the middle, smaller, flapping.
        expect(next.y).toBeLessThan(desk.paper.y);
        expect(next.s).toBeLessThan(1);
        expect(Math.abs(next.ry)).toBeGreaterThan(1);
        // The note nearest the middle is on top.
        expect(here.z).toBeGreaterThan(next.z);
        expect(here.z).toBeGreaterThan(done.z);
      });

      it('lands far notes in the stacks, hiding the ones deep underneath', () => {
        const top = placeNote(20, 5, desk, off);
        expect(top.s).toBeCloseTo(desk.k);
        expect(Math.hypot(top.x - desk.next.x, top.y - desk.next.y)).toBeLessThan(desk.size * 0.2);
        expect(top.o).toBe(0);
        expect(placeNote(9, 5, desk, off).o).toBe(1);
        const [lo, hi] = visibleRange(30, 100, off);
        expect(lo).toBeGreaterThan(0);
        expect(hi - lo).toBeLessThan(2 * (3 + STACK_DEPTH + 2) + 1);
      });

      it('part way through a turn, the note you were on is lifted by its bottom edge, still over the middle', () => {
        const lifted = placeNote(5, 5.3, desk, off);
        expect(lifted.rx).toBeLessThan(-10);
        expect(Math.abs(lifted.x - desk.paper.x)).toBeLessThan(1);
        expect(lifted.z).toBeGreaterThan(placeNote(6, 5.3, desk, off).z);
        // By half a turn the next note has slid in under it.
        const under = placeNote(6, 5.5, desk, off);
        expect(Math.abs(under.x - desk.paper.x)).toBeLessThan(desk.size * 0.05);
      });

      it('onion view lays the notes either side flat as cards, next on the left and done on the right', () => {
        const on = { on: true, count: 2 };
        const next = placeNote(6, 5, desk, on);
        const done = placeNote(4, 5, desk, on);
        expect(next).toMatchObject({ rx: 0, ry: 0 });
        if (desk.cardsBeside) {
          expect(next.x).toBeLessThan(desk.paper.x - desk.size / 2 + 1);
          expect(done.x).toBeGreaterThan(desk.paper.x + desk.size / 2 - 1);
        } else {
          // Upright there is no room beside the note: the cards sit above it, in the stacks' corners.
          expect(next.x).toBeLessThan(desk.paper.x);
          expect(done.x).toBeGreaterThan(desk.paper.x);
          expect(next.y + (desk.size * next.s) / 2).toBeLessThan(desk.paper.y - desk.size / 2);
        }
        expect(next.s).toBeCloseTo(desk.cardK);
        // Mid-move the cards float between their spots (no flapping).
        const mid = placeNote(6, 5.5, desk, on);
        expect(mid.rx).toBe(0);
      });

      it('knows where the drawing note is', () => {
        expect(onPaper(desk, desk.paper.x, desk.paper.y)).toBe(true);
        expect(onPaper(desk, 4, 4)).toBe(false);
      });
    });
  }
});

describe('flipbook: turning notes with a thumb', () => {
  it('turns forward when the thumb moves up or right', () => {
    expect(dragFrames(0, -100, 'y', 100)).toBe(1);
    expect(dragFrames(100, 0, 'x', 100)).toBe(1);
    expect(dragFrames(0, 50, 'y', 100)).toBe(-0.5);
    expect(lockAxis(3, 2)).toBeNull();
    expect(lockAxis(2, 20)).toBe('y');
  });

  it('springs a half-lifted page back to the note you were on, and keeps whole pages turned', () => {
    expect(settle(4, 4.7, 0.5, 20)).toBe(4);
    expect(settle(4, 3.4, -0.5, 20)).toBe(4);
    expect(settle(4, 6.6, 0.2, 20)).toBe(6);
    // Back past two whole notes and part of a third: the part springs back.
    expect(settle(4, 1.2, 0, 20)).toBe(2);
  });

  it('a flick turns at least one more page; the pad stops at both ends', () => {
    expect(settle(4, 4.2, 6, 20)).toBe(5);
    expect(settle(4, 3.8, -6, 20)).toBe(3);
    expect(settle(4, 4.2, 40, 20)).toBeGreaterThan(5);
    expect(settle(0, -0.3, -8, 20)).toBe(0);
    expect(settle(19, 19.4, 8, 20)).toBe(20);
    expect(settle(20, 20.3, 8, 20)).toBe(20);
    expect(rubber(-5, 10)).toBeGreaterThan(-0.35);
    expect(rubber(15, 10)).toBeLessThan(10.35);
    expect(rubber(4, 10)).toBe(4);
  });

  it('measures the speed over the last tenth of a second', () => {
    expect(velocity([{ t: 0, p: 0 }])).toBe(0);
    expect(velocity([{ t: 0, p: 0 }, { t: 500, p: 0 }, { t: 550, p: 0.5 }, { t: 600, p: 1 }])).toBeCloseTo(10);
  });
});

import { coast, cornerSpeed, riffling, KEEP_PLAYING, COAST_LAND } from '../../src/apps/flipbook/scrub';

describe('flipbook: riffling and the bending paper', () => {
  it('riffles when the thumb is fast or has moved the pad past 3 notes', () => {
    expect(riffling(2, 1)).toBe(false);
    expect(riffling(8, 0.5)).toBe(true);
    expect(riffling(-8, -0.5)).toBe(true);
    expect(riffling(1, 3.5)).toBe(true);
  });

  it('let go mid-riffle, it keeps going and slows down until it lands', () => {
    let s = { pos: 0, v: 15 };
    let t = 0;
    while (Math.abs(s.v) >= COAST_LAND && t < 5) {
      s = coast(s.pos, s.v, 1 / 60);
      t += 1 / 60;
    }
    expect(s.pos).toBeGreaterThan(3);
    expect(t).toBeLessThan(2);
    expect(KEEP_PLAYING).toBeGreaterThan(COAST_LAND);
  });

  it('the corner handle: no push, no riffle; more push, faster', () => {
    expect(cornerSpeed(0, 100)).toBe(0);
    expect(cornerSpeed(50, 100)).toBeGreaterThan(0);
    expect(cornerSpeed(200, 100)).toBeGreaterThan(cornerSpeed(50, 100));
    expect(cornerSpeed(-200, 100)).toBeLessThan(0);
    expect(cornerSpeed(10000, 100)).toBeLessThanOrEqual(48);
  });

  it('a note being lifted curls strongly from its bottom edge; notes at rest up the arms lie nearly flat', () => {
    const desk = deskOf(1194, 760);
    const lifting = placeNote(5, 5.4, desk, off).paper!;
    expect(lifting.bend).toBeGreaterThan(1);
    expect(lifting.twist).toBeGreaterThan(0);
    for (const i of [3, 4, 6, 7]) expect(Math.abs(placeNote(i, 5, desk, off).paper!.bend)).toBeLessThan(0.4);
    expect(placeNote(5, 5, desk, off).paper).toMatchObject({ bend: 0, rx: 0 });
    expect(placeNote(20, 5, desk, off).paper!.bend).toBe(0);
  });
});
