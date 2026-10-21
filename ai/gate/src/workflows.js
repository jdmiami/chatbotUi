// ComfyUI job recipes (API format) for the AI machine's image and video makers. Built from the
// official ComfyUI templates (Qwen-Image 2.1 text-to-image, LTX-2.3 text/image-to-video), using
// only core ComfyUI nodes, with the uncensored model files listed in STUDIO_FILES.
import { readFileSync } from 'node:fs';

/** Where each model file lives (ComfyUI models/<dir>/<name>) and where to download it from. */
export const STUDIO_FILES = {
  image: [
    { dir: 'diffusion_models', name: 'qwen-image-2.1-UC-fp8.safetensors', repo: 'abenzerps/Qwen-Image-2.1-Uncensored-Quantized', path: 'qwen-image-2.1-UC-fp8.safetensors', size: 7116818183 },
    { dir: 'text_encoders', name: 'qwen3vl_8b_int8_convrot.safetensors', repo: 'abenzerps/Qwen-Image-2.1-Uncensored-Quantized', path: 'text_encoders/qwen3vl_8b_int8_convrot.safetensors', size: 9350798360 },
    { dir: 'vae', name: 'qwen_image_2.1_vae_bf16.safetensors', repo: 'abenzerps/Qwen-Image-2.1-Uncensored-Quantized', path: 'vae/qwen_image_2.1_vae_bf16.safetensors', size: 675509688 },
  ],
  video: [
    { dir: 'checkpoints', name: '10Eros_v1.4_fp8mixed_learned.safetensors', repo: 'TenStrip/LTX2.3-10Eros', path: '10Eros_v1.4_fp8mixed_learned.safetensors', size: 29161843630 },
    { dir: 'text_encoders', name: 'gemma-3-12b-it-ablit-norms-biproj-fp8mixed.safetensors', repo: 'TenStrip/LTX2.3-10Eros', path: 'text_encoders/gemma-3-12b-it-ablit-norms-biproj-fp8mixed.safetensors', size: 12778566778 },
    { dir: 'loras', name: 'ltx-2.3-22b-distilled-lora-1.1_fro90_ceil52_condsafe.safetensors', repo: 'TenStrip/LTX2.3_Distilled_Lora_1.1_Experiments', path: 'ltx-2.3-22b-distilled-lora-1.1_fro90_ceil52_condsafe.safetensors', size: 486676968 },
    { dir: 'latent_upscale_models', name: 'ltx-2.3-spatial-upscaler-x2-1.1.safetensors', repo: 'ChrisColeTech/LTX-2.3-uncensored-v1.4-FP8', path: 'split/latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors', size: 995743560 },
  ],
};

const [QWEN_UNET, QWEN_TE, QWEN_VAE] = STUDIO_FILES.image.map((f) => f.name);
const [LTX_CKPT, LTX_TE, LTX_LORA, LTX_UPSCALER] = STUDIO_FILES.video.map((f) => f.name);

export const VIDEO_FPS = 25;
const VIDEO_NEGATIVE = 'pc game, console game, video game, cartoon, childish, ugly, subtitles, text, watermark';

const randomSeed = () => Math.floor(Math.random() * 2 ** 48);

/** Qwen-Image 2.1: text to image. */
export function imageWorkflow({ prompt, width = 1024, height = 1024, seed = randomSeed(), steps = 25, prefix = 'orbit/image' }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: QWEN_UNET, weight_dtype: 'default' } },
    2: { class_type: 'QwenImage21Cache', inputs: { model: ['1', 0], device: 'auto', dtype: 'default' } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: QWEN_TE, type: 'qwen_image', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: QWEN_VAE } },
    5: { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['3', 0], prompt, negative_prompt: '', resolution: 1024 } },
    6: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    7: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        seed,
        steps,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: ['5', 0],
        negative: ['5', 1],
        latent_image: ['6', 0],
        denoise: 1,
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['4', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  };
}

/**
 * LTX-2.3 (10Eros): text or image to video with sound. Two passes like the official template: a
 * half-size pass, then a 2x latent upscale and a short refining pass. `image` is the name of an
 * uploaded ComfyUI input image to start from, or null for text-to-video.
 */
