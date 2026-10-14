import type { FileStore } from '../../files/types';
import type { TerminalBackend, TerminalSize, TerminalStatus } from '../types';
import { CLEAR_SCREEN, columns, displayWidth, style, toCRLF } from './ansi';
import {
  AGENT_COMMANDS,
  COMMAND_NAMES,
  COMMANDS,
  NOT_AVAILABLE,
  UNAVAILABLE,
  USER,
  agentMessage,
  describeError,
  notFoundMessage,
  unavailableMessage,
  writableRel,
  type Io,
  type ShellContext,
} from './commands';
import { tokenizeInput, type Key } from './keys';
import { expandWord, hasGlob, parseCommandLine, type SimpleCommand, type Word } from './parse';
import { absToString, HOME_PATH, TreeSnapshot, VirtualPaths } from './vfs';

/**
 * Phase 1 terminal backend: a small shell simulated entirely in the browser.
 *
 * - There is no PTY, so this class does its own line editing (cursor keys, history, Tab
 *   completion, Ctrl+C/D/L/U/K/W/Y) and redraws the prompt line with ANSI sequences.
 * - The filesystem is the shared FileStore: the project root appears as ~/<project>.
 * - Like a real shell with "shell integration", it reports the working directory with OSC 7
 *   and each finished command with OSC 133;D, so the UI can show status without knowing it is
 *   talking to a simulation (a Phase 2 PTY running bash/zsh with integration does the same).
 *
 * Nothing here talks to a server. The UI must label it as simulated (see `kind`).
 */

export interface SimulatedShellOptions {
  /** How long the 'connecting' state lasts (lets the UI's connecting state be seen). Default 350 ms. */
  connectDelayMs?: number;
  /** How long `simulateDrop()` stays in 'reconnecting'. Default 1500 ms. */
  reconnectDelayMs?: number;
}

const MAX_HISTORY = 500;
const OSC_HOST = 'orbit-demo';

export const BANNER =
  `${style.bold(style.yellow('Orbit simulated shell'))} — commands run in this browser, not on Ubuntu. Type 'help'.\n` +
  `${style.dim('Files: ~/{project} (stored in this browser, shared with the Code app).')}\n\n`;

/** Index of the previous code point boundary (keeps surrogate pairs together). */
function prevIndex(s: string, i: number): number {
  if (i <= 0) return 0;
  const c = s.charCodeAt(i - 1);
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) {
    const h = s.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return i - 2;
  }
  return i - 1;
}

function nextIndex(s: string, i: number): number {
  if (i >= s.length) return s.length;
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) return i + 2;
  return i + 1;
}

function wordLeft(s: string, i: number): number {
  let j = i;
  while (j > 0 && /\s/.test(s[j - 1])) j--;
  while (j > 0 && !/\s/.test(s[j - 1])) j--;
  return j;
}

function wordRight(s: string, i: number): number {
  let j = i;
  while (j < s.length && /\s/.test(s[j])) j++;
  while (j < s.length && !/\s/.test(s[j])) j++;
  return j;
}

function commonPrefix(items: string[]): string {
  if (items.length === 0) return '';
  let p = items[0];
  for (const s of items) {
    while (!s.startsWith(p)) p = p.slice(0, -1);
  }
  return p;
}

