import { FileStoreError, type FileStore } from '../../files/types';
import { columns, style } from './ansi';
import { absToString, HOME_PATH, TreeSnapshot, VirtualPaths, type DirEntry, type Location } from './vfs';

/**
 * Commands of the simulated shell. Each command reads/writes the shared FileStore, so a file
 * created here with `echo hi > notes.md` shows up in the Code app and vice versa.
 */

export const NOT_AVAILABLE = 'not available in the simulated shell';
export const HOSTNAME = 'orbit-demo (simulated)';
export const USER = 'demo';

/** What a command can see and change in the shell. */
export interface ShellContext {
  readonly paths: VirtualPaths;
  readonly files: FileStore;
  cwd: string[];
  oldCwd: string[] | null;
  readonly cols: number;
  readonly history: string[];
  env(name: string): string | undefined;
  envEntries(): [string, string][];
  snapshot(): Promise<TreeSnapshot>;
  requestExit(code: number): void;
  clearScreen(): void;
}

export interface Io {
  args: string[];
  /** Piped input, or null when stdin is the (interactive) terminal. */
  stdin: string | null;
  /** True when stdout is the terminal (colour and column layout allowed). */
  tty: boolean;
  out(text: string): void;
  err(text: string): void;
}

export type CommandFn = (io: Io, sh: ShellContext) => number | Promise<number>;

export interface CommandSpec {
  usage: string;
  summary: string;
  run: CommandFn;
}

// ------------------------------------------------------------------ helpers

interface Resolved {
  abs: string[];
  loc: Location;
}

function resolve(sh: ShellContext, arg: string): Resolved {
  const abs = sh.paths.resolve(arg, sh.cwd);
  return { abs, loc: sh.paths.locate(abs) };
}

function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * Split argv into single-letter flags and operands. Supports grouped flags (-la), "--" and
 * options that take a value (e.g. head -n 5 / -n5). Returns an error string for unknown flags.
 */
function parseFlags(
  args: string[],
  allowed: string,
  withValue = '',
): { flags: Set<string>; values: Map<string, string>; operands: string[]; error?: string } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const operands: string[] = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (!a.startsWith('-') || a === '-' || /^-\d+$/.test(a)) {
      operands.push(a);
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const f = a[j];
      if (withValue.includes(f)) {
        const rest = a.slice(j + 1);
        const value = rest || args[++i];
        if (value === undefined) return { flags, values, operands, error: `option requires an argument -- '${f}'` };
        values.set(f, value);
        break;
      }
      if (!allowed.includes(f)) return { flags, values, operands, error: `invalid option -- '${f}'` };
      flags.add(f);
    }
  }
  operands.push(...args.slice(i));
  return { flags, values, operands };
}

function describeMissing(loc: Location): string {
  return loc.kind === 'outside' ? NOT_AVAILABLE : 'No such file or directory';
}

/** Read a file operand. Prints an error and returns null on failure. */
async function readOperand(
  sh: ShellContext,
  snap: TreeSnapshot,
  io: Io,
  cmd: string,
  arg: string,
): Promise<string | null> {
  if (arg === '-') return io.stdin ?? '';
  const { loc } = resolve(sh, arg);
  const kind = snap.kindOf(loc);
  if (kind === 'dir') {
    io.err(`${cmd}: ${arg}: Is a directory\n`);
    return null;
  }
  if (kind !== 'file' || loc.kind !== 'project') {
    io.err(`${cmd}: ${arg}: ${describeMissing(loc)}\n`);
    return null;
  }
  return sh.files.read(loc.rel);
}

/** Check that a path can be written: inside the project and not a folder. Returns the rel path or an error. */
export function writableRel(snap: TreeSnapshot, loc: Location): { rel: string } | { error: string } {
  if (loc.kind === 'outside') return { error: NOT_AVAILABLE };
  if (loc.kind === 'home' || loc.rel === '') {
    return { error: `Permission denied (only files inside ~/${snap.projectName} can be written here)` };
  }
  if (snap.kindOf(loc) === 'dir') return { error: 'Is a directory' };
  // A parent "directory" that is actually a file.
  const parts = loc.rel.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (snap.files.has(parts.slice(0, i).join('/'))) return { error: 'Not a directory' };
  }
  return { rel: loc.rel };
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function noKeyboardInput(io: Io, cmd: string): number {
  io.err(`${cmd}: reading from the keyboard isn't supported in the simulated shell — give a file name\n`);
  return 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function lsDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, ' ');
  const sixMonths = 182 * 24 * 3600 * 1000;
  const tail = Math.abs(now - ms) < sixMonths ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ` ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${day} ${tail}`;
}