export function videoWorkflow({ prompt, width = 1280, height = 720, seconds = 5, image = null, endImage = null, seed = randomSeed(), prefix = 'orbit/video', ckpt = LTX_CKPT, lora = true }) {
  // LTX makes 8k+1 frames (other counts are cut down to that, while the sound would keep the full
  // length and run past the pictures).
  const frames = 8 * Math.max(1, Math.round((seconds * VIDEO_FPS) / 8)) + 1;
  const fromImage = Boolean(image);
  const wf = {
    // Models
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: { class_type: 'LTXAVTextEncoderLoader', inputs: { text_encoder: LTX_TE, ckpt_name: ckpt, device: 'default' } },
    3: { class_type: 'LTXVAudioVAELoader', inputs: { ckpt_name: ckpt } },
    4: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: LTX_LORA, strength_model: 1 } },
    5: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: LTX_LORA, strength_model: 0.5 } },
    6: { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: LTX_UPSCALER } },

    // Prompt
    10: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    11: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: VIDEO_NEGATIVE } },
    12: { class_type: 'LTXVConditioning', inputs: { positive: ['10', 0], negative: ['11', 0], frame_rate: VIDEO_FPS } },

    // Starting picture (a blank one, bypassed, for text-to-video)
    20: fromImage
      ? { class_type: 'LoadImage', inputs: { image } }
      : { class_type: 'EmptyImage', inputs: { width: 512, height: 512, batch_size: 1, color: 0 } },
    21: {
      class_type: 'ResizeImageMaskNode',
      inputs: { input: ['20', 0], resize_type: 'scale dimensions', 'resize_type.width': width, 'resize_type.height': height, 'resize_type.crop': 'center', scale_method: 'lanczos' },
    },
    22: { class_type: 'ResizeImageMaskNode', inputs: { input: ['21', 0], resize_type: 'scale longer dimension', 'resize_type.longer_size': 1536, scale_method: 'area' } },
    23: { class_type: 'LTXVPreprocess', inputs: { image: ['22', 0], img_compression: 18 } },

    // Pass 1: half size
    30: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: Math.round(width / 2), height: Math.round(height / 2), length: frames, batch_size: 1 } },
    31: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['1', 2], image: ['23', 0], latent: ['30', 0], strength: 0.7, bypass: !fromImage } },
    32: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: VIDEO_FPS, batch_size: 1, audio_vae: ['3', 0] } },
    33: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['31', 0], audio_latent: ['32', 0] } },
    34: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    // A distilled checkpoint has the speed-up built in: no distilled LoRA on top.
    35: { class_type: 'CFGGuider', inputs: { model: lora ? ['4', 0] : ['1', 0], positive: ['12', 0], negative: ['12', 1], cfg: 1 } },
    36: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    37: { class_type: 'ManualSigmas', inputs: { sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' } },
    38: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['34', 0], guider: ['35', 0], sampler: ['36', 0], sigmas: ['37', 0], latent_image: ['33', 0] } },
    39: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['38', 0] } },

    // Pass 2: upscale 2x and refine
    40: { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['39', 0], upscale_model: ['6', 0], vae: ['1', 2] } },
    41: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['1', 2], image: ['23', 0], latent: ['40', 0], strength: 1, bypass: !fromImage } },
    42: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['41', 0], audio_latent: ['39', 1] } },
    43: { class_type: 'LTXVCropGuides', inputs: { positive: ['12', 0], negative: ['12', 1], latent: ['39', 0] } },
    44: { class_type: 'CFGGuider', inputs: { model: lora ? ['5', 0] : ['1', 0], positive: ['43', 0], negative: ['43', 1], cfg: 1 } },
    45: { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    46: { class_type: 'ManualSigmas', inputs: { sigmas: '0.85, 0.7250, 0.4219, 0.0' } },
    47: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['45', 0], guider: ['44', 0], sampler: ['36', 0], sigmas: ['46', 0], latent_image: ['42', 0] } },
    48: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['47', 0] } },

    // Decode and save
    50: { class_type: 'VAEDecodeTiled', inputs: { samples: ['48', 0], vae: ['1', 2], tile_size: 768, overlap: 64, temporal_size: 4096, temporal_overlap: 4 } },
    51: { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['48', 1], audio_vae: ['3', 0] } },
    52: { class_type: 'CreateVideo', inputs: { images: ['50', 0], audio: ['51', 0], fps: VIDEO_FPS } },
    53: { class_type: 'SaveVideo', inputs: { video: ['52', 0], filename_prefix: prefix, format: 'mp4', 'format.codec': 'h264' } },
  };
  return endImage ? withKeyframes(wf, { image, endImage, width, height }) : wf;
}

/**
 * First and last frame (soReal's storyboard): the clip starts on one picture and lands on another.
 * Uses core ComfyUI's LTXVAddGuide at frame 0 and frame -1 (the end), as in ComfyUI's own
 * "First-Last-Frame to Video (LTX-2.3)" template, in both passes; LTXVCropGuides takes the guide
 * frames back out of the latent before upscaling and before decoding.
 */
function withKeyframes(wf, { image, endImage, width, height }) {
  const out = { ...wf };
  for (const k of ['31', '41', '43']) delete out[k];
  const vae = ['1', 2];
  // The end picture, prepared like the start one.
  out[24] = { class_type: 'LoadImage', inputs: { image: endImage } };
  out[25] = {
    class_type: 'ResizeImageMaskNode',
    inputs: { input: ['24', 0], resize_type: 'scale dimensions', 'resize_type.width': width, 'resize_type.height': height, 'resize_type.crop': 'center', scale_method: 'lanczos' },
  };
  out[26] = { class_type: 'ResizeImageMaskNode', inputs: { input: ['25', 0], resize_type: 'scale longer dimension', 'resize_type.longer_size': 1536, scale_method: 'area' } };
  out[27] = { class_type: 'LTXVPreprocess', inputs: { image: ['26', 0], img_compression: 18 } };
  const guides = (first, last, cond, latent, strength) => {
    let c = cond;
    let l = latent;
    if (image) {
      out[first] = { class_type: 'LTXVAddGuide', inputs: { positive: [c, 0], negative: [c, 1], vae, latent: l, image: ['23', 0], frame_idx: 0, strength } };
      c = first;
      l = [first, 2];
    }
    out[last] = { class_type: 'LTXVAddGuide', inputs: { positive: [c, 0], negative: [c, 1], vae, latent: l, image: ['27', 0], frame_idx: -1, strength } };
    return last;
  };
  // Pass 1 (half size).
  const g1 = guides('60', '61', '12', ['30', 0], 0.7);
  out[33] = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: [g1, 2], audio_latent: ['32', 0] } };
  out[35] = { ...wf[35], inputs: { ...wf[35].inputs, positive: [g1, 0], negative: [g1, 1] } };
  out[62] = { class_type: 'LTXVCropGuides', inputs: { positive: [g1, 0], negative: [g1, 1], latent: ['39', 0] } };
  // Pass 2 (upscaled and refined), guided again at full size.
  out[40] = { ...wf[40], inputs: { ...wf[40].inputs, samples: ['62', 2] } };
  const g2 = guides('63', '64', '62', ['40', 0], 1);
  out[42] = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: [g2, 2], audio_latent: ['39', 1] } };
  out[44] = { ...wf[44], inputs: { ...wf[44].inputs, positive: [g2, 0], negative: [g2, 1] } };
  out[65] = { class_type: 'LTXVCropGuides', inputs: { positive: [g2, 0], negative: [g2, 1], latent: ['48', 0] } };
  out[50] = { ...wf[50], inputs: { ...wf[50].inputs, samples: ['65', 2] } };
  return out;
}

// ---------------------------------------------------------------- the maker store
// More makers you can install from Orbit (Create → Makers). Each lists the files it needs; files
// shared between makers are downloaded once. Recipes were checked against ComfyUI's own templates
// (Krea 2 turbo, MiniMax H3 text/image-to-video, Qwen Image 2.1 edit) on the pinned ComfyUI version.

