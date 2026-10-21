#!/usr/bin/env bash
# Turns a fresh Ubuntu 24.04 container (e.g. a Runpod CPU pod) into the Linux machine behind the
# web app. One service on port 8080 (the gateway, running as the desktop user) serves both:
#
#   Linux desktop:  browser --wss--> gateway :8080 --> guacd :4822 --> xrdp :3389 --> XFCE
#   Orbit:          browser --https/wss--> gateway :8080 /orbit/api, /orbit/pty
#                   (real terminal in tmux, project files in ~/projects, Antigravity CLI)
#   Coding:         browser --https/wss--> gateway :8080 /code/ --> code-server 127.0.0.1:8443
#                   (VS Code with the Kilo Code agent, using the AI machine's model through
#                    the gateway's local endpoint 127.0.0.1:8090/v1)
#   Agent:          Orbit's agent screen --> gateway :8080 /orbit/api/claw --> OpenClaw 127.0.0.1:18789
#                   (asks before every command; models: cloud AI via 8090/cloud/v1, AI machine via 8090/v1)
#
# Only port 8080 needs to be exposed. Everything else listens on localhost. Every Orbit and desktop
# request needs a short-lived token signed with GATEWAY_SECRET by the signed-in web app.
# With a network volume at /workspace, the desktop user's home (projects, Orbit sessions,
# Antigravity sign-in) survives restarts; system packages reinstall on each fresh start.
#
# Required env: GATEWAY_SECRET (same value as LINUX_GATEWAY_SECRET in Vercel), DESKTOP_PASSWORD
# Optional env: DESKTOP_USER (default "desktop"), ALLOWED_ORIGINS, REPO_RAW, PERSIST_DIR
set -euo pipefail

: "${GATEWAY_SECRET:?GATEWAY_SECRET is required}"
: "${DESKTOP_PASSWORD:?DESKTOP_PASSWORD is required}"
DESKTOP_USER="${DESKTOP_USER:-desktop}"
REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/jdmiami/chatbotUi/main}"
# Home directories live here so they survive pod restarts when it is a volume (Runpod: /workspace).
PERSIST_DIR="${PERSIST_DIR:-/workspace}"
NODE_VERSION=22.20.0
CODE_SERVER_VERSION=4.141.0
KILO_VERSION=7.8.12
CODE_MODEL="${CODE_MODEL:-qwen3.6:35b}"
# OpenClaw (the agent behind Orbit's agent screen) needs Node 24.16+; it gets its own copy in /opt.
OPENCLAW_VERSION=2026.10.4
OPENCLAW_NODE_VERSION=24.16.0
export DEBIAN_FRONTEND=noninteractive

log() { echo "[pod-setup] $*"; }
# Turn this pod off with the key Runpod gives it (used when setup fails, so a broken machine doesn't bill).
stop_self() {
  log "stopping the machine: $1"
  [ -n "${RUNPOD_POD_ID:-}" ] && [ -n "${RUNPOD_API_KEY:-}" ] || { log "no RUNPOD_POD_ID/RUNPOD_API_KEY to stop with"; return 0; }
  curl -fsS -m 20 -X POST -H "Authorization: Bearer ${RUNPOD_API_KEY}" -H 'content-type: application/json' \
    -d '{"action":"stop"}' "https://api.runpod.io/v2/pods/${RUNPOD_POD_ID}/action" >/dev/null || log "stop request failed"
}

if [ ! -f /opt/.desktop-installed ]; then
  log "installing desktop, xrdp and guacd"
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg sudo dbus dbus-x11 xfce4 xfce4-terminal xfce4-taskmanager \
    mousepad ristretto thunar xrdp xorgxrdp guacd libguac-client-rdp0 \
    fonts-dejavu fonts-noto-color-emoji locales xz-utils git \
    tmux build-essential python3 less nano vim-tiny unzip ripgrep

  # Firefox from Mozilla's apt repo (Ubuntu's own package is a snap, which can't run here).
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc
  echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" \
    > /etc/apt/sources.list.d/mozilla.list
  printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla
  apt-get update && apt-get install -y firefox

  locale-gen en_US.UTF-8

  log "installing Node.js ${NODE_VERSION}"
  arch=$(dpkg --print-architecture | sed 's/amd64/x64/')
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1

  log "installing VS Code (code-server ${CODE_SERVER_VERSION}) and the Kilo Code agent"
  curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz" \
    | tar -xz -C /opt && ln -sfn "/opt/code-server-${CODE_SERVER_VERSION}-linux-amd64" /opt/code-server
  curl -fsSL -o /opt/kilo-code.vsix \
    "https://open-vsx.org/api/kilocode/kilo-code/linux-x64/${KILO_VERSION}/file/kilocode.kilo-code-${KILO_VERSION}@linux-x64.vsix" \
    || log "Kilo Code download failed (continuing)"

  touch /opt/.desktop-installed
