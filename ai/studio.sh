#!/usr/bin/env bash
# Image and video maker for the AI machine: installs ComfyUI (pinned) with a CUDA build of PyTorch
# on the network volume (once), then keeps it running on 127.0.0.1:8188. Started in the background
# by ai/setup.sh. The gate downloads the model files and is the only way in (ComfyUI is never exposed).
#
# Writes $STUDIO_DIR/state: installing | starting | running | error: <reason>
set -uo pipefail

P="${PERSIST_DIR:-/workspace}"
S="${STUDIO_DIR:-$P/studio}"
COMFY_VERSION=v0.41.2
TORCH="torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0"
TORCH_INDEX=https://download.pytorch.org/whl/cu128
STAMP="$COMFY_VERSION $TORCH"

log() { echo "[studio] $*"; }
state() { if [ "${AI_ROLE:-main}" = "helper" ]; then echo "$*" > "$S/state-helper"; else echo "$*" > "$S/state"; fi; }
mkdir -p "$S/models" "$S/input" "$S/output" "$S/pip-cache"

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
    echo "$STAMP" > "$S/venv/.installed"
  fi
}

# git and the venv module may be missing from the base image.
if ! command -v git >/dev/null || ! python3 -c 'import ensurepip' 2>/dev/null; then
  log "installing git and python venv support"
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3-venv >/dev/null) || true
fi

# A helper machine shares the main machine's volume: it never installs or updates anything there
# (two machines writing the same files at once could break them); it waits for the main machine.
installed() { [ "$(cat "$S/venv/.installed" 2>/dev/null)" = "$STAMP" ] && [ -d "$S/ComfyUI/.git" ] && [ -L "$S/ComfyUI/models" ]; }
if [ "${AI_ROLE:-}" = "helper" ]; then
  until installed; do
    state "error: waiting for the main AI machine to finish setting up the maker"
    log "maker not set up on the volume yet; the main AI machine does that. Checking again in 60s"
    sleep 60
  done
fi

until [ "${AI_ROLE:-}" = "helper" ] || install; do
  state "error: install failed, retrying in 60s"
  log "install failed, retrying in 60s"
  sleep 60
done

cd "$S/ComfyUI" || exit 1
# Each machine keeps its own ComfyUI settings, database and temp files (ComfyUI empties its temp
# folder on start, and its database must not be shared between two machines).
ROLE_DIR="$S/machine-${AI_ROLE:-main}"
mkdir -p "$ROLE_DIR/user" "$ROLE_DIR/temp"
while true; do
  state starting
  log "starting ComfyUI"
  # Never sees the gate's secrets.
  env -u GATEWAY_SECRET -u RUNPOD_API_KEY -u STUDIO_KEY \
    "$S/venv/bin/python" main.py --listen 127.0.0.1 --port 8188 \
    --input-directory "$S/input" --output-directory "$S/output" \
    --user-directory "$ROLE_DIR/user" --temp-directory "$ROLE_DIR/temp" \
    --disable-auto-launch --preview-method none &
  pid=$!
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
