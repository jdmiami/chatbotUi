/**
 * Command-line parser for the simulated shell: a small, predictable subset of bash.
 *
 * Supported: words, 'single' and "double" quotes, backslash escapes, $VAR / ${VAR} / $?,
 * leading ~, # comments, pipes (|), redirects (> >>), and lists (; && ||).
 * Variables are kept as segments and expanded at run time so `cd src; echo $PWD` is correct.
 */

export type Segment =
  | { kind: 'lit'; text: string; quoted: boolean }
  | { kind: 'var'; name: string; quoted: boolean }
  | { kind: 'home' };

export interface Word {
  segs: Segment[];
}

export interface Redirect {
  op: '>' | '>>';
  target: Word;
}

export interface SimpleCommand {
  words: Word[];
  redirects: Redirect[];
}

export interface ListItem {
  /** Operator that joins this pipeline to the previous one (null for the first). */
  op: null | ';' | '&&' | '||';
  pipeline: SimpleCommand[];
}

export type ParseResult = { ok: true; list: ListItem[] } | { ok: false; error: string };

type Token = { type: 'word'; word: Word } | { type: 'op'; op: '|' | '||' | '&&' | ';' | '>' | '>>' };

class ParseError extends Error {}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let segs: Segment[] | null = null;
  let lit = '';
  let litQuoted = false;

  const flushLit = () => {
    if (lit && segs) segs.push({ kind: 'lit', text: lit, quoted: litQuoted });
    lit = '';
  };
  const startWord = () => {
    segs ??= [];
  };
  const pushLit = (text: string, quoted: boolean) => {
    startWord();
    if (quoted !== litQuoted) flushLit();
    litQuoted = quoted;
    lit += text;
  };
  const endWord = () => {
    if (segs) {
      flushLit();
      tokens.push({ type: 'word', word: { segs } });
    }
    segs = null;
    lit = '';
  };
  const op = (o: Extract<Token, { type: 'op' }>['op']) => {
    endWord();
    tokens.push({ type: 'op', op: o });
  };

  /** Parses $NAME, ${NAME}, $? at line[i] === '$'. Returns new index, or -1 if not a variable. */
  const readVar = (i: number, quoted: boolean): number => {
    const next = line[i + 1];
    if (next === '(') throw new ParseError("command substitution $(…) isn't supported in the simulated shell");
    if (next === '?' || next === '$') {
      flushLit();
      startWord();
      segs!.push({ kind: 'var', name: next, quoted });
      return i + 2;
    }
    if (next === '{') {
      const close = line.indexOf('}', i + 2);
      if (close < 0) throw new ParseError('bad substitution: missing }');
      const name = line.slice(i + 2, close);
      if (!/^([A-Za-z_][A-Za-z0-9_]*|\?)$/.test(name)) throw new ParseError(`\${${name}}: bad substitution`);
      flushLit();
      startWord();
      segs!.push({ kind: 'var', name, quoted });
      return close + 1;
    }
    if (next && NAME_START.test(next)) {
      let j = i + 1;
      while (j < line.length && NAME_CHAR.test(line[j])) j++;
      flushLit();
      startWord();
      segs!.push({ kind: 'var', name: line.slice(i + 1, j), quoted });
      return j;
    }
    return -1;
  };

  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      endWord();
      i++;
      continue;
    }
    if (c === '#' && segs === null) break; // comment
    if (c === '|') {
      if (line[i + 1] === '|') {
        op('||');
        i += 2;
      } else {
        op('|');
        i++;
      }
      continue;
    }
    if (c === '&') {
      if (line[i + 1] === '&') {
        op('&&');
        i += 2;
        continue;
      }
      throw new ParseError("background jobs (&) aren't supported in the simulated shell");
    }
    if (c === ';') {
      op(';');
      i++;
      continue;
    }
    if (c === '>') {
      if (line[i + 1] === '>') {
        op('>>');
        i += 2;
      } else {
        op('>');
        i++;
      }
      continue;
    }
    if (c === '<') throw new ParseError("input redirection (<) isn't supported in the simulated shell");
    if (c === '`') throw new ParseError("command substitution (`…`) isn't supported in the simulated shell");

    if (c === '\\') {
      if (i + 1 < line.length) pushLit(line[i + 1], true);
      i += 2;
      continue;
    }
    if (c === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) throw new ParseError("unexpected end of line while looking for matching `''");
      pushLit(line.slice(i + 1, close), true);
      if (close === i + 1) startWord(); // '' is an empty word
      i = close + 1;
      continue;
    }
    if (c === '"') {
      startWord();
      let j = i + 1;
      let closed = false;
      while (j < line.length) {
        const d = line[j];
        if (d === '"') {
          closed = true;
          j++;
          break;
        }
        if (d === '\\' && j + 1 < line.length && '"\\$`'.includes(line[j + 1])) {
          pushLit(line[j + 1], true);
          j += 2;
          continue;
        }
        if (d === '`') throw new ParseError("command substitution (`…`) isn't supported in the simulated shell");
        if (d === '$') {
          const k = readVar(j, true);
          if (k >= 0) {
            j = k;
            continue;
          }
        }
        pushLit(d, true);
        j++;
      }
      if (!closed) throw new ParseError('unexpected end of line while looking for matching `"\'');
      i = j;
      continue;
    }
    if (c === '$') {
      const k = readVar(i, false);
      if (k >= 0) {
        i = k;
        continue;
      }
    }
    if (c === '~' && segs === null) {
      const next = line[i + 1];
      if (next === undefined || next === '/' || /[\s|;&<>]/.test(next)) {
        startWord();
        segs!.push({ kind: 'home' });
        i++;
        continue;
      }
    }
    pushLit(c, false);
    i++;
  }
  endWord();
  return tokens;
}

