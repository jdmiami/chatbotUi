#!/usr/bin/env bash
# Starts the serverless AI machine's parts inside the worker container (see Dockerfile): ComfyUI
# (ai/studio.sh) and the gate (ai/gate), the same code as the AI machine, in its "helper" role
# (images and videos only: no chat, no Open WebUI). Started once per worker by handler.py.
#
#   models        /runpod-volume/models  (the network volume: synced from R2 by the gate, kept)
#   NSFW check    /runpod-volume/hf      (its small model, downloaded once)
#   gallery, characters, held results, maker list: Cloudflare R2 (STORAGE=r2), as on the AI machine
#
# Required env (set on the endpoint): GATEWAY_SECRET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
# Optional: SITE_URL, HF_TOKEN (gated model downloads), ALLOWED_ORIGINS.
set -euo pipefail

: "${GATEWAY_SECRET:?GATEWAY_SECRET is required}"
V="${VOLUME_DIR:-/runpod-volume}"
S="${STUDIO_DIR:-/opt/studio}"
NODE=/opt/node/bin/node
log() { echo "[serverless] $*"; }

if ! grep -qs " $V " /proc/mounts && [ ! -d "$V/models" ]; then
  log "warning: no network volume at $V; models will be downloaded onto the container's disk every time"
fi
mkdir -p "$V/models" "$S/input" "$S/output" "$S/uploads" /opt/stage /opt/hf
# Models live on the volume (studio.sh links $S/models there). A global volume is object storage (no
# partial writes), so each file comes down onto the container's own disk first (MODEL_STAGE_DIR) and is
# copied over whole, as on the drawing machine. The NSFW check's small model is written piecemeal by its
# own downloader, which the volume garbles (a config file came back as not JSON): it lives on the
# container's disk and comes down again on a cold start (a few seconds).
export MODELS_DIR="$V/models" MODEL_STAGE_DIR=/opt/stage
rm -rf "$S/hf" && ln -sfn /opt/hf "$S/hf"

# ComfyUI, already installed in the image (ENV_BAKED: never packed to or from R2).
(env -u GATEWAY_SECRET -u RUNPOD_API_KEY -u HF_TOKEN \
   ENV_BAKED=1 STORAGE=r2 AI_ROLE=helper STUDIO_DIR="$S" PERSIST_DIR=/opt NODE="$NODE" \
   bash /opt/gate/studio.sh) 2>&1 | sed -u 's/^/[studio] /' &

# The gate: the helper role with everything in R2. No pod to turn off here (Runpod stops the worker
# itself), so IDLE_MINUTES only keeps its timer honest.
log "starting the gate on :8080"
cd /opt/gate
exec env PORT=8080 \
  SITE_URL="${SITE_URL:-}" ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}" IDLE_MINUTES="${IDLE_MINUTES:-60}" \
  AI_USER_EMAIL="${AI_USER_EMAIL:-owner@orbit.local}" \
  STUDIO_DIR="$S" AI_ROLE=helper PERSIST_DIR=/opt STORAGE=r2 KEEP_MODELS_LOADED=1 \
  "$NODE" src/index.js
