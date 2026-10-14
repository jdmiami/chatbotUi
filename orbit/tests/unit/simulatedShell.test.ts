import { describe, expect, it, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { LocalFileStore } from '../../src/services/files/local/LocalFileStore';
import { SimulatedShell } from '../../src/services/terminal/simulated/SimulatedShell';
import { stripAnsi } from '../../src/services/terminal/simulated/ansi';
import { parseCommandLine } from '../../src/services/terminal/simulated/parse';
import { tokenizeInput } from '../../src/services/terminal/simulated/keys';
import type { TerminalStatus } from '../../src/services/terminal/types';

// jsdom has no canvas; xterm only probes it. Silence the "not implemented" noise.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

/** Minimal in-memory Storage so each test gets a fresh seeded project. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

const UP = '\x1b[A';
const DOWN = '\x1b[B';
const LEFT = '\x1b[D';

/**
 * A shell wired to a headless xterm, so assertions see what the user would see on screen
 * (including the effect of the line editor's cursor movement and redraws).
 */
async function setup({ cols = 80, rows = 30 }: { cols?: number; rows?: number } = {}) {
  const store = new LocalFileStore(new MemoryStorage(), 'test:files');
  const shell = new SimulatedShell(store, { connectDelayMs: 0, reconnectDelayMs: 20 });
  const term = new Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true });
  let raw = '';
  let rendered = Promise.resolve();
  shell.onOutput((d) => {
    raw += d;
    rendered = rendered.then(() => new Promise<void>((r) => term.write(d, r)));
  });
  const statuses: TerminalStatus[] = [];
  shell.onStatus((s) => statuses.push(s));

  const settle = async () => {
    await shell.whenIdle();
    await rendered;
  };
  const type = async (data: string) => {
    shell.write(data);
    await settle();
  };
  /** Run one command line; returns its plain-text output (everything printed after Enter). */
  const run = async (line: string) => {
    await type(line);
    const start = raw.length;
    await type('\r');
    // Output starts after the newline that Enter prints; drop the prompt that follows it.
    const out = stripAnsi(raw.slice(start)).replace(/^\r\n/, '');
    return out.replace(/\r?demo@orbit:[^\n]*\$ $/, '');
  };
  /** Screen + scrollback as logical lines (soft-wrapped rows joined, trailing spaces trimmed). */
  const screenLines = () => {
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const row = buf.getLine(i);
      const text = row?.translateToString(true) ?? '';
      if (row?.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    for (let i = 0; i < lines.length; i++) lines[i] = lines[i].trimEnd();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const screen = () => screenLines().join('\n');
  /** The visible text of the row the cursor is on. */
  const cursorLine = () => {
    const buf = term.buffer.active;
    return (buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? '').trimEnd();
  };

  await shell.connect({ cols, rows });
  await settle();
  return { store, shell, term, statuses, type, run, screen, cursorLine, settle, raw: () => raw };
}

const PROMPT = 'demo@orbit:~/orbit-demo$ ';
const BARE_PROMPT = PROMPT.trimEnd();

describe('SimulatedShell: session lifecycle', () => {
  it('goes connecting → connected and prints a banner and a prompt', async () => {
    const t = await setup();
    expect(t.statuses).toEqual(['connecting', 'connected']);
    expect(t.shell.status).toBe('connected');
    expect(t.screen()).toContain("Orbit simulated shell — commands run in this browser, not on your Linux machine. Type 'help'.");
    expect(t.cursorLine()).toBe(BARE_PROMPT);
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length);
    expect(t.shell.kind).toBe('simulated');
  });

  it('exit → disconnected, ignores input, and connect() starts a fresh session', async () => {
    const t = await setup();
    await t.run('cd src');
    await t.run('exit');
    expect(t.statuses.at(-1)).toBe('disconnected');
    expect(t.screen()).toContain('logout');

    const before = t.raw().length;
    t.shell.write('ls\r');
    await t.settle();
    expect(t.raw().length).toBe(before);

    await t.shell.connect({ cols: 80, rows: 30 });
    await t.settle();
    expect(t.statuses.slice(-2)).toEqual(['connecting', 'connected']);
    expect(t.cursorLine()).toBe(BARE_PROMPT); // back in the project root
    expect(t.shell.commandsRun).toBe(0);
  });

  it('Ctrl+D on an empty line exits; on a non-empty line it deletes forward', async () => {
    const t = await setup();
    await t.type('abc' + LEFT + LEFT + '\x04');
    expect(t.cursorLine()).toBe(PROMPT + 'ac');
    expect(t.shell.status).toBe('connected');
    await t.type('\x05\x15\x04'); // Ctrl+E, Ctrl+U clears, then Ctrl+D
    expect(t.shell.status).toBe('disconnected');
  });

  it('simulateDrop() goes reconnecting → connected and keeps the typed input', async () => {
    const t = await setup();
    await t.type('echo still here');
    t.shell.simulateDrop();
    expect(t.shell.status).toBe('reconnecting');
    await new Promise((r) => setTimeout(r, 40));
    await t.settle();
    expect(t.statuses.slice(-2)).toEqual(['reconnecting', 'connected']);
    expect(t.cursorLine()).toBe(PROMPT + 'echo still here');
    expect(await t.run('')).toContain('still here');
  });

  it('resize() stores the size and ls lays out columns for it', async () => {
    const t = await setup({ cols: 80 });
    t.shell.resize({ cols: 20, rows: 10 });
    expect(t.shell.dimensions).toEqual({ cols: 20, rows: 10 });
    const out = await t.run('ls');
    const rows = out.trim().split(/\r\n/);
    expect(rows.length).toBeGreaterThan(1);
    rows.forEach((r) => expect(r.length).toBeLessThanOrEqual(20));
  });

  it('reports cwd with OSC 7 and finished commands with OSC 133;D', async () => {
    const t = await setup();
    expect(t.raw()).toContain('\x1b]7;file://orbit-demo/home/demo/orbit-demo\x07');
    await t.run('cd config');
    expect(t.raw()).toContain('\x1b]7;file://orbit-demo/home/demo/orbit-demo/config\x07');
    expect(t.raw()).toContain('\x1b]133;D;0\x07');
    await t.run('nope');
    expect(t.raw()).toContain('\x1b]133;D;127\x07');
    expect(t.shell.commandsRun).toBe(2);
    expect(t.shell.cwdDisplay).toBe('~/orbit-demo/config');
  });
});

