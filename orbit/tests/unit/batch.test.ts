import { describe, expect, it } from 'vitest';
import { batchMessages, parsePrompts } from '../../src/apps/make/batch';

describe('batch making', () => {
  it('reads a JSON list, even in a code block after some words', () => {
    expect(parsePrompts('Here you go:\n```json\n["A red fox in snow at dawn", "A lighthouse in a storm at night"]\n```')).toEqual(['A red fox in snow at dawn', 'A lighthouse in a storm at night']);
  });
  it('falls back to one per line, without numbers or bullets, no repeats, no short scraps', () => {
    expect(parsePrompts('1. A red fox in snow at dawn\n2) A lighthouse in a storm\n- a red fox in snow at dawn\nok')).toEqual(['A red fox in snow at dawn', 'A lighthouse in a storm']);
  });
  it('keeps at most the number asked for, and says when the writer refused', () => {
    expect(parsePrompts(JSON.stringify(Array.from({ length: 9 }, (_, i) => `Prompt number ${i}`)), 4)).toHaveLength(4);
    expect(parsePrompts('[not possible]')).toBeNull();
  });
  it('asks for that many, says what a video needs, and lists what is already written', () => {
    const [system, user] = batchMessages('cats in space', 8, 'video', ['A cat floating by a window']);
    expect(system.content).toContain('exactly 8');
    expect(system.content).toContain('camera moves');
    expect(user.content).toContain('A cat floating by a window');
  });
});
