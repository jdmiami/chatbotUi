import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liteMakePage, LITE_JS } from '../../lib/liteMake.ts';

test('the fast Make page is one small response: no other script or style to fetch, and its script parses', () => {
  const html = liteMakePage();
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(Buffer.byteLength(html) < 48 * 1024, `the page is ${Buffer.byteLength(html)} bytes`);
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
