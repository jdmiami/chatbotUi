#!/usr/bin/env bash
# Sets up the Python of a Live video maker, once: its code at a pinned commit and its own packages
# (both pin a PyTorch that differs from ComfyUI's, so they can't share the studio's venv). Started by
# the gate (src/livevideo.js) when the maker is added in the Store; the model files come down
# separately, like every maker's (studio.js). With STORAGE=r2 the finished folder is kept in R2 as
# one tar (STORAGE=global: on the global volume, ENV_STORE) and comes back at the next start instead
# of being installed again.
#
#   live_env.sh sdv2   StreamDiffusionV2 (Apache-2.0): pip install of its checkout, Python 3.11, on
#                      PyTorch 2.11 for CUDA 12.8 (Blackwell GPUs: the drawing machine's RTX PRO 6000)
#   live_env.sh krea   Krea Realtime 14B (code CC BY-NC-SA 4.0): uv sync of its lockfile, Python 3.11,
#                      plus the SageAttention wheel it ships for H100
#   live_env.sh rig    SkinTokens / TokenRig (MIT, VAST): the rigger (bones and skin weights for a 3D
#                      object). Python 3.11, PyTorch 2.7 for CUDA 12.8, its requirements with Blender's
#                      bpy 5.0.1, scipy (its code needs it; its list leaves it out), a prebuilt
#                      flash-attn, and its two checkpoints (about 1.6 GB)
#
#   live_env.sh dfx    Helios (PKU, Apache-2.0) and Waypoint-1.5 (Overworld, Apache-2.0): no code of its
#                      own to download, Diffusers 0.43 (it has Helios's pipeline and the modular one
#                      Waypoint's own code plugs into) on PyTorch 2.11 for CUDA 12.8, Python 3.11
#   live_env.sh longlive  LongLive 1.0 (NVIDIA; code Apache-2.0, weights CC BY-NC-SA 4.0): its code at
#                      a pinned commit and the packages it imports to make video (not its training,
#                      TensorRT or web-demo extras), on PyTorch 2.11 for CUDA 12.8, Python 3.11
#
# Writes $STUDIO_DIR/live-env/<name>/.installed when done (and prints its progress for the gate).
set -uo pipefail

name="${1:?which maker: sdv2 | krea | rig | dfx | longlive}"
S="${STUDIO_DIR:?STUDIO_DIR is required}"
UV_VERSION=0.12.24
# StreamDiffusionV2 pins PyTorch 2.6, which has no kernels for Blackwell GPUs. Its README (Blackwell
# support since 2026-05-17, in the commit below: main as of 2026-09-14) says to use torch 2.11 and
# torchvision 0.26 there; they run on the older GPUs too, so every machine gets them.
SDV2_TORCH="torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0"
TORCH_INDEX=https://download.pytorch.org/whl/cu128
# The rigger: the PyTorch its README names, Blender's bpy (5.0.1 is the newest built for Python 3.11) and
# flash-attn (its model asks for flash_attention_2), a release wheel for that PyTorch and CUDA 12.
RIG_TORCH="torch==2.7.0 torchvision==0.22.0 torchaudio==2.7.0"
RIG_BPY="bpy==5.0.1"
RIG_FLASH=2.8.3
# Its code imports scipy (src/rig_package/info/asset.py) but its requirements.txt leaves it out: without
# it the rigger's Blender helper dies at start and every rig fails after 30 s ("bpy_server failed to start").
RIG_SCIPY="scipy==1.17.1"
# The live makers on Diffusers (Helios, Waypoint) and LongLive: PyTorch 2.11 for CUDA 12.8 like
# StreamDiffusionV2, and the packages each needs, at the versions resolved for it (2026-11-25).
DFX_PKGS="diffusers==0.43.0 transformers==5.24.1 accelerate==1.16.0 safetensors==0.8.0 huggingface-hub==2.4.0 tokenizers==0.23.3 sentencepiece==0.2.3 ftfy==6.3.1 regex==2026.11.24 einops==0.8.2 tensordict==0.15.6 pillow==13.0.0 numpy==2.4.6 imageio==2.38.2"
LL_PKGS="diffusers==0.31.0 transformers==4.57.6 accelerate==1.16.0 safetensors==0.8.0 huggingface-hub==0.36.2 tokenizers==0.22.2 peft==0.22.0 omegaconf==2.4.0 easydict==1.14 einops==0.8.2 ftfy==6.3.1 regex==2026.11.24 sentencepiece==0.2.3 imageio==2.38.2 imageio-ffmpeg==0.8.1 av==18.1.1 opencv-python-headless==5.1.0.95 tqdm==4.70.1 pillow==13.0.0 numpy==2.4.6"
EXTRA=""
case "$name" in
  sdv2) REPO=https://github.com/chenfengxu714/StreamDiffusionV2 COMMIT=6961a5cf2045d1dda05a04ef229698bdc04e873a EXTRA="$SDV2_TORCH cu128" ;;
  krea) REPO=https://github.com/krea-ai/realtime-video COMMIT=acf4b7b4e1a3049a0e04782e751d12203334038d ;;
  rig) REPO=https://github.com/VAST-AI-Research/SkinTokens COMMIT=273b691d35989d71cd17ff2895fdc735097b92d1 EXTRA="$RIG_TORCH $RIG_BPY $RIG_SCIPY flash-attn $RIG_FLASH" ;;
  # No code to download: Diffusers has Helios, and Waypoint's code comes with its model files.
  dfx) REPO="" COMMIT=diffusers-0.43.0 EXTRA="$SDV2_TORCH cu128 $DFX_PKGS" ;;
  longlive) REPO=https://github.com/NVlabs/LongLive COMMIT=31c70d9071cd7851d82939806dc9fac645fcabe5 EXTRA="$SDV2_TORCH cu128 $LL_PKGS" ;;
  *) echo "unknown live maker: $name" >&2; exit 2 ;;