fi

# The gateway and Orbit host are fetched on every start, so a restart picks up fixes (such as the
# idle shut-off). A failed download keeps the copy from the last start.
log "updating the gateway and Orbit host"
rm -rf /opt/gateway.new /opt/shared.new && mkdir -p /opt/gateway.new/src/orbit /opt/gateway.new/bin /opt/gateway /opt/shared.new /opt/shared
fetched=1
for f in package.json package-lock.json src/index.js src/server.js src/protocol.js src/origins.js \
  src/code.js src/ai-local.js src/sysstats.js src/idle.js src/orbit/auth.js src/orbit/files.js src/orbit/pty.js src/orbit/agent.js src/orbit/claw.js src/orbit/claw-client.js src/orbit/http.js src/orbit/seed.js \
  bin/workspace-secrets.mjs; do
  curl -fsSL "${REPO_RAW}/gateway/${f}" -o "/opt/gateway.new/${f}" || { fetched=0; log "could not fetch gateway/${f}"; break; }
done
# The auto-off timer every machine shares (the gateway imports ../../shared/autooff.js).
for f in shared/package.json shared/autooff.js; do
  [ "$fetched" = 1 ] || break
  curl -fsSL "${REPO_RAW}/${f}" -o "/opt/shared.new/${f#shared/}" || { fetched=0; log "could not fetch ${f}"; break; }
done
if [ "$fetched" = 1 ]; then
  cp -r /opt/gateway.new/. /opt/gateway/
  cp -r /opt/shared.new/. /opt/shared/
elif [ ! -f /opt/gateway/src/index.js ] || [ ! -f /opt/shared/autooff.js ]; then
  stop_self "no gateway code could be downloaded"
  exit 1
fi
rm -rf /opt/gateway.new /opt/shared.new
if [ ! -d /opt/gateway/node_modules ] || ! cmp -s /opt/gateway/package-lock.json /opt/gateway/.installed-lock; then
  installed=0
  for attempt in 1 2 3; do
    if (cd /opt/gateway && npm ci --omit=dev --no-audit --no-fund); then installed=1; break; fi
    log "npm ci failed (attempt $attempt), retrying in 20s"
    sleep 20
  done
  if [ "$installed" != 1 ]; then
    # Without its dependencies the gateway can't run, and nor can its idle shut-off: turn the
    # machine off rather than leave it billing.
    stop_self "the gateway's dependencies could not be installed"
    exit 1
  fi
  cp /opt/gateway/package-lock.json /opt/gateway/.installed-lock
fi
# Lets the owner make new passwords/secrets in a terminal on this machine (see README).
chmod 755 /opt/gateway/bin/workspace-secrets.mjs
ln -sf /opt/gateway/bin/workspace-secrets.mjs /usr/local/bin/workspace-secrets
node -e "require('/opt/gateway/node_modules/node-pty')" && log "node-pty ok" || log "WARNING: node-pty failed to load (Orbit terminal unavailable)"

# Desktop user, with its home on the persistent volume when there is one.
home_root=/home
[ -d "$PERSIST_DIR" ] && home_root="$PERSIST_DIR/home" && mkdir -p "$home_root"
if ! id "$DESKTOP_USER" >/dev/null 2>&1; then
  useradd -m -d "$home_root/$DESKTOP_USER" -s /bin/bash -G sudo "$DESKTOP_USER" 2>/dev/null \
    || useradd -d "$home_root/$DESKTOP_USER" -s /bin/bash -G sudo "$DESKTOP_USER"
