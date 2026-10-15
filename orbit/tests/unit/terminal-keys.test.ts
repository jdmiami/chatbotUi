import { describe, expect, it } from 'vitest';
import {
  FONT_MAX,
  FONT_MIN,
  TOUCH_KEYS,
  applyStickyCtrl,
  clampFontSize,
  ctrlTransform,
  keySequence,
  parseOsc7,
  terminalSummary,
  withAlpha,
} from '../../src/apps/terminal/termKeys';

describe('touch key row', () => {
  it('has the expected keys in order, each with an accessible name', () => {
    expect(TOUCH_KEYS.map((k) => k.label)).toEqual([
      'Esc',
      'Tab',
      'Ctrl',
      '←',
      '↑',
      '↓',
      '→',
      '|',
      '~',
      '/',
      '-',
      '_',
      ':',
      'Paste',
    ]);
    for (const k of TOUCH_KEYS) expect(k.ariaLabel.length).toBeGreaterThan(2);
    expect(TOUCH_KEYS.find((k) => k.id === 'ctrl')?.ariaLabel).toBe('Control (sticky)');
    expect(TOUCH_KEYS.find((k) => k.id === 'up')?.ariaLabel).toBe('Arrow up');
    expect(new Set(TOUCH_KEYS.map((k) => k.id)).size).toBe(TOUCH_KEYS.length);
  });

  it('sends the right bytes for each key', () => {
    expect(keySequence('esc')).toBe('\x1b');
    expect(keySequence('tab')).toBe('\t');
    expect(keySequence('up')).toBe('\x1b[A');
    expect(keySequence('down')).toBe('\x1b[B');
    expect(keySequence('right')).toBe('\x1b[C');
    expect(keySequence('left')).toBe('\x1b[D');
    expect(keySequence('pipe')).toBe('|');
    expect(keySequence('tilde')).toBe('~');
    expect(keySequence('slash')).toBe('/');
    expect(keySequence('dash')).toBe('-');
    expect(keySequence('underscore')).toBe('_');
    expect(keySequence('colon')).toBe(':');
    // Ctrl and Paste don't send anything themselves.
    expect(keySequence('ctrl')).toBe('');
    expect(keySequence('paste')).toBe('');
  });

  it('uses SS3 arrows in application cursor mode (vim, less, tmux copy mode)', () => {
    expect(keySequence('up', { appCursor: true })).toBe('\x1bOA');
    expect(keySequence('left', { appCursor: true })).toBe('\x1bOD');
    expect(keySequence('esc', { appCursor: true })).toBe('\x1b');
  });
});

describe('Ctrl transform', () => {
  it('maps letters to C0 control codes, case-insensitively', () => {
    expect(ctrlTransform('c')).toBe('\x03');
    expect(ctrlTransform('C')).toBe('\x03');
    expect(ctrlTransform('a')).toBe('\x01');
    expect(ctrlTransform('d')).toBe('\x04');
    expect(ctrlTransform('l')).toBe('\x0c');
    expect(ctrlTransform('z')).toBe('\x1a');
  });

  it('maps the usual punctuation aliases like xterm', () => {
    expect(ctrlTransform('[')).toBe('\x1b');
    expect(ctrlTransform('\\')).toBe('\x1c');
    expect(ctrlTransform(']')).toBe('\x1d');
    expect(ctrlTransform('^')).toBe('\x1e');
    expect(ctrlTransform('_')).toBe('\x1f');
    expect(ctrlTransform('-')).toBe('\x1f');
    expect(ctrlTransform('/')).toBe('\x1f');
    expect(ctrlTransform(' ')).toBe('\x00');
    expect(ctrlTransform('@')).toBe('\x00');
    expect(ctrlTransform('?')).toBe('\x7f');
  });

  it('turns cursor keys into their Ctrl-modified form (word movement)', () => {
    expect(ctrlTransform('\x1b[D')).toBe('\x1b[1;5D');
    expect(ctrlTransform('\x1bOC')).toBe('\x1b[1;5C');
    expect(ctrlTransform('\x1b[A')).toBe('\x1b[1;5A');
  });

  it('passes control bytes through and has no Ctrl form for other input', () => {
    expect(ctrlTransform('\t')).toBe('\t');
    expect(ctrlTransform('\x1b')).toBe('\x1b');
    expect(ctrlTransform('\x7f')).toBe('\x7f');
    expect(ctrlTransform('|')).toBeNull();
    expect(ctrlTransform(':')).toBeNull();
    expect(ctrlTransform('é')).toBeNull();
    expect(ctrlTransform('ls -la')).toBeNull();
    expect(ctrlTransform('\x1b[200~')).toBeNull();
  });
});

