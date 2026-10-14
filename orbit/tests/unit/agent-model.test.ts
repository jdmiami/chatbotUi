/** Pure helpers behind the Antigravity app (message parsing, keys, summaries, capabilities). */
import { describe, expect, it } from 'vitest';
import {
  agentSummary,
  enterAction,
  groupCapabilities,
  isSignInError,
  mergeItem,
  paragraphs,
  parseInline,
  parseMessage,
  statusLabel,
  statusTone,
  titleFromText,
} from '../../src/apps/agent/model';
import { AGY_CAPABILITIES } from '../../src/services/runner/agyCapabilities';
import type { SessionSummary, TranscriptItem } from '../../src/services/runner/types';

const session = (patch: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 's1',
  projectId: 'p',
  title: 'Fix tests',
  createdAt: 1,
  updatedAt: 2,
  status: 'idle',
  mode: 'default',
  messageCount: 2,
  simulated: false,
  conversationId: 'c1',
  ...patch,
});

describe('parseMessage', () => {
  it('splits prose and fenced code (``` and ~~~) and keeps the language', () => {
    const text = 'Intro with `x`.\n\n```ts\nconst a = 1;\n  indented();\n```\nAfter.\n~~~\nplain\n~~~';
    expect(parseMessage(text)).toEqual([
      { kind: 'text', text: 'Intro with `x`.' },
      { kind: 'code', lang: 'ts', code: 'const a = 1;\n  indented();' },
      { kind: 'text', text: 'After.' },
      { kind: 'code', lang: '', code: 'plain' },
    ]);
  });

  it('an unclosed fence (reply still arriving) runs to the end', () => {
    expect(parseMessage('Here:\n```py\nprint(1)')).toEqual([
      { kind: 'text', text: 'Here:' },
      { kind: 'code', lang: 'py', code: 'print(1)' },
    ]);
  });

  it('a longer closing fence closes; a shorter one does not', () => {
    expect(parseMessage('````md\n```\ninner\n```\n````')).toEqual([
      { kind: 'code', lang: 'md', code: '```\ninner\n```' },
    ]);
  });

  it('normalises CRLF', () => {
    expect(parseMessage('a\r\n```\r\nb\r\n```')).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'code', lang: '', code: 'b' },
    ]);
  });
});

describe('inline formatting', () => {
  it('finds `code` spans and leaves unmatched backticks as text', () => {
    expect(parseInline('Run `agy` once, then `ls`')).toEqual([
      { kind: 'text', text: 'Run ' },
      { kind: 'code', text: 'agy' },
      { kind: 'text', text: ' once, then ' },
      { kind: 'code', text: 'ls' },
    ]);
    expect(parseInline('a ` lone tick')).toEqual([{ kind: 'text', text: 'a ` lone tick' }]);
  });

  it('splits paragraphs on blank lines but keeps single line breaks', () => {
    expect(paragraphs('one\ntwo\n\n\nthree\n \nfour')).toEqual(['one\ntwo', 'three', 'four']);
  });
});

describe('mergeItem', () => {
  it('appends new items and replaces by id in place', () => {
    const a: TranscriptItem = { kind: 'user', id: 'a', at: 1, text: 'hi' };
    const b: TranscriptItem = { kind: 'activity', id: 'b', at: 2, title: 'Working', status: 'running' };
    const list = mergeItem(mergeItem([], a), b);
    expect(list.map((i) => i.id)).toEqual(['a', 'b']);
    const done = mergeItem(list, { ...b, status: 'done' } as TranscriptItem);
    expect(done).toHaveLength(2);
    expect(done[1]).toMatchObject({ status: 'done' });
    expect(list[1]).toMatchObject({ status: 'running' }); // not mutated
  });
});

describe('session status', () => {
  it('a session that never ran is "New"; otherwise the runner status', () => {
    expect(statusTone(session({ messageCount: 0, conversationId: undefined }))).toBe('new');
    expect(statusLabel(session({ messageCount: 0, conversationId: undefined }))).toBe('New');
    expect(statusLabel(session())).toBe('Ready');
    expect(statusLabel(session({ status: 'running' }))).toBe('Running');
    expect(statusLabel(session({ status: 'stopped' }))).toBe('Stopped');
    expect(statusLabel(session({ status: 'error' }))).toBe('Error');
  });
});

describe('agentSummary (App Switcher)', () => {
  it('"<title> — running" wins', () => {
    const s = session({ status: 'running' });
    expect(agentSummary({ sessionCount: 3, selected: s, running: [s], drafts: {} })).toBe('Fix tests — running');
  });

  it('"<title> — draft not sent" mentions unsaved', () => {
    const s = session();
    const text = agentSummary({ sessionCount: 3, selected: s, running: [], drafts: { s1: 'half a thought' } });
    expect(text).toMatch(/^Fix tests — draft not sent/);
    expect(text).toMatch(/unsaved/);
  });

  it('"<n> sessions", plus unsaved drafts elsewhere', () => {
    expect(agentSummary({ sessionCount: 1, selected: null, running: [], drafts: {} })).toBe('1 session');
    expect(agentSummary({ sessionCount: 4, selected: session(), running: [], drafts: { other: 'x', s1: '  ' } })).toBe(
      '4 sessions · 1 unsaved draft',
    );
  });
});

describe('isSignInError', () => {
  it('recognises sign-in / auth failures', () => {
    for (const t of [
      'agy is not signed in',
      'Please sign in first',
      'Authentication required',
      'not logged in',
      'auth token expired',
    ]) {
      expect(isSignInError(t), t).toBe(true);
    }
  });
  it('ignores unrelated errors', () => {
    for (const t of ['Request failed (500)', 'Could not reach the Linux machine.', 'author field missing']) {
      expect(isSignInError(t), t).toBe(false);
    }
  });
});

describe('enterAction', () => {
  const key = (patch: Partial<Parameters<typeof enterAction>[0]> = {}) => ({
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...patch,
  });
  it('fine pointer: Enter sends, Shift+Enter is a newline', () => {
    expect(enterAction(key(), true)).toBe('send');
    expect(enterAction(key({ shiftKey: true }), true)).toBe('newline');
  });
  it('coarse pointer: Enter is a newline', () => {
    expect(enterAction(key(), false)).toBe('newline');
  });
  it('Cmd/Ctrl+Enter always sends; IME composition and other keys do nothing', () => {
    expect(enterAction(key({ metaKey: true }), false)).toBe('send');
    expect(enterAction(key({ ctrlKey: true }), false)).toBe('send');
    expect(enterAction(key({ isComposing: true }), true)).toBe('none');
    expect(enterAction(key({ key: 'a' }), true)).toBe('none');
  });
});

describe('groupCapabilities', () => {
  it('groups the real agy capabilities: supported, not supported, not verified', () => {
    const groups = groupCapabilities(AGY_CAPABILITIES);
    expect(groups.map((g) => g.status)).toEqual(['supported', 'unsupported', 'unverified']);
    const keys = (s: string) => groups.find((g) => g.status === s)!.items.map((i) => i.key);
    expect(keys('supported')).toEqual(['newConversation', 'continueConversation', 'stop', 'modes', 'models']);
    expect(keys('unsupported')).toEqual(['pauseResume', 'approvals']);
    expect(keys('unverified').sort()).toEqual(['streamOutput']);
  });
});

describe('titleFromText', () => {
  it('uses the first words, shortened', () => {
    expect(titleFromText('  Explain\nthis   file ')).toBe('Explain this file');
    expect(titleFromText('x'.repeat(80))).toHaveLength(46);
    expect(titleFromText('   ')).toBe('New session');
  });
});
