import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAiProxy } from '../src/ai-local.js';

const secret = new TextEncoder().encode('test-secret-test-secret-test-secret!!');

async function withServer(fetchImpl, fn) {
  const server = createLocalAiProxy({ secret, siteUrl: 'https://site.example', log: { warn() {} }, fetchImpl });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('cloud: an OpenAI chat request becomes one signed /api/orb/ai call for the right job', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }] }), { headers: { 'content-type': 'application/json' } });
  };
  await withServer(fetchImpl, async (base) => {
    const res = await fetch(`${base}/cloud/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
      body: JSON.stringify({ model: 'orbit/orbit-fast', messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'function', function: { name: 'x' } }], max_tokens: 50 }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).choices[0].message.content, 'hi');
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://site.example/api/orb/ai');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.task, 'fast');
  assert.equal(sent.max_tokens, 50);
  assert.equal(sent.tools.length, 1);
  // Signed for this machine, never the caller's own key.
  assert.match(calls[0].init.headers.authorization, /^Bearer ey/);
  assert.doesNotMatch(calls[0].init.headers.authorization, /anything/);
});

test('cloud: lists its models and explains site errors', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: 'Cloud AI is busy' }), { status: 503 });
  await withServer(fetchImpl, async (base) => {
    const models = await (await fetch(`${base}/cloud/v1/models`)).json();
    assert.deepEqual(models.data.map((m) => m.id), ['orbit-agent', 'orbit-fast', 'orbit-write', 'orbit-vision']);
    const res = await fetch(`${base}/cloud/v1/chat/completions`, { method: 'POST', body: '{"model":"orbit-agent","messages":[]}' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error.message, /busy/);
  });
});
