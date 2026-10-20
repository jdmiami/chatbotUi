import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILES, MAKERS, h3Workflow, kreaWorkflow, qwenWorkflow, upscaleWorkflow, videoWorkflow } from '../src/workflows.js';
import { FEATURED } from '../src/store.js';
import { parseModelSpec } from '../src/machine.js';

const CATALOG = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));

test('catalog: every chat model has a valid spec, size and shelf, and fits the 48 GB GPU', () => {
  const ids = new Set();
  for (const m of FEATURED) {
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    const p = parseModelSpec(m.spec);
    assert.ok(p.name && p.source, m.id);
    if (p.source.startsWith('hf.co/')) assert.match(p.source, /^hf\.co\/[\w.-]+\/[\w.-]+:[\w-]+$/, m.id);
    assert.ok(m.size > 1e9 && m.size < 36e9, `${m.id} size`);
    assert.ok(m.tags.length && m.blurb, m.id);
  }
  // At least three of each kind of chat model.
  for (const tag of ['general', 'vision', 'coding', 'reasoning', 'creative', 'multilingual', 'fast', 'tools']) {
    assert.ok(FEATURED.filter((m) => m.tags.includes(tag)).length >= 3, `shelf ${tag}`);
  }
});

test('catalog: every extra maker is in the store with downloadable files and a recipe', () => {
  for (const d of CATALOG.makerDefs) {
    const m = MAKERS.find((x) => x.id === d.id);
    assert.ok(m, d.id);
    for (const k of m.files) {
      const f = FILES[k];
      assert.ok(f && f.repo && f.path && f.name && f.size > 0 && f.dir, `${d.id}: file ${k}`);
    }
    if (m.kind === 'style') assert.ok(m.loraFile?.name && m.trigger && MAKERS.some((x) => x.id === m.for), d.id);
    if (m.kind === 'edit') assert.ok(FILES[m.lora], d.id);
    assert.ok(CATALOG.makers[d.id]?.about, `${d.id} has a store page`);
  }
  const ids = MAKERS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'maker ids are unique');
});

test('recipes take the maker’s own model file and settings', () => {
  const q = qwenWorkflow({ unet: FILES.qwenTurbo.name, prompt: 'x', steps: 8, cfg: 1 });
  assert.equal(q[1].inputs.unet_name, FILES.qwenTurbo.name);
  assert.equal(q[7].inputs.steps, 8);
  assert.equal(kreaWorkflow({ prompt: 'x', unet: FILES.kreaHd.name })[1].inputs.unet_name, FILES.kreaHd.name);
  const k = kreaWorkflow({ prompt: 'a cat', style: FILES.style_linocut.name, trigger: 'black ink linocut style' });
  assert.match(k[4].inputs.text, /a cat, black ink linocut style/);
  const v = videoWorkflow({ prompt: 'x', ckpt: FILES.ltxDistilled.name, lora: false });
  assert.equal(v[1].inputs.ckpt_name, FILES.ltxDistilled.name);
  assert.deepEqual(v[35].inputs.model, ['1', 0]);
  const h = h3Workflow({ prompt: 'x', unet: FILES.h3Cobijada.name, turbo: FILES.h3Turbo.name });
  assert.equal(h[15].inputs.lora_name, FILES.h3Turbo.name);
  assert.deepEqual(h[7].inputs.model, ['15', 0]);
  assert.equal(h3Workflow({ prompt: 'x' })[15], undefined);
  assert.equal(upscaleWorkflow({ image: 'a.png', model: FILES.ultrasharp.name })[2].inputs.model_name, FILES.ultrasharp.name);
});
