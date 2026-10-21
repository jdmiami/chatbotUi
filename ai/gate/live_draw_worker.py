"""Live draw: a drawing and a few words become a picture in one step (pix2pix-turbo, sketch to image).

Runs on the graphics card in the studio's Python (ai/studio.sh installs diffusers and peft there),
started by the gate (src/live.js) when Live draw is used and stopped after a few quiet minutes.

One request per line on stdin:
  {"id": "...", "op": "frame", "prompt": "...", "r": 0.25-0.85, "seed": 42, "image": "<base64 PNG>"}
One answer per line on stdout:
  {"id": "...", "jpeg": "<base64 JPEG>", "ms": 120} or {"id": "...", "error": "..."}
Before that: {"loading": "..."} lines, then {"ready": true} once the model is on the graphics card.

The drawing is dark lines on a light background, 512 x 512 (other sizes are resized). The model and
its sketch LoRA are pix2pix-turbo by Gaurav Parmar et al. (github.com/GaParmar/img2img-turbo, MIT
licence); the parts below marked "from img2img-turbo" are adapted from its src/pix2pix_turbo.py and
src/model.py (Copyright (c) 2024 img-to-img-turbo, MIT licence). The base model is Stability AI's
SD-Turbo (Stability AI Community License). Everything is read from the files the gate downloaded:
nothing is fetched from the internet here.

Environment: LIVE_DRAW_SD_TURBO (folder with SD-Turbo's unet/vae/text_encoder/tokenizer/scheduler),
LIVE_DRAW_LORA (sketch_to_image_stochastic_lora.pkl), LIVE_DRAW_DTYPE (fp32 default, or fp16).
"""
import base64
import copy
import io
import json
import os
import sys
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")


def say(obj):
    print(json.dumps(obj), flush=True)


say({"loading": "Loading Live draw"})

import torch  # noqa: E402
import torchvision.transforms.functional as TF  # noqa: E402
from PIL import Image  # noqa: E402
from diffusers import AutoencoderKL, DDPMScheduler, UNet2DConditionModel  # noqa: E402
from diffusers.utils.peft_utils import set_weights_and_activate_adapters  # noqa: E402
from peft import LoraConfig  # noqa: E402
from transformers import AutoTokenizer, CLIPTextModel  # noqa: E402

ROOT = os.environ.get("LIVE_DRAW_SD_TURBO", "")
LORA = os.environ.get("LIVE_DRAW_LORA", "")
DTYPE = torch.float16 if os.environ.get("LIVE_DRAW_DTYPE") == "fp16" else torch.float32
SIZE = 512

# LIVE_DRAW_DEVICE=cpu is for checking the worker on a computer without a graphics card (slow).
if os.environ.get("LIVE_DRAW_DEVICE") == "cpu":
    DEVICE = torch.device("cpu")
    DTYPE = torch.float32
elif torch.cuda.is_available():
    DEVICE = torch.device("cuda")
else:
    sys.stderr.write("Live draw needs the graphics card (CUDA is not available)\n")
    sys.exit(3)
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True


# ---- from img2img-turbo (src/model.py): the VAE with skip connections from encoder to decoder
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


# ---- from img2img-turbo (src/pix2pix_turbo.py): the first convolution, blended between the
# pretrained one and the trained one by r
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


def load():
    variant = {"variant": "fp16"}
    say({"loading": "Loading the text encoder"})
    tokenizer = AutoTokenizer.from_pretrained(ROOT, subfolder="tokenizer")
    text_encoder = CLIPTextModel.from_pretrained(ROOT, subfolder="text_encoder", torch_dtype=DTYPE, **variant).to(DEVICE)
    text_encoder.requires_grad_(False)
    sched = DDPMScheduler.from_pretrained(ROOT, subfolder="scheduler")
    sched.set_timesteps(1, device=DEVICE)
    sched.alphas_cumprod = sched.alphas_cumprod.to(DEVICE)

    say({"loading": "Loading the picture model"})
    vae = AutoencoderKL.from_pretrained(ROOT, subfolder="vae", torch_dtype=torch.float32, **variant)
    vae.encoder.forward = my_vae_encoder_fwd.__get__(vae.encoder, vae.encoder.__class__)
    vae.decoder.forward = my_vae_decoder_fwd.__get__(vae.decoder, vae.decoder.__class__)
    vae.decoder.skip_conv_1 = torch.nn.Conv2d(512, 512, kernel_size=(1, 1), stride=(1, 1), bias=False)
    vae.decoder.skip_conv_2 = torch.nn.Conv2d(256, 512, kernel_size=(1, 1), stride=(1, 1), bias=False)
    vae.decoder.skip_conv_3 = torch.nn.Conv2d(128, 512, kernel_size=(1, 1), stride=(1, 1), bias=False)
    vae.decoder.skip_conv_4 = torch.nn.Conv2d(128, 256, kernel_size=(1, 1), stride=(1, 1), bias=False)
    vae.decoder.ignore_skip = False
    unet = UNet2DConditionModel.from_pretrained(ROOT, subfolder="unet", torch_dtype=torch.float32, **variant)

    say({"loading": "Loading the sketch LoRA"})
    convin_pretrained = copy.deepcopy(unet.conv_in)
    unet.conv_in = TwinConv(convin_pretrained, unet.conv_in)
    # Plain tensors, lists and numbers only: loaded without running any code from the file.
    sd = torch.load(LORA, map_location="cpu", weights_only=True)
    unet_lora_config = LoraConfig(r=sd["rank_unet"], init_lora_weights="gaussian", target_modules=sd["unet_lora_target_modules"])
    vae_lora_config = LoraConfig(r=sd["rank_vae"], init_lora_weights="gaussian", target_modules=sd["vae_lora_target_modules"])
    vae.add_adapter(vae_lora_config, adapter_name="vae_skip")
    _sd_vae = vae.state_dict()
    for k in sd["state_dict_vae"]:
        _sd_vae[k] = sd["state_dict_vae"][k]
    vae.load_state_dict(_sd_vae)
    unet.add_adapter(unet_lora_config)
    _sd_unet = unet.state_dict()
    for k in sd["state_dict_unet"]:
        _sd_unet[k] = sd["state_dict_unet"][k]
    unet.load_state_dict(_sd_unet)

    unet.to(DEVICE, dtype=DTYPE)
    vae.to(DEVICE)  # the VAE stays in fp32 (SD VAEs are unreliable in fp16)
    unet.eval()
    vae.eval()
    unet.requires_grad_(False)
    vae.requires_grad_(False)
    vae.decoder.gamma = 1
    return tokenizer, text_encoder, sched, vae, unet


