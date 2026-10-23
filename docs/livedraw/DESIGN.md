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
| **Bring to life** | **Animate**: 3 or 5 s clip from the picture (LTX image-to-video). **Living canvas**: the picture keeps moving while you draw (StreamDiffusionV2, fed from the canvas). |

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
| `fast` | the owner's own use, testing | pix2pix-turbo (sketch→image, 1 step) and StreamDiffusion SD-Turbo img2img: the fastest; **non-commercial** licence |
| `licensed` | studio members | SD 1.5 + LCM-LoRA + ControlNet line art / scribble via StreamDiffusion, or SDXL-Lightning + ControlNet; OpenRAIL-style licences that allow commercial use |

The app passes `engine`; the site decides the default per surface (owner: `fast`; studio member:
`licensed`, never overridable by a member).

## 3. The drawing machine

| Item | Value |
|---|---|
| Pod name | `${AI_POD_NAME}-canvas` (e.g. `orbit-ai-canvas`) |
| GPU | `NVIDIA H200` (141 GB): Bring to life is Krea Realtime 14B, which needs H100-class compute to stay ahead of playback; backup: `NVIDIA RTX PRO 6000 Blackwell Server Edition` (96 GB; live drawing as fast, Krea slower) |
| Data centre | any North American one with the GPU free (the AI machine's list; `CANVAS_DATA_CENTERS` overrides) |
| Drive | Runpod **global volume** `orbit-canvas-global` (id `cmvk8h4pt000007jsesbg0k5d`; no data centre, grows as used) mounted at `/workspace-global`; env `CANVAS_GLOBAL_VOLUME_ID` in Vercel |
| Image | same as the AI machine (`AI_IMAGE` / the Open WebUI image) so `setup.sh` runs unchanged; role `AI_ROLE=canvas` |
| Storage | `STORAGE=global`: model files on the drive (`$STUDIO_DIR/models` links to `/workspace-global/models`; downloads land on the pod's disk, `MODEL_STAGE_DIR`, then are copied over, since object storage has no cheap append or rename) and one tar per Python environment (`/workspace-global/env/*.tar`, unpacked onto the pod's 200 GB disk at start). Nothing on the drive may need file locks, so no Hugging Face cache there: every weight comes through the studio catalog. The **gallery** still goes to R2 so pictures appear in the one gallery (`GALLERY=r2`) |
| Power | its own start/stop/status, its own idle auto-off (the one auto-off rule, `lib/autoOff.ts`), its own cost line, in the watchdog |
| Auth | the same signed tokens as the AI machine (audience `orbit-ai`), so Orbit's existing access code works |
| Start target | under 90 s from Start to first live picture on a warm drive |

Blackwell needs PyTorch ≥ 2.7 with CUDA 12.8 everywhere: ComfyUI's venv is already torch 2.11
cu128; StreamDiffusionV2's own venv must move to its Blackwell-supporting commit (torch 2.11).
Krea Realtime 14B (Bring to life) has its own Python from its lockfile (PyTorch 2.8); its SageAttention wheel targets the H100/H200, with a fallback on Blackwell.

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
socket; the client keeps only the newest waiting frame (as `LiveDrawLink` does).

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
  | { type: 'error'; id: number; error: string; blocked?: boolean; paused?: boolean; status?: number }
  | { type: 'state'; engines: Record<'fast' | 'licensed', 'off' | 'loading' | 'ready' | 'error'>; loading?: string };
```

The same body can be POSTed to `/_orbit/canvas/frame` (fallback when sockets are blocked) and
answers one `CanvasReply`. Words go through the gate's content rules (`blockedPrompt`) before a
frame is made.

### 5.2 HTTP

| Route | Method | Body → result |
|---|---|---|
| `/_orbit/canvas` | GET | `{ engines, living: state, animate: state, finish: state, reader: state, gpu: { name, memoryGb } }` |
| `/_orbit/canvas/warm` | POST | `{ engine }` → starts loading it; `{ ok: true }` |
| `/_orbit/canvas/read` | POST | `{ image }` → `{ guesses: { label: string; prompt: string }[] }` (sketch reader, up to 3) |
| `/_orbit/canvas/finish` | POST | `{ image, sketch, prompt, engine, size }` → a studio job (`{ id, status, ... }`, followed with the existing `/_orbit/studio/jobs/:id`) |
| `/_orbit/canvas/animate` | POST | `{ image, prompt, seconds: 3 \| 5, size: 'landscape' \| 'portrait' \| 'square' }` → a studio job |

Living canvas reuses `/_orbit/live/video` (StreamDiffusionV2) with the canvas as its source.

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