function humanSize(n: number): string {
  if (n < 1024) return String(n);
  const units = ['K', 'M', 'G'];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${units[u]}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ------------------------------------------------------------------ commands

const ls: CommandFn = async (io, sh) => {
  const { flags, operands, error } = parseFlags(io.args, 'laA1hF');
  if (error) {
    io.err(`ls: ${error}\nTry 'help' for the options this simulated ls supports (-l -a -h -1).\n`);
    return 2;
  }
  const long = flags.has('l');
  const all = flags.has('a');
  const almostAll = flags.has('A');
  const one = flags.has('1') || !io.tty;
  const snap = await sh.snapshot();
  const targets = operands.length ? operands : ['.'];
  let code = 0;

  const fileItems: { label: string; entry: DirEntry }[] = [];
  const dirItems: { label: string; loc: Location }[] = [];
  for (const t of targets) {
    const { loc } = resolve(sh, t);
    const kind = snap.kindOf(loc);
    if (kind === 'dir') dirItems.push({ label: t, loc });
    else if (kind === 'file' && loc.kind === 'project') {
      const f = snap.files.get(loc.rel)!;
      fileItems.push({ label: t, entry: { name: t, kind: 'file', size: f.size, updatedAt: f.updatedAt } });
    } else {
      io.err(`ls: cannot access '${t}': ${describeMissing(loc)}\n`);
      code = 2;
    }
  }

  const decorate = (e: DirEntry) => {
    if (e.kind !== 'dir') return e.name;
    return io.tty ? style.boldBlue(e.name) + '/' : e.name;
  };
  const render = (entries: DirEntry[]): string => {
    if (!long) {
      const names = entries.map(decorate);
      return one ? (names.length ? names.join('\n') + '\n' : '') : columns(names, sh.cols);
    }
    const sizes = entries.map((e) => (flags.has('h') ? humanSize(e.size) : String(e.size)));
    const w = Math.max(1, ...sizes.map((s) => s.length));
    return entries
      .map(
        (e, i) =>
          `${e.kind === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--'} 1 ${USER} ${USER} ${sizes[i].padStart(w)} ${lsDate(e.updatedAt)} ${decorate(e)}\n`,
      )
      .join('');
  };

  if (fileItems.length) io.out(render(fileItems.map((f) => f.entry)));
  dirItems.forEach((d, idx) => {
    let entries = snap.children(d.loc);
    if (!all && !almostAll) entries = entries.filter((e) => !e.name.startsWith('.'));
    if (all) {
      const now = entries.reduce((m, e) => Math.max(m, e.updatedAt), 0) || Date.now();
      entries = [
        { name: '.', kind: 'dir', size: 4096, updatedAt: now },
        { name: '..', kind: 'dir', size: 4096, updatedAt: now },
        ...entries,
      ];
    }
    const multiple = targets.length > 1;
    if (multiple) io.out(`${fileItems.length || idx > 0 ? '\n' : ''}${d.label}:\n`);
    if (long) {
      const blocks = entries.reduce((sum, e) => sum + (e.kind === 'dir' ? 4 : Math.ceil(e.size / 4096) * 4), 0);
      io.out(`total ${blocks}\n`);
    }
    io.out(render(entries));
  });
  return code;
};

const cd: CommandFn = async (io, sh) => {
  if (io.args.length > 1) {
    io.err('cd: too many arguments\n');
    return 1;
  }
  const arg = io.args[0];
  let target: string;
  if (arg === undefined || arg === '') target = HOME_PATH;
  else if (arg === '-') {
    if (!sh.oldCwd) {
      io.err('cd: OLDPWD not set\n');
      return 1;
    }
    target = absToString(sh.oldCwd);
  } else target = arg;
  const { abs, loc } = resolve(sh, target);
  const snap = await sh.snapshot();
  const kind = snap.kindOf(loc);
  if (kind === 'outside') {
    io.err(`cd: ${arg}: ${NOT_AVAILABLE} (only ~ and ~/${sh.paths.projectName} exist here)\n`);
    return 1;
  }
  if (kind === 'file') {
    io.err(`cd: ${arg}: Not a directory\n`);
    return 1;
  }
  if (kind === null) {
    io.err(`cd: ${arg}: No such file or directory\n`);
    return 1;
  }
  sh.oldCwd = sh.cwd;
  sh.cwd = abs;
  if (arg === '-') io.out(`${absToString(abs)}\n`);
  return 0;
};

const pwd: CommandFn = (io, sh) => {
  io.out(`${absToString(sh.cwd)}\n`);
  return 0;
};

const cat: CommandFn = async (io, sh) => {
  const { flags, operands, error } = parseFlags(io.args, 'n');
  if (error) {
    io.err(`cat: ${error}\n`);
    return 1;
  }
  if (operands.length === 0) {
    if (io.stdin === null) return noKeyboardInput(io, 'cat');
    operands.push('-');
  }
  const snap = await sh.snapshot();
  let code = 0;
  let lineNo = 1;
  for (const arg of operands) {
    const text = await readOperand(sh, snap, io, 'cat', arg);
    if (text === null) {
      code = 1;
      continue;
    }
    if (flags.has('n')) {
      const lines = splitLines(text);
      io.out(lines.map((l) => `${String(lineNo++).padStart(6)}\t${l}\n`).join(''));
    } else io.out(text);
  }
  return code;
};

const echo: CommandFn = (io) => {
  let args = io.args;
  let newline = true;
  let escapes = false;
  while (args.length && /^-[neE]+$/.test(args[0])) {
    if (args[0].includes('n')) newline = false;
    if (args[0].includes('e')) escapes = true;
    if (args[0].includes('E')) escapes = false;
    args = args.slice(1);
  }
  let text = args.join(' ');
  if (escapes) {
    text = text.replace(/\\([nt\\])/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'));
  }
  io.out(newline ? text + '\n' : text);
  return 0;
};

const touch: CommandFn = async (io, sh) => {
  if (io.args.length === 0) {
    io.err('touch: missing file operand\n');
    return 1;
  }
  const snap = await sh.snapshot();
  let code = 0;
  for (const arg of io.args) {
    const { loc } = resolve(sh, arg);
    if (snap.kindOf(loc) === 'dir') continue;
    const w = writableRel(snap, loc);
    if ('error' in w) {
      io.err(`touch: cannot touch '${arg}': ${w.error}\n`);
      code = 1;
      continue;
    }
    const existing = snap.files.has(w.rel) ? await sh.files.read(w.rel) : '';
    await sh.files.write(w.rel, existing);
  }
  return code;
};

const rm: CommandFn = async (io, sh) => {
  const { flags, operands, error } = parseFlags(io.args, 'rRfiv');
  if (error) {
    io.err(`rm: ${error}\n`);
    return 1;
  }
  const recursive = flags.has('r') || flags.has('R');
  const force = flags.has('f');
  if (operands.length === 0) {
    if (force) return 0;
    io.err('rm: missing operand\n');
    return 1;
  }
  const snap = await sh.snapshot();
  let code = 0;
  for (const arg of operands) {
    const { loc } = resolve(sh, arg);
    const kind = snap.kindOf(loc);
    if (kind === 'outside') {
      io.err(`rm: cannot remove '${arg}': ${NOT_AVAILABLE}\n`);
      code = 1;
    } else if (kind === null) {
      if (!force) {
        io.err(`rm: cannot remove '${arg}': No such file or directory\n`);
        code = 1;
      }
    } else if (kind === 'file' && loc.kind === 'project') {
      await sh.files.remove(loc.rel);
      if (flags.has('v')) io.out(`removed '${arg}'\n`);
    } else if (loc.kind === 'home' || (loc.kind === 'project' && loc.rel === '')) {
      io.err(
        `rm: refusing to remove '${arg}': that's the whole demo project. Use Settings → Reset demo data to start over.\n`,
      );
      code = 1;
    } else if (!recursive) {
      io.err(`rm: cannot remove '${arg}': Is a directory\n`);
      code = 1;
    } else if (loc.kind === 'project') {
      for (const f of snap.filesUnder(loc.rel)) await sh.files.remove(f.path);
      if (flags.has('v')) io.out(`removed directory '${arg}'\n`);
    }
  }
  return code;
};

/** Shared by mv and cp: work out the destination, following "into this directory" semantics. */
function destination(
  sh: ShellContext,
  snap: TreeSnapshot,
  srcRel: string,
  dstArg: string,
): { rel: string } | { error: string } {
  const { loc } = resolve(sh, dstArg);
  if (loc.kind === 'outside') return { error: NOT_AVAILABLE };
  if (snap.kindOf(loc) === 'dir') {
    const dirRel = loc.kind === 'project' ? loc.rel : null;
    if (dirRel === null) return { error: `Permission denied (only ~/${snap.projectName} is writable here)` };
    return writableRel(snap, { kind: 'project', rel: joinRel(dirRel, baseName(srcRel)) });
  }
  return writableRel(snap, loc);
}

function transfer(name: 'mv' | 'cp'): CommandFn {
  return async (io, sh) => {
    const { flags, operands, error } = parseFlags(io.args, name === 'cp' ? 'rRfv' : 'fv');
    if (error) {
      io.err(`${name}: ${error}\n`);
      return 1;
    }
    if (operands.length < 2) {
      io.err(`${name}: missing ${operands.length === 0 ? 'file operand' : `destination file operand after '${operands[0]}'`}\n`);
      return 1;
    }
    const dstArg = operands[operands.length - 1];
    const sources = operands.slice(0, -1);
    let snap = await sh.snapshot();
    if (sources.length > 1 && snap.kindOf(resolve(sh, dstArg).loc) !== 'dir') {
      io.err(`${name}: target '${dstArg}' is not a directory\n`);
      return 1;
    }
    let code = 0;
    for (const srcArg of sources) {
      snap = await sh.snapshot();
      const { loc } = resolve(sh, srcArg);
      const kind = snap.kindOf(loc);
      if (kind === null || kind === 'outside' || loc.kind !== 'project') {
        const why = loc.kind === 'home' ? 'Permission denied' : describeMissing(loc);
        io.err(`${name}: cannot ${name === 'mv' ? 'move' : 'stat'} '${srcArg}': ${why}\n`);
        code = 1;
        continue;
      }
      if (loc.rel === '') {
        io.err(`${name}: cannot ${name === 'mv' ? 'move' : 'copy'} the project folder itself\n`);
        code = 1;
        continue;
      }
      const dst = destination(sh, snap, loc.rel, dstArg);
      if (kind === 'file') {
        if ('error' in dst) {
          io.err(`${name}: cannot ${name === 'mv' ? 'move' : 'create'} '${srcArg}' to '${dstArg}': ${dst.error}\n`);
          code = 1;
          continue;
        }
        if (dst.rel === loc.rel) {
          io.err(`${name}: '${srcArg}' and '${dstArg}' are the same file\n`);
          code = 1;
          continue;
        }
        if (name === 'mv') {
          if (snap.files.has(dst.rel)) await sh.files.remove(dst.rel);
          await sh.files.rename(loc.rel, dst.rel);
        } else {
          await sh.files.write(dst.rel, await sh.files.read(loc.rel));
        }
        if (flags.has('v')) io.out(`'${srcArg}' -> '${dstArg}'\n`);
        continue;
      }
      // Directory
      if (name === 'cp' && !flags.has('r') && !flags.has('R')) {
        io.err(`cp: -r not specified; omitting directory '${srcArg}'\n`);
        code = 1;
        continue;
      }
      const verb = name === 'mv' ? 'move' : 'copy';
      const dstLoc = resolve(sh, dstArg).loc;
      const dstKind = snap.kindOf(dstLoc);
      let dstRel: string;
      if (dstLoc.kind !== 'project') {
        const why = dstLoc.kind === 'home' ? 'Permission denied' : NOT_AVAILABLE;
        io.err(`${name}: cannot ${verb} '${srcArg}' to '${dstArg}': ${why}\n`);
        code = 1;
        continue;
      } else if (dstKind === 'dir') {
        dstRel = joinRel(dstLoc.rel, baseName(loc.rel));
      } else if (dstKind === null) {
        dstRel = dstLoc.rel;
      } else {
        io.err(`${name}: cannot overwrite non-directory '${dstArg}' with directory '${srcArg}'\n`);
        code = 1;
        continue;
      }
      if (dstRel === loc.rel || dstRel.startsWith(loc.rel + '/')) {
        io.err(`${name}: cannot ${name === 'mv' ? 'move' : 'copy'} '${srcArg}' to a subdirectory of itself\n`);
        code = 1;
        continue;
      }
      if (snap.kindOf({ kind: 'project', rel: dstRel }) !== null) {
        io.err(`${name}: cannot ${name === 'mv' ? 'move' : 'copy'} '${srcArg}' to '${dstRel}': Directory not empty\n`);
        code = 1;
        continue;
      }
      for (const f of snap.filesUnder(loc.rel)) {
        const target = dstRel + f.path.slice(loc.rel.length);
        if (name === 'mv') await sh.files.rename(f.path, target);
        else await sh.files.write(target, await sh.files.read(f.path));
      }
      if (flags.has('v')) io.out(`'${srcArg}' -> '${dstArg}'\n`);
    }
    return code;
  };
}

const mkdir: CommandFn = async (io, sh) => {
  const { operands } = parseFlags(io.args, 'pv');
  if (operands.length === 0) {
    io.err('mkdir: missing operand\n');
    return 1;
  }
  const snap = await sh.snapshot();
  for (const arg of operands) {
    const { loc } = resolve(sh, arg);
    if (snap.kindOf(loc) === 'dir' || snap.kindOf(loc) === 'file') {
      io.err(`mkdir: cannot create directory '${arg}': File exists\n`);
      return 1;
    }
  }
  const example = operands[0].replace(/\/+$/, '');
  io.err(
    `mkdir: folders are implicit in the simulated shell — a folder appears when a file is saved inside it.\n` +
      `Try: touch ${example}/notes.md   (or create a file in the Code app)\n`,
  );
  return 1;
};

function headTail(which: 'head' | 'tail'): CommandFn {
  return async (io, sh) => {
    // Accept the old "-N" form too.
    const args = io.args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
    const { values, operands, error } = parseFlags(args, 'qv', 'nc');
    if (error) {
      io.err(`${which}: ${error}\n`);
      return 1;
    }
    const raw = values.get('n') ?? '10';
    const fromStart = which === 'tail' && raw.startsWith('+');
    const n = Number.parseInt(raw.replace(/^[+-]/, ''), 10);
    if (!Number.isFinite(n) || n < 0) {
      io.err(`${which}: invalid number of lines: '${raw}'\n`);
      return 1;
    }
    if (operands.length === 0) {
      if (io.stdin === null) return noKeyboardInput(io, which);
      operands.push('-');
    }
    const snap = await sh.snapshot();
    let code = 0;
    let first = true;
    for (const arg of operands) {
      const text = await readOperand(sh, snap, io, which, arg);
      if (text === null) {
        code = 1;
        continue;
      }
      if (operands.length > 1) {
        io.out(`${first ? '' : '\n'}==> ${arg === '-' ? 'standard input' : arg} <==\n`);
      }
      first = false;
      const lines = splitLines(text);
      const picked =
        which === 'head' ? lines.slice(0, n) : fromStart ? lines.slice(Math.max(0, n - 1)) : n === 0 ? [] : lines.slice(-n);
      if (picked.length) io.out(picked.join('\n') + '\n');
    }
    return code;
  };
}

const wc: CommandFn = async (io, sh) => {
  const { flags, operands, error } = parseFlags(io.args, 'lwcm');
  if (error) {
    io.err(`wc: ${error}\n`);
    return 1;
  }
  const show = { l: flags.has('l'), w: flags.has('w'), c: flags.has('c') || flags.has('m') };
  if (!show.l && !show.w && !show.c) show.l = show.w = show.c = true;
  if (operands.length === 0) {
    if (io.stdin === null) return noKeyboardInput(io, 'wc');
    operands.push('-');
  }
  const snap = await sh.snapshot();
  const rows: { counts: number[]; name: string }[] = [];
  const total = [0, 0, 0];
  let code = 0;
  for (const arg of operands) {
    const text = await readOperand(sh, snap, io, 'wc', arg);
    if (text === null) {
      code = 1;
      continue;
    }
    const counts = [
      (text.match(/\n/g) ?? []).length,
      text.split(/\s+/).filter(Boolean).length,
      new TextEncoder().encode(text).length,
    ];
    counts.forEach((c, i) => (total[i] += c));
    rows.push({ counts, name: arg === '-' ? '' : arg });
  }
  if (rows.length > 1) rows.push({ counts: total, name: 'total' });
  const pick = (c: number[]) => c.filter((_, i) => [show.l, show.w, show.c][i]);
  const single = rows.length === 1 && pick(rows[0].counts).length === 1;
  const width = single ? 0 : Math.max(...rows.flatMap((r) => pick(r.counts).map((n) => String(n).length)));
  for (const r of rows) {
    const nums = pick(r.counts)
      .map((n) => String(n).padStart(width))
      .join(' ');
    io.out(`${nums}${r.name ? ' ' + r.name : ''}\n`);
  }
  return code;
};

const grep: CommandFn = async (io, sh) => {
  const { flags, values, operands, error } = parseFlags(io.args, 'inrRvclwHhFE', 'e');
  if (error) {
    io.err(`grep: ${error}\nUsage: grep [-i -n -v -c -l -r] PATTERN FILE...\n`);
    return 2;
  }
  const pattern = values.get('e') ?? operands.shift();
  if (pattern === undefined) {
    io.err('Usage: grep [-i -n -v -c -l -r] PATTERN FILE...\n');
    return 2;
  }
  const recursive = flags.has('r') || flags.has('R');
  let source = flags.has('F') ? escapeRegExp(pattern) : pattern;
  if (flags.has('w')) source = `\\b(?:${source})\\b`;
  let re: RegExp;
  try {
    re = new RegExp(source, flags.has('i') ? 'gi' : 'g');
  } catch {
    re = new RegExp(escapeRegExp(pattern), flags.has('i') ? 'gi' : 'g');
  }

  const snap = await sh.snapshot();
  const inputs: { name: string; text: string }[] = [];
  let code = 1;
  let hadError = false;
  if (operands.length === 0) {
    if (recursive) operands.push('.');
    else if (io.stdin !== null) inputs.push({ name: '(standard input)', text: io.stdin });
    else {
      io.err('grep: reading from the keyboard isn\'t supported in the simulated shell — give a file name, e.g. grep TODO -r .\n');
      return 2;
    }
  }
  for (const arg of operands) {
    if (arg === '-') {
      inputs.push({ name: '(standard input)', text: io.stdin ?? '' });
      continue;
    }
    const { loc } = resolve(sh, arg);
    const kind = snap.kindOf(loc);
    if (kind === 'dir') {
      if (!recursive) {
        io.err(`grep: ${arg}: Is a directory\n`);
        hadError = true;
        continue;
      }
      const rel = loc.kind === 'project' ? loc.rel : '';
      const prefix = arg.replace(/\/+$/, '');
      for (const f of snap.filesUnder(rel)) {
        const sub = rel ? f.path.slice(rel.length + 1) : f.path;
        const shown = prefix === '.' ? sub : `${prefix}/${sub}`;
        inputs.push({ name: shown, text: await sh.files.read(f.path) });
      }
      continue;
    }
    if (kind !== 'file' || loc.kind !== 'project') {
      io.err(`grep: ${arg}: ${describeMissing(loc)}\n`);
      hadError = true;
      continue;
    }
    inputs.push({ name: arg, text: await sh.files.read(loc.rel) });
  }

  const showNames = flags.has('H') || (!flags.has('h') && (inputs.length > 1 || recursive));
  const colour = io.tty;
  const fname = (n: string) => (colour ? `\x1b[35m${n}\x1b[39m\x1b[36m:\x1b[39m` : `${n}:`);
  const lnum = (n: number) => (colour ? `\x1b[32m${n}\x1b[39m\x1b[36m:\x1b[39m` : `${n}:`);
  for (const input of inputs) {
    let count = 0;
    const lines = splitLines(input.text);
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      const hit = re.test(lines[i]);
      if (hit === flags.has('v')) continue;
      count++;
      code = 0;
      if (flags.has('c') || flags.has('l')) continue;
      let line = lines[i];
      if (colour && !flags.has('v')) {
        re.lastIndex = 0;
        line = line.replace(re, (m) => (m ? `\x1b[1;31m${m}\x1b[0m` : m));
      }
      io.out(`${showNames ? fname(input.name) : ''}${flags.has('n') ? lnum(i + 1) : ''}${line}\n`);
    }
    if (flags.has('l') && count > 0) io.out(`${colour ? `\x1b[35m${input.name}\x1b[39m` : input.name}\n`);
    else if (flags.has('c')) io.out(`${showNames ? fname(input.name) : ''}${count}\n`);
  }
  return hadError && code !== 0 ? 2 : code;
};

const history: CommandFn = (io, sh) => {
  if (io.args[0] === '-c') {
    sh.history.length = 0;
    return 0;
  }
  const n = io.args[0] ? Number.parseInt(io.args[0], 10) : sh.history.length;
  const start = Math.max(0, sh.history.length - (Number.isFinite(n) ? n : sh.history.length));
  io.out(
    sh.history
      .slice(start)
      .map((h, i) => `${String(start + i + 1).padStart(5)}  ${h}\n`)
      .join(''),
  );
  return 0;
};

const uname: CommandFn = (io) => {
  const { flags, error } = parseFlags(io.args, 'asnrvmo');
  if (error) {
    io.err(`uname: ${error}\n`);
    return 1;
  }
  if (flags.has('a')) {
    io.out(
      `Orbit-Simulated ${HOSTNAME} — a shell simulated in browser JavaScript. There is no Linux kernel here;\n` +
        `connect Orbit to your Linux machine for a real shell.\n`,
    );
  } else {
    io.out('Orbit-Simulated (no kernel — this shell runs in your browser)\n');
  }
  return 0;
};

const date: CommandFn = (io) => {
  const d = new Date();
  let tz = '';
  try {
    tz =
      new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')
        ?.value ?? '';
  } catch {
    tz = '';
  }
  io.out(
    `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ` +
      `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${tz ? ' ' + tz : ''} ${d.getFullYear()}\n`,
  );
  return 0;
};

const env: CommandFn = (io, sh) => {
  io.out(sh.envEntries().map(([k, v]) => `${k}=${v}\n`).join(''));
  return 0;
};

function help(commands: Record<string, CommandSpec>): CommandFn {
  return (io, sh) => {
    const rows = Object.entries(commands).filter(([, c]) => c.summary);
    const w = Math.max(...rows.map(([, c]) => c.usage.length)) + 2;
    const maxSummary = Math.max(...rows.map(([, c]) => c.summary.length));
    const stacked = w + maxSummary > sh.cols;
    const b = (s: string) => (io.tty ? style.bold(s) : s);
    let text =
      `${b('Orbit simulated shell')} — runs in this browser, not on your Linux machine.\n` +
      `Files: ~/${sh.paths.projectName} (stored in this browser, shared with Code).\n\n`;
    for (const [, c] of rows) {
      text += stacked ? `  ${b(c.usage)}\n      ${c.summary}\n` : `  ${b(c.usage.padEnd(w))}${c.summary}\n`;
    }
    text +=
      `\nAlso: | pipes, > and >> redirects, ; && ||, * globs, $HOME.\n` +
      `Keys: Tab completes · ↑/↓ history · Ctrl+C cancels · Ctrl+L clears · Ctrl+U erases the line.\n` +
      `Not here: sudo, apt, git, python, node, ssh, editors… they run on your Linux machine when Orbit is connected.\n`;
    io.out(text);
    return 0;
  };
}

/** Commands that exist on the real host but not in the simulation. */
export const UNAVAILABLE: Record<string, string> = {
  ...Object.fromEntries(
    (
      'sudo apt apt-get dpkg snap python python3 pip pip3 node npm npx yarn pnpm git ssh scp curl wget ' +
      'make gcc docker systemctl bash sh zsh tmux top htop ps kill'
    )
      .split(' ')
      .map((k) => [k, '']),
  ),
  vim: 'To edit files now, open the Code app.',
  vi: 'To edit files now, open the Code app.',
  nano: 'To edit files now, open the Code app.',
  emacs: 'To edit files now, open the Code app.',
  less: 'Use cat, head or tail instead.',
  more: 'Use cat, head or tail instead.',
  man: "Type 'help' for what this shell supports.",
};

export const AGENT_COMMANDS = new Set(['agy', 'antigravity']);

export function unavailableMessage(cmd: string): string {
  const hint = UNAVAILABLE[cmd];
  return `${cmd}: ${NOT_AVAILABLE} — it runs on your Linux machine when Orbit is connected.${hint ? `\n${hint}` : ''}\n`;
}

export function agentMessage(cmd: string): string {
  return `${cmd}: The Antigravity CLI isn't available here; open the Antigravity app (simulated).\n`;
}

export function notFoundMessage(cmd: string): string {
  return `${cmd}: command not found (simulated shell). Type 'help'.\n`;
}

function build(): Record<string, CommandSpec> {
  const commands: Record<string, CommandSpec> = {
    help: { usage: 'help', summary: '', run: () => 0 },
    ls: { usage: 'ls [-lah] [path]', summary: 'list a folder', run: ls },
    cd: { usage: 'cd [dir]', summary: 'change folder (.., ~, -)', run: cd },
    pwd: { usage: 'pwd', summary: 'print the current folder', run: pwd },
    cat: { usage: 'cat <file>', summary: 'print a file', run: cat },
    echo: { usage: 'echo <text> [> f]', summary: 'print, or write (>>) a file', run: echo },
    touch: { usage: 'touch <file>', summary: 'create an empty file', run: touch },
    rm: { usage: 'rm [-r] <path>', summary: 'delete a file or folder', run: rm },
    mv: { usage: 'mv <from> <to>', summary: 'rename or move', run: transfer('mv') },
    cp: { usage: 'cp [-r] <from> <to>', summary: 'copy', run: transfer('cp') },
    mkdir: { usage: 'mkdir <dir>', summary: 'how folders work here', run: mkdir },
    head: { usage: 'head [-n N] <file>', summary: 'first lines', run: headTail('head') },
    tail: { usage: 'tail [-n N] <file>', summary: 'last lines', run: headTail('tail') },
    wc: { usage: 'wc [-lwc] <file>', summary: 'count lines, words, bytes', run: wc },
    grep: { usage: 'grep [-inrv] <p> <f>', summary: 'search in files', run: grep },
    history: { usage: 'history', summary: 'list past commands', run: history },
    clear: {
      usage: 'clear',
      summary: 'clear the screen',
      run: (_io, sh) => {
        sh.clearScreen();
        return 0;
      },
    },
    whoami: {
      usage: 'whoami',
      summary: 'print the user name',
      run: (io) => {
        io.out(`${USER}\n`);
        return 0;
      },
    },
    hostname: {
      usage: 'hostname',
      summary: 'print the host name',
      run: (io) => {
        io.out(`${HOSTNAME}\n`);
        return 0;
      },
    },
    uname: { usage: 'uname [-a]', summary: 'system info (simulated)', run: uname },
    date: { usage: 'date', summary: 'print the date and time', run: date },
    env: { usage: 'env', summary: 'print variables', run: env },
    exit: {
      usage: 'exit',
      summary: 'end the session',
      run: (io, sh) => {
        const code = io.args[0] ? Number.parseInt(io.args[0], 10) || 0 : 0;
        sh.requestExit(code);
        return code;
      },
    },
  };
  commands.help.run = help(commands);
  return commands;
}

export const COMMANDS: Record<string, CommandSpec> = build();
export const COMMAND_NAMES = Object.keys(COMMANDS).sort();

/** Turn store errors into one-line shell messages. */
export function describeError(err: unknown): string {
  if (err instanceof FileStoreError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
