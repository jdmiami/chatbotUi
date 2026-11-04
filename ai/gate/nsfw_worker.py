"""Looks at pictures for the gate's safety checks. Runs on the CPU, in the studio's Python.

One request per line on stdin:
  {"id": "...", "paths": ["a.jpg", ...]}                  how likely each is NSFW
  {"id": "...", "op": "drawing", "paths": ["a.jpg", ...]} how likely each is a drawing (cartoon, anime,
                                                          illustration) rather than a photo of a real scene
One answer per line on stdout: {"id": "...", "score": 0.0-1.0} or {"id": "...", "error": "..."}.
NSFW: the highest of the pictures. Drawing: the lowest (every picture must be a drawing).
The first line it prints is {"ready": true}, once the NSFW model is loaded. The drawing model (CLIP,
zero-shot) loads the first time it is asked for.
"""
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from PIL import Image  # noqa: E402
from transformers import pipeline  # noqa: E402

MODEL = os.environ.get("NSFW_MODEL", "Falconsai/nsfw_image_detection")
DRAWING_MODEL = os.environ.get("DRAWING_MODEL", "openai/clip-vit-large-patch14")
classify = pipeline("image-classification", model=MODEL, device=-1)
print(json.dumps({"ready": True}), flush=True)

# A photo of real people versus something drawn or animated. What counts toward "drawing" is every
# drawn label's share; photos of people, of places and photo-like renders count against it.
PHOTO_LABELS = [
    "a photograph of a real person",
    "a selfie",
    "a photo of people",
    "a photograph of a real place",
    "a photorealistic image of a person",
]
DRAWN_LABELS = [
    "a cartoon",
    "an anime drawing",
    "a hand-drawn illustration",
    "a comic book drawing",
    "a digital painting of a cartoon character",
    "a 3D animated cartoon character",
]
_drawing = None


def drawing_score(im):
    global _drawing
    if _drawing is None:
        _drawing = pipeline("zero-shot-image-classification", model=DRAWING_MODEL, device=-1)
    result = _drawing(im, candidate_labels=PHOTO_LABELS + DRAWN_LABELS)
    return sum(r["score"] for r in result if r["label"] in DRAWN_LABELS)


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
        drawing = req.get("op") == "drawing"
        for p in req.get("paths") or []:
            with Image.open(p) as im:
                rgb = im.convert("RGB")
                if drawing:
                    scores.append(drawing_score(rgb))
                else:
                    result = classify(rgb)
                    scores.append(next((r["score"] for r in result if str(r["label"]).lower() == "nsfw"), 0.0))
        out["score"] = (min(scores) if drawing else max(scores)) if scores else 0.0
    except Exception as err:  # a broken picture must not stop the worker
        out["error"] = str(err)[:300]
    print(json.dumps(out), flush=True)
