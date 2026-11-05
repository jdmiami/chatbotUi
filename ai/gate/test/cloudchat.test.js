import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudChat } from '../src/cloudchat.js';
import { verifyJwt } from '../src/jwt.js';

const SECRET = 'x'.repeat(40);

test('the Lab on a machine with no chat model writes with the site’s cloud AI, signed as the AI machine, words only', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"Neon rain"}' } }] }), { status: 200 });
  };
  const chat = createCloudChat({ siteUrl: 'https://site.example/', secret: SECRET, fetchImpl });
  const text = await chat({ system: 'Write one idea.', user: 'Rainy city', temperature: 0.4, images: ['AAAA'] });
  assert.equal(text, '{"title":"Neon rain"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://site.example/api/orb/ai');
  // The unfiltered writer, whose one rule keeps everyone in it an adult.
  assert.equal(calls[0].body.task, 'free');
  assert.equal(calls[0].body.temperature, 0.4);
  assert.deepEqual(calls[0].body.messages, [
    { role: 'system', content: 'Write one idea.' },
    { role: 'user', content: 'Rainy city' },
  ]);
  assert.equal(JSON.stringify(calls[0].body).includes('AAAA'), false, 'pictures never leave the machine');
  const token = calls[0].init.headers.authorization.replace(/^Bearer /, '');
  const p = verifyJwt(token, SECRET, { audience: 'site-island' });
  assert.equal(p.sub, 'ai-machine');
});

test('the cloud AI saying no is an error with its reason; no site address is an error at once', async () => {
  const chat = createCloudChat({
    siteUrl: 'https://site.example',
    secret: SECRET,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Cloud AI is not set up yet' }), { status: 501 }),
  });
  await assert.rejects(chat({ system: 's', user: 'u' }), /cloud AI: Cloud AI is not set up yet/);
  const empty = createCloudChat({ siteUrl: 'https://site.example', secret: SECRET, fetchImpl: async () => new Response('{}', { status: 200 }) });
  await assert.rejects(empty({ system: 's', user: 'u' }), /no answer/);
  assert.throws(() => createCloudChat({ siteUrl: '', secret: SECRET }), /SITE_URL/);
});
