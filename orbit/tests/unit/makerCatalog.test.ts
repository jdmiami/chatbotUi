import { describe, expect, it } from 'vitest';
import { MAKER_CATALOG, withCatalog } from '../../src/apps/ai/makerCatalog';

describe('withCatalog', () => {
  it('adds every catalog maker an older AI machine does not know, as pending', () => {
    // An older machine: only the first list, no video editors.
    const old = MAKER_CATALOG.filter((m) => m.kind !== 'videoedit' && m.id !== 's2v' && m.id !== 'ltx-25').map((m) => ({ ...m, installed: true }));
    const all = withCatalog(old);
    for (const id of ['vace', 'video-erase', 'video-sharpen', 's2v', 'ltx-25']) {
      const m = all.find((x) => x.id === id);
      expect(m, id).toBeTruthy();
      expect(m!.pending).toBe(true);
      expect(m!.installed).toBe(false);
    }
    // What the machine reported is kept as it said.
    expect(all.find((m) => m.id === 'qwen')!.pending).toBeUndefined();
    expect(all.find((m) => m.id === 'qwen')!.installed).toBe(true);
    // Catalog extras too (makerDefs in ai/gate/catalog.json).
    expect(all.some((m) => m.id === 'ultrasharp' && m.pending)).toBe(true);
  });

  it('marks nothing pending when the machine knows them all', () => {
    const machine = withCatalog([]).map(({ pending: _p, ...m }) => m);
    expect(withCatalog(machine).some((m) => m.pending)).toBe(false);
  });
});
