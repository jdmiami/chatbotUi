import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FILES,
  LTX25_FPS,
  S2V_CHUNK,
  VACE_EXTEND_KEEP,
  VACE_MAX_FRAMES,
  WAN_NEGATIVE,
  editWorkflow,
  h3Workflow,
  imageWorkflow,
  kreaWorkflow,
  ltx25Frames,
  ltx25Restyle,
  ltx25Workflow,
  qwenWorkflow,
  s2vChunks,
  s2vWorkflow,
  seedvr2Workflow,
  SWAP_FPS,
  swapWorkflow,
  upscaleWorkflow,
  vaceWorkflow,
  videoWorkflow,
  zimageSketchWorkflow,
} from '../src/workflows.js';

// Every recipe is checked against the node schemas of the pinned ComfyUI (v0.41.2 /object_info,
// trimmed: test/fixtures/comfy-nodes.json): only nodes that exist, only inputs they have, every
// required input given, literal values of the right type and range, and links from an output of the
// right type. (The same graphs were also accepted by a real ComfyUI v0.41.2 /prompt on CPU.)
const FIX = JSON.parse(readFileSync(new URL('./fixtures/comfy-nodes.json', import.meta.url), 'utf8'));

const P = 'orbit-test.png';
const V = 'orbit-test.mp4';
const A = 'orbit-test.wav';
const GRAPHS = {
  image: imageWorkflow({ prompt: 'x' }),
  qwen: qwenWorkflow({ unet: 'u.safetensors', prompt: 'x' }),
  ltx: videoWorkflow({ prompt: 'x' }),
  ltxImage: videoWorkflow({ prompt: 'x', image: P }),
  ltxKeyframes: videoWorkflow({ prompt: 'x', image: P, endImage: P }),
  h3: h3Workflow({ prompt: 'x', image: P, endImage: P, turbo: 'turbo.safetensors' }),
  krea: kreaWorkflow({ prompt: 'x', style: 'krea2_darkbrush.safetensors' }),
  edit: editWorkflow({ prompt: 'x', images: [P, P], lora: 'l.safetensors' }),
  upscale: upscaleWorkflow({ image: P }),
  ltx25Text: ltx25Workflow({ prompt: 'x' }),
  ltx25Image: ltx25Workflow({ prompt: 'x', image: P }),
  ltx25FirstLast: ltx25Workflow({ prompt: 'x', image: P, endImage: P }),
  ltx25Last: ltx25Workflow({ prompt: 'x', endImage: P }),
  ltx25Video: ltx25Workflow({ prompt: 'x', video: V, width: 1280, height: 704, frames: 121 }),
  s2v: s2vWorkflow({ prompt: 'x', image: P, audio: A }),
  s2v4: s2vWorkflow({ prompt: 'x', image: P, audio: A, chunks: 4 }),
  vaceReplace: vaceWorkflow({ task: 'replace', prompt: 'x', video: V, width: 1280, height: 720, frames: 81, target: 'the car', reference: P }),
  vaceErase: vaceWorkflow({ task: 'erase', prompt: 'x', video: V, width: 1280, height: 720, frames: 81, target: 'the car' }),
  vaceRestyle: vaceWorkflow({ task: 'restyle', prompt: 'x', video: V, width: 720, height: 1280, frames: 49 }),
  vaceMotion: vaceWorkflow({ task: 'motion', prompt: 'x', video: V, width: 960, height: 960, frames: 81, reference: P }),
  vaceExtend: vaceWorkflow({ task: 'extend', prompt: 'x', video: V, width: 1280, height: 720, frames: 80 }),
  seedvr2: seedvr2Workflow({ video: V }),
  swap: swapWorkflow({ video: V, width: 832, height: 464, frames: 81, target: 'the man in the red jacket', photo: P }),
  swapFace: swapWorkflow({ video: V, width: 480, height: 832, frames: 33, target: 'the woman on the left', photo: P, face: 'orbit-face.png' }),
  sketch: zimageSketchWorkflow({ prompt: 'x', sketch: P, width: 832, height: 1216, strength: 0.65 }),
};

const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && Number.isInteger(v[1]);
const compatible = (out, input) =>
  out === '*' || input === '*' || out === 'COMFY_MATCHTYPE_V3' || input === 'COMFY_MATCHTYPE_V3' || String(input).split(',').includes(out) || (input === 'COMBO' && out === 'COMBO');

