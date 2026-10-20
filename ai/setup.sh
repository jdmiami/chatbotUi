#!/usr/bin/env bash
# Starts the AI machine: a Runpod GPU pod running the official Open WebUI image with Ollama built in
# (ghcr.io/open-webui/open-webui:<version>-ollama). Runpod runs this as the pod's command:
#
#   browser --https--> gate :8080 --> Open WebUI 127.0.0.1:8081 --> Ollama 127.0.0.1:11434 (GPU)
#   Orbit / coding agent --> gate :8080 /v1 --> Ollama
#   images and videos     --> gate :8080 /_orbit/studio --> ComfyUI 127.0.0.1:8188 (ai/studio.sh)
#
# Only port 8080 (the gate) is exposed. The gate signs people in with tokens from the web app
# (GATEWAY_SECRET, the same secret as the Linux machine) and stops the pod after IDLE_MINUTES unused.
# Where things are kept (STORAGE):
#   volume  a Runpod network volume mounted at /workspace: models, chats and settings survive stops.
#   r2      no volume: the disk is wiped at every stop, so everything worth keeping lives in
#           Cloudflare R2 (bucket orbit-models) and comes back down at start (see gate/src/cloud.js).
#   auto    (default) r2 when the R2 keys are set and /workspace isn't a mounted volume.
#
# Required env: GATEWAY_SECRET
# Optional env: REPO_RAW, SITE_URL, ALLOWED_ORIGINS, IDLE_MINUTES (30), DEFAULT_MODELS, CHAT_MODEL,
#   AI_ROLE=helper: a second machine that only makes images and videos (no Open WebUI, no Ollama);
#   its creations land in the same gallery. STORAGE, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
#   R2_SECRET_ACCESS_KEY (Runpod secrets).
set -euo pipefail

: "${GATEWAY_SECRET:?GATEWAY_SECRET is required}"
REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/jdmiami/chatbotUi/main}"
P="${PERSIST_DIR:-/workspace}"
NODE_VERSION=22.20.0
NODE_DIR="$P/opt/node-v${NODE_VERSION}"
DEFAULT_MODELS="${DEFAULT_MODELS:-qwen3.8:27b,qwen3.6:35b,qwen3.8-obliterated:27b=hf.co/OBLITERATUS/Qwen3.8-27B-OBLITERATED:Q6_K|like=qwen3.8:27b|temperature=0|repeat_penalty=1.15}"
CHAT_MODEL="${CHAT_MODEL:-${DEFAULT_MODELS%%,*}}"

log() { echo "[ai-setup] $*"; }
mkdir -p "$P/opt" "$P/ollama/models" "$P/open-webui/data"

resolved() { [ -n "${1:-}" ] && [ "${1#\{\{}" = "$1" ]; }
STORAGE="${STORAGE:-auto}"
if [ "$STORAGE" = auto ]; then
  if resolved "${R2_ACCOUNT_ID:-}" && resolved "${R2_ACCESS_KEY_ID:-}" && resolved "${R2_SECRET_ACCESS_KEY:-}" && ! grep -qs " $P " /proc/mounts; then
    STORAGE=r2
  else
    STORAGE=volume
  fi
fi
log "storage: $STORAGE"
export STORAGE

# Node.js for the gate, kept on the volume so later starts skip the download.
if [ ! -x "$NODE_DIR/bin/node" ]; then
  log "installing Node.js ${NODE_VERSION}"
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" | tar -xz -C "$tmp"
  rm -rf "$NODE_DIR" && mv "$tmp/node-v${NODE_VERSION}-linux-x64" "$NODE_DIR"
fi

log "fetching the gate"
rm -rf /opt/gate && mkdir -p /opt/gate/src /opt/gate/openwebui
for f in package.json src/index.js src/gate.js src/jwt.js src/machine.js src/store.js src/studio.js src/sysstats.js src/gpustats.js src/workflows.js src/openwebui.js src/search.js src/voice.js src/movies.js src/r2.js src/r2cli.js src/cloud.js src/push.js openwebui/studio_pipe.py; do
  curl -fsSL "${REPO_RAW}/ai/gate/${f}" -o "/opt/gate/${f}"
done
curl -fsSL "${REPO_RAW}/ai/studio.sh" -o /opt/gate/studio.sh
r2() { "$NODE_DIR/bin/node" /opt/gate/src/r2cli.js "$@"; }

# ffmpeg joins soReal shots into one movie and grabs each shot's last frame.
if ! command -v ffmpeg >/dev/null 2>&1; then
  log "installing ffmpeg"
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg >/dev/null) || log "ffmpeg install failed; movies can't be joined"
fi

