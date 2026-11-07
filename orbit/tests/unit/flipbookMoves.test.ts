import { describe, expect, it } from 'vitest';
import pack from '../../src/apps/flipbook/moves/actionPack.json';
import { applyMove, fit, GROUPS, jointsAt, notesFor, seconds, type Pack } from '../../src/apps/flipbook/moves/moves';
import { place, restPose, skeleton } from '../../src/apps/flipbook/rig';
import { addCast, newScene, poseAt } from '../../src/apps/flipbook/model';

const P = pack as unknown as Pack;
const move = (id: string) => P.moves.find((m) => m.id === id)!;

describe('flipbook: the Action Pack', () => {
  it('has dramatic moves in every group, each recorded at 12 frames a second, credited', () => {
    expect(P.moves.length).toBeGreaterThanOrEqual(25);
    for (const g of GROUPS) expect(P.moves.some((m) => m.group === g)).toBe(true);
    for (const m of P.moves) {
      expect(m.fps).toBe(12);
      expect(m.frames.length).toBeGreaterThan(10);
      expect(m.frames[0]).toHaveLength(P.joints.length * 2);
      expect(m.source).toMatch(/^CMU \d+_\d+$/);
    }
    expect(P.about).toMatch(/CMU Graphics Lab Motion Capture Database/);
  });

  it('a backflip turns the figure upside down part way through, and lands on its feet', () => {
    const m = move('backflip');
    const bones = skeleton('detailed');
    let upsideDown = false;
    for (let t = 0; t <= seconds(m); t += 1 / 12) {
      const placed = place(bones, fit(bones, 'detailed', jointsAt(P, m, t)));
      const head = placed.get('head')!.e;
      const feet = Math.min(placed.get('footL')!.o.y, placed.get('footR')!.o.y);
      if (head.y > feet) upsideDown = true;
    }
    expect(upsideDown).toBe(true);
    const end = place(bones, fit(bones, 'detailed', jointsAt(P, m, seconds(m))));
    expect(end.get('head')!.e.y).toBeLessThan(end.get('footL')!.o.y);
  });

  it('fitting never changes bone lengths, at every level', () => {
    for (const level of ['simple', 'detailed', 'full'] as const) {
      const bones = skeleton(level);
      const placed = place(bones, fit(bones, level, jointsAt(P, move('jump-kick'), 1)));
      for (const p of placed.values()) expect(Math.hypot(p.e.x - p.o.x, p.e.y - p.o.y)).toBeCloseTo(p.bone.len, 6);
    }
  });

  it('puts a move on the notes from the one you are on, at the flipbook speed, starting where the character stands', () => {
    const { scene, castId } = addCast(newScene(), 'c');
    const m = move('cartwheel');
    const standing = { ...restPose(), x: 0.4 };
    const { scene: s, notes } = applyMove(scene, castId, 'simple', P, m, { from: 2, fps: 12, speed: 1, mirror: false, inPlace: true, standing });
    expect(notes).toBe(notesFor(m, 12, 1));
    expect(s.frames.length).toBe(2 + notes);
    expect(poseAt(s, 1, castId)).toBeNull();
    for (let k = 2; k < 2 + notes; k++) expect(poseAt(s, k, castId)!.x).toBeCloseTo(0.4, 6);
    // Slow motion takes twice the notes.
    expect(notesFor(m, 12, 0.5)).toBeGreaterThan(notes * 1.8);
    // Mirrored: the first pose's arms swap sides.
    const plain = fit(skeleton('simple'), 'simple', jointsAt(P, m, 1));
    const flipped = fit(skeleton('simple'), 'simple', jointsAt(P, m, 1), { mirror: true });
    const pl = place(skeleton('simple'), plain).get('handL')!.e.x;
    const fr = place(skeleton('simple'), flipped).get('handR')!.e.x;
    expect(pl + fr).toBeCloseTo(2 * plain.x, 1);
  });
});
