import { describe, expect, it } from 'vitest';
import { cleanReply, joinGhost, rewritePrompt, wantsGhost, writable } from '../../src/shell/orb/write';

describe('writing help', () => {
  it('works in plain text boxes only: never passwords, codes, autofill, code editor or terminal', () => {
    document.body.innerHTML = `
      <textarea id="a"></textarea>
      <input id="b" type="text">
      <input id="c" type="password">
      <input id="d" autocomplete="one-time-code">
      <input id="e" autocomplete="email">
      <div class="cm-editor"><div id="f" contenteditable="true"></div></div>
      <div data-private><textarea id="g"></textarea></div>
      <textarea id="h" readonly></textarea>
      <div id="i" contenteditable="true"></div>`;
    const ok = (id: string) => Boolean(writable(document.getElementById(id)));
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(ok)).toEqual([true, true, false, false, false, false, false, false]);
  });

  it('asks for ghost text only mid-thought', () => {
    expect(wantsGhost('Hi')).toBe(false);
    expect(wantsGhost('Thanks for the help with')).toBe(true);
    expect(wantsGhost('Thanks for the help.\n')).toBe(false);
    expect(wantsGhost('const x = { a: 1 };')).toBe(false);
  });

  it('tidies replies and joins the ghost without double spaces', () => {
    expect(cleanReply('<think>hmm</think>"Hello there."')).toBe('Hello there.');
    expect(cleanReply("Here's the fixed text:\nI went home.")).toBe('I went home.');
    expect(cleanReply(' the store\nand more', true)).toBe(' the store');
    expect(joinGhost('I went to ', ' the store')).toBe('the store');
    expect(joinGhost('I went to', ' the store')).toBe(' the store');
    expect(joinGhost('Hi,', 'how are you')).toBe(' how are you');
    expect(joinGhost('Hi', '   ')).toBe('');
  });

  it('rewrite prompts say what to do and to reply with only the text', () => {
    expect(rewritePrompt('fix')).toMatch(/spelling/);
    expect(rewritePrompt('translate', 'Spanish')).toMatch(/into Spanish/);
    expect(rewritePrompt('shorter')).toMatch(/ONLY the new text/);
  });
});
