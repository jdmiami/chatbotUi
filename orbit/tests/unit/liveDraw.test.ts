import { describe, expect, it, vi } from 'vitest';
import { Sketch, alphaAt, fillGap, pressureOf, smoothPoint, tiltOf, widthAt, type Stroke } from '../../src/apps/ai/sketch';
import { LiveDrawLink } from '../../src/services/ai/liveDraw';
import { withCatalog } from '../../src/apps/ai/makerCatalog';

const pt = (x: number, y: number, p = 0.5, tilt = 0) => ({ x, y, p, tilt });
const stroke = (tool: Stroke['tool'] = 'pen'): Stroke => ({ tool, color: '#000', size: 0.01, points: [pt(0.1, 0.1)] });

describe('Live draw strokes', () => {
  it('reads Pencil tilt from altitudeAngle (Safari) or tiltX/tiltY, and ignores it for fingers', () => {
    expect(tiltOf({ pointerType: 'pen', altitudeAngle: Math.PI / 2 })).toBe(0);
    expect(tiltOf({ pointerType: 'pen', altitudeAngle: Math.PI / 4 })).toBeCloseTo(0.5);
    expect(tiltOf({ pointerType: 'pen', tiltX: 0, tiltY: 0 })).toBe(0);
    expect(tiltOf({ pointerType: 'pen', tiltX: 45, tiltY: 0 })).toBeCloseTo(0.5);
    expect(tiltOf({ pointerType: 'pen', tiltX: 60, tiltY: 60 })).toBeGreaterThan(0.7);
    expect(tiltOf({ pointerType: 'touch', tiltX: 60 })).toBe(0);
  });

  it('pressure: the Pencil’s own, a medium press for fingers and the mouse, never zero', () => {
    expect(pressureOf({ pointerType: 'pen', pressure: 0.8 })).toBe(0.8);
    expect(pressureOf({ pointerType: 'pen', pressure: 0 })).toBeGreaterThan(0);
    expect(pressureOf({ pointerType: 'touch', pressure: 1 })).toBe(0.5);
    expect(pressureOf({ pointerType: 'mouse', pressure: 0 })).toBe(0.5);
  });

  it('harder is wider and darker; tilted is wider and softer; the eraser ignores tilt', () => {
    expect(widthAt('pen', 0.01, 1, 0)).toBeGreaterThan(widthAt('pen', 0.01, 0.1, 0));
    expect(alphaAt('pen', 1, 0)).toBeGreaterThan(alphaAt('pen', 0.1, 0));
    expect(widthAt('pen', 0.01, 0.5, 1)).toBeCloseTo(widthAt('pen', 0.01, 0.5, 0) * 3);
    expect(alphaAt('pen', 0.5, 1)).toBeLessThan(alphaAt('pen', 0.5, 0));
    expect(widthAt('brush', 0.02, 0.5, 0)).toBeGreaterThan(widthAt('pen', 0.006, 0.5, 0));
    expect(alphaAt('eraser', 0.1, 1)).toBe(1);
  });

  it('smoothing follows part of the way; sparse samples get filled in', () => {
    const s = smoothPoint(pt(0, 0, 0, 0), pt(1, 1, 1, 1), 0.5);
    expect(s).toEqual({ x: 0.5, y: 0.5, p: 0.5, tilt: 0.5 });
    expect(smoothPoint(undefined, pt(0.3, 0.3))).toEqual(pt(0.3, 0.3));
    const gap = fillGap(pt(0, 0), pt(0.1, 0), 0.01);
    expect(gap.length).toBe(9);
    expect(gap[4].x).toBeCloseTo(0.05);
    expect(fillGap(pt(0, 0), pt(0.001, 0))).toEqual([]);
  });

  it('undo, redo and clear (which Undo brings back)', () => {
    const k = new Sketch();
    expect(k.empty).toBe(true);
    k.add(stroke());
    k.add(stroke('brush'));
    expect(k.strokes.length).toBe(2);
    expect(k.undo()).toBe(true);
    expect(k.strokes.length).toBe(1);
    expect(k.redo()).toBe(true);
    expect(k.strokes.length).toBe(2);
    k.clear();
    expect(k.empty).toBe(true);
    k.undo();
    expect(k.strokes.length).toBe(2);
    // A new stroke after undo drops what could be redone.
    k.undo();
    k.add(stroke());
    expect(k.canRedo).toBe(false);
    // Only eraser strokes: still nothing drawn.
    const e = new Sketch();
    e.add(stroke('eraser'));
    expect(e.empty).toBe(true);
  });
});

