# Orbit architecture

Orbit is a touch-first web workspace (Terminal, Code, Antigravity, Settings) for iPhone and iPad. It
runs in the browser and drives a Linux machine on Runpod, where the Google Antigravity CLI (`agy`)
does the agent work. This note covers how the parts fit together, what we verified, and what is still
open. Last checked 2026-10-14 against agy 1.3.4 and 1.3.5. agy updated itself during the checks; see
[agy facts](#agy-facts).

## 1. One link, three workspaces

```
 iPhone / iPad / laptop browser
   |  https, session cookie (HttpOnly, Secure, SameSite=Strict)
   v
 +-- Vercel: Next.js app --------------------------------------------------------+
 | proxy.ts: every path except /login and static assets needs a session          |
 | /login -> / (workspace chooser, remembers choice in cookie ws_pref)           |
 |   Orbit         -> /orbit            (static Vite SPA built into public/orbit) |
 |   Linux desktop -> /desktop/linux    (Guacamole client in the browser)        |
 |   Windows PC    -> /desktop/windows  (same client, home gateway)              |
 | /api/machine        GET status / POST start|stop  --> Runpod REST v2 (API key) |
 | /api/orbit/session  POST -> { machine, hostUrl, token (1 h, aud orbit-host) }  |
 | /api/gateway-token  POST -> { gatewayUrl, ticket (60 s, single use,           |
 |                                aud rdp-gateway) }                            |
 +-------------------------------------------------------------------------------+
   |  https + wss directly from the browser (Vercel never proxies the streams)
   v
 https://<LINUX_POD_ID>-8080.proxy.runpod.net   (Runpod HTTPS proxy, port 8080 only)
   v
 +-- Runpod CPU pod, Ubuntu 24.04: gateway :8080 runs as user `desktop` ---------+
 | GET  /healthz                  public, returns "ok"                            |
 | /orbit/api/*  REST + SSE  -> FileService (~/projects)                         |
 |                           -> AgentService -> `agy --print ...` per turn       |
 | /orbit/pty    WebSocket   -> node-pty -> tmux session orbit-<id> -> bash      |
 | other WS (guacamole)      -> guacd 127.0.0.1:4822 -> xrdp 127.0.0.1:3389       |
 |                                -> Xorg (xorgxrdp) -> XFCE + Firefox            |
 | /workspace (network volume) holds $HOME: projects, .orbit, .gemini, agy        |
 +-------------------------------------------------------------------------------+

 Windows PC: browser --wss (60 s ticket)--> Cloudflare Tunnel --> home gateway --> guacd --RDP--> PC
```

Flow: sign in, then pick a workspace. If **Remember my choice** is on, the site goes straight to that
workspace (`/?choose=1` shows the chooser again). Windows PC appears greyed out until its gateway is
configured. The chooser's machine panel and Orbit's boot screen both show whether the Linux machine
is on, plus a **Turn on** button.

## 2. Machine power (Runpod REST v2)

`lib/runpod.ts` runs server-side only. `RUNPOD_API_KEY` stays in Vercel.

| Call | Use |
| --- | --- |
| `GET https://api.runpod.io/v2/pods/{LINUX_POD_ID}` | `status` + `cost` (USD/h) |
| `POST .../v2/pods/{id}/action {"action":"start"\|"stop"}` | power (the API also has `restart`, `terminate`; we don't use them) |

How site states map to Runpod: `RUNNING` + `/healthz` returns `ok` = **on**. `RUNNING` without a
healthy gateway, `PROVISIONING` or `STARTING` = **starting**. `EXITED` = **off**. `TERMINATED` or
anything else = **error**. With no `LINUX_POD_ID` the state is **unconfigured**. With no API key the
site can only probe `/healthz`, giving **on** or **unknown**, and it can't control power. Verified
against `https://api.runpod.io/v2/openapi.json` (paths, `PodAction` enum, `PodStatus` enum).

**Boot (`linux/pod-setup.sh`).** The pod's start command downloads `pod-setup.sh` from
`REPO_RAW` (default `https://raw.githubusercontent.com/jdmiami/chatbotUi/main`). The script installs
XFCE, xrdp+xorgxrdp, guacd, Firefox, tmux and Node 22, and fetches the gateway + Orbit host
sources from the same `REPO_RAW`. It creates `desktop` with its home on `/workspace/home`, installs
agy to `~/.local/bin` if it is missing, and then loops `node src/index.js` as `desktop` under
`env -i` with an explicit env (`ORBIT_HOST=1`, `ORBIT_PROJECTS_DIR`, `AGY_PATH`, ...). The plan
is to track `main` so the site and the machine stay in sync. See open question 4.

## 3. Orbit host (on the Linux machine)

Code: `gateway/src/index.js` (enabled by `ORBIT_HOST=1`), `gateway/src/orbit/*.js`.

### Endpoints (all under the pod's https base URL)

| Method + path | Purpose |
| --- | --- |
| `GET /healthz` | Liveness, **no auth** |
| `GET /orbit/api/info` | user, projects root, tmux present, agy version |
| `GET /orbit/api/files` | file list (max 5,000, `truncated` flag; skips `.git`, `node_modules`, ...) |
| `GET\|PUT\|DELETE /orbit/api/files/content?path=` | read (2 MB cap, binary refused) / atomic write / delete |
| `POST /orbit/api/files/rename` | `{from,to}`, fails if target exists |
| `WS /orbit/pty?session=&cols=&rows=` | terminal; first frame must be `{type:'auth', token}` within 10 s |
| `DELETE /orbit/api/terminal/sessions/:id` | kill tmux session ("Restart shell") |
| `GET /orbit/api/agent/capabilities\|projects\|models` | capability matrix, projects, `agy models` |
| `GET\|POST /orbit/api/agent/sessions[?project=]` | list / create session |
| `GET\|PATCH\|DELETE /orbit/api/agent/sessions/:id` | read / rename, model, mode / delete |
| `GET /orbit/api/agent/sessions/:id/transcript` | stored transcript |
| `POST /orbit/api/agent/sessions/:id/send` | run one turn; **SSE** `item`, `update`, `done`, `error` |
| `GET /orbit/api/agent/sessions/:id/events` | follow a running turn (SSE), or `idle` if none |
| `POST /orbit/api/agent/sessions/:id/stop` | end the running agy process |

Request bodies are capped at 5 MB. Errors are JSON `{error, code}`. agy failures return **424**,
not 502, because Runpod's proxy replaces 502 responses with its own page.

### Auth

- `POST /api/orbit/session` (session cookie + same-origin check) signs a JWT: **HS256**, `iss rdp-web`,
  `aud orbit-host`, `sub <user>`, `scope orbit`, **TTL 3600 s**. The key is `LINUX_GATEWAY_SECRET`,
  which equals the pod's `GATEWAY_SECRET` (at least 32 chars).
- The browser keeps the token **in memory only** (`TokenSource`). It refreshes 2 min before expiry
  or once after a 401. REST sends it as `Authorization: Bearer`. The PTY WebSocket sends it as its
  first message, because browsers can't set WebSocket headers.
- The host checks signature, algorithm, issuer, audience and expiry on every request and socket.
  CORS and WebSocket `Origin` are limited to `ALLOWED_ORIGINS`.
- The desktop path uses a different, stricter ticket: 60 s, single use (`jti`), `aud rdp-gateway`.

### Terminal persistence (tmux)

Each terminal runs `tmux new-session -A -s orbit-<id> -c ~/projects` inside node-pty. Closing the
socket kills only the tmux **client**, so the shell keeps running. Reconnecting (`PtyBackend`
retries with backoff) re-attaches to the same session, from any device. Without tmux the terminal
falls back to `bash -l`, which does not persist, and the UI says so. The child env drops
`GATEWAY_SECRET`, `RDP_PASSWORD` and `DESKTOP_PASSWORD`.

### Files

The root is `ORBIT_PROJECTS_DIR`, default `~/projects`, seeded with `welcome/README.md` when empty.
Paths are project-relative. `..`, absolute paths and control characters are rejected, and any path
whose real path leaves the root (symlink escape) gets a 403. Writes go to a temp file and are then
renamed into place.

### agy runner and session store

- One turn = one process:
  `agy --print "<text>" --output-format json --print-timeout 900s [--conversation <id>] [--mode plan|accept-edits] [--model <id>]`.
  It runs in the project folder (the projects root or one of its top-level folders), in its own
  process group, with secrets removed from the env. **Never** `--dangerously-skip-permissions`.
- The `conversation_id` from the first result is saved on the Orbit session. Follow-ups pass
  `--conversation`.
- **Stop** sends SIGTERM to the process group, then SIGKILL after 5 s. The turn is cancelled, not
  paused.
- **Signed out:** if agy prints `Authentication required` or `Please sign in`, the host kills it at
  once and ends the turn with sign-in help (run `agy` once in Orbit Terminal). Otherwise the turn
  would sit waiting for about 60 s. `agy models` reports the same state as HTTP 424
  `agy-signed-out`.
- **Store:** `~/.orbit/agent.json` (`ORBIT_DATA_DIR`) holds sessions + transcripts. Writes are
  serialized and atomic (temp file + rename). Every device sees the same history. Turns that were
  running when the service restarted are marked `error`, with a notice.
- **Streaming:** the host streams Orbit transcript events (user item, "working" activity, final
  reply or notice, `done`) over SSE to every listener. Several devices can watch one turn. agy
  itself runs with `json` output, so the reply text arrives in one piece at the end of the turn.
- **Dropped stream (`HostRunner`):** if the SSE stream ends without `done` (phone locked, network
  change, proxy cut it), the client re-attaches through `/events`. It retries up to 6 times with
  backoff (1 s doubling, capped at 15 s), then re-fetches the transcript and session to fill in
  anything missed. The turn keeps running on the machine the whole time. The session list is
  polled every 10 s while the page is visible.

## 4. Demo vs host mode (decided once, at boot)

`orbit/src/shell/Boot.tsx` runs before any app mounts:

| `POST /api/orbit/session` result | Mode / screen |
| --- | --- |
| network error, 404/405, non-JSON (static preview, local dev) | **demo** (`no-backend`) |
| 401 | redirect to `/login` |
| token + `GET /orbit/api/info` OK | **host** |
| machine `off` | "machine is off": **Turn on (cost/h)** if the site can control power, or **Use demo mode** |
| `starting` / `on` but host not answering / `unknown` | "Starting...", re-checks every 5 s, offers demo meanwhile |
| `unconfigured` / `error` | problem screen: **Try again** or **Use demo mode** |

`configureServices()` then picks the implementations behind each interface:

| Interface | host | demo |
| --- | --- | --- |
| `FileStore` | `ServerFileStore` (host files) | `LocalFileStore` (this browser's localStorage) |
| `TerminalBackend` | `PtyBackend` (tmux PTY) | `SimulatedShell` (labelled as simulated) |
| `RunnerAdapter` | `HostRunner` (real agy) | `DemoRunner` (canned, labelled replies) |

Apps only see the interfaces. They read `connection` to label themselves honestly.

## 5. Browser-native vs streamed desktop

| Function | Orbit (native UI in the browser) | Linux desktop / Windows PC (streamed pixels) |
| --- | --- | --- |
| Rendering | React DOM, touch-first, crisp text, works offline in demo | Guacamole canvas of a remote framebuffer |
| Terminal | xterm.js <-> PTY text over WSS (tmux) | xfce4-terminal inside the RDP image |
| Code editing | CodeMirror 6; files over REST | Mousepad on the desktop |
| Agent | Antigravity app: chat UI, agy runs on the host via REST+SSE | `agy` TUI in a desktop terminal |
| Files | Code app file tree (`~/projects` only) | Thunar (whole machine) |
| Web browser | none | Firefox (Linux) / anything on the PC |
| Clipboard / keys | native iOS keyboard + key row | Guacamole keyboard, on-screen keyboard, two-way clipboard |
| Bandwidth | small JSON/text | continuous image updates |
| Needs | Linux machine on (or demo mode) | Linux machine on / home gateway + PC awake |

## 6. X11 / xrdp vs Wayland

- xrdp draws sessions through **xorgxrdp**, which is "Xorg drivers for xrdp" and is meant to be
  used "together with xrdp and X.Org Server". It needs an **X11** session.
- **GNOME Remote Desktop**'s RDP server drives GNOME through the Mutter remote desktop API, so it
  targets **Wayland GNOME** sessions, not an Xorg session started by xrdp. Recent GNOME is dropping
  X11 sessions, and community reports say xrdp doesn't work on Wayland-only GNOME. Those reports
  are secondhand.
- **Our choice:** XFCE on X11 (`echo xfce4-session > ~/.xsession`) behind xrdp + xorgxrdp, with
  xrdp listening on 127.0.0.1 only and reached through guacd. No GNOME and no Wayland.

## 7. Security model

- **Auth everywhere.** The Next.js `proxy.ts` gates every page and API except `/login` and static
  assets, including the Orbit SPA files. Login uses bcrypt plus optional TOTP. Every Orbit host
  route and the PTY socket check an `orbit-host` JWT. Desktop tunnels need a single-use
  `rdp-gateway` ticket. **The only unauthenticated endpoint on the machine is `/healthz`.**
- **Secrets stay server-side.** `RUNPOD_API_KEY`, `LINUX_GATEWAY_SECRET` and `SESSION_SECRET` live
  in Vercel env. `GATEWAY_SECRET` and the desktop password live in the pod env. The browser only
  ever holds short-lived tokens, in memory. PTY and agy children get an env with the gateway
  secrets removed.
- **Network surface:** only port 8080, via Runpod's HTTPS proxy. guacd, xrdp and the PTYs listen on
  localhost.
- **agy:** never `--dangerously-skip-permissions`. In print mode, tools that need approval are
  soft-denied (verified, see below), so an Orbit turn can't run shell commands unless a scoped
  `permissions.allow` rule grants them.
- **CSRF:** `SameSite=Strict` cookie plus `Origin`/`Host` checks on state-changing routes.
- **Accepted limits:** the machine is single-user. `desktop` has passwordless sudo, and the gateway
  runs as `desktop`, so anything running as that user (a terminal command, or an agy tool once
  granted) can in principle read the gateway's environment. Orbit tokens are not single-use;
  they last up to 1 h and are revoked by rotating the secret.

## 8. Persistence

| What | Where | Survives machine stop? |
| --- | --- | --- |
| Projects | `/workspace/home/desktop/projects` | yes (network volume) |
| Orbit sessions + transcripts | `~/.orbit/agent.json` | yes |
| agy sign-in, conversations, settings | `~/.gemini/antigravity-cli/`, `~/.gemini/config/` | yes |
| agy binary (self-updates) | `~/.local/bin/agy` | yes |
| System packages, `/opt/gateway`, install marker | container disk | no: reinstalled on each fresh start |
| tmux sessions, running agy turns | processes | no: turns are marked `error` on restart |
| Demo files, settings, token | browser (localStorage; token in memory) | per browser only |

## 9. agy facts

### CLI surface (`agy --help`, 1.3.4)

- Print mode: `-p/--print/--prompt`, `--output-format text|json|stream-json`,
  `--input-format text|stream-json` (stream-json input needs stream-json output),
  `--print-timeout` (help says default `0s`, meaning wait until the turn completes; the headless
  docs say default `5m`, so Orbit always passes `900s`), and `--json-schema`.
- Session flags: `--conversation <id>`, `-c/--continue`, `--mode accept-edits|plan`,
  `--model`, `--effort`, `--agent`, `--sandbox`, `--add-dir`, `--project`, `--new-project`,
  `--remote-control`, `--disable-slash-commands`, `--log-file`,
  `--dangerously-skip-permissions` (never used).
- Subcommands: `agent(s)`, `changelog`, `help`, `install`, `mcp add|remove|list|enable|disable`,
  `mic-serve`, `models`, `plugin(s) list|import|install|uninstall|enable|disable|validate|link`,
  `remote-control start|status|stop`, `update`.

### stream-json events (observed)

Probe command, run in an empty dir:
`agy --print "Reply with exactly the word: pong" --output-format stream-json --mode plan --sandbox`.
The output is NDJSON, one object per line, with an `event` key:

| `event` | Payload (observed fields) |
| --- | --- |
| `init` (once) | `conversation_id`, `init.{cwd, tools[], permission_mode:"request-review", expanded_commands:[{name:"plan",type:"system"}]}` |
| `step_update` (per step) | `step_update.{conversation_id, step_index, state:"ACTIVE"\|"DONE", step_type:"user_input"\|"system_message"\|"agent_response"\|"tool", tool_name, tool_info.{name, parameters}, text_delta, duration_seconds, usage}` |
| `result` (once) | same shape as `--output-format json`: `{conversation_id, status, response, duration_seconds, num_turns, usage{input,output,thinking,cache_read,total}_tokens, denied_actions[]}` |

- `--conversation <id>` works with stream-json. A second run with the returned id kept the same
  `conversation_id`, `step_index` continued at 3, and `result.num_turns` was 2, with cumulative
  usage and duration. The reply arrived as `text_delta:"pong\n"` on one `agent_response` DONE event.
- Not yet verified: whether events arrive live during a long turn (output was captured to a file,
  not timed), and whether long replies split into several `text_delta` chunks.

### Default mode with print: tools needing approval are auto-denied

`agy --print "List the files in the current directory" --output-format json`, with no `--mode`, in an
empty dir:
exit **0**, `status:"SUCCESS"`, `response:""`, `denied_actions:[{"action":"command","display_name":"RunCommand"}]`,
finished in about 3 s. stderr: *"a tool required the "command" permission that headless mode cannot
prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json (e.g.
command(<target>))..."*. The run did not wait for approval and did not run the tool. The plan-mode
probe behaved the same (it tried `ls -la` and was denied). The docs agree: workspace file
read/write is auto-allowed, shell commands default to Ask, and Ask is soft-denied in headless mode.

### Sign-in and local state

- **Headless/SSH sign-in (docs):** agy prints a URL. Sign in on another device and paste the
  authorization code back. Alternatively, use a Gemini API key (`GEMINI_API_KEY` +
  `"modelProvider":"gemini"`). An unauthenticated headless run errors instead of hanging. Orbit
  tells the user to run `agy` once in Orbit Terminal.
- **State dir** `~/.gemini/antigravity-cli/` (names only): `antigravity-oauth-token` (0600),
  `settings.json`, `installation_id`, `jetski_state.pbtxt`, `jetbox_summaries_proto.pb`,
  `conversation_summaries.db`, `conversations/<id>.db`, `brain/<id>/`, `annotations/`,
  `implicit/`, `presence/<id>.lock`, `cache/`, `builtin/`, `bin/`, `log/` + `cli.log`,
  `crashes/`, `updater/`, `last_check.timestamp`. Also `~/.gemini/config/{mcp_config.json, projects/}`.
- **Auth storage:** the docs say the OS keyring (Secret Service over D-Bus), and the binary links a
  Secret Service client. On this test machine, which has no Secret Service, the sign-in sits in
  the **file** `antigravity-oauth-token`. We assume the pod behaves the same way: it has no keyring
  daemon, and the gateway runs with `env -i`, so there is no D-Bus session.
- **Self-update:** agy updates itself in the background. Observed: 1.3.4 replaced by 1.3.5 during
  the first probe, with the old binary kept as `agy.<n>.old`. The docs give
  `AGY_CLI_DISABLE_AUTO_UPDATE=true` to disable it.

### Capability matrix

| Capability | Status | Evidence |
| --- | --- | --- |
| newConversation | supported | Fresh `--print` runs returned new `conversation_id`s (stream-json and json probes) |
| continueConversation | supported | `--conversation <id>` with stream-json: same id, `step_index` continues, `num_turns: 2` |
| streamOutput | unverified | Event format verified (above); live delivery and chunked `text_delta` not timed; host still uses `json` |
| stop | supported | Host kills agy's process group (SIGTERM, then SIGKILL after 5 s); gateway test "agent: failures and Stop end the turn with a notice" passes (fake agy); real agy's SIGTERM handling not observed this session |
| pauseResume | unsupported | No pause flag or subcommand in `--help`; headless input rejects `control_request` (exit 2); only whole conversations resume |
| approvals | unsupported (print mode) | Default-mode probe: tool soft-denied, `denied_actions`, exit 0; docs: "No interactive prompt exists in headless mode" |
| modes | supported | `--mode accept-edits\|plan` in `--help`; plan probe `init` shows `expanded_commands:[plan]`; default omits the flag |
| models | supported | `agy models` printed 10 `<id>\t<label>` lines, exit 0; `--model` in `--help` |

## 10. Verified vs assumed

| Claim | Status | How |
| --- | --- | --- |
| agy flags and subcommands listed above | verified | `agy --help`, `agy <sub> --help` (1.3.4) |
| stream-json event names and fields | verified | probe run (1.3.4 to 1.3.5) |
| `--conversation` works with stream-json | verified | second probe |
| Print mode soft-denies tools needing approval | verified | default-mode and plan-mode probes |
| `agy models` output is `id<TAB>label` | verified | ran it (1.3.5) |
| agy auto-updates itself | verified | binary replaced, `update_status.json`, `--version` 1.3.5 |
| Sign-in token is a file without a keyring | verified here; assumed on pod | this machine; pod not inspected |
| Host auth, file confinement, tmux reconnect, Stop, signed-out handling, restart recovery | verified (fake agy) | `cd gateway && npm test`: 13/13 pass |
| Runpod v2 pod GET/action and status enum | verified | `api.runpod.io/v2/openapi.json` |
| xorgxrdp needs Xorg | verified (docs) | xorgxrdp README |
| GNOME Remote Desktop targets Wayland GNOME | assumed (secondary sources) | GNOME RD README (Mutter API), community reports |
| Live, incremental stream-json delivery | not verified | needs a timed probe |
| `accept-edits` and default-mode file writes in print mode | not verified | not exercised (no file-writing prompts) |
| Pod home on `/workspace` keeps agy sign-in across stops | assumed | pod-setup design; not re-checked today |

## 11. Open questions

1. **Empty replies on soft-deny.** With default permissions, any shell step is denied and agy
   returns `SUCCESS` with an empty `response`, so Orbit shows a blank reply. The host should surface
   `denied_actions` and stderr. Should we ship scoped `permissions.allow` rules (e.g.
   `command(git)`) for `desktop`?
2. **Switch to stream-json?** This would give live tool steps and text. It needs a timed probe of
   delivery and chunking first.
3. **Pin agy?** It self-updates, as observed. Set `AGY_CLI_DISABLE_AUTO_UPDATE=true` in the gateway
   env, or accept drift and re-verify the capabilities on each version?
4. **REPO_RAW = main.** `main` (1bda8c4) does not yet contain `gateway/src/orbit/*`; only
   `claude/orbit` does. The machine gets Orbit only after the merge. A moving `main` also changes
   the machine on its next start. Pin a tag or SHA instead?
5. **Default mode and file edits in print mode.** The modes docs say default "pauses for diff
   review"; the headless docs say workspace writes are auto-allowed. Which applies?
6. **Approvals path.** Print mode can't ask. `remote-control` (a Google-hosted UI) and the Python
   SDK's "interactive approval flows" are possible alternatives. Both are unverified.
7. **Same-user secret exposure.** Should the gateway run as a separate user from `desktop`?
8. **Runpod `cost` is 0.0 when EXITED** (per the OpenAPI spec), so "Turn on ($0.00/hour)" may show
   while the machine is off.
9. **`ALLOWED_ORIGINS` empty** means any origin passes CORS and the WS Origin check (a token is
   still needed). Make it required in production?
10. **Docs mismatches to watch:** the `--print-timeout` default (`0s` in help vs `5m` in docs); the
    keyring vs the token file; `denied_actions` is not documented.

## Sources

- agy CLI: `agy --help`, `agy {agent,changelog,install,mcp,mcp add,mcp list,mic-serve,models,plugin,remote-control,remote-control start|status|stop,update} --help`, `agy --version`, `agy changelog`, `agy models`
- Probes: the stream-json, `--conversation` and default-mode commands quoted above
- https://antigravity.google/docs/cli/install/ (Linux install, keyring, SSH URL loop, API key)
- https://antigravity.google/docs/cli/headless/ (print mode, json/stream-json, permissions, exit codes)
- https://antigravity.google/docs/cli/modes/ , https://antigravity.google/docs/permissions/?tab=cli
- https://antigravity.google/docs/cli/reference , https://antigravity.google/docs/cli/conversations/
- https://antigravity.google/docs/cli/troubleshooting/ (keyring, auto-update, `AGY_CLI_DISABLE_AUTO_UPDATE`)
- https://antigravity.google/docs/remote-control/?tab=cli , https://antigravity.google/docs/mcp/?tab=cli , https://antigravity.google/docs/sdk/overview/
- https://api.runpod.io/v2/openapi.json
- https://github.com/neutrinolabs/xorgxrdp , https://gitlab.gnome.org/GNOME/gnome-remote-desktop , https://c-nergy.be/blog/?p=20340
- Code: `gateway/src/{index,server}.js`, `gateway/src/orbit/*.js`, `app/api/{orbit/session,machine,gateway-token}/route.ts`, `lib/{runpod,machines,workspaces}.ts`, `proxy.ts`, `linux/pod-setup.sh`, `app/page.tsx`, `orbit/src/services/**`, `orbit/src/shell/Boot.tsx`
