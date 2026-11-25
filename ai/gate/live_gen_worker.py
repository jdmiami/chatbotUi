"""Live video makers that make video as it plays: Helios, LongLive and Waypoint.

Started by the gate (src/livevideo.js, through live.js's worker) in the maker's own Python (ai/live_env.sh:
"dfx" for Helios and Waypoint, "longlive" for LongLive). LIVE_ENGINE says which one.

  helios     Helios-Distilled 14B (PKU, Apache-2.0), Diffusers' HeliosPyramidPipeline. It makes 33 frames
             at a time; each part is sent as soon as it is decoded. Changing the words starts the next
             part from the end of what was made, with the new words.
  longlive   LongLive-1.3B (NVIDIA; weights CC BY-NC-SA). Its own causal Wan 2.1 pipeline, three frames
             at a time, decoded as they come; new words are switched in with its KV re-cache.
  waypoint   Waypoint-1.5-1B (Overworld, Apache-2.0), Diffusers' modular pipeline with its own code.
             Starts from a picture; each step follows the keys held and the look-around since the last.

One request per line on stdin (each answered by { "id": ..., "ok": true } or { "id": ..., "error": "..." }):
  {"id": "...", "op": "start", "prompt": "...", "image": "<data URL or base64>"?}
  {"id": "...", "op": "prompt", "prompt": "..."}
  {"id": "...", "op": "control", "keys": ["w", "a", "s", "d", "space", "shift"], "look": [dx, dy]}
  {"id": "...", "op": "stop"}
Lines that answer no request:
  {"loading": "..."} then {"ready": true}            while it loads
  {"event": "frames", "frames": ["<base64 JPEG>"...], "fps": 24}
  {"event": "ended", "error": "..."?}                  a run stopped by itself (an error, or the end)
"""
import base64
import io
import json
import os
import queue
import sys
import threading
import time

ENGINE = os.environ.get("LIVE_ENGINE", "")
LOCK = threading.Lock()


def say(obj):
    with LOCK:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


say({"loading": "Loading its Python"})
import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

torch.set_grad_enabled(False)
DEVICE = "cuda"
INBOX = queue.Queue()


def read_stdin():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            INBOX.put(json.loads(line))
        except ValueError:
            continue
    INBOX.put({"op": "quit"})


class Stop(Exception):
    """The run was stopped (Stop) or must start again with new words (Restart)."""


class Restart(Exception):
    pass


class NewStart(Exception):
    """Another start came while one was running: that one runs instead."""


def jpeg(frame):
    """One frame (H, W, 3 uint8) as base64 JPEG."""
    buf = io.BytesIO()
    Image.fromarray(frame).save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def to_uint8(video, layout):
    """A decoded video tensor in -1..1, laid out "CTHW" or "TCHW", as (T, H, W, 3) uint8."""
    v = video.detach().float().clamp(-1, 1)
    v = v.permute(1, 2, 3, 0) if layout == "CTHW" else v.permute(0, 2, 3, 1)
    return ((v + 1) * 127.5).round().to(torch.uint8).cpu().numpy()


def picture(data, size=None):
    if not data:
        return None
    if "," in data and data.startswith("data:"):
        data = data.split(",", 1)[1]
    img = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")
    return img.resize(size, Image.BICUBIC) if size else img


class Session:
    """What the current run follows: its words, the keys held and the look-around (Waypoint)."""

    def __init__(self, prompt, image):
        self.prompt = prompt
        self.new_prompt = None
        self.image = image
        self.keys = set()
        self.look = [0.0, 0.0]
        self.stopped = False


SESSION = None


