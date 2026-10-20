# OpenClaw in Orbit (Phase 3)

OpenClaw is an AI agent that runs on the Linux machine. Orbit is its screen: open the agent screen and pick **OpenClaw** at the top. The **Antigravity** choice is still there.

## How it fits together

```
Orbit (iPhone/iPad) ──► Linux machine gateway :8080 /orbit/api/claw/…  (Orbit's signed-in API)
                              │
                              └─► OpenClaw 127.0.0.1:18789  (loopback only, token sign-in)
                                      │
                                      ├─► 127.0.0.1:8090/cloud/v1 ─► site /api/orb/ai ─► NVIDIA (key stays in Vercel)
                                      └─► 127.0.0.1:8090/v1       ─► your AI machine (woken when needed)
```

- `gateway/src/orbit/claw-client.js` signs in to OpenClaw:
  - token auth, plus an Ed25519 device key kept in `~/.orbit/claw-device.json` (mode 0600);
  - sends requests and receives events.
- `gateway/src/orbit/claw.js` (`ClawService`) keeps Orbit's sessions and transcripts in the same format as Antigravity, and turns OpenClaw's events into the transcript:
  - replies;
  - tool steps;
  - **approval cards**.
- `gateway/src/orbit/http.js` serves the same routes for Antigravity (`/agent/…`) and OpenClaw (`/claw/…`). OpenClaw also has `POST /claw/sessions/:id/approvals/:approvalId {decision}`.
- Orbit side:
  - `HostRunner(host, 'claw')`;
  - the agent switch in `apps/agent/AgentApp.tsx`;
  - the approval card in `apps/agent/Transcript.tsx`.

## Safety settings

These are written by `linux/pod-setup.sh` on every boot, so they can't drift.

- **Commands:** every command waits for you. The setting is `tools.exec.security: allowlist` plus `ask: always`. In Orbit you answer **Allow once** or **Deny**; "allow always" is not offered.
- **Unanswered approvals:** an approval that nobody answers is denied. Requests that don't come from an Orbit session are denied straight away.
- **Files:** OpenClaw's file tools stay inside `~/projects` (`tools.fs.workspaceOnly`).
- **Turned off:**
  - elevated mode;
  - web, browser, messaging, nodes and automation tools;
  - chat channels (`OPENCLAW_SKIP_CHANNELS=1`);
  - the heartbeat (`every: 0m`);
  - completion turns after background commands;
  - "dreaming".
- **No way in from outside:**
  - OpenClaw listens on 127.0.0.1 only, and its control web page is off. The only way in is Orbit's signed-in API.
  - OpenClaw's token is in `~/.openclaw-orbit/token` (mode 0600), and reaches OpenClaw through its environment, never a command line.

## Models

| Order | Model | Where it runs | Cost |
| --- | --- | --- | --- |
| First | `orbit-cloud/orbit-agent` | Cloud AI (NVIDIA) through the site | Free; works with the AI machine off |
| Fallback | `orbit/<CODE_MODEL>` | Your AI machine | Wakes the AI machine; billed while on |

## Versions

- OpenClaw `2026.10.4`, installed with its own Node 24 (`/opt/node24`). The system Node 22 is unchanged.