# A key for Open WebUI to reach the image/video maker through the gate (new on every start).
STUDIO_KEY=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')
STUDIO_DIR="$P/studio"

public_url="https://${RUNPOD_POD_ID:-localhost}-8080.proxy.runpod.net"

if [ "${AI_ROLE:-main}" = "helper" ]; then
  log "helper machine: images and videos only (no chat)"
else
# The playground's chats and settings, as last saved (the gate saves them every few minutes).
if [ "$STORAGE" = r2 ] && [ ! -s "$P/open-webui/data/webui.db" ]; then
  log "bringing back the playground's chats from R2"
  r2 get-tar state/open-webui.tar "$P/open-webui" || log "no saved chats yet: starting fresh"
fi
# Open WebUI + Ollama (the image's start.sh launches both). They never see the gate's secrets.
log "starting Open WebUI and Ollama"
(
  cd /app/backend
  exec env -u GATEWAY_SECRET -u RUNPOD_API_KEY -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY \
    PORT=8081 HOST=127.0.0.1 \
    DATA_DIR="$P/open-webui/data" \
    WEBUI_SECRET_KEY_FILE="$P/open-webui/.webui_secret_key" \
    OLLAMA_MODELS="$P/ollama/models" OLLAMA_KEEP_ALIVE=10m OLLAMA_CONTEXT_LENGTH=65536 \
    OLLAMA_FLASH_ATTENTION=1 OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NOPRUNE=1 \
    WEBUI_NAME="AI Playground" WEBUI_URL="$public_url" CORS_ALLOW_ORIGIN="$public_url" \
    WEBUI_SESSION_COOKIE_SECURE=true \
    WEBUI_AUTH_TRUSTED_EMAIL_HEADER=X-Orbit-Email WEBUI_AUTH_TRUSTED_NAME_HEADER=X-Orbit-Name \
    DEFAULT_USER_ROLE=user \
    ENABLE_OPENAI_API=false ENABLE_VERSION_UPDATE_CHECK=false \
    ENABLE_WEB_SEARCH=true WEB_SEARCH_ENGINE=duckduckgo WEB_SEARCH_RESULT_COUNT=5 \
    ENABLE_CODE_INTERPRETER=true \
    WHISPER_MODEL=large-v3-turbo WHISPER_MODEL_AUTO_UPDATE=true \
    DEFAULT_MODELS="$CHAT_MODEL" \
    ENABLE_IMAGE_GENERATION=true IMAGE_GENERATION_ENGINE=openai \
    IMAGES_OPENAI_API_BASE_URL=http://127.0.0.1:8080/v1 IMAGES_OPENAI_API_KEY="$STUDIO_KEY" \
    IMAGE_GENERATION_MODEL=qwen-image-2.1 IMAGE_SIZE=1328x1328 \
    ORBIT_STUDIO_KEY="$STUDIO_KEY" \
    bash start.sh
) 2>&1 | sed -u 's/^/[webui] /' &
fi

# Image and video maker (ComfyUI). Installs once onto the volume, then runs on 127.0.0.1:8188.
log "starting the image and video maker"
(env -u GATEWAY_SECRET -u RUNPOD_API_KEY AI_ROLE="${AI_ROLE:-main}" STUDIO_DIR="$STUDIO_DIR" PERSIST_DIR="$P" NODE="$NODE_DIR/bin/node" bash /opt/gate/studio.sh) 2>&1 | sed -u 's/^/[studio] /' &

log "starting the gate on :8080"
cd /opt/gate
while true; do
  env PORT=8080 OLLAMA_URL=http://127.0.0.1:11434 WEBUI_URL=http://127.0.0.1:8081 \
    SITE_URL="${SITE_URL:-}" ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}" IDLE_MINUTES="${IDLE_MINUTES:-30}" \
    DEFAULT_MODELS="$DEFAULT_MODELS" AI_USER_EMAIL="${AI_USER_EMAIL:-owner@orbit.local}" \
    STUDIO_DIR="$STUDIO_DIR" STUDIO_KEY="$STUDIO_KEY" AI_ROLE="${AI_ROLE:-main}" PERSIST_DIR="$P" \
    STORAGE="$STORAGE" OLLAMA_MODELS="$P/ollama/models" WEBUI_DIR="$P/open-webui" \
    "$NODE_DIR/bin/node" src/index.js || true
  log "gate exited, restarting in 2s"
  sleep 2
done