def handle(msg, running):
    """Handles one request. Returns 'stop' or 'restart' when the run must change; answers it."""
    global SESSION
    op = msg.get("op")
    rid = msg.get("id")
    if op == "quit":
        raise SystemExit(0)
    if op == "stop":
        if SESSION:
            SESSION.stopped = True
        say({"id": rid, "ok": True})
        return "stop"
    if op == "prompt":
        words = str(msg.get("prompt") or "").strip()[:500]
        if not words:
            say({"id": rid, "error": "Say what to see."})
            return None
        if SESSION:
            SESSION.new_prompt = words
        say({"id": rid, "ok": True})
        return "restart" if running and ENGINE == "helios" else None
    if op == "control":
        if SESSION:
            SESSION.keys = set(str(k) for k in (msg.get("keys") or [])[:8])
            look = msg.get("look") or [0, 0]
            SESSION.look[0] += float(look[0] or 0)
            SESSION.look[1] += float(look[1] or 0)
        say({"id": rid, "ok": True})
        return None
    if op == "start":
        words = str(msg.get("prompt") or "").strip()[:500]
        if SESSION:
            SESSION.stopped = True
        SESSION = Session(words, msg.get("image") or None)
        say({"id": rid, "ok": True})
        return "start"
    say({"id": rid, "error": "Unknown request."})
    return None


def drain(running=True):
    """Handles every request waiting. Raises Stop or Restart when the run must end or change."""
    while True:
        try:
            msg = INBOX.get_nowait()
        except queue.Empty:
            return
        what = handle(msg, running)
        if what == "stop":
            raise Stop()
        if what == "start":
            raise NewStart()
        if what == "restart":
            raise Restart()


# ---------------------------------------------------------------- Helios


def helios_engine():
    from diffusers import AutoModel, HeliosPyramidPipeline

    root = os.environ["HELIOS_DIR"]
    say({"loading": "Loading Helios 14B (about 30 GB into the graphics card)"})
    vae = AutoModel.from_pretrained(root, subfolder="vae", torch_dtype=torch.float32)
    pipe = HeliosPyramidPipeline.from_pretrained(root, vae=vae, torch_dtype=torch.bfloat16)
    pipe.to(DEVICE)
    fps = 24
    negative = (
        "Bright tones, overexposed, static, blurred details, subtitles, worst quality, low quality, JPEG compression "
        "residue, ugly, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, "
        "fused fingers, still picture, messy background, three legs, walking backwards"
    )
    state = {"tail": None}  # the last frames made: the next part carries on from them
    original = pipe.vae.decode

    def decode_and_send(z, *args, **kwargs):
        out = original(z, *args, **kwargs)
        video = out[0] if isinstance(out, (tuple, list)) else out.sample
        frames = to_uint8(video[0], "CTHW")
        say({"event": "frames", "frames": [jpeg(f) for f in frames], "fps": fps})
        state["tail"] = frames[-33:]
        drain()
        return out

    pipe.vae.decode = decode_and_send

    def run(session):
        image = picture(session.image) if session.image else None
        first = True
        while not session.stopped:
            if session.new_prompt:
                session.prompt, session.new_prompt = session.new_prompt, None
            kwargs = dict(
                prompt=session.prompt,
                negative_prompt=negative,
                num_frames=33 * 8,
                pyramid_num_inference_steps_list=[2, 2, 2],
                guidance_scale=1.0,
                is_amplify_first_chunk=first and image is None,
                output_type="latent",
            )
            if first and image is not None:
                kwargs["image"] = image
            elif not first and state["tail"] is not None:
                kwargs["video"] = [Image.fromarray(f) for f in state["tail"]]
            try:
                pipe(**kwargs)
            except Restart:
                pass
            first = False

    return run


# ---------------------------------------------------------------- LongLive


