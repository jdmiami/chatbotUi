import { describe, expect, it } from 'vitest';
import { bezierY, dynamic, rng, speedOf, taperAt, term } from '../../src/apps/livedraw/brushes/dynamics';
import { DabWalker, MIN_STEP, dabBounds, dabsFor, strokeLength } from '../../src/apps/livedraw/brushes/dabs';
import { BASE, PRESETS, presetById } from '../../src/apps/livedraw/brushes/presets';
import { FILE_KIND, brushFromJson, brushToJson, duplicateBrush, normalizeBrush, pushRecent, upsert } from '../../src/apps/livedraw/brushes/library';
import type { Brush } from '../../src/apps/livedraw/brushes/types';
import type { Pt } from '../../src/apps/livedraw/canvas/sketch';
import { Stabilizer, pullString, streamline, streamlineK } from '../../src/apps/livedraw/ink/stabilizer';
import { adjustShape, circleThrough, heldStill, recognize, shapePoints } from '../../src/apps/livedraw/ink/quickshape';
import { hitPoint, hitStroke, moveStroke, sampleCurve, simplify, toVector } from '../../src/apps/livedraw/ink/vector';
import { NO_PERSPECTIVE, PerspectiveSnap, activeVps, gridLines, pickDirection, projectOnto, snapDirections, type Perspective } from '../../src/apps/livedraw/guides/perspective';
import { NO_SYMMETRY, applyMat, mirrorDabs, symmetryAxes, symmetryMats, type Symmetry } from '../../src/apps/livedraw/guides/symmetry';
import { BLEND_MODES, StudioDoc, addLayer, addOp, clipBase, duplicateLayer, initialState, layerCap, makeLayer, mergeDown, moveLayer, patchLayer, removeLayer, type StrokeOp } from '../../src/apps/livedraw/layers/model';
import { hasRoleInk, lineTool, machineLines, strokeCount } from '../../src/apps/livedraw/layers/machine';
import { CANVAS_OP, GL_BLEND, PSD_BLEND, blendRgb, composite, flattenStack, type RGBA } from '../../src/apps/livedraw/engine/blend';
import { cachedTip, fbm, grainAlpha, roundAlpha, tipAlpha } from '../../src/apps/livedraw/engine/textures';
import { FIT, fromPaper, lerpView, pinchView, settleView, tapAction, toPaper, zoomAbout } from '../../src/apps/livedraw/ui/gestures';
import { harmony, hexToHsv, hsvToHex, isHex, normHex, pushRecentColour } from '../../src/apps/livedraw/ui/color';

const pt = (x: number, y: number, p = 0.5, tilt = 0, t?: number): Pt => ({ x, y, p, tilt, ...(t !== undefined ? { t } : {}) });
const line = (n: number, x0 = 0.1, x1 = 0.9, y = 0.5, p = 0.5): Pt[] => Array.from({ length: n }, (_, i) => pt(x0 + ((x1 - x0) * i) / (n - 1), y, p));
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('brush dynamics', () => {
  it('the pressure curve: linear on the diagonal, bends with its handles, stays in 0..1', () => {
    for (const x of [0, 0.25, 0.5, 1]) expect(bezierY([0.33, 0.33, 0.67, 0.67], x)).toBeCloseTo(x, 5);
    const soft = bezierY([0.1, 0.6, 0.4, 1], 0.3);
    const firm = bezierY([0.6, 0, 0.9, 0.4], 0.3);
    expect(soft).toBeGreaterThan(0.3);
    expect(firm).toBeLessThan(0.3);
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const y = bezierY([0.4, 0.1, 0.6, 0.9], i / 20);
      expect(y).toBeGreaterThanOrEqual(last - 1e-6);
      last = y;
    }
    expect(bezierY([0.4, 0.1, 0.6, 0.9], 2)).toBe(1);
  });

  it('a positive amount grows with the input, a negative one shrinks, zero ignores it; they multiply', () => {
    expect(term(0, 0.2)).toBe(1);
    expect(term(0.8, 0)).toBeCloseTo(0.2);
    expect(term(0.8, 1)).toBe(1);
    expect(term(-0.5, 1)).toBe(0.5);
    expect(term(-0.5, 0)).toBe(1);
    expect(dynamic({ pressure: 1, tilt: -1, speed: 0 }, 0.5, 0.5, 1)).toBeCloseTo(0.25);
    expect(speedOf(0.3, 100)).toBeCloseTo(1);
    expect(speedOf(0.03, 100)).toBeCloseTo(0.1);
    expect(speedOf(0.1, 0)).toBe(0);
  });

  it('seeded randomness repeats; tapers thin both ends', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(1)()).not.toBe(rng(2)());
    expect(taperAt(0, 1, 0.1, 0.1)).toBeLessThan(0.2);
    expect(taperAt(0.5, 1, 0.1, 0.1)).toBe(1);
    expect(taperAt(0.999, 1, 0.1, 0.1)).toBeLessThan(0.2);
    expect(taperAt(0.999, null, 0.1, 0.1)).toBe(1);
  });
});

