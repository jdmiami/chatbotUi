"""Live Draw's drawing engines: a sketch (plus colour, a kept picture, a mask, regions, a pose, a style
reference) and a few words become a picture in a fraction of a second, on the drawing machine's
graphics card. Also the sketch reader (what is this drawing?).

Runs in the studio's Python (ai/studio.sh: torch 2.11 cu128, diffusers, peft, transformers), started
by the gate (src/canvas.js through src/live.js createLiveWorker) and stopped after quiet minutes.

MODELS AND LICENCES (as stated on each model's Hugging Face card or repository, checked 2026-10-23)

  engine "fast" (the owner's own use; NOT for studio members)
    stabilityai/sd-turbo                    Stability AI Community License (the repo's LICENSE.md; the card
                                            has no licence tag and says "for commercial use, please refer
                                            to stability.ai/license"): free for research and non-commercial
                                            use; commercial use only after registering with Stability AI,
                                            under USD 1M annual revenue, with "Powered by Stability AI".
                                            ** NOT freely usable commercially. **
    pix2pix-turbo sketch LoRA               MIT (github.com/GaParmar/img2img-turbo LICENSE; the file comes
      (sketch_to_image_stochastic_lora.pkl)  from cs.cmu.edu/~img2img-turbo). It is a LoRA on SD-Turbo, so
                                            SD-Turbo's licence above still governs what it makes.
    madebyollin/taesd                       MIT

  engine "licensed" (studio members)
    stable-diffusion-v1-5/stable-diffusion-v1-5   CreativeML OpenRAIL-M (commercial use allowed; its use
                                                  restrictions must be passed on to users)
    latent-consistency/lcm-lora-sdv1-5            OpenRAIL++ (commercial use allowed, use restrictions)
    lllyasviel/control_v11p_sd15_lineart          OpenRAIL (card: "license: openrail")
    lllyasviel/control_v11p_sd15_openpose         OpenRAIL
    h94/IP-Adapter (models/ip-adapter_sd15.safetensors and models/image_encoder, an OpenCLIP ViT-H/14)
                                                  Apache-2.0
    madebyollin/taesd                             MIT

  sketch reader
    microsoft/Florence-2-large                    MIT. Its weights are loaded from
                                                  florence-community/Florence-2-large (MIT; the same weights
                                                  converted for transformers' own Florence2 class, pinned to
                                                  commit 4271c66b in the catalog), so no remote code runs:
                                                  trust_remote_code is not needed (transformers >= 4.57).

  Nothing above is "non-commercial only" except SD-Turbo (and so the whole "fast" engine).

PROTOCOL (one JSON object per line; images are base64 PNG/WebP/JPEG bytes, a data-URL prefix is
tolerated)
  stdout first: {"loading": "..."} lines, then {"ready": true} once Python and torch are up (no engine
  is loaded yet). Engine progress: {"engine": "fast", "state": "loading"|"ready"|"error", "error"?}
  and {"loading": "...", "engine": "..."}.
  requests on stdin -> answers on stdout:
    {"id", "op": "load", "engine": "fast"|"licensed"|"reader"}       -> {"id", "ok": true}
    {"id", "op": "frame", "engine", "mode": "live"|"paint", "prompt", "seed", "follow" 0..1,
     "strength" 0..1, "size" 512|768|1024, "sketch", "color"?, "base"?, "mask"?,
     "regions"?: [{"mask", "prompt"}], "pose"?, "ref"?: {"image", "weight"}}
                                                                     -> {"id", "image": <base64 WEBP>, "ms"}
    {"id", "op": "read", "image"}                                    -> {"id", "guesses": [{"label", "prompt"}]}
  or {"id", "error": "...", "user"?: true} ("user": a plain message for the person, e.g. "Pose works with
  the Members engine."; without it the error is a fault). Loads, frames and reads run on their own
  threads, so loading one engine never stalls the other engine's frames.

HOW EACH FRAME IS MADE
  fast, sketch only:        pix2pix-turbo exactly as live_draw_worker.py (one step, r = 0.25 + 0.6 x follow).
  fast, colour or base:     SD-Turbo img2img (one step; strength = "strength") on the composite: the base
                            picture (or white), then the colour layer, then the sketch strokes.
  licensed, sketch only:    SD 1.5 + LCM-LoRA (fused, 4 steps, no CFG) + ControlNet line art; the sketch
                            becomes white lines on black, "follow" is the conditioning scale.
  licensed, colour or base: the same as ControlNet img2img on the composite (at least 2 LCM steps).
  pose (licensed only):     a second ControlNet (openpose) on the skeleton picture, scale 1.
  ref (licensed only):      IP-Adapter (sd15) with the given weight; loaded on first use, then kept.
  regions (both):           sequential masked passes: after the main picture, each region is run again
                            as img2img with its own words (strength >= 0.55) and pasted back inside its
                            feathered mask. Simple, correct for any number of regions, one extra pass each.
  paint (both):             the result is pasted into "base" only inside the feathered "mask".
  Fast + pose / ref answer a clear error ("Pose works with the Members engine.") instead of ignoring it.
  Working size: 512 for fast (SD-Turbo's size); licensed 512, or 768 for sizes 768/1024; the picture
  is then resized to "size". The img2img and ControlNet pipelines decode with TAESD (tiny VAE);
  pix2pix-turbo keeps its own VAE (its skip connections are part of the model).

SPEED: plain diffusers with StreamDiffusion's main tricks: prompt embeddings cached per prompt, TAESD,
LCM-LoRA fused into the UNet, one-step SD-Turbo, channels-last, TF32; CANVAS_COMPILE=1 also runs
torch.compile on the img2img/ControlNet UNets (slower start). The StreamDiffusion package itself is
not used: it pins an old diffusers and is not built for torch 2.11 / Blackwell.

MODEL FILES come only from the studio's catalog (catalog.json; studio.js downloads them into
$STUDIO_DIR/models, which is the drive): makers "canvas-fast" (Live draw's SD-Turbo + pix2pix-turbo
files and TAESD), "canvas-licensed" and "canvas-reader". This worker never downloads anything
(HF_HUB_OFFLINE=1) and never uses a Hugging Face cache: it loads plain folders under CANVAS_MODELS
(default $STUDIO_DIR/models) and answers "not on this machine yet" when a file is missing.

SMOKE TEST on the pod (studio venv):  $STUDIO_DIR/venv/bin/python canvas_worker.py --selftest
  (or --selftest fast / licensed / reader). It loads each engine, makes frames with dummy drawings
  (sketch only, colour, paint with a mask, a region, a pose and a style reference on licensed), reads a
  sketch, prints one JSON line per check with its time, and exits 1 on any failure. CANVAS_DEVICE=cpu
  runs it without a graphics card (slow; about 16 GB of memory). The makers' files must be in place.
"""
import base64
import collections
import copy
import glob
import hashlib
import io
import json
import math
import os
import queue
import sys
import threading
import time

