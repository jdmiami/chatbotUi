/**
 * Colour maths for the colour panel: hex ↔ HSV (hue, saturation, brightness), colour harmonies on
 * the wheel (complementary, analogous, triad, split), recent colours and palettes kept in this
 * browser.
 */
export interface HSV {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsv(hex: string): HSV {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

export function hsvToHex({ h, s, v }: HSV): string {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function isHex(v: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}
export const normHex = (v: string) => {
  let h = v.trim().replace('#', '').toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
};

export type Harmony = 'complementary' | 'analogous' | 'triad' | 'split';
export const HARMONIES: { id: Harmony; label: string }[] = [
  { id: 'complementary', label: 'Complementary' },
  { id: 'analogous', label: 'Analogous' },
  { id: 'triad', label: 'Triad' },
  { id: 'split', label: 'Split' },
];

/** The colours that go with this one (the hue turned round the wheel), the colour itself first. */
export function harmony(hex: string, mode: Harmony): string[] {
  const c = hexToHsv(hex);
  const turns: Record<Harmony, number[]> = {
    complementary: [0, 180],
    analogous: [0, -30, 30],
    triad: [0, 120, 240],
    split: [0, 150, 210],
  };
  return turns[mode].map((t) => (t ? hsvToHex({ ...c, h: (c.h + t + 360) % 360 }) : normHex(hex)));
}

export function pushRecentColour(list: string[], hex: string, max = 12): string[] {
  const h = normHex(hex);
  return [h, ...list.filter((x) => x !== h)].slice(0, max);
}

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  { id: 'basics', name: 'Basics', colors: ['#1b1b1f', '#6b6b73', '#ffffff', '#d6452b', '#ef8a2e', '#e5c21c', '#2e9b57', '#2f6fdb', '#7a4fd6', '#8a5a3b', '#f2c9a5', '#7fc7e8'] },
  { id: 'skin', name: 'Skin', colors: ['#fbe3d0', '#f2c9a5', '#e5b08c', '#d39a74', '#b97a55', '#9a5e3c', '#7a4529', '#55301c'] },
  { id: 'earth', name: 'Earth', colors: ['#3b2f2a', '#6b4f3a', '#9c7a54', '#c7a77a', '#7d8b5a', '#4f6b44', '#a4562f', '#d9c8a9'] },
  { id: 'pastel', name: 'Pastel', colors: ['#f6c6c8', '#f9dcb8', '#f8f0b5', '#cfeac2', '#bfe3ea', '#c8d3f2', '#dccaf0', '#f2d0e6'] },
  { id: 'ink', name: 'Ink and paper', colors: ['#0d0d0f', '#25272c', '#4a4d55', '#8b8e96', '#c9c6bd', '#ece6d8', '#f8f4ea', '#9b2d20'] },
];

const RECENT_KEY = 'orbit:livedraw:recent-colours';
const MINE_KEY = 'orbit:livedraw:palette';

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && isHex(x)).map(normHex) : [];
  } catch {
    return [];
  }
}
function write(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}
export const loadRecentColours = () => read(RECENT_KEY);
export const saveRecentColours = (l: string[]) => write(RECENT_KEY, l);
export const loadMyPalette = () => read(MINE_KEY);
export const saveMyPalette = (l: string[]) => write(MINE_KEY, l);