fi
echo "${DESKTOP_USER}:${DESKTOP_PASSWORD}" | chpasswd
# Orbit's login is the gate to this machine, so sudo doesn't ask for the desktop password again.
echo "${DESKTOP_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/orbit-desktop && chmod 0440 /etc/sudoers.d/orbit-desktop
user_home=$(getent passwd "$DESKTOP_USER" | cut -d: -f6)
mkdir -p "$user_home"
echo "xfce4-session" > "$user_home/.xsession"
mkdir -p "$user_home/projects"
# Fix ownership only when needed (a full chown of a big home on every boot is slow).
if [ "$(stat -c %U "$user_home")" != "$DESKTOP_USER" ] || [ "$(stat -c %U "$user_home/projects")" != "$DESKTOP_USER" ]; then
  chown -R "$DESKTOP_USER:$DESKTOP_USER" "$user_home"
fi
# Silences Ubuntu's "To run a command as administrator..." banner in every new terminal.
touch "$user_home/.sudo_as_admin_successful"
chown "$DESKTOP_USER:$DESKTOP_USER" "$user_home/.xsession" "$user_home/.sudo_as_admin_successful"

# Antigravity CLI for the desktop user (installs to ~/.local/bin; skipped if already there).
if [ ! -x "$user_home/.local/bin/agy" ]; then
  log "installing Antigravity CLI"
  sudo -u "$DESKTOP_USER" -H bash -c 'curl -fsSL https://antigravity.google/cli/install.sh | bash' \
    || log "Antigravity install failed (continuing)"
fi

as_user() { sudo -u "$DESKTOP_USER" -H "$@"; }
# OpenClaw: its own Node 24 and package in /opt (reinstalled on a fresh start, like the rest of
# /opt); its config, state and token in the desktop user's home (kept on the volume).
if [ ! -x /opt/openclaw/bin/openclaw ] || [ "$(cat /opt/openclaw/.version 2>/dev/null)" != "$OPENCLAW_VERSION" ]; then
  log "installing OpenClaw ${OPENCLAW_VERSION} (Node ${OPENCLAW_NODE_VERSION})"
  arch=$(dpkg --print-architecture | sed 's/amd64/x64/')
  rm -rf /opt/node24 && mkdir -p /opt/node24
  if curl -fsSL "https://nodejs.org/dist/v${OPENCLAW_NODE_VERSION}/node-v${OPENCLAW_NODE_VERSION}-linux-${arch}.tar.xz" | tar -xJ -C /opt/node24 --strip-components=1 \
    && PATH="/opt/node24/bin:$PATH" npm install -g --prefix /opt/openclaw --no-fund --no-audit "openclaw@${OPENCLAW_VERSION}"; then
    echo "$OPENCLAW_VERSION" > /opt/openclaw/.version
  else
    log "OpenClaw install failed (continuing without it)"
  fi
