/**
 * Pure helpers for the Terminal app: the touch key row, sticky Ctrl, OSC 7 parsing and the
 * App Switcher summary. No DOM or xterm here, so it is unit-tested directly
 * (tests/unit/terminal-keys.test.ts).
 */

import type { TerminalStatus } from '../../services/terminal/types';

export type TouchKeyId =
  | 'esc'
  | 'tab'
  | 'ctrl'
  | 'left'
  | 'up'
  | 'down'
  | 'right'
  | 'shiftUp'
  | 'shiftDown'
  | 'pipe'
  | 'tilde'
  | 'slash'
  | 'dash'
  | 'underscore'
  | 'colon'
  | 'paste';

export interface TouchKey {
  id: TouchKeyId;
  /** What the key shows. */
  label: string;
  /** Accessible name (screen readers, tooltips). */
  ariaLabel: string;
  /** 'send' writes a sequence, 'ctrl' toggles sticky Ctrl, 'paste' reads the clipboard. */
  kind: 'send' | 'ctrl' | 'paste';
}

/** Key row order, left to right. */
export const TOUCH_KEYS: readonly TouchKey[] = [
  { id: 'esc', label: 'Esc', ariaLabel: 'Escape', kind: 'send' },
  { id: 'tab', label: 'Tab', ariaLabel: 'Tab', kind: 'send' },
  { id: 'ctrl', label: 'Ctrl', ariaLabel: 'Control (sticky)', kind: 'ctrl' },
  { id: 'left', label: '←', ariaLabel: 'Arrow left', kind: 'send' },
  { id: 'up', label: '↑', ariaLabel: 'Arrow up', kind: 'send' },
  { id: 'down', label: '↓', ariaLabel: 'Arrow down', kind: 'send' },
  { id: 'right', label: '→', ariaLabel: 'Arrow right', kind: 'send' },
  // Many full-screen programs (agy's scrolling panels, editors) scroll with Shift+arrows.
  { id: 'shiftUp', label: '⇧↑', ariaLabel: 'Shift + arrow up', kind: 'send' },
  { id: 'shiftDown', label: '⇧↓', ariaLabel: 'Shift + arrow down', kind: 'send' },
  { id: 'pipe', label: '|', ariaLabel: 'Pipe', kind: 'send' },
  { id: 'tilde', label: '~', ariaLabel: 'Tilde', kind: 'send' },
  { id: 'slash', label: '/', ariaLabel: 'Slash', kind: 'send' },
  { id: 'dash', label: '-', ariaLabel: 'Hyphen', kind: 'send' },
  { id: 'underscore', label: '_', ariaLabel: 'Underscore', kind: 'send' },
  { id: 'colon', label: ':', ariaLabel: 'Colon', kind: 'send' },
  { id: 'paste', label: 'Paste', ariaLabel: 'Paste from clipboard', kind: 'paste' },
];

const ARROWS: Partial<Record<TouchKeyId, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' };

const LITERALS: Partial<Record<TouchKeyId, string>> = {
  esc: '\x1b',
  tab: '\t',
  shiftUp: '\x1b[1;2A',
  shiftDown: '\x1b[1;2B',
  pipe: '|',
  tilde: '~',
  slash: '/',
  dash: '-',
  underscore: '_',
  colon: ':',
};

/**
 * The bytes a key-row key sends, as a real terminal would. Arrow keys follow the cursor-key mode
 * the running program asked for: normal mode sends CSI (ESC [ A), application mode (vim, less,
 * tmux copy mode…) sends SS3 (ESC O A). Returns '' for keys that send nothing themselves
 * (Ctrl, Paste).
 */
export function keySequence(id: TouchKeyId, opts: { appCursor?: boolean } = {}): string {
  const arrow = ARROWS[id];
  if (arrow) return `\x1b${opts.appCursor ? 'O' : '['}${arrow}`;
  return LITERALS[id] ?? '';
}

/**
 * Ctrl+<input> as xterm would send it, or null when the input has no Ctrl form.
 *  - letters → C0 control codes (c → \x03, case-insensitive)
 *  - the usual punctuation/digit aliases (Ctrl+[ = Esc, Ctrl+- / Ctrl+_ / Ctrl+/ = \x1f, Ctrl+Space = NUL …)
 *  - cursor keys → the "Ctrl modifier" form ESC [ 1 ; 5 X (word-wise movement in bash/readline)
 *  - input that already is a control byte (Tab, Esc, Backspace) passes through unchanged
 */