const hf = (dir, name, repo, path, size) => ({ dir, name, repo, path, size });
export const FILES = {
  qwenUnet: STUDIO_FILES.image[0],
  qwenTe: STUDIO_FILES.image[1],
  qwenVae: STUDIO_FILES.image[2],
  noctReal: hf('diffusion_models', 'NoctQ_V4_int8_convrot.safetensors', 'Noctaluna/Noct-Q-Uncensored-Qwen-Image-2.1', 'NoctQ_V4_int8_convrot.safetensors', 7256784368),
  noctAnime: hf('diffusion_models', 'NoctQA_V1_int8_convrot.safetensors', 'Noctaluna/Noct-Q-Anime-Uncensored-Qwen-Image-2.1', 'NoctQA_V1_int8_convrot.safetensors', 7256784368),
  kreaNoct: hf('diffusion_models', 'KreaNoct_V4_int8_convrot.safetensors', 'Noctaluna/Krea2-Noct-Uncensored', 'KreaNoct_V4_int8_convrot.safetensors', 13492706520),
  kreaTe: hf('text_encoders', 'qwen3vl_4b_fp8_scaled.safetensors', 'Comfy-Org/Krea-2', 'text_encoders/qwen3vl_4b_fp8_scaled.safetensors', 5242467968),
  kreaVae: hf('vae', 'qwen_image_vae.safetensors', 'Comfy-Org/Krea-2', 'vae/qwen_image_vae.safetensors', 253806246),
  h3Unet: hf('diffusion_models', '10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors', 'TenStrip/10Eros-Max', '10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors', 20970414464),
  h3Te: hf('text_encoders', 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', 'Comfy-Org/MiniMax-H3', 'text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors', 27141342152),
  h3Vae: hf('vae', 'minimax_h3_video_vae_int8_convrot.safetensors', 'Comfy-Org/MiniMax-H3', 'vae/minimax_h3_video_vae_int8_convrot.safetensors', 2811065184),
  h3AudioVae: hf('vae', 'minimax_h3_audio_vae_fp32.safetensors', 'Comfy-Org/MiniMax-H3', 'vae/minimax_h3_audio_vae_fp32.safetensors', 605254808),
  esrgan: hf('upscale_models', 'RealESRGAN_x4plus.safetensors', 'Comfy-Org/Real-ESRGAN_repackaged', 'RealESRGAN_x4plus.safetensors', 66857836),
  outfitLora: hf('loras', 'qwen-image-2.1-outfit-swap.safetensors', 'ausboss/Qwen-Image-2.1-Outfit-Swap-Consistency-LoRA', 'qwen-image-2.1-outfit-swap.safetensors', 159436488),
  anglesLora: hf('loras', 'multiple_angles_step1000.safetensors', 'akhaliq/Qwen-Image-2.1-Multiple-Angles-LoRA', 'multiple_angles_step1000.safetensors', 159435968),
};
const kreaStyle = (id) => hf('loras', `krea2_${id}.safetensors`, 'Comfy-Org/Krea-2', `loras/krea2_${id}.safetensors`, 469291992);

const NOCT_NEGATIVE =
  'artifacts, gpt-image, washed-out colors, low quality, low resolution, AI slop, deviantart, sloppy lines, rough sketch, blurry, indistinct, missing fingers, badly drawn hands, wrong number of fingers';

/**
 * What can be installed. kind: image | video | edit | upscale makers, or style (a look for one maker).
 * `builtIn` makers are the ones the machine always downloads.
 */
export const MAKERS = [
  { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', blurb: 'All-rounder, great with text in pictures.', builtIn: true, files: ['qwenUnet', 'qwenTe', 'qwenVae'] },
  { id: 'qwen-real', kind: 'image', name: 'Qwen Real', blurb: 'Photoreal people and places (Noct-Q v4), uncensored.', files: ['noctReal', 'qwenTe', 'qwenVae'] },
  { id: 'anime', kind: 'image', name: 'Anime', blurb: 'Anime and illustration (Noct-Q Anime), uncensored.', files: ['noctAnime', 'qwenTe', 'qwenVae'] },
  { id: 'krea-real', kind: 'image', name: 'Krea Real', blurb: 'Krea 2 photoreal (Noct), fast 8 steps, uncensored.', files: ['kreaNoct', 'kreaTe', 'kreaVae'] },
  { id: 'ltx', kind: 'video', name: 'LTX 10Eros', blurb: 'Video with sound, uncensored.', builtIn: true, files: [] },
  { id: 'h3-max', kind: 'video', name: 'H3 Max', blurb: 'MiniMax H3 (10Eros Max): best motion, with sound, uncensored.', files: ['h3Unet', 'h3Te', 'h3Vae', 'h3AudioVae'] },
  { id: 'edit', kind: 'edit', name: 'Edit with words', blurb: 'Change a picture by describing it. Uses Qwen, no extra download.', builtIn: true, files: ['qwenUnet', 'qwenTe', 'qwenVae'] },
  { id: 'outfit', kind: 'edit', name: 'Outfit swap', blurb: 'Dress the person in picture 1 in the outfit from picture 2.', files: ['outfitLora', 'qwenUnet', 'qwenTe', 'qwenVae'], lora: 'outfitLora', twoImages: true },
  { id: 'angles', kind: 'edit', name: 'New angle', blurb: 'The same subject from another camera angle.', files: ['anglesLora', 'qwenUnet', 'qwenTe', 'qwenVae'], lora: 'anglesLora', trigger: '<mva>' },
  { id: 'sharpen', kind: 'upscale', name: 'Sharpen 4×', blurb: 'Makes a picture four times larger and crisper.', files: ['esrgan'] },
  ...[
    ['softwatercolor', 'Soft watercolor'],
    ['retroanime', 'Retro anime'],
    ['darkbrush', 'Dark brush'],
    ['neondrip', 'Neon drip'],
    ['vintagetarot', 'Vintage tarot'],
    ['rainywindow', 'Rainy window'],
    ['sunsetblur', 'Sunset blur'],
    ['dotmatrix', 'Dot matrix'],
    ['kidsdrawing', 'Crayon drawing'],
  ].map(([id, name]) => ({ id: `style-${id}`, kind: 'style', for: 'krea-real', name, blurb: `A ${name.toLowerCase()} look for Krea Real.`, files: [`style:${id}`], loraFile: kreaStyle(id) })),
];

// More makers and their files from the store's catalog (ai/gate/catalog.json, shared with Orbit's
// Store app). Each says which recipe it runs on: `workflow` qwen | krea | ltx | h3 (image/video),
// edits name their `lora`, styles are LoRAs `for` a maker with a `trigger`.
const CATALOG = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
for (const [key, f] of Object.entries(CATALOG.files || {})) if (!FILES[key]) FILES[key] = f;
for (const m of CATALOG.makerDefs || []) {
  if (MAKERS.some((x) => x.id === m.id)) continue;
  MAKERS.push(m.kind === 'style' ? { ...m, loraFile: FILES[m.files[0]] } : m);
}

/** Qwen Image 2.1 family (Qwen Uncensored, Qwen Real, Anime). */
export function qwenWorkflow({ unet, prompt, width = 1024, height = 1024, seed = randomSeed(), steps = 25, cfg = 1, negative = '', prefix = 'orbit/image' }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    2: { class_type: 'QwenImage21Cache', inputs: { model: ['1', 0], device: 'auto', dtype: 'default' } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: QWEN_TE, type: 'qwen_image', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: QWEN_VAE } },
    5: { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['3', 0], prompt, negative_prompt: negative, resolution: 1024 } },
    6: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    7: {
      class_type: 'KSampler',
      inputs: { model: ['2', 0], seed, steps, cfg, sampler_name: 'euler', scheduler: 'simple', positive: ['5', 0], negative: ['5', 1], latent_image: ['6', 0], denoise: 1 },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['4', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  };
}

/** Each Krea style only shows when its trigger words are in the prompt (ComfyUI's Krea 2 template). */
export const KREA_TRIGGERS = {
  darkbrush: 'monochrome ink wash style',
  dotmatrix: 'monochrome stippling style',
  kidsdrawing: 'naive expressive sketch style',
  neondrip: 'textured abstract style',
  rainywindow: 'rainy window style',
  retroanime: 'purple retro anime style',
  softwatercolor: 'art deco watercolor style',
  sunsetblur: 'ethereal motion blur style',
  vintagetarot: 'vintage tarot style',
};

/** Krea 2 (Krea Real), from ComfyUI's Krea 2 turbo template; `style` adds one of Krea's style LoRAs. */
export function kreaWorkflow({ prompt, width = 1024, height = 1536, seed = randomSeed(), style = null, trigger: styleTrigger = null, unet = FILES.kreaNoct.name, prefix = 'orbit/image' }) {
  const model = style ? ['11', 0] : ['1', 0];
  const trigger = styleTrigger || (style && KREA_TRIGGERS[/^krea2_(\w+)\.safetensors$/.exec(style)?.[1]]);
  const text = trigger ? `${prompt}, ${trigger}` : prompt;
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: FILES.kreaTe.name, type: 'krea2', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: FILES.kreaVae.name } },
    4: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text } },
    5: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    6: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    7: {
      class_type: 'KSampler',
      inputs: { model, seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], denoise: 1 },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
    ...(style ? { 11: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: style, strength_model: 1 } } } : {}),
  };
}