describe('SimulatedShell: commands', () => {
  it('help, whoami, hostname, uname, date', async () => {
    const t = await setup();
    const help = await t.run('help');
    for (const name of ['ls', 'cd', 'cat', 'echo', 'grep', 'history', 'exit']) expect(help).toContain(name);
    expect(await t.run('whoami')).toBe('demo\r\n');
    expect(await t.run('hostname')).toBe('orbit-demo (simulated)\r\n');
    const uname = await t.run('uname -a');
    expect(uname).toMatch(/simulated/i);
    expect(uname).toContain('no Linux kernel');
    expect(await t.run('date')).toMatch(/^\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d/);
  });

  it('ls, ls -l, ls -a', async () => {
    const t = await setup();
    const ls = await t.run('ls');
    for (const name of ['README.md', 'config/', 'notes/', 'src/']) expect(ls).toContain(name);
    const long = await t.run('ls -l src');
    expect(long).toMatch(/-rw-r--r-- 1 demo demo +\d+ \w{3} [ \d]\d .* app\.py/);
    expect(await t.run('ls -a')).toMatch(/^\.\/\s+\.\.\/\s/);
    expect(await t.run('ls nope')).toContain("ls: cannot access 'nope': No such file or directory");
  });

  it('cd and pwd, including .., ~, - and paths outside the project', async () => {
    const t = await setup();
    expect(await t.run('pwd')).toBe('/home/demo/orbit-demo\r\n');
    await t.run('cd src');
    expect(t.cursorLine()).toBe('demo@orbit:~/orbit-demo/src$');
    expect(await t.run('pwd')).toBe('/home/demo/orbit-demo/src\r\n');
    await t.run('cd ..');
    expect(await t.run('pwd')).toBe('/home/demo/orbit-demo\r\n');
    await t.run('cd');
    expect(t.cursorLine()).toBe('demo@orbit:~$');
    expect(await t.run('ls')).toContain('orbit-demo/');
    expect(await t.run('cd -')).toBe('/home/demo/orbit-demo\r\n');
    expect(await t.run('cd /etc')).toContain('not available in the simulated shell');
    expect(await t.run('cd nope')).toContain('cd: nope: No such file or directory');
    expect(await t.run('cd README.md')).toContain('Not a directory');
    expect(await t.run('ls /')).toContain('not available in the simulated shell');
    expect(await t.run('cat /etc/passwd')).toContain('not available in the simulated shell');
  });

  it('cat prints a seeded file and reports errors', async () => {
    const t = await setup();
    const out = await t.run('cat README.md');
    expect(out).toContain('# orbit-demo');
    expect(out).toContain('sample project stored in your browser');
    expect(await t.run('cat nope.txt')).toContain('cat: nope.txt: No such file or directory');
    expect(await t.run('cat src')).toContain('cat: src: Is a directory');
  });

  it('echo > and >> write through the FileStore (the Code app sees the change)', async () => {
    const t = await setup();
    const changed = vi.fn();
    t.store.subscribe(changed);
    await t.run('echo hello world > notes/hello.txt');
    expect(await t.store.read('notes/hello.txt')).toBe('hello world\n');
    expect(changed).toHaveBeenCalled();
    await t.run("echo 'second line' >> notes/hello.txt");
    expect(await t.store.read('notes/hello.txt')).toBe('hello world\nsecond line\n');
    expect(await t.run('cat notes/hello.txt')).toBe('hello world\r\nsecond line\r\n');
    expect(await t.run('echo nope > /etc/motd')).toContain('not available in the simulated shell');
    expect(await t.run('echo $HOME "$USER" \'$USER\'')).toBe('/home/demo demo $USER\r\n');
  });

  it('touch, rm, mv, cp, mkdir', async () => {
    const t = await setup();
    await t.run('touch empty.txt');
    expect(await t.store.read('empty.txt')).toBe('');
    await t.run('mv empty.txt notes');
    expect(await t.store.read('notes/empty.txt')).toBe('');
    await t.run('cp README.md copy.md');
    expect(await t.store.read('copy.md')).toContain('# orbit-demo');
    await t.run('rm copy.md');
    await expect(t.store.read('copy.md')).rejects.toThrow();
    expect(await t.run('rm src')).toContain('Is a directory');
    await t.run('mv src lib');
    expect(await t.store.read('lib/app.py')).toContain('Greeting');
    const mk = await t.run('mkdir build');
    expect(mk).toContain('folders are implicit');
    expect(mk).toContain('saved inside it');
  });

  it('head, tail, wc, grep and pipes', async () => {
    const t = await setup();
    expect(await t.run('head -n 1 README.md')).toBe('# orbit-demo\r\n');
    expect(await t.run('tail -n 1 notes/todo.md')).toBe('- [ ] Drive the real Antigravity CLI\r\n');
    expect(await t.run('wc -l notes/todo.md')).toBe('5 notes/todo.md\r\n');
    // Line numbers are 1-based like GNU grep; derive them from the seeded file so a seed edit
    // doesn't silently break the expectation (render is on line 10 of the current seed).
    const appLines = (await t.store.read('src/app.py')).split('\n');
    const lineOf = (needle: string) => appLines.findIndex((l) => l.includes(needle)) + 1;
    const grep = await t.run('grep -n def src/app.py');
    expect(grep).toContain(`${lineOf('def render')}:    def render(self) -> str:`);
    expect(grep).toContain(`${lineOf('def main')}:def main() -> None:`);
    expect(grep.trim().split('\r\n')).toHaveLength(2);
    expect(await t.run('cat src/app.py | grep -c def')).toBe('2\r\n');
    expect(await t.run('grep -ri todo .')).toContain('notes/todo.md:# TODO');
    expect(await t.run('ls src/*.py')).toContain('src/app.py');
  });

  it('history lists previous commands', async () => {
    const t = await setup();
    await t.run('pwd');
    await t.run('whoami');
    expect(await t.run('history')).toBe('    1  pwd\r\n    2  whoami\r\n    3  history\r\n');
  });

  it('explains unavailable tools, agy, and unknown commands', async () => {
    const t = await setup();
    const sudo = await t.run('sudo apt update');
    expect(sudo).toContain('sudo: not available in the simulated shell');
    expect(sudo).toContain('runs on your Linux machine when Orbit is connected');
    expect(await t.run('git status')).toContain('not available in the simulated shell');
    expect(await t.run('vim README.md')).toContain('open the Code app');
    expect(await t.run('agy')).toContain("The Antigravity CLI isn't available here; open the Antigravity app (simulated)");
    expect(await t.run('antigravity --help')).toContain('open the Antigravity app (simulated)');
    expect(await t.run('frobnicate')).toBe("frobnicate: command not found (simulated shell). Type 'help'.\r\n");
    expect(await t.run('constructor')).toContain('command not found');
  });

  it('clear and Ctrl+L clear the screen', async () => {
    const t = await setup();
    const before = t.raw().length;
    await t.run('clear');
    expect(t.raw().slice(before)).toContain('\x1b[2J\x1b[H');
    expect(t.screen().split('\n')[0]).toBe(BARE_PROMPT);
    await t.type('ls');
    const mark = t.raw().length;
    await t.type('\x0c');
    expect(t.raw().slice(mark)).toContain('\x1b[2J\x1b[H');
    expect(t.cursorLine()).toBe(PROMPT + 'ls');
  });
});

