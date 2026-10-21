#!/usr/bin/env bash
# Sets up the Python of a Live video maker, once: its code at a pinned commit and its own packages
# (both pin a PyTorch that differs from ComfyUI's, so they can't share the studio's venv). Started by
# the gate (src/livevideo.js) when the maker is added in the Store; the model files come down
# separately, like every maker's (studio.js). With STORAGE=r2 the finished folder is kept in R2 as
# one tar and comes back at the next start instead of being installed again.
#
#   live_env.sh sdv2   StreamDiffusionV2 (Apache-2.0): pip install of its checkout, Python 3.11
#   live_env.sh krea   Krea Realtime 14B (code CC BY-NC-SA 4.0): uv sync of its lockfile, Python 3.11,
#                      plus the SageAttention wheel it ships for H100
#
# Writes $STUDIO_DIR/live-env/<name>/.installed when done (and prints its progress for the gate).
set -uo pipefail

name="${1:?which maker: sdv2 | krea}"
S="${STUDIO_DIR:?STUDIO_DIR is required}"
UV_VERSION=0.12.24
case "$name" in
  sdv2) REPO=https://github.com/chenfengxu714/StreamDiffusionV2 COMMIT=6961a5cf2045d1dda05a04ef229698bdc04e873a ;;
  krea) REPO=https://github.com/krea-ai/realtime-video COMMIT=acf4b7b4e1a3049a0e04782e751d12203334038d ;;
  *) echo "unknown live maker: $name" >&2; exit 2 ;;
esac
STAMP="$name $COMMIT uv $UV_VERSION"
ROOT="$S/live-env"
D="$ROOT/$name"
log() { echo "[live-env $name] $*"; }
installed() { [ "$(cat "$D/.installed" 2>/dev/null)" = "$STAMP" ]; }
installed && exit 0
mkdir -p "$ROOT"
KEY="env/live-$name-$(echo "$STAMP" | sha1sum | cut -c1-12).tar"
r2() { "${NODE:-node}" /opt/gate/src/r2cli.js "$@"; }

if [ "${STORAGE:-volume}" = r2 ]; then
  log "bringing its Python back from R2"
  if r2 get-tar "$KEY" "$ROOT" && installed; then exit 0; fi
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
  log "installing its packages (PyTorch 2.6 and friends: a few minutes)"
  "$UV" venv -q --python 3.11 "$D/src/.venv" || exit 1
  "$UV" pip install -q --python "$D/src/.venv/bin/python" "$D/src" || exit 1
else
  log "installing its packages from its lockfile (PyTorch 2.8 and friends: a few minutes)"
  (cd "$D/src" && "$UV" sync -q --frozen --python 3.11) || exit 1
  "$UV" pip install -q --python "$D/src/.venv/bin/python" "$D/src/libs/sageattention-2.2.1-cp311-cp311-linux_x86_64.whl" || exit 1
  "$UV" pip install -q --python "$D/src/.venv/bin/python" "uvicorn==0.37.0" || true
fi

echo "$STAMP" > "$D/.installed"
log "ready"
if [ "${STORAGE:-volume}" = r2 ]; then
  log "keeping it in R2 for next time"
  r2 put-tar "$KEY" "$ROOT" "$name" python || log "could not keep it in R2; it installs again at the next start"
fi