/** Frames for H3: about `seconds` at 24 fps, rounded the way ComfyUI's H3 template does (5 + 17k). */
export function h3Length(seconds) {
  const n = Math.max(5, Math.round(seconds * 24));
  return n + (((5 - (n % 17)) % 17) + 17) % 17;
}
export const H3_FPS = 24;

/** MiniMax H3 (H3 Max): text or picture to video with sound, from ComfyUI's H3 templates (turbo baked in: 8 steps). */
export function h3Workflow({ prompt, width = 1280, height = 704, seconds = 5, image = null, endImage = null, seed = randomSeed(), steps = 8, prefix = 'orbit/video', unet = FILES.h3Unet.name, turbo = null }) {
  // Models without the speed-up built in get the 8-step turbo LoRA.
  const model = turbo ? ['15', 0] : ['1', 0];
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: FILES.h3Te.name, type: 'minimax', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: FILES.h3Vae.name } },
    4: { class_type: 'VAELoader', inputs: { vae_name: FILES.h3AudioVae.name } },
    5: {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: { clip: ['2', 0], vae: ['3', 0], prompt, width, height, length: h3Length(seconds), ...(image ? { first_frame: ['21', 0] } : {}), ...(endImage ? { last_frame: ['23', 0] } : {}) },
    },
    6: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    7: { class_type: 'BasicGuider', inputs: { model, conditioning: ['5', 0] } },
    8: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    9: { class_type: 'BasicScheduler', inputs: { model, scheduler: 'simple', steps, denoise: 1 } },
    10: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['6', 0], guider: ['7', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['5', 1] } },
    11: { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    12: { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['4', 0] } },
    13: { class_type: 'CreateVideo', inputs: { images: ['11', 0], audio: ['12', 0], fps: H3_FPS } },
    14: { class_type: 'SaveVideo', inputs: { video: ['13', 0], filename_prefix: prefix, format: 'mp4', 'format.codec': 'h264' } },
    ...(turbo ? { 15: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: turbo, strength_model: 1 } } } : {}),
    ...(image
      ? {
          20: { class_type: 'LoadImage', inputs: { image } },
          // MiniMaxH3ImageToVideo stretches the picture to the video's size: crop it to that shape first.
          21: {
            class_type: 'ResizeImageMaskNode',
            inputs: { input: ['20', 0], resize_type: 'scale dimensions', 'resize_type.width': width, 'resize_type.height': height, 'resize_type.crop': 'center', scale_method: 'lanczos' },
          },
        }
      : {}),
    // soReal: the picture the clip lands on (MiniMaxH3ImageToVideo's own last_frame input).
    ...(endImage
      ? {
          22: { class_type: 'LoadImage', inputs: { image: endImage } },
          23: {
            class_type: 'ResizeImageMaskNode',
            inputs: { input: ['22', 0], resize_type: 'scale dimensions', 'resize_type.width': width, 'resize_type.height': height, 'resize_type.crop': 'center', scale_method: 'lanczos' },
          },
        }
      : {}),
  };
}