fi
claw_dir="$user_home/.openclaw-orbit"
if [ -x /opt/openclaw/bin/openclaw ]; then
  as_user mkdir -p "$claw_dir/state"
  chmod 700 "$claw_dir"
  # The token Orbit's gateway signs in with (only the desktop user can read it).
  if [ ! -s "$claw_dir/token" ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$claw_dir/token"
    chown "$DESKTOP_USER:$DESKTOP_USER" "$claw_dir/token" && chmod 600 "$claw_dir/token"
  fi
  # The safe setup is ours: rewritten on every boot so it can't drift.
  #  - loopback only, token sign-in; no chat channels, no web, no browser, no heartbeat or dreaming
  #  - every command asks first (allowlist + ask always); no elevated mode
  #  - file tools stay inside ~/projects
  #  - models: cloud AI first (free, works with the AI machine off), then your AI machine
  cat > "$claw_dir/openclaw.json" <<JSON
{
  "gateway": { "mode": "local", "port": 18789, "bind": "loopback", "auth": { "mode": "token" }, "controlUi": { "enabled": false } },
  "models": {
    "mode": "merge",
    "providers": {
      "orbit-cloud": {
        "baseUrl": "http://127.0.0.1:8090/cloud/v1", "apiKey": "local", "api": "openai-completions", "timeoutSeconds": 120,
        "request": { "allowPrivateNetwork": true },
        "models": [ { "id": "orbit-agent", "name": "Cloud AI (NVIDIA)", "input": ["text"], "contextWindow": 65536, "maxTokens": 8192, "compat": { "supportsTools": true } } ]
      },
      "orbit": {
        "baseUrl": "http://127.0.0.1:8090/v1", "apiKey": "local", "api": "openai-completions", "timeoutSeconds": 600,
        "request": { "allowPrivateNetwork": true },
        "models": [ { "id": "${CODE_MODEL}", "name": "Your AI machine", "input": ["text"], "contextWindow": 65536, "maxTokens": 8192, "compat": { "supportsTools": true } } ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "orbit-cloud/orbit-agent", "fallbacks": ["orbit/${CODE_MODEL}"] },
      "workspace": "$user_home/projects",
      "heartbeat": { "every": "0m" }
    }
  },
  "tools": {
    "exec": { "host": "gateway", "security": "allowlist", "ask": "always", "notifyOnExit": false },
    "elevated": { "enabled": false },
    "fs": { "workspaceOnly": true },
    "deny": ["group:web", "group:ui", "browser", "group:messaging", "group:nodes", "group:automation"]
  },
  "browser": { "enabled": false },
  "plugins": { "entries": { "memory-core": { "config": { "dreaming": { "enabled": false } } } } }
}
JSON
  chown "$DESKTOP_USER:$DESKTOP_USER" "$claw_dir/openclaw.json" && chmod 600 "$claw_dir/openclaw.json"
fi

# VS Code for the desktop user: settings, extensions and the agent's config live in the home
# directory (on the volume), and are only written when missing so your own changes stay.
cs_data="$user_home/.local/share/code-server"
as_user mkdir -p "$cs_data/User" "$user_home/.config/kilo"
if [ ! -f "$cs_data/User/settings.json" ]; then
  cat > "$cs_data/User/settings.json" <<'JSON'
{
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "window.menuBarVisibility": "compact",
  "editor.fontSize": 14,
  "editor.minimap.enabled": false,
  "files.autoSave": "afterDelay",
  "terminal.integrated.defaultProfile.linux": "bash",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off"
}
JSON
  chown "$DESKTOP_USER:$DESKTOP_USER" "$cs_data/User/settings.json"
fi
if [ ! -f "$user_home/.config/kilo/kilo.jsonc" ]; then
  cat > "$user_home/.config/kilo/kilo.jsonc" <<JSON
{
  // Kilo Code (the agent in VS Code) uses your own model on the AI machine. The Linux machine's
  // gateway forwards 127.0.0.1:8090/v1 to it and turns the AI machine on when needed.
  "\$schema": "https://app.kilo.ai/config.json",
  "model": "local/${CODE_MODEL}",
  "provider": {
    "local": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My AI machine",
      "options": { "baseURL": "http://127.0.0.1:8090/v1", "apiKey": "local" },
      "models": {
        "${CODE_MODEL}": { "name": "Qwen 3.6 35B (coding)", "tool_call": true, "limit": { "context": 65536, "output": 8192 } },
        "qwen3.8:27b": { "name": "Qwen 3.8 27B (general, vision)", "tool_call": true, "attachment": true, "limit": { "context": 65536, "output": 8192 } }
      }
    }
  },
  "permission": "allow"
}
JSON
  chown "$DESKTOP_USER:$DESKTOP_USER" "$user_home/.config/kilo/kilo.jsonc"
fi
# Configs written by an earlier version of this script: the AI machine now gives models 64K tokens.
if grep -q 'uses your own model on the AI machine' "$user_home/.config/kilo/kilo.jsonc" 2>/dev/null; then
  sed -i 's/"context": 32768/"context": 65536/g' "$user_home/.config/kilo/kilo.jsonc"
fi
if [ -f /opt/kilo-code.vsix ] && ! ls -d "$cs_data/extensions/kilocode.kilo-code-${KILO_VERSION}"* >/dev/null 2>&1; then
  as_user /opt/code-server/bin/code-server --user-data-dir "$cs_data" --install-extension /opt/kilo-code.vsix \
    || log "Kilo Code install failed (continuing)"
fi

log "starting services"
mkdir -p /run/dbus && (pgrep -x dbus-daemon >/dev/null || dbus-daemon --system --fork || log "dbus failed to start (continuing)")
# xrdp listens on localhost only: the gateway is the sole way in.
# Only the first port= line (in [Globals]); the session sections' port=-1 must stay as is.
sed -i '0,/^port=.*/s//port=tcp:\/\/127.0.0.1:3389/' /etc/xrdp/xrdp.ini
rm -f /var/run/xrdp/*.pid
xrdp-sesman
xrdp
guacd -b 127.0.0.1 -l 4822

log "starting VS Code on 127.0.0.1:8443 (as $DESKTOP_USER)"
# No secrets in its environment; only the gateway (with its sign-in cookie) can reach it.
(
  while true; do
    setpriv --reuid="$DESKTOP_USER" --regid="$DESKTOP_USER" --init-groups env -i \
      "HOME=$user_home" "USER=$DESKTOP_USER" "SHELL=/bin/bash" "LANG=en_US.UTF-8" \
      "PATH=$user_home/.local/bin:/usr/local/bin:/usr/bin:/bin" \
      /opt/code-server/bin/code-server --bind-addr 127.0.0.1:8443 --auth none \
      --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override \
      --user-data-dir "$cs_data" "$user_home/projects" || true
    sleep 3
  done
) > /var/log/code-server.log 2>&1 &

if [ -s "$claw_dir/openclaw.json" ]; then
  log "starting OpenClaw on 127.0.0.1:18789 (as $DESKTOP_USER)"
  # The token reaches it through its environment (readable only by the desktop user), never a command line.
  (
    while true; do
      setpriv --reuid="$DESKTOP_USER" --regid="$DESKTOP_USER" --init-groups env -i \
        "HOME=$user_home" "USER=$DESKTOP_USER" "SHELL=/bin/bash" "LANG=en_US.UTF-8" \
        "PATH=/opt/node24/bin:$user_home/.local/bin:/usr/local/bin:/usr/bin:/bin" \
        "OPENCLAW_CONFIG_PATH=$claw_dir/openclaw.json" "OPENCLAW_STATE_DIR=$claw_dir/state" \
        "OPENCLAW_GATEWAY_TOKEN=$(cat "$claw_dir/token")" \
        "OPENCLAW_SKIP_CHANNELS=1" "OPENCLAW_DISABLE_BONJOUR=1" "OPENCLAW_NO_RESPAWN=1" \
        /opt/node24/bin/node /opt/openclaw/lib/node_modules/openclaw/openclaw.mjs gateway run --port 18789 --bind loopback --auth token || true
      sleep 5
    done
  ) > /var/log/openclaw.log 2>&1 &
fi

log "starting gateway + Orbit host on :8080 (as $DESKTOP_USER)"
# Run as the desktop user so Orbit's terminal, files and Antigravity act as that user.
gateway_env=(
  "HOME=$user_home" "USER=$DESKTOP_USER" "SHELL=/bin/bash" "LANG=en_US.UTF-8"
  "PATH=$user_home/.local/bin:/usr/local/bin:/usr/bin:/bin"
  "GATEWAY_SECRET=$GATEWAY_SECRET" "ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}"
  "RDP_HOST=127.0.0.1" "RDP_PORT=3389" "RDP_USERNAME=$DESKTOP_USER" "RDP_PASSWORD=$DESKTOP_PASSWORD"
  "RDP_SECURITY=${RDP_SECURITY:-any}" "RDP_IGNORE_CERT=true" "GUACD_HOST=127.0.0.1" "GUACD_PORT=4822" "PORT=8080"
  "ORBIT_HOST=1" "ORBIT_PROJECTS_DIR=$user_home/projects" "AGY_PATH=$user_home/.local/bin/agy"
  "CODE_SERVER_URL=http://127.0.0.1:8443" "AI_LOCAL_PORT=8090" "SITE_URL=${SITE_URL:-}"
  "CLAW_URL=ws://127.0.0.1:18789" "CLAW_TOKEN_FILE=$claw_dir/token"
  # Runpod's key for this pod only: the gateway turns the machine off after IDLE_MINUTES without input
  # (the site sends its AUTO_OFF_MINUTES; 60 and never more, see shared/autooff.js).
  "RUNPOD_POD_ID=${RUNPOD_POD_ID:-}" "RUNPOD_API_KEY=${RUNPOD_API_KEY:-}" "IDLE_MINUTES=${IDLE_MINUTES:-60}"
)
unset DESKTOP_PASSWORD
cd /opt/gateway
while true; do
  # setpriv execs in place (no root parent process), so the secrets in gateway_env never sit in a
  # process command line that any user on the machine could read with ps.
  setpriv --reuid="$DESKTOP_USER" --regid="$DESKTOP_USER" --init-groups env -i "${gateway_env[@]}" node src/index.js || true
  log "gateway exited, restarting in 2s"
  sleep 2
done
