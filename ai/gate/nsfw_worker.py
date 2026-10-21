"""Looks at pictures and says how likely each is NSFW. Runs on the CPU, in the studio's Python.

One request per line on stdin: {"id": "...", "paths": ["a.jpg", ...]}
One answer per line on stdout: {"id": "...", "score": 0.0-1.0} (the highest of the pictures) or {"id": "...", "error": "..."}
The first line it prints is {"ready": true}, once the model is loaded.
"""
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from PIL import Image  # noqa: E402
from transformers import pipeline  # noqa: E402

MODEL = os.environ.get("NSFW_MODEL", "Falconsai/nsfw_image_detection")
classify = pipeline("image-classification", model=MODEL, device=-1)
print(json.dumps({"ready": True}), flush=True)

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
        scores = []
        for p in req.get("paths") or []:
            with Image.open(p) as im:
                result = classify(im.convert("RGB"))
            scores.append(next((r["score"] for r in result if str(r["label"]).lower() == "nsfw"), 0.0))
        out["score"] = max(scores) if scores else 0.0
    except Exception as err:  # a broken picture must not stop the worker
        out["error"] = str(err)[:300]
    print(json.dumps(out), flush=True)