/** Qwen Image 2.1 edit: change pictures by describing it (from ComfyUI's Qwen Image 2.1 edit template). */
export function editWorkflow({ prompt, images, lora = null, strength = 1, seed = randomSeed(), steps = 25, prefix = 'orbit/image' }) {
  const refs = Object.fromEntries(images.map((_, i) => [`images.image_${i + 1}`, [String(30 + i), 0]]));
  const loads = Object.fromEntries(images.map((name, i) => [String(30 + i), { class_type: 'LoadImage', inputs: { image: name } }]));
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: QWEN_UNET, weight_dtype: 'default' } },
    2: { class_type: 'QwenImage21Cache', inputs: { model: lora ? ['10', 0] : ['1', 0], device: 'auto', dtype: 'default' } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: QWEN_TE, type: 'qwen_image', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: QWEN_VAE } },
    5: { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['3', 0], vae: ['4', 0], prompt, negative_prompt: '', resolution: 1024, ...refs } },
    7: {
      class_type: 'KSampler',
      inputs: { model: ['2', 0], seed, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['5', 0], negative: ['5', 1], latent_image: ['5', 2], denoise: 1 },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['4', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
    ...(lora ? { 10: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: lora, strength_model: strength } } } : {}),
    ...loads,
  };
}

/** Sharpen 4×: a classic upscaler (Real-ESRGAN), no prompt needed. */
export function upscaleWorkflow({ image, prefix = 'orbit/image', model = FILES.esrgan.name }) {
  return {
    1: { class_type: 'LoadImage', inputs: { image } },
    2: { class_type: 'UpscaleModelLoader', inputs: { model_name: model } },
    3: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
    4: { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: prefix } },
  };
}

export { NOCT_NEGATIVE };

// ---------------------------------------------------------------- video makers that take a video, a voice or a song
// LTX-2.5, Wan VACE (edit a video; erase from a video), Wan 2.2 S2V (talking or singing photo) and
// SeedVR2 (sharpen a video). Each recipe mirrors one of ComfyUI's own templates or blueprints at the
// pinned ComfyUI version (named on each function) and only uses core ComfyUI nodes. The gate prepares
// every video and sound file first (media.js: frame rate, size, length), so the numbers here are exact.

/** Wan's own negative prompt (ComfyUI's Wan 2.1 VACE and Wan 2.2 S2V templates). */
export const WAN_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';
const LTX25_NEGATIVE = 'pc game, console game, video game, cartoon, childish, ugly';
export const LTX25_FPS = 24;
/** LTX-2.5 makes seconds × 24 + 1 frames (8k + 1, as its templates do). */
export const ltx25Frames = (seconds) => Math.max(1, Math.round(seconds)) * LTX25_FPS + 1;
/** The distilled LTX-2.5 schedule (its templates' first pass). */
const LTX25_SIGMAS = [1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0];
/** Video to video: how much of the schedule runs; more is a bigger change (at least the last three steps). */
export function ltx25Restyle(strength = 0.9) {
  const from = Math.max(0.45, Math.min(1, Number(strength) || 0.9));
  return LTX25_SIGMAS.filter((s) => s <= from + 1e-9).join(', ');
}
const ltxResize = (input, width, height) => ({
  class_type: 'ResizeImageMaskNode',
  inputs: { input, resize_type: 'scale dimensions', 'resize_type.width': width, 'resize_type.height': height, 'resize_type.crop': 'center', scale_method: 'lanczos' },
});
const save = (video, prefix) => ({ class_type: 'SaveVideo', inputs: { video, filename_prefix: prefix, format: 'mp4', 'format.codec': 'h264' } });

/**
 * LTX-2.5 (gated on Hugging Face): video with sound.
 *  - text or picture to video: two passes (half size, then a 2× latent upscale and a short refine),
 *    from ComfyUI's "Text to Video (LTX-2.5)" and "Image to Video (LTX-2.5)" templates;
 *  - first and last frame: one full-size pass with LTXVAddGuide at frame 0 and the end, from
 *    "First & Last Frame to Video (LTX-2.5)";
 *  - video to video ("restyle"): the prepared clip is encoded (picture and sound) and only the end of
 *    the distilled schedule runs on it, so motion and timing stay while the look follows the prompt.
 *    Built from the same template's nodes; the original sound is kept.
 * The prompt enhancer of the templates (TextGenerateLTX2Prompt, an extra model) is left out, as in
 * their default setting.
 */