describe('SimulatedShell: line editing', () => {
  it('recalls history with Up/Down and runs the recalled line', async () => {
    const t = await setup();
    await t.run('pwd');
    await t.run('whoami');
    await t.type('draft');
    await t.type(UP);
    expect(t.cursorLine()).toBe(PROMPT + 'whoami');
    await t.type(UP);
    expect(t.cursorLine()).toBe(PROMPT + 'pwd');
    await t.type(UP); // stays at the oldest entry
    expect(t.cursorLine()).toBe(PROMPT + 'pwd');
    await t.type(DOWN);
    expect(t.cursorLine()).toBe(PROMPT + 'whoami');
    await t.type(DOWN);
    expect(t.cursorLine()).toBe(PROMPT + 'draft');
    await t.type('\x15' + UP + UP);
    expect(await t.run('')).toBe('/home/demo/orbit-demo\r\n');
  });

  it('Ctrl+C prints ^C, discards the line and shows a new prompt', async () => {
    const t = await setup();
    await t.type('ls -l');
    const start = t.raw().length;
    await t.type('\x03');
    const lines = t.screen().split('\n');
    expect(lines.at(-2)).toBe(PROMPT + 'ls -l^C');
    expect(t.cursorLine()).toBe(BARE_PROMPT);
    expect(stripAnsi(t.raw().slice(start))).not.toContain('README.md');
    expect(await t.run('echo $?')).toBe('130\r\n');
  });

  it('cursor movement, Home/End, Backspace, Delete, Ctrl+U/K/W/Y', async () => {
    const t = await setup();
    await t.type('ech hi');
    await t.type(LEFT + LEFT + LEFT + 'o');
    expect(t.cursorLine()).toBe(PROMPT + 'echo hi');
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length + 4);
    await t.type('\x1b[H'); // Home
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length);
    await t.type('\x1b[F'); // End
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length + 7);
    await t.type('\x01\x1b[3~\x05\x7f'); // Ctrl+A, Delete, Ctrl+E, Backspace
    expect(t.cursorLine()).toBe(PROMPT + 'cho h');
    await t.type('\x17'); // Ctrl+W kills "h" and keeps the space before it (bash unix-word-rubout)
    // cursorLine() trims trailing blanks, so the kept space shows up as the cursor column.
    expect(t.cursorLine()).toBe(PROMPT + 'cho');
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length + 'cho '.length);
    await t.type('\x19'); // Ctrl+Y yanks it back
    expect(t.cursorLine()).toBe(PROMPT + 'cho h');
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length + 'cho h'.length);
    await t.type('\x01\x0b'); // Ctrl+A, Ctrl+K
    expect(t.cursorLine()).toBe(BARE_PROMPT);
    await t.type('abc\x15');
    expect(t.cursorLine()).toBe(BARE_PROMPT);
  });

  it('Ctrl+W kills whitespace before the cursor plus the word before it, like readline', async () => {
    const t = await setup();
    await t.type('echo foo  bar  ');
    await t.type('\x17');
    expect(t.cursorLine()).toBe(PROMPT + 'echo foo');
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length + 'echo foo  '.length);
    await t.type('\x17');
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length + 'echo '.length);
    // Ctrl+W in the middle of a word kills only up to the cursor.
    await t.type('\x15hello world' + LEFT + LEFT + '\x17');
    expect(t.cursorLine()).toBe(PROMPT + 'hello ld');
    // Ctrl+Y re-inserts the last kill at the cursor.
    await t.type('\x19');
    expect(t.cursorLine()).toBe(PROMPT + 'hello world');
    // Nothing to kill at the start of the line.
    await t.type('\x01\x17');
    expect(t.cursorLine()).toBe(PROMPT + 'hello world');
  });

  it('redraws correctly when the input wraps past the terminal width', async () => {
    const t = await setup({ cols: 30 });
    const long = 'echo ' + 'x'.repeat(40);
    await t.type(long);
    await t.type('\x01'); // to start
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length);
    await t.type('\x1b[C\x1b[C\x1b[C\x1b[C\x1b[C' + 'y '); // after "echo "
    expect(t.screen().split('\n').at(-1)).toBe(PROMPT + 'echo y ' + 'x'.repeat(40));
    const buf = t.term.buffer.active;
    expect(buf.cursorX).toBe((PROMPT.length + 'echo y '.length) % 30);
    await t.type('\r');
    expect(t.screen().split('\n').slice(-2)).toEqual(['y ' + 'x'.repeat(40), BARE_PROMPT]);
  });

  it('Tab completes command names and file/dir paths, and lists ambiguous matches', async () => {
    const t = await setup();
    await t.type('wh\t');
    expect(t.cursorLine()).toBe(PROMPT + 'whoami');
    expect(t.term.buffer.active.cursorX).toBe(PROMPT.length + 'whoami '.length);
    await t.type('\x15cat REA\t');
    expect(t.cursorLine()).toBe(PROMPT + 'cat README.md');
    await t.type('\x15cd sr\t');
    expect(t.cursorLine()).toBe(PROMPT + 'cd src/');
    await t.type('\x15cat src/\t');
    const s = t.screen();
    expect(s).toContain('app.py');
    expect(s).toContain('utils.ts');
    expect(t.cursorLine()).toBe(PROMPT + 'cat src/');
    await t.type('a\t');
    expect(t.cursorLine()).toBe(PROMPT + 'cat src/app.py');
  });

  it('runs each line of a multi-line paste in order', async () => {
    const t = await setup();
    const start = t.raw().length;
    await t.type('cd src\r\npwd\nwhoami\n');
    const out = stripAnsi(t.raw().slice(start));
    expect(out).toContain('/home/demo/orbit-demo/src');
    expect(out.indexOf('/home/demo/orbit-demo/src')).toBeLessThan(out.lastIndexOf('demo\r\n'));
    expect(t.shell.history.slice(-3)).toEqual(['cd src', 'pwd', 'whoami']);
  });
});

