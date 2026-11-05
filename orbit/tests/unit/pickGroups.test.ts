import { describe, expect, it } from 'vitest';
import { aiMakers, pickGroups } from '../../src/apps/ai/makerCatalog';

describe('what to load first: every maker, in groups', () => {
  it('lists every maker the AI machine can run, yours first, the rest by what they make', () => {
    const all = aiMakers();
    const groups = pickGroups(all, ['qwen', 'edit', 'h3-max']);
    expect(groups[0]).toMatchObject({ label: 'Yours' });
    expect(groups[0].makers.map((m) => m.id)).toEqual(['qwen', 'edit', 'h3-max']);
    // Nothing left out, nothing twice.
    const shown = groups.flatMap((g) => g.makers.map((m) => m.id));
    expect(shown.length).toBe(all.length);
    expect(new Set(shown).size).toBe(all.length);
    const labels = groups.map((g) => g.label);
    for (const l of ['Pictures', 'Videos', '3D objects', 'Rigging']) expect(labels).toContain(l);
    // Live Draw makers belong to the drawing machine.
    expect(all.some((m) => m.kind === 'live' || m.kind === 'sketch')).toBe(false);
  });

  it('keeps the order of yours, skips ids it does not know, and leaves out empty groups', () => {
    const list = [
      { id: 'a', kind: 'video' as const },
      { id: 'b', kind: 'image' as const },
      { id: 'c', kind: 'image' as const },
    ];
    expect(pickGroups(list, ['c', 'nope', 'a'])).toEqual([
      { label: 'Yours', makers: [list[2], list[0]] },
      { label: 'Pictures', makers: [list[1]] },
    ]);
    expect(pickGroups(list).map((g) => g.label)).toEqual(['Pictures', 'Videos']);
  });
});
