# AI machine

Your own open-weights models with a full chat playground, on a Runpod GPU pod that is only on while
you use it.

```
browser ── https ──> gate :8080 ──> Open WebUI 127.0.0.1:8081 ──> Ollama 127.0.0.1:11434 (GPU)
Orbit AI app / coding agent ──> gate :8080 /v1 ──> Ollama (OpenAI-compatible API)
images & videos (playground, Orbit) ──> gate :8080 /_orbit/studio ──> ComfyUI 127.0.0.1:8188 (GPU)
```

- **Playground**: [Open WebUI](https://github.com/open-webui/open-webui) (chat, documents, web search,
  voice, code interpreter, model downloads, side-by-side models). Pinned image
  `ghcr.io/open-webui/open-webui:0.12.2-ollama`, which also runs Ollama on the GPU.
- **Models** (default): `qwen3.8:27b` (general, vision), `qwen3.6:35b` (coding, tool calls) and
  `qwen3.8-obliterated:27b`, the uncensored [OBLITERATUS Qwen3.8-27B V3](https://hf.co/OBLITERATUS/Qwen3.8-27B-OBLITERATED)
  (6-bit GGUF from Hugging Face, with the model card's settings: temperature 0, repetition penalty 1.15).
  Downloaded once and kept in R2; add more from the playground's admin settings, or in `AI_MODELS`
  (`name=source|param=value` installs an outside model under a friendly name with its own settings;
  `|like=<library model>` gives it that model's chat format, so tools such as web search and code work).
- **Image and video maker** (`studio.sh`, `gate/src/studio.js`, `gate/src/workflows.js`): ComfyUI
  (pinned v0.41.2, core nodes only, no add-ons) with a CUDA build of PyTorch, installed once on the
  volume and never exposed. Images: [Qwen-Image 2.1 Uncensored](https://hf.co/abenzerps/Qwen-Image-2.1-Uncensored-Quantized)
  (fp8). Videos with sound, from text or from a photo: LTX-2.3 [10Eros](https://hf.co/TenStrip/LTX2.3-10Eros)
  (fp8 checkpoint, abliterated Gemma text encoder, cond-safe distilled LoRA, 2x upscaler), two passes
  like the official template. About 60 GB of models, downloaded by the gate on first start (resumable).
  - In the playground: **Image maker** and **Video maker** in the model list (a pipe installed by the
    gate) and the built-in image button (`/v1/images/generations` on the gate).
  - In Orbit: the AI app's **Create** tab, with a gallery kept in R2.
  - Video makers from the Store (`workflows.js`, each mirroring a ComfyUI template; `media.js` prepares
    the videos and sounds with ffmpeg first): **LTX-2.5** (gated: needs `HF_TOKEN`, see Set up),
    **Talking photo** (Wan 2.2 S2V), **Wan VACE** (replace a thing named in words with SAM 3.1,
    restyle, extend, move a photo), **Erase from video** (VACE + SAM 3.1, same files) and
    **Sharpen video** (SeedVR2 3B). Videos and sounds are sent to `POST /_orbit/studio/uploads`
    (200 MB / 30 MB) and kept a day in `uploads/`.
  - **Live draw** (Make → Live draw, `gate/src/live.js`, `gate/live_draw_worker.py`): draw with the
    Pencil or a finger and see [pix2pix-turbo](https://github.com/GaParmar/img2img-turbo) (MIT; on
    SD-Turbo, Stability AI Community License) turn it into a picture while you draw. It runs as one
    long-lived Python worker in the studio's venv, started on first use and unloaded after 4 quiet
    minutes; Orbit talks to it over a WebSocket at `/_orbit/live/draw` (the API token as the second
    sub-protocol), or one `POST /_orbit/live/draw` per drawing when the socket can't open. Only the
    newest drawing waits while one is being made. It makes room on the GPU (chat models out, ComfyUI
    freed if idle, a meme-lab video stopped) and lets go before a video job. Every preview counts as
    use for the auto-off timer; an open but unused page does not. **Sketch finish** renders the drawing
    at full quality as a normal ComfyUI job (Z-Image-Turbo + Alibaba PAI's Fun ControlNet Union 2.1,
    from ComfyUI's own Z-Image ControlNet blueprints).
  - **Live video** (Make → Live video, `gate/src/livevideo.js`): the iPad camera, a drawing or just
    words, streamed to the machine over `/_orbit/live/video` (WebSocket, same sign-in) and restyled
    by a prompt you can change while it runs. **StreamDiffusionV2** (1.3B, Apache-2.0) runs as a
    worker (`gate/live_video_worker.py`, its own demo pipeline); **Krea Realtime 14B** (weights
    Apache-2.0, code CC BY-NC-SA 4.0: personal, non-commercial use only) runs as Krea's own server on
    127.0.0.1, reached with msgpack (`msgpack.js`), and is refused unless the GPU has 70 GB+ (the
    Turbo machine). Each gets its own Python (`live_env.sh`: pinned commit, uv, Python 3.11, kept in
    R2), since both pin a different PyTorch than ComfyUI. "Save last 10 s" joins the frames the gate
    sent back with ffmpeg into a gallery video (NSFW check as usual; from the camera it keeps the
    photo rule, which also applies to the words while the camera streams).
  - One content rule, applied by the gate to every request: no sexual content involving minors.
  - Chat models are unloaded from the GPU before a job; ComfyUI frees the GPU 3 minutes after the last one.
- **Gate** (`gate/`, Node, no dependencies): the only exposed port.
  - `/_orbit/login?token=…` swaps a 90-second, single-use token from the site for an HttpOnly cookie,
    then tells Open WebUI who you are with a trusted header it always strips from incoming requests.
  - `/v1/*` forwards to Ollama for bearer tokens from the site (Orbit's AI app) or the Linux machine
    (the coding agent).
  - `/_orbit/status` reports readiness, model downloads and idle time.
  - Turns the pod off after `IDLE_MINUTES` with no job: the site sends its `AUTO_OFF_MINUTES` (60 by
    default, never more; the same rule as the Linux machine, timer in `shared/autooff.js`). Every
    download counts as a job, including models added from the Model store, so the countdown starts
    once all downloads are done. **Keep on** (`/_orbit/keepawake`) adds 30 minutes, up to 2 hours ahead.
  - Ten minutes before it turns off, it sends a Web Push notification (`push.js`, no message body) to every
    device that turned on Settings → Notifications in Orbit; a tap keeps it on 30 more minutes. The
    signing key comes from `GATEWAY_SECRET` (the site derives the same public key in `lib/push.ts`);
    the list of devices is kept in R2. iPhone and iPad need Orbit added to the Home Screen.
- **Site** (`lib/ai.ts`): finds the pod by name (`orbit-ai`), creates it on first use, starts it,
  points a stopped pod at the site's own commit before starting, and replaces it when its host has no
  free GPU (everything worth keeping is in R2).

## Storage: Cloudflare R2, no network volume

The machine has no network volume: its own disk (250 GB, billed only while on) is wiped at every stop,
so everything worth keeping lives in the R2 bucket `orbit-models` (about $0.015/GB a month, no
download fees) and comes back down at start (`gate/src/cloud.js`):

| In R2 | What | Comes back |
| --- | --- | --- |
| `ollama/` | chat models (Ollama's files) | before any model is downloaded |
| `models/` | image and video model files | before the maker needs them |
| `env/studio-*.tar` | the maker's Python environment | before ComfyUI starts |
| `gallery/` | pictures, videos, movies and their notes | notes at once, files when opened |
| `state/` | playground chats (snapshot every 5 min and before turning off), makers, timings | at start |

A model R2 doesn't have yet is downloaded once from its home site (Ollama, Hugging Face) and then kept
in R2. Any machine in any North American data center can pick up where the last one left off, on an
A40 or an RTX A6000 (both 48 GB, $0.59/hour). `AI_STORAGE=volume` with `AI_VOLUME_ID` keeps the old way.

When those are taken, the site keeps looking, cheapest first (`lib/ai.ts`):

1. A40 / RTX A6000 in North America, then anywhere in the world (same price; R2 works from anywhere).
2. Backup 48 GB GPUs, never above $1.10/hour (`AI_MAX_FALLBACK_PRICE`): L40 $0.82, RTX 6000 Ada $0.99,
   L40S $1.09, in North America first, then anywhere.
3. Turbo (H100 $3.99) has its own backups that never cost more than Turbo: A100 80 GB, RTX PRO 6000,
   H100 NVL.

The app says when the machine is on a backup GPU or far away, and the next start tries the usual GPU
in North America first. `AI_WORLDWIDE=off` keeps it in North America.

## Set up

1. Create the R2 bucket `orbit-models` and an R2 API token (Object Read & Write on that bucket).
2. In Runpod add the secrets `r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`.
3. In Vercel set `RUNPOD_API_KEY` and `LINUX_GATEWAY_SECRET` (already used by the Linux machine).
   Optional settings are in `.env.example`.
   - For **LTX-2.5** (its files are gated on Hugging Face): accept the licence at
     [huggingface.co/Lightricks/LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5), make a read token,
     add it in Runpod as the secret `hf_token`, and set `AI_HF_TOKEN_SECRET=hf_token` in Vercel. The
     machine gets it as `HF_TOKEN` (only the gate sees it; Open WebUI and ComfyUI don't). Without it the
     Store shows LTX-2.5 as needing a token and won't start the download.
4. Open **AI playground** on the start screen. The very first start downloads the models from their
   home sites and saves them in R2 (20–30 minutes); later starts bring them back from R2.

## Drawing machine (Live Draw)

Live Draw has its own GPU machine (`lib/canvas.ts`, `/api/canvas`, design in `docs/livedraw/DESIGN.md`):
the pod `<AI_POD_NAME>-canvas`, an H200 (backup: RTX PRO 6000) in any North American data centre with
one free, started with `AI_ROLE=canvas` and `STORAGE=global`. Its drive is a Runpod global volume
(`CANVAS_GLOBAL_VOLUME_ID`, mounted at `/workspace-global`), which belongs to no data centre. Global
volumes are object storage (no locks, no cheap renames, no permission bits), so only whole files go
there: the model files (read straight from it; each download lands on the pod's disk first and is then
copied over) and one tar per Python environment (ComfyUI's, StreamDiffusionV2's, Krea's), unpacked onto
the pod's disk at start. The first start installs and downloads everything; later starts download
nothing. `setup.sh` starts no Open WebUI and no Ollama there. `GALLERY=r2` keeps its pictures and videos
in R2, in the one gallery. It turns itself off by the same rule, and the watchdog and the cost meter
include it.

Set `CANVAS_GLOBAL_VOLUME_ID` in Vercel to turn it on from the site.

## Coding

The Linux machine runs VS Code in the browser (code-server) at `/code/` with the
[Kilo Code](https://github.com/Kilo-Org/kilocode) agent, configured in `~/.config/kilo/kilo.jsonc` to use
`http://127.0.0.1:8090/v1`: the Linux machine's gateway forwards that to the AI machine and asks the site
to turn it on when it's off. See `linux/pod-setup.sh`.
