import { V, rng, type Vec } from './math';
import type { Layout, NodeKind, SpaceGraph } from './model';

/**
 * Where every page hangs. Pure: the same graph, layouts and screen shape always give the same
 * world, so the orb (not the user) arranges the space and it is easy to test.
 *
 * The world is Look A + C: an ink room where the path of history recedes like a folio corridor
 * (newest nearest, big chapter numerals between days) and rooms hang to the sides, each holding
 * its pages as a list, a stack or a grid.
 */

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical axis and tilt forward (radians), scale and opacity. */
  yaw: number;
  tilt: number;
  s: number;
  a: number;
}

export interface Placed {
  id: string;
  w: number;
  h: number;
  pose: Pose;
  /** The room this page is laid out in. */
  group?: string;
  /** Typographic sculpture (chapter numerals): not tappable, not fogged. */
  sculpture?: boolean;
  /** What the camera frames when it approaches this page (a room frames itself and its pages). */
  frame?: { x: number; y: number; z: number; w: number; h: number };
}

export interface Thread {
  a: string;
  b: string;
  dash?: boolean;
  alpha?: number;
  sag?: number;
}

export interface World {
  placed: Record<string, Placed>;
  threads: Thread[];
  /** Overview: what the camera orbits, how far away, and from which angle. */
  home: { focus: Vec; r: number; th: number; ph: number };
}

export interface Screen {
  /** Narrow screens squeeze the world sideways and stretch it a little in height. */
  ax: number;
  ay: number;
  /** Camera distances scale with the lens so pages read at the same size on any screen. */
  rm: number;
}

export const SIZE: Record<NodeKind, [number, number]> = {
  cover: [320, 340],
  said: [290, 196],
  reply: [300, 350],
  file: [220, 260],
  picture: [220, 260],
  session: [240, 230],
  log: [220, 290],
  room: [290, 200],
  app: [200, 230],
  chapter: [620, 420],
};
/** Pages inside a room are smaller cards of the same paper. */
const CARD: [number, number] = [200, 240];

const pose = (p: Vec, yaw = 0, extra: Partial<Pose> = {}): Pose => ({ x: p.x, y: p.y, z: p.z, yaw, tilt: 0, s: 1, a: 1, ...extra });

/** Where each child card sits relative to its group's centre, for each layout. Exported for tests. */
export function arrange(layout: Layout, n: number, top = 0): { dx: number; dy: number; dz: number; yaw: number; s: number; a: number }[] {
  const [w, h] = CARD;
  const out: { dx: number; dy: number; dz: number; yaw: number; s: number; a: number }[] = [];
  if (layout === 'grid') {
    // A contact sheet: up to four across, rows going down.
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
    const rows = Math.ceil(n / cols);
    const gx = w * 0.86 + 24;
    const gy = h * 0.86 + 24;
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      out.push({ dx: (c - (cols - 1) / 2) * gx, dy: (r - (rows - 1) / 2) * gy, dz: 0, yaw: 0, s: 0.86, a: 1 });
    }
  } else if (layout === 'list') {
    // A contents column: shingled pages, each showing its header, the first one in front.
    const step = h * 0.36;
    for (let i = 0; i < n; i++) {
      out.push({ dx: 0, dy: (i - (n - 1) / 2) * step, dz: -i * 18, yaw: 0, s: 1, a: i < 10 ? 1 : 0.0 });
    }
  } else {
    // A deck: the top card in front, the rest tucked behind it; flipped cards go to the back.
    for (let i = 0; i < n; i++) {
      const k = (i - top + n) % n;
      const seen = k < 6;
      out.push({ dx: k * 9, dy: -k * 9, dz: -k * 26, yaw: k === 0 ? 0 : (k % 2 ? 0.03 : -0.03), s: 1, a: seen ? 1 - k * 0.1 : 0 });
    }
  }
  return out;
}

/** The size of a group's pages for each layout (before the camera frames it). */
export function groupSize(layout: Layout, n: number): { w: number; h: number } {
  const [w, h] = CARD;
  if (layout === 'grid') {
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
    const rows = Math.ceil(n / cols);
    return { w: cols * (w * 0.86 + 24), h: rows * (h * 0.86 + 24) };
  }
  if (layout === 'list') return { w, h: h + (Math.min(n, 10) - 1) * h * 0.36 };
  return { w: w + 50, h: h + 50 };
}

