#!/usr/bin/env bash
# Image and video maker for the AI machine: installs ComfyUI (pinned) with a CUDA build of PyTorch
# on the network volume (once), then keeps it running on 127.0.0.1:8188. With STORAGE=r2 (no volume)
# the installed environment is kept in Cloudflare R2 as one tar and unpacked at start instead; with
# STORAGE=global the tar is kept on the global volume (ENV_STORE) and the model folder is the volume's
# (MODELS_DIR). Started in the background
# by ai/setup.sh. The gate downloads the model files and is the only way in (ComfyUI is never exposed).
#
# Writes $STUDIO_DIR/state: installing | starting | running | error: <reason>
set -uo pipefail

P="${PERSIST_DIR:-/workspace}"
S="${STUDIO_DIR:-$P/studio}"
COMFY_VERSION=v0.41.2
TORCH="torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0"
TORCH_INDEX=https://download.pytorch.org/whl/cu128
# Live draw's worker (gate/live_draw_worker.py: pix2pix-turbo) runs in the same Python; it needs these
# on top of ComfyUI's own packages (transformers, safetensors, Pillow). Pinned: pix2pix-turbo uses
# diffusers.utils.peft_utils.set_weights_and_activate_adapters, still there in 0.37. Live Draw's
# engines (gate/canvas_worker.py) run here too; its sketch reader needs transformers' own Florence-2
# (4.57 or newer).
LIVE="diffusers==0.37.1 peft==0.18.1 transformers>=4.57,<6"
# Swap a person runs on the video wrapper node pack (WRAPPER_REPO below), pinned to one
# commit, with the packages its nodes import beyond ComfyUI's own (the versions it was checked with on
# ComfyUI v0.41.2; OpenCV without its desktop parts, as the machine has no screen).
WRAPPER_REPO=https://github.com/kijai/ComfyUI-WanVideoWrapper
WRAPPER_COMMIT=088128b224242e110d3906c6750e9a3a348a659b
WRAPPER_PIP="ftfy==6.3.1 accelerate==1.15.0 protobuf==7.36.2 pyloudnorm==0.2.0 gguf==0.19.0 opencv-python-headless==5.0.0.93"
STAMP="$COMFY_VERSION $TORCH $LIVE $WRAPPER_COMMIT $WRAPPER_PIP"

log() { echo "[studio] $*"; }
# Each role writes its own state file (the gate's studio.js reads it by role): state, state-helper, state-canvas.
state() { case "${AI_ROLE:-main}" in helper | canvas) echo "$*" > "$S/state-$AI_ROLE" ;; *) echo "$*" > "$S/state" ;; esac; }
mkdir -p "$S"
if [ -n "${MODELS_DIR:-}" ] && [ ! -L "$S/models" ]; then rm -rf "$S/models" && ln -s "$MODELS_DIR" "$S/models"; fi
mkdir -p "$S/models" "$S/input" "$S/output" "$S/pip-cache"
ENV_KEY="env/studio-$(echo "$STAMP" | sha1sum | cut -c1-12).tar"
r2() { "${NODE:-node}" /opt/gate/src/r2cli.js "$@"; }
# The packed environment: on the global volume (ENV_STORE) or in R2. On the volume a tar counts only
# once its .ok mark is written (a half-written one is never unpacked).
packed() { [ "${STORAGE:-volume}" = r2 ] || [ "${STORAGE:-}" = global ]; }
env_get() { if [ -n "${ENV_STORE:-}" ]; then [ -e "$ENV_STORE/$1.ok" ] && tar -xf "$ENV_STORE/$1" -C "$2"; else r2 get-tar "$1" "$2"; fi; }
env_has() { if [ -n "${ENV_STORE:-}" ]; then [ -e "$ENV_STORE/$1.ok" ]; else r2 has "$1"; fi; }
env_put() {
  local key="$1" dir="$2"; shift 2
  if [ -n "${ENV_STORE:-}" ]; then
    mkdir -p "$(dirname "$ENV_STORE/$key")" && tar -cf "$ENV_STORE/$key" -C "$dir" "$@" && touch "$ENV_STORE/$key.ok"
  else r2 put-tar "$key" "$dir" "$@"; fi
}

