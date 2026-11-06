import { describe, expect, it } from 'vitest';
import { drag, grab, place, restPose, skeleton } from '../../src/apps/flipbook/rig';
import { figure, isDone, newCharacter, progress, setLevel, setLook, setPart, steps, strokesToBone, STANDING } from '../../src/apps/flipbook/character';
import { addCast, newScene, poseAt, removeCast, setPose, duplicate, playable, sanitize } from '../../src/apps/flipbook/model';
import type { VStroke } from '../../src/apps/livedraw/ink/vector';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) < eps;

describe('flipbook rig: the skeleton', () => {
  it('has 15 parts at Simple, 19 at Detailed (neck, shoulders, belly) and 51 at Full (finger joints, toes)', () => {
    expect(skeleton('simple')).toHaveLength(15);
    const detailed = skeleton('detailed').map((b) => b.id);
    expect(detailed).toHaveLength(19);
    expect(detailed).toEqual(expect.arrayContaining(['neck', 'shoulderL', 'shoulderR', 'belly']));
    const full = skeleton('full').map((b) => b.id);
    expect(full).toHaveLength(51);
    expect(full.filter((id) => id.startsWith('finger'))).toHaveLength(30);
    expect(full).toEqual(expect.arrayContaining(['toesL', 'toesR']));
    // Parents always come first.
    for (const level of ['simple', 'detailed', 'full'] as const) {
      const seen = new Set<string>();
      for (const b of skeleton(level)) {
        if (b.parent) expect(seen.has(b.parent)).toBe(true);
        seen.add(b.id);
      }
    }
  });

  it('stands upright on the note: head on top, feet at the bottom, arms either side, all on the note', () => {
    for (const level of ['simple', 'detailed', 'full'] as const) {
      const p = place(skeleton(level), restPose());
      const head = p.get('head')!;
      expect(head.e.y).toBeLessThan(p.get('hips')!.o.y);
      expect(p.get('footL')!.o.y).toBeGreaterThan(p.get('hips')!.o.y);
      expect(p.get('handL')!.e.x).toBeLessThan(0.5);
      expect(p.get('handR')!.e.x).toBeGreaterThan(0.5);
      for (const b of p.values()) for (const pt of [b.o, b.e]) {
        expect(pt.x).toBeGreaterThan(0.05);
        expect(pt.x).toBeLessThan(0.95);
        expect(pt.y).toBeGreaterThan(0.05);
        expect(pt.y).toBeLessThan(0.95);
      }
    }
  });

  it('dragging the hips moves the whole figure; dragging a bone end turns just that bone and what hangs from it', () => {
    const bones = skeleton('simple');
    const rest = restPose();
    const moved = place(bones, drag(bones, rest, 'move', { x: 0.3, y: 0.6 }));
    expect(near(moved.get('hips')!.o, { x: 0.3, y: 0.6 })).toBe(true);
    // Turn the head to point right.
    const before = place(bones, rest);
    const neckTop = before.get('head')!.o;
    const p = place(bones, drag(bones, rest, 'head', { x: neckTop.x + 1, y: neckTop.y }));
    expect(p.get('head')!.e.x).toBeGreaterThan(neckTop.x + 0.08);
    expect(near(p.get('chest')!.e, before.get('chest')!.e)).toBe(true);
  });

  it('dragging a hand or foot reaches for the point, bending the elbow or knee and keeping its bend side', () => {
    const bones = skeleton('detailed');
    const rest = restPose();
    const placed = place(bones, rest);
    const shoulder = placed.get('upperArmR')!.o;
    const target = { x: shoulder.x + 0.12, y: shoulder.y - 0.05 };
    const pose = drag(bones, rest, 'forearmR', target);
    const after = place(bones, pose);
    expect(near(after.get('forearmR')!.e, target, 1e-6)).toBe(true);
    // Bone lengths never change.
    expect(Math.hypot(after.get('upperArmR')!.e.x - shoulder.x, after.get('upperArmR')!.e.y - shoulder.y)).toBeCloseTo(0.11 * 1.25);
    // Out of reach: the arm points straight at it.
    const far = place(bones, drag(bones, rest, 'forearmR', { x: 0.99, y: shoulder.y }));
    expect(far.get('forearmR')!.e.y).toBeCloseTo(shoulder.y, 2);
    // The elbow stays on the side it bent before.
    const sign = (q: typeof pose) => Math.sign(q.angles.forearmR ?? 0);
    expect(sign(pose)).toBe(Math.sign(bones.find((b) => b.id === 'forearmR')!.rest));
  });

  it('grabs the nearest handle, and nothing when too far', () => {
    const p = place(skeleton('simple'), restPose());
    expect(grab(p, p.get('handR')!.e, 0.02)?.id).toBe('handR');
    expect(grab(p, { x: p.get('hips')!.o.x, y: p.get('hips')!.o.y }, 0.02)?.id).toBe('move');
    expect(grab(p, { x: 0.02, y: 0.02 }, 0.02)).toBeNull();
  });
});