describe('sticky Ctrl', () => {
  it('does nothing while not armed', () => {
    expect(applyStickyCtrl('c', false)).toEqual({ data: 'c', armed: false });
    expect(applyStickyCtrl('\x1b[A', false)).toEqual({ data: '\x1b[A', armed: false });
  });

  it('turns the next character into a control char and releases', () => {
    let armed = true;
    const first = applyStickyCtrl('c', armed);
    expect(first).toEqual({ data: '\x03', armed: false });
    armed = first.armed;
    // The following character is plain again.
    expect(applyStickyCtrl('c', armed)).toEqual({ data: 'c', armed: false });
  });

  it('applies to key-row keys too (Ctrl + ← = word left)', () => {
    expect(applyStickyCtrl(keySequence('left'), true)).toEqual({ data: '\x1b[1;5D', armed: false });
    expect(applyStickyCtrl(keySequence('dash'), true)).toEqual({ data: '\x1f', armed: false });
  });

  it('never stays stuck: input without a Ctrl form goes through unchanged and releases', () => {
    expect(applyStickyCtrl('hello', true)).toEqual({ data: 'hello', armed: false });
    expect(applyStickyCtrl('|', true)).toEqual({ data: '|', armed: false });
  });

  it('ignores empty input without releasing', () => {
    expect(applyStickyCtrl('', true)).toEqual({ data: '', armed: true });
  });
});

describe('helpers', () => {
  it('clamps the font size', () => {
    expect(clampFontSize(14)).toBe(14);
    expect(clampFontSize(2)).toBe(FONT_MIN);
    expect(clampFontSize(99)).toBe(FONT_MAX);
    expect(clampFontSize(13.6)).toBe(14);
    expect(clampFontSize(Number.NaN)).toBe(14);
  });

  it('parses OSC 7 working-directory reports', () => {
    expect(parseOsc7('file://orbit-demo/home/demo/orbit-demo/src')).toBe('~/orbit-demo/src');
    expect(parseOsc7('file://box/home/ubuntu')).toBe('~');
    expect(parseOsc7('file://box/root/projects')).toBe('~/projects');
    expect(parseOsc7('file://box/var/log')).toBe('/var/log');
    expect(parseOsc7('file:///tmp/my%20dir')).toBe('/tmp/my dir');
    expect(parseOsc7('file://box/home/demo2x')).toBe('~');
    expect(parseOsc7('file://box/homework')).toBe('/homework');
    expect(parseOsc7('not a url')).toBeNull();
  });

  it('adds alpha to hex colours for xterm', () => {
    expect(withAlpha('#6c7cff', 0.38)).toBe('#6c7cff61');
    expect(withAlpha('#ABC', 1)).toBe('#aabbccff');
    expect(withAlpha('rgb(1 2 3)', 0.5)).toBeNull();
  });
});

describe('App Switcher summary', () => {
  it('describes a demo session with cwd and command count', () => {
    expect(terminalSummary({ mode: 'demo', status: 'connected', cwd: '~/orbit-demo', commands: 3 })).toBe(
      'Simulated shell · ~/orbit-demo · 3 commands run',
    );
    expect(terminalSummary({ mode: 'demo', status: 'connected', cwd: '~/orbit-demo', commands: 1 })).toBe(
      'Simulated shell · ~/orbit-demo · 1 command run',
    );
  });

  it('describes a host session by its tmux session', () => {
    expect(terminalSummary({ mode: 'host', status: 'connected', session: 'main' })).toBe(
      'Linux machine · tmux session main',
    );
    expect(terminalSummary({ mode: 'host', status: 'connected', session: 'main', cwd: '~/app' })).toBe(
      'Linux machine · tmux session main · ~/app',
    );
    expect(terminalSummary({ mode: 'host', status: 'connected', persistent: false })).toBe('Linux machine · shell');
  });

  it('reports non-connected states plainly', () => {
    expect(terminalSummary({ mode: 'host', status: 'reconnecting' })).toBe('Linux machine · reconnecting…');
    expect(terminalSummary({ mode: 'demo', status: 'disconnected' })).toBe('Simulated shell · session ended');
    expect(terminalSummary({ mode: 'host', status: 'error' })).toBe('Linux machine · connection problem');
  });
});
