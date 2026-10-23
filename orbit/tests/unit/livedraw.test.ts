import { describe, expect, it, vi } from 'vitest';
import { alphaAt, fillGap, hexRgb, pressureOf, smoothPoint, tiltOf, widthAt, type Stroke } from '../../src/apps/livedraw/canvas/sketch';
import { CanvasDoc } from '../../src/apps/livedraw/canvas/doc';
import { PictureHistory } from '../../src/apps/livedraw/canvas/history';
import { binarizeMask, flattenOnto, floodRegion, growRegion, joinPrompt, lassoOk, maskCoverage, paintRegion, pointInPolygon, stackOf, thinPath } from '../../src/apps/livedraw/canvas/raster';
import { POSE_COLORS, POSE_LIMBS, POSE_POINTS, defaultPose, drawPose, movePoint } from '../../src/apps/livedraw/canvas/pose';
import { crc32, dataUrlBytes, recordType, zipStore } from '../../src/apps/livedraw/canvas/exporters';
import { CanvasAccess, CanvasLink, LiveCanvasApi, LivingLink, allowedEngine, doorPaths, otherEngineLine, type CanvasFrameInput } from '../../src/services/ai/liveCanvas';
import { withCatalog } from '../../src/apps/ai/makerCatalog';

const pt = (x: number, y: number, p = 0.5, tilt = 0) => ({ x, y, p, tilt });
const stroke = (tool: Stroke['tool'] = 'pen'): Stroke => ({ tool, color: '#000', size: 0.01, points: [pt(0.1, 0.1)] });

describe('strokes (Apple Pencil pressure and tilt)', () => {
  it('reads tilt from altitudeAngle (Safari) or tiltX/tiltY, and ignores it for fingers', () => {
    expect(tiltOf({ pointerType: 'pen', altitudeAngle: Math.PI / 2 })).toBe(0);
    expect(tiltOf({ pointerType: 'pen', altitudeAngle: Math.PI / 4 })).toBeCloseTo(0.5);
    expect(tiltOf({ pointerType: 'pen', tiltX: 45, tiltY: 0 })).toBeCloseTo(0.5);
    expect(tiltOf({ pointerType: 'touch', tiltX: 60 })).toBe(0);
  });

  it('pressure: the Pencil’s own, a medium press for fingers and the mouse, never zero', () => {
    expect(pressureOf({ pointerType: 'pen', pressure: 0.8 })).toBe(0.8);
    expect(pressureOf({ pointerType: 'pen', pressure: 0 })).toBeGreaterThan(0);
    expect(pressureOf({ pointerType: 'mouse', pressure: 0 })).toBe(0.5);
  });

  it('each tool: harder is wider, tilted pencil shades wide and soft, the marker is flat, the airbrush is light', () => {
    expect(widthAt('pen', 0.01, 1, 0)).toBeGreaterThan(widthAt('pen', 0.01, 0.1, 0));
    expect(widthAt('pencil', 0.01, 0.5, 1)).toBeCloseTo(widthAt('pencil', 0.01, 0.5, 0) * 5);
    expect(alphaAt('pencil', 0.5, 1)).toBeLessThan(alphaAt('pencil', 0.5, 0));
    expect(alphaAt('marker', 0.1, 0)).toBe(alphaAt('marker', 1, 0));
    expect(alphaAt('airbrush', 1, 0)).toBeLessThan(0.2);
    expect(alphaAt('eraser', 0.1, 1)).toBe(1);
  });

  it('smoothing follows part of the way; sparse samples get filled in; colours parse', () => {
    expect(smoothPoint(pt(0, 0, 0, 0), pt(1, 1, 1, 1), 0.5)).toEqual({ x: 0.5, y: 0.5, p: 0.5, tilt: 0.5 });
    expect(fillGap(pt(0, 0), pt(0.1, 0), 0.01).length).toBe(9);
    expect(hexRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexRgb('#fff')).toEqual([255, 255, 255]);
  });
});

