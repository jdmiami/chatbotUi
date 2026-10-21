"""Live video with StreamDiffusionV2 (1.3B): camera or canvas frames in, restyled frames out.

Runs in StreamDiffusionV2's own Python (it pins torch 2.6, so it can't share the studio's), set up
by ai/live_env.sh at a pinned commit, and started by the gate (src/livevideo.js) on first use.
Uses the project's own online demo pipeline (demo/vid2vid.py: build_single_gpu_pipeline_manager,
start_stream_session, run_stream_batch), the same calls its web demo makes, without its web server.

One request per line on stdin:
  {"id": "...", "op": "frames", "prompt": "...", "strength": 0.5-0.95, "frames": ["<base64 JPEG>", ...]}
  {"id": "...", "op": "reset"}
One answer per line on stdout:
  {"id": "...", "frames": ["<base64 JPEG>", ...], "ms": 230, "need": 4} or {"id": "...", "error": "..."}
Frames are buffered here until a block is complete (5 to start, then 4 at a time); when frames come
faster than they can be made, the oldest are dropped so the picture stays close to live. A new
prompt starts a new stream session (that is how the demo changes it).
Before that: {"loading": "..."} lines, then {"ready": true}.

Environment: SDV2_REPO (the checkout), SDV2_CKPT (folder with model.pt), STREAMDIFFUSIONV2_ROOT
(folder with wan_models/Wan2.1-T2V-1.3B), LIVE_VIDEO_SIZE (512).
"""
import base64
import collections
import io
import json
import os
import sys
import time


def say(obj):
    print(json.dumps(obj), flush=True)


say({"loading": "Loading StreamDiffusionV2"})
REPO = os.environ["SDV2_REPO"]
sys.path.insert(0, REPO)
sys.path.insert(0, os.path.join(REPO, "demo"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from streamv2v.inference_common import merge_cli_config  # noqa: E402
from vid2vid import build_single_gpu_pipeline_manager  # noqa: E402

SIZE = int(os.environ.get("LIVE_VIDEO_SIZE", "512"))
torch.set_grad_enabled(False)
device = torch.device("cuda")
torch.cuda.set_device(device)

# The demo's own defaults (demo/config.py), for one GPU.
args = {
    "config_path": os.path.join(REPO, "configs", "wan_causal_dmd_v2v.yaml"),
    "checkpoint_folder": os.environ["SDV2_CKPT"],
    "step": 2,
    "noise_scale": 0.8,
    "debug": False,
    "num_gpus": 1,
    "gpu_ids": "0",
    "max_outstanding": 2,
    "schedule_block": False,
    "model_type": "T2V-1.3B",
    "use_taehv": False,
    "use_tensorrt": False,
    "fast": False,
    "enable_metrics": False,
    "target_latency": 1.0,
    "t2v": False,
    "online_batching_mode": "batch",
    "online_slo_wait_threshold": 0.5,
}
config = merge_cli_config(args["config_path"], args)
config["height"] = SIZE
config["width"] = SIZE
say({"loading": "Loading the video model onto the graphics card"})
manager, _ = build_single_gpu_pipeline_manager(config, device)
CHUNK = manager.base_chunk_size * config.num_frame_per_block
FIRST = 1 + CHUNK
say({"ready": True, "chunk": CHUNK, "first": FIRST})

buf = collections.deque(maxlen=FIRST * 3)
session = None
session_prompt = None
session_strength = None


def to_array(b64):
    # demo/util.py image_to_array: RGB, resized, -1..1
    with Image.open(io.BytesIO(base64.b64decode(b64))) as im:
        arr = np.array(im.convert("RGB").resize((SIZE, SIZE)))
    return arr / 127.5 - 1.0


def to_tensor(arrays):
    # demo/util.py read_images_from_queue: [1, C, T, H, W] bfloat16 on the device
    t = torch.from_numpy(np.stack(arrays, axis=0)).unsqueeze(0)
    return t.permute(0, 4, 1, 2, 3).to(dtype=torch.bfloat16).to(device=device)


def to_jpeg(frame):
    # demo/util.py array_to_image: 0..1 HWC
    im = Image.fromarray((np.clip(frame, 0, 1) * 255.0).astype(np.uint8))
    out = io.BytesIO()
    im.save(out, format="JPEG", quality=85)
    return base64.b64encode(out.getvalue()).decode("ascii")


def take(n):
    # Behind by more than two blocks: skip ahead (live beats complete).
    while len(buf) > n + CHUNK * 2:
        buf.popleft()
    return [buf.popleft() for _ in range(n)]


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
        if req.get("op") == "reset":
            session = None
            buf.clear()
            out["frames"] = []
        elif req.get("op") == "frames":
            t0 = time.perf_counter()
            for f in req.get("frames") or []:
                buf.append(to_array(f))
            prompt = str(req.get("prompt") or "a cinematic video")[:500]
            strength = min(0.95, max(0.3, float(req.get("strength", 0.8))))
            frames = []
            if session is None or prompt != session_prompt or strength != session_strength:
                if len(buf) >= FIRST:
                    session, initial = manager.start_stream_session(prompt=prompt, images=to_tensor(take(FIRST)), noise_scale=strength)
                    session_prompt, session_strength = prompt, strength
                    frames.extend(initial)
                else:
                    session = None
            while session is not None and len(buf) >= CHUNK:
                for decoded in manager.run_stream_batch(session, to_tensor(take(CHUNK)), queue_wait_time=None):
                    frames.extend(decoded)
            out["frames"] = [to_jpeg(f) for f in frames]
            out["ms"] = round((time.perf_counter() - t0) * 1000)
            out["need"] = CHUNK if session is not None else FIRST
        else:
            raise ValueError("unknown op")
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        session = None
        out["error"] = "the graphics card is full"
    except Exception as err:  # noqa: BLE001 - one bad frame must not stop the worker
        session = None
        out["error"] = str(err)[:300]
    print(json.dumps(out), flush=True)
