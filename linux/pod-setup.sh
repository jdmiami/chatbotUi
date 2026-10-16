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
export DEBIAN_FRONTEND=noninteractive

log() { echo "[pod-setup] $*"; }

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

  log "installing the gateway and Orbit host"
  mkdir -p /opt/gateway/src/orbit /opt/gateway/bin
  for f in package.json package-lock.json src/index.js src/server.js src/protocol.js src/origins.js \
    src/code.js src/ai-local.js src/orbit/auth.js src/orbit/files.js src/orbit/pty.js src/orbit/agent.js src/orbit/http.js src/orbit/seed.js \
    bin/workspace-secrets.mjs; do
    curl -fsSL "${REPO_RAW}/gateway/${f}" -o "/opt/gateway/${f}"
  done
  (cd /opt/gateway && npm ci --omit=dev --no-audit --no-fund)
  # Lets the owner make new passwords/secrets in a terminal on this machine (see README).
  chmod 755 /opt/gateway/bin/workspace-secrets.mjs
  ln -sf /opt/gateway/bin/workspace-secrets.mjs /usr/local/bin/workspace-secrets
  node -e "require('/opt/gateway/node_modules/node-pty')" && log "node-pty ok" || log "WARNING: node-pty failed to load (Orbit terminal unavailable)"

  log "installing VS Code (code-server ${CODE_SERVER_VERSION}) and the Kilo Code agent"
  curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz" \
    | tar -xz -C /opt && ln -sfn "/opt/code-server-${CODE_SERVER_VERSION}-linux-amd64" /opt/code-server
  curl -fsSL -o /opt/kilo-code.vsix \
    "https://open-vsx.org/api/kilocode/kilo-code/linux-x64/${KILO_VERSION}/file/kilocode.kilo-code-${KILO_VERSION}@linux-x64.vsix" \
    || log "Kilo Code download failed (continuing)"

  touch /opt/.desktop-installed
fi

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

# VS Code for the desktop user: settings, extensions and the agent's config live in the home
# directory (on the volume), and are only written when missing so your own changes stay.
cs_data="$user_home/.local/share/code-server"
as_user() { sudo -u "$DESKTOP_USER" -H "$@"; }
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
