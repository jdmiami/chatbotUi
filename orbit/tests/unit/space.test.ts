import { describe, expect, it } from 'vitest';
import { buildGraph, cycleLayout, nextLayout, plain, type SpaceInput } from '../../src/space/model';
import { arrange, groupSize, placeWorld } from '../../src/space/place';
import type { AiChat } from '../../src/apps/ai/chats';

const NOW = new Date(2026, 9, 20, 15, 0);
const H = 3_600_000;
const chat = (id: string, at: number, extra: Partial<AiChat> = {}): AiChat => ({
  id,
  title: `Chat ${id}`,
  model: 'm',
  createdAt: at,
  updatedAt: at,
  messages: [
    { role: 'user', content: `Question ${id}` },
    { role: 'assistant', content: `**Answer** ${id}`, model: 'Qwen' },
  ],
  ...extra,
});
const input = (over: Partial<SpaceInput> = {}): SpaceInput => ({
  now: NOW,
  greeting: 'Good afternoon.',
  apps: [
    { id: 'ai', name: 'AI', description: 'Chat' },
    { id: 'terminal', name: 'Terminal', description: 'Shell' },
  ],
  chats: [chat('a', NOW.getTime() - H), chat('b', NOW.getTime() - 30 * H)],
  files: [{ path: '/p/main.py', at: NOW.getTime() - 2 * H }],
  sessions: [],
  machines: [
    ['Linux', 'demo workspace'],
    ['AI', 'resting'],
  ],
  ...over,
});

describe('space model', () => {
  it('makes every thing a page: cover, log, what you said, replies, files, rooms and apps', () => {
    const g = buildGraph(input());
    const kinds = new Set(Object.values(g.nodes).map((n) => n.kind));
    for (const k of ['cover', 'log', 'said', 'reply', 'file', 'room', 'app', 'chapter'] as const) expect(kinds).toContain(k);
    expect(g.nodes.log.lines).toEqual([
      ['Linux', 'demo workspace'],
      ['AI', 'resting'],
    ]);
    expect(g.nodes['reply:a'].body).toBe('Answer a');
    expect(g.nodes['said:a'].open).toEqual({ app: 'ai', intent: { app: 'ai', type: 'open-chat', chatId: 'a' } });
    expect(g.nodes['app:terminal'].open).toEqual({ app: 'terminal' });
  });

  it('orders the path newest first, with a numeral before each earlier day', () => {
    const g = buildGraph(input());
    expect(g.trunk[0]).toBe('cover');
    expect(g.trunk[1]).toBe('log'); // now
    expect(g.trunk.slice(2, 5)).toEqual(['reply:a', 'said:a', 'file:/p/main.py']);
    const ch = g.trunk.indexOf('chapter:Yesterday');
    expect(ch).toBeGreaterThan(4);
    expect(g.trunk[ch + 1]).toBe('reply:b');
    // Oldest day = 01, today (the newest) has the highest number but no numeral of its own.
    expect(g.nodes['chapter:Yesterday'].title).toBe('01');
    expect(g.trunk).not.toContain('chapter:Today');
  });

  it('gives each room the layout that suits its content, and skips empty rooms', () => {
    const pics = chat('p', NOW.getTime(), { messages: [{ role: 'assistant', content: '', picture: { url: 'https://x/a.png', prompt: 'a lighthouse' } }] });
    const g = buildGraph(input({ chats: [pics] }));
    const by = Object.fromEntries(g.rooms.map((r) => [r.id, r]));
    expect(by['room:apps'].layout).toBe('grid');
    expect(by['room:pictures'].layout).toBe('grid');
    expect(by['room:chats'].layout).toBe('stack');
    expect(by['room:files'].layout).toBe('list');
    expect(by['room:sessions']).toBeUndefined();
    expect(g.nodes[by['room:pictures'].children[0]].image).toBe('https://x/a.png');
    for (const r of g.rooms) for (const c of r.children) expect(g.nodes[c].parent).toBe(r.id);
  });

  it('pinch spreads stack → list → grid and gathers back; double tap goes round', () => {
    expect(nextLayout('stack', 1)).toBe('list');
    expect(nextLayout('list', 1)).toBe('grid');
    expect(nextLayout('grid', 1)).toBe('grid');
    expect(nextLayout('grid', -1)).toBe('list');
    expect(nextLayout('stack', -1)).toBe('stack');
    expect(cycleLayout('grid')).toBe('stack');
  });

  it('reads markdown as plain prose', () => {
    expect(plain('# Title\n**bold** and `code` and [a link](http://x)')).toBe('Title\nbold and code and a link');
  });
});

describe('space layouts', () => {
  it('grid is a contact sheet, list a column, stack a deck with the top card in front', () => {
    const grid = arrange('grid', 6);
    expect(new Set(grid.map((o) => o.dz))).toEqual(new Set([0]));
    expect(new Set(grid.map((o) => o.dy)).size).toBe(2); // 3 across, 2 rows
    const list = arrange('list', 4);
    expect(new Set(list.map((o) => o.dx))).toEqual(new Set([0]));
    expect(list[0].dy).toBeLessThan(list[3].dy);
    const stack = arrange('stack', 4, 2);
    const front = stack.reduce((b, o, i) => (o.dz > stack[b].dz ? i : b), 0);
    expect(front).toBe(2);
    expect(groupSize('grid', 6).w).toBeGreaterThan(groupSize('stack', 6).w);
  });

  it('places the same world for the same input, with rooms beside the path', () => {
    const g = buildGraph(input());
    const screen = { ax: 1, ay: 1, rm: 1 };
    const a = placeWorld(g, {}, {}, screen);
    const b = placeWorld(g, {}, {}, screen);
    expect(a).toEqual(b);
    // Newest nearest: each page in the path is further back than the one before it.
    const zs = g.trunk.filter((id) => !id.startsWith('chapter:')).map((id) => a.placed[id].pose.z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThan(zs[i - 1]);
    expect(Math.abs(a.placed['room:apps'].pose.x)).toBeGreaterThan(600);
    expect(a.placed['app:ai'].group).toBe('room:apps');
    expect(a.placed['room:apps'].frame).toBeDefined();
    expect(a.placed['chapter:Yesterday'].sculpture).toBe(true);
  });

  it('a different layout moves the cards, not the room', () => {
    const g = buildGraph(input());
    const s = { ax: 1, ay: 1, rm: 1 };
    const grid = placeWorld(g, {}, {}, s);
    const stack = placeWorld(g, { 'room:apps': 'stack' }, {}, s);
    expect(stack.placed['room:apps'].pose).toEqual(grid.placed['room:apps'].pose);
    expect(stack.placed['app:terminal'].pose).not.toEqual(grid.placed['app:terminal'].pose);
  });
});
