#!/usr/bin/env bash
# The AI machine on GPU.ai: this container (ai/serverless/Dockerfile) started as an instance with our
# own image, making pictures and videos only (the gate's helper role: no chat). Started by GPU.ai as
# the image's command (lib/gpuaiMachine.ts sends `cmd: ["bash", "/opt/serverless/machine.sh"]`).
#
#   models      /opt/models on the instance's own disk, brought down from Cloudflare R2 at every start
#               (the disk is gone when the instance is terminated; everything that matters is in R2)
#   address     a Cloudflare quick tunnel (cloudflared) to the gate on :8080: a trycloudflare.com
#               address that changes every start. The gate publishes it in R2 (announce.js), the site
#               reads it there. GPU.ai's own app address (basic auth) is only a fallback for a person.
#   off         the gate asks the site to terminate the instance when the auto-off rule fires; GPU.ai
#               also terminates it after AUTO_TERMINATE hours whatever happens (the money fail-safe).
#
# Required env: GATEWAY_SECRET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, SITE_URL, MACHINE_NAME.
# Optional: ONLY_MAKERS (comma-separated maker ids: just these come down), ALLOWED_ORIGINS, IDLE_MINUTES, HF_TOKEN.
set -euo pipefail

: "${GATEWAY_SECRET:?GATEWAY_SECRET is required}"
S="${STUDIO_DIR:-/opt/studio}"
NODE=/opt/node/bin/node
URL_FILE=/opt/machine-url
log() { echo "[machine] $*"; }

mkdir -p /opt/models "$S/input" "$S/output" "$S/uploads" /opt/hf
export MODELS_DIR=/opt/models
rm -rf "$S/hf" && ln -sfn /opt/hf "$S/hf"
rm -f "$URL_FILE"

# The tunnel: cloudflared prints the address it got on stderr; keep only that line in the file.
log "opening the tunnel"
( /usr/local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080 2>&1 \
    | while IFS= read -r line; do
        echo "[tunnel] $line"
        if [ ! -s "$URL_FILE" ] && [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
          echo "${BASH_REMATCH[1]}" > "$URL_FILE"
          log "the tunnel is up at ${BASH_REMATCH[1]}"
        fi
      done ) &

# ComfyUI, already installed in the image (ENV_BAKED: never packed to or from R2).
(env -u GATEWAY_SECRET -u HF_TOKEN \
   ENV_BAKED=1 STORAGE=r2 AI_ROLE=helper STUDIO_DIR="$S" PERSIST_DIR=/opt NODE="$NODE" \
   bash /opt/gate/studio.sh) 2>&1 | sed -u 's/^/[studio] /' &

# The gate: helper role, everything in R2, makers kept loaded between jobs (no chat to make room for).
log "starting the gate on :8080"
cd /opt/gate
exec env PORT=8080 \
  SITE_URL="${SITE_URL:-}" ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}" IDLE_MINUTES="${IDLE_MINUTES:-60}" \
  AI_USER_EMAIL="${AI_USER_EMAIL:-owner@orbit.local}" \
  STUDIO_DIR="$S" AI_ROLE=helper PERSIST_DIR=/opt STORAGE=r2 KEEP_MODELS_LOADED=1 \
  MACHINE_URL_FILE="$URL_FILE" MACHINE_NAME="${MACHINE_NAME:-orbit-ai}" ONLY_MAKERS="${ONLY_MAKERS:-}" \
  "$NODE" src/index.js