describe('the stamp engine (dabs)', () => {
  const pen: Brush = { ...BASE, spacing: 0.1 };

  it('lays dabs every spacing × diameter along the stroke', () => {
    const dabs = dabsFor(pen, 0.01, 1, line(40));
    // 0.8 long, a dab every 0.001.
    expect(dabs.length).toBeGreaterThan(780);
    expect(dabs.length).toBeLessThan(820);
    for (let i = 1; i < dabs.length; i++) expect(dabs[i].x - dabs[i - 1].x).toBeCloseTo(0.001, 5);
    expect(dabs.every((d) => d.size === 0.01 && d.alpha === 1)).toBe(true);
    // Never closer than MIN_STEP, however small the brush.
    const tiny = dabsFor({ ...pen, spacing: 0.01 }, 0.001, 1, line(10));
    expect(tiny.length).toBeLessThanOrEqual(Math.ceil(0.8 / MIN_STEP) + 2);
  });

  it('walking point by point gives the same dabs as walking the whole stroke at once (same seed)', () => {
    const b: Brush = { ...pen, jitter: { size: 0.4, opacity: 0.3, angle: 0.5, scatter: 0.6 } };
    const pts = line(30).map((p, i) => ({ ...p, p: 0.2 + 0.6 * Math.sin(i / 5) ** 2 }));
    const whole = new DabWalker(b, 0.02, 7).feed(pts);
    const w = new DabWalker(b, 0.02, 7);
    const parts = [];
    for (let i = 1; i <= pts.length; i++) parts.push(...w.feed(pts.slice(0, i)));
    expect(parts).toEqual(whole);
    expect(new DabWalker(b, 0.02, 8).feed(pts)).not.toEqual(whole);
  });

  it('pressure, tilt and speed drive size and flow; a clone walks ahead without moving the original', () => {
    const b: Brush = { ...pen, dynamics: { ...pen.dynamics, size: { pressure: 1, tilt: 0, speed: 0 }, flow: { pressure: 0, tilt: 0, speed: -1 } }, tiltSpread: 3 };
    const light = dabsFor(b, 0.02, 1, line(5, 0.1, 0.5, 0.5, 0.2));
    const hard = dabsFor(b, 0.02, 1, line(5, 0.1, 0.5, 0.5, 1));
    expect(hard[3].size).toBeGreaterThan(light[3].size * 3);
    const flat = dabsFor(b, 0.02, 1, line(5, 0.1, 0.5, 0.5, 1).map((p) => ({ ...p, tilt: 1 })));
    expect(flat[3].size).toBeCloseTo(hard[3].size * 4, 6);
    // Fast strokes lay thinner paint with a negative speed amount.
    const slow = dabsFor(b, 0.02, 1, line(5).map((p, i) => ({ ...p, t: i * 1000 })));
    const fast = dabsFor(b, 0.02, 1, line(5).map((p, i) => ({ ...p, t: i * 10 })));
    expect(fast[fast.length - 1].alpha).toBeLessThan(slow[slow.length - 1].alpha);
    const w = new DabWalker(b, 0.02, 3);
    const pts = line(6);
    const first = w.feed(pts.slice(0, 3));
    const ahead = w.clone().feed(pts);
    const rest = w.feed(pts);
    expect(ahead).toEqual(rest);
    expect(first.length).toBeGreaterThan(0);
  });

  it('tapers ends when the length is known; count stamps several scattered dabs per step', () => {
    const ink = presetById('ink-pen')!;
    const dabs = dabsFor(ink, 0.02, 1, line(20, 0.1, 0.6, 0.5, 1));
    const mid = dabs[Math.floor(dabs.length / 2)].size;
    expect(dabs[0].size).toBeLessThan(mid * 0.5);
    expect(dabs[dabs.length - 1].size).toBeLessThan(mid * 0.5);
    const spray = presetById('spray')!;
    const sd = dabsFor(spray, 0.01, 1, line(2, 0.5, 0.52));
    expect(sd.length % spray.count).toBe(0);
    const b = dabBounds(sd)!;
    expect(b.y1 - b.y0).toBeGreaterThan(0.004);
    expect(strokeLength(line(3, 0, 1))).toBeCloseTo(1);
  });

  it('every built-in brush draws, has a unique id and a group', () => {
    const ids = new Set(PRESETS.map((b) => b.id));
    expect(ids.size).toBe(PRESETS.length);
    for (const name of ['Technical pen', 'Ink pen', 'Pencil HB', 'Pencil 6B', 'Charcoal', 'Marker', 'Gouache', 'Soft airbrush', 'Hard airbrush', 'Spray', 'Textured eraser', 'Blend']) expect(PRESETS.some((b) => b.name === name)).toBe(true);
    for (const b of PRESETS) {
      expect(dabsFor(b, b.size, 1, line(10)).length).toBeGreaterThan(0);
      expect(normalizeBrush(b)).toMatchObject({ id: b.id, mode: b.mode, shape: b.shape });
    }
  });
});

