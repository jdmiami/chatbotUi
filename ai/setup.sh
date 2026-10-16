#!/usr/bin/env bash
# Starts the AI machine: a Runpod GPU pod running the official Open WebUI image with Ollama built in
# (ghcr.io/open-webui/open-webui:<version>-ollama). Runpod runs this as the pod's command:
#
#   browser --https--> gate :8080 --> Open WebUI 127.0.0.1:8081 --> Ollama 127.0.0.1:11434 (GPU)
#   Orbit / coding agent --> gate :8080 /v1 --> Ollama
#
# Only port 8080 (the gate) is exposed. The gate signs people in with tokens from the web app
# (GATEWAY_SECRET, the same secret as the Linux machine) and stops the pod after IDLE_MINUTES unused.
# Models, chats and settings live on the network volume at /workspace, so they survive stops.
#
# Required env: GATEWAY_SECRET
# Optional env: REPO_RAW, SITE_URL, ALLOWED_ORIGINS, IDLE_MINUTES (30), DEFAULT_MODELS, CHAT_MODEL
set -euo pipefail

: "${GATEWAY_SECRET:?GATEWAY_SECRET is required}"
REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/jdmiami/chatbotUi/main}"
P="${PERSIST_DIR:-/workspace}"
NODE_VERSION=22.20.0
NODE_DIR="$P/opt/node-v${NODE_VERSION}"
DEFAULT_MODELS="${DEFAULT_MODELS:-qwen3.8:27b,qwen3.6:35b}"
CHAT_MODEL="${CHAT_MODEL:-${DEFAULT_MODELS%%,*}}"

log() { echo "[ai-setup] $*"; }
mkdir -p "$P/opt" "$P/ollama/models" "$P/open-webui/data"

# Node.js for the gate, kept on the volume so later starts skip the download.
if [ ! -x "$NODE_DIR/bin/node" ]; then
  log "installing Node.js ${NODE_VERSION}"
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" | tar -xz -C "$tmp"
  rm -rf "$NODE_DIR" && mv "$tmp/node-v${NODE_VERSION}-linux-x64" "$NODE_DIR"
fi

log "fetching the gate"
rm -rf /opt/gate && mkdir -p /opt/gate/src
for f in package.json src/index.js src/gate.js src/jwt.js src/machine.js; do
  curl -fsSL "${REPO_RAW}/ai/gate/${f}" -o "/opt/gate/${f}"
done

public_url="https://${RUNPOD_POD_ID:-localhost}-8080.proxy.runpod.net"

# Open WebUI + Ollama (the image's start.sh launches both). They never see the gate's secrets.
log "starting Open WebUI and Ollama"
(
  cd /app/backend
  exec env -u GATEWAY_SECRET -u RUNPOD_API_KEY \
    PORT=8081 HOST=127.0.0.1 \
    DATA_DIR="$P/open-webui/data" \
    WEBUI_SECRET_KEY_FILE="$P/open-webui/.webui_secret_key" \
    OLLAMA_MODELS="$P/ollama/models" OLLAMA_KEEP_ALIVE=10m OLLAMA_CONTEXT_LENGTH=65536 \
    OLLAMA_FLASH_ATTENTION=1 OLLAMA_MAX_LOADED_MODELS=1 \
    WEBUI_NAME="AI Playground" WEBUI_URL="$public_url" CORS_ALLOW_ORIGIN="$public_url" \
    WEBUI_SESSION_COOKIE_SECURE=true \
    WEBUI_AUTH_TRUSTED_EMAIL_HEADER=X-Orbit-Email WEBUI_AUTH_TRUSTED_NAME_HEADER=X-Orbit-Name \
    DEFAULT_USER_ROLE=user \
    ENABLE_OPENAI_API=false ENABLE_VERSION_UPDATE_CHECK=false \
    ENABLE_WEB_SEARCH=true WEB_SEARCH_ENGINE=duckduckgo WEB_SEARCH_RESULT_COUNT=5 \
    ENABLE_CODE_INTERPRETER=true \
    DEFAULT_MODELS="$CHAT_MODEL" \
    bash start.sh
) 2>&1 | sed -u 's/^/[webui] /' &

log "starting the gate on :8080"
cd /opt/gate
while true; do
  env PORT=8080 OLLAMA_URL=http://127.0.0.1:11434 WEBUI_URL=http://127.0.0.1:8081 \
    SITE_URL="${SITE_URL:-}" ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}" IDLE_MINUTES="${IDLE_MINUTES:-30}" \
    DEFAULT_MODELS="$DEFAULT_MODELS" AI_USER_EMAIL="${AI_USER_EMAIL:-owner@orbit.local}" \
    "$NODE_DIR/bin/node" src/index.js || true
  log "gate exited, restarting in 2s"
  sleep 2
done