describe('the drawing (layers, mask, undo across them)', () => {
  it('undo and redo walk back across Sketch, Colour and the mask; clear can be undone', () => {
    const d = new CanvasDoc();
    expect(d.empty).toBe(true);
    d.add('sketch', { kind: 'stroke', stroke: stroke() });
    d.add('colour', { kind: 'fill', x: 0.5, y: 0.5, color: '#f00' });
    d.add('mask', { kind: 'stroke', stroke: stroke('marker') });
    expect(d.empty).toBe(false);
    expect(d.undo()).toBe('mask');
    expect(d.has('mask')).toBe(false);
    expect(d.undo()).toBe('colour');
    expect(d.redo()).toBe('colour');
    expect(d.get('colour').length).toBe(1);
    d.clear('sketch');
    expect(d.get('sketch').length).toBe(0);
    expect(d.undo()).toBe('sketch');
    expect(d.get('sketch').length).toBe(1);
    // A new stroke drops what could be redone.
    d.undo();
    d.add('sketch', { kind: 'stroke', stroke: stroke() });
    expect(d.canRedo).toBe(false);
    // Eraser strokes alone are nothing.
    const e = new CanvasDoc();
    e.add('sketch', { kind: 'stroke', stroke: stroke('eraser') });
    expect(e.empty).toBe(true);
    expect(e.count('sketch')).toBe(1);
  });
});

describe('history', () => {
  it('keeps every new picture once, drops the oldest past max, restores and plays back', () => {
    let t = 0;
    const h = new PictureHistory(3, () => ++t);
    expect(h.add('a', 'p')).not.toBeNull();
    expect(h.add('a', 'p')).toBeNull(); // the same picture twice
    h.add('b', 'p');
    h.add('c', 'p');
    h.add('d', 'p');
    expect(h.items.map((s) => s.image)).toEqual(['b', 'c', 'd']);
    expect(h.current?.image).toBe('d');
    expect(h.restore(0)?.image).toBe('b');
    expect(h.scrubbed).toBe(true);
    expect(h.index).toBe(0);
    h.add('e', 'p', 'keep');
    expect(h.scrubbed).toBe(false);
    expect(h.current).toMatchObject({ image: 'e', mark: 'keep' });
    expect(h.restore(99)?.image).toBe('e');
    const many = new PictureHistory(500);
    for (let i = 0; i < 300; i++) many.add(String(i), '');
    const f = many.frames(10);
    expect(f.length).toBe(10);
    expect(f[0].image).toBe('0');
    expect(f[9].image).toBe('299');
  });
});

/** A w×h RGBA buffer, transparent, with opaque pixels where `ink` says. */
function buffer(w: number, h: number, ink: (x: number, y: number) => boolean) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) d.set([0, 0, 0, 255], (y * w + x) * 4);
  return d;
}