def longlive_engine():
    repo = os.environ["LONGLIVE_REPO"]
    sys.path.insert(0, repo)
    # Its code reads the Wan 2.1 files from wan_models/ in the folder it runs in.
    os.chdir(os.environ["WAN_ROOT"])
    from omegaconf import OmegaConf
    import peft
    from pipeline.interactive_causal_inference import InteractiveCausalInferencePipeline
    from utils.lora_utils import configure_lora_for_model

    say({"loading": "Loading LongLive 1.3B"})
    config = OmegaConf.load(os.path.join(repo, "configs", "longlive_interactive_inference.yaml"))
    config.generator_ckpt = os.environ["LONGLIVE_BASE"]
    config.lora_ckpt = os.environ["LONGLIVE_LORA"]
    pipe = InteractiveCausalInferencePipeline(config, device=torch.device(DEVICE))
    state = torch.load(config.generator_ckpt, map_location="cpu")
    pipe.generator.load_state_dict(state["generator"])
    pipe.generator.model = configure_lora_for_model(pipe.generator.model, model_name="generator", lora_config=config.adapter, is_main_process=True)
    lora = torch.load(config.lora_ckpt, map_location="cpu")
    peft.set_peft_model_state_dict(pipe.generator.model, lora["generator_lora"] if isinstance(lora, dict) and "generator_lora" in lora else lora)
    pipe.is_lora_enabled = True
    pipe = pipe.to(dtype=torch.bfloat16)
    pipe.generator.to(device=DEVICE)
    pipe.vae.to(device=DEVICE)
    pipe.text_encoder.to(device=DEVICE)
    fps = 16
    per_block = pipe.num_frame_per_block
    max_frames = int(config.num_output_frames)  # one stretch; then it carries on in a fresh one
    shape = (16, 60, 104)  # latent frames for 832 x 480

    def fresh():
        pipe._initialize_kv_cache(1, dtype=torch.bfloat16, device=DEVICE, kv_cache_size_override=pipe.local_attn_size * pipe.frame_seq_length)
        pipe._initialize_crossattn_cache(batch_size=1, dtype=torch.bfloat16, device=DEVICE)
        pipe.generator.model.local_attn_size = pipe.local_attn_size
        pipe._set_all_modules_max_attention_size(pipe.local_attn_size)
        pipe.vae.model.clear_cache()
        return torch.zeros((1, max_frames) + shape, device=DEVICE, dtype=torch.bfloat16)

    def run(session):
        cond = pipe.text_encoder(text_prompts=[session.prompt])
        output = fresh()
        start = 0
        while not session.stopped:
            drain()
            if session.new_prompt:
                session.prompt, session.new_prompt = session.new_prompt, None
                cond = pipe.text_encoder(text_prompts=[session.prompt])
                if start:
                    pipe._recache_after_switch(output, start, cond)
            if start + per_block > max_frames:
                output = fresh()
                start = 0
            noisy = torch.randn((1, per_block) + shape, device=DEVICE, dtype=torch.bfloat16)
            steps = pipe.denoising_step_list
            for i, t in enumerate(steps):
                timestep = torch.ones([1, per_block], device=DEVICE, dtype=torch.int64) * t
                _, pred = pipe.generator(
                    noisy_image_or_video=noisy, conditional_dict=cond, timestep=timestep,
                    kv_cache=pipe.kv_cache1, crossattn_cache=pipe.crossattn_cache, current_start=start * pipe.frame_seq_length,
                )
                if i < len(steps) - 1:
                    nxt = steps[i + 1] * torch.ones([per_block], device=DEVICE, dtype=torch.long)
                    noisy = pipe.scheduler.add_noise(pred.flatten(0, 1), torch.randn_like(pred.flatten(0, 1)), nxt).unflatten(0, pred.shape[:2])
            output[:, start:start + per_block] = pred
            pipe.generator(
                noisy_image_or_video=pred, conditional_dict=cond,
                timestep=torch.ones_like(timestep) * config.context_noise,
                kv_cache=pipe.kv_cache1, crossattn_cache=pipe.crossattn_cache, current_start=start * pipe.frame_seq_length,
            )
            start += per_block
            video = pipe.vae.decode_to_pixel(pred, use_cache=True)
            say({"event": "frames", "frames": [jpeg(f) for f in to_uint8(video[0], "TCHW")], "fps": fps})

    return run