export function parseCommandLine(line: string): ParseResult {
  let tokens: Token[];
  try {
    tokens = tokenize(line);
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.message };
    throw err;
  }

  const list: ListItem[] = [];
  let pipeline: SimpleCommand[] = [];
  let cmd: SimpleCommand = { words: [], redirects: [] };
  let pendingOp: ListItem['op'] = null;
  const unexpected = (t: string): ParseResult => ({ ok: false, error: `syntax error near unexpected token \`${t}'` });
  const cmdEmpty = () => cmd.words.length === 0 && cmd.redirects.length === 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'word') {
      cmd.words.push(t.word);
      continue;
    }
    switch (t.op) {
      case '>':
      case '>>': {
        const target = tokens[i + 1];
        if (!target || target.type !== 'word') return unexpected(target && target.type === 'op' ? target.op : 'newline');
        cmd.redirects.push({ op: t.op, target: target.word });
        i++;
        break;
      }
      case '|':
        if (cmdEmpty()) return unexpected('|');
        pipeline.push(cmd);
        cmd = { words: [], redirects: [] };
        break;
      case ';':
      case '&&':
      case '||':
        if (cmdEmpty()) {
          // A trailing ';' is fine; anything else with nothing before it is an error.
          if (t.op === ';' && pipeline.length === 0 && list.length > 0 && i === tokens.length - 1) break;
          return unexpected(t.op);
        }
        pipeline.push(cmd);
        list.push({ op: pendingOp, pipeline });
        pendingOp = t.op;
        pipeline = [];
        cmd = { words: [], redirects: [] };
        break;
    }
  }
  if (!cmdEmpty()) {
    pipeline.push(cmd);
    list.push({ op: pendingOp, pipeline });
  } else if (pipeline.length > 0) {
    return unexpected('newline');
  } else if (pendingOp === '&&' || pendingOp === '||') {
    return unexpected('newline');
  }
  return { ok: true, list };
}

/** True when the word contains an unquoted * or ? (and so should be glob-expanded). */
export function hasGlob(word: Word): boolean {
  return word.segs.some((s) => s.kind === 'lit' && !s.quoted && /[*?]/.test(s.text));
}

/**
 * Expand variables and ~. Returns null when the word was a lone unquoted variable that
 * expanded to nothing (bash drops such words).
 */
export function expandWord(word: Word, env: (name: string) => string | undefined, home: string): string | null {
  let out = '';
  let onlyUnquotedVars = true;
  for (const s of word.segs) {
    if (s.kind === 'lit') {
      out += s.text;
      onlyUnquotedVars = false;
    } else if (s.kind === 'home') {
      out += home;
      onlyUnquotedVars = false;
    } else {
      out += env(s.name) ?? '';
      if (s.quoted) onlyUnquotedVars = false;
    }
  }
  if (word.segs.length === 0) return '';
  if (onlyUnquotedVars && out === '') return null;
  return out;
}