export function ctrlTransform(data: string): string | null {
  if (data.length === 1) {
    const ch = data;
    const code = ch.charCodeAt(0);
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      return String.fromCharCode(ch.toLowerCase().charCodeAt(0) - 0x60);
    }
    switch (ch) {
      case '@':
      case ' ':
      case '`':
      case '2':
        return '\x00';
      case '[':
      case '3':
        return '\x1b';
      case '\\':
      case '4':
        return '\x1c';
      case ']':
      case '5':
        return '\x1d';
      case '^':
      case '6':
        return '\x1e';
      case '_':
      case '-':
      case '/':
      case '7':
        return '\x1f';
      case '?':
      case '8':
        return '\x7f';
    }
    if (code < 0x20 || code === 0x7f) return data;
    return null;
  }
  // eslint-disable-next-line no-control-regex
  const cursor = /^\x1b[[O]([ABCDHF])$/.exec(data);
  if (cursor) return `\x1b[1;5${cursor[1]}`;
  return null;
}

/**
 * Sticky Ctrl: when armed, the next input (a typed character or a key-row key) is sent as its
 * Ctrl form and Ctrl releases. Input without a Ctrl form (e.g. a multi-character paste, or
 * "é") goes through unchanged, and still releases Ctrl so it never stays stuck.
 */
export function applyStickyCtrl(data: string, armed: boolean): { data: string; armed: boolean } {
  if (!armed || data === '') return { data, armed };
  return { data: ctrlTransform(data) ?? data, armed: false };
}

/** Small enough to zoom a wide terminal all the way out on a phone. */
export const FONT_MIN = 5;
export const FONT_MAX = 24;

export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return 14;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));
}

/**
 * Parse an OSC 7 payload ("file://host/path/with%20spaces") into a short display path.
 * /home/<user>/… and /root/… are shown as ~/…. Returns null for anything that isn't a file URL.
 */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim());
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    path = m[1];
  }
  const home = /^\/home\/[^/]+(?=\/|$)/.exec(path) ?? /^\/root(?=\/|$)/.exec(path);
  if (home) path = '~' + path.slice(home[0].length);
  return path || '/';
}

/** "#6c7cff" + alpha → "#6c7cff59" (xterm wants a colour it can parse without a canvas). */
export function withAlpha(hex: string, alpha: number): string | null {
  const h = hex.trim();
  let rgb: string;
  if (/^#[0-9a-f]{3}$/i.test(h)) rgb = h.slice(1).replace(/./g, (c) => c + c);
  else if (/^#[0-9a-f]{6}$/i.test(h)) rgb = h.slice(1);
  else return null;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${rgb.toLowerCase()}${a}`;
}

export interface SummaryInput {
  mode: 'demo' | 'host';
  status: TerminalStatus;
  /** Working directory if known (OSC 7 or the simulated shell). */
  cwd?: string | null;
  /** Commands run (simulated shell only). */
  commands?: number;
  /** tmux session name (host). */
  session?: string;
  /** Whether the host keeps the shell in tmux across disconnects. */
  persistent?: boolean;
}

/** One line for the App Switcher card. */
export function terminalSummary(s: SummaryInput): string {
  const prefix = s.mode === 'host' ? 'Linux machine' : 'Simulated shell';
  const state: Partial<Record<TerminalStatus, string>> = {
    connecting: 'connecting…',
    reconnecting: 'reconnecting…',
    disconnected: 'session ended',
    error: 'connection problem',
  };
  if (state[s.status]) return `${prefix} · ${state[s.status]}`;
  const parts = [prefix];
  if (s.mode === 'host') {
    parts.push(s.persistent === false ? 'shell' : `tmux session ${s.session ?? 'main'}`);
    if (s.cwd) parts.push(s.cwd);
  } else {
    if (s.cwd) parts.push(s.cwd);
    const n = s.commands ?? 0;
    parts.push(`${n} command${n === 1 ? '' : 's'} run`);
  }
  return parts.join(' · ');
}