describe('brush files and your library', () => {
  it('a brush goes out as JSON and comes back the same (with a fresh id, in Mine)', () => {
    const b = presetById('charcoal')!;
    const json = brushToJson(b);
    expect(JSON.parse(json).kind).toBe(FILE_KIND);
    expect(json).not.toContain('builtin');
    const back = brushFromJson(json);
    if (!('brush' in back)) throw new Error('not read');
    expect(back.brush.id).not.toBe(b.id);
    expect(back.brush.group).toBe('Mine');
    const { id: _a, group: _g, builtin: _b, ...rest } = b;
    const { id: _c, group: _h, ...got } = back.brush;
    expect(got).toEqual(rest);
  });

  it('a bad file fails in words; odd values are clamped, unknown fields dropped, a bare brush object works', () => {
    expect(brushFromJson('not json')).toEqual({ error: expect.stringContaining('isn’t a brush') });
    expect(brushFromJson('{"kind":"x"}')).toEqual({ error: expect.any(String) });
    const n = normalizeBrush({ name: '  Wild ', size: 99, flow: -3, shape: 'banana', count: 1000, evil: '<script>', dynamics: { size: { pressure: 7 } }, pressureCurve: [2, -1, 0.5] });
    expect(n).toMatchObject({ name: 'Wild', size: 0.5, flow: 0.005, shape: 'round', count: 32 });
    expect(n!.dynamics.size.pressure).toBe(1);
    expect(n!.pressureCurve).toEqual(BASE.pressureCurve);
    expect(n).not.toHaveProperty('evil');
    expect(normalizeBrush({ size: 0.1 })).toBeNull();
    const plain = brushFromJson(JSON.stringify({ name: 'Plain', size: 0.02 }));
    expect('brush' in plain && plain.brush.size).toBe(0.02);
  });

  it('duplicate, upsert and the recent list', () => {
    const d = duplicateBrush(presetById('marker')!);
    expect(d.name).toBe('Marker copy');
    expect(d.builtin).toBeUndefined();
    expect(upsert([d], { ...d, name: 'Mine' })).toEqual([{ ...d, name: 'Mine' }]);
    expect(upsert([], d)).toEqual([d]);
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
  });
});

describe('steady lines (stabilizer)', () => {
  it('streamline moves part of the way; 0 is raw', () => {
    expect(streamlineK(0)).toBe(1);
    expect(streamlineK(1)).toBeCloseTo(0.15);
    expect(streamline(pt(0, 0), pt(1, 0), 0).x).toBe(1);
    expect(streamline(pt(0, 0), pt(1, 0), 1).x).toBeCloseTo(0.15);
    expect(streamline(null, pt(1, 0), 1).x).toBe(1);
  });

  it('the pulled string: nothing moves inside its reach, then the line trails exactly a string behind', () => {
    expect(pullString(pt(0, 0), pt(0.05, 0), 0.1)).toBeNull();
    const p = pullString(pt(0, 0), pt(0.3, 0.4), 0.1)!;
    expect(Math.hypot(0.3 - p.x, 0.4 - p.y)).toBeCloseTo(0.1);
    expect(p.y / p.x).toBeCloseTo(0.4 / 0.3);
    const s = new Stabilizer(0.1, 0);
    expect(s.push(pt(0.5, 0.5))).toHaveLength(1);
    expect(s.push(pt(0.55, 0.52))).toEqual([]); // a wobble inside the string
    const out = s.push(pt(0.8, 0.5));
    expect(out).toHaveLength(1);
    expect(Math.hypot(0.8 - out[0].x, 0.5 - out[0].y)).toBeCloseTo(0.1);
    // Peeking ahead leaves it where it was; with a string the line ends at the brush, not the pen.
    expect(s.peek([pt(0.95, 0.5)])).toHaveLength(1);
    expect(s.anchor!.x).toBeCloseTo(out[0].x);
    expect(s.finish(pt(0.8, 0.5))).toEqual([]);
    const plain = new Stabilizer(0, 0.5);
    plain.push(pt(0, 0));
    plain.push(pt(1, 0));
    expect(plain.finish(pt(1, 0))).toEqual([pt(1, 0)]);
  });
});

