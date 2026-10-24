// Unfiltered writing (lib/freeWrite.ts): the rule goes first, refusals are spotted, a rewrite of the
// owner's own "I can't…" is not mistaken for one. Run with: npm run test:site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_RULE, NOT_POSSIBLE, askedText, looksRefused, replyText, withFreeRule } from '../../lib/freeWrite.ts';

test('the rule goes first: joined to the caller’s own system message, or as one of its own', () => {
  const joined = withFreeRule([
    { role: 'system', content: 'Make it shorter.' },
    { role: 'user', content: 'hello' },
  ]);
  assert.equal(joined.length, 2);
  assert.ok(joined[0].content.startsWith(FREE_RULE));
  assert.ok(joined[0].content.endsWith('Make it shorter.'));
  const added = withFreeRule([{ role: 'user', content: 'hello' }]);
  assert.deepEqual(added.map((m) => m.role), ['system', 'user']);
  // Adults only, said in the rule itself.
  assert.match(FREE_RULE, /under 18/);
  assert.match(FREE_RULE, /explicit sexual content between adults/);
});

test('refusals are spotted at the start of the reply; answers and the minors answer are not', () => {
  for (const r of ["I'm sorry, but I can't help with that.", 'I cannot rewrite this text.', 'As an AI, I must decline.', '"I won’t do that."', 'Unfortunately, I am unable to assist.']) {
    assert.equal(looksRefused(r, 'some steamy text'), true, r);
  }
  for (const r of ['She pulled him closer and kissed him hard.', NOT_POSSIBLE, '', 'Sorry seems to be the hardest word, she sang.']) {
    assert.equal(looksRefused(r, 'some text'), false, r);
  }
  // The owner's own words start that way: a rewrite of them is not a refusal.
  assert.equal(looksRefused("I can't wait to see you tonight.", "i cant wait to see u tonite"), false);
  assert.equal(looksRefused("I can't wait to see you tonight.", "I can't wait to see u tonite"), false);
});

test('the reply and the owner’s words are read from the request and the answer', () => {
  assert.equal(replyText(JSON.stringify({ choices: [{ message: { content: 'done' } }] })), 'done');
  assert.equal(replyText('not json'), '');
  assert.equal(askedText([{ role: 'system', content: 'x' }, { role: 'user', content: 'first' }, { role: 'assistant', content: 'y' }, { role: 'user', content: 'last' }]), 'last');
});