/** Every input key a node takes for these values: its own, dynamic-combo sub-inputs, autogrow slots. */
function expand(inputs, prefix, values, allowed, required, grows) {
  for (const sec of ['required', 'optional']) {
    for (const [k, spec] of Object.entries(inputs?.[sec] || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      const [type, opts = {}] = spec;
      if (type === 'COMFY_AUTOGROW_V3') {
        const t = opts.template;
        const names = t.names || Array.from({ length: t.max ?? 50 }, (_, i) => `${t.prefix}${i}`);
        const slot = Object.values(t.input.required)[0];
        for (const n of names) allowed.set(`${key}.${n}`, slot);
        if (sec === 'required') grows.push({ key, min: t.min ?? 1 });
        continue;
      }
      allowed.set(key, spec);
      if (sec === 'required') required.push(key);
      if (type === 'COMFY_DYNAMICCOMBO_V3' && key in values) {
        const opt = opts.options.find((o) => o.key === values[key]);
        assert.ok(opt, `${key} = ${values[key]} is one of ${opts.options.map((o) => o.key)}`);
        expand(opt.inputs, key, values, allowed, required, grows);
      }
    }
  }
}

function checkGraph(name, wf) {
  let saves = 0;
  for (const [id, n] of Object.entries(wf)) {
    const where = `${name} #${id} ${n.class_type}`;
    const schema = FIX.nodes[n.class_type];
    assert.ok(schema, `${where}: a ComfyUI ${FIX.comfyui} node`);
    if (/^Save(Image|Video)$/.test(n.class_type)) saves++;
    const allowed = new Map();
    const required = [];
    const grows = [];
    expand(schema.input, '', n.inputs, allowed, required, grows);
    for (const k of required) assert.ok(k in n.inputs, `${where}: required input ${k}`);
    for (const g of grows) assert.ok(Object.keys(n.inputs).filter((k) => k.startsWith(`${g.key}.`)).length >= g.min, `${where}: ${g.key} needs ${g.min}+`);
    for (const [k, v] of Object.entries(n.inputs)) {
      const spec = allowed.get(k);
      assert.ok(spec, `${where}: has no input "${k}"`);
      const [type, opts = {}] = spec;
      if (isLink(v)) {
        const src = wf[v[0]];
        assert.ok(src, `${where}.${k}: links to missing node ${v[0]}`);
        const outs = FIX.nodes[src.class_type].output;
        assert.ok(v[1] < outs.length, `${where}.${k}: ${src.class_type} has no output ${v[1]}`);
        assert.ok(compatible(outs[v[1]], type), `${where}.${k}: gets ${outs[v[1]]}, wants ${type}`);
        continue;
      }
      const types = String(type).split(',');
      if (types.length > 1 && types.includes(typeof v === 'number' ? (Number.isInteger(v) ? 'INT' : 'FLOAT') : typeof v === 'boolean' ? 'BOOLEAN' : '?')) continue;
      if (type === 'INT' || type === 'FLOAT') {
        assert.equal(typeof v, 'number', `${where}.${k} is a number`);
        if (type === 'INT') assert.ok(Number.isInteger(v), `${where}.${k} is whole`);
        if (opts.min !== undefined) assert.ok(v >= opts.min, `${where}.${k} >= ${opts.min}`);
        if (opts.max !== undefined) assert.ok(v <= opts.max, `${where}.${k} <= ${opts.max}`);
      } else if (type === 'BOOLEAN') assert.equal(typeof v, 'boolean', `${where}.${k}`);
      else if (type === 'STRING') assert.equal(typeof v, 'string', `${where}.${k}`);
      else if (type === 'COMBO' || type === 'COMFY_DYNAMICCOMBO_V3') {
        const list = (opts.options || []).map((o) => (o && typeof o === 'object' ? o.key : o));
        // File names (models, inputs) depend on what is on the machine: not part of the schema.
        if (list.length && !/\.(safetensors|pth|pt|ckpt|gguf|png|jpe?g|webp|mp4|wav)$/.test(String(v))) assert.ok(list.includes(v), `${where}.${k} = ${v} is one of ${list.slice(0, 8)}`);
      } else assert.fail(`${where}.${k}: a ${type} must come from another node, not ${JSON.stringify(v)}`);
    }
  }
  assert.equal(saves, 1, `${name}: saves one result`);
}

test('recipes: every graph uses only ComfyUI v0.41.2 nodes and inputs, correctly typed and wired', () => {
  for (const [name, wf] of Object.entries(GRAPHS)) checkGraph(name, wf);
});

test('recipes: the checker catches a wrong node, input or link', () => {
  const bad = (mutate) => {
    const wf = structuredClone(GRAPHS.seedvr2);
    mutate(wf);
    return () => checkGraph('bad', wf);
  };
  assert.throws(bad((wf) => (wf[1].class_type = 'LoadVideoFancy')), /a ComfyUI 0.41.2 node/);
  assert.throws(bad((wf) => (wf[10].inputs.cfg_scale = 1)), /has no input "cfg_scale"/);
  assert.throws(bad((wf) => delete wf[10].inputs.steps), /required input steps/);
  assert.throws(bad((wf) => (wf[14].inputs.images = ['2', 1])), /gets AUDIO, wants IMAGE/);
  assert.throws(bad((wf) => (wf[10].inputs.sampler_name = 'nope')), /is one of/);
  assert.throws(bad((wf) => (wf[3].inputs['resize_type.multiplier'] = 20)), /<= 8/);
});

const node = (wf, type) => Object.values(wf).find((n) => n.class_type === type);
const nodes = (wf, type) => Object.values(wf).filter((n) => n.class_type === type);
const usesFile = (wf, file) => Object.values(wf).some((n) => Object.values(n.inputs).includes(file.name));

test('LTX-2.5: text, picture, first/last frame and video to video, at 24 fps with sound', () => {
  assert.equal(ltx25Frames(5), 121);
  for (const s of [2, 3, 5, 8, 10]) assert.equal((ltx25Frames(s) - 1) % 8, 0, 'LTX takes 8k + 1 frames');
  const t = GRAPHS.ltx25Text;
  for (const f of ['ltx25Unet', 'ltx25Te', 'ltx25Vae', 'ltx25AudioVae', 'ltx25Upscaler']) assert.ok(usesFile(t, FILES[f]), f);
  assert.equal(node(t, 'CLIPLoader').inputs.type, 'ltxv');
  assert.deepEqual([t[30].inputs.width, t[30].inputs.height, t[30].inputs.length], [640, 352, 121], 'first pass at half size');
  assert.equal(t[31].inputs.bypass, true, 'no picture: the image step is bypassed');
  assert.equal(nodes(t, 'LTXVDualCFGGuider').length, 2);
  assert.equal(node(t, 'CreateVideo').inputs.fps, LTX25_FPS);
  assert.equal(GRAPHS.ltx25Image[31].inputs.bypass, false);
  assert.equal(GRAPHS.ltx25Image[20].inputs.image, P);

  const fl = GRAPHS.ltx25FirstLast;
  assert.deepEqual(nodes(fl, 'LTXVAddGuide').map((n) => n.inputs.frame_idx), [0, -1], 'starts on one picture, lands on the other');
  assert.deepEqual(fl[61].inputs.latent, ['60', 2], 'the end guide follows the start guide');
  assert.deepEqual(fl[50].inputs.samples, ['62', 2], 'guide frames are cropped before decoding');
  assert.equal(fl[30].inputs.width, 1280, 'one full-size pass, like the template');
  assert.equal(node(GRAPHS.ltx25Last, 'LTXVAddGuide').inputs.frame_idx, -1);

  const v = GRAPHS.ltx25Video;
  assert.equal(v[70].inputs.file, V);
  assert.deepEqual(v[73].inputs.audio, ['71', 1], 'its sound is encoded alongside');
  assert.deepEqual(v[52].inputs.audio, ['71', 1], 'and the original sound is kept');
  assert.equal(node(v, 'EmptyLTXVLatentVideo'), undefined, 'starts from the video, not noise');
  assert.equal(v[37].inputs.sigmas, ltx25Restyle(0.9));
  assert.equal(ltx25Restyle(0.75), '0.725, 0.421875, 0');
  assert.match(ltx25Restyle(0.95), /^0.909375, /);
  assert.equal(ltx25Restyle(0.1).split(',').length, 2, 'never less than the last steps');
});

test('Wan S2V: a photo and a sound, one chunk per 77 frames, the sound kept', () => {
  assert.deepEqual([1, 4.8, 5, 9.6, 19, 60].map((s) => s2vChunks(s)), [1, 1, 2, 2, 4, 4]);
  const one = GRAPHS.s2v;
  assert.equal(node(one, 'WanSoundImageToVideo').inputs.length, S2V_CHUNK);
  assert.equal(nodes(one, 'WanSoundImageToVideoExtend').length, 0);
  const four = GRAPHS.s2v4;
  assert.equal(nodes(four, 'WanSoundImageToVideoExtend').length, 3);
  assert.equal(nodes(four, 'KSampler').length, 4);
  for (const k of nodes(four, 'KSampler')) assert.deepEqual([k.inputs.steps, k.inputs.cfg, k.inputs.sampler_name], [4, 1, 'uni_pc'], '4-step LightX2V setting');
  assert.equal(node(four, 'LoadAudio').inputs.audio, A);
  assert.deepEqual(node(four, 'CreateVideo').inputs.audio, ['7', 0]);
  assert.equal(node(four, 'ImageFromBatch').inputs.batch_index, 3, "the template's first 3 frames are dropped");
  assert.equal(node(four, 'CLIPTextEncode').inputs.text, 'x');
  for (const f of ['s2vUnet', 's2vLora', 'wav2vec', 'wanTe', 'wanVae']) assert.ok(usesFile(four, FILES[f]), f);
});

test('Wan VACE: replace and erase find the words with SAM 3.1; restyle, motion and extend', () => {
  const r = GRAPHS.vaceReplace;
  assert.equal(r[1].inputs.weight_dtype, 'fp8_e4m3fn', '14B fp16 runs in fp8 to fit 48 GB');
  assert.equal(r[31].inputs.text, 'the car', 'SAM 3.1 looks for the words');
  assert.deepEqual(r[20].inputs.control_masks, ['33', 0]);
  assert.deepEqual(r[20].inputs.reference_image, ['50', 0]);
  assert.deepEqual([r[20].inputs.width, r[20].inputs.height, r[20].inputs.length], [1280, 720, 81]);
  assert.equal(r[33].inputs.expand, 20);
  for (const f of ['vaceUnet', 'causvidLora', 'wanTe', 'wanVae', 'sam3']) assert.ok(usesFile(r, FILES[f]), f);

  const e = GRAPHS.vaceErase;
  assert.equal(e[7].inputs.text, `the car, ${WAN_NEGATIVE}`, 'what is erased goes in the negative prompt');
  assert.equal(e[20].inputs.reference_image, undefined);

  assert.ok(node(GRAPHS.vaceRestyle, 'Canny'));
  assert.equal(GRAPHS.vaceRestyle[20].inputs.control_masks, undefined);
  assert.deepEqual(GRAPHS.vaceMotion[20].inputs.reference_image, ['50', 0]);

  const x = GRAPHS.vaceExtend;
  assert.equal(x[20].inputs.length, VACE_MAX_FRAMES);
  assert.deepEqual([x[40].inputs.batch_index, x[40].inputs.length], [-VACE_EXTEND_KEEP, VACE_EXTEND_KEEP], 'the last frames lead');
  assert.equal(x[43].inputs.amount, VACE_EXTEND_KEEP, 'a keep-mask for each of them');
  assert.equal(x[45].inputs.batch_index, VACE_EXTEND_KEEP, 'only the new frames are added');
  assert.deepEqual(x[24].inputs.images, ['46', 0]);
  for (const g of [r, e, GRAPHS.vaceRestyle, x]) assert.deepEqual(node(g, 'CreateVideo').inputs.audio, ['9', 1], 'the clip keeps its sound');
  assert.throws(() => vaceWorkflow({ task: 'dance', prompt: 'x', video: V, width: 16, height: 16, frames: 5 }), /Unknown VACE task/);
});

test('Swap a person: words find who on the first frame; the photo (and a face close-up) go in; shared files', () => {
  const s = GRAPHS.swap;
  // Who to replace: the text segmenter looks for the words on the first frame only.
  assert.equal(s[31].inputs.text, 'the man in the red jacket');
  assert.deepEqual(s[32].inputs, { image: ['11', 0], batch_index: 0, length: 1 }, 'the first frame');
  assert.deepEqual(s[33].inputs.image, ['32', 0]);
  assert.deepEqual(s[33].inputs.conditioning, ['31', 0]);
  assert.equal(s[34].inputs.expand, 5, 'the mask grows 5 px, as in the example');
  const e = node(s, 'MochaEmbeds');
  assert.deepEqual(e.inputs.mask, ['34', 0], 'that mask is the one the model gets');
  assert.deepEqual(e.inputs.input_video, ['11', 0], 'the whole clip');
  assert.deepEqual(e.inputs.ref1, ['41', 0]);
  assert.equal(e.inputs.ref2, undefined, 'no face close-up: one picture');
  assert.equal(s[40].inputs.image, P);
  assert.deepEqual([s[41].inputs.target_width, s[41].inputs.target_height, s[41].inputs.padding_color], [832, 464, 'white'], 'the photo fitted in the frame on white');
  // The example's settings: 6 steps, cfg 1, shift 5, dpm++_sde, the speed-up LoRA at 1.
  const k = node(s, 'WanVideoSampler').inputs;
  assert.deepEqual([k.steps, k.cfg, k.shift, k.scheduler], [6, 1, 5, 'dpm++_sde']);
  assert.deepEqual(k.image_embeds, ['50', 0]);
  assert.deepEqual(k.text_embeds, ['9', 0]);
  assert.equal(node(s, 'WanVideoLoraSelectMulti').inputs.lora_0, FILES.swapLora.name);
  assert.equal(node(s, 'WanVideoLoraSelectMulti').inputs.strength_0, 1);
  assert.deepEqual(node(s, 'WanVideoModelLoader').inputs.lora, ['1', 0]);
  assert.equal(node(s, 'WanVideoModelLoader').inputs.attention_mode, 'sdpa', 'no extra attention package needed');
  // Shared files: the text encoder (through the bridge), the VAE and the segmenter.
  for (const f of ['swapUnet', 'swapLora', 'wanTe', 'wanVae', 'sam3']) assert.ok(usesFile(s, FILES[f]), f);
  assert.equal(node(s, 'CLIPLoader').inputs.type, 'wan');
  assert.deepEqual(node(s, 'WanVideoTextEmbedBridge').inputs, { positive: ['7', 0], negative: ['8', 0] });
  assert.equal(s[7].inputs.text, ' ', "an empty prompt, as the model's makers run it");
  assert.equal(s[8].inputs.text, WAN_NEGATIVE);
  // The clip keeps its sound and timing.
  assert.deepEqual(node(s, 'CreateVideo').inputs, { images: ['61', 0], audio: ['11', 1], fps: SWAP_FPS });

  const f = GRAPHS.swapFace;
  assert.deepEqual(node(f, 'MochaEmbeds').inputs.ref2, ['43', 0], 'the face close-up is the second picture');
  assert.equal(f[42].inputs.image, 'orbit-face.png');
  assert.deepEqual([f[43].inputs.target_width, f[43].inputs.target_height], [480, 832]);

  assert.throws(() => swapWorkflow({ video: V, width: 832, height: 480, frames: 81, target: '', photo: P }), /who to replace/);
  assert.throws(() => swapWorkflow({ video: V, width: 832, height: 480, frames: 81, target: 'x' }), /photo/);
  assert.throws(() => swapWorkflow({ video: V, width: 832, height: 480, frames: 80, target: 'x', photo: P }), /4k \+ 1/);
});

test('SeedVR2: 2× with chunking, the frame rate and sound of the original', () => {
  const s = GRAPHS.seedvr2;
  assert.equal(s[3].inputs['resize_type.multiplier'], 2);
  assert.equal(s[8].inputs.chunking_mode, 'auto');
  assert.deepEqual(s[14].inputs.fps, ['2', 2]);
  assert.deepEqual(s[14].inputs.audio, ['2', 1]);
  assert.equal(s[10].inputs.steps, 1, 'one step');
  for (const f of ['seedvr2', 'seedvr2Vae']) assert.ok(usesFile(s, FILES[f]), f);
});