export function ltx25Workflow({ prompt, width = 1280, height = 704, seconds = 5, frames = null, image = null, endImage = null, video = null, strength = 0.9, seed = randomSeed(), prefix = 'orbit/video' }) {
  const length = frames || ltx25Frames(seconds);
  const wf = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: FILES.ltx25Unet.name, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: FILES.ltx25Te.name, type: 'ltxv', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: FILES.ltx25Vae.name } },
    4: { class_type: 'VAELoader', inputs: { vae_name: FILES.ltx25AudioVae.name } },
    10: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    11: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: LTX25_NEGATIVE } },
    12: { class_type: 'LTXVConditioning', inputs: { positive: ['10', 0], negative: ['11', 0], frame_rate: LTX25_FPS } },
    13: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    34: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    51: { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['39', 1], audio_vae: ['4', 0] } },
    52: { class_type: 'CreateVideo', inputs: { images: ['50', 0], audio: ['51', 0], fps: LTX25_FPS } },
    53: save(['52', 0], prefix),
  };
  const guider = (positive, negative) => ({ class_type: 'LTXVDualCFGGuider', inputs: { model: ['1', 0], positive, negative, video_cfg: 1, audio_cfg: 1 } });
  const decode = (samples) => ({ class_type: 'VAEDecodeTiled', inputs: { samples, vae: ['3', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } });

  if (video) {
    // Video to video: the clip (already width × height, `length` frames at 24 fps) and its sound.
    Object.assign(wf, {
      70: { class_type: 'LoadVideo', inputs: { file: video } },
      71: { class_type: 'GetVideoComponents', inputs: { video: ['70', 0] } },
      72: { class_type: 'VAEEncodeTiled', inputs: { pixels: ['71', 0], vae: ['3', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
      73: { class_type: 'LTXVAudioVAEEncode', inputs: { audio: ['71', 1], audio_vae: ['4', 0] } },
      33: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['72', 0], audio_latent: ['73', 0] } },
      35: guider(['12', 0], ['12', 1]),
      37: { class_type: 'ManualSigmas', inputs: { sigmas: ltx25Restyle(strength) } },
      38: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['34', 0], guider: ['35', 0], sampler: ['13', 0], sigmas: ['37', 0], latent_image: ['33', 0] } },
      39: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['38', 0] } },
      50: decode(['39', 0]),
    });
    // Keep the clip's own sound.
    delete wf[51];
    wf[52] = { class_type: 'CreateVideo', inputs: { images: ['50', 0], audio: ['71', 1], fps: LTX25_FPS } };
    return wf;
  }

  if (endImage) {
    // First and last frame: one pass at full size, as in the template.
    let cond = '12';
    let latent = ['30', 0];
    Object.assign(wf, {
      24: { class_type: 'LoadImage', inputs: { image: endImage } },
      25: ltxResize(['24', 0], width, height),
      27: { class_type: 'LTXVPreprocess', inputs: { image: ['25', 0], img_compression: 18 } },
      30: { class_type: 'EmptyLTXVLatentVideo', inputs: { width, height, length, batch_size: 1 } },
      32: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: length, frame_rate: LTX25_FPS, batch_size: 1, audio_vae: ['4', 0] } },
      36: { class_type: 'SamplerEulerAncestral', inputs: { eta: 0, s_noise: 1 } },
      37: { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_SIGMAS.join(', ') } },
    });
    if (image) {
      Object.assign(wf, {
        20: { class_type: 'LoadImage', inputs: { image } },
        21: ltxResize(['20', 0], width, height),
        23: { class_type: 'LTXVPreprocess', inputs: { image: ['21', 0], img_compression: 18 } },
        60: { class_type: 'LTXVAddGuide', inputs: { positive: ['12', 0], negative: ['12', 1], vae: ['3', 0], latent, image: ['23', 0], frame_idx: 0, strength: 0.7 } },
      });
      cond = '60';
      latent = ['60', 2];
    }
    Object.assign(wf, {
      61: { class_type: 'LTXVAddGuide', inputs: { positive: [cond, 0], negative: [cond, 1], vae: ['3', 0], latent, image: ['27', 0], frame_idx: -1, strength: 0.7 } },
      33: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['61', 2], audio_latent: ['32', 0] } },
      35: guider(['61', 0], ['61', 1]),
      38: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['34', 0], guider: ['35', 0], sampler: ['36', 0], sigmas: ['37', 0], latent_image: ['33', 0] } },
      39: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['38', 0] } },
      62: { class_type: 'LTXVCropGuides', inputs: { positive: ['61', 0], negative: ['61', 1], latent: ['39', 0] } },
      50: decode(['62', 2]),
    });
    return wf;
  }

  // Text or picture to video: two passes.
  const fromImage = Boolean(image);
  Object.assign(wf, {
    5: { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: FILES.ltx25Upscaler.name } },
    20: fromImage ? { class_type: 'LoadImage', inputs: { image } } : { class_type: 'EmptyImage', inputs: { width: 512, height: 512, batch_size: 1, color: 0 } },
    21: ltxResize(['20', 0], width, height),
    22: { class_type: 'ResizeImageMaskNode', inputs: { input: ['21', 0], resize_type: 'scale longer dimension', 'resize_type.longer_size': 1536, scale_method: 'lanczos' } },
    23: { class_type: 'LTXVPreprocess', inputs: { image: ['22', 0], img_compression: 18 } },
    30: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: Math.round(width / 2), height: Math.round(height / 2), length, batch_size: 1 } },
    31: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['3', 0], image: ['23', 0], latent: ['30', 0], strength: 0.7, bypass: !fromImage } },
    32: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: length, frame_rate: LTX25_FPS, batch_size: 1, audio_vae: ['4', 0] } },
    33: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['31', 0], audio_latent: ['32', 0] } },
    35: guider(['12', 0], ['12', 1]),
    37: { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_SIGMAS.join(', ') } },
    38: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['34', 0], guider: ['35', 0], sampler: ['13', 0], sigmas: ['37', 0], latent_image: ['33', 0] } },
    39: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['38', 0] } },
    40: { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['39', 0], upscale_model: ['5', 0], vae: ['3', 0] } },
    41: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['3', 0], image: ['23', 0], latent: ['40', 0], strength: 1, bypass: !fromImage } },
    42: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['41', 0], audio_latent: ['39', 1] } },
    44: guider(['12', 0], ['12', 1]),
    45: { class_type: 'RandomNoise', inputs: { noise_seed: 42 } },
    46: { class_type: 'ManualSigmas', inputs: { sigmas: '0.85, 0.7250, 0.4219, 0.0' } },
    47: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['45', 0], guider: ['44', 0], sampler: ['13', 0], sigmas: ['46', 0], latent_image: ['42', 0] } },
    48: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['47', 0] } },
    50: decode(['48', 0]),
  });
  wf[51] = { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['48', 1], audio_vae: ['4', 0] } };
  return wf;
}

/** Wan 2.2 S2V: one chunk is 77 frames at 16 fps (about 4.8 s), as in ComfyUI's template. */
export const S2V_FPS = 16;
export const S2V_CHUNK = 77;
/** How many chunks a voice or song of `seconds` needs (at most `max`). */
export const s2vChunks = (seconds, max = 4) => Math.max(1, Math.min(max, Math.ceil(((Number(seconds) || 0) * S2V_FPS) / S2V_CHUNK - 0.02)));

