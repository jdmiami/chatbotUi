import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liteMakePage, LITE_JS } from '../../lib/liteMake.ts';
import { CENTER_CSS, CENTER_JS } from '../../lib/simpleCenter.ts';

test('Simple is one small response with all four tabs: no other script or style to fetch, and its script parses', () => {
  const html = liteMakePage({ css: CENTER_CSS, js: CENTER_JS });
  assert.ok(html.startsWith('<!doctype html>'));
  // Still far lighter than Orbit: about a quarter of this once compressed.
  assert.ok(Buffer.byteLength(html) < 110 * 1024, `the page is ${Buffer.byteLength(html)} bytes`);
  assert.doesNotMatch(CENTER_JS, /\$\{|`/);
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
  assert.ok(!script.includes('/*CENTER*/'), 'the tabs are in the script');
  // The tabs share the page's script: none of their names may hide one of the page's.
  const names = (js) => new Set([...js.matchAll(/(?:function|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const page = names(LITE_JS);
  const top = [...CENTER_JS.matchAll(/^  (?:function|var) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  for (const n of top) assert.ok(!page.has(n), `${n} is already a name in the Make page`);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+stylesheet/);
  assert.match(html, /viewport-fit=cover/);
  // The script is valid JavaScript as served.
  assert.doesNotThrow(() => new Function(LITE_JS));
});

test('the fast Make page asks the writer for made-up adults only, and comes back to /lite after signing in', () => {
  assert.match(LITE_JS, /task: 'free'/);
  assert.match(LITE_JS, /fictional adult, clearly over 18\. Never a real, famous or named public person\./);
  assert.match(LITE_JS, /\/login\?next=\/lite/);
});

test('every NVIDIA unfiltered writer has a plain name in the fast Make picker', async () => {
  // lib/orbAi.ts is server-only: its NVIDIA list is read from the file itself.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../lib/orbAi.ts', import.meta.url), 'utf8');
  const nvidia = src.slice(src.indexOf("id: 'nvidia'"), src.indexOf('];', src.indexOf("id: 'nvidia'")));
  const free = nvidia.slice(nvidia.indexOf('free: ['), nvidia.indexOf('],', nvidia.indexOf('free: [')));
  const ids = [...free.matchAll(/'([a-z0-9.-]+\/[a-z0-9.-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 3, `found ${ids.length}`);
  for (const id of ids) assert.ok(LITE_JS.includes(`'${id}': '`), `${id} has no name in the picker`);
});