describe('mask and composite helpers', () => {
  it('fill stays inside the lines (another layer’s ink bounds it) and grows under their edge', () => {
    const w = 10;
    // A vertical line at x = 5 on the Sketch layer; the Colour layer is empty.
    const lines = buffer(w, w, (x) => x === 5);
    const colour = buffer(w, w, () => false);
    const region = floodRegion(colour, lines, w, w, 1, 1);
    expect(region.reduce((n, v) => n + v, 0)).toBe(50);
    expect(region[3 * w + 4]).toBe(1);
    expect(region[3 * w + 6]).toBe(0);
    expect(floodRegion(colour, lines, w, w, 5, 5).every((v) => v === 0)).toBe(true);
    expect(growRegion(region, w, w, 1)[3 * w + 5]).toBe(1);
    const out = new Uint8ClampedArray(colour);
    paintRegion(out, region, [255, 0, 0]);
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    // Without a boundary, its own colours bound it.
    const own = buffer(w, w, (x) => x === 2);
    expect(floodRegion(own, null, w, w, 0, 0).reduce((n, v) => n + v, 0)).toBe(20);
  });

  it('a mask is white where painted, black elsewhere; coverage says if anything was painted', () => {
    const d = buffer(4, 1, (x) => x < 1);
    binarizeMask(d);
    expect([...d]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect(maskCoverage(d)).toBe(0.25);
    expect(maskCoverage(binarizeMask(buffer(2, 2, () => false)))).toBe(0);
  });

  it('lasso: inside test, thinning, and a tap is not a region', () => {
    const sq = [pt(0.2, 0.2), pt(0.8, 0.2), pt(0.8, 0.8), pt(0.2, 0.8)];
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 0.9, y: 0.5 }, sq)).toBe(false);
    expect(lassoOk(sq)).toBe(true);
    expect(lassoOk([pt(0.5, 0.5), pt(0.501, 0.5), pt(0.5, 0.501)])).toBe(false);
    expect(thinPath([pt(0, 0), pt(0.001, 0), pt(0.01, 0)], 0.006).length).toBe(2);
  });

  it('layers stack picture first, then reference, then colour and lines faded by Ink', () => {
    const all = { sketch: true, colour: true, picture: true, reference: true };
    expect(stackOf(all, { reference: false }, 40)).toEqual([
      { id: 'picture', alpha: 1 },
      { id: 'colour', alpha: 0.4 },
      { id: 'sketch', alpha: 0.4 },
    ]);
    expect(stackOf({ ...all, picture: false }, {}, 0).map((l) => l.id)).toEqual(['reference']);
    const calls: string[] = [];
    const ctx = {
      globalAlpha: 1,
      fillStyle: '' as string | CanvasGradient | CanvasPattern,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      fillRect: () => calls.push(`paper ${ctx.fillStyle}`),
      drawImage: (src: unknown) => calls.push(`${String(src)}@${ctx.globalAlpha}`),
    };
    flattenOnto(ctx as never, 8, [
      { source: 'picture' as never, alpha: 1 },
      { source: null, alpha: 1 },
      { source: 'sketch' as never, alpha: 0.5 },
    ]);
    expect(calls).toEqual(['save', 'paper #ffffff', 'picture@1', 'sketch@0.5', 'restore']);
  });

  it('style chips add their words after yours', () => {
    expect(joinPrompt(' a fox ', ['watercolour painting', ''])).toBe('a fox, watercolour painting');
    expect(joinPrompt('', ['oil painting'])).toBe('oil painting');
  });
});

describe('OpenPose renderer', () => {
  it('18 points, 17 limbs, the standard colours', () => {
    expect(POSE_POINTS.length).toBe(18);
    expect(defaultPose().length).toBe(18);
    expect(POSE_LIMBS.length).toBe(17);
    expect(POSE_COLORS.length).toBe(18);
    expect(POSE_COLORS[0]).toEqual([255, 0, 0]);
    expect(POSE_COLORS[12]).toEqual([0, 0, 255]);
    // Neck to right shoulder first, the ears last.
    expect(POSE_LIMBS[0]).toEqual([1, 2]);
    expect(POSE_LIMBS[16]).toEqual([15, 17]);
  });

  it('draws black ground, each limb at 60 % in its colour, then each point', () => {
    const ops: { op: string; fill?: string; alpha?: number; args?: number[] }[] = [];
    const ctx = {
      fillStyle: '' as string | CanvasGradient | CanvasPattern,
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      fillRect: (...a: number[]) => ops.push({ op: 'rect', fill: String(ctx.fillStyle), args: a }),
      ellipse: (...a: number[]) => ops.push({ op: 'ellipse', fill: String(ctx.fillStyle), alpha: ctx.globalAlpha, args: a }),
      arc: (...a: number[]) => ops.push({ op: 'arc', fill: String(ctx.fillStyle), alpha: ctx.globalAlpha, args: a }),
      fill() {},
    };
    drawPose(ctx as never, defaultPose(), 512);
    expect(ops[0]).toEqual({ op: 'rect', fill: '#000000', args: [0, 0, 512, 512] });
    const limbs = ops.filter((o) => o.op === 'ellipse');
    const dots = ops.filter((o) => o.op === 'arc');
    expect(limbs.length).toBe(17);
    expect(dots.length).toBe(18);
    expect(limbs.every((l) => l.alpha === 0.6)).toBe(true);
    expect(limbs[0].fill).toBe('rgb(255, 0, 0)');
    expect(dots[17].fill).toBe('rgb(255, 0, 85)');
    // Point 0 (the nose) at its place on a 512 square, radius 4.
    expect(dots[0].args!.slice(0, 3)).toEqual([256, 102.4, 4]);
    expect(movePoint(defaultPose(), 4, { x: 1.4, y: -1 })[4]).toEqual({ x: 1, y: 0 });
  });
});