describe('shape snapping', () => {
  const wobble = (n: number, f: (t: number) => [number, number]) => Array.from({ length: n }, (_, i) => {
    const [x, y] = f(i / (n - 1));
    return { x: x + Math.sin(i * 1.7) * 0.002, y: y + Math.cos(i * 2.3) * 0.002 };
  });

  it('a rough line, arc, circle, ellipse and box become the clean shape; a scribble stays as drawn', () => {
    const l = recognize(wobble(40, (t) => [0.1 + 0.6 * t, 0.2 + 0.3 * t]));
    expect(l?.kind).toBe('line');
    const arc = recognize(wobble(50, (t) => [0.5 + 0.3 * Math.cos(Math.PI * t), 0.5 - 0.3 * Math.sin(Math.PI * t)]));
    expect(arc).toMatchObject({ kind: 'arc' });
    if (arc?.kind === 'arc') {
      expect(arc.r).toBeCloseTo(0.3, 1);
      expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI, 0);
    }
    const circle = recognize(wobble(80, (t) => [0.5 + 0.2 * Math.cos(2 * Math.PI * t), 0.5 + 0.2 * Math.sin(2 * Math.PI * t)]));
    expect(circle).toMatchObject({ kind: 'ellipse' });
    if (circle?.kind === 'ellipse') {
      expect(circle.rx).toBe(circle.ry);
      expect(circle.cx).toBeCloseTo(0.5, 1);
    }
    const ell = recognize(wobble(80, (t) => [0.5 + 0.3 * Math.cos(2 * Math.PI * t), 0.5 + 0.12 * Math.sin(2 * Math.PI * t)]));
    expect(ell?.kind).toBe('ellipse');
    if (ell?.kind === 'ellipse') expect(ell.rx / ell.ry).toBeGreaterThan(2);
    const box = [
      ...wobble(20, (t) => [0.2 + 0.5 * t, 0.2]),
      ...wobble(20, (t) => [0.7, 0.2 + 0.4 * t]),
      ...wobble(20, (t) => [0.7 - 0.5 * t, 0.6]),
      ...wobble(20, (t) => [0.2, 0.6 - 0.39 * t]),
    ];
    const r = recognize(box);
    expect(r).toMatchObject({ kind: 'rect', angle: 0 });
    if (r?.kind === 'rect') {
      expect(r.w).toBeCloseTo(0.5, 1);
      expect(r.h).toBeCloseTo(0.4, 1);
    }
    const scribble = Array.from({ length: 60 }, (_, i) => ({ x: 0.5 + 0.2 * Math.sin(i * 0.9) * Math.cos(i * 0.31), y: 0.5 + 0.2 * Math.sin(i * 0.47) }));
    expect(recognize(scribble)).toBeNull();
    expect(recognize([{ x: 0, y: 0 }])).toBeNull();
  });

  it('shapes become stroke points; holding and moving adjusts them; held-still detection', () => {
    const pts = shapePoints({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 } }, 0.7);
    expect(pts[0]).toMatchObject({ x: 0, y: 0, p: 0.7 });
    expect(pts[pts.length - 1].x).toBeCloseTo(0.5);
    const ring = shapePoints({ kind: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, angle: 0 });
    for (const p of ring) expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeCloseTo(0.2, 6);
    const rect = shapePoints({ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.4, h: 0.2, angle: 0 });
    expect(Math.min(...rect.map((p) => p.x))).toBeCloseTo(0.3);
    expect(Math.max(...rect.map((p) => p.y))).toBeCloseTo(0.6);
    expect(adjustShape({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.5 })).toMatchObject({ b: { x: 0.5, y: 0.5 } });
    expect(adjustShape({ kind: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1, angle: 0 }, { x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, { x: 1.1, y: 0.5 })).toMatchObject({ rx: expect.closeTo(0.4, 9), ry: expect.closeTo(0.2, 9) });
    expect(circleThrough({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(heldStill([{ x: 0, y: 0, t: 0 }, { x: 0.5, y: 0, t: 100 }, { x: 0.501, y: 0, t: 600 }, { x: 0.502, y: 0, t: 700 }], 500)).toBe(true);
    expect(heldStill([{ x: 0, y: 0, t: 600 }, { x: 0.1, y: 0, t: 700 }], 500)).toBe(false);
  });
});

describe('vector ink', () => {
  it('simplifies a drawn line to a few control points, draws a smooth curve through them, finds a stroke and a point', () => {
    const drawn = line(100, 0.1, 0.9, 0.5);
    const v = toVector(1, drawn, 0.01, '#000');
    expect(v.points.length).toBe(2);
    const bend = Array.from({ length: 100 }, (_, i) => pt(0.1 + i * 0.008, 0.5 + 0.2 * Math.sin(i / 16)));
    const s = simplify(bend, 0.0015);
    expect(s.length).toBeGreaterThan(4);
    expect(s.length).toBeLessThan(40);
    const curve = sampleCurve(s, 8);
    expect(curve[0]).toMatchObject({ x: s[0].x, y: s[0].y });
    expect(curve[curve.length - 1].x).toBeCloseTo(s[s.length - 1].x);
    expect(hitStroke([v], { x: 0.5, y: 0.505 }, 0.002)?.id).toBe(1);
    expect(hitStroke([v], { x: 0.5, y: 0.6 }, 0.002)).toBeNull();
    expect(hitPoint(v, { x: 0.905, y: 0.5 }, 0.02)).toBe(1);
    expect(moveStroke(v, 0.1, 0).points[0].x).toBeCloseTo(0.2);
  });
});

describe('perspective guides', () => {
  const two: Perspective = { kind: 'two', vps: [{ x: 0, y: 0.4 }, { x: 1, y: 0.4 }, { x: 0.5, y: 2 }], snap: true };

  it('offers lines toward each vanishing point (and verticals); picks the closest to how the stroke set off', () => {
    expect(activeVps(NO_PERSPECTIVE)).toEqual([]);
    expect(activeVps(two)).toHaveLength(2);
    const dirs = snapDirections(two, { x: 0.5, y: 0.6 });
    expect(dirs).toHaveLength(3);
    const toLeft = pickDirection(dirs, { x: -0.1, y: -0.035 })!;
    expect(toLeft.x).toBeLessThan(0);
    expect(toLeft.y / toLeft.x).toBeCloseTo(0.4, 5);
    expect(pickDirection(dirs, { x: 0.001, y: 0.1 })).toEqual({ x: 0, y: 1 });
    expect(projectOnto({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.3, y: 0.2 })).toEqual({ x: 0.3, y: 0 });
    expect(snapDirections({ ...two, kind: 'one' }, { x: 0.2, y: 0.2 })).toHaveLength(3);
  });

  it('a stroke holds still until it has moved, then every point slides onto the line through the start toward the point', () => {
    const snap = new PerspectiveSnap(two, { x: 0.5, y: 0.6 });
    expect(snap.apply({ x: 0.505, y: 0.6 })).toMatchObject({ x: 0.5, y: 0.6 });
    expect(snap.decided).toBe(false);
    const a = snap.apply({ x: 0.7, y: 0.52, p: 1 });
    expect(snap.decided).toBe(true);
    // On the line from the start to the right-hand point (1, 0.4).
    expect((a.y - 0.6) / (a.x - 0.5)).toBeCloseTo(-0.4, 5);
    expect(a.p).toBe(1);
    const b = snap.apply({ x: 0.9, y: 0.6 });
    expect((b.y - 0.6) / (b.x - 0.5)).toBeCloseTo(-0.4, 5);
    expect(gridLines(two).filter((l) => l.horizon)).toHaveLength(1);
    expect(gridLines({ ...two, kind: 'three' }).length).toBeGreaterThan(gridLines(two).length - 8);
  });
});

describe('symmetry', () => {
  const sym = (p: Partial<Symmetry>): Symmetry => ({ ...NO_SYMMETRY, ...p });

  it('the number of copies for each kind', () => {
    expect(symmetryMats(sym({ kind: 'off' }))).toHaveLength(1);
    expect(symmetryMats(sym({ kind: 'vertical' }))).toHaveLength(2);
    expect(symmetryMats(sym({ kind: 'quadrant' }))).toHaveLength(4);
    expect(symmetryMats(sym({ kind: 'radial', n: 6 }))).toHaveLength(12);
    expect(symmetryMats(sym({ kind: 'radial', n: 6, rotational: true }))).toHaveLength(6);
    expect(symmetryAxes(sym({ kind: 'radial', n: 5 }))).toHaveLength(5);
  });

  it('mirrors across the centre, turns about it, and turns the tip with the stroke', () => {
    const [, v] = symmetryMats(sym({ kind: 'vertical', cx: 0.4 }));
    expect(applyMat(v, { x: 0.3, y: 0.2 })).toEqual({ x: expect.closeTo(0.5, 9), y: expect.closeTo(0.2, 9) });
    const [, h] = symmetryMats(sym({ kind: 'horizontal', cy: 0.5 }));
    expect(applyMat(h, { x: 0.3, y: 0.2 }).y).toBeCloseTo(0.8);
    const [, r] = symmetryMats(sym({ kind: 'vertical', rotational: true }));
    expect(applyMat(r, { x: 0.3, y: 0.2 })).toEqual({ x: expect.closeTo(0.7, 9), y: expect.closeTo(0.8, 9) });
    const radial = symmetryMats(sym({ kind: 'radial', n: 4, rotational: true }));
    const q = applyMat(radial[1], { x: 0.7, y: 0.5 });
    expect(q.x).toBeCloseTo(0.5);
    expect(q.y).toBeCloseTo(0.7);
    const dabs = mirrorDabs([{ x: 0.3, y: 0.5, size: 0.01, alpha: 1, angle: 0, roundness: 1, r: 0 }], symmetryMats(sym({ kind: 'vertical' })));
    expect(dabs).toHaveLength(2);
    expect(dabs[1].x).toBeCloseTo(0.7);
    expect(Math.abs(dabs[1].angle)).toBeCloseTo(Math.PI);
    // Every map keeps distances (no stretching).
    for (const m of symmetryMats(sym({ kind: 'radial', n: 7 }))) {
      const a = applyMat(m, { x: 0.1, y: 0.2 });
      const b = applyMat(m, { x: 0.4, y: 0.6 });
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(0.5);
    }
  });
});

describe('blend modes and compositing order', () => {
  const red: RGBA = [1, 0, 0, 1];
  const white: RGBA = [1, 1, 1, 1];
  const black: RGBA = [0, 0, 0, 1];
  const grey: RGBA = [0.5, 0.5, 0.5, 1];

  it('the separable modes on opaque colours', () => {
    expect(composite('normal', grey, red)).toEqual(red);
    expect(composite('multiply', red, white)).toEqual(red);
    expect(composite('multiply', grey, grey)[0]).toBeCloseTo(0.25);
    expect(composite('screen', red, black)).toEqual(red);
    expect(composite('screen', grey, grey)[0]).toBeCloseTo(0.75);
    expect(composite('darken', grey, red)).toEqual([0.5, 0, 0, 1]);
    expect(composite('lighten', grey, red)).toEqual([1, 0.5, 0.5, 1]);
    expect(composite('add', grey, grey)).toEqual([1, 1, 1, 1]);
    expect(composite('difference', white, grey)[0]).toBeCloseTo(0.5);
    expect(composite('overlay', [0.2, 0.2, 0.2, 1], grey)[0]).toBeCloseTo(0.2);
    expect(composite('soft-light', grey, grey)[0]).toBeCloseTo(0.5);
    expect(composite('hard-light', grey, black)[0]).toBe(0);
    expect(composite('color-dodge', grey, black)[0]).toBeCloseTo(0.5);
    expect(composite('color-burn', grey, white)[0]).toBeCloseTo(0.5);
    expect(composite('exclusion', grey, white)[0]).toBeCloseTo(0.5);
  });

  it('colour and luminosity keep one and take the other; over transparency a mode is plain paint; alpha follows source-over', () => {
    const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const c = blendRgb('color', [0.5, 0.5, 0.5], [1, 0, 0]);
    expect(lum(c)).toBeCloseTo(0.5);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(blendRgb('luminosity', [1, 0, 0], [0.5, 0.5, 0.5]).every((v, i) => i === 0 || v > 0)).toBe(true);
    for (const v of blendRgb('saturation', [0.4, 0.4, 0.4], [1, 0, 0])) expect(v).toBeCloseTo(0.4);
    expect(composite('multiply', [0, 0, 0, 0], [0.5, 0, 0, 0.5])).toEqual([0.5, 0, 0, 0.5]);
    const half = composite('normal', [0, 0, 1, 1], [0.5, 0, 0, 0.5]);
    expect(half).toEqual([0.5, 0, 0.5, 1]);
  });

  it('order matters: the stack blends bottom first, each at its opacity', () => {
    const a = flattenStack([
      { color: red, mode: 'normal', opacity: 1 },
      { color: grey, mode: 'multiply', opacity: 1 },
    ]);
    const b = flattenStack([
      { color: grey, mode: 'normal', opacity: 1 },
      { color: red, mode: 'normal', opacity: 1 },
    ]);
    expect(a).toEqual([0.5, 0, 0, 1]);
    expect(b).toEqual(red);
    const faded = flattenStack([
      { color: white, mode: 'normal', opacity: 1 },
      { color: black, mode: 'normal', opacity: 0.25 },
    ]);
    expect(faded[0]).toBeCloseTo(0.75);
  });

  it('every mode has a GPU number, a canvas name and a PSD name', () => {
    for (const m of BLEND_MODES) {
      expect(GL_BLEND[m.id]).toBeTypeOf('number');
      expect(CANVAS_OP[m.id]).toBeTruthy();
      expect(PSD_BLEND[m.id]).toBeTruthy();
    }
    expect(new Set(Object.values(GL_BLEND)).size).toBe(BLEND_MODES.length);
  });
});

describe('layers (the drawing model)', () => {
  const op = (p: Partial<StrokeOp> = {}): StrokeOp => ({ kind: 'stroke', brush: presetById('ink-pen')!, color: '#000', size: 0.01, opacity: 1, seed: 1, points: [pt(0.1, 0.1), pt(0.2, 0.2)], ...p });

  it('starts with Colour under Sketch; new layers go above the active one; reorder, duplicate, delete', () => {
    let s = initialState();
    expect(s.layers.map((l) => l.name)).toEqual(['Colour', 'Sketch']);
    expect(s.layers.map((l) => l.role)).toEqual(['colour', 'sketch']);
    const sketch = s.layers[1].id;
    s = { ...s, activeId: s.layers[0].id };
    s = addLayer(s);
    expect(s.layers.map((l) => l.name)).toEqual(['Colour', 'Layer 3', 'Sketch']);
    expect(s.activeId).toBe(s.layers[1].id);
    s = addLayer(s, 'vector');
    expect(s.layers[2]).toMatchObject({ kind: 'vector', role: 'sketch' });
    s = moveLayer(s, sketch, 0);
    expect(s.layers[0].id).toBe(sketch);
    s = duplicateLayer(s, sketch);
    expect(s.layers[1].name).toBe('Sketch copy');
    const n = s.layers.length;
    s = removeLayer(s, s.layers[1].id);
    expect(s.layers).toHaveLength(n - 1);
    expect(removeLayer({ ...s, layers: [s.layers[0]] }, s.layers[0].id).layers).toHaveLength(1);
  });

  it('merge down keeps the lower layer’s place with the merged pixels; clipping finds its base', () => {
    let s = initialState();
    const [colour, sketch] = s.layers;
    s = addOp(s, sketch.id, op());
    const img = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
    const m = mergeDown(s, sketch.id, img);
    expect(m.layers).toHaveLength(1);
    expect(m.layers[0]).toMatchObject({ id: colour.id, name: 'Colour', ops: [{ kind: 'image', image: img }] });
    expect(mergeDown(s, colour.id, img)).toBe(s);
    const a = makeLayer({ name: 'a' });
    const b = makeLayer({ name: 'b', clip: true });
    const c = makeLayer({ name: 'c', clip: true });
    expect(clipBase([a, b, c], 2)).toBe(a);
    expect(clipBase([a, b, c], 0)).toBeNull();
    expect(moveLayer({ ...s, layers: [a, b] }, a.id, 1).layers[0].clip).toBe(false);
  });

  it('undo and redo step through states; slider drags fold into one step; picking a layer is no step', () => {
    let t = 0;
    const d = new StudioDoc(initialState(), 100, () => (t += 100));
    const id = d.state.layers[1].id;
    d.commit(addOp(d.state, id, op()));
    d.commit(patchLayer(d.state, id, { opacity: 0.9 }), 'op');
    d.commit(patchLayer(d.state, id, { opacity: 0.5 }), 'op');
    d.commit(patchLayer(d.state, id, { opacity: 0.3 }), 'op');
    expect(d.state.layers[1].opacity).toBe(0.3);
    d.setActive(d.state.layers[0].id);
    expect(d.undo()).toBe(true);
    expect(d.state.layers[1].opacity).toBe(1);
    expect(d.state.activeId).toBe(d.state.layers[0].id);
    expect(d.undo()).toBe(true);
    expect(d.state.layers[1].ops).toHaveLength(0);
    expect(d.undo()).toBe(false);
    expect(d.redo()).toBe(true);
    expect(d.state.layers[1].ops).toHaveLength(1);
    d.commit(clearLayerState(d));
    expect(d.canRedo).toBe(false);
    d.reset();
    expect(d.canUndo).toBe(false);
  });

  it('a memory-aware cap on layers', () => {
    expect(layerCap(1024, 4)).toBeGreaterThan(layerCap(2048, 4));
    expect(layerCap(2048, 0.5)).toBe(4);
    expect(layerCap(256, 64)).toBe(100);
    expect(layerCap(1536)).toBe(layerCap(1536, 4));
  });

  it('what the drawing machine reads: lines from "lines" layers (mirrored copies too), colour from "colour" layers', () => {
    let s = initialState();
    const [colour, sketch] = s.layers;
    expect(hasRoleInk(s, 'sketch')).toBe(false);
    s = addOp(s, sketch.id, op({ mirrors: symmetryMats({ ...NO_SYMMETRY, kind: 'vertical' }) }));
    s = addOp(s, colour.id, op({ brush: presetById('soft-airbrush')! }));
    expect(machineLines(s, 'sketch')).toHaveLength(2);
    expect(machineLines(s, 'colour')).toHaveLength(1);
    expect(hasRoleInk(s, 'sketch')).toBe(true);
    expect(hasRoleInk(patchLayer(s, sketch.id, { visible: false }), 'sketch')).toBe(false);
    expect(machineLines(patchLayer(s, sketch.id, { role: 'none' }), 'sketch')).toHaveLength(0);
    // Erasing alone is nothing; the stroke being drawn counts.
    const erased = addOp(initialState(), initialState().layers[1].id, op({ brush: presetById('eraser')! }));
    const s2 = initialState();
    expect(hasRoleInk(s2, 'sketch', { layerId: s2.layers[1].id, op: op() })).toBe(true);
    expect(hasRoleInk(erased, 'sketch')).toBe(false);
    expect(lineTool(presetById('soft-airbrush')!)).toBe('airbrush');
    expect(lineTool(presetById('pencil-hb')!)).toBe('pencil');
    expect(lineTool(presetById('marker')!)).toBe('marker');
    expect(lineTool(presetById('eraser')!)).toBe('eraser');
    expect(strokeCount(s)).toBe(2);
    const v = patchLayer(addLayer(initialState(), 'vector'), 0, {});
    const ink = v.layers.find((l) => l.kind === 'vector')!;
    const withInk = patchLayer(v, ink.id, { vectors: [toVector(9, line(10), 0.01, '#123456')] });
    expect(machineLines(withInk, 'sketch')).toHaveLength(1);
  });
});

function clearLayerState(d: StudioDoc) {
  return patchLayer(d.state, d.state.layers[1].id, { ops: [] });
}

describe('textures (made in code)', () => {
  it('the same every time, tileable noise in 0..1, tips bright in the middle and empty at the corners', () => {
    expect(grainAlpha('paper')).toEqual(grainAlpha('paper'));
    expect(grainAlpha('none', 8).every((v) => v === 255)).toBe(true);
    const n = fbm(32, 4, 3, 1);
    expect(Math.min(...n)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...n)).toBeLessThanOrEqual(1);
    // Tiles: the left column continues from the right one.
    const diffs = Array.from({ length: 32 }, (_, y) => Math.abs(n[y * 32] - n[y * 32 + 31]));
    expect(Math.max(...diffs)).toBeLessThan(0.2);
    for (const k of ['round', 'pencil', 'charcoal', 'chisel', 'spray'] as const) {
      const t = tipAlpha(k, 32, 0.8);
      expect(t[16 * 32 + 16]).toBeGreaterThan(40);
      if (k !== 'chisel') expect(t[0]).toBeLessThan(10);
    }
    expect(roundAlpha(0, 0)).toBe(1);
    expect(roundAlpha(1, 1)).toBe(0);
    expect(roundAlpha(0.5, 1)).toBe(1);
    expect(cachedTip('splatter')).toBe(cachedTip('splatter'));
  });
});

describe('the canvas view (pinch, turn, snap back)', () => {
  it('screen ↔ paper are inverse, at any zoom and turn', () => {
    const v = { s: 2.3, r: 0.7, tx: 40, ty: -15 };
    const p = { x: 123, y: 45 };
    const back = toPaper(v, fromPaper(v, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
    const z = zoomAbout(FIT, { x: 100, y: 100 }, 2);
    expect(toPaper(z, { x: 100, y: 100 }).x).toBeCloseTo(100);
  });

  it('two fingers: the paper under their middle stays under it; spreading zooms, twisting turns', () => {
    const v = pinchView(FIT, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 });
    expect(v.s).toBeCloseTo(2);
    expect(v.r).toBeCloseTo(Math.PI / 2);
    const m = toPaper(v, { x: 100, y: 200 });
    expect(m.x).toBeCloseTo(150);
    expect(m.y).toBeCloseTo(100);
  });

  it('lifting: a pinch in snaps back to the whole canvas; nearly upright settles upright; tap counts', () => {
    expect(settleView({ s: 0.7, r: 0.3, tx: 10, ty: 10 }, { x: 0, y: 0 })).toBe(FIT);
    expect(settleView({ s: 1.01, r: 0.05, tx: 3, ty: 2 }, { x: 0, y: 0 })).toBe(FIT);
    const turned = settleView({ s: 2, r: Math.PI / 2 + 0.05, tx: 0, ty: 0 }, { x: 50, y: 50 });
    expect(turned.r).toBeCloseTo(Math.PI / 2);
    expect(toPaper(turned, { x: 50, y: 50 }).x).toBeCloseTo(toPaper({ s: 2, r: Math.PI / 2 + 0.05, tx: 0, ty: 0 }, { x: 50, y: 50 }).x);
    const free = { s: 2, r: 0.5, tx: 0, ty: 0 };
    expect(settleView(free, { x: 0, y: 0 })).toBe(free);
    expect(lerpView(FIT, { s: 3, r: 0, tx: 10, ty: 0 }, 0.5).s).toBe(2);
    expect([tapAction(1), tapAction(2), tapAction(3), tapAction(4)]).toEqual([null, 'undo', 'redo', 'ui']);
  });
});

describe('colour', () => {
  it('hex ↔ HSV, harmonies round the wheel, recent colours', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00');
    for (const c of ['#123456', '#d6452b', '#7fc7e8', '#000000', '#ffffff']) expect(hsvToHex(hexToHsv(c))).toBe(c);
    expect(harmony('#ff0000', 'complementary')).toEqual(['#ff0000', '#00ffff']);
    expect(harmony('#ff0000', 'triad')).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    expect(harmony('#ff0000', 'analogous')).toHaveLength(3);
    expect(isHex('#abc') && isHex('abcdef') && !isHex('#ab')).toBe(true);
    expect(normHex('ABC')).toBe('#aabbcc');
    expect(pushRecentColour(['#000000', '#ffffff'], '#FFF')).toEqual(['#ffffff', '#000000']);
  });
});

it('every value in a dab is finite (no NaN from zero-length moves)', () => {
  const pts = [pt(0.5, 0.5), pt(0.5, 0.5), pt(0.5, 0.5), pt(0.6, 0.5)];
  for (const b of PRESETS) for (const d of dabsFor(b, b.size, 3, pts)) expect([d.x, d.y, d.size, d.alpha, d.angle, d.roundness].every(Number.isFinite)).toBe(true);
  expect(close(1, 1)).toBe(true);
});