esac
# A new PyTorch changes the stamp, so a Python set up with the old one is set up again.
STAMP="$name $COMMIT uv $UV_VERSION${EXTRA:+ $EXTRA}"
ROOT="$S/live-env"
D="$ROOT/$name"
log() { echo "[live-env $name] $*"; }
installed() { [ "$(cat "$D/.installed" 2>/dev/null)" = "$STAMP" ]; }
installed && exit 0
mkdir -p "$ROOT"
KEY="env/live-$name-$(echo "$STAMP" | sha1sum | cut -c1-12).tar"
r2() { "${NODE:-node}" /opt/gate/src/r2cli.js "$@"; }
# Kept as one tar on the global volume (counted once its .ok mark is there) or in R2.
packed() { [ "${STORAGE:-volume}" = r2 ] || [ "${STORAGE:-}" = global ]; }
env_get() { if [ -n "${ENV_STORE:-}" ]; then [ -e "$ENV_STORE/$1.ok" ] && tar -xf "$ENV_STORE/$1" -C "$2"; else r2 get-tar "$1" "$2"; fi; }
env_put() {
  local key="$1" dir="$2"; shift 2
  if [ -n "${ENV_STORE:-}" ]; then
    mkdir -p "$(dirname "$ENV_STORE/$key")" && tar -cf "$ENV_STORE/$key" -C "$dir" "$@" && touch "$ENV_STORE/$key.ok"
  else r2 put-tar "$key" "$dir" "$@"; fi
}

if packed; then
  log "bringing its Python back"
  if env_get "$KEY" "$ROOT" && installed; then exit 0; fi
fi

# uv: fetches Python 3.11 when the machine has another one, and installs from lockfiles.
UV="$ROOT/uv/bin/uv"
if [ ! -x "$UV" ]; then
  log "installing uv $UV_VERSION"
  python3 -m venv "$ROOT/uv" && "$ROOT/uv/bin/python" -m pip install -q "uv==$UV_VERSION" || exit 1
fi
export UV_CACHE_DIR="$ROOT/uv-cache" UV_PYTHON_INSTALL_DIR="$ROOT/python"

rm -rf "$D" && mkdir -p "$D"
if [ -n "$REPO" ]; then
  log "downloading its code ($COMMIT)"
  git clone -q "$REPO" "$D/src" && git -C "$D/src" checkout -q "$COMMIT" || exit 1
else
  mkdir -p "$D/src"
fi

if [ "$name" = rig ]; then
  log "installing its packages (PyTorch 2.7, Blender's bpy and friends: a few minutes)"
  PY="$D/src/.venv/bin/python"
  "$UV" venv -q --python 3.11 "$D/src/.venv" || exit 1
  # shellcheck disable=SC2086
  "$UV" pip install -q --python "$PY" --index-url "$TORCH_INDEX" $RIG_TORCH || exit 1
  # Its requirements ask for bpy>=4.2 and any PyTorch: keep these exact ones.
  # shellcheck disable=SC2086
  printf '%s\n' $RIG_TORCH "$RIG_BPY" > "$D/pins.txt"
  "$UV" pip install -q --python "$PY" --override "$D/pins.txt" -r "$D/src/requirements.txt" "$RIG_BPY" "$RIG_SCIPY" || exit 1
  # flash-attn from its own release: the wheel built for this PyTorch's C++ ABI.
  ABI=$("$PY" -c 'import torch; print("TRUE" if torch._C._GLIBCXX_USE_CXX11_ABI else "FALSE")') || exit 1
  WHEEL="flash_attn-$RIG_FLASH+cu12torch2.7cxx11abi$ABI-cp311-cp311-linux_x86_64.whl"
  "$UV" pip install -q --python "$PY" "https://github.com/Dao-AILab/flash-attention/releases/download/v$RIG_FLASH/$WHEEL" || exit 1
  # Everything its two programs need at start is there (a missing one fails every rig, not the set-up).
  "$PY" -c 'import bpy, scipy, open3d, trimesh, lightning, transformers' || exit 1
  log "downloading its checkpoints (about 1.6 GB)"
  (cd "$D/src" && "$PY" download.py --model) || exit 1
