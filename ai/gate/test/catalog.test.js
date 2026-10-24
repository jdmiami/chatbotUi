import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILES, MAKERS, VACE_TASKS, h3Workflow, kreaWorkflow, qwenWorkflow, upscaleWorkflow, videoWorkflow } from '../src/workflows.js';
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
      // From Hugging Face (repo + path), or its makers' own https address (pix2pix-turbo's LoRA).
      assert.ok(f && (f.repo ? f.path : /^https:\/\//.test(f.url || '')) && f.name && f.size > 0 && f.dir, `${d.id}: file ${k}`);
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

test('catalog: video makers name what they need, gated files are only LTX-2.5’s, and VRAM fits 48 GB', () => {
  const INPUTS = ['video', 'audio', 'photo', 'endPhoto', 'target', 'facePhoto'];
  const FLOWS = { ltx25: 'video', s2v: 'video', vace: 'videoedit', seedvr2: 'videoedit', swap: 'videoedit' };
  for (const id of ['ltx-25', 's2v', 'vace', 'video-erase', 'video-sharpen', 'person-swap']) {
    const d = CATALOG.makerDefs.find((m) => m.id === id);
    assert.ok(d, id);
    assert.equal(FLOWS[d.workflow], d.kind, `${id}: its recipe makes a ${d.kind}`);
    for (const k of [...(d.needs || []), ...(d.accepts || [])]) assert.ok(INPUTS.includes(k), `${id}: ${k}`);
    const page = CATALOG.makers[id];
    assert.ok(page.about && page.license && page.gpu && page.output, `${id}: store page`);
    assert.match(page.gpu, /of the 48 GB/);
    for (const k of d.files) assert.equal(Boolean(FILES[k].gated), FILES[k].repo === 'Lightricks/LTX-2.5', `${id}: ${k} is gated only on the gated repo`);
  }
  assert.equal(CATALOG.makers['ltx-25'].gated, true);
  // Shared files are one entry (downloaded once): the Wan text encoder and VAE.
  const vace = CATALOG.makerDefs.find((m) => m.id === 'vace');
  const s2v = CATALOG.makerDefs.find((m) => m.id === 's2v').files;
  assert.deepEqual(vace.files.filter((k) => s2v.includes(k)), ['wanTe', 'wanVae']);
  assert.deepEqual(CATALOG.makerDefs.find((m) => m.id === 'video-erase').files, vace.files);
  for (const t of vace.tasks) assert.ok(VACE_TASKS.includes(t), t);
});

test('catalog: Swap a person, its two new files (sizes checked against Hugging Face) and the files it shares', () => {
  const d = CATALOG.makerDefs.find((m) => m.id === 'person-swap');
  assert.deepEqual(
    { name: d.name, blurb: d.blurb, kind: d.kind, workflow: d.workflow, needs: d.needs, accepts: d.accepts },
    { name: 'Swap a person', blurb: 'Put someone from your photo in place of a person in your video.', kind: 'videoedit', workflow: 'swap', needs: ['video', 'target', 'photo'], accepts: ['facePhoto'] },
  );
  // The two files only it uses, exactly as Hugging Face lists them (HEAD / API, October 2026).
  assert.deepEqual(FILES.swapUnet, {
    dir: 'diffusion_models',
    name: 'Wan2_1_mocha-14B-preview_fp8_e4m3fn_scaled_KJ.safetensors',
    repo: 'Kijai/WanVideo_comfy_fp8_scaled',
    path: 'MoCha/Wan2_1_mocha-14B-preview_fp8_e4m3fn_scaled_KJ.safetensors',
    size: 14341075314,
  });
  assert.deepEqual(FILES.swapLora, {
    dir: 'loras',
    name: 'lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors',
    repo: 'Kijai/WanVideo_comfy',
    path: 'Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors',
    size: 630697104,
  });
  // Everything else is already on a machine with the other video editors: downloaded once.
  const vace = CATALOG.makerDefs.find((m) => m.id === 'vace').files;
  assert.deepEqual(d.files.filter((k) => vace.includes(k)), ['wanTe', 'wanVae', 'sam3']);
  assert.deepEqual(d.files.filter((k) => !vace.includes(k)), ['swapUnet', 'swapLora']);
  const page = CATALOG.makers['person-swap'];
  assert.match(page.license, /AGPL-3\.0/);
  assert.match(page.about, /never made sexual/);
  assert.ok(page.tryIt.length >= 2);
});