tokenizer, text_encoder, sched, vae, unet = load()
timesteps = torch.tensor([999], device=DEVICE).long()
_prompt_cache = {"text": None, "enc": None}


def encode(prompt):
    if _prompt_cache["text"] != prompt:
        tokens = tokenizer(prompt, max_length=tokenizer.model_max_length, padding="max_length", truncation=True, return_tensors="pt").input_ids.to(DEVICE)
        _prompt_cache["enc"] = text_encoder(tokens)[0]
        _prompt_cache["text"] = prompt
    return _prompt_cache["enc"]


@torch.inference_mode()
def frame(prompt, r, seed, png_b64):
    img = Image.open(io.BytesIO(base64.b64decode(png_b64))).convert("RGB")
    if img.size != (SIZE, SIZE):
        img = img.resize((SIZE, SIZE), Image.LANCZOS)
    # from img2img-turbo (src/inference_paired.py): the lines are where the drawing is dark
    c_t = (TF.to_tensor(img) < 0.5).unsqueeze(0).to(DEVICE).float()
    gen = torch.Generator(device=DEVICE).manual_seed(int(seed))
    noise = torch.randn((1, 4, SIZE // 8, SIZE // 8), device=DEVICE, generator=gen)
    caption_enc = encode(prompt)
    # from img2img-turbo (Pix2Pix_Turbo.forward, deterministic=False): r blends the drawing with noise
    unet.set_adapters(["default"], weights=[r])
    set_weights_and_activate_adapters(vae, ["vae_skip"], [r])
    encoded_control = vae.encode(c_t).latent_dist.sample() * vae.config.scaling_factor
    unet_input = encoded_control * r + noise * (1 - r)
    unet.conv_in.r = r
    unet_output = unet(unet_input.to(DTYPE), timesteps, encoder_hidden_states=caption_enc).sample
    unet.conv_in.r = None
    x_denoised = sched.step(unet_output.float(), timesteps, unet_input, return_dict=True).prev_sample
    vae.decoder.incoming_skip_acts = vae.encoder.current_down_blocks
    vae.decoder.gamma = r
    out = vae.decode(x_denoised.float() / vae.config.scaling_factor).sample.clamp(-1, 1)
    pil = TF.to_pil_image((out[0].float().cpu() * 0.5 + 0.5).clamp(0, 1))
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# One warm-up pass, so the first stroke isn't the slow one.
try:
    blank = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    b = io.BytesIO()
    blank.save(b, format="PNG")
    frame("a picture", 0.4, 0, base64.b64encode(b.getvalue()).decode("ascii"))
except Exception as err:  # noqa: BLE001
    sys.stderr.write(f"warm-up failed: {err}\n")
    sys.exit(4)
say({"ready": True})

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except ValueError:
        continue
    out = {"id": req.get("id")}
    try:
        if req.get("op") != "frame":
            raise ValueError("unknown op")
        r = min(1.0, max(0.0, float(req.get("r", 0.4))))
        t0 = time.perf_counter()
        out["jpeg"] = frame(str(req.get("prompt") or "a picture")[:500], r, int(req.get("seed") or 0), req["image"])
        out["ms"] = round((time.perf_counter() - t0) * 1000)
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        out["error"] = "the graphics card is full"
    except Exception as err:  # noqa: BLE001 - one bad drawing must not stop the worker
        out["error"] = str(err)[:300]
    print(json.dumps(out), flush=True)
