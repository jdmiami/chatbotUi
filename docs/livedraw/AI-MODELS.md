# Live Draw: AI models for the co-artist and motion phases

Researched 2026-10-23 (no GPU runs yet: speeds are estimates unless marked published). `fast` = the
owner's engine (any licence); `licensed` = studio members' engine (commercial use must be allowed).

## Key findings

- **Z-Image + Union 2602 is already installed** (`sketch-finish`: `alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1`
  @`5155fc56`, the `…-2602-8steps` file). It does Canny, Depth, Pose, MLSD, HED, Scribble, Gray and
  inpainting: features 1–5 need no new download. ComfyUI: built-in `ZImageFunControlnet`; diffusers 0.37:
  `ZImageInpaintPipeline`, `ZImageControlNetPipeline`, `ZImageControlNetInpaintPipeline`.
- **FLUX.2 klein 4B costs ~8 GB**: its text encoder `qwen_3_4b.safetensors` is byte-identical to Z-Image's.
- **The Wan 2.1 T5 and VAE** (`models_t5_umt5-xxl-enc-bf16.pth`, `Wan2.1_VAE.pth`) are already on the drive
  (live-sdv2 / live-krea) and are shared with ToonComposer and Wan-Move's official repo.
- **Krea Realtime and StreamDiffusionV2 take no motion masks or tracks** (whole-frame strength only). A motion
  brush on them can only be approximated by warping the painted region in the input frames.

## Picks

| # | Feature | Pick (both engines unless noted) | Repo @ revision | Licence | Extra disk | VRAM | H200 (est.) | Run with | Main risk |
|---|---|---|---|---|---|---|---|---|---|
| 1 | AI brushes | FLUX.2 [klein] 4B masked img2img, 4 steps; fallback Z-Image Union inpaint | `black-forest-labs/FLUX.2-klein-4B` @`e7b7dc27`; ComfyUI `Comfy-Org/Flux-2-Klein-4B` @`533c4cbc` | Apache 2.0 | 8.1 GB | ~13 GB | ~0.4–0.6 s @1024², ~0.15 s on a 512² crop | diffusers `Flux2KleinPipeline` + latent mask blend, or ComfyUI `SetLatentNoiseMask` | no trained inpaint: feather the mask, fall back to Z-Image |
| 2 | Sketch → line art → flats + shading | Anyline MTEED → Z-Image Union Scribble/HED redraw → MTEED; flats from the user's palette in the app; light Z-Image shading pass, palette-snapped in the app | `TheMistoAI/MistoLine` @`1d9d0b3d` (`Anyline/MTEED.pth`) + installed Z-Image | openrail++ / Apache 2.0 | ~0 | 25–30 GB (shared) | MTEED <20 ms; redraw ~1–1.5 s | ComfyUI `ZImageFunControlnet` + comfyui_controlnet_aux `AnyLineArtPreprocessor_aux` @`a587a4c1` | palette fidelity comes from the app's snapping. Owner-only extra: FLUX.2-klein-base-9B + manga colorization LoRA (base is non-commercial, gated, slow) |
| 3a | Fix a spot with words | Members: Z-Image Union inpaint (installed). Owner: Qwen-Image-2.1-Turbo | Owner: `Comfy-Org/Qwen-Image-2.1` @`0217efd1` | Qwen: non-commercial ("research or evaluation purposes only") — owner only | 0 / 17.3 GB | 25–30 / ~20 GB | ~1–1.5 s / ~2–4 s | ComfyUI only (its diffusers route conflicts with our stack) | Qwen's licence wording is a grey area even for personal use |
| 3b | Relight from a movable light | IC-Light v1 `fc` on SD 1.5, radial light-map from the light position as the initial latent | `lllyasviel/ic-light` @`9cad1878`; code `lllyasviel/IC-Light` @`bcf3f29c` | creativeml-openrail-m; code Apache 2.0 | 1.7 GB | ~5 GB | ~1.5–2.5 s | diffusers in `canvas_worker` | trained on photos (art varies). Use `ZhengPeng7/BiRefNet` (MIT), not RMBG-1.4 (non-commercial). `jasperai/LBM_relighting` rejected (cc-by-nc-4.0) |
| 4 | Ghost strokes ("finish my drawing") | No new model: low-strength pass on the sketch (fast: pix2pix-turbo; members: SD 1.5 + LCM + line-art ControlNet) → MTEED → subtract the user's strokes → vectorize the rest as ghosts | installed + MTEED | as above | ~0 | 6–9 GB | ~50–200 ms @512² | `canvas_worker` | no open sketch-completion weights exist; suggestions follow the AI picture |
| 5 | 3D pose & perspective | three.js renders the controls (z-buffer depth, OpenPose from joints, perspective lines as MLSD). Live: SD 1.5 ControlNet 1.1 depth / normalbae / mlsd (+ installed openpose). Finish: Z-Image Union depth/pose/MLSD | `lllyasviel/control_v11f1p_sd15_depth` @`539f9918`, `…_normalbae` @`cb7296e6`, `…_mlsd` @`f6d481b1` | openrail | ~2.2 GB | +0.7 GB each | live ~0.1–0.2 s @512; Finish ~1–1.5 s | diffusers multi-ControlNet; ComfyUI for Finish | renders must match each ControlNet's conventions; no normal control in Z-Image Union |
| 6 | In-between frames | ToonComposer (sketch keyframes + one colour keyframe → coloured in-betweens) on Wan2.1-I2V-14B-480P | `TencentARC/ToonComposer` @`a166c2c0` + `Wan-AI/Wan2.1-I2V-14B-480P` @`6b73f84e` | MIT (+ Wan Apache 2.0) | 70.7 GB | ~57 GB | ~2–4 min per clip | own Python env (like krea/sdv2) | can't run beside Krea on the 96 GB card; 480p/608p only. Lighter fallback: Wan 2.2 first/last frame (Apache) |
| 7 | Motion brush | Wan-Move 14B 480P: points in the painted region follow the painted path, background points pinned | `Ruihang/Wan-Move-14B-480P` @`63a21fd3`; ComfyUI fp8 `Kijai/WanVideo_comfy_fp8_scaled` @`033a4e48` + `Comfy-Org/Wan-2.1` @`123acf1c` encoders + lightx2v 480p LoRA | Apache 2.0 | 25.4 GB | ~30–40 GB | ~45–90 s per 5 s clip (4-step LoRA) | ComfyUI `WanMoveTracksFromCoords` + `WanMoveTrackToVideo` | track-driven, unpainted areas may drift; exact-mask option: Time-to-Move on Wan2.2-I2V-A14B (+30 GB) |