SELFTEST = "--selftest" in sys.argv

# Everything is read from the studio's model folders: nothing is fetched from the internet here.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
# Progress goes out as {"loading"} lines, not as progress bars on stderr.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")

_out_lock = threading.Lock()


def say(obj):
    with _out_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def progress(engine, text):
    say({"loading": str(text)[:200], **({"engine": engine} if engine else {})})


progress(None, "Starting the drawing engines")

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

# ---------------------------------------------------------------- device

if os.environ.get("CANVAS_DEVICE") == "cpu":
    DEVICE = torch.device("cpu")
elif torch.cuda.is_available():
    DEVICE = torch.device("cuda")
elif SELFTEST:
    DEVICE = torch.device("cpu")
else:
    sys.stderr.write("The drawing engines need the graphics card (CUDA is not available)\n")
    sys.exit(3)
GPU = DEVICE.type == "cuda"
DTYPE = torch.float16 if GPU else torch.float32
# pix2pix-turbo runs in fp32 like Live draw (live_draw_worker.py); CANVAS_P2P_FP16=1 halves it.
P2P_DTYPE = torch.float16 if GPU and os.environ.get("CANVAS_P2P_FP16") == "1" else torch.float32
COMPILE = GPU and os.environ.get("CANVAS_COMPILE") == "1"
# The size the models work at (CANVAS_WORK_SIZE overrides, e.g. 256 for a quick CPU self-test).
WORK_OVERRIDE = int(os.environ.get("CANVAS_WORK_SIZE") or 0)
if GPU:
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True

# The studio's model folders (catalog.json "dir" values), on the drive.
MODELS = os.environ.get("CANVAS_MODELS") or os.path.join(os.environ.get("STUDIO_DIR") or "/workspace/studio", "models")
SD_TURBO = os.environ.get("CANVAS_SD_TURBO") or os.path.join(MODELS, "live", "sd-turbo")
P2P_LORA = os.environ.get("CANVAS_P2P_LORA") or os.path.join(MODELS, "live", "pix2pix-turbo", "sketch_to_image_stochastic_lora.pkl")
CANVAS = os.path.join(MODELS, "live", "canvas")
SD15 = os.path.join(CANVAS, "sd15")
LCM_LORA = os.path.join(CANVAS, "lcm-lora-sdv1-5")
CN_LINEART = os.path.join(CANVAS, "control_v11p_sd15_lineart")
CN_OPENPOSE = os.path.join(CANVAS, "control_v11p_sd15_openpose")
IP_ADAPTER = os.path.join(CANVAS, "ip-adapter")
TAESD = os.path.join(CANVAS, "taesd")
FLORENCE = os.path.join(CANVAS, "florence-2-large")

FP16 = lambda sub="", name="diffusion_pytorch_model": [f"{sub}/config.json".lstrip("/"), f"{sub}/{name}.fp16.safetensors".lstrip("/")]  # noqa: E731
TOKENIZER = ["tokenizer/merges.txt", "tokenizer/special_tokens_map.json", "tokenizer/tokenizer_config.json", "tokenizer/vocab.json"]


class UserError(Exception):
    """A plain message for the person drawing (shown as is)."""


# ---------------------------------------------------------------- model files


def local(folder, files, label, maker):
    """A model's folder from the studio's catalog, once every file it needs is there."""
    missing = [f for f in files if not (glob.glob(os.path.join(folder, f)) if any(c in f for c in "*?[") else os.path.isfile(os.path.join(folder, f)))]
    if missing:
        raise RuntimeError(f"{label} is not on this machine yet ({missing[0]} is missing): the studio downloads it with the {maker} maker")
    return folder


# ---------------------------------------------------------------- pictures


def open_image(data):
    if not isinstance(data, str) or not data:
        raise UserError("A picture is missing.")
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    try:
        img = Image.open(io.BytesIO(base64.b64decode(data)))
        img.load()
    except Exception as err:  # noqa: BLE001
        raise UserError("That is not a picture.") from err
    return img


def rgba(img, w):
    img = img.convert("RGBA")
    return img if img.size == (w, w) else img.resize((w, w), Image.LANCZOS)


def flat(img, w, bg=(255, 255, 255)):
    """A picture on a plain background (transparent parts become `bg`)."""
    out = Image.new("RGBA", (w, w), bg + (255,))
    out.alpha_composite(rgba(img, w))
    return out.convert("RGB")


