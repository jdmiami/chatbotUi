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
#
# Writes $STUDIO_DIR/live-env/<name>/.installed when done (and prints its progress for the gate).
set -uo pipefail

name="${1:?which maker: sdv2 | krea}"
S="${STUDIO_DIR:?STUDIO_DIR is required}"
UV_VERSION=0.12.24
# StreamDiffusionV2 pins PyTorch 2.6, which has no kernels for Blackwell GPUs. Its README (Blackwell
# support since 2026-05-17, in the commit below: main as of 2026-09-14) says to use torch 2.11 and
# torchvision 0.26 there; they run on the older GPUs too, so every machine gets them.
SDV2_TORCH="torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0"
TORCH_INDEX=https://download.pytorch.org/whl/cu128
EXTRA=""
case "$name" in
  sdv2) REPO=https://github.com/chenfengxu714/StreamDiffusionV2 COMMIT=6961a5cf2045d1dda05a04ef229698bdc04e873a EXTRA="$SDV2_TORCH cu128" ;;
  krea) REPO=https://github.com/krea-ai/realtime-video COMMIT=acf4b7b4e1a3049a0e04782e751d12203334038d ;;
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
log "downloading its code ($COMMIT)"
git clone -q "$REPO" "$D/src" && git -C "$D/src" checkout -q "$COMMIT" || exit 1

if [ "$name" = sdv2 ]; then
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
