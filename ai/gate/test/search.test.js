import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createGate } from '../src/gate.js';
import { signJwt } from '../src/jwt.js';
import { createSearch, decodeEntities, isPrivateAddress, pageText, parseResults } from '../src/search.js';
import { createVoice } from '../src/voice.js';

const SECRET = 'x'.repeat(40);
const apiToken = () => signJwt({ sub: 'jd', aud: 'orbit-ai', iss: 'rdp-web' }, SECRET, { expiresIn: 3600 });
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

const DDG = `
<div class="result results_links results_links_deep result--ad"><a class="result__a" href="https://ads.example/x">Ad</a></div>
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsea&amp;rut=abc">The <b>Sea</b> &amp; you</a></h2>
  <a class="result__snippet" href="x">Oceans cover <b>71%</b> of Earth&#x27;s surface.</a>
</div>
<div class="result results_links web-result">
  <a rel="nofollow" class="result__a" href="https://second.example/page">Second</a>
  <a class="result__snippet" href="y">More.</a>
</div>`;

test('parses DuckDuckGo results: skips ads, unwraps links, cleans text', () => {
  assert.deepEqual(parseResults(DDG), [
    { title: 'The Sea & you', url: 'https://example.com/sea', snippet: "Oceans cover 71% of Earth's surface." },
    { title: 'Second', url: 'https://second.example/page', snippet: 'More.' },
  ]);
  assert.equal(parseResults(DDG, 1).length, 1);
  assert.equal(decodeEntities('&lt;a&gt; &#65; &unknown;'), '<a> A &unknown;');
});

test('page text keeps the readable parts only', () => {
  const html = `<html><head><title>Sea facts</title><style>.x{}</style><script>var secret=1</script></head>
  <body><nav>Home | About | A very long menu entry that should never appear</nav>
  <p>The ocean is the body of salt water that covers about seventy-one percent of the planet.</p>
  <footer>Copyright line that is long enough to pass the length filter easily.</footer></body></html>`;
  const t = pageText(html);
  assert.equal(t.title, 'Sea facts');
  assert.match(t.text, /seventy-one percent/);
  assert.doesNotMatch(t.text, /secret|menu entry|Copyright/);
});

test('private and local addresses are never fetched', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0'])
    assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  const s = createSearch({ lookup: async (h) => [{ address: h === 'evil.example' ? '127.0.0.1' : '93.184.216.34' }] });
  assert.equal(await s.publicUrl('http://localhost/x'), null);
  assert.equal(await s.publicUrl('http://127.0.0.1/x'), null);
  assert.equal(await s.publicUrl('http://evil.example/x'), null, 'a name that points inside is refused');
  assert.equal(await s.publicUrl('file:///etc/passwd'), null);
  assert.equal(await s.publicUrl('http://ok.example:8188/x'), null, 'odd ports are refused');
  assert.equal((await s.publicUrl('https://ok.example/x')).href, 'https://ok.example/x');
});

test('search reads the top pages and follows redirects only to public places', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('https://html.duckduckgo.com')) return new Response(DDG, { status: 200 });
    if (u === 'https://example.com/sea') return new Response(null, { status: 302, headers: { location: 'http://inside.example/admin' } });
    if (u === 'https://second.example/page')
      return new Response('<p>A second page with plenty of readable words in one long paragraph.</p>', { headers: { 'content-type': 'text/html' } });
    throw new Error(`unexpected ${u} ${init.method}`);
  };
  const lookup = async (h) => [{ address: h === 'inside.example' ? '10.0.0.5' : '93.184.216.34' }];
  const r = await createSearch({ fetchImpl, lookup }).search('the sea');
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].text, undefined, 'redirect into a private address is not followed');
  assert.match(r.results[1].text, /second page/);
  assert.ok(!calls.includes('http://inside.example/admin'));
});

test('gate: search and transcribe need a token, and pass through', async () => {
  const seen = [];
  const g = createGate(
    {
      secret: SECRET,
      webui: 'http://127.0.0.1:9',
      ollama: 'http://127.0.0.1:9',
      allowedOrigins: 'https://site.example',
      status: async () => ({}),
      search: { search: async (q, o) => (seen.push(['search', q, o.pages]), { query: q, results: [] }) },
      voice: { transcribe: async (buf, type) => (seen.push(['voice', buf.length, type]), { text: 'hello' }) },
    },
    { warn() {}, info() {} },
  );
  const base = `http://127.0.0.1:${await listen(g)}`;
  assert.equal((await fetch(`${base}/_orbit/search?q=x`)).status, 401);
  const auth = { authorization: `Bearer ${apiToken()}` };
  const r = await fetch(`${base}/_orbit/search?q=the%20sea&pages=2`, { headers: auth });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { query: 'the sea', results: [] });
  const v = await fetch(`${base}/_orbit/voice/transcribe`, { method: 'POST', headers: { ...auth, 'content-type': 'audio/webm' }, body: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(await v.json(), { text: 'hello' });
  assert.deepEqual(seen, [['search', 'the sea', 2], ['voice', 3, 'audio/webm']]);
  g.close();
});

test('voice: signs in to Open WebUI once, sends the audio as a file, retries a stale token', async () => {
  const log = [];
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    log.push(`${req.method} ${req.url} ${req.headers['x-orbit-email'] || ''}${req.headers.authorization || ''}`);
    if (req.url === '/api/v1/auths/signin') return res.end(JSON.stringify({ token: `t${log.length}` }));
    if (req.headers.authorization === 'Bearer t1') return (res.statusCode = 401), res.end('{}');
    assert.match(body, /filename="speech\.m4a"/);
    res.end(JSON.stringify({ text: ' Hi there ' }));
  });
  const webui = `http://127.0.0.1:${await listen(srv)}`;
  const voice = createVoice({ webui, email: 'me@x' });
  assert.deepEqual(await voice.transcribe(Buffer.from('abc'), 'audio/mp4;codecs=mp4a'), { text: 'Hi there' });
  assert.deepEqual(log, ['POST /api/v1/auths/signin me@x', 'POST /api/v1/audio/transcriptions Bearer t1', 'POST /api/v1/auths/signin me@x', 'POST /api/v1/audio/transcriptions Bearer t3']);
  await assert.rejects(voice.transcribe(Buffer.from('a'), 'video/x-nope'), /not supported/);
  srv.close();
});
