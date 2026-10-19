import { createR2 } from '../../src/r2.js';

/** An in-memory bucket speaking enough S3 for everything the machine does. */
export function memoryR2() {
  const objects = new Map();
  const uploads = new Map();
  const log = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = new URL(url);
    const parts = u.pathname.split('/').slice(2);
    const key = parts.map(decodeURIComponent).join('/');
    log.push(`${method} ${key}`);
    if (method === 'GET' && u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') || '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      // Two per page, to exercise continuation.
      const start = Number(u.searchParams.get('continuation-token') || 0);
      const page = keys.slice(start, start + 2);
      const more = start + 2 < keys.length;
      const xml = `<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ''}</ListBucketResult>`;
      return new Response(xml);
    }
    if (method === 'POST' && u.searchParams.has('uploads')) {
      const id = `up${uploads.size + 1}`;
      uploads.set(id, []);
      return new Response(`<UploadId>${id}</UploadId>`);
    }
    if (method === 'PUT' && u.searchParams.has('partNumber')) {
      uploads.get(u.searchParams.get('uploadId'))[Number(u.searchParams.get('partNumber')) - 1] = Buffer.from(init.body);
      return new Response('', { headers: { etag: `"e${u.searchParams.get('partNumber')}"` } });
    }
    if (method === 'POST' && u.searchParams.has('uploadId')) {
      objects.set(key, Buffer.concat(uploads.get(u.searchParams.get('uploadId'))));
      return new Response('<ok/>');
    }
    if (method === 'DELETE' && u.searchParams.has('uploadId')) return new Response(null, { status: 204 });
    if (method === 'PUT') {
      objects.set(key, Buffer.from(init.body));
      return new Response('');
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    const obj = objects.get(key);
    if (!obj) return new Response(method === 'HEAD' ? null : '<Error><Message>NoSuchKey</Message></Error>', { status: 404 });
    if (method === 'HEAD') return new Response(null, { headers: { 'content-length': String(obj.length) } });
    const range = /bytes=(\d+)-(\d+)/.exec(init.headers?.range || '');
    return range ? new Response(obj.subarray(Number(range[1]), Number(range[2]) + 1), { status: 206 }) : new Response(obj);
  };
  return { objects, log, r2: createR2({ accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'orbit-models', fetchImpl }) };
}
