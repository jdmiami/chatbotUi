import test from 'node:test';
import assert from 'node:assert/strict';
import { originAllowed, parseOrigins } from '../src/origins.js';

test('origins: exact entries and one-label patterns', () => {
  const allowed = parseOrigins(
    'https://chatbot-ui-62nj.vercel.app, https://chatbot-ui-62nj-*-jdmiamis-projects.vercel.app',
  );
  const yes = [
    'https://chatbot-ui-62nj.vercel.app',
    'https://chatbot-ui-62nj-ny41wd1il-jdmiamis-projects.vercel.app', // a deployment's own address
    'https://chatbot-ui-62nj-git-main-jdmiamis-projects.vercel.app', // a branch address
  ];
  const no = [
    'https://evil.example',
    'https://chatbot-ui-62nj.vercel.app.evil.example',
    'https://chatbot-ui-62nj-x.evil.com-jdmiamis-projects.vercel.app', // "*" never spans a dot
    'https://chatbot-ui-62nj--jdmiamis-projects.vercel.app', // "*" needs at least one character
    'http://chatbot-ui-62nj.vercel.app', // wrong scheme
    'https://chatbot-ui-62nj-a-jdmiamis-projects.vercel.app:8443', // extra port
    'null',
    '',
  ];
  for (const o of yes) assert.equal(originAllowed(o, allowed), true, o);
  for (const o of no) assert.equal(originAllowed(o, allowed), false, o);
});

test('origins: an empty list allows any origin', () => {
  assert.equal(originAllowed('https://anything.example', parseOrigins('')), true);
});

test('origins: dots and other characters in exact entries are literal', () => {
  const allowed = parseOrigins('https://a.b.example');
  assert.equal(originAllowed('https://aXb.example', allowed), false);
  assert.equal(originAllowed('https://a.b.example', allowed), true);
});