/** A WebSocket that answers frames after `delay` ms (or never opens). */
function fakeWs({ open = true, delay = 5 } = {}) {
  const made: FakeWs[] = [];
  class FakeWs {
    readyState = 0;
    sent: Record<string, unknown>[] = [];
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
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'frame', id: msg.id, ms: 90, image: `data:image/jpeg;base64,${msg.prompt}` }) }), delay);
    }
    close() {
      this.readyState = 3;
      this.onclose?.({});
    }
  }
  return { WS: FakeWs, made };
}

const req = (prompt: string) => ({ prompt, follow: 0.5, seed: 1, image: 'data:image/png;base64,AAAA' });
const access = async () => ({ url: 'https://pod-8080.proxy.runpod.net', token: 'tok.en.x' });

describe('LiveDrawLink', () => {
  it('uses the WebSocket with the token as a sub-protocol; only the newest waiting drawing is sent', async () => {
    const { WS, made } = fakeWs({ delay: 300 });
    const frames: string[] = [];
    const link = new LiveDrawLink({ access, WebSocketImpl: WS, onFrame: (img) => frames.push(img), onError: () => {} });
    link.send(req('one'));
    await vi.waitFor(() => expect(made[0]?.sent.length).toBe(1), { interval: 5 });
    link.send(req('two'));
    link.send(req('three'));
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(made[0].url).toBe('wss://pod-8080.proxy.runpod.net/_orbit/live/draw');
    expect(made[0].protocols).toEqual(['orbit-live', 'tok.en.x']);
    expect(made[0].sent.map((m) => m.prompt)).toEqual(['one', 'three']);
    // The PNG goes as plain base64 (the gate also takes data URLs).
    expect(made[0].sent[0].image).toBe('AAAA');
    expect(frames).toEqual(['data:image/jpeg;base64,one', 'data:image/jpeg;base64,three']);
    expect(link.via).toBe('socket');
    link.close();
  });

  it('falls back to one POST per drawing when the socket cannot open', async () => {
    const { WS } = fakeWs({ open: false });
    const modes: string[] = [];
    const posts: { url: string; body: Record<string, unknown>; auth: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization });
      return new Response(new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }), { status: 200, headers: { 'x-live-ms': '120' } });
    }) as typeof fetch;
    globalThis.URL.createObjectURL ??= () => 'blob:x';
    globalThis.URL.revokeObjectURL ??= () => {};
    const frames: [string, number | null][] = [];
    const link = new LiveDrawLink({ access, WebSocketImpl: WS, fetchImpl, onFrame: (i, ms) => frames.push([i, ms]), onError: () => {}, onMode: (m) => modes.push(m) });
    link.send(req('a'));
    await vi.waitFor(() => expect(frames.length).toBe(1));
    link.send(req('b'));
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(modes).toContain('post');
    expect(link.via).toBe('post');
    expect(posts[0].url).toBe('https://pod-8080.proxy.runpod.net/_orbit/live/draw');
    expect(posts[0].auth).toBe('Bearer tok.en.x');
    expect(posts[0].body).toMatchObject({ prompt: 'a', follow: 0.5, seed: 1 });
    expect(frames[1][1]).toBe(120);
    link.close();
  });

  it('a refusal (blocked words, paused for a video) reaches the page as an error', async () => {
    const fetchImpl = (async () => Response.json({ error: 'Paused', paused: true }, { status: 409 })) as unknown as typeof fetch;
    const errors: [string, { paused?: boolean }][] = [];
    const link = new LiveDrawLink({ access, WebSocketImpl: undefined as never, fetchImpl, onFrame: () => {}, onError: (m, i) => errors.push([m, i]) });
    // No WebSocket here at all: straight to POST.
    (link as unknown as { mode: string }).mode = 'post';
    link.send(req('x'));
    await vi.waitFor(() => expect(errors.length).toBe(1));
    expect(errors[0][0]).toBe('Paused');
    expect(errors[0][1].paused).toBe(true);
    link.close();
  });
});

describe('Store catalog', () => {
  it('Live draw and Sketch finish arrive on older machines as pending makers', () => {
    const all = withCatalog([]);
    const live = all.find((m) => m.id === 'live-draw');
    const finish = all.find((m) => m.id === 'sketch-finish');
    expect(live?.kind).toBe('live');
    expect(finish?.kind).toBe('sketch');
    expect(live?.pending).toBe(true);
    expect(live!.size).toBeGreaterThan(3e9);
    expect(finish!.size).toBeGreaterThan(27e9);
  });
});
