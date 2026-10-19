// Cloudflare R2 (S3-compatible) for the AI machine: a small signed client with no dependencies, and a
// speed test that shows whether model files could live in R2 instead of on the network volume.
// The keys come from Runpod secrets (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) and are
// never logged or returned.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// RFC 3986 encoding, as AWS Signature Version 4 wants it.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const UNSIGNED = 'UNSIGNED-PAYLOAD';

/**
 * AWS Signature Version 4 for S3. Returns the headers to send (the given ones plus x-amz-date,
 * x-amz-content-sha256 and authorization). `path` is already encoded; `query` is an object.
 */
export function signS3({ method, host, path: p, query = {}, headers = {}, payloadHash = UNSIGNED, accessKeyId, secretAccessKey, region = 'auto', date = new Date() }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).sort();
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(String(query[k] ?? ''))}`)
    .join('&');
  const canonical = [method, p, canonicalQuery, names.map((n) => `${n}:${all[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  delete all.host;
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

/** A minimal R2 client: head, ranged get, multipart upload, delete. */
export function createR2({ accountId, accessKeyId, secretAccessKey, bucket, fetchImpl = fetch }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const keyPath = (key) => `/${enc(bucket)}/${key.split('/').map(enc).join('/')}`;
  async function call(method, key, { query = {}, headers = {}, body } = {}) {
    const p = keyPath(key);
    const qs = Object.keys(query).length ? `?${Object.entries(query).map(([k, v]) => (v === '' ? enc(k) : `${enc(k)}=${enc(String(v))}`)).join('&')}` : '';
    const signed = signS3({ method, host, path: p, query, headers, accessKeyId, secretAccessKey });
    const res = await fetchImpl(`https://${host}${p}${qs}`, { method, headers: signed, body });
    if (!res.ok && !(method === 'HEAD' && res.status === 404)) {
      const text = await res.text().catch(() => '');
      throw new Error(`R2 ${method} ${res.status}: ${(/<Message>([^<]*)/.exec(text)?.[1] || text).slice(0, 200)}`);
    }
    return res;
  }
  return {
    async head(key) {
      const res = await call('HEAD', key);
      return res.status === 404 ? null : { size: Number(res.headers.get('content-length')) };
    },
    async getRange(key, start, end) {
      const res = await call('GET', key, { headers: { range: `bytes=${start}-${end}` } });
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(key) {
      await call('DELETE', key);
    },
    async createUpload(key) {
      const text = await (await call('POST', key, { query: { uploads: '' } })).text();
      const id = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1];
      if (!id) throw new Error('R2 did not start the upload.');
      return id;
    },
    async uploadPart(key, uploadId, partNumber, buf) {
      const res = await call('PUT', key, { query: { partNumber, uploadId }, headers: { 'content-length': buf.length }, body: buf });
      return res.headers.get('etag');
    },
    async completeUpload(key, uploadId, parts) {
      const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      await call('POST', key, { query: { uploadId }, headers: { 'content-type': 'application/xml' }, body: xml });
    },
    async abortUpload(key, uploadId) {
      await call('DELETE', key, { query: { uploadId } }).catch(() => {});
    },
  };
}

/** Run `fn` over 0..count-1 with at most `limit` at a time. */
async function pool(count, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < count) await fn(next++);
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
}

/** Upload a file in parallel parts. onBytes(n) reports progress. */
export async function uploadFile(r2, file, key, { partMiB = 64, concurrency = 6, onBytes = () => {} } = {}) {
  const size = (await fsp.stat(file)).size;
  const partSize = partMiB * 1024 * 1024;
  const count = Math.max(1, Math.ceil(size / partSize));
  const uploadId = await r2.createUpload(key);
  const h = await fsp.open(file, 'r');
  const parts = new Array(count);
  try {
    await pool(count, concurrency, async (i) => {
      const len = Math.min(partSize, size - i * partSize);
      const buf = Buffer.allocUnsafe(len);
      await h.read(buf, 0, len, i * partSize);
      let etag;
      for (let attempt = 1; ; attempt++) {
        try {
          etag = await r2.uploadPart(key, uploadId, i + 1, buf);
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
      parts[i] = { n: i + 1, etag };
      onBytes(len);
    });
    await r2.completeUpload(key, uploadId, parts);
  } catch (err) {
    await r2.abortUpload(key, uploadId);
    throw err;
  } finally {
    await h.close();
  }
  return size;
}

/** Download an object with parallel ranged requests straight into a file. */
export async function downloadFile(r2, key, file, { chunkMiB = 64, concurrency = 8, onBytes = () => {} } = {}) {
  const head = await r2.head(key);
  if (!head) throw new Error(`${key} is not in the bucket.`);
  const chunk = chunkMiB * 1024 * 1024;
  const count = Math.max(1, Math.ceil(head.size / chunk));
  const h = await fsp.open(file, 'w');
  try {
    await h.truncate(head.size);
    await pool(count, concurrency, async (i) => {
      const start = i * chunk;
      const end = Math.min(head.size, start + chunk) - 1;
      let buf;
      for (let attempt = 1; ; attempt++) {
        try {
          buf = await r2.getRange(key, start, end);
          if (buf.length !== end - start + 1) throw new Error(`short read: ${buf.length} of ${end - start + 1} bytes`);
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
        }
      }
      await h.write(buf, 0, buf.length, start);
      onBytes(buf.length);
    });
  } finally {
    await h.close();
  }
  return head.size;
}

/** SHA-256 of a file, read as fast as the disk allows. */
async function hashFile(file, onBytes = () => {}) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 16 * 1024 * 1024 })) {
    h.update(chunk);
    onBytes(chunk.length);
  }
  return h.digest('hex');
}