/**
 * Wan 2.2 S2V: a photo and a voice or song become a talking or singing video. From ComfyUI's
 * "video_wan2_2_14B_s2v" template (its 4-step LightX2V setting): the first chunk with
 * WanSoundImageToVideo, then WanSoundImageToVideoExtend chunks that follow the sound, joined along
 * time; the template's trick of repeating the first latent frame and dropping 3 frames is kept.
 */
export function s2vWorkflow({ prompt, image, audio, width = 640, height = 640, chunks = 1, seed = randomSeed(), prefix = 'orbit/video' }) {
  const ksampler = (id, cond, s) => ({
    class_type: 'KSampler',
    inputs: { model: ['3', 0], seed: s, steps: 4, cfg: 1, sampler_name: 'uni_pc', scheduler: 'simple', positive: [cond, 0], negative: [cond, 1], latent_image: [cond, 2], denoise: 1 },
  });
  const wf = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: FILES.s2vUnet.name, weight_dtype: 'default' } },
    2: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: FILES.s2vLora.name, strength_model: 1 } },
    3: { class_type: 'ModelSamplingSD3', inputs: { model: ['2', 0], shift: 8 } },
    4: { class_type: 'CLIPLoader', inputs: { clip_name: FILES.wanTe.name, type: 'wan', device: 'default' } },
    5: { class_type: 'VAELoader', inputs: { vae_name: FILES.wanVae.name } },
    6: { class_type: 'AudioEncoderLoader', inputs: { audio_encoder_name: FILES.wav2vec.name } },
    7: { class_type: 'LoadAudio', inputs: { audio } },
    8: { class_type: 'AudioEncoderEncode', inputs: { audio_encoder: ['6', 0], audio: ['7', 0] } },
    9: { class_type: 'LoadImage', inputs: { image } },
    10: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 0], text: prompt } },
    11: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 0], text: WAN_NEGATIVE } },
    12: {
      class_type: 'WanSoundImageToVideo',
      inputs: { positive: ['10', 0], negative: ['11', 0], vae: ['5', 0], width, height, length: S2V_CHUNK, batch_size: 1, audio_encoder_output: ['8', 0], ref_image: ['9', 0] },
    },
    13: ksampler('13', '12', seed),
  };
  let latent = '13';
  for (let i = 1; i < Math.max(1, chunks); i++) {
    const ext = String(20 + i * 3);
    const ks = String(21 + i * 3);
    const cat = String(22 + i * 3);
    wf[ext] = {
      class_type: 'WanSoundImageToVideoExtend',
      inputs: { positive: ['10', 0], negative: ['11', 0], vae: ['5', 0], length: S2V_CHUNK, video_latent: [latent, 0], audio_encoder_output: ['8', 0], ref_image: ['9', 0] },
    };
    wf[ks] = ksampler(ks, ext, seed + i);
    wf[cat] = { class_type: 'LatentConcat', inputs: { samples1: [latent, 0], samples2: [ks, 0], dim: 't' } };
    latent = cat;
  }
  Object.assign(wf, {
    90: { class_type: 'LatentCut', inputs: { samples: [latent, 0], dim: 't', index: 0, amount: 1 } },
    91: { class_type: 'LatentConcat', inputs: { samples1: ['90', 0], samples2: [latent, 0], dim: 't' } },
    92: { class_type: 'VAEDecode', inputs: { samples: ['91', 0], vae: ['5', 0] } },
    93: { class_type: 'ImageFromBatch', inputs: { image: ['92', 0], batch_index: 3, length: 4096 } },
    94: { class_type: 'CreateVideo', inputs: { images: ['93', 0], audio: ['7', 0], fps: S2V_FPS } },
    95: save(['94', 0], prefix),
  });
  return wf;
}

/** Wan VACE works at 16 fps; one run makes up to 81 frames (about 5 s), as in ComfyUI's templates. */
export const VACE_FPS = 16;
export const VACE_MAX_FRAMES = 81;
/** Extending: the last 17 frames of the clip lead into 64 new ones. */
export const VACE_EXTEND_KEEP = 17;
export const VACE_TASKS = ['replace', 'erase', 'restyle', 'extend', 'motion'];

/**
 * Wan 2.1 VACE 14B: edit a video. All tasks share the setup of ComfyUI's "Video Inpainting (Wan2.1
 * VACE)" blueprint (VACE 14B with the CausVid LoRA at 0.3, 6 steps, cfg 1, shift 5):
 *  - replace / erase: SAM 3.1 finds what the words name in every frame (that blueprint's own
 *    segmentation step), the mask grows by 20 px and VACE repaints it from the prompt;
 *  - restyle: the clip's edges (Canny) guide a new look (VACE's control-video mode);
 *  - motion: a photo's subject (reference image) moves like the clip (its edges guide);
 *  - extend: the last 17 frames lead and 64 new frames follow (control frames padded with grey and a
 *    mask of ones for the new part, as WanVaceToVideo does), then the clip and the new part are joined.
 * `video` is a prepared clip: `width` × `height`, `frames` frames at 16 fps, with a sound track.
 */