describe('simulated shell parsing helpers', () => {
  it('parses quotes, pipes, redirects and lists', () => {
    const r = parseCommandLine(`echo "a b" 'c' | grep a > out.txt && ls; pwd`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.list.map((i) => i.op)).toEqual([null, '&&', ';']);
    expect(r.list[0].pipeline).toHaveLength(2);
    expect(r.list[0].pipeline[1].redirects[0].op).toBe('>');
    expect(parseCommandLine('echo "unterminated').ok).toBe(false);
    expect(parseCommandLine('| ls').ok).toBe(false);
    expect(parseCommandLine('sleep 1 &').ok).toBe(false);
  });

  it('tokenizes keys, escape sequences and pasted text', () => {
    expect(tokenizeInput('ab\x1b[Ac\r\n\x7f\t\x03')).toEqual([
      { t: 'text', s: 'ab' },
      { t: 'up' },
      { t: 'text', s: 'c' },
      { t: 'enter' },
      { t: 'backspace' },
      { t: 'tab' },
      { t: 'ctrl', c: 'c' },
    ]);
    expect(tokenizeInput('\x1bOH\x1b[4~\x1b[1;5D\x1b')).toEqual([{ t: 'home' }, { t: 'end' }, { t: 'wordLeft' }]);
  });
});
