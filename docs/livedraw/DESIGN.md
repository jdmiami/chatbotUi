# Live Draw: design and contracts

Live Draw is an app of its own (Orbit app id `livedraw`), with its own GPU machine (the **drawing
machine**). It replaces Live draw and Live video inside Make; Make keeps one "Draw it" entry that
opens Live Draw.

This document is the contract the three parts build against: **machine** (site + pod setup),
**engines** (gate + Python workers on the drawing machine) and **app** (Orbit UI). Change it only
together.

## 1. What the person sees

One canvas. The AI picture is drawn *under* your strokes; an **Ink** slider fades your strokes from
fully visible to hidden. Four modes on the same canvas:

| Mode | What happens |
|---|---|
| **Live** | Every stroke sends the sketch; the picture under it follows (target 8–20 updates/s). |
| **Paint over** | Brush on the picture: only the painted area changes (mask), the rest is held. |
| **Keep** | Freezes the current picture as the new base layer; strokes continue on top of it. |
| **Bring to life** | **Animate**: the picture comes to life as live video, generated faster than it plays and streamed back, starting from the kept picture and following the canvas while you keep drawing; the words steer it, a slider sets how much may change, and "Save last 10 s" puts the clip in the gallery (Krea Realtime 14B for the owner; StreamDiffusionV2 for studio members, since Krea's code is non-commercial). **Living canvas**: the picture keeps moving while you draw (StreamDiffusionV2, fed from the canvas). |

Tools: pen, pencil, marker, airbrush, eraser, fill; colour picker; size; Apple Pencil pressure and
tilt (reuse `orbit/src/apps/ai/sketch.ts`). Layers: Sketch, Colour (rough colour blocks), Picture
(AI), Reference (image, optional). History strip (every returned picture, scrub and restore),
time-lapse export (client-side, from the history), PNG export and layered PSD export (`ag-psd`).

Pro: **Regions** (lasso + its own words), **Pose** (drag a stick-figure mannequin → OpenPose image),
**Style reference** (an image whose style is matched, IP-Adapter), **Finish** (full-quality render,
lands in the gallery), **Sketch reader** (the orb looks at the sketch and suggests what it is and a
prompt; tap to use).

## 2. Two engine sets, switchable

| Engine | Use | Models (initial; licences re-checked before members use them) |
|---|---|---|
| `fast` | the owner's own use, testing | pix2pix-turbo (sketch→image, 1 step) for a sketch alone; SD-Turbo img2img (1 step) once there is colour or a kept picture; TAESD decoder. SD-Turbo is under the Stability AI Community License: **not for members** (commercial use only after registering, under US$1M revenue) |
| `licensed` | studio members | SD 1.5 + LCM-LoRA (fused, 4 steps) + ControlNet 1.1 line art (+ openpose for Pose) + IP-Adapter sd15 (Style reference) + TAESD; OpenRAIL-M / OpenRAIL++ / OpenRAIL / Apache-2.0 / MIT: commercial use allowed |

Both run in one worker (`ai/gate/canvas_worker.py`, the studio's Python) with StreamDiffusion's tricks
(cached prompt embeddings, tiny VAE, one-step / LCM sampling, optional `torch.compile`) on plain
diffusers; the StreamDiffusion package itself is not used (it pins an old diffusers). Once loaded,
both stay loaded. Fast answers Pose and Style reference with a plain error ("Pose works with the
Members engine."); Regions work on both (one extra masked img2img pass per region). Models and
licences in detail: the comment at the top of `canvas_worker.py`.

The app passes `engine`; the site decides the default per surface (owner: `fast`; studio member:
`licensed`, never overridable by a member).

## 3. The drawing machine

| Item | Value |
|---|---|
| Pod name | `${AI_POD_NAME}-canvas` (e.g. `orbit-ai-canvas`) |
| GPU | `NVIDIA H200` (141 GB): Bring to life is Krea Realtime 14B, which needs H100-class compute to stay ahead of playback; backup in the same data centre: `NVIDIA RTX PRO 6000 Blackwell Server Edition` (96 GB; live drawing as fast, Krea slower) |
| Data centre | the drive's: `US-NC-1` (closest with stock to the owner in Miami) |
| Drive | Runpod network volume `orbit-canvas` (id `zgja8ch0hz`, 200 GB, STANDARD, US-NC-1) mounted at `/workspace`; env `CANVAS_VOLUME_ID` in Vercel |
| Image | same as the AI machine (`AI_IMAGE` / the Open WebUI image) so `setup.sh` runs unchanged; role `AI_ROLE=canvas` |
| Storage | `STORAGE=volume` for software and models (fast start, nothing downloads twice); the **gallery** still goes to R2 so pictures appear in the one gallery (`GALLERY=r2`) |
| Power | its own start/stop/status, its own idle auto-off (the one auto-off rule, `lib/autoOff.ts`), its own cost line, in the watchdog |
| Auth | the same signed tokens as the AI machine (audience `orbit-ai`), so Orbit's existing access code works |
| Start target | under 90 s from Start to first live picture on a warm drive |
| Makers | the studio keeps only `CANVAS_MAKERS` (default `canvas-fast,canvas-licensed,canvas-reader,sketch-finish,live-sdv2,live-krea`, in download order); every model file comes through the catalog (`ai/gate/catalog.json`) onto the drive, the workers only read them (no Hugging Face cache) |

Both cards run PyTorch with CUDA 12.8: ComfyUI's venv (and so the Live Draw engines) is torch 2.11
cu128, StreamDiffusionV2's own venv torch 2.11 cu128, Krea's own venv its lockfile's torch 2.8 (CUDA
12.8 wheels). Krea Realtime 14B is installed here (`live-krea`); its Turbo-machine rule becomes "40 GB
of GPU memory" on this machine, which both cards pass. Attention: Krea ships SageAttention 2.2.1 built
for Hopper, so the H200 uses it; before starting Krea the gate runs one tiny SageAttention call with
Krea's Python, and where it has no kernel (the RTX PRO 6000 Blackwell) starts Krea with
`DISABLE_SAGEATTENTION=1`, which Krea's code turns into PyTorch's `scaled_dot_product_attention`.

## 4. Site API (machine part)

| Route | Method | Body / result |
|---|---|---|
| `/api/canvas` | GET | `{ state: 'unconfigured'\|'off'\|'starting'\|'downloading'\|'on'\|'error', pricePerHour, costPerHour, gpu, autoOffMinutes, idle, detail? }` |
| `/api/canvas` | POST | `{ action: 'start' \| 'stop' }` → the same status |
| `/api/canvas/token` | POST | `{ status, url: string\|null, token: string\|null, expiresIn: 3600, engine: 'fast'\|'licensed' }` |

`url` is the drawing machine's gate base (`https://<pod>-8080.proxy.runpod.net`), only when `on`.

## 5. Drawing machine API (engines part), all behind the gate's sign-in

### 5.1 Live picture: WebSocket `/_orbit/canvas/live`

Sub-protocols `['orbit-live', token]` (as `/_orbit/live/draw` today). Only one frame in flight per
socket; the client keeps only the newest waiting frame (as `LiveDrawLink` does). The machine applies
the same rule per socket: a frame that arrives while one is being made waits, and a newer one replaces
it (the replaced one answers `{ type: 'dropped', id }`).

Studio members use `/_studio/canvas/live` with `['orbit-live', memberKey]` (audience `studio-member`):
the engine is always `licensed` whatever the frame says, and `ref` is refused (403: no pictures of
their own go to the machine). Client → machine messages also include `{ type: 'warm', engine }` and
`{ type: 'state' }` (both answer a `state` message).

Client → machine (JSON, one per message):

```ts
interface CanvasFrame {
  type: 'frame';
  id: number;                 // echoed back
  engine: 'fast' | 'licensed';
  mode: 'live' | 'paint';
  prompt: string;             // words + style words, already joined by the app
  seed: number;
  follow: number;             // 0..1  how closely to follow the lines
  strength: number;           // 0..1  how much may change (img2img denoise)
  size: 512 | 768 | 1024;     // square; the app letterboxes
  sketch: string;             // PNG data URL: strokes on transparent
  color?: string;             // PNG data URL: colour blocks on transparent
  base?: string;              // PNG/WebP data URL: the kept picture (Keep / Paint over)
  mask?: string;              // PNG data URL: white = may change (Paint over)
  regions?: { mask: string; prompt: string }[];   // pro
  pose?: string;              // PNG data URL: OpenPose skeleton render (pro)
  ref?: { image: string; weight: number };        // style reference (pro)
}
```

Machine → client:

```ts
type CanvasReply =
  | { type: 'frame'; id: number; image: string /* data:image/webp */; ms: number }
  | { type: 'dropped'; id: number }   // replaced by a newer frame before it was made
  | { type: 'error'; id: number; error: string; blocked?: boolean; paused?: boolean; loading?: boolean; status?: number }
  | { type: 'state'; engines: Record<'fast' | 'licensed', 'off' | 'loading' | 'ready' | 'error'>; loading?: string; errors?: Partial<Record<'fast' | 'licensed', string>> };
```

A `state` message arrives when the socket opens and whenever an engine's state or loading text
changes. A frame for an engine that isn't loaded yet starts loading it and answers an `error` with
`loading: true` (status 503); the socket remembers that frame (the newest only) and answers it with a
`frame` as soon as the engine is ready, without the app sending it again. Statuses: 400 bad request
(including the plain "Pose works with the Members engine."), 403 member sent `ref`, 409 paused, 413
too large, 422 content rules (`blocked: true`), 503 loading / engine problem, 504 too slow.

The same body can be POSTed to `/_orbit/canvas/frame` (members: `/_studio/canvas/frame`, fallback
when sockets are blocked) and answers one `CanvasReply` as JSON (HTTP status = its `status`). Words
go through the gate's content rules (`blockedPrompt`) before a frame is made: the prompt, each
region's prompt and all of them together; with a style reference, the photo rule (`blockedForPhoto`)
too.

### 5.2 HTTP

| Route | Method | Body → result |
|---|---|---|
| `/_orbit/canvas` | GET | `{ engines, living: state, animate: state, finish: state, reader: state, gpu: { name, memoryGb } \| null, lastMs, lastFrameAt, paused, loading?, detail? }`; each `state` is `'off' \| 'loading' \| 'ready' \| 'error'`, `detail` says why for any that is loading or in error |
| `/_orbit/canvas/warm` | POST | `{ engine }` → starts loading it; `{ ok: true }` (`{ ok: false, paused }` while paused) |
| `/_orbit/canvas/frame` | POST | a `CanvasFrame` → one `CanvasReply` (the socket's fallback) |
| `/_orbit/canvas/read` | POST | `{ image }` → `{ guesses: { label: string; prompt: string }[] }` (sketch reader, up to 3) |
| `/_orbit/canvas/finish` | POST | `{ image, sketch, prompt, engine, size: 'square' \| 'portrait' \| 'landscape', follow?, strength? }` → a studio job (`{ id, status, ... }`, followed with the existing `/_orbit/studio/jobs/:id`). Sketch finish (Z-Image + ControlNet): `image` (the canvas as it looks) is where it starts (img2img, `strength` 0.3–1, default 0.7), `sketch` (strokes on transparent, laid on white) is the line control, `follow` its strength |

Studio members have the same routes under `/_studio/canvas` (GET, `/warm`, `/frame`, `/read`,
`/finish`) with their member key: always the licensed engine, no `ref`, their Finish is tagged with
them and followed at `/_studio/jobs/:id`. `/_orbit/status` carries `canvas: { fast, licensed }` (the
engines' states) so the site can show "warming up".

**Bring to life** is live video, not a job: `/_orbit/live/video` (WebSocket, `livevideo.js`). Animate:
`{ type: 'start', maker: 'live-krea', source: 'canvas', prompt, strength, image }` where `image` is
the kept picture (JPEG/PNG/WebP data URL, opaque: transparent pixels count as black for Krea); the
machine sends it again and again (8 a second) while the page sends nothing newer, then
`{ type: 'frame', image }` canvas frames while the person draws (the last one is held when they stop);
`{ type: 'still', image }` replaces the held picture; `{ type: 'save' }` saves the last 10 s. Studio
members use `/_studio/canvas/video` (member key), which forces `live-sdv2` and the canvas as source and
tags the saved clip with them. Living canvas is the same with `maker: 'live-sdv2'`.

## 6. The app (Orbit)

- `orbit/src/apps/livedraw/`: `LiveDrawApp.tsx` (registered in `apps/registry.tsx`, icon art in
  `ui/AppArt.tsx`), `canvas/*` (layers, tools, pointer + pencil input, history, time-lapse, export),
  `services/livedraw.ts` (site API + socket link, built from `services/ai/liveDraw.ts`).
- Machine card on first open: price per hour, Start, the start progress, auto-off note.
- The orb: `data-orb-spot` on the primary action of each state; `orbNote` explains the mode; the
  sketch reader's guesses appear as choices the orb sits on (OrbitDesign `Choices` look).
- Make: remove the Live draw and Live video tabs; add a "Draw it" row that opens `livedraw`.
- Phone and tablet first: iPad landscape is the main canvas; iPhone gets a full-screen canvas with
  tools in a bottom sheet.

## 7. Done means

- The drawing machine starts from the site, shows its price, auto-offs, and appears in the cost
  meter and watchdog.
- On the real GPU: first live picture < 90 s after Start on a warm drive; live updates ≥ 8/s at 512.
- Live, Paint over, Keep, Animate, Living canvas, Finish, Sketch reader all work end to end.
- Make no longer carries Live draw or Live video.
- Site typecheck, gate tests, Orbit typecheck + unit tests pass; Playwright on iPad and iPhone sizes.
