import type { FileEntry } from '../../files/types';

/**
 * Virtual filesystem seen by the simulated shell.
 *
 *   /home/demo                 (~)            read-only, contains only the project folder
 *   /home/demo/<project>       (~/<project>)  the FileStore root; directories are implicit
 *   anything else                              "not available in the simulated shell"
 */

export const HOME_SEGMENTS = ['home', 'demo'] as const;
export const HOME_PATH = '/home/demo';

export type Location =
  | { kind: 'home' }
  | { kind: 'project'; rel: string }
  | { kind: 'outside'; abs: string };

export function absToString(abs: readonly string[]): string {
  return '/' + abs.join('/');
}

export class VirtualPaths {
  constructor(readonly projectName: string) {}

  get projectAbs(): string[] {
    return [...HOME_SEGMENTS, this.projectName];
  }

  /** Resolve a user-typed path against `cwd` (absolute segments). Handles ~, ., .. and absolute paths. */
  resolve(input: string, cwd: readonly string[]): string[] {
    let segs: string[];
    let rest = input;
    if (rest === '~' || rest.startsWith('~/')) {
      segs = [...HOME_SEGMENTS];
      rest = rest.slice(1);
    } else if (rest.startsWith('/')) {
      segs = [];
    } else {
      segs = [...cwd];
    }
    for (const part of rest.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') segs.pop();
      else segs.push(part);
    }
    return segs;
  }

  locate(abs: readonly string[]): Location {
    const proj = this.projectAbs;
    if (abs.length >= proj.length && proj.every((s, i) => abs[i] === s)) {
      return { kind: 'project', rel: abs.slice(proj.length).join('/') };
    }
    if (abs.length === HOME_SEGMENTS.length && HOME_SEGMENTS.every((s, i) => abs[i] === s)) {
      return { kind: 'home' };
    }
    return { kind: 'outside', abs: absToString(abs) };
  }

  /** "~/orbit-demo/src" style display path. */
  display(abs: readonly string[]): string {
    const isHome = HOME_SEGMENTS.every((s, i) => abs[i] === s);
    if (isHome && abs.length >= HOME_SEGMENTS.length) {
      const tail = abs.slice(HOME_SEGMENTS.length);
      return tail.length ? `~/${tail.join('/')}` : '~';
    }
    return absToString(abs);
  }
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir';
  size: number;
  updatedAt: number;
}

/** Point-in-time view of the project files with implicit directories. */
export class TreeSnapshot {
  readonly files = new Map<string, FileEntry>();
  readonly dirs = new Set<string>(['']);

  constructor(
    entries: FileEntry[],
    readonly projectName: string,
  ) {
    for (const e of entries) {
      this.files.set(e.path, e);
      const parts = e.path.split('/');
      for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
    }
  }

  kindOf(loc: Location): 'file' | 'dir' | 'outside' | null {
    if (loc.kind === 'outside') return 'outside';
    if (loc.kind === 'home') return 'dir';
    if (this.dirs.has(loc.rel)) return 'dir';
    if (this.files.has(loc.rel)) return 'file';
    return null;
  }

  /** Files whose path is inside `rel` (recursive). '' = all. */
  filesUnder(rel: string): FileEntry[] {
    const prefix = rel ? rel + '/' : '';
    return [...this.files.values()].filter((f) => f.path.startsWith(prefix));
  }

  /** Immediate children of a directory location, sorted by name. */
  children(loc: Location): DirEntry[] {
    if (loc.kind === 'outside') return [];
    if (loc.kind === 'home') {
      const all = [...this.files.values()];
      return [
        {
          name: this.projectName,
          kind: 'dir',
          size: 4096,
          updatedAt: all.reduce((m, f) => Math.max(m, f.updatedAt), 0),
        },
      ];
    }
    const prefix = loc.rel ? loc.rel + '/' : '';
    const out = new Map<string, DirEntry>();
    for (const f of this.files.values()) {
      if (!f.path.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) {
        out.set(rest, { name: rest, kind: 'file', size: f.size, updatedAt: f.updatedAt });
      } else {
        const name = rest.slice(0, slash);
        const prev = out.get(name);
        out.set(name, {
          name,
          kind: 'dir',
          size: 4096,
          updatedAt: Math.max(prev?.updatedAt ?? 0, f.updatedAt),
        });
      }
    }
    return [...out.values()].sort((a, b) => compareNames(a.name, b.name));
  }
}

/** Sort roughly like GNU ls in en_US: case-insensitive, ignoring a leading dot. */
export function compareNames(a: string, b: string): number {
  const na = a.replace(/^\.+/, '').toLowerCase();
  const nb = b.replace(/^\.+/, '').toLowerCase();
  if (na !== nb) return na < nb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
