import { describe, expect, it } from 'vitest';
import { readChatStream, AiError } from '../../src/services/ai/LocalAi';
import { loadChats, saveChats, newChat, titleFrom } from '../../src/apps/ai/chats';

function stream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });
}

const chunk = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

describe('readChatStream', () => {
  it('joins text deltas, including ones split across network chunks, and stops at [DONE]', async () => {
    const whole = chunk({ content: 'Hel' }) + chunk({ content: 'lo' }) + 'data: [DONE]\n\n' + chunk({ content: 'ignored' });
    const parts = [whole.slice(0, 17), whole.slice(17, 40), whole.slice(40)];
    let text = '';
    await readChatStream(stream(parts), { onText: (d) => (text += d) });
    expect(text).toBe('Hello');
  });

  it('passes reasoning separately (reasoning or reasoning_content)', async () => {
    let text = '';
    let thought = '';
    await readChatStream(stream([chunk({ reasoning: 'hmm ' }), chunk({ reasoning_content: 'ok' }), chunk({ content: 'Hi' })]), {
      onText: (d) => (text += d),
      onReasoning: (d) => (thought += d),
    });
    expect(thought).toBe('hmm ok');
    expect(text).toBe('Hi');
  });

  it('turns an error event into an AiError', async () => {
    await expect(readChatStream(stream(['data: {"error":{"message":"model not found"}}\n\n']), { onText: () => {} })).rejects.toBeInstanceOf(AiError);
  });
});

describe('AI chats storage', () => {
  function memory(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  }

  it('round-trips chats and finishes replies that were streaming when the page closed', () => {
    const s = memory();
    const c = newChat('qwen3.8:27b');
    c.messages.push({ role: 'user', content: 'hi' }, { role: 'assistant', content: 'part', streaming: true });
    saveChats({ version: 1, chats: [c], activeId: c.id, model: 'qwen3.8:27b' }, s);
    const back = loadChats(s);
    expect(back.chats[0].messages[1]).toEqual({ role: 'assistant', content: 'part', streaming: false });
    expect(back.activeId).toBe(c.id);
  });

  it('keeps only the newest 60 chats', () => {
    const s = memory();
    const chats = Array.from({ length: 70 }, (_, i) => ({ ...newChat('m'), id: `c${i}`, updatedAt: i }));
    saveChats({ version: 1, chats, activeId: null, model: 'm' }, s);
    const back = loadChats(s);
    expect(back.chats).toHaveLength(60);
    expect(back.chats[0].id).toBe('c69');
  });

  it('ignores corrupt storage', () => {
    const s = memory();
    s.setItem('orbit:ai:v1', '{nope');
    expect(loadChats(s).chats).toEqual([]);
  });

  it('makes short one-line titles', () => {
    expect(titleFrom('  hello\nworld ')).toBe('hello world');
    expect(titleFrom('x'.repeat(80))).toHaveLength(48);
  });
});
