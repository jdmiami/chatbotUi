import type { AppId } from '../state/shell';
import type { Intent } from '../state/workspace';
import type { AiChat } from '../apps/ai/chats';

/**
 * Orbit Space's node model. Everything in the space is a node, and every node is a flat paper
 * page: what you said, replies, files, pictures, machine logs, rooms and apps. This file is pure:
 * it turns what Orbit already knows (chats, recent files, sessions, the machines) into nodes.
 */

export type NodeKind = 'cover' | 'said' | 'reply' | 'file' | 'picture' | 'session' | 'log' | 'room' | 'app' | 'chapter';
/** How a room lays out its pages. */
export type Layout = 'list' | 'stack' | 'grid';
export const LAYOUTS: Layout[] = ['stack', 'list', 'grid'];

type IntentInput = Intent extends infer I ? (I extends { seq: number } ? Omit<I, 'seq'> : never) : never;

/** What opening a page does: the page goes flat and full screen as one of Orbit's apps. */
export interface Open {
  app: AppId;
  intent?: IntentInput;
}

export interface SpaceNode {
  id: string;
  kind: NodeKind;
  /** The small spaced caps line at the top of the page, and its right-hand note. */
  kicker: string;
  meta?: string;
  title: string;
  body?: string;
  foot?: string;
  /** Mono lines (machine logs). */
  lines?: [string, string][];
  /** A picture to show on the page. */
  image?: string;
  /** App pages: which app art to draw. */
  art?: AppId;
  /** The room this page lives in. */
  parent?: string;
  /** When it happened (history order: newest nearest). */
  at?: number;
  open?: Open;
}

export interface Room {
  id: string;
  name: string;
  children: string[];
  /** The layout Orbit picks for this kind of content. */
  layout: Layout;
}

export interface SpaceGraph {
  nodes: Record<string, SpaceNode>;
  /** The path of history, newest first, with chapter numerals between days. Starts with the cover. */
  trunk: string[];
  rooms: Room[];
}

export interface SpaceInput {
  now: Date;
  apps: { id: AppId; name: string; description: string }[];
  chats: AiChat[];
  files: { path: string; at: number }[];
  sessions: { id: string; title: string; projectName: string; at: number }[];
  /** Plain-language machine lines for the log page, e.g. ["Linux", "connected"]. */
  machines: [string, string][];
  greeting: string;
}

/** How many history pages hang in the path before older ones are left in their rooms. */
export const TRUNK_MAX = 14;
const CHATS_MAX = 12;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
/** Strip the most common markdown so a reply reads as plain prose on paper. */
export const plain = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]+/g, '')
    .replace(/^\s*[-+]\s+/gm, '');

