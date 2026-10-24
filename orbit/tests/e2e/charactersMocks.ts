import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

/** Mocks of the character library on the AI machine and in cloud storage, with portraits drawn in code. */

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A 3:4 portrait: a soft studio background and a simple figure (head, hair, shoulders), different per view. */
export function portrait(seed: number, view = 'front'): Buffer {
  const W = 150;
  const H = 200;
  const hue = (seed * 47) % 360;
  const skin = [226 - (seed % 4) * 22, 184 - (seed % 4) * 20, 150 - (seed % 4) * 18];
  const hair = [[60, 40, 30], [30, 30, 36], [150, 70, 40], [190, 190, 200]][seed % 4];
  const coat = hslToRgb(hue, 0.35, 0.34);
  const raw = Buffer.alloc((W * 4 + 1) * H);
  const close = view === 'face';
  const cx = view === 'side' ? W * 0.5 + 6 : W / 2;
  const headY = close ? H * 0.46 : H * 0.28;
  const headRx = close ? 46 : 22;
  const headRy = close ? 58 : 28;
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const t = y / H;
      let [r, g, b] = hslToRgb(hue, 0.18, 0.86 - t * 0.14);
      // Shoulders and body.
      const bodyTop = close ? H * 0.82 : H * 0.5;
      const half = close ? W * 0.62 : W * (0.2 + 0.05 * Math.min(1, (y - bodyTop) / 30));
      if (y > bodyTop && Math.abs(x - cx) < half) [r, g, b] = coat;
      // Neck.
      if (Math.abs(x - cx) < headRx * 0.35 && y > headY && y < bodyTop + 6) [r, g, b] = skin.map((v) => v - 12) as [number, number, number];
      // Head, hair behind and on top.
      const dx = (x - cx) / headRx;
      const dy = (y - headY) / headRy;
      const d = dx * dx + dy * dy;
      if (d < 1.28 && (view === 'back' || dy < -0.1 || d > 1)) [r, g, b] = hair as [number, number, number];
      if (d < 1 && view !== 'back' && !(dy < -0.55)) [r, g, b] = skin as [number, number, number];
      // Eyes and mouth.
      if (view !== 'back' && !close && Math.abs(dy + 0.05) < 0.07 && (Math.abs(dx - 0.38) < 0.1 || Math.abs(dx + 0.38) < 0.1) && d < 1) [r, g, b] = [40, 40, 50];
      if (view !== 'back' && close && Math.abs(dy + 0.08) < 0.05 && (Math.abs(dx - 0.4) < 0.11 || Math.abs(dx + 0.4) < 0.11) && d < 1) [r, g, b] = [40, 40, 50];
      if (view !== 'back' && Math.abs(dy - 0.5) < 0.04 && Math.abs(dx) < 0.28 && d < 1) [r, g, b] = [170, 90, 90];
      const o = y * (W * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

export const CORE = ['front', 'three-quarter', 'side', 'back', 'face'];
const LABEL: Record<string, string> = { front: 'Front', 'three-quarter': 'Three-quarter', side: 'Side', back: 'Back', face: 'Face close-up', smile: 'Smiling', serious: 'Serious', 'outfit-2': 'Outfit 2' };
const EXTRA = ['smile', 'serious', 'outfit-2'];

export interface MockCharacter {
  id: string;
  name: string;
  age: number;
  status: 'draft' | 'ready';
  sheetStale?: boolean;
  seed: number;
  views: string[];
  traits: Record<string, unknown>;
}

const TRAITS = { style: 'photoreal', gender: 'woman', build: 'Athletic', height: 'Tall', skin: 'Olive', face: 'Oval', eyes: 'Green', hair: 'Long wavy dark brown', marks: 'A small scar over the left eyebrow', outfits: ['A charcoal wool coat over a cream sweater'], personality: 'Dry humour, loyal.' };
export const READY = (id: string, name: string, age: number, seed: number): MockCharacter => ({ id, name, age, status: 'ready', seed, views: [...CORE, ...EXTRA], traits: { ...TRAITS } });
export const DRAFT = (id: string, name: string, age: number, seed: number): MockCharacter => ({ id, name, age, status: 'draft', seed, views: ['front', 'three-quarter'], traits: { ...TRAITS, gender: 'man' } });

const MESSAGES = {
  age: 'A character must be 25 or older. Type their age as a number, 25 or more.',
  real: 'Characters are made-up people, never real or famous ones. Leave out names of real people, “looks like” someone, lookalikes and people you know, and describe the face in your own words.',
};

const stamp = '2026-10-23T10:00:00Z';
const viewOf = (c: MockCharacter, host: (c: MockCharacter, v: string) => string) => ({
  id: c.id,
  name: c.name,
  adult: true,
  fictional: true,
  age: c.age,
  status: c.status,
  sheetStale: c.sheetStale || undefined,
  createdAt: stamp,
  updatedAt: stamp,
  descriptor: `A photorealistic ${c.age}-year-old woman, athletic build, tall, olive skin, oval face, green eyes, long wavy dark brown hair`,
  traits: c.traits,
  seed: c.seed,
  sheet: c.views.map((v) => ({ view: v, label: LABEL[v] ?? v, core: CORE.includes(v), file: `${c.id}/${v}-1.png`, url: host(c, v) })),
});

/** The characters on the AI machine (the routes under /_orbit/studio/characters), kept in memory. */
export async function mockCharacters(page: Page, initial: MockCharacter[] = []) {
  const chars = new Map(initial.map((c) => [c.id, { ...c }]));
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const runs = new Map<string, { views: string[]; polls: number; status: 'running' | 'done' }>();
  let n = 0;
  const url = (c: MockCharacter, v: string) => `/_orbit/studio/characters/file/${c.id}/${v}-1.png?t=tok`;
  await page.route('**/fake-ai/_orbit/studio/characters/file/**', (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[parts.length - 2];
    const view = parts[parts.length - 1].replace(/-\d+\.png$/, '');
    const c = chars.get(id);
    return route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: portrait(c ? c.seed : 1, view) });
  });
  const runState = (c: MockCharacter) => {
    const r = runs.get(c.id);
    if (!r) return { id: null, characterId: c.id, status: 'idle', entries: [], etaSeconds: 0, done: c.views.length, message: null };
    const entries = r.views.map((v, i) => {
      const done = r.status === 'done' || i < r.polls * 3;
      const making = !done && i === r.polls * 3;
      return {
        view: v,
        label: LABEL[v] ?? v,
        core: CORE.includes(v),
        status: done ? 'done' : making ? 'making' : 'todo',
        progress: done ? 100 : making ? 40 : 0,
        attempt: 1,
        error: null,
        position: 0,
        etaSeconds: making ? 45 : null,
        identity: done && v !== 'front' ? { score: v === 'back' ? 52 : 88, checked: true } : null,
      };
    });
    return { id: `run-${c.id}`, characterId: c.id, status: r.status, message: null, entries, etaSeconds: r.status === 'running' ? 150 : 0, done: entries.filter((e) => e.status === 'done').length };
  };
  const advance = (c: MockCharacter) => {
    const r = runs.get(c.id);
    if (!r || r.status === 'done') return;
    r.polls++;
    // Each view is on the character as soon as it is made.
    for (const v of r.views.slice(0, r.polls * 3)) if (!c.views.includes(v)) c.views.push(v);
    if (r.polls >= 2) {
      r.status = 'done';
      for (const v of r.views) if (!c.views.includes(v)) c.views.push(v);
      c.sheetStale = undefined;
    }
  };
  await page.route('**/fake-ai/_orbit/studio/characters**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.includes('/characters/file/')) return route.fallback();
    const rest = u.pathname.replace(/^.*\/_orbit\/studio\/characters/, '').split('/').filter(Boolean);
    const body = req.method() === 'GET' || req.method() === 'DELETE' ? undefined : (req.postDataJSON() as Record<string, unknown>);
    calls.push({ method: req.method(), path: `/${rest.join('/')}`, body });
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    const out = (c: MockCharacter) => viewOf(c, url);
    const bad = (text: unknown, age: unknown) => {
      const t = JSON.stringify(text);
      if (/famous|celebrity|looks like/i.test(t)) return MESSAGES.real;
      if (age !== undefined && age !== null && age !== '' && !(Number(age) >= 25)) return MESSAGES.age;
      return null;
    };
    if (rest.length === 0 && req.method() === 'GET') return json({ characters: [...chars.values()].map(out) });
    if (rest.length === 0 && req.method() === 'POST') {
      const b = body as { name: string; age: string | number; traits: Record<string, unknown> };
      const problem = bad([b.name, b.traits], b.age);
      if (problem) return json({ error: problem, blocked: true }, 422);
      const c: MockCharacter = { id: `new${++n}`, name: b.name, age: Number(b.age), status: 'draft', seed: 11 + n, views: [], traits: b.traits };
      chars.set(c.id, c);
      return json({ character: out(c) }, 201);
    }
    if (rest[0] === 'check') {
      const b = body as { name?: string; age?: string | number; traits?: Record<string, unknown> };
      return json({ problem: bad([b.name, b.traits], b.age) });
    }
    const c = chars.get(rest[0]);
    if (!c) return json({ error: 'That character is not in your library any more.' }, 404);
    if (rest.length === 1 && req.method() === 'GET') return json({ character: out(c) });
    if (rest.length === 1 && req.method() === 'PUT') {
      const b = body as { name: string; age: string | number; traits: Record<string, unknown> };
      const problem = bad([b.name, b.traits], b.age);
      if (problem) return json({ error: problem, blocked: true }, 422);
      const changed = JSON.stringify(c.traits.hair) !== JSON.stringify(b.traits.hair);
      Object.assign(c, { name: b.name, age: Number(b.age), traits: b.traits });
      if (changed && c.views.length) Object.assign(c, { sheetStale: true, status: 'draft' });
      return json({ character: out(c) });
    }
    if (rest.length === 1 && req.method() === 'DELETE') {
      chars.delete(c.id);
      return json({ ok: true });
    }
    if (rest[1] === 'rename') {
      c.name = String((body as { name: string }).name);
      return json({ character: out(c) });
    }
    if (rest[1] === 'duplicate') {
      const copy = { ...c, id: `new${++n}`, name: `${c.name} copy`, views: [...c.views] };
      chars.set(copy.id, copy);
      return json({ character: out(copy) }, 201);
    }
    if (rest[1] === 'accept') {
      if (!CORE.every((v) => c.views.includes(v)) || c.sheetStale) return json({ error: 'The reference sheet is not finished yet.' }, 409);
      c.status = 'ready';
      return json({ character: out(c) });
    }
    if (rest[1] === 'sheet') {
      if (rest.length === 2 && req.method() === 'GET') {
        advance(c);
        return json({ run: runState(c), character: out(c) });
      }
      if (rest.length === 2 && req.method() === 'POST') {
        const b = body as { extras?: boolean; redo?: boolean; views?: string[] };
        if (b.redo) c.views = [];
        const all = [...CORE, ...(b.extras === false ? [] : EXTRA)];
        runs.set(c.id, { views: b.views ?? all.filter((v) => !c.views.includes(v)), polls: 0, status: 'running' });
        return json({ run: runState(c) });
      }
      if (rest[2] === 'stop') return json({ run: runState(c) });
      runs.set(c.id, { views: [rest[2]], polls: 0, status: 'running' });
      return json({ run: runState(c) });
    }
    return json({ error: 'nope' }, 404);
  });
  return { chars, calls };
}

/** What cloud storage holds (the site's /api/characters), with links on the storage host. */
export async function mockStoredCharacters(page: Page, list: MockCharacter[], configured = true) {
  const R2 = 'https://acct.r2.cloudflarestorage.com/orbit-models/characters';
  await page.route(`${R2}/**`, (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const view = parts[parts.length - 1].replace(/-\d+\.png$/, '');
    const id = parts[parts.length - 2];
    const c = list.find((x) => x.id === id);
    return route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: portrait(c ? c.seed : 1, view) });
  });
  await page.route('**/api/characters', (route) =>
    route.fulfill({ json: { configured, characters: configured ? list.map((c) => viewOf(c, (ch, v) => `${R2}/${ch.id}/${v}-1.png?X-Amz-Signature=abc`)) : [] } }),
  );
}
