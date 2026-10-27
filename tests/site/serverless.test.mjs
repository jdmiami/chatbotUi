// The serverless AI machine's plain parts (lib/serverlessShared.ts): Runpod's job answers as Make sees
// them, which image the endpoint runs, and what may not go there. Run with: npm run test:site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageFor, mapStatus, serverlessRefusal, WORKER_IMAGE } from '../../lib/serverlessShared.ts';

test('a job in the queue, running (with the worker’s own progress), done, failed, stopped', () => {
  assert.deepEqual(mapStatus('j1', { status: 'IN_QUEUE' }), { id: 'j1', status: 'queued', progress: 0, detail: 'Waiting for a GPU', waitedSeconds: undefined, ranSeconds: undefined });
  const starting = mapStatus('j1', { status: 'IN_PROGRESS', output: { status: 'downloading', percent: 40, detail: 'Getting Krea Real’s files onto the drive: 40%' }, delayTime: 12000 });
  assert.equal(starting.status, 'running');
  assert.equal(starting.detail, 'Getting Krea Real’s files onto the drive: 40%');
  assert.equal(starting.waitedSeconds, 12);
  const making = mapStatus('j1', { status: 'IN_PROGRESS', output: { status: 'running', progress: 55.4, etaSeconds: 20, slow: false, notes: ['The maker was frozen, so it was restarted.'] } });
  assert.deepEqual([making.progress, making.etaSeconds, making.notes], [55, 20, ['The maker was frozen, so it was restarted.']]);
  const done = mapStatus('j1', { status: 'COMPLETED', output: { job: { id: 'g1', status: 'done', notes: [], item: { id: 'it1', kind: 'image' } } }, executionTime: 61000 });
  assert.equal(done.status, 'done');
  assert.equal(done.progress, 100);
  assert.equal(done.ranSeconds, 61);
  assert.equal(done.job.item.id, 'it1');
  // The gate said no (a held result, a rule): its words, not Runpod's.
  const no = mapStatus('j1', { status: 'COMPLETED', output: { error: 'Swap a person only works with adults.', job: { id: 'g2', status: 'error' } } });
  assert.equal(no.status, 'error');
  assert.equal(no.error, 'Swap a person only works with adults.');
  assert.equal(mapStatus('j1', { status: 'FAILED', error: 'CUDA out of memory' }).error, 'The GPU ran out of memory on that one. Try a smaller size or fewer seconds.');
  assert.match(mapStatus('j1', { status: 'FAILED', error: 'worker exited' }).error, /did not finish on the serverless machine: worker exited/);
  assert.equal(mapStatus('j1', { status: 'TIMED_OUT' }).error, 'That took too long and was stopped.');
  assert.equal(mapStatus('j1', { status: 'CANCELLED' }).status, 'stopped');
});

test('the endpoint runs this deployment’s image when it is built, else the newest', () => {
  assert.equal(imageFor('abc123', true), `${WORKER_IMAGE}:abc123`);
  assert.equal(imageFor('abc123', false), `${WORKER_IMAGE}:main`);
  assert.equal(imageFor(undefined, false), `${WORKER_IMAGE}:main`);
});

test('uploads stay on the AI machine; gallery videos and pictures may go', () => {
  assert.match(serverlessRefusal({ kind: 'video', videoUpload: 'u1' }), /needs your AI machine on/);
  assert.match(serverlessRefusal({ kind: 'video', audioUpload: 'u2' }), /needs your AI machine on/);
  assert.equal(serverlessRefusal({ kind: 'video', videoItem: 'g1', image: 'data:image/png;base64,AA==' }), null);
});
