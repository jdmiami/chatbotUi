import { afterEach, describe, expect, it } from 'vitest';
import { LAST_KEY, LAST_MAX, LINKS_GOOD_MS, readLast, saveLast, slim, type LastGallery } from '../../src/services/ai/galleryCache';
import type { StoredItem } from '../../src/services/ai/StoredGallery';

const item = (i: number, extra: Partial<StoredItem> = {}): StoredItem => ({
  id: `item${i}`,
  kind: 'image',
  source: 'make',
  prompt: `picture ${i}`,
  width: 1024,
  height: 768,
  nsfw: i % 3 === 0 ? true : undefined,
  lab: false,
  createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
  url: `https://r2.example/gallery/orbit/item${i}.png?sig=1`,
  downloadUrl: `https://r2.example/gallery/orbit/item${i}.png?dl=1`,
  thumbUrl: `https://r2.example/gallery/thumbs/item${i}.webp?sig=1`,
  bytes: 3_000_000,
  ...extra,
});

describe("the Gallery's last list on this device", () => {
  afterEach(() => localStorage.clear());

  it('keeps ids, words, NSFW marks and links, never the save links or sizes, and only the newest', () => {
    const last: LastGallery = { at: 1, stored: { configured: true, items: Array.from({ length: LAST_MAX + 50 }, (_, i) => item(i, i === 55 ? { nsfwUser: false } : {})) }, machine: null };
    const kept = slim(last);
    expect(kept.stored!.items).toHaveLength(LAST_MAX);
    expect(kept.stored!.items[0].id).toBe(`item${LAST_MAX + 49}`);
    expect(kept.stored!.items.some((i) => i.id === 'item49')).toBe(false);
    const one = kept.stored!.items.find((i) => i.id === 'item60')!;
    expect(one).toMatchObject({ id: 'item60', kind: 'image', prompt: 'picture 60', nsfw: true, url: item(60).url, thumbUrl: item(60).thumbUrl, width: 1024, height: 768 });
    expect(one.downloadUrl).toBe('');
    expect(one.bytes).toBe(0);
    expect(kept.stored!.items.find((i) => i.id === 'item55')!.nsfwUser).toBe(false);
    // Small enough for an iPhone's storage: no picture data, about half a kilobyte an item.
    const json = JSON.stringify(kept);
    expect(json).not.toMatch(/base64|data:/);
    expect(json.length / LAST_MAX).toBeLessThan(600);
  });

  it('comes back as saved while its links work, and without links (blank tiles) once they are too old', () => {
    const at = Date.now();
    saveLast({ at, stored: { configured: true, items: [item(1)] }, machine: { items: [{ id: 'mach1', kind: 'video', prompt: 'p', createdAt: 'x', url: 'https://ai/file?t=1', thumbUrl: 'https://ai/thumb?t=1' }], lab: [] } });
    const fresh = readLast(at + 60_000)!;
    expect(fresh.stored!.items[0].url).toBe(item(1).url);
    expect(fresh.machine!.items[0].thumbUrl).toBe('https://ai/thumb?t=1');
    const old = readLast(at + LINKS_GOOD_MS + 1)!;
    expect(old.stored!.items[0]).toMatchObject({ id: 'item1', url: '', thumbUrl: undefined, prompt: 'picture 1' });
    expect(old.machine!.items[0].url).toBe('');
  });

  it('a broken or missing list is no list (and a private window never throws)', () => {
    expect(readLast()).toBeNull();
    localStorage.setItem(LAST_KEY, '{nope');
    expect(readLast()).toBeNull();
    localStorage.setItem(LAST_KEY, JSON.stringify({ at: 'x' }));
    expect(readLast()).toBeNull();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      expect(() => saveLast({ at: 1, stored: null, machine: null })).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
