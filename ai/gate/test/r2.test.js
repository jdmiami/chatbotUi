import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createR2, createR2Test, downloadFile, r2FromEnv, signS3, uploadFile } from '../src/r2.js';

test('signing matches AWS Signature Version 4 (the S3 docs example: GET with a range)', () => {
  const h = signS3({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(h['x-amz-date'], '20130524T000000Z');
  assert.match(h.authorization, /Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, /);
  assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

/** An in-memory R2 that speaks enough S3: multipart upload, HEAD, ranged GET. */
function fakeR2({ failOnce = new Set() } = {}) {
  const objects = new Map();
  const uploads = new Map();
  const seen = { requests: 0, authorized: 0, failures: 0 };
  const fetchImpl = async (url, init) => {
    seen.requests++;
    if (/^AWS4-HMAC-SHA256 Credential=key\//.test(init.headers.authorization)) seen.authorized++;
    const u = new URL(url);
    assert.equal(u.hostname, 'acct.r2.cloudflarestorage.com');
    const key = decodeURIComponent(u.pathname.split('/').slice(2).join('/'));
    const tag = `${init.method} ${u.search}`;
    if (failOnce.has(tag)) {
      failOnce.delete(tag);
      seen.failures++;
      return new Response('<Error><Message>slow down</Message></Error>', { status: 503 });
    }
    if (init.method === 'POST' && u.searchParams.has('uploads')) {
      const id = `up${uploads.size + 1}`;
      uploads.set(id, []);
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (init.method === 'PUT') {
      const n = Number(u.searchParams.get('partNumber'));
      uploads.get(u.searchParams.get('uploadId'))[n - 1] = Buffer.from(init.body);
      return new Response('', { headers: { etag: `"e${n}"` } });
    }
    if (init.method === 'POST' && u.searchParams.has('uploadId')) {
      const parts = [...String(init.body).matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>"e(\d+)"<\/ETag>/g)];
      assert.ok(parts.every(([, a, b]) => a === b), 'every part completed with its own ETag');
      objects.set(key, Buffer.concat(uploads.get(u.searchParams.get('uploadId'))));
      return new Response('<CompleteMultipartUploadResult/>');
    }
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const obj = objects.get(key);
    if (init.method === 'HEAD') return obj ? new Response(null, { headers: { 'content-length': String(obj.length) } }) : new Response(null, { status: 404 });
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.range);
    return new Response(obj.subarray(Number(a), Number(b) + 1), { status: 206 });
  };
  return { objects, seen, r2: createR2({ accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'orbit-models', fetchImpl }) };
}

async function tempFile(size) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r2-'));
  const file = path.join(dir, 'model.safetensors');
  await fs.writeFile(file, crypto.randomBytes(size));
  return { dir, file };
}

test('a file goes up in parallel parts and comes back identical in parallel pieces, retrying a failed piece', async () => {
  const MiB = 1024 * 1024;
  const { dir, file } = await tempFile(5 * MiB + 123); // parts of 1 MiB: the last one is short
  const { r2, objects, seen } = fakeR2({ failOnce: new Set(['PUT ?partNumber=3&uploadId=up1']) });
  let up = 0;
  await uploadFile(r2, file, 'models/x/model.safetensors', { partMiB: 1, concurrency: 3, onBytes: (n) => (up += n) });
  assert.equal(up, 5 * MiB + 123);
  assert.deepEqual(objects.get('models/x/model.safetensors'), await fs.readFile(file));
  assert.equal(seen.failures, 1, 'one part failed and was sent again');

  const out = path.join(dir, 'copy');
  let down = 0;
  await downloadFile(r2, 'models/x/model.safetensors', out, { chunkMiB: 2, concurrency: 4, onBytes: (n) => (down += n) });
  assert.equal(down, 5 * MiB + 123);
  assert.deepEqual(await fs.readFile(out), await fs.readFile(file));
  assert.equal(seen.authorized, seen.requests, 'every request was signed');
  await assert.rejects(downloadFile(r2, 'missing', out), /not in the bucket/);
});

test('the speed test times volume, upload and download, checks the copy, and skips the upload next time', async () => {
  const { dir, file } = await tempFile(3 * 1024 * 1024);
  const { r2, seen } = fakeR2();
  const t = createR2Test({ r2, file, key: 'models/x/model.safetensors', tmpDir: dir, log: { info() {}, warn() {} } });
  assert.equal(t.start({ chunkMiB: 1, concurrency: 2 }), true);
  assert.equal(t.start(), false, 'one at a time');
  while (t.running()) await new Promise((r) => setTimeout(r, 5));
  let s = t.state();
  assert.equal(s.error, null);
  assert.deepEqual(
    s.steps.map((x) => x.name),
    ['read from the network volume', 'upload to R2', 'download from R2 (2 at a time, 1 MiB pieces)', 'check the copy (read from local disk)'],
  );
  assert.equal(s.steps[3].identical, true);
  assert.ok(s.steps.every((x) => x.bytes === 3 * 1024 * 1024));
  assert.deepEqual((await fs.readdir(dir)).sort(), ['model.safetensors'], 'the local copy is removed afterwards');

  const before = seen.requests;
  t.start({ chunkMiB: 1, concurrency: 2 });
  while (t.running()) await new Promise((r) => setTimeout(r, 5));
  s = t.state();
  assert.ok(!s.steps.some((x) => x.name === 'upload to R2'), 'already in R2: not uploaded again');
  assert.ok(seen.requests > before);
});

test('R2 settings come only from fully resolved secrets', () => {
  assert.equal(r2FromEnv({}), null);
  assert.equal(r2FromEnv({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: '{{ RUNPOD_SECRET_r2_access_key_id }}', R2_SECRET_ACCESS_KEY: 's' }), null);
  assert.deepEqual(r2FromEnv({ R2_ACCOUNT_ID: ' a ', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }), { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'orbit-models' });
});
