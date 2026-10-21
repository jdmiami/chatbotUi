// What is kept, and what it costs: everything in R2 grouped by what it is for, plus each gallery
// item's size so the storage manager can show the biggest first. Listing a whole bucket takes a
// moment, so the answer is kept for a few minutes (a delete clears it).

/** Cloudflare R2 storage: the first 10 GB are free, then $0.015 per GB each month. */
export const R2_FREE_GB = 10;
export const R2_PER_GB_MONTH = 0.015;
const GB = 1024 ** 3;

const FOLDERS = [
  { prefix: 'gallery/', id: 'gallery', label: 'Your pictures and videos' },
  { prefix: 'models/', id: 'makers', label: 'Picture and video makers' },
  { prefix: 'ollama/', id: 'chat', label: 'Chat models' },
  { prefix: 'env/', id: 'software', label: 'Maker software' },
  { prefix: 'state/', id: 'state', label: 'Settings, chats and lists' },
  { prefix: 'linux/', id: 'linux', label: 'Linux machine (your home folder)' },
];

export function r2MonthlyCost(bytes) {
  return Math.max(0, bytes / GB - R2_FREE_GB) * R2_PER_GB_MONTH;
}

/**
 * `r2`: the bucket (null when this machine keeps nothing there). `items()`: the gallery's items
 * ({id, file}). `disks()`: this machine's disks ({label, total, free}).
 */
export function createStorageReport({ r2, items, disks = () => [], maxAgeMs = 5 * 60_000, now = Date.now }) {
  let cached = null;
  let pending = null;

  async function build() {
    const report = { at: new Date(now()).toISOString(), disks: await disks(), cloud: null, items: [] };
    if (!r2) return report;
    const all = await r2.list('');
    const size = new Map(all.map((o) => [o.key, o.size]));
    const folders = FOLDERS.map((f) => ({ id: f.id, label: f.label, bytes: 0, files: 0 }));
    const other = { id: 'other', label: 'Other', bytes: 0, files: 0 };
    let total = 0;
    for (const o of all) {
      total += o.size;
      const i = FOLDERS.findIndex((f) => o.key.startsWith(f.prefix));
      const f = i >= 0 ? folders[i] : other;
      f.bytes += o.size;
      f.files++;
    }
    if (other.files) folders.push(other);
    report.cloud = {
      bytes: total,
      files: all.length,
      freeBytes: R2_FREE_GB * GB,
      perGbMonth: R2_PER_GB_MONTH,
      costPerMonth: r2MonthlyCost(total),
      folders,
    };
    for (const it of (await items()) || []) {
      const file = it.file ? size.get(`gallery/${it.file}`) : undefined;
      const note = size.get(`gallery/orbit/${it.id}.json`) || 0;
      if (file === undefined && !note) continue;
      report.items.push({ id: it.id, bytes: (file || 0) + note });
    }
    report.items.sort((a, b) => b.bytes - a.bytes);
    return report;
  }

  return {
    async get({ fresh = false } = {}) {
      if (!fresh && cached && now() - cached.at < maxAgeMs) return cached.report;
      pending ||= build()
        .then((report) => {
          cached = { at: now(), report };
          return report;
        })
        .finally(() => (pending = null));
      return pending;
    },
    /** Something was deleted: the next look lists again. */
    forget() {
      cached = null;
    },
  };
}