function escapeForShell(name: string): string {
  return name.replace(/([\s'"\\|;&<>()$`*?#!])/g, '\\$1');
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`);
}

export class SimulatedShell implements TerminalBackend {
  readonly kind = 'simulated' as const;
  readonly label = 'Simulated shell — runs in this browser';

  private readonly paths: VirtualPaths;
  private readonly opts: Required<SimulatedShellOptions>;
  private readonly outputListeners = new Set<(data: string) => void>();
  private readonly statusListeners = new Set<(status: TerminalStatus, detail?: string) => void>();
  private _status: TerminalStatus = 'disconnected';
  private size: TerminalSize = { cols: 80, rows: 24 };

  // Session
  private cwd: string[];
  private oldCwd: string[] | null = null;
  private lastExit = 0;
  private _commandsRun = 0;
  private exitRequested: number | null = null;
  private readonly ctx: ShellContext;

  // Line editor
  private line = '';
  private cursor = 0;
  /** Cells from the start of the prompt to where the terminal cursor currently is. */
  private shownCursor = 0;
  private killed = '';
  private atLineStart = true;
  private readonly _history: string[] = [];
  private histIndex: number | null = null;
  private draft = '';

  // Input queue (commands are async because the FileStore is)
  private queue: Key[] = [];
  private busy = false;
  private idleWaiters: (() => void)[] = [];

  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;

  constructor(
    private readonly files: FileStore,
    options: SimulatedShellOptions = {},
  ) {
    this.paths = new VirtualPaths(files.rootName);
    this.opts = { connectDelayMs: 350, reconnectDelayMs: 1500, ...options };
    this.cwd = this.paths.projectAbs;
    const self = this; // the context exposes live getters/setters onto this shell
    this.ctx = {
      paths: this.paths,
      files: this.files,
      get cwd() {
        return self.cwd;
      },
      set cwd(v: string[]) {
        self.cwd = v;
      },
      get oldCwd() {
        return self.oldCwd;
      },
      set oldCwd(v: string[] | null) {
        self.oldCwd = v;
      },
      get cols() {
        return self.size.cols;
      },
      history: this._history,
      env: (name) => self.env(name),
      envEntries: () => self.envEntries(),
      snapshot: async () => new TreeSnapshot(await self.files.list(), self.files.rootName),
      requestExit: (code) => {
        self.exitRequested = code;
      },
      clearScreen: () => {
        self.emit(CLEAR_SCREEN);
        self.atLineStart = true;
      },
    };
  }

  // ---------------------------------------------------------------- public getters (UI + tests)

  get status(): TerminalStatus {
    return this._status;
  }
  /** "~/orbit-demo/src" */
  get cwdDisplay(): string {
    return this.paths.display(this.cwd);
  }
  /** Non-empty command lines submitted in this session. */
  get commandsRun(): number {
    return this._commandsRun;
  }
  get history(): readonly string[] {
    return this._history;
  }
  get dimensions(): TerminalSize {
    return { ...this.size };
  }

  // ---------------------------------------------------------------- TerminalBackend

  connect(size: TerminalSize): Promise<void> {
    this.resize(size);
    if (this._status === 'connecting' && this.connectPromise) return this.connectPromise;
    if (this._status === 'connected' || this._status === 'reconnecting') return Promise.resolve();

    this.resetSession();
    this.setStatus('connecting', 'Starting the simulated shell…');
    this.connectPromise = new Promise<void>((resolve) => {
      this.resolveConnect = resolve;
      this.connectTimer = setTimeout(() => {
        this.connectTimer = null;
        this.resolveConnect = null;
        this.connectPromise = null;
        if (this._status === 'connecting') {
          this.setStatus('connected');
          this.print(BANNER.replace('{project}', this.paths.projectName));
          this.showPrompt();
        }
        resolve();
      }, this.opts.connectDelayMs);
    });
    return this.connectPromise;
  }

  write(data: string): void {
    if (this._status !== 'connected' && this._status !== 'reconnecting') return;
    for (const k of tokenizeInput(data)) this.queue.push(k);
    this.pump();
  }

  resize(size: TerminalSize): void {
    const cols = Math.max(1, Math.floor(size.cols) || 1);
    const rows = Math.max(1, Math.floor(size.rows) || 1);
    this.size = { cols, rows };
  }

  onOutput(listener: (data: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onStatus(listener: (status: TerminalStatus, detail?: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disconnect(): void {
    this.clearTimers();
    this.queue = [];
    if (this.resolveConnect) {
      this.resolveConnect();
      this.resolveConnect = null;
      this.connectPromise = null;
    }
    if (this._status !== 'disconnected') this.setStatus('disconnected', 'The session was closed.');
    this.flushIdle();
  }

  // ---------------------------------------------------------------- demo-only helpers

  /** Demo only: pretend the network dropped, so the UI's reconnecting state can be reviewed. */
  simulateDrop(): void {
    if (this._status !== 'connected') return;
    this.setStatus('reconnecting', 'Simulated connection drop');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this._status !== 'reconnecting') return;
      this.setStatus('connected');
      if (!this.busy) {
        this.moveToEndOfInput();
        this.emit('\r\n' + style.dim('[reconnected — the connection drop was simulated]') + '\r\n');
        this.atLineStart = true;
        this.showPrompt();
      }
      this.pump();
    }, this.opts.reconnectDelayMs);
  }

  /** Resolves when all queued input has been processed (used by tests). */
  whenIdle(): Promise<void> {
    if (!this.busy && (this.queue.length === 0 || this._status !== 'connected')) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---------------------------------------------------------------- internals: lifecycle

  private setStatus(status: TerminalStatus, detail?: string) {
    this._status = status;
    for (const l of this.statusListeners) l(status, detail);
  }

  private clearTimers() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.connectTimer = null;
    this.reconnectTimer = null;
  }

  private resetSession() {
    this.cwd = this.paths.projectAbs;
    this.oldCwd = null;
    this.lastExit = 0;
    this._commandsRun = 0;
    this.exitRequested = null;
    this.line = '';
    this.cursor = 0;
    this.shownCursor = 0;
    this.histIndex = null;
    this.draft = '';
    this.atLineStart = true;
    this.queue = [];
  }

  private endSession() {
    this.print('logout\n');
    this.queue = [];
    this.setStatus('disconnected', 'The shell exited. Start a new simulated session to continue.');
  }

  // ---------------------------------------------------------------- internals: output

  private emit(data: string) {
    if (!data) return;
    for (const l of this.outputListeners) l(data);
  }

  /** Write command output (LF line endings) to the terminal. */
  private print(text: string) {
    if (!text) return;
    this.emit(toCRLF(text));
    this.atLineStart = text.endsWith('\n');
  }

  private env(name: string): string | undefined {
    return Object.fromEntries(this.envEntries())[name] ?? (name === '?' ? String(this.lastExit) : undefined);
  }

  private envEntries(): [string, string][] {
    const vars: [string, string][] = [
      ['HOME', HOME_PATH],
      ['USER', USER],
      ['LOGNAME', USER],
      ['HOSTNAME', OSC_HOST],
      ['SHELL', 'orbit-sh (simulated)'],
      ['TERM', 'xterm-256color'],
      ['LANG', 'en_US.UTF-8'],
      ['PWD', absToString(this.cwd)],
    ];
    if (this.oldCwd) vars.push(['OLDPWD', absToString(this.oldCwd)]);
    return vars;
  }

  private promptString(): string {
    return `${style.boldGreen(`${USER}@orbit`)}:${style.boldBlue(this.paths.display(this.cwd))}$ `;
  }

  private showPrompt() {
    if (!this.atLineStart) this.emit('\r\n');
    // OSC 7: report the working directory (like vte.sh / zsh do on Ubuntu).
    this.emit(`\x1b]7;file://${OSC_HOST}${encodeURI(absToString(this.cwd))}\x07`);
    this.shownCursor = 0;
    this.redraw();
  }

  /**
   * Redraw prompt + input and place the cursor. Wrap-aware: the prompt always starts at column 0,
   * so the cursor's row/column follow from cell offsets and the terminal width.
   */
  private redraw() {
    const cols = Math.max(1, this.size.cols);
    const prompt = this.promptString();
    const pw = displayWidth(prompt);
    let s = '';
    const fromRow = Math.floor(this.shownCursor / cols);
    if (fromRow > 0) s += `\x1b[${fromRow}A`;
    s += '\r\x1b[J' + prompt + this.line;
    const end = pw + displayWidth(this.line);
    const target = pw + displayWidth(this.line.slice(0, this.cursor));
    let endRow = Math.floor(end / cols);
    if (end > 0 && end % cols === 0) {
      // The terminal is in its "pending wrap" state at the right margin; make the wrap explicit.
      s += '\r\n';
      endRow = end / cols;
    }
    const targetRow = Math.floor(target / cols);
    const targetCol = target % cols;
    if (target !== end) {
      if (endRow > targetRow) s += `\x1b[${endRow - targetRow}A`;
      s += '\r' + (targetCol > 0 ? `\x1b[${targetCol}C` : '');
    }
    this.emit(s);
    this.shownCursor = target;
    this.atLineStart = false;
  }

  /** Put the terminal cursor after the last input character (before printing below the input). */
  private moveToEndOfInput() {
    if (this.cursor === this.line.length) return;
    const saved = this.cursor;
    this.cursor = this.line.length;
    this.redraw();
    this.cursor = saved;
  }

  // ---------------------------------------------------------------- internals: input

  private pump() {
    if (this.busy) return;
    while (this.queue.length > 0 && this._status === 'connected') {
      const key = this.queue.shift()!;
      let result: void | Promise<void>;
      try {
        result = this.handleKey(key);
      } catch (err) {
        this.internalError(err);
        continue;
      }
      if (result) {
        this.busy = true;
        result
          .catch((err) => this.internalError(err))
          .finally(() => {
            this.busy = false;
            this.pump();
          });
        return;
      }
    }
    this.flushIdle();
  }

  private flushIdle() {
    if (this.busy) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((w) => w());
  }

  private internalError(err: unknown) {
    this.print(`${this.atLineStart ? '' : '\n'}orbit-sh: internal error: ${describeError(err)}\n`);
    if (this._status === 'connected') this.showPrompt();
  }

  private handleKey(k: Key): void | Promise<void> {
    switch (k.t) {
      case 'text':
        this.line = this.line.slice(0, this.cursor) + k.s + this.line.slice(this.cursor);
        this.cursor += k.s.length;
        this.redraw();
        return;
      case 'enter':
        return this.submit();
      case 'backspace':
        if (this.cursor > 0) {
          const p = prevIndex(this.line, this.cursor);
          this.line = this.line.slice(0, p) + this.line.slice(this.cursor);
          this.cursor = p;
          this.redraw();
        }
        return;
      case 'delete':
        this.deleteForward();
        return;
      case 'tab':
        return this.complete();
      case 'left':
        return this.moveCursor(prevIndex(this.line, this.cursor));
      case 'right':
        return this.moveCursor(nextIndex(this.line, this.cursor));
      case 'home':
        return this.moveCursor(0);
      case 'end':
        return this.moveCursor(this.line.length);
      case 'wordLeft':
        return this.moveCursor(wordLeft(this.line, this.cursor));
      case 'wordRight':
        return this.moveCursor(wordRight(this.line, this.cursor));
      case 'killWordBack':
        return this.killWordBack();
      case 'up':
        return this.historyPrev();
      case 'down':
        return this.historyNext();
      case 'ctrl':
        return this.ctrlKey(k.c);
    }
  }

  private ctrlKey(c: string): void {
    switch (c) {
      case 'a':
        return this.moveCursor(0);
      case 'e':
        return this.moveCursor(this.line.length);
      case 'b':
        return this.moveCursor(prevIndex(this.line, this.cursor));
      case 'f':
        return this.moveCursor(nextIndex(this.line, this.cursor));
      case 'p':
        return this.historyPrev();
      case 'n':
        return this.historyNext();
      case 'c':
        this.moveToEndOfInput();
        this.emit('^C\r\n');
        this.atLineStart = true;
        this.line = '';
        this.cursor = 0;
        this.histIndex = null;
        this.draft = '';
        this.lastExit = 130;
        this.showPrompt();
        return;
      case 'd':
        if (this.line === '') {
          this.endSession();
          return;
        }
        this.deleteForward();
        return;
      case 'l':
        this.emit('\x1b[2J\x1b[H');
        this.shownCursor = 0;
        this.redraw();
        return;
      case 'u':
        if (this.cursor > 0) {
          this.killed = this.line.slice(0, this.cursor);
          this.line = this.line.slice(this.cursor);
          this.cursor = 0;
          this.redraw();
        }
        return;
      case 'k':
        if (this.cursor < this.line.length) {
          this.killed = this.line.slice(this.cursor);
          this.line = this.line.slice(0, this.cursor);
          this.redraw();
        }
        return;
      case 'w':
        return this.killWordBack();
      case 'y':
        if (this.killed) this.handleKey({ t: 'text', s: this.killed });
        return;
      default:
        return; // other control keys do nothing at the prompt
    }
  }

  private moveCursor(to: number) {
    if (to === this.cursor) return;
    this.cursor = Math.max(0, Math.min(this.line.length, to));
    this.redraw();
  }

  private deleteForward() {
    if (this.cursor >= this.line.length) return;
    this.line = this.line.slice(0, this.cursor) + this.line.slice(nextIndex(this.line, this.cursor));
    this.redraw();
  }

  private killWordBack() {
    const start = wordLeft(this.line, this.cursor);
    if (start === this.cursor) return;
    this.killed = this.line.slice(start, this.cursor);
    this.line = this.line.slice(0, start) + this.line.slice(this.cursor);
    this.cursor = start;
    this.redraw();
  }

  private historyPrev() {
    if (this._history.length === 0) return;
    if (this.histIndex === null) {
      this.draft = this.line;
      this.histIndex = this._history.length;
    }
    if (this.histIndex <= 0) return;
    this.histIndex--;
    this.line = this._history[this.histIndex];
    this.cursor = this.line.length;
    this.redraw();
  }

  private historyNext() {
    if (this.histIndex === null) return;
    if (this.histIndex < this._history.length - 1) {
      this.histIndex++;
      this.line = this._history[this.histIndex];
    } else {
      this.histIndex = null;
      this.line = this.draft;
    }
    this.cursor = this.line.length;
    this.redraw();
  }

  private addHistory(line: string) {
    if (/^\s/.test(line)) return; // HISTCONTROL=ignorespace, like Ubuntu's default
    if (this._history[this._history.length - 1] === line) return; // ignoredups
    this._history.push(line);
    if (this._history.length > MAX_HISTORY) this._history.splice(0, this._history.length - MAX_HISTORY);
  }

  // ---------------------------------------------------------------- internals: Tab completion

  private async complete(): Promise<void> {
    const before = this.line.slice(0, this.cursor);
    let start = this.cursor;
    while (start > 0) {
      const c = before[start - 1];
      if (/[\s|;&<>]/.test(c) && before[start - 2] !== '\\') break;
      start--;
    }
    const raw = before.slice(start);
    const word = raw.replace(/\\(.)/g, '$1');
    const commandPosition = /(^|[|;&])\s*$/.test(before.slice(0, start));

    if (word === '~') {
      this.insertCompletion('/');
      return;
    }

    let base: string;
    let candidates: { name: string; suffix: string; display: string }[];
    if (commandPosition && !word.includes('/')) {
      base = word;
      candidates = COMMAND_NAMES.filter((n) => n.startsWith(word)).map((n) => ({ name: n, suffix: ' ', display: n }));
    } else {
      const slash = word.lastIndexOf('/');
      const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
      base = word.slice(slash + 1);
      const snap = await this.ctx.snapshot();
      const loc = this.paths.locate(this.paths.resolve(dirPart || '.', this.cwd));
      if (snap.kindOf(loc) !== 'dir') return;
      candidates = snap
        .children(loc)
        .filter((e) => e.name.startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.')))
        .map((e) => ({
          name: e.name,
          suffix: e.kind === 'dir' ? '/' : ' ',
          display: e.kind === 'dir' ? style.boldBlue(e.name) + '/' : e.name,
        }));
    }

    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      const c = candidates[0];
      this.insertCompletion(escapeForShell(c.name.slice(base.length)) + c.suffix);
      return;
    }
    const common = commonPrefix(candidates.map((c) => c.name));
    if (common.length > base.length) {
      this.insertCompletion(escapeForShell(common.slice(base.length)));
      return;
    }
    // Ambiguous: list the options under the prompt, then redraw the prompt and input.
    this.moveToEndOfInput();
    this.emit('\r\n');
    this.print(columns(candidates.map((c) => c.display), this.size.cols));
    this.showPrompt();
  }

  private insertCompletion(text: string) {
    if (!text) return;
    this.line = this.line.slice(0, this.cursor) + text + this.line.slice(this.cursor);
    this.cursor += text.length;
    this.redraw();
  }

  // ---------------------------------------------------------------- internals: running commands

  private submit(): void | Promise<void> {
    const line = this.line;
    this.moveToEndOfInput();
    this.emit('\r\n');
    this.atLineStart = true;
    this.line = '';
    this.cursor = 0;
    this.histIndex = null;
    this.draft = '';
    if (!line.trim()) {
      this.showPrompt();
      return;
    }
    this.addHistory(line);
    this._commandsRun++;
    return this.execute(line).then(() => this.afterCommand());
  }

  private afterCommand() {
    if (this._status === 'disconnected') return;
    // OSC 133;D: "command finished" (shell integration), carries the exit status.
    this.emit(`\x1b]133;D;${this.lastExit}\x07`);
    if (this.exitRequested !== null) {
      this.endSession();
      return;
    }
    this.showPrompt();
  }

  private async execute(line: string): Promise<void> {
    const parsed = parseCommandLine(line);
    if (!parsed.ok) {
      this.print(`orbit-sh: ${parsed.error}\n`);
      this.lastExit = 2;
      return;
    }
    for (const item of parsed.list) {
      if (item.op === '&&' && this.lastExit !== 0) continue;
      if (item.op === '||' && this.lastExit === 0) continue;
      this.lastExit = await this.runPipeline(item.pipeline);
      if (this.exitRequested !== null || this._status === 'disconnected') break;
    }
  }

  private expandArgs(words: Word[], snap: TreeSnapshot | null): string[] {
    const out: string[] = [];
    for (const w of words) {
      const text = expandWord(w, (n) => this.env(n), HOME_PATH);
      if (text === null) continue;
      if (snap && hasGlob(w)) {
        const matches = this.glob(text, snap);
        if (matches.length) {
          out.push(...matches);
          continue;
        }
      }
      out.push(text);
    }
    return out;
  }

  /** Expand * and ? in the last path segment (no match → the word stays as typed, like bash). */
  private glob(pattern: string, snap: TreeSnapshot): string[] {
    const slash = pattern.lastIndexOf('/');
    const dirPart = slash >= 0 ? pattern.slice(0, slash + 1) : '';
    const base = pattern.slice(slash + 1);
    if (!base || /[*?]/.test(dirPart)) return [];
    const loc = this.paths.locate(this.paths.resolve(dirPart || '.', this.cwd));
    if (snap.kindOf(loc) !== 'dir') return [];
    const re = globToRegExp(base);
    return snap
      .children(loc)
      .filter((e) => re.test(e.name) && (base.startsWith('.') || !e.name.startsWith('.')))
      .map((e) => dirPart + e.name);
  }

  private async runPipeline(cmds: SimpleCommand[]): Promise<number> {
    let stdin: string | null = null;
    let code = 0;
    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      const last = i === cmds.length - 1;
      const needsSnap = cmd.words.some(hasGlob) || cmd.redirects.length > 0;
      const snap = needsSnap ? await this.ctx.snapshot() : null;
      const argv = this.expandArgs(cmd.words, snap);

      // Redirect target is checked before the command runs (as bash opens it first).
      const redirect = cmd.redirects[cmd.redirects.length - 1];
      let target: { op: '>' | '>>'; rel: string | null } | null = null;
      if (redirect && snap) {
        const t = this.expandArgs([redirect.target], snap);
        if (t.length !== 1) {
          this.print(`orbit-sh: ${t.join(' ') || 'redirect'}: ambiguous redirect\n`);
          code = 1;
          stdin = '';
          continue;
        }
        if (t[0] === '/dev/null') target = { op: redirect.op, rel: null };
        else {
          const loc = this.paths.locate(this.paths.resolve(t[0], this.cwd));
          const w = writableRel(snap, loc);
          if ('error' in w) {
            this.print(`orbit-sh: ${t[0]}: ${w.error}\n`);
            code = 1;
            stdin = '';
            continue;
          }
          target = { op: redirect.op, rel: w.rel };
        }
      }

      const tty = last && !target;
      let buffer = '';
      const io: Io = {
        args: argv.slice(1),
        stdin,
        tty,
        out: tty ? (t) => this.print(t) : (t) => void (buffer += t),
        err: (t) => this.print(t),
      };
      code = argv.length ? await this.runCommand(argv[0], io) : 0;

      if (target) {
        if (target.rel !== null) {
          try {
            let content = buffer;
            if (target.op === '>>') {
              const exists = (await this.files.list()).some((f) => f.path === target.rel);
              if (exists) content = (await this.files.read(target.rel)) + buffer;
            }
            await this.files.write(target.rel, content);
          } catch (err) {
            this.print(`orbit-sh: ${describeError(err)}\n`);
            code = 1;
          }
        }
        stdin = '';
      } else {
        stdin = buffer;
      }
      if (this.exitRequested !== null) break;
    }
    return code;
  }

  private async runCommand(name: string, io: Io): Promise<number> {
    if (Object.hasOwn(COMMANDS, name)) {
      try {
        return await COMMANDS[name].run(io, this.ctx);
      } catch (err) {
        io.err(`${name}: ${describeError(err)}\n`);
        return 1;
      }
    }
    if (AGENT_COMMANDS.has(name)) {
      io.err(agentMessage(name));
      return 127;
    }
    if (Object.hasOwn(UNAVAILABLE, name)) {
      io.err(unavailableMessage(name));
      return 127;
    }
    if (name.includes('/')) {
      const snap = await this.ctx.snapshot();
      const kind = snap.kindOf(this.paths.locate(this.paths.resolve(name, this.cwd)));
      if (kind === 'file') {
        io.err(`orbit-sh: ${name}: running programs is ${NOT_AVAILABLE} — scripts run on the real Ubuntu host in Phase 2.\n`);
        return 126;
      }
      if (kind === 'dir') {
        io.err(`orbit-sh: ${name}: Is a directory\n`);
        return 126;
      }
      io.err(`orbit-sh: ${name}: ${kind === 'outside' ? NOT_AVAILABLE : 'No such file or directory'}\n`);
      return 127;
    }
    io.err(notFoundMessage(name));
    return 127;
  }
}