# ---------------------------------------------------------------- Waypoint

KEY_CODES = {"w": 87, "a": 65, "s": 83, "d": 68, "space": 32, "shift": 16}


def waypoint_engine():
    from diffusers.modular_pipelines import ModularPipeline

    root = os.environ["WAYPOINT_DIR"]
    # Its index names the model on Hugging Face; this machine has the files: a copy of the folder that
    # points at them (the downloaded files stay as they are).
    here = os.path.join(os.environ.get("TMPDIR", "/tmp"), "waypoint-local")
    os.makedirs(here, exist_ok=True)
    for name in os.listdir(root):
        link = os.path.join(here, name)
        if name != "modular_model_index.json" and not os.path.lexists(link):
            os.symlink(os.path.join(root, name), link)
    with open(os.path.join(root, "modular_model_index.json")) as f:
        index = f.read().replace('"Overworld/Waypoint-1.5-1B"', json.dumps(root))
    with open(os.path.join(here, "modular_model_index.json"), "w") as f:
        f.write(index)
    say({"loading": "Loading Waypoint 1.5"})
    pipe = ModularPipeline.from_pretrained(here, trust_remote_code=True)
    # It follows where you move, not words: its text encoder is never loaded.
    pipe.load_components(names=["transformer", "vae"], device_map=DEVICE, torch_dtype=torch.bfloat16, trust_remote_code=True)
    pipe.transformer.apply_inference_patches()
    if os.environ.get("WAYPOINT_COMPILE", "1") == "1":
        say({"loading": "Getting Waypoint ready for speed (a few minutes the first time)"})
        pipe.transformer.compile(fullgraph=True, mode="max-autotune", dynamic=False)
    no_words = torch.zeros((1, 1, 2048), device=DEVICE, dtype=torch.bfloat16)
    no_mask = torch.zeros((1, 1), device=DEVICE, dtype=torch.bool)
    fps = 30

    def run(session):
        start = picture(session.image, (1024, 512)) if session.image else None
        if start is None:
            raise ValueError("Waypoint starts from a picture: pick one first.")
        state = pipe(image=start, prompt_embeds=no_words, prompt_pad_mask=no_mask, button=set(), mouse=(0.0, 0.0), output_type="pil")
        state.values["image"] = None
        while not session.stopped:
            drain()
            buttons = {KEY_CODES[k] for k in session.keys if k in KEY_CODES}
            look = (max(-1.0, min(1.0, session.look[0])), max(-1.0, min(1.0, session.look[1])))
            session.look = [0.0, 0.0]
            state = pipe(state, button=buttons, mouse=look, output_type="pil")
            images = state.values["images"]
            images = images if isinstance(images, list) else [images]
            say({"event": "frames", "frames": [jpeg(np.asarray(im.convert("RGB"))) for im in images], "fps": fps})

    return run


ENGINES = {"helios": helios_engine, "longlive": longlive_engine, "waypoint": waypoint_engine}


def main():
    if ENGINE not in ENGINES:
        say({"loading": f"Unknown live maker: {ENGINE}"})
        sys.exit(2)
    threading.Thread(target=read_stdin, daemon=True).start()
    run = ENGINES[ENGINE]()
    say({"ready": True})
    while True:
        # Waits for a start (other requests are answered meanwhile).
        what = handle(INBOX.get(), running=False)
        while what == "start":
            what = None
            session = SESSION
            try:
                run(session)
                say({"event": "ended"})
            except Stop:
                say({"event": "ended"})
            except NewStart:
                # A new start arrived while running: run that one.
                say({"event": "ended"})
                what = "start"
            except Restart:
                say({"event": "ended"})
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                say({"event": "ended", "error": "The graphics card ran out of memory. Stop other work on the machine and start again."})
            except Exception as err:  # noqa: BLE001
                say({"event": "ended", "error": str(err)[:300]})


if __name__ == "__main__":
    main()