Rejected: FLUX.3 klein (revenue cap under US$5M), FLUX.1 Fill dev (non-commercial), LTX-2.3 Motion-Track
IC-LoRA (revenue cap; base not installed).

## Disk

Core set (klein 8.1 + MTEED + IC-Light 1.7 + SD 1.5 ControlNets 2.2 + ToonComposer 70.7 + Wan-Move 25.4):
**~108 GB**. With owner-only Qwen-Image-2.1-Turbo: ~125 GB. With optional TTM / Wan 2.2 first-last-frame:
~155 GB. ToonComposer's own Python env comes on top.

## Install order

1. Free wins on the installed Z-Image Union 2602 (inpaint, scribble, depth/pose/MLSD) + MTEED: line art,
   members' "fix a spot", ghost strokes and Finish posing for ~0 GB.
2. SD 1.5 depth/normal/MLSD ControlNets (2.2 GB) for the live mannequin; IC-Light fc (1.7 GB) with BiRefNet.
3. FLUX.2 klein 4B (8.1 GB) for sub-second AI brushes.
4. Animation: Wan-Move (25 GB) for the motion brush, then ToonComposer (71 GB) for in-betweens; test its
   57 GB footprint against Krea on the RTX PRO 6000 before enabling both there.
5. Optional: the owner's Qwen-Image-2.1-Turbo (17 GB) and TTM / Wan 2.2 (30 GB). Measure every speed on the H200.

Open questions: every ComfyUI node above in v0.41.2; Union 2602 through diffusers `from_single_file`;
whether ToonComposer can load a bf16 base (saves ~33 GB).