describe('flipbook rig: a character', () => {
  const line = (pts: [number, number][]): VStroke => ({ id: 1, width: 0.01, color: '#000', points: pts.map(([x, y]) => ({ x, y, p: 0.5, tilt: 0 })) });

  it('walks through every part head first, then the face; counts what is drawn', () => {
    const s = steps('simple');
    expect(s[0]).toMatchObject({ kind: 'part', bone: 'head' });
    expect(s.filter((x) => x.kind === 'part')).toHaveLength(15);
    expect(s.slice(-2).map((x) => x.kind)).toEqual(['eyes', 'mouth']);
    expect(steps('full').filter((x) => x.kind === 'part')).toHaveLength(51);
    let c = newCharacter('Bob', 'simple');
    expect(progress(c)).toEqual({ drawn: 0, total: 15 });
    c = setPart(c, 'chest', [line([[0, 0], [0.1, 0]])]);
    expect(progress(c).drawn).toBe(1);
    expect(isDone(c, s.find((x) => x.kind === 'part' && x.bone === 'chest')!)).toBe(true);
    // Moving up a level keeps what is drawn; new parts start as sticks.
    c = setLevel(c, 'full');
    expect(progress(c)).toEqual({ drawn: 1, total: 51 });
  });

  it('a part drawn on the standing figure rides on its bone when it is posed', () => {
    const bones = skeleton('simple');
    const rest = place(bones, STANDING);
    const fore = rest.get('forearmR')!;
    // A short line drawn along the forearm, on the note.
    const drawn = line([[fore.o.x, fore.o.y], [fore.e.x, fore.e.y]]);
    let c = setPart(newCharacter('A', 'simple'), 'forearmR', strokesToBone([drawn], fore));
    const pose = drag(bones, STANDING, 'forearmR', { x: 0.75, y: 0.2 });
    const posed = place(bones, pose).get('forearmR')!;
    const fig = figure(c, pose);
    // The part's drawing is not a stick any more, and its ends follow the bone.
    const art = fig.find((s) => s.id === 1)!;
    expect(near(art.points[0], posed.o, 1e-9)).toBe(true);
    expect(near(art.points[1], posed.e, 1e-9)).toBe(true);
    // Every undrawn bone is a stick (14 of them), plus the drawn part.
    expect(fig.filter((s) => s.id === -1)).toHaveLength(14);
    // The same pose and character give the same strokes (cached for drawing the notes).
    expect(figure(c, pose)).toBe(fig);
    // Eyes ride on the head; which look shows wraps around.
    c = setLook(setLook(c, 'eyes', 0, [line([[0, 0], [0.01, 0]])]), 'eyes', 1, [line([[0, 0], [0.02, 0]])]);
    expect(figure(c, { ...pose, eyes: 3 }).length).toBe(fig.length + 1);
  });
});

describe('flipbook: characters on the notes', () => {
  it('a note without its own pose holds the one before it; copying a note copies the pose; taking a character off clears its poses', () => {
    let { scene, castId } = addCast(newScene(), 'char-1');
    expect(poseAt(scene, 0, castId)).toBeNull();
    const p = { ...restPose(), x: 0.3 };
    scene = setPose(scene, 0, castId, p);
    expect(poseAt(scene, 0, castId)).toBe(p);
    // The waiting blank note shows the same pose until it gets its own.
    expect(poseAt(scene, 1, castId)).toBe(p);
    scene = setPose(scene, 1, castId, { ...p, x: 0.4 });
    expect(scene.frames).toHaveLength(2);
    expect(playable(scene)).toEqual([0, 1]);
    scene = duplicate(scene, 1);
    expect(scene.frames[2].poses?.[castId]?.x).toBe(0.4);
    // Stored and read back.
    const back = sanitize(JSON.parse(JSON.stringify(scene)))!;
    expect(back.cast).toEqual(scene.cast);
    expect(back.frames[1].poses?.[castId]?.x).toBe(0.4);
    scene = removeCast(scene, castId);
    expect(scene.cast).toEqual([]);
    expect(scene.frames.every((f) => !f.poses?.[castId])).toBe(true);
  });
});