export function vaceWorkflow({ task, prompt, video, width, height, frames, target = '', reference = null, seed = randomSeed(), prefix = 'orbit/video' }) {
  if (!VACE_TASKS.includes(task)) throw new Error(`Unknown VACE task ${task}`);
  const extend = task === 'extend';
  const length = extend ? VACE_MAX_FRAMES : frames;
  const negative = task === 'erase' && target ? `${target}, ${WAN_NEGATIVE}` : WAN_NEGATIVE;
  const wf = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: FILES.vaceUnet.name, weight_dtype: 'fp8_e4m3fn' } },
    2: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: FILES.causvidLora.name, strength_model: 0.3 } },
    3: { class_type: 'ModelSamplingSD3', inputs: { model: ['2', 0], shift: 5 } },
    4: { class_type: 'CLIPLoader', inputs: { clip_name: FILES.wanTe.name, type: 'wan', device: 'default' } },
    5: { class_type: 'VAELoader', inputs: { vae_name: FILES.wanVae.name } },
    6: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 0], text: prompt } },
    7: { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 0], text: negative } },
    8: { class_type: 'LoadVideo', inputs: { file: video } },
    9: { class_type: 'GetVideoComponents', inputs: { video: ['8', 0] } },
    20: {
      class_type: 'WanVaceToVideo',
      inputs: { positive: ['6', 0], negative: ['7', 0], vae: ['5', 0], width, height, length, batch_size: 1, strength: 1 },
    },
    21: {
      class_type: 'KSampler',
      inputs: { model: ['3', 0], seed, steps: 6, cfg: 1, sampler_name: 'uni_pc', scheduler: 'simple', positive: ['20', 0], negative: ['20', 1], latent_image: ['20', 2], denoise: 1 },
    },
    22: { class_type: 'TrimVideoLatent', inputs: { samples: ['21', 0], trim_amount: ['20', 3] } },
    23: { class_type: 'VAEDecode', inputs: { samples: ['22', 0], vae: ['5', 0] } },
    24: { class_type: 'CreateVideo', inputs: { images: ['23', 0], audio: ['9', 1], fps: VACE_FPS } },
    25: save(['24', 0], prefix),
  };
  const vace = wf[20].inputs;
  if (task === 'replace' || task === 'erase') {
    Object.assign(wf, {
      30: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: FILES.sam3.name } },
      31: { class_type: 'CLIPTextEncode', inputs: { clip: ['30', 1], text: target } },
      32: { class_type: 'SAM3_Detect', inputs: { model: ['30', 0], image: ['9', 0], conditioning: ['31', 0], threshold: 0.5, refine_iterations: 2, individual_masks: false } },
      33: { class_type: 'GrowMask', inputs: { mask: ['32', 0], expand: 20, tapered_corners: true } },
      34: { class_type: 'InvertMask', inputs: { mask: ['33', 0] } },
      35: { class_type: 'MaskToImage', inputs: { mask: ['34', 0] } },
      36: { class_type: 'ImageCompositeMasked', inputs: { destination: ['9', 0], source: ['35', 0], x: 0, y: 0, resize_source: true, mask: ['33', 0] } },
    });
    vace.control_video = ['36', 0];
    vace.control_masks = ['33', 0];
  } else if (task === 'restyle' || task === 'motion') {
    wf[36] = { class_type: 'Canny', inputs: { image: ['9', 0], low_threshold: 0.4, high_threshold: 0.8 } };
    vace.control_video = ['36', 0];
  } else if (extend) {
    const keep = VACE_EXTEND_KEEP;
    Object.assign(wf, {
      40: { class_type: 'ImageFromBatch', inputs: { image: ['9', 0], batch_index: -keep, length: keep } },
      41: { class_type: 'SolidMask', inputs: { value: 0, width, height } },
      42: { class_type: 'MaskToImage', inputs: { mask: ['41', 0] } },
      43: { class_type: 'RepeatImageBatch', inputs: { image: ['42', 0], amount: keep } },
      44: { class_type: 'ImageToMask', inputs: { image: ['43', 0], channel: 'red' } },
      // The new frames only (the first 17 repeat the clip's end), after the whole clip.
      45: { class_type: 'ImageFromBatch', inputs: { image: ['23', 0], batch_index: keep, length: 4096 } },
      46: { class_type: 'BatchImagesNode', inputs: { 'images.image0': ['9', 0], 'images.image1': ['45', 0] } },
    });
    vace.control_video = ['40', 0];
    vace.control_masks = ['44', 0];
    wf[24] = { class_type: 'CreateVideo', inputs: { images: ['46', 0], audio: ['9', 1], fps: VACE_FPS } };
  }
  if (reference && (task === 'replace' || task === 'motion')) {
    wf[50] = { class_type: 'LoadImage', inputs: { image: reference } };
    vace.reference_image = ['50', 0];
  }
  return wf;
}

/**
 * SeedVR2 3B: sharpen and enlarge a finished video 2× (sound and frame rate kept). From ComfyUI's
 * "Upscale Video (SeedVR2 3B Int8)" blueprint, with its temporal chunking switched on ("auto": as many
 * frames at a time as fit in the GPU) so long clips don't run out of memory.
 */
export function seedvr2Workflow({ video, multiplier = 2, seed = randomSeed(), prefix = 'orbit/video' }) {
  return {
    1: { class_type: 'LoadVideo', inputs: { file: video } },
    2: { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
    3: { class_type: 'ResizeImageMaskNode', inputs: { input: ['2', 0], resize_type: 'scale by multiplier', 'resize_type.multiplier': multiplier, scale_method: 'lanczos' } },
    4: { class_type: 'SeedVR2Preprocess', inputs: { resized_images: ['3', 0] } },
    5: { class_type: 'VAELoader', inputs: { vae_name: FILES.seedvr2Vae.name } },
    6: { class_type: 'UNETLoader', inputs: { unet_name: FILES.seedvr2.name, weight_dtype: 'default' } },
    7: { class_type: 'VAEEncodeTiled', inputs: { pixels: ['4', 0], vae: ['5', 0], tile_size: 512, overlap: 128, temporal_size: 64, temporal_overlap: 8 } },
    8: { class_type: 'SeedVR2TemporalChunk', inputs: { latent: ['7', 0], temporal_overlap: 0, chunking_mode: 'auto' } },
    9: { class_type: 'SeedVR2Conditioning', inputs: { model: ['6', 0], vae_conditioning: ['8', 0] } },
    10: {
      class_type: 'KSampler',
      inputs: { model: ['6', 0], seed, steps: 1, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['9', 0], negative: ['9', 1], latent_image: ['8', 0], denoise: 1 },
    },
    11: { class_type: 'SeedVR2TemporalMerge', inputs: { latents: ['10', 0], temporal_overlap: ['8', 1] } },
    12: { class_type: 'VAEDecodeTiled', inputs: { samples: ['11', 0], vae: ['5', 0], tile_size: 512, overlap: 128, temporal_size: 64, temporal_overlap: 8 } },
    13: { class_type: 'SeedVR2PostProcessing', inputs: { images: ['12', 0], original_resized_images: ['3', 0], color_correction_method: 'none' } },
    14: { class_type: 'CreateVideo', inputs: { images: ['13', 0], audio: ['2', 1], fps: ['2', 2] } },
    15: save(['14', 0], prefix),
  };
}
