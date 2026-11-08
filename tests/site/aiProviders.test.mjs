// Where the AI machine can run (Runpod or GPU.ai) and which one it is on: lib/aiProviders.ts. Run with: npm run test:site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeOf, alreadyOnMessage, cleanProvider, defaultProviderOf, otherOn, providerLabel, providersOf, startableOf } from '../../lib/aiProviders.ts';

const R2 = { r2: true, storage: 'r2', volumeId: '' };
const BOTH = { RUNPOD_API_KEY: 'r', GPUAI_API_KEY: 'g' };

test('the default provider: AI_PROVIDER, else GPU.ai when it is the only key, else Runpod', () => {
  assert.equal(defaultProviderOf({ ...BOTH, AI_PROVIDER: 'gpuai' }), 'gpuai');
  assert.equal(defaultProviderOf(BOTH), 'runpod');
  assert.equal(defaultProviderOf({ GPUAI_API_KEY: 'g' }), 'gpuai');
  assert.equal(defaultProviderOf({ RUNPOD_API_KEY: 'r' }), 'runpod');
  assert.equal(defaultProviderOf({}), 'runpod');
});

test('a provider can be turned on only with what it needs: GPU.ai its key and R2, Runpod its key and R2 (or a volume)', () => {
  assert.deepEqual(startableOf(BOTH, R2), { gpuai: true, runpod: true });
  assert.deepEqual(startableOf(BOTH, { ...R2, r2: false }), { gpuai: false, runpod: true });
  assert.deepEqual(startableOf({ RUNPOD_API_KEY: 'r' }, { r2: true, storage: 'volume', volumeId: '' }), { gpuai: false, runpod: false });
  assert.deepEqual(startableOf({ RUNPOD_API_KEY: 'r' }, { r2: false, storage: 'volume', volumeId: 'vol1' }), { gpuai: false, runpod: true });
  assert.deepEqual(startableOf({}, R2), { gpuai: false, runpod: false });
});

test('both set up: both are offered, the default first; one set up: just that one', () => {
  assert.deepEqual(providersOf({ ...BOTH, AI_PROVIDER: 'gpuai' }, R2), ['gpuai', 'runpod']);
  assert.deepEqual(providersOf(BOTH, R2), ['runpod', 'gpuai']);
  assert.deepEqual(providersOf({ GPUAI_API_KEY: 'g' }, R2), ['gpuai']);
  assert.deepEqual(providersOf({ RUNPOD_API_KEY: 'r' }, R2), ['runpod']);
  // The default names a provider that is not set up: the other one is offered alone.
  assert.deepEqual(providersOf({ RUNPOD_API_KEY: 'r', AI_PROVIDER: 'gpuai' }, R2), ['runpod']);
  assert.deepEqual(providersOf({}, R2), []);
});

test('the active provider is where a machine is on; with none on, the first one', () => {
  const both = ['gpuai', 'runpod'];
  assert.equal(activeOf({ gpuai: false, runpod: true }, both, 'gpuai'), 'runpod');
  assert.equal(activeOf({ gpuai: true, runpod: false }, both, 'gpuai'), 'gpuai');
  assert.equal(activeOf({ gpuai: false, runpod: false }, both, 'gpuai'), 'gpuai');
  assert.equal(activeOf({ gpuai: false, runpod: false }, ['runpod', 'gpuai'], 'gpuai'), 'runpod');
  // On at both (it should not happen): the default one counts.
  assert.equal(activeOf({ gpuai: true, runpod: true }, both, 'gpuai'), 'gpuai');
  assert.equal(activeOf({ gpuai: true, runpod: true }, ['runpod', 'gpuai'], 'gpuai'), 'runpod');
  // One provider, or none: no looking needed.
  assert.equal(activeOf({ gpuai: false, runpod: true }, ['gpuai'], 'runpod'), 'gpuai');
  assert.equal(activeOf({ gpuai: false, runpod: false }, [], 'runpod'), 'runpod');
});

test('turning one on at one provider while the other has one on is refused, in plain words', () => {
  assert.equal(otherOn('gpuai', { gpuai: false, runpod: true }), 'runpod');
  assert.equal(otherOn('runpod', { gpuai: true, runpod: false }), 'gpuai');
  assert.equal(otherOn('gpuai', { gpuai: true, runpod: false }), null, 'its own machine being on is not the other one');
  assert.equal(otherOn('gpuai', { gpuai: false, runpod: false }), null);
  assert.equal(alreadyOnMessage('runpod', 'gpuai'), 'Your AI machine is on at Runpod right now. Turn it off first, then turn it on at GPU.ai.');
});

test('names and request values', () => {
  assert.equal(providerLabel('gpuai'), 'GPU.ai');
  assert.equal(providerLabel('runpod'), 'Runpod');
  assert.equal(cleanProvider('gpuai'), 'gpuai');
  assert.equal(cleanProvider('runpod'), 'runpod');
  for (const bad of ['', 'GPUAI', 'aws', null, undefined, 3, {}]) assert.equal(cleanProvider(bad), null);
});
