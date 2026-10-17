import { describe, expect, it } from 'vitest';
import { branchChat, newChat, shown, toHistory, type AiMessage } from '../../src/apps/ai/chats';
import { addFact, personaById, systemPrompt, type MemoryStore } from '../../src/apps/ai/memory';
import { isTextFile, withFiles } from '../../src/apps/ai/attach';

const mem = (over: Partial<MemoryStore> = {}): MemoryStore => ({ version: 1, facts: [], personas: [], defaultPersona: 'default', enabled: true, ...over });

describe('toHistory', () => {
  it('sends photos as image parts and files as labelled blocks before the text', () => {
    const msgs: AiMessage[] = [{ role: 'user', content: 'Look', images: ['data:image/jpeg;base64,AA'], files: [{ name: 'a.txt', text: 'hello' }] }];
    const [m] = toHistory(msgs, '');
    expect(m.role).toBe('user');
    const parts = m.content as { type: string; text?: string }[];
    expect(parts[0]).toEqual({ type: 'text', text: 'File: a.txt\n```\nhello\n```\n\nLook' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } });
  });

  it('uses the picked answer, skips errors, describes pictures, and opens with the instructions', () => {
    const msgs: AiMessage[] = [
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'first', model: 'a', alts: [{ role: 'assistant', content: 'second', model: 'b' }], pick: 1 },
      { role: 'user', content: 'draw' },
      { role: 'assistant', content: '', picture: { url: 'u', prompt: 'a cat' } },
      { role: 'assistant', content: '', error: 'boom' },
    ];
    expect(toHistory(msgs, 'Be nice')).toEqual([
      { role: 'system', content: 'Be nice' },
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'draw' },
      { role: 'assistant', content: '[I made a picture: a cat]' },
    ]);
  });
});

describe('branchChat', () => {
  it('copies messages up to the point, keeping the chosen answers only', () => {
    const c = { ...newChat('m'), title: 'Trip', persona: 'coder', messages: [
      { role: 'user' as const, content: 'one' },
      { role: 'assistant' as const, content: 'a', alts: [{ role: 'assistant' as const, content: 'b' }], pick: 1 },
      { role: 'user' as const, content: 'two' },
    ] };
    const b = branchChat(c, 1);
    expect(b.id).not.toBe(c.id);
    expect(b.title).toBe('↳ Trip');
    expect(b.branchOf).toBe(c.id);
    expect(b.persona).toBe('coder');
    expect(b.messages.map((m) => m.content)).toEqual(['one', 'b']);
    expect(b.messages[1].alts).toBeUndefined();
    expect(shown(c.messages[1]).content).toBe('b');
  });
});

describe('memory and personas', () => {
  it('builds instructions from persona, memory and the chat, and respects the switch', () => {
    let m = addFact(mem(), '  I live   in Miami ');
    m = addFact(m, 'i live in miami'); // duplicate ignored
    expect(m.facts.map((f) => f.text)).toEqual(['I live in Miami']);
    const s = systemPrompt(m, 'tutor', 'Chat rule');
    expect(s).toMatch(/patient tutor/);
    expect(s).toContain('- I live in Miami');
    expect(s.endsWith('Chat rule')).toBe(true);
    expect(systemPrompt({ ...m, enabled: false }, 'default')).toBe('');
    expect(personaById(m, 'nope').id).toBe('default');
  });
});

describe('attachments', () => {
  it('recognises text and code files', () => {
    expect(isTextFile({ name: 'x.py', type: '' })).toBe(true);
    expect(isTextFile({ name: 'x.bin', type: 'application/octet-stream' })).toBe(false);
    expect(isTextFile({ name: 'data', type: 'application/json' })).toBe(true);
    expect(withFiles('hi')).toBe('hi');
  });
});
