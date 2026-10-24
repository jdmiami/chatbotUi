import crypto from 'node:crypto';

/**
 * Cloudflare R2 (S3-compatible) for the site, with no dependencies: the same small signed client the
 * AI machine uses (ai/gate/src/r2.js), so the site can read the gallery while the machine is off.
 *
 * The keys use the same names as on the AI machine: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, and R2_BUCKET (optional, "orbit-models"). They are never logged or returned.
 * Kept free of `server-only` so the tests can load it; only server code imports it.
 */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
}

/** The R2 settings from the environment, or null when they are not all set. */
export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || /RUNPOD_SECRET/.test(accountId + accessKeyId + secretAccessKey)) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket: env.R2_BUCKET?.trim() || 'orbit-models' };
}

const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest();
/** RFC 3986 encoding, as AWS Signature Version 4 wants it. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const UNSIGNED = 'UNSIGNED-PAYLOAD';
const amzDateOf = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');
const signingKey = (secret: string, day: string) => hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'auto'), 's3'), 'aws4_request');
const canonicalQuery = (query: Record<string, string>) =>
  Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join('&');

export class R2Error extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function createR2(conf: R2Config, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()) {
  const host = `${conf.accountId}.r2.cloudflarestorage.com`;
  const keyPath = (key: string) => `/${enc(conf.bucket)}/${key.split('/').map(enc).join('/')}`;

  /** A signed request (AWS Signature Version 4, headers). */
  async function call(method: string, path: string, { query = {}, headers = {}, body }: { query?: Record<string, string>; headers?: Record<string, string>; body?: Buffer } = {}) {
    const amzDate = amzDateOf(now());
    const day = amzDate.slice(0, 8);
    const payloadHash = body ? sha256(body) : method === 'GET' || method === 'HEAD' || method === 'DELETE' ? sha256('') : UNSIGNED;
    const all: Record<string, string> = {
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const names = Object.keys(all).sort();
    const qs = canonicalQuery(query);
    const canonical = [method, path, qs, names.map((n) => `${n}:${all[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
    const scope = `${day}/auto/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const signature = crypto.createHmac('sha256', signingKey(conf.secretAccessKey, day)).update(toSign).digest('hex');
    delete all.host;
    const res = await fetchImpl(`https://${host}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${conf.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
      body: body ? new Uint8Array(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    return res;
  }
  async function failed(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => '');
    throw new R2Error(`Storage ${what} failed (${res.status}): ${(/<Message>([^<]*)/.exec(text)?.[1] || text).slice(0, 160)}`, res.status);
  }

  return {
    bucket: conf.bucket,
    /** Every object under a prefix (ListObjectsV2), with its size and ETag. */
    async list(prefix: string): Promise<R2Object[]> {
      const out: R2Object[] = [];
      let token: string | null = null;
      do {
        const query: Record<string, string> = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
        const res = await call('GET', `/${enc(conf.bucket)}`, { query });
        if (!res.ok) await failed(res, 'list');
        const text = await res.text();
        for (const m of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1];
          if (key) out.push({ key: unxml(key), size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] || 0), etag: unxml(/<ETag>([^<]*)<\/ETag>/.exec(m[1])?.[1] || '') });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(text) ? unxml(/<NextContinuationToken>([^<]*)</.exec(text)?.[1] || '') || null : null;
      } while (token);
      return out;
    },
    /** A whole object (null when it isn't there). */
    async get(key: string): Promise<Buffer | null> {
      const res = await call('GET', keyPath(key));
      if (res.status === 404) return null;
      if (!res.ok) await failed(res, 'read');
      return Buffer.from(await res.arrayBuffer());
    },
    async getJson<T = unknown>(key: string): Promise<T | null> {
      const buf = await this.get(key);
      return buf ? (JSON.parse(buf.toString('utf8')) as T) : null;
    },
    /** `cacheControl`: kept with the object and sent with it (a thumbnail the browser may keep). */
    async put(key: string, body: Buffer | string, contentType = 'application/octet-stream', { cacheControl }: { cacheControl?: string } = {}) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const res = await call('PUT', keyPath(key), { headers: { 'content-type': contentType, 'content-length': String(buf.length), ...(cacheControl ? { 'cache-control': cacheControl } : {}) }, body: buf });
      if (!res.ok) await failed(res, 'save');
    },
    putJson(key: string, value: unknown) {
      return this.put(key, JSON.stringify(value), 'application/json');
    },
    /** The index of many small JSON objects (see IndexCache), or null. Start it next to the listing. */
    readIndex<T>(cache: IndexCache<T>) {
      return readIndexWith<T>(this, cache);
    },
    /** Read what changed since the index (see syncIndexWith). */
    syncIndex<T>(cache: IndexCache<T>, wanted: R2Object[], opts: { index?: Map<string, { etag: string; value: T }> | null; read?: (key: string) => Promise<T | null>; concurrency?: number } = {}) {
      return syncIndexWith<T>(this, cache, wanted, opts);
    },
    async remove(key: string) {
      const res = await call('DELETE', keyPath(key));
      if (!res.ok && res.status !== 404) await failed(res, 'delete');
    },
    /**
     * A link anyone can GET for `seconds` (for an <img> or <video> tag). `type` names what it is (the
     * AI machine saves files without one, and iPhone plays a video only when it is told it is one).
     * With `download`, the browser saves it under that name instead of showing it. `at`: when it is
     * signed (the same moment gives the same link, so pictures are not fetched again).
     */
    presign(key: string, seconds = 3600, { type, download, at }: { type?: string; download?: string; at?: Date } = {}): string {
      const p = keyPath(key);
      const amzDate = amzDateOf(at ?? now());
      const day = amzDate.slice(0, 8);
      const scope = `${day}/auto/s3/aws4_request`;
      const query: Record<string, string> = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${conf.accessKeyId}/${scope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(seconds),
        'X-Amz-SignedHeaders': 'host',
        ...(download ? { 'response-content-disposition': `attachment; filename="${download.replace(/[^A-Za-z0-9._-]/g, '_')}"` } : {}),
        ...(type ? { 'response-content-type': type } : {}),
      };
      const qs = canonicalQuery(query);
      const canonical = ['GET', p, qs, `host:${host}\n`, 'host', UNSIGNED].join('\n');
      const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
      const signature = crypto.createHmac('sha256', signingKey(conf.secretAccessKey, day)).update(toSign).digest('hex');
      return `https://${host}${p}?${qs}&X-Amz-Signature=${signature}`;
    },
  };
}

// ---------------------------------------------------------------- reading many small JSON objects

/**
 * Many small JSON objects in R2 (the gallery's notes, the held records), read the cheap way.
 *
 * Reading each one on every listing costs one round trip per object from the site's region, and a
 * serverless instance forgets what it read when it stops. So the site also keeps one index object in
 * R2 ({ key: { etag, value } }): a cold listing reads the listing and the index, and then only the
 * objects whose ETag changed or that are new. The listing's ETags are always the truth: an index entry
 * counts only when its ETag matches, so a stale or half-written index costs extra reads, never wrong data.
 * The index is written back only when it changed (best effort: two instances writing at once just
 * means a few more reads next time). Each client has readIndex() and syncIndex() for this.
 */
export interface IndexCache<T> {
  key: string;
  /** What this instance has read, by object key. */
  memory: Map<string, { etag: string; value: T }>;
  /** A fingerprint of what the index in R2 holds as far as this instance knows (null: not known). */
  sig: string | null;
}

const fingerprint = (entries: Iterable<[string, { etag: string }]>) => {
  const h = crypto.createHash('sha1');
  for (const [k, v] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) h.update(`${k}\0${v.etag}\n`);
  return h.digest('hex');
};

/** What the index helpers need of the client. */
interface JsonStore {
  getJson<T = unknown>(key: string): Promise<T | null>;
  putJson(key: string, value: unknown): Promise<void>;
}

type Stored<T> = { v: 1; entries: Record<string, { etag: string; value: T }> };

/** The index from R2, started before the listing so both travel at once (null when there is none or it is unreadable). */
function readIndexWith<T>(r2: JsonStore, cache: IndexCache<T>): Promise<Map<string, { etag: string; value: T }> | null> {
  return r2
    .getJson<Stored<T>>(cache.key)
    .then((s) => {
      if (!s || s.v !== 1 || !s.entries || typeof s.entries !== 'object') return null;
      const out = new Map<string, { etag: string; value: T }>();
      for (const [k, e] of Object.entries(s.entries)) if (e && typeof e.etag === 'string' && e.etag && e.value != null) out.set(k, { etag: e.etag, value: e.value });
      return out;
    })
    .catch(() => null);
}

async function poolOf<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * Bring `cache.memory` in line with `wanted` (the objects the listing shows): keep what matches by ETag
 * (from memory, else from `index`), read the rest (`read`; a failed read is left out and tried again
 * next time), drop what is gone, and write the index back when it changed. Returns the values by key.
 */
async function syncIndexWith<T>(
  r2: JsonStore,
  cache: IndexCache<T>,
  wanted: R2Object[],
  {
    index,
    read = (key) => r2.getJson<T>(key),
    concurrency = 16,
  }: { index?: Map<string, { etag: string; value: T }> | null; read?: (key: string) => Promise<T | null>; concurrency?: number } = {},
): Promise<Map<string, T>> {
  if (index && cache.sig === null) cache.sig = fingerprint(index);
  const listed = new Set(wanted.map((o) => o.key));
  for (const key of [...cache.memory.keys()]) if (!listed.has(key)) cache.memory.delete(key);
  const todo: R2Object[] = [];
  for (const o of wanted) {
    const had = cache.memory.get(o.key);
    if (o.etag && had?.etag === o.etag) continue;
    const fromIndex = index?.get(o.key);
    if (o.etag && fromIndex?.etag === o.etag) {
      cache.memory.set(o.key, fromIndex);
      continue;
    }
    cache.memory.delete(o.key);
    todo.push(o);
  }
  await poolOf(todo, concurrency, async (o) => {
    const value = await read(o.key).catch(() => null);
    // Only kept when the listing gave an ETag to check it by next time.
    if (value != null && o.etag) cache.memory.set(o.key, { etag: o.etag, value });
  });
  const sig = fingerprint(cache.memory);
  if (sig !== cache.sig) {
    const stored: Stored<T> = { v: 1, entries: Object.fromEntries(cache.memory) };
    await r2.putJson(cache.key, stored).then(
      () => void (cache.sig = sig),
      () => {
        /* best effort: the next listing tries again */
      },
    );
  }
  const out = new Map<string, T>();
  for (const [k, v] of cache.memory) out.set(k, v.value);
  return out;
}

export type R2 = ReturnType<typeof createR2>;