def line_mask(sketch, w):
    """The strokes of a sketch as an L picture (255 = line). Strokes on transparent, or dark lines on white."""
    s = rgba(sketch, w)
    a = np.asarray(s.getchannel("A"))
    if a.min() >= 250:  # no transparency: dark is line
        lum = np.asarray(s.convert("L"))
        m = lum < 128
    else:
        m = a > 90
    return Image.fromarray((m * 255).astype(np.uint8), "L")


def soft_mask(img, w):
    """White = may change; transparency counts as "no". Feathered so pasted edges don't show."""
    m = rgba(img, w)
    lum = np.asarray(m.convert("L"), dtype=np.float32)
    a = np.asarray(m.getchannel("A"), dtype=np.float32) / 255.0
    out = Image.fromarray(np.clip(lum * a, 0, 255).astype(np.uint8), "L")
    return out.filter(ImageFilter.GaussianBlur(max(2, w // 96)))


def composite(base, color, sketch, w):
    """The canvas as it looks: the base picture (or white), the colour blocks, then the strokes."""
    out = Image.new("RGBA", (w, w), (255, 255, 255, 255))
    if base is not None:
        out.alpha_composite(rgba(base, w))
    if color is not None:
        out.alpha_composite(rgba(color, w))
    out.alpha_composite(rgba(sketch, w))
    return out.convert("RGB")


def webp(img):
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=85, method=2)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def lru_get(cache, key, make, limit=32):
    if key in cache:
        cache.move_to_end(key)
        return cache[key]
    val = make()
    cache[key] = val
    while len(cache) > limit:
        cache.popitem(last=False)
    return val


def gen(seed):
    return torch.Generator(device=DEVICE).manual_seed(int(seed) % (2**31))


def maybe_compile(module):
    if not COMPILE:
        return module
    return torch.compile(module, mode="max-autotune-no-cudagraphs", fullgraph=False)


def tiny_vae(engine):
    root = local(TAESD, ["config.json", "diffusion_pytorch_model.safetensors"], "The tiny decoder (TAESD)", f"canvas-{engine}")
    from diffusers import AutoencoderTiny

    return AutoencoderTiny.from_pretrained(root, torch_dtype=DTYPE).to(DEVICE)


# ---------------------------------------------------------------- engine "fast": pix2pix-turbo + SD-Turbo img2img


# ---- from img2img-turbo (src/model.py; MIT, Copyright (c) 2024 img-to-img-turbo), as live_draw_worker.py
def my_vae_encoder_fwd(self, sample):
    sample = self.conv_in(sample)
    l_blocks = []
    for down_block in self.down_blocks:
        l_blocks.append(sample)
        sample = down_block(sample)
    sample = self.mid_block(sample)
    sample = self.conv_norm_out(sample)
    sample = self.conv_act(sample)
    sample = self.conv_out(sample)
    self.current_down_blocks = l_blocks
    return sample


def my_vae_decoder_fwd(self, sample, latent_embeds=None):
    sample = self.conv_in(sample)
    upscale_dtype = next(iter(self.up_blocks.parameters())).dtype
    sample = self.mid_block(sample, latent_embeds)
    sample = sample.to(upscale_dtype)
    skip_convs = [self.skip_conv_1, self.skip_conv_2, self.skip_conv_3, self.skip_conv_4]
    for idx, up_block in enumerate(self.up_blocks):
        skip_in = skip_convs[idx](self.incoming_skip_acts[::-1][idx] * self.gamma)
        sample = sample + skip_in
        sample = up_block(sample, latent_embeds)
    if latent_embeds is None:
        sample = self.conv_norm_out(sample)
    else:
        sample = self.conv_norm_out(sample, latent_embeds)
    sample = self.conv_act(sample)
    sample = self.conv_out(sample)
    return sample


# ---- from img2img-turbo (src/pix2pix_turbo.py)
class TwinConv(torch.nn.Module):
    def __init__(self, convin_pretrained, convin_curr):
        super().__init__()
        self.conv_in_pretrained = copy.deepcopy(convin_pretrained)
        self.conv_in_curr = copy.deepcopy(convin_curr)
        self.r = None

    def forward(self, x):
        x1 = self.conv_in_pretrained(x).detach()
        x2 = self.conv_in_curr(x)
        return x1 * (1 - self.r) + x2 * (self.r)


def sd_turbo_root():
    files = ["scheduler/scheduler_config.json", *FP16("unet"), *FP16("vae"), "text_encoder/config.json", "text_encoder/model.fp16.safetensors", *TOKENIZER]
    return local(SD_TURBO, files, "SD-Turbo", "canvas-fast")


class Fast:
    name = "fast"
    work = 512

    def __init__(self):
        from diffusers import AutoencoderKL, DDPMScheduler, EulerDiscreteScheduler, StableDiffusionImg2ImgPipeline, UNet2DConditionModel
        from peft import LoraConfig
        from transformers import CLIPTextModel, CLIPTokenizer

        e = self.name
        root = sd_turbo_root()
        if not os.path.isfile(P2P_LORA):
            raise RuntimeError("The pix2pix-turbo sketch LoRA is not on this machine yet: the studio downloads it with the canvas-fast maker")
        lora = P2P_LORA
        fp16 = {"variant": "fp16"}
        progress(e, "Loading the text encoder")
        self.tokenizer = CLIPTokenizer.from_pretrained(root, subfolder="tokenizer")
        self.text_encoder = CLIPTextModel.from_pretrained(root, subfolder="text_encoder", torch_dtype=DTYPE, **fp16).to(DEVICE)
        self.text_encoder.requires_grad_(False)

        # pix2pix-turbo, as live_draw_worker.py loads it
        progress(e, "Loading pix2pix-turbo")
        sched = DDPMScheduler.from_pretrained(root, subfolder="scheduler")
        sched.set_timesteps(1, device=DEVICE)
        sched.alphas_cumprod = sched.alphas_cumprod.to(DEVICE)
        self.sched = sched
        vae = AutoencoderKL.from_pretrained(root, subfolder="vae", torch_dtype=torch.float32, **fp16)
        vae.encoder.forward = my_vae_encoder_fwd.__get__(vae.encoder, vae.encoder.__class__)
        vae.decoder.forward = my_vae_decoder_fwd.__get__(vae.decoder, vae.decoder.__class__)
        vae.decoder.skip_conv_1 = torch.nn.Conv2d(512, 512, kernel_size=(1, 1), stride=(1, 1), bias=False)
        vae.decoder.skip_conv_2 = torch.nn.Conv2d(256, 512, kernel_size=(1, 1), stride=(1, 1), bias=False)
        vae.decoder.skip_conv_3 = torch.nn.Conv2d(128, 512, kernel_size=(1, 1), stride=(1, 1), bias=False)
        vae.decoder.skip_conv_4 = torch.nn.Conv2d(128, 256, kernel_size=(1, 1), stride=(1, 1), bias=False)
        vae.decoder.ignore_skip = False
        unet = UNet2DConditionModel.from_pretrained(root, subfolder="unet", torch_dtype=torch.float32, **fp16)
        unet.conv_in = TwinConv(copy.deepcopy(unet.conv_in), unet.conv_in)
        # Plain tensors, lists and numbers only: loaded without running any code from the file.
        sd = torch.load(lora, map_location="cpu", weights_only=True)
        vae.add_adapter(LoraConfig(r=sd["rank_vae"], init_lora_weights="gaussian", target_modules=sd["vae_lora_target_modules"]), adapter_name="vae_skip")
        _sd_vae = vae.state_dict()
        for k in sd["state_dict_vae"]:
            _sd_vae[k] = sd["state_dict_vae"][k]
        vae.load_state_dict(_sd_vae)
        unet.add_adapter(LoraConfig(r=sd["rank_unet"], init_lora_weights="gaussian", target_modules=sd["unet_lora_target_modules"]))
        _sd_unet = unet.state_dict()
        for k in sd["state_dict_unet"]:
            _sd_unet[k] = sd["state_dict_unet"][k]
        unet.load_state_dict(_sd_unet)
        del sd
        unet.to(DEVICE, dtype=P2P_DTYPE)
        vae.to(DEVICE)  # fp32: SD VAEs are unreliable in fp16
        for m in (unet, vae):
            m.eval()
            m.requires_grad_(False)
        vae.decoder.gamma = 1
        self.p2p_unet, self.p2p_vae = unet, vae
        self.timesteps = torch.tensor([999], device=DEVICE).long()

        # SD-Turbo img2img (colour, a kept picture, regions): a clean UNet and the tiny VAE
        progress(e, "Loading SD-Turbo img2img")
        unet2 = UNet2DConditionModel.from_pretrained(root, subfolder="unet", torch_dtype=DTYPE, **fp16).to(DEVICE)
        if GPU:
            unet2.to(memory_format=torch.channels_last)
        self.img2img = StableDiffusionImg2ImgPipeline(
            vae=tiny_vae(e),
            text_encoder=self.text_encoder,
            tokenizer=self.tokenizer,
            unet=maybe_compile(unet2),
            scheduler=EulerDiscreteScheduler.from_pretrained(root, subfolder="scheduler"),
            safety_checker=None,
            feature_extractor=None,
            requires_safety_checker=False,
        )
        self.img2img.set_progress_bar_config(disable=True)
        self.prompts = collections.OrderedDict()
        progress(e, "Warming up")
        blank = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        self.frame({"prompt": "a picture", "seed": 0, "follow": 0.5, "strength": 0.5, "size": 512}, {"sketch": blank})
        self.frame({"prompt": "a picture", "seed": 0, "follow": 0.5, "strength": 0.5, "size": 512}, {"sketch": blank, "color": Image.new("RGB", (64, 64), (200, 100, 50))})

    def embeds(self, prompt):
        return lru_get(self.prompts, prompt, lambda: self.img2img.encode_prompt(prompt, DEVICE, 1, False)[0])

    @torch.inference_mode()
    def pix2pix(self, prompt, lines, r, seed, w):
        # The lines as dark on white, then (from img2img-turbo's inference_paired.py) dark = line.
        img = Image.merge("RGB", [Image.eval(lines, lambda v: 255 - v)] * 3)
        c_t = (torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1) < 0.5).unsqueeze(0).to(DEVICE).float()
        noise = torch.randn((1, 4, w // 8, w // 8), device=DEVICE, generator=gen(seed))
        caption_enc = self.embeds(prompt).to(P2P_DTYPE)
        unet, vae = self.p2p_unet, self.p2p_vae
        from diffusers.utils.peft_utils import set_weights_and_activate_adapters

        # from img2img-turbo (Pix2Pix_Turbo.forward, deterministic=False): r blends the drawing with noise
        unet.set_adapters(["default"], weights=[r])
        set_weights_and_activate_adapters(vae, ["vae_skip"], [r])
        encoded_control = vae.encode(c_t).latent_dist.sample() * vae.config.scaling_factor
        unet_input = encoded_control * r + noise * (1 - r)
        unet.conv_in.r = r
        unet_output = unet(unet_input.to(P2P_DTYPE), self.timesteps, encoder_hidden_states=caption_enc).sample
        unet.conv_in.r = None
        x_denoised = self.sched.step(unet_output.float(), self.timesteps, unet_input, return_dict=True).prev_sample
        vae.decoder.incoming_skip_acts = vae.encoder.current_down_blocks
        vae.decoder.gamma = r
        out = vae.decode(x_denoised.float() / vae.config.scaling_factor).sample.clamp(-1, 1)
        arr = ((out[0].float().cpu() * 0.5 + 0.5).clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype(np.uint8)
        return Image.fromarray(arr, "RGB")

    @torch.inference_mode()
    def turbo(self, prompt, image, strength, seed):
        s = min(1.0, max(0.05, float(strength)))
        # SD-Turbo makes its picture in one step: enough steps that steps x strength rounds to one.
        steps = max(1, math.ceil(1.0 / s))
        return self.img2img(
            prompt_embeds=self.embeds(prompt), image=image, strength=s, num_inference_steps=steps, guidance_scale=0.0, generator=gen(seed)
        ).images[0]

    def frame(self, req, L):
        if L.get("pose") is not None:
            raise UserError("Pose works with the Members engine.")
        if L.get("ref") is not None:
            raise UserError("Style reference works with the Members engine.")
        w = WORK_OVERRIDE or self.work
        prompt, seed = req["prompt"], req["seed"]
        lines = line_mask(L["sketch"], w)
        if L.get("color") is None and L.get("base") is None:
            out = self.pix2pix(prompt, lines, round(0.25 + 0.6 * req["follow"], 2), seed, w)
        else:
            out = self.turbo(prompt, composite(L.get("base"), L.get("color"), L["sketch"], w), req["strength"], seed)
        for i, (mask, words) in enumerate(L.get("regions") or []):
            redo = self.turbo(words, out, max(0.55, req["strength"]), seed + 1 + i)
            out = Image.composite(redo, out, soft_mask(mask, w))
        return out


# ---------------------------------------------------------------- engine "licensed": SD 1.5 + LCM-LoRA + ControlNet


class Licensed:
    name = "licensed"

    def __init__(self):
        from diffusers import ControlNetModel, LCMScheduler, StableDiffusionControlNetPipeline, UNet2DConditionModel
        from transformers import CLIPTextModel, CLIPTokenizer

        e = self.name
        m = "canvas-licensed"
        sd_root = local(SD15, ["scheduler/scheduler_config.json", *FP16("unet"), "text_encoder/config.json", "text_encoder/model.fp16.safetensors", *TOKENIZER], "Stable Diffusion 1.5", m)
        lcm_root = local(LCM_LORA, ["pytorch_lora_weights.safetensors"], "LCM-LoRA", m)
        line_root = local(CN_LINEART, FP16(), "ControlNet line art", m)
        pose_root = local(CN_OPENPOSE, FP16(), "ControlNet pose", m)
        fp16 = {"variant": "fp16"}
        progress(e, "Loading Stable Diffusion 1.5")
        unet = UNet2DConditionModel.from_pretrained(sd_root, subfolder="unet", torch_dtype=DTYPE, **fp16)
        text_encoder = CLIPTextModel.from_pretrained(sd_root, subfolder="text_encoder", torch_dtype=DTYPE, **fp16)
        vae = tiny_vae(e)
        progress(e, "Loading the ControlNets")
        self.lineart = ControlNetModel.from_pretrained(line_root, torch_dtype=DTYPE, **fp16).to(DEVICE)
        self.openpose = ControlNetModel.from_pretrained(pose_root, torch_dtype=DTYPE, **fp16).to(DEVICE)
        self.pipe = StableDiffusionControlNetPipeline(
            vae=vae,
            text_encoder=text_encoder,
            tokenizer=CLIPTokenizer.from_pretrained(sd_root, subfolder="tokenizer"),
            unet=unet,
            controlnet=self.lineart,
            scheduler=LCMScheduler.from_pretrained(sd_root, subfolder="scheduler"),
            safety_checker=None,
            feature_extractor=None,
            requires_safety_checker=False,
        ).to(DEVICE)
        progress(e, "Fusing LCM-LoRA")
        self.pipe.load_lora_weights(lcm_root, weight_name="pytorch_lora_weights.safetensors", adapter_name="lcm")
        self.pipe.fuse_lora(lora_scale=1.0)
        self.pipe.unload_lora_weights()
        if GPU:
            self.pipe.unet.to(memory_format=torch.channels_last)
        if COMPILE:
            self.pipe.unet = maybe_compile(self.pipe.unet)
        self.ip = False  # IP-Adapter: loaded on the first style reference, then kept
        self.ip_cache = collections.OrderedDict()
        self.ip_zero = None
        self.prompts = collections.OrderedDict()
        self.build()
        progress(e, "Warming up")
        blank = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        self.frame({"prompt": "a picture", "seed": 0, "follow": 0.5, "strength": 0.5, "size": 512}, {"sketch": blank})
        self.frame({"prompt": "a picture", "seed": 0, "follow": 0.5, "strength": 0.5, "size": 512}, {"sketch": blank, "color": Image.new("RGB", (64, 64), (200, 100, 50))})

    def build(self):
        """The four pipelines, sharing one set of weights (nothing is copied)."""
        from diffusers import StableDiffusionControlNetImg2ImgPipeline, StableDiffusionControlNetPipeline

        p = self.pipe
        parts = {k: v for k, v in p.components.items() if k != "controlnet"}
        both = [self.lineart, self.openpose]
        self.t2i = {False: p, True: StableDiffusionControlNetPipeline(**parts, controlnet=both, requires_safety_checker=False)}
        self.i2i = {
            False: StableDiffusionControlNetImg2ImgPipeline(**parts, controlnet=self.lineart, requires_safety_checker=False),
            True: StableDiffusionControlNetImg2ImgPipeline(**parts, controlnet=both, requires_safety_checker=False),
        }
        for x in (*self.t2i.values(), *self.i2i.values()):
            x.set_progress_bar_config(disable=True)

    def load_ip(self):
        progress(self.name, "Loading the style reference model (IP-Adapter)")
        root = local(IP_ADAPTER, ["models/ip-adapter_sd15.safetensors", "models/image_encoder/config.json", "models/image_encoder/model.safetensors"], "IP-Adapter", "canvas-licensed")
        self.pipe.load_ip_adapter(root, subfolder="models", weight_name="ip-adapter_sd15.safetensors", image_encoder_folder="image_encoder")
        self.pipe.image_encoder.to(DEVICE, dtype=DTYPE)
        self.ip = True
        self.build()
        # Frames without a reference pass zero image embeddings at scale 0 (the adapter stays loaded).
        self.ip_zero = [torch.zeros_like(t) for t in self.ip_embeds(Image.new("RGB", (224, 224), (127, 127, 127)), "zero")]
        progress(self.name, "Style reference ready")

    def embeds(self, prompt):
        return lru_get(self.prompts, prompt, lambda: self.pipe.encode_prompt(prompt, DEVICE, 1, False)[0])

    @torch.inference_mode()
    def ip_embeds(self, img, key):
        return lru_get(self.ip_cache, key, lambda: self.pipe.prepare_ip_adapter_image_embeds([img.convert("RGB")], None, DEVICE, 1, False), limit=8)

    @torch.inference_mode()
    def run(self, prompt, seed, w, control, follow, pose, ref, image=None, strength=None):
        posed = pose is not None
        args = {
            "prompt_embeds": self.embeds(prompt),
            "guidance_scale": 1.0,
            "generator": gen(seed),
            "controlnet_conditioning_scale": [follow, 1.0] if posed else follow,
        }
        if self.ip:
            if ref is not None:
                img, weight, key = ref
                args["ip_adapter_image_embeds"] = self.ip_embeds(img, key)
                self.pipe.set_ip_adapter_scale(weight)
            else:
                args["ip_adapter_image_embeds"] = self.ip_zero
                self.pipe.set_ip_adapter_scale(0.0)
        cond = [control, pose] if posed else control
        if image is None:
            return self.t2i[posed](image=cond, num_inference_steps=4, width=w, height=w, **args).images[0]
        s = min(1.0, max(0.05, float(strength)))
        # LCM: 4 steps, but always at least two that actually run.
        steps = 4 if 4 * s >= 2 else min(50, math.ceil(2.0 / s))
        return self.i2i[posed](image=image, control_image=cond, strength=s, num_inference_steps=steps, width=w, height=w, **args).images[0]

    def frame(self, req, L):
        w = WORK_OVERRIDE or (512 if req["size"] <= 512 else 768)
        prompt, seed = req["prompt"], req["seed"]
        follow = min(1.5, max(0.0, float(req["follow"])))
        lines = line_mask(L["sketch"], w)
        control = Image.merge("RGB", [lines] * 3)  # white lines on black
        pose = flat(L["pose"], w, (0, 0, 0)) if L.get("pose") is not None else None
        ref = None
        if L.get("ref") is not None:
            if not self.ip:
                self.load_ip()
            img, weight = L["ref"]
            ref = (img, min(1.5, max(0.0, float(weight))), L["ref_key"])
        if L.get("color") is None and L.get("base") is None:
            out = self.run(prompt, seed, w, control, follow, pose, ref)
        else:
            out = self.run(prompt, seed, w, control, follow, pose, ref, composite(L.get("base"), L.get("color"), L["sketch"], w), req["strength"])
        for i, (mask, words) in enumerate(L.get("regions") or []):
            redo = self.run(words, seed + 1 + i, w, control, follow, pose, ref, out, max(0.55, float(req["strength"])))
            out = Image.composite(redo, out, soft_mask(mask, w))
        return out


# ---------------------------------------------------------------- the sketch reader: Florence-2


class Reader:
    name = "reader"

    def __init__(self):
        e = self.name
        try:
            from transformers import AutoProcessor, Florence2ForConditionalGeneration
        except ImportError as err:
            raise RuntimeError("The sketch reader needs transformers 4.57 or newer (its built-in Florence-2)") from err
        files = ["config.json", "generation_config.json", "preprocessor_config.json", "processor_config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt", "added_tokens.json", "model.safetensors"]
        root = local(FLORENCE, files, "Florence-2 (the sketch reader)", "canvas-reader")
        progress(e, "Loading the sketch reader")
        self.model = Florence2ForConditionalGeneration.from_pretrained(root, torch_dtype=DTYPE).to(DEVICE)
        self.processor = AutoProcessor.from_pretrained(root)
        self.model.eval()

    @torch.inference_mode()
    def caption(self, img, task):
        inputs = self.processor(text=task, images=img, return_tensors="pt").to(DEVICE)
        pixel_values = inputs["pixel_values"].to(DTYPE)
        ids = self.model.generate(input_ids=inputs["input_ids"], pixel_values=pixel_values, max_new_tokens=96, num_beams=3, do_sample=False)
        raw = self.processor.batch_decode(ids, skip_special_tokens=False)[0]
        try:
            text = self.processor.post_process_generation(raw, task=task, image_size=img.size)[task]
        except Exception:  # noqa: BLE001 - fall back to the plain text
            text = self.processor.batch_decode(ids, skip_special_tokens=True)[0]
        return str(text).strip()

    def read(self, image):
        img = flat(image, 768)
        short = self.caption(img, "<CAPTION>")
        long = self.caption(img, "<MORE_DETAILED_CAPTION>")
        return guesses(short, long)


DRAWING = r"(?:(?:a|an|the)\s+)?(?:simple\s+|rough\s+|black\s+and\s+white\s+|white\s+|pencil\s+|hand[- ]drawn\s+|child'?s\s+|cartoon\s+)*(?:line\s+)?(?:drawing|sketch|doodle|illustration|picture|image|cartoon|outline|scribble|diagram|clip\s*art)s?\s+(?:of\s+)?"
LEADS = [
    r"^(?:the|this)\s+(?:image|picture|drawing|sketch)\s+(?:is|shows|depicts|features|contains)\s+",
    r"^in\s+this\s+(?:image|picture|drawing),?\s+(?:we\s+can\s+see|there\s+is|there\s+are)?\s*",
    r"^(?:it|this)\s+is\s+",
    r"^there\s+(?:is|are)\s+",
    r"^" + DRAWING,
]


def clean(text):
    import re

    t = re.sub(r"\s+", " ", str(text or "")).strip().strip(".").strip()
    for _ in range(3):
        for lead in LEADS:
            t = re.sub(lead, "", t, flags=re.I).strip()
    t = re.sub(r"\s+(?:on|against)\s+a\s+(?:plain\s+|blank\s+)?white\s+background$", "", t, flags=re.I)
    return t.strip(" ,.")


def guesses(short, long):
    """Up to 3 { label, prompt } from Florence's two captions: the short one, then the detailed one's
    first sentence and first two sentences."""
    import re

    # Sentences about where things sit in the frame say nothing about what to make.
    layout = r"\b(image|picture|drawing|sketch|center|centre|left|right|top|bottom|corner|background|foreground|frame|tilted|lines?)\b"
    sentences = [clean(s) for s in re.split(r"(?<=[.!?])\s+", str(long or "").strip()) if s.strip()]
    sentences = [s for s in sentences if s]
    cands = [(clean(short), None)]
    if sentences:
        cands.append((sentences[0], None))
        more = [s for s in sentences[1:] if not re.search(layout, s, re.I)]
        if more:
            cands.append((f"{sentences[0]}, {more[0][:1].lower() + more[0][1:]}", "in detail"))
    out, seen = [], []
    for c, extra in cands:
        if not c:
            continue
        key = re.sub(r"[^a-z ]", "", c.lower()).strip()
        if any(key == s or (len(key) > 3 and key in s) for s in seen):
            continue
        seen.append(key)
        label = re.sub(r"^(?:a|an|the)\s+", "", c, flags=re.I)
        label = re.split(r"\s+(?:with|that|which|who|is|are|and)\s+|[,.;]", label, maxsplit=1)[0]
        words = label.split()[:6]
        while len(words) > 1 and words[-1].lower() in ("a", "an", "the", "of", "on", "in", "at", "to", "by", "for", "from"):
            words.pop()
        label = " ".join(words)
        if extra:
            label = f"{label}, {extra}"
        out.append({"label": (label[:1].upper() + label[1:])[:60], "prompt": c[:300]})
    return out[:3]


# ---------------------------------------------------------------- engines and requests

ENGINE_CLASSES = {"fast": Fast, "licensed": Licensed, "reader": Reader}


class Slot:
    def __init__(self, name):
        self.name = name
        self.state = "off"
        self.obj = None
        self.error = None
        self.lock = threading.Lock()


SLOTS = {k: Slot(k) for k in ENGINE_CLASSES}


def ensure(name):
    """Load an engine once and keep it (never unloads one to make room for the other)."""
    slot = SLOTS[name]
    with slot.lock:
        if slot.state == "ready":
            return slot.obj
        slot.state = "loading"
        say({"engine": name, "state": "loading"})
        try:
            slot.obj = ENGINE_CLASSES[name]()
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            slot.state, slot.error = "error", "the graphics card is full"
        except Exception as err:  # noqa: BLE001
            slot.state, slot.error = "error", str(err)[:300] or err.__class__.__name__
        else:
            slot.state, slot.error = "ready", None
        say({"engine": name, "state": slot.state, **({"error": slot.error} if slot.error else {})})
        if slot.state != "ready":
            raise RuntimeError(slot.error)
        return slot.obj


def layers(req):
    """The request's pictures, opened (sizes are fitted later, at the engine's working size)."""
    L = {"sketch": open_image(req.get("sketch"))}
    for k in ("color", "base", "pose"):
        if req.get(k):
            L[k] = open_image(req[k])
    if req.get("mask") and "base" in L:
        L["mask"] = open_image(req["mask"])
    elif req.get("mask"):
        raise UserError("Paint over needs the picture to paint on.")
    if req.get("mode") == "paint" and ("mask" not in L):
        raise UserError("Paint over needs the painted area.")
    ref = req.get("ref")
    if isinstance(ref, dict) and ref.get("image"):
        L["ref"] = (open_image(ref["image"]), float(ref.get("weight", 0.6)))
        L["ref_key"] = hashlib.sha1(str(ref["image"]).encode()).hexdigest()
    regions = []
    for r in req.get("regions") or []:
        if isinstance(r, dict) and r.get("mask") and str(r.get("prompt") or "").strip():
            regions.append((open_image(r["mask"]), str(r["prompt"]).strip()[:300]))
    L["regions"] = regions[:8]
    return L


def make_frame(req):
    name = req.get("engine")
    if name not in ("fast", "licensed"):
        raise UserError("Unknown engine.")
    slot = SLOTS[name]
    if slot.state != "ready":
        raise UserError(f"The {name} engine is not loaded yet.")
    size = int(req.get("size") or 512)
    size = size if size in (512, 768, 1024) else 512
    clean_req = {
        "prompt": str(req.get("prompt") or "a picture").strip()[:500] or "a picture",
        "seed": int(req.get("seed") or 0),
        "follow": min(1.0, max(0.0, float(req.get("follow", 0.5)))),
        "strength": min(1.0, max(0.0, float(req.get("strength", 0.6)))),
        "size": size,
    }
    L = layers(req)
    out = slot.obj.frame(clean_req, L)
    if "mask" in L:
        w = out.size[0]
        out = Image.composite(out, flat(L["base"], w), soft_mask(L["mask"], w))
    if out.size != (size, size):
        out = out.resize((size, size), Image.LANCZOS)
    return out


def handle(req):
    out = {"id": req.get("id")}
    t0 = time.perf_counter()
    try:
        op = req.get("op")
        if op == "load":
            if req.get("engine") not in SLOTS:
                raise UserError("Unknown engine.")
            ensure(req["engine"])
            out["ok"] = True
        elif op == "frame":
            out["image"] = webp(make_frame(req))
        elif op == "read":
            out["guesses"] = ensure("reader").read(open_image(req.get("image")))
        else:
            raise UserError("unknown op")
        out["ms"] = round((time.perf_counter() - t0) * 1000)
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        out["error"] = "the graphics card is full"
    except UserError as err:
        out["error"] = str(err)
        out["user"] = True  # a message for the person drawing, shown as is
    except Exception as err:  # noqa: BLE001 - one bad drawing must not stop the worker
        out["error"] = (str(err) or err.__class__.__name__)[:300]
    return out


def lane(q):
    while True:
        req = q.get()
        say(handle(req))


# ---------------------------------------------------------------- self-test (on the pod)


def dummy():
    w = 512
    sketch = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(sketch)
    d.ellipse((140, 120, 372, 352), outline=(20, 20, 20, 255), width=6)
    d.line((256, 352, 256, 470), fill=(20, 20, 20, 255), width=6)
    color = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(color).ellipse((150, 130, 362, 342), fill=(230, 80, 60, 255))
    mask = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(mask).rectangle((0, 0, w // 2, w), fill=(255, 255, 255, 255))
    pose = Image.new("RGB", (w, w), (0, 0, 0))
    pd = ImageDraw.Draw(pose)
    for (a, b, c) in [((256, 100), (256, 260), (255, 0, 0)), ((256, 150), (180, 230), (0, 255, 0)), ((256, 150), (332, 230), (0, 0, 255)), ((256, 260), (210, 420), (255, 255, 0)), ((256, 260), (302, 420), (0, 255, 255))]:
        pd.line((a, b), fill=c, width=8)
    ref = Image.new("RGB", (w, w), (40, 60, 160))
    ImageDraw.Draw(ref).rectangle((60, 60, 300, 300), fill=(240, 200, 40))

    def b64(img, fmt="PNG"):
        buf = io.BytesIO()
        img.save(buf, format=fmt)
        return base64.b64encode(buf.getvalue()).decode("ascii")

    return {k: b64(v) for k, v in {"sketch": sketch, "color": color, "mask": mask, "pose": pose, "ref": ref}.items()}


def selftest(names):
    pics = dummy()
    ok = True

    def check(label, req):
        nonlocal ok
        out = handle(req)
        good = "error" not in out
        ok = ok and good
        say({"check": label, "ok": good, "ms": out.get("ms"), **({"error": out["error"]} if not good else {}), **({"guesses": out["guesses"]} if "guesses" in out else {})})
        return out

    base_req = {"op": "frame", "prompt": "a red balloon on a string", "seed": 1, "follow": 0.6, "strength": 0.6, "size": 512, "sketch": pics["sketch"]}
    for name in names:
        if name == "reader":
            check("reader: load", {"op": "load", "engine": "reader"})
            check("reader: read", {"op": "read", "image": pics["sketch"]})
            continue
        if check(f"{name}: load", {"op": "load", "engine": name}).get("error"):
            continue
        first = check(f"{name}: sketch", {**base_req, "engine": name})
        check(f"{name}: sketch again (warm)", {**base_req, "engine": name, "seed": 2})
        check(f"{name}: colour", {**base_req, "engine": name, "color": pics["color"]})
        if first.get("image"):
            check(f"{name}: paint over", {**base_req, "engine": name, "mode": "paint", "base": first["image"], "mask": pics["mask"]})
        check(f"{name}: region", {**base_req, "engine": name, "regions": [{"mask": pics["mask"], "prompt": "a blue balloon"}]})
        if name == "licensed":
            check("licensed: pose", {**base_req, "engine": name, "prompt": "a person dancing", "pose": pics["pose"]})
            # CANVAS_SELFTEST_SKIP_REF=1 leaves out IP-Adapter (a 2.6 GB download) on a small disk.
            if os.environ.get("CANVAS_SELFTEST_SKIP_REF") != "1":
                check("licensed: style reference", {**base_req, "engine": name, "ref": {"image": pics["ref"], "weight": 0.6}})
                check("licensed: after the reference", {**base_req, "engine": name})
        else:
            out = handle({**base_req, "engine": name, "pose": pics["pose"]})
            good = out.get("error") == "Pose works with the Members engine."
            ok = ok and good
            say({"check": "fast: pose is refused plainly", "ok": good, "error": out.get("error")})
    return ok


# ---------------------------------------------------------------- main

if SELFTEST:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sys.exit(0 if selftest(args or ["fast", "licensed", "reader"]) else 1)

say({"ready": True})

LANES = {"load": queue.Queue(), "frame": queue.Queue(), "read": queue.Queue()}
for q in LANES.values():
    threading.Thread(target=lane, args=(q,), daemon=True).start()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except ValueError:
        continue
    if not isinstance(req, dict):
        continue
    LANES.get(req.get("op"), LANES["frame"]).put(req)
# stdin closed: the gate stopped us.
os._exit(0)