describe('export helpers', () => {
  it('crc32, data URLs and a stored zip of the frames', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const { bytes, type } = dataUrlBytes('data:image/png;base64,AAEC');
    expect(type).toBe('image/png');
    expect([...bytes]).toEqual([0, 1, 2]);
    const zip = zipStore([
      { name: 'frame-0001.png', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'frame-0002.png', bytes: new Uint8Array([4]) },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    // The first file's data follows its 30-byte header and name.
    expect([...zip.slice(30 + 14, 30 + 14 + 3)]).toEqual([1, 2, 3]);
    expect(v.getUint32(14, true)).toBe(crc32(new Uint8Array([1, 2, 3])));
  });

  it('records the first video type the browser has, or none (then frames go in a zip)', () => {
    expect(recordType({ isTypeSupported: (t) => t.startsWith('video/webm') })).toBe('video/webm;codecs=vp9');
    expect(recordType({ isTypeSupported: (t) => t === 'video/mp4' })).toBe('video/mp4');
    expect(recordType(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------- the link

type Sent = Record<string, unknown>;
/** A WebSocket the test drives: answers frames after `delay` ms (or never opens). */
function fakeWs({ open = true, delay = 5, reply }: { open?: boolean; delay?: number; reply?: (msg: Sent) => Sent | null } = {}) {
  const made: FakeWs[] = [];
  class FakeWs {
    readyState = 0;
    bufferedAmount = 0;
    sent: Sent[] = [];
    onopen: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    constructor(
      public url: string,
      public protocols?: string[],
    ) {
      made.push(this);
      setTimeout(() => {
        if (open) {
          this.readyState = 1;
          this.onopen?.({});
        } else this.onerror?.({});
      }, 1);
    }
    send(data: string) {
      const msg = JSON.parse(data);
      this.sent.push(msg);
      const r = reply ? reply(msg) : msg.type === 'frame' ? { type: 'frame', id: msg.id, ms: 90, image: `data:image/webp;base64,${msg.prompt}` } : null;
      if (r) setTimeout(() => this.onmessage?.({ data: JSON.stringify(r) }), delay);
    }
    push(msg: Sent) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
    close() {
      this.readyState = 3;
      this.onclose?.({});
    }
  }
  return { WS: FakeWs, made };
}

const frame = (prompt: string, extra: Partial<CanvasFrameInput> = {}): CanvasFrameInput => ({
  engine: 'fast',
  mode: 'live',
  prompt,
  seed: 7,
  follow: 0.7,
  strength: 0.6,
  size: 512,
  sketch: 'data:image/png;base64,AAAA',
  ...extra,
});
const grant = { url: 'https://pod-8080.proxy.runpod.net', token: 'tok.en.x', engine: 'fast' as const, expires: Date.now() + 3600_000 };
const access = async () => grant;

describe('CanvasLink', () => {
  it('opens /_orbit/canvas/live with the token as a sub-protocol and sends only the newest waiting frame', async () => {
    const { WS, made } = fakeWs({ delay: 200 });
    const frames: [string, number | null, number][] = [];
    const link = new CanvasLink({ access, WebSocketImpl: WS, onFrame: (i, ms, id) => frames.push([i, ms, id]), onError: () => {} });
    link.send(frame('one'));
    await vi.waitFor(() => expect(made[0]?.sent.length).toBe(1), { interval: 5 });
    link.send(frame('two'));
    link.send(frame('three'));
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(made[0].url).toBe('wss://pod-8080.proxy.runpod.net/_orbit/canvas/live');
    expect(made[0].protocols).toEqual(['orbit-live', 'tok.en.x']);
    expect(made[0].sent.map((m) => m.prompt)).toEqual(['one', 'three']);
    // The CanvasFrame shape (DESIGN.md §5.1): typed, numbered, everything the app gave.
    expect(made[0].sent[0]).toMatchObject({ type: 'frame', id: 1, engine: 'fast', mode: 'live', seed: 7, follow: 0.7, strength: 0.6, size: 512, sketch: 'data:image/png;base64,AAAA' });
    expect(frames).toEqual([
      ['data:image/webp;base64,one', 90, 1],
      ['data:image/webp;base64,three', 90, 2],
    ]);
    expect(link.via).toBe('socket');
    link.close();
  });

  it('replies: errors reach the page with their flags, engine state comes whenever the machine sends it', async () => {
    const { WS, made } = fakeWs({ reply: (m) => ({ type: 'error', id: m.id, error: 'Those words aren’t allowed.', blocked: true, status: 400 }) });
    const errors: [string, Record<string, unknown>][] = [];
    const states: unknown[] = [];
    const link = new CanvasLink({ access, WebSocketImpl: WS, onFrame: () => {}, onError: (m, i) => errors.push([m, i]), onState: (e, l) => states.push([e, l]) });
    link.send(frame('x'));
    await vi.waitFor(() => expect(errors.length).toBe(1));
    expect(errors[0]).toEqual(['Those words aren’t allowed.', { id: 1, status: 400, blocked: true, paused: false }]);
    made[0].push({ type: 'state', engines: { fast: 'ready', licensed: 'loading' }, loading: 'Loading the licensed engine' });
    expect(states).toEqual([[{ fast: 'ready', licensed: 'loading' }, 'Loading the licensed engine']]);
    link.close();
  });

  it('falls back to POST /_orbit/canvas/frame (one CanvasReply each) when the socket can’t open', async () => {
    const { WS } = fakeWs({ open: false });
    const modes: string[] = [];
    const posts: { url: string; body: Sent; auth: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      posts.push({ url, body, auth: (init.headers as Record<string, string>).authorization });
      return Response.json({ type: 'frame', id: body.id, image: 'data:image/webp;base64,Zg==', ms: 120 });
    }) as typeof fetch;
    const frames: [string, number | null][] = [];
    const link = new CanvasLink({ access, WebSocketImpl: WS, fetchImpl, onFrame: (i, ms) => frames.push([i, ms]), onError: () => {}, onMode: (m) => modes.push(m) });
    link.send(frame('a'));
    await vi.waitFor(() => expect(frames.length).toBe(1));
    link.send(frame('b'));
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(modes).toContain('post');
    expect(link.via).toBe('post');
    expect(posts[0].url).toBe('https://pod-8080.proxy.runpod.net/_orbit/canvas/frame');
    expect(posts[0].auth).toBe('Bearer tok.en.x');
    expect(posts[0].body).toMatchObject({ type: 'frame', prompt: 'a', mode: 'live' });
    expect(frames[1]).toEqual(['data:image/webp;base64,Zg==', 120]);
    link.close();
  });

  it('a 401 on POST gets a fresh token once; a refusal is an error; the licensed engine is never swapped', async () => {
    let n = 0;
    const tokens: string[] = [];
    const acc = async (force?: boolean) => ({ ...grant, token: force ? 'fresh' : 'old' });
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      tokens.push((init.headers as Record<string, string>).authorization);
      n++;
      if (n === 1) return new Response('{}', { status: 401 });
      if (n === 2) return Response.json({ type: 'frame', id: JSON.parse(String(init.body)).id, image: 'data:,', ms: 1 });
      return Response.json({ error: 'Paused while a video is made', paused: true }, { status: 409 });
    }) as typeof fetch;
    const errors: [string, { paused?: boolean }][] = [];
    const frames: string[] = [];
    const sentEngines: string[] = [];
    const link = new CanvasLink({ access: acc, WebSocketImpl: undefined, fetchImpl: ((u: string, i: RequestInit) => (sentEngines.push(JSON.parse(String(i.body)).engine), fetchImpl(u, i))) as typeof fetch, siteEngine: () => 'licensed', onFrame: (i) => frames.push(i), onError: (m, i) => errors.push([m, i]) });
    // No WebSocket here at all: straight to POST.
    (link as unknown as { mode: string }).mode = 'post';
    link.send(frame('x'));
    await vi.waitFor(() => expect(frames.length).toBe(1));
    expect(tokens).toEqual(['Bearer old', 'Bearer fresh']);
    link.send(frame('y'));
    await vi.waitFor(() => expect(errors.length).toBe(1));
    expect(errors[0][0]).toBe('Paused while a video is made');
    expect(errors[0][1].paused).toBe(true);
    expect(new Set(sentEngines)).toEqual(new Set(['licensed']));
    link.close();
  });
});

describe('access (token refresh)', () => {
  it('caches the grant, refreshes two minutes before it runs out, shares one request, and learns the engine', async () => {
    let clock = 1_000_000;
    let calls = 0;
    const f = (async (url: string, init: RequestInit) => {
      calls++;
      expect(url).toBe('/api/canvas/token');
      expect(init.method).toBe('POST');
      return Response.json({ status: 'on', url: 'https://m-8080.proxy.runpod.net/', token: `t${calls}`, expiresIn: 3600, engine: 'fast' });
    }) as typeof fetch;
    const a = new CanvasAccess(f, () => clock);
    const [g1, g2] = await Promise.all([a.get(), a.get()]);
    expect(calls).toBe(1);
    expect(g1).toBe(g2);
    expect(g1).toMatchObject({ url: 'https://m-8080.proxy.runpod.net', token: 't1', engine: 'fast' });
    expect(a.engine).toBe('fast');
    clock += 3600_000 - 200_000; // 3 min 20 s left: still good
    expect((await a.get())!.token).toBe('t1');
    clock += 100_000; // under two minutes left: a fresh one
    expect((await a.get())!.token).toBe('t2');
    expect((await a.get(true))!.token).toBe('t3');
  });

  it('while the machine is off there is no grant, but the engine is known', async () => {
    const f = (async () => Response.json({ status: 'off', url: null, token: null, expiresIn: 3600, engine: 'licensed' })) as unknown as typeof fetch;
    const a = new CanvasAccess(f);
    expect(await a.get()).toBeNull();
    expect(a.engine).toBe('licensed');
  });

  it('the member door: status and token in one GET, always licensed, the /_studio routes', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('/api/studio/canvas')) return Response.json({ state: 'on', url: 'https://m', token: 'member', expiresIn: 3600, engine: 'fast' });
      return Response.json({ guesses: [{ label: 'a cat', prompt: 'a cat on a mat' }, { label: '' }] });
    }) as typeof fetch;
    const api = new LiveCanvasApi(f, { door: 'member', studio: 'nova' });
    expect(api.paths).toMatchObject({ status: '/api/studio/canvas?studio=nova', machine: '/_studio/canvas', liveMaker: 'live-sdv2', styleRef: false });
    expect(await api.read('data:,')).toEqual([{ label: 'a cat', prompt: 'a cat on a mat' }]);
    expect(urls).toEqual(['/api/studio/canvas?studio=nova', 'https://m/_studio/canvas/read']);
    expect(api.access.engine).toBe('licensed');
    expect(api.canSwitchEngine).toBe(false);
    expect(doorPaths('owner')).toMatchObject({ machine: '/_orbit/canvas', liveVideo: '/_orbit/live/video', liveMaker: 'live-krea', styleRef: true });
  });

  it('Finish follows the site’s engine; job files get the machine’s address', async () => {
    const bodies: Sent[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      if (url === '/api/canvas/token') return Response.json({ url: 'https://m', token: 't', expiresIn: 3600, engine: 'licensed' });
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return Response.json({ id: 'j1', kind: 'image', prompt: 'p', status: 'done', progress: 100, error: null, createdAt: '', item: { id: 'i', kind: 'image', prompt: 'p', createdAt: '', url: '/_orbit/studio/files/i.png' } });
    }) as typeof fetch;
    const api = new LiveCanvasApi(f);
    const job = await api.finish({ image: 'data:,', sketch: 'data:,', prompt: 'p', engine: 'fast', size: 768 });
    expect(bodies[0]).toMatchObject({ engine: 'licensed', size: 768 });
    expect(job.item!.url).toBe('https://m/_orbit/studio/files/i.png');
  });

  it('says so when an error needs the other engine', () => {
    expect(otherEngineLine('Pose needs the licensed engine.', 'fast', true)).toBe('That needs the licensed engine: switch it in Options.');
    expect(otherEngineLine('Style reference works on the fast engine only', 'licensed', false)).toMatch(/isn’t available here/);
    expect(otherEngineLine('Those words aren’t allowed.', 'fast', true)).toBeNull();
    expect(allowedEngine('fast', 'licensed')).toBe('licensed');
    expect(allowedEngine('licensed', 'fast')).toBe('licensed');
    expect(allowedEngine('fast', 'fast')).toBe('fast');
  });
});

