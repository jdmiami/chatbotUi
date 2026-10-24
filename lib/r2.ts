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
    async put(key: string, body: Buffer | string, contentType = 'application/octet-stream') {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const res = await call('PUT', keyPath(key), { headers: { 'content-type': contentType, 'content-length': String(buf.length) }, body: buf });
      if (!res.ok) await failed(res, 'save');
    },
    putJson(key: string, value: unknown) {
      return this.put(key, JSON.stringify(value), 'application/json');
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

export type R2 = ReturnType<typeof createR2>;
