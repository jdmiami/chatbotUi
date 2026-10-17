import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelStore, FEATURED } from '../src/store.js';

function fakeOllama(state) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ host: u.host, path: u.pathname, body, method: init.method || 'GET' });
    if (u.host === 'huggingface.co') {
      if (u.pathname === '/api/models') return Response.json([{ id: 'org/Cool-Model-GGUF', downloads: 1200, likes: 30, lastModified: '2026-10-01' }]);
      if (u.pathname === '/api/models/org/Cool-Model-GGUF/tree/main') {
        return Response.json([
          { type: 'file', path: 'Cool-Model-Q4_K_M.gguf', size: 100, lfs: { size: 9e9 } },
          { type: 'file', path: 'Cool-Model-Q8_0.gguf', size: 100, lfs: { size: 16e9 } },
          { type: 'file', path: 'Cool-Model-plus-Q8_0.gguf', size: 100, lfs: { size: 17e9 } },
          { type: 'file', path: 'Cool-Model-UD-IQ3_XXS.gguf', size: 100, lfs: { size: 6e9 } },
          { type: 'file', path: 'mmproj-Cool-Model-F16.gguf', size: 100, lfs: { size: 1e9 } },
          { type: 'file', path: 'README.md', size: 10 },
        ]);
      }
      return new Response('nope', { status: 404 });
    }
    if (u.pathname === '/api/tags') return Response.json({ models: state.models.map((name) => ({ name, size: 5e9, digest: `d-${name}` })) });
    if (u.pathname === '/api/ps') return Response.json({ models: state.loaded.map((name) => ({ name })) });
    if (u.pathname === '/api/show') return Response.json({ capabilities: ['completion', 'vision', 'tools'], details: { family: 'qwen35', parameter_size: '27B', quantization_level: 'Q4_K_M' } });
    if (u.pathname === '/api/pull') {
      state.models.push(body.model);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"status":"pulling","completed":5,"total":10}\n{"status":"success"}\n')); c.close(); } }));
    }
    if (u.pathname === '/api/create') {
      state.models.push(body.model);
      return Response.json({ status: 'success' });
    }
    if (u.pathname === '/api/delete') {
      state.models = state.models.filter((m) => m !== body.model);
      return new Response('');
    }
    if (u.pathname === '/api/generate') {
      state.loaded = [body.model];
      return Response.json({ done: true });
    }
    return new Response('nope', { status: 404 });
  };
}

const newStore = (models = ['qwen3.8:27b']) => {
  const state = { calls: [], models: [...models], loaded: [] };
  const store = createModelStore({ ollama: 'http://o', fetchImpl: fakeOllama(state), statfs: async () => ({ blocks: 1000, bavail: 250, bsize: 1e8 }) });
  return { state, store };
};

test('store: lists installed models with abilities and free space', async () => {
  const { store } = newStore();
  const r = await store.list();
  assert.equal(r.installed.length, 1);
  assert.deepEqual(
    { name: r.installed[0].name, vision: r.installed[0].vision, tools: r.installed[0].tools, params: r.installed[0].params },
    { name: 'qwen3.8:27b', vision: true, tools: true, params: '27B' },
  );
  assert.deepEqual(r.disk, { total: 1e11, free: 2.5e10 });
});

test('store: featured shelf marks what is installed', async () => {
  const { store } = newStore();
  const list = await store.featured();
  assert.equal(list.length, FEATURED.length);
  assert.equal(list.find((m) => m.name === 'qwen3.8:27b').installed, true);
  assert.equal(list.find((m) => m.name === 'qwen3.6:35b').installed, false);
});

test('store: Hugging Face search and the sizes a model comes in', async () => {
  const { store } = newStore();
  const results = await store.search('cool');
  assert.equal(results[0].repo, 'org/Cool-Model-GGUF');
  const files = await store.files('org/Cool-Model-GGUF');
  assert.deepEqual(
    files.map((x) => x.quant),
    ['UD-IQ3_XXS', 'Q4_K_M', 'Q8_0'],
    'smallest first, one per size, no vision projector or readme',
  );
  await assert.rejects(store.files('../etc'), (err) => err.status === 400);
});

test('store: install from search gets a friendly name; delete and load', async () => {
  const { state, store } = newStore();
  const name = store.install({ repo: 'org/Cool-Model-GGUF', quant: 'Q4_K_M' });
  assert.equal(name, 'cool-model:q4_k_m');
  for (let i = 0; i < 50 && !state.models.includes(name); i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(state.models.includes(name));
  assert.ok(!state.models.includes('hf.co/org/Cool-Model-GGUF:Q4_K_M'), 'the long source name is removed');
  assert.deepEqual((await store.list()).pulls, []);
  await store.load(name);
  assert.deepEqual(state.loaded, [name]);
  await store.remove(name);
  assert.ok(!state.models.includes(name));
});
