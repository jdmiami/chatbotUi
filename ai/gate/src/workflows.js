// ComfyUI job recipes (API format) for the AI machine's image and video makers. Built from the
// official ComfyUI templates (Qwen-Image 2.1 text-to-image, LTX-2.3 text/image-to-video), using
// only core ComfyUI nodes, with the uncensored model files listed in STUDIO_FILES.

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
export function videoWorkflow({ prompt, width = 1280, height = 720, seconds = 5, image = null, seed = randomSeed(), prefix = 'orbit/video' }) {
  const frames = Math.round(seconds * VIDEO_FPS) + 1;
  const fromImage = Boolean(image);
  return {
    // Models
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: LTX_CKPT } },
    2: { class_type: 'LTXAVTextEncoderLoader', inputs: { text_encoder: LTX_TE, ckpt_name: LTX_CKPT, device: 'default' } },
    3: { class_type: 'LTXVAudioVAELoader', inputs: { ckpt_name: LTX_CKPT } },
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
    35: { class_type: 'CFGGuider', inputs: { model: ['4', 0], positive: ['12', 0], negative: ['12', 1], cfg: 1 } },
    36: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    37: { class_type: 'ManualSigmas', inputs: { sigmas: '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' } },
    38: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['34', 0], guider: ['35', 0], sampler: ['36', 0], sigmas: ['37', 0], latent_image: ['33', 0] } },
    39: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['38', 0] } },

    // Pass 2: upscale 2x and refine
    40: { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['39', 0], upscale_model: ['6', 0], vae: ['1', 2] } },
    41: { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['1', 2], image: ['23', 0], latent: ['40', 0], strength: 1, bypass: !fromImage } },
    42: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['41', 0], audio_latent: ['39', 1] } },
    43: { class_type: 'LTXVCropGuides', inputs: { positive: ['12', 0], negative: ['12', 1], latent: ['39', 0] } },
    44: { class_type: 'CFGGuider', inputs: { model: ['5', 0], positive: ['43', 0], negative: ['43', 1], cfg: 1 } },
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
}