/**
 * The speed test: read a model from the network volume (today's way), upload it to R2 once, then
 * download it to this machine's own disk and check it is identical. Speeds in MB/s (1 MB = 1e6 bytes).
 */
export function createR2Test({ r2, file, key, tmpDir = os.tmpdir(), now = Date.now, log = console }) {
  let state = { running: false, steps: [], error: null, startedAt: null, finishedAt: null };
  const step = (name) => {
    const s = { name, bytes: 0, seconds: null, mbps: null, startedAt: now() };
    state.steps.push(s);
    return {
      add: (n) => {
        s.bytes += n;
      },
      done(extra = {}) {
        s.seconds = Math.round((now() - s.startedAt) / 100) / 10;
        s.mbps = s.seconds ? Math.round(s.bytes / 1e6 / s.seconds) : null;
        Object.assign(s, extra);
        log.info?.(`[r2] ${name}: ${s.bytes} bytes in ${s.seconds}s (${s.mbps} MB/s)`);
      },
    };
  };
  async function run({ chunkMiB = 64, concurrency = 8, reupload = false } = {}) {
    const local = path.join(tmpDir, `r2-test-${path.basename(key)}`);
    try {
      const vol = step('read from the network volume');
      const volHash = await hashFile(file, vol.add);
      vol.done();
      if (reupload || !(await r2.head(key))) {
        const up = step('upload to R2');
        await uploadFile(r2, file, key, { onBytes: up.add });
        up.done();
      }
      const down = step(`download from R2 (${concurrency} at a time, ${chunkMiB} MiB pieces)`);
      await downloadFile(r2, key, local, { chunkMiB, concurrency, onBytes: down.add });
      down.done();
      const check = step('check the copy (read from local disk)');
      const localHash = await hashFile(local, check.add);
      check.done({ identical: localHash === volHash });
      if (localHash !== volHash) throw new Error('The downloaded copy is not identical to the original.');
    } catch (err) {
      state.error = err.message;
      log.warn?.(`[r2] test failed: ${err.message}`);
    } finally {
      await fsp.rm(local, { force: true });
      state.running = false;
      state.finishedAt = now();
    }
  }
  return {
    running: () => state.running,
    state: () => state,
    start(opts = {}) {
      if (state.running) return false;
      state = { running: true, steps: [], error: null, startedAt: now(), finishedAt: null, options: opts };
      void run(opts);
      return true;
    },
  };
}

/** The R2 settings from the environment, or null when they are not all set. */
export function r2FromEnv(env) {
  const { R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!accountId || !accessKeyId || !secretAccessKey || /RUNPOD_SECRET/.test(accountId + accessKeyId + secretAccessKey)) return null;
  return { accountId: accountId.trim(), accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), bucket: env.R2_BUCKET || 'orbit-models' };
}