install() {
  state installing
  if [ ! -x "$S/venv/bin/python" ]; then
    log "creating the Python environment"
    python3 -m venv "$S/venv" || python3 -m venv --without-pip "$S/venv" || return 1
  fi
  # Some base images ship Python without pip's bundled installer: bootstrap it.
  if ! "$S/venv/bin/python" -m pip --version >/dev/null 2>&1; then
    log "installing pip"
    "$S/venv/bin/python" -m ensurepip --upgrade >/dev/null 2>&1 ||
      curl -fsSL https://bootstrap.pypa.io/get-pip.py | "$S/venv/bin/python" - -q || return 1
  fi
  if [ ! -d "$S/ComfyUI/.git" ]; then
    log "downloading ComfyUI $COMFY_VERSION"
    rm -rf "$S/ComfyUI"
    git clone -q --depth 1 --branch "$COMFY_VERSION" https://github.com/comfyanonymous/ComfyUI "$S/ComfyUI" || return 1
  elif [ "$(git -C "$S/ComfyUI" describe --tags 2>/dev/null)" != "$COMFY_VERSION" ]; then
    log "updating ComfyUI to $COMFY_VERSION"
    git -C "$S/ComfyUI" fetch -q --depth 1 origin tag "$COMFY_VERSION" && git -C "$S/ComfyUI" checkout -q "$COMFY_VERSION" || return 1
  fi
  # The video wrapper nodes (Swap a person), at the pinned commit.
  local wrapper="$S/ComfyUI/custom_nodes/ComfyUI-WanVideoWrapper"
  if [ "$(git -C "$wrapper" rev-parse HEAD 2>/dev/null)" != "$WRAPPER_COMMIT" ]; then
    log "downloading the video wrapper nodes"
    rm -rf "$wrapper"
    git init -q "$wrapper" &&
      git -C "$wrapper" fetch -q --depth 1 "$WRAPPER_REPO" "$WRAPPER_COMMIT" &&
      git -C "$wrapper" checkout -q FETCH_HEAD || return 1
  fi
  # Models live outside the ComfyUI folder so an update never touches them.
  if [ ! -L "$S/ComfyUI/models" ]; then
    rm -rf "$S/ComfyUI/models"
    ln -s "$S/models" "$S/ComfyUI/models"
  fi
  if [ "$(cat "$S/venv/.installed" 2>/dev/null)" != "$STAMP" ]; then
    log "installing PyTorch and ComfyUI's packages (first start only, a few minutes)"
    export PIP_CACHE_DIR="$S/pip-cache"
    "$S/venv/bin/python" -m pip install -q --upgrade pip || return 1
    # shellcheck disable=SC2086
    "$S/venv/bin/python" -m pip install -q $TORCH --index-url "$TORCH_INDEX" || return 1
    "$S/venv/bin/python" -m pip install -q -r "$S/ComfyUI/requirements.txt" || return 1
    # shellcheck disable=SC2086
    "$S/venv/bin/python" -m pip install -q $LIVE || return 1
    # shellcheck disable=SC2086
    "$S/venv/bin/python" -m pip install -q $WRAPPER_PIP || return 1
    echo "$STAMP" > "$S/venv/.installed"
  fi
}

# git and the venv module may be missing from the base image.
if ! command -v git >/dev/null || ! python3 -c 'import ensurepip' 2>/dev/null; then
  log "installing git and python venv support"
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3-venv >/dev/null) || true
fi

installed() {
  [ "$(cat "$S/venv/.installed" 2>/dev/null)" = "$STAMP" ] && [ -d "$S/ComfyUI/.git" ] && [ -L "$S/ComfyUI/models" ] &&
    [ "$(git -C "$S/ComfyUI/custom_nodes/ComfyUI-WanVideoWrapper" rev-parse HEAD 2>/dev/null)" = "$WRAPPER_COMMIT" ]
}
if packed && ! installed; then
  state installing
  log "bringing back the maker's environment"
  env_get "$ENV_KEY" "$S" || log "not saved yet: installing it (a few minutes, then saved for next time)"
fi

# On a shared volume a helper machine never installs or updates anything there (two machines
# writing the same files at once could break them); it waits for the main machine. With R2 each
# machine has its own disk and installs for itself. The drawing machine (AI_ROLE=canvas) has a drive
# of its own, so it installs for itself: once, then every later start unpacks it.
SHARED_HELPER=""
if [ "${AI_ROLE:-}" = "helper" ] && [ "${STORAGE:-volume}" != r2 ]; then SHARED_HELPER=1; fi
if [ -n "$SHARED_HELPER" ]; then
  until installed; do
    state "error: waiting for the main AI machine to finish setting up the maker"
    log "maker not set up on the volume yet; the main AI machine does that. Checking again in 60s"
    sleep 60
  done
fi

until [ -n "$SHARED_HELPER" ] || install; do
  state "error: install failed, retrying in 60s"
  log "install failed, retrying in 60s"
  sleep 60
done
if packed && ! env_has "$ENV_KEY"; then
  log "saving the maker's environment for next time"
  (env_put "$ENV_KEY" "$S" venv ComfyUI || log "could not save it; will try at the next start") &
fi

cd "$S/ComfyUI" || exit 1
# Each machine keeps its own ComfyUI settings, database and temp files (ComfyUI empties its temp
# folder on start, and its database must not be shared between two machines).
ROLE_DIR="$S/machine-${AI_ROLE:-main}"
mkdir -p "$ROLE_DIR/user" "$ROLE_DIR/temp"
while true; do
  state starting
  log "starting ComfyUI"
  # Never sees the gate's secrets.
  env -u GATEWAY_SECRET -u RUNPOD_API_KEY -u STUDIO_KEY -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY -u HF_TOKEN \
    "$S/venv/bin/python" main.py --listen 127.0.0.1 --port 8188 \
    --input-directory "$S/input" --output-directory "$S/output" \
    --user-directory "$ROLE_DIR/user" --temp-directory "$ROLE_DIR/temp" \
    --disable-auto-launch --preview-method none &
  pid=$!
  # The gate restarts a frozen ComfyUI by ending this process (this loop then starts a fresh one).
  echo "$pid" > "$ROLE_DIR/comfy.pid"
  for _ in $(seq 1 120); do
    if curl -fsS -o /dev/null http://127.0.0.1:8188/system_stats 2>/dev/null; then state running; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 2
  done
  wait "$pid"
  state "error: ComfyUI stopped, restarting"
  log "ComfyUI exited, restarting in 5s"
  sleep 5
done
