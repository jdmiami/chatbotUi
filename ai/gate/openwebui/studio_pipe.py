"""
title: Image and video maker
description: Makes images (Qwen-Image 2.1) and videos with sound (LTX-2.3) on this AI machine. Installed and kept up to date by the AI machine's gate; edits here are overwritten.
"""

import asyncio
import base64
import os
import re

import aiohttp
from pydantic import BaseModel

GATE = "http://127.0.0.1:8080"


def _last_user(body):
    for m in reversed(body.get("messages", [])):
        if m.get("role") == "user":
            return m.get("content")
    return ""


def _text_and_image(content):
    """The prompt text, and the first attached picture as a data URL (for video from a photo)."""
    if isinstance(content, str):
        return content, None
    text, image = [], None
    for part in content or []:
        if part.get("type") == "text":
            text.append(part.get("text", ""))
        elif part.get("type") == "image_url" and image is None:
            image = (part.get("image_url") or {}).get("url")
    return " ".join(text), image


def _size(text, kind):
    t = text.lower()
    if re.search(r"\b(portrait|vertical|tall|9:16|phone)\b", t):
        return "portrait"
    if re.search(r"\b(landscape|horizontal|wide|16:9|cinematic)\b", t):
        return "landscape"
    return "square" if kind == "image" else "landscape"


def _seconds(text):
    m = re.search(r"\b(\d{1,2})\s*(s|sec|secs|second|seconds)\b", text.lower())
    return int(m.group(1)) if m else 5


async def _image_data_url(url, session):
    """Open WebUI may hand attachments over as /api/v1/files/... links instead of data URLs."""
    if not url or url.startswith("data:"):
        return url
    return None


class Pipe:
    class Valves(BaseModel):
        pass

    def __init__(self):
        self.valves = self.Valves()

    def pipes(self):
        return [
            {"id": "image", "name": "Image maker"},
            {"id": "video", "name": "Video maker"},
        ]

    async def pipe(self, body: dict, __event_emitter__=None, __task__=None):
        # Open WebUI also calls models for titles/tags/follow-ups; don't make pictures for those.
        if __task__:
            return ""
        kind = "video" if str(body.get("model", "")).endswith("video") else "image"
        text, image = _text_and_image(_last_user(body))
        text = text.strip()
        if not text:
            return "Describe what to make." if kind == "image" else "Describe the video (and attach a photo to start from, if you like)."

        async def status(msg, done=False):
            if __event_emitter__:
                await __event_emitter__({"type": "status", "data": {"description": msg, "done": done}})

        headers = {"x-studio-key": os.environ.get("ORBIT_STUDIO_KEY", ""), "content-type": "application/json"}
        req = {"kind": kind, "prompt": text, "size": _size(text, kind)}
        if kind == "video":
            req["seconds"] = _seconds(text)
            async with aiohttp.ClientSession() as s:
                img = await _image_data_url(image, s)
            if img:
                req["image"] = img

        async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as s:
            async with s.post(f"{GATE}/_orbit/studio/jobs", json=req) as r:
                job = await r.json()
                if r.status != 200:
                    await status("Not made", True)
                    return job.get("error") or f"Couldn't start ({r.status})."
            what = "picture" if kind == "image" else "video"
            await status(f"Making the {what}…")
            while job.get("status") in ("queued", "running"):
                await asyncio.sleep(2)
                async with s.get(f"{GATE}/_orbit/studio/jobs/{job['id']}") as r:
                    job = await r.json()
                pct = job.get("progress") or 0
                await status(f"Making the {what}… {pct}%" if pct else f"Making the {what}…")

        if job.get("status") != "done":
            await status("Not made", True)
            return f"That didn't work: {job.get('error') or job.get('status')}"
        await status("Done", True)
        url = (job.get("item") or {}).get("url") or f"/_orbit/studio/file/{job['id']}"
        if kind == "image":
            return f"![{text[:80]}]({url})\n\n[Open full size]({url}) · [Download]({url}?download=1)"
        secs = job.get("item", {}).get("seconds") or req.get("seconds")
        return (
            f'<video src="{url}" controls playsinline style="max-width:100%;border-radius:12px"></video>\n\n'
            f"[▶ Play the video ({secs} s)]({url}) · [Download]({url}?download=1)"
        )
