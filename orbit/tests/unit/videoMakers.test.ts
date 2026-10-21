import { describe, expect, it } from 'vitest';
import { MAKER_CATALOG } from '../../src/apps/ai/makerCatalog';
import { CATALOG, CATALOG_MAKERS } from '../../src/apps/store/catalog';

/** The offline list of video makers matches the catalog the AI machine installs from. */
describe('video makers (offline catalog)', () => {
  const ids = ['ltx-25', 's2v', 'vace', 'video-erase', 'video-sharpen'];

  it('lists all five in both places, with the same kind, needs and tasks', () => {
    for (const id of ids) {
      const offline = MAKER_CATALOG.find((m) => m.id === id);
      const def = CATALOG_MAKERS.find((m) => m.id === id);
      expect(offline, id).toBeTruthy();
      expect(def, id).toBeTruthy();
      expect(offline!.kind).toBe(def!.kind);
      expect(offline!.needs ?? []).toEqual(def!.needs);
      expect(offline!.tasks ?? []).toEqual(def!.tasks);
      expect(offline!.accepts ?? []).toEqual(def!.accepts);
      expect(offline!.installed).toBe(false);
      expect(CATALOG.makers[id]?.about, `${id} has a store page`).toBeTruthy();
    }
  });

  it('marks only LTX-2.5 as gated, and counts sizes from its files', () => {
    expect(CATALOG_MAKERS.filter((m) => m.gated).map((m) => m.id)).toEqual(['ltx-25']);
    const ltx = CATALOG_MAKERS.find((m) => m.id === 'ltx-25')!;
    expect(ltx.size).toBeGreaterThan(39e9);
    expect(ltx.size).toBeLessThan(40e9);
    expect(CATALOG_MAKERS.find((m) => m.id === 'video-sharpen')!.size).toBe(3458259704 + 501324814);
  });
});
