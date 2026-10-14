/**
 * Turns raw terminal input (what xterm.js sends: characters, control bytes, escape sequences,
 * pasted text) into editing keys. There is no PTY in the simulated shell, so we do the line
 * discipline ourselves.
 */

export type Key =
  | { t: 'text'; s: string }
  | { t: 'enter' }
  | { t: 'backspace' }
  | { t: 'delete' }
  | { t: 'tab' }
  | { t: 'left' }
  | { t: 'right' }
  | { t: 'up' }
  | { t: 'down' }
  | { t: 'home' }
  | { t: 'end' }
  | { t: 'wordLeft' }
  | { t: 'wordRight' }
  | { t: 'killWordBack' }
  /** Ctrl+<letter>, lower-case letter. */
  | { t: 'ctrl'; c: string };

function csiKey(params: string, final: string): Key | null {
  const mod = params.split(';')[1];
  const word = mod === '5' || mod === '3';
  switch (final) {
    case 'A':
      return { t: 'up' };
    case 'B':
      return { t: 'down' };
    case 'C':
      return word ? { t: 'wordRight' } : { t: 'right' };
    case 'D':
      return word ? { t: 'wordLeft' } : { t: 'left' };
    case 'H':
      return { t: 'home' };
    case 'F':
      return { t: 'end' };
    case '~': {
      const n = params.split(';')[0];
      if (n === '1' || n === '7') return { t: 'home' };
      if (n === '4' || n === '8') return { t: 'end' };
      if (n === '3') return { t: 'delete' };
      return null; // 200~/201~ bracketed paste markers, function keys, …
    }
    default:
      return null;
  }
}

function ss3Key(final: string): Key | null {
  switch (final) {
    case 'A':
      return { t: 'up' };
    case 'B':
      return { t: 'down' };
    case 'C':
      return { t: 'right' };
    case 'D':
      return { t: 'left' };
    case 'H':
      return { t: 'home' };
    case 'F':
      return { t: 'end' };
    default:
      return null;
  }
}

/** Split one chunk of terminal input into keys. A chunk always holds whole escape sequences (xterm sends them atomically). */
export function tokenizeInput(data: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === '\x1b') {
      const next = data[i + 1];
      if (next === '[') {
        let j = i + 2;
        while (j < data.length && data.charCodeAt(j) >= 0x30 && data.charCodeAt(j) <= 0x3f) j++;
        while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) <= 0x2f) j++;
        if (j >= data.length) break; // truncated sequence: drop it
        const k = csiKey(data.slice(i + 2, j), data[j]);
        if (k) keys.push(k);
        i = j + 1;
        continue;
      }
      if (next === 'O' && i + 2 < data.length) {
        const k = ss3Key(data[i + 2]);
        if (k) keys.push(k);
        i += 3;
        continue;
      }
      if (next === 'b') keys.push({ t: 'wordLeft' });
      else if (next === 'f') keys.push({ t: 'wordRight' });
      else if (next === '\x7f') keys.push({ t: 'killWordBack' });
      // A lone Esc (or Alt+other) does nothing at the prompt.
      i += next === undefined ? 1 : 2;
      continue;
    }
    if (ch === '\r') {
      keys.push({ t: 'enter' });
      i += data[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      keys.push({ t: 'enter' });
      i++;
      continue;
    }
    if (ch === '\x7f' || ch === '\b') {
      keys.push({ t: 'backspace' });
      i++;
      continue;
    }
    if (ch === '\t') {
      keys.push({ t: 'tab' });
      i++;
      continue;
    }
    const code = data.charCodeAt(i);
    if (code < 0x20) {
      keys.push({ t: 'ctrl', c: String.fromCharCode(code + 0x60) });
      i++;
      continue;
    }
    // Run of printable characters (kept together so a paste is one redraw).
    let j = i;
    while (j < data.length) {
      const cc = data.charCodeAt(j);
      if (cc < 0x20 || cc === 0x7f) break;
      j++;
    }
    keys.push({ t: 'text', s: data.slice(i, j) });
    i = j;
  }
  return keys;
}