export const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
export function dayName(at: number, now: Date): string {
  const d = new Date(at);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
const when = (at: number, now: Date) => {
  const day = dayName(at, now);
  return day === 'Today' ? clock(at) : day;
};
const base = (path: string) => path.split('/').pop() || path;

export function buildGraph(input: SpaceInput): SpaceGraph {
  const { now } = input;
  const nodes: Record<string, SpaceNode> = {};
  const add = (n: SpaceNode) => (nodes[n.id] = n);

  add({
    id: 'cover',
    kind: 'cover',
    kicker: 'Orbit · Space',
    meta: now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
    title: input.greeting,
    body: 'Everything is a page. Tap one and the orb goes with you; tap it again to open it flat.',
    foot: 'Drag to look · pinch to move',
  });

  // ---- history: what you said and what came back, files, sessions and the machines
  const history: SpaceNode[] = [];
  history.push(
    add({
      id: 'log',
      kind: 'log',
      kicker: 'Machine log',
      meta: clock(now.getTime()),
      title: 'Your machines',
      lines: input.machines,
      foot: 'Open the AI app to wake or rest it',
      at: now.getTime(),
      open: { app: 'ai' },
    }),
  );

  const chats = [...input.chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CHATS_MAX);
  const pictures: SpaceNode[] = [];
  chats.forEach((c, ci) => {
    const open: Open = { app: 'ai', intent: { app: 'ai', type: 'open-chat', chatId: c.id } };
    const said = [...c.messages].reverse().find((m) => m.role === 'user' && m.content.trim());
    const reply = [...c.messages].reverse().find((m) => m.role === 'assistant' && plain(m.content).trim());
    // Only the newest few chats hang in the path; every one has a page in Conversations.
    if (ci < 4 && said) {
      history.push(
        add({ id: `said:${c.id}`, kind: 'said', kicker: 'You said', meta: when(c.updatedAt - 1, now), title: `“${clip(said.content, 90)}”`, foot: c.title, at: c.updatedAt - 1, open }),
      );
    }
    if (ci < 4 && reply) {
      history.push(
        add({ id: `reply:${c.id}`, kind: 'reply', kicker: 'Orbit · reply', meta: when(c.updatedAt, now), title: clip(c.title || 'A reply', 48), body: clip(plain(reply.content), 220), foot: reply.model ?? 'Reply', at: c.updatedAt, open }),
      );
    }
    c.messages.forEach((m, mi) => {
      if (m.picture?.url && pictures.length < 24) {
        pictures.push(add({ id: `pic:${c.id}:${mi}`, kind: 'picture', kicker: 'Picture', meta: when(c.updatedAt, now), title: clip(m.picture.prompt || c.title, 60), image: m.picture.url, at: c.updatedAt, open }));
      }
    });
  });

  const files = input.files.map((f) =>
    add({ id: `file:${f.path}`, kind: 'file', kicker: 'File', meta: when(f.at, now), title: base(f.path), body: f.path, at: f.at, open: { app: 'editor', intent: { app: 'editor', type: 'open-file', path: f.path } } }),
  );
  const sessions = input.sessions.map((s) =>
    add({ id: `session:${s.id}`, kind: 'session', kicker: 'Antigravity', meta: when(s.at, now), title: clip(s.title, 60), body: s.projectName, at: s.at, open: { app: 'agent', intent: { app: 'agent', type: 'open-session', sessionId: s.id } } }),
  );
  history.push(...files.slice(0, 3), ...sessions.slice(0, 3));

  // Newest nearest; a chapter numeral opens each earlier day, oldest = 01 (the Folio corridor).
  history.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const shown = history.slice(0, TRUNK_MAX);
  const days: string[] = [];
  for (const n of shown) {
    const d = dayName(n.at ?? 0, now);
    if (!days.includes(d)) days.push(d);
  }
  const trunk: string[] = ['cover'];
  let day = '';
  for (const n of shown) {
    const d = dayName(n.at ?? 0, now);
    if (d !== day) {
      day = d;
      const num = String(days.length - days.indexOf(d)).padStart(2, '0');
      // Today needs no numeral right behind the cover; every earlier day gets one.
      if (trunk.length > 1 || d !== 'Today') {
        add({ id: `chapter:${d}`, kind: 'chapter', kicker: d, title: num });
        trunk.push(`chapter:${d}`);
      }
    }
    trunk.push(n.id);
  }

  // ---- rooms: places that hold their pages, each with the layout that suits it
  const rooms: Room[] = [];
  const room = (id: string, name: string, children: SpaceNode[], layout: Layout, count: string) => {
    if (!children.length) return;
    for (const c of children) if (!c.parent) c.parent = id;
    add({ id, kind: 'room', kicker: 'Room', meta: count, title: name, foot: 'Pinch to spread or gather' });
    rooms.push({ id, name, children: children.map((c) => c.id), layout });
  };
  const apps = input.apps.map((a) =>
    add({ id: `app:${a.id}`, kind: 'app', kicker: 'App', title: a.name, body: a.description, art: a.id, open: { app: a.id } }),
  );
  room('room:apps', 'Apps', apps, 'grid', `${apps.length} apps`);
  // Rooms keep their own copy of a page that also hangs in the path (one page, one place).
  const convo = chats.map((c) =>
    add({ id: `chat:${c.id}`, kind: 'reply', kicker: 'Conversation', meta: when(c.updatedAt, now), title: clip(c.title || 'Untitled', 48), body: clip(plain([...c.messages].reverse().find((m) => m.role === 'assistant')?.content ?? ''), 140), at: c.updatedAt, open: { app: 'ai', intent: { app: 'ai', type: 'open-chat', chatId: c.id } } }),
  );
  room('room:chats', 'Conversations', convo, 'stack', `${convo.length} ${convo.length === 1 ? 'page' : 'pages'}`);
  room('room:pictures', 'Pictures', pictures, 'grid', `${pictures.length} ${pictures.length === 1 ? 'picture' : 'pictures'}`);
  const roomFiles = input.files.map((f) => ({ ...nodes[`file:${f.path}`], id: `rfile:${f.path}`, parent: undefined }));
  roomFiles.forEach(add);
  room('room:files', 'Files', roomFiles, 'list', `${roomFiles.length} ${roomFiles.length === 1 ? 'file' : 'files'}`);
  const roomSessions = input.sessions.map((s) => ({ ...nodes[`session:${s.id}`], id: `rsession:${s.id}`, parent: undefined }));
  roomSessions.forEach(add);
  room('room:sessions', 'Sessions', roomSessions, 'list', `${roomSessions.length} ${roomSessions.length === 1 ? 'session' : 'sessions'}`);

  return { nodes, trunk, rooms };
}

/** The next layout a pinch asks for: spreading goes stack → list → grid, gathering goes back. */
export function nextLayout(current: Layout, dir: 1 | -1): Layout {
  const i = LAYOUTS.indexOf(current);
  return LAYOUTS[clamp(i + dir, 0, LAYOUTS.length - 1)];
}
/** Double-tap: round and round. */
export function cycleLayout(current: Layout): Layout {
  return LAYOUTS[(LAYOUTS.indexOf(current) + 1) % LAYOUTS.length];
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