describe('Bring to life (live video session)', () => {
  it('starts with the door’s maker, sends the picture at once and while you draw, takes new words and Motion, saves the last 10 s', async () => {
    vi.useFakeTimers();
    try {
      const { WS, made } = fakeWs({ reply: () => null });
      const states: string[] = [];
      const frames: string[] = [];
      let saved = 0;
      const l = new LivingLink({
        access,
        path: '/_orbit/live/video',
        maker: 'live-krea',
        source: () => 'data:image/jpeg;base64,PIC',
        onFrame: (f) => frames.push(f),
        onState: (s) => states.push(s),
        onError: () => {},
        onSaved: () => saved++,
        WebSocketImpl: WS,
        fps: 10,
      });
      await l.start('a fox running', 0.6);
      await vi.advanceTimersByTimeAsync(2);
      const ws = made[0];
      expect(ws.url).toBe('wss://pod-8080.proxy.runpod.net/_orbit/live/video');
      expect(ws.sent[0]).toEqual({ type: 'start', maker: 'live-krea', source: 'canvas', prompt: 'a fox running', strength: 0.6 });
      expect(ws.sent[1]).toEqual({ type: 'frame', image: 'data:image/jpeg;base64,PIC' });
      ws.push({ type: 'state', state: 'live' });
      await vi.advanceTimersByTimeAsync(350);
      expect(ws.sent.filter((m) => m.type === 'frame').length).toBeGreaterThanOrEqual(4);
      ws.push({ type: 'frame', image: 'data:image/jpeg;base64,V1' });
      expect(frames).toEqual(['data:image/jpeg;base64,V1']);
      l.setPrompt('a fox jumping');
      l.setStrength(0.9);
      l.save();
      ws.push({ type: 'saved', item: { id: 'v' } });
      expect(ws.sent.slice(-3)).toEqual([{ type: 'prompt', prompt: 'a fox jumping' }, { type: 'strength', strength: 0.9 }, { type: 'save' }]);
      expect(saved).toBe(1);
      ws.bufferedAmount = 10e6; // backed up: frames are skipped
      const before = ws.sent.length;
      await vi.advanceTimersByTimeAsync(300);
      expect(ws.sent.length).toBe(before);
      l.stop();
      expect(states).toEqual(['connecting', 'live', 'stopped']);
      expect(ws.sent[ws.sent.length - 1]).toEqual({ type: 'stop' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Store catalog (the AI machine’s makers, unchanged)', () => {
  it('Live draw, Sketch finish and both live video makers still arrive from the catalog', () => {
    const all = withCatalog([]);
    expect(all.find((m) => m.id === 'live-draw')?.kind).toBe('live');
    expect(all.find((m) => m.id === 'sketch-finish')?.kind).toBe('sketch');
    expect(all.find((m) => m.id === 'live-sdv2')?.kind).toBe('live');
    expect(all.find((m) => m.id === 'live-krea')?.turboOnly).toBe(true);
  });
});