elif [ "$name" = dfx ] || [ "$name" = longlive ]; then
  log "installing its packages (PyTorch 2.11 for CUDA 12.8 and friends: a few minutes)"
  PY="$D/src/.venv/bin/python"
  "$UV" venv -q --python 3.11 "$D/src/.venv" || exit 1
  # shellcheck disable=SC2086
  "$UV" pip install -q --python "$PY" --index-url "$TORCH_INDEX" $SDV2_TORCH || exit 1
  # shellcheck disable=SC2086
  printf '%s\n' $SDV2_TORCH > "$D/torch-override.txt"
  if [ "$name" = dfx ]; then PKGS="$DFX_PKGS"; else PKGS="$LL_PKGS"; fi
  # shellcheck disable=SC2086
  "$UV" pip install -q --python "$PY" --override "$D/torch-override.txt" $PKGS || exit 1
  # What the worker (live_gen_worker.py) imports at start is all there.
  if [ "$name" = dfx ]; then
    "$PY" -c 'import torch, diffusers, transformers, tensordict, einops; from diffusers import HeliosPyramidPipeline; from diffusers.modular_pipelines import ModularPipeline' || exit 1
  else
    (cd "$D/src/LongLive1.0" && "$PY" -c 'import torch, peft, omegaconf, diffusers; from pipeline.interactive_causal_inference import InteractiveCausalInferencePipeline') || exit 1
  fi
elif [ "$name" = sdv2 ]; then
  log "installing its packages (PyTorch 2.11 for CUDA 12.8 and friends: a few minutes)"
  PY="$D/src/.venv/bin/python"
  "$UV" venv -q --python 3.11 "$D/src/.venv" || exit 1
  # PyTorch first, from PyTorch's own CUDA 12.8 index; the override keeps it when the package (which
  # asks for 2.6) installs.
  # shellcheck disable=SC2086
  "$UV" pip install -q --python "$PY" --index-url "$TORCH_INDEX" $SDV2_TORCH || exit 1
  # shellcheck disable=SC2086
  printf '%s\n' $SDV2_TORCH > "$D/torch-override.txt"
  "$UV" pip install -q --python "$PY" --override "$D/torch-override.txt" "$D/src" || exit 1
  # If the package install swapped in another PyTorch build anyway, put the CUDA 12.8 one back.
  if ! "$PY" -c 'import sys, torch; sys.exit(0 if torch.version.cuda == "12.8" else 1)'; then
    log "putting back PyTorch for CUDA 12.8"
    # shellcheck disable=SC2086
    "$UV" pip install -q --python "$PY" --index-url "$TORCH_INDEX" --reinstall $SDV2_TORCH || exit 1
  fi
else
  log "installing its packages from its lockfile (PyTorch 2.8 and friends: a few minutes)"
  # OpenAI's CLIP (pinned by Krea from git) builds with setup.py and imports pkg_resources, which
  # setuptools 81 removed, and a frozen sync ignores build settings outside the lockfile. So it is
  # built first with an older setuptools into uv's cache, where the sync below finds it ready.
  CLIP=$(sed -n 's/^clip = { git = "\([^"]*\)", rev = "\([^"]*\)".*/\1@\2/p' "$D/src/pyproject.toml")
  if [ -n "$CLIP" ]; then
    "$UV" venv -q --python 3.11 "$ROOT/clip-build" &&
      "$UV" pip install -q --python "$ROOT/clip-build/bin/python" "setuptools<81" wheel &&
      "$UV" pip install -q --python "$ROOT/clip-build/bin/python" --no-deps --no-build-isolation "clip @ git+$CLIP" || exit 1
    rm -rf "$ROOT/clip-build"
  fi
  (cd "$D/src" && "$UV" sync -q --frozen --python 3.11) || exit 1
  # Its lockfile's PyTorch 2.8 (CUDA 12.8 wheels from PyPI) runs on Hopper (H100/H200) and Blackwell.
  # The SageAttention wheel it ships is built for Hopper: on the H200 Krea uses it; on another card
  # (the drawing machine's RTX PRO 6000 Blackwell backup) the gate tries it once before starting Krea
  # (livevideo.js sageWorks) and, when it has no kernel there, starts Krea with
  # DISABLE_SAGEATTENTION=1, which Krea's own code turns into PyTorch's scaled_dot_product_attention.
  "$UV" pip install -q --python "$D/src/.venv/bin/python" "$D/src/libs/sageattention-2.2.1-cp311-cp311-linux_x86_64.whl" || exit 1
  "$UV" pip install -q --python "$D/src/.venv/bin/python" "uvicorn==0.37.0" || true
fi

echo "$STAMP" > "$D/.installed"
log "ready"
if packed; then
  log "keeping it for next time"
  # uv's own Python only exists when the machine's Python wasn't 3.11 (it was fetched then).
  keep="$name"; [ -d "$ROOT/python" ] && keep="$name python"
  # shellcheck disable=SC2086
  env_put "$KEY" "$ROOT" $keep || log "could not keep it; it installs again at the next start"
fi