/** Where the rooms hang: alternately left and right, at growing depth. */
const ROOM_SPOTS: [number, number, number, number][] = [
  [-900, -330, -900, 0.42],
  [920, -300, -1500, -0.42],
  [-960, 360, -2100, 0.4],
  [960, 380, -2700, -0.4],
  [-920, -60, -3300, 0.38],
  [940, 20, -3900, -0.38],
];

export function placeWorld(graph: SpaceGraph, layouts: Record<string, Layout>, tops: Record<string, number>, screen: Screen): World {
  const { ax, ay, rm } = screen;
  const S = (x: number, y: number, z: number) => V(x * ax, y * ay, z);
  const placed: Record<string, Placed> = {};
  const threads: Thread[] = [];
  const put = (id: string, p: Pose, extra: Partial<Placed> = {}) => {
    const n = graph.nodes[id];
    const [w, h] = SIZE[n.kind];
    placed[id] = { id, w, h, pose: p, ...extra };
  };

  // ---- the path: the cover in front, then history going back in a zigzag corridor
  let prev: string | null = null;
  let k = 0;
  graph.trunk.forEach((id) => {
    const n = graph.nodes[id];
    if (id === 'cover') {
      // The cover stands to the left, so the newest page shows beside it, not behind it.
      put(id, pose(S(-300, -30, 60), 0.22));
    } else if (n.kind === 'chapter') {
      // The numeral stands off to the side, a little ahead of its day's first page.
      const side = k % 2 ? 1 : -1;
      put(id, pose(S(side * 860, -240 + (k % 3) * 120, -520 - k * 620 + 200), 0, { a: 0.95 }), { sculpture: true });
      return;
    } else {
      const side = k % 2 ? -1 : 1;
      put(id, pose(S(side * 330, ((k % 3) - 1) * 70, -520 - k * 620), -side * 0.36));
      k++;
    }
    if (prev) threads.push({ a: prev, b: id, sag: 0.02 });
    prev = id;
  });

  // ---- rooms and their pages
  const r = rng(17);
  graph.rooms.forEach((room, i) => {
    const spot = ROOM_SPOTS[i % ROOM_SPOTS.length];
    const far = Math.floor(i / ROOM_SPOTS.length) * 2400;
    const side = Math.sign(spot[0]);
    const roomPos = S(spot[0], spot[1], spot[2] - far);
    const layout = layouts[room.id] ?? room.layout;
    const n = room.children.length;
    const size = groupSize(layout, n);
    // The pages hang beside their room, on the side away from the path.
    const gap = 70;
    const centre = V(roomPos.x + side * (SIZE.room[0] / 2 + gap + size.w / 2), roomPos.y + 40, roomPos.z - 40);
    const yaw = spot[3] * 0.6;
    const frameW = SIZE.room[0] + gap + size.w;
    const frameH = Math.max(SIZE.room[1], size.h);
    const frame = { x: (roomPos.x + centre.x) / 2, y: centre.y - 20, z: (roomPos.z + centre.z) / 2, w: frameW, h: frameH };
    put(room.id, pose(roomPos, yaw), { frame });
    threads.push({ a: 'cover', b: room.id, alpha: 0.55, sag: 0.06 });
    const offsets = arrange(layout, n, tops[room.id] ?? 0);
    room.children.forEach((cid, j) => {
      const o = offsets[j];
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      // Offsets turn with the room so the group faces the same way it does.
      const p = V(centre.x + o.dx * c + o.dz * sn, centre.y + o.dy, centre.z - o.dx * sn + o.dz * c);
      placed[cid] = { id: cid, w: CARD[0], h: CARD[1], pose: pose(p, yaw + o.yaw, { s: o.s, a: o.a, tilt: (r() - 0.5) * 0.02 }), group: room.id };
    });
  });

  return { placed, threads, home: { focus: S(0, -20, -520), r: 1650 * rm, th: -0.12, ph: 0.1 } };
}
