// GPU.ai's hosted MiniMax H3 (lib/gpuai.ts): what a job's answer means to Make, the clip lengths it
// takes, its price in words, and which of its links the gallery will fetch. Run with: npm run test:site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GPUAI_VIDEO_MODEL, gpuaiContentUrl, gpuaiJobId, h3Price, h3Seconds, isGpuaiContent, mapVideoJob } from '../../lib/gpuai.ts';

test('a job in the queue, being made (with progress), done, failed, stopped, expired', () => {
  assert.deepEqual(mapVideoJob({ status: 'queued', progress: 0 }), { status: 'queued', progress: 0, costCents: undefined });
  assert.deepEqual(mapVideoJob({ status: 'in_progress', progress: 42.6 }), { status: 'running', progress: 43, costCents: undefined });
  assert.deepEqual(mapVideoJob({ status: 'completed', progress: 100, cost_cents: 70 }), { status: 'done', progress: 100, costCents: 70 });
  // GPU.ai's own words for a failure are kept short and plain.
  assert.equal(mapVideoJob({ status: 'failed', error: 'upstream_error' }).error, 'The video maker stopped: upstream_error');
  assert.equal(mapVideoJob({ status: 'failed', error: { message: 'content policy' } }).error, 'The video maker stopped: content policy');
  assert.equal(mapVideoJob({ status: 'failed' }).error, 'The video maker stopped (failed).');
  assert.equal(mapVideoJob({ status: 'cancelled' }).status, 'error');
  assert.match(mapVideoJob({ status: 'expired' }).error, /not fetched in time/);
  assert.equal(mapVideoJob({}).status, 'error');
});

test('clip lengths: whole seconds within what H3 takes, else its default; the price says what a clip costs', () => {
  assert.equal(h3Seconds(5), 5);
  assert.equal(h3Seconds('8'), 8);
  assert.equal(h3Seconds(7.6), 8);
  assert.equal(h3Seconds(0), 5);
  assert.equal(h3Seconds(11), 5);
  assert.equal(h3Seconds(undefined), 5);
  assert.equal(h3Price(), 'about $0.70 for 5 seconds (14¢ a second)');
  assert.equal(h3Price(10), 'about $1.40 for 10 seconds (14¢ a second)');
  assert.equal(h3Price(1), 'about $0.14 for 1 second (14¢ a second)');
  assert.equal(GPUAI_VIDEO_MODEL, 'gpuai/minimax-h3');
});

test('only a finished clip on GPU.ai itself is a link the gallery fetches; job ids are checked', () => {
  assert.ok(gpuaiJobId('b163380b-15be-43e3-b24b-ef4bfc0ad1cd'));
  assert.ok(!gpuaiJobId('../x'));
  assert.ok(!gpuaiJobId('a/b'));
  assert.ok(!gpuaiJobId(5));
  const u = gpuaiContentUrl('b163380b-15be-43e3-b24b-ef4bfc0ad1cd');
  assert.equal(u, 'https://api.gpu.ai/v1/videos/b163380b-15be-43e3-b24b-ef4bfc0ad1cd/content');
  assert.ok(isGpuaiContent(new URL(u)));
  assert.ok(!isGpuaiContent(new URL('https://api.gpu.ai/v1/videos')));
  assert.ok(!isGpuaiContent(new URL('https://api.gpu.ai/v1/videos/x/content')));
  assert.ok(!isGpuaiContent(new URL('https://api.gpu.ai/v1/models/gpuai/minimax-h3')));
  assert.ok(!isGpuaiContent(new URL('http://api.gpu.ai/v1/videos/b163380b-15be-43e3-b24b-ef4bfc0ad1cd/content')));
  assert.ok(!isGpuaiContent(new URL('https://evil.example/v1/videos/b163380b-15be-43e3-b24b-ef4bfc0ad1cd/content')));
});
