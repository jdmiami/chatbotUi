# AI machine

Your own open-weights models with a full chat playground, on a Runpod GPU pod that is only on while
you use it.

```
browser ── https ──> gate :8080 ──> Open WebUI 127.0.0.1:8081 ──> Ollama 127.0.0.1:11434 (GPU)
Orbit AI app / coding agent ──> gate :8080 /v1 ──> Ollama (OpenAI-compatible API)
```

- **Playground**: [Open WebUI](https://github.com/open-webui/open-webui) (chat, documents, web search,
  voice, code interpreter, model downloads, side-by-side models). Pinned image
  `ghcr.io/open-webui/open-webui:0.12.2-ollama`, which also runs Ollama on the GPU.
- **Models** (default): `qwen3.8:27b` (general, vision) and `qwen3.6:35b` (coding, tool calls).
  Downloaded once to the network volume; add more from the playground's admin settings.
- **Gate** (`gate/`, Node, no dependencies): the only exposed port.
  - `/_orbit/login?token=…` swaps a 90-second, single-use token from the site for an HttpOnly cookie,
    then tells Open WebUI who you are with a trusted header it always strips from incoming requests.
  - `/v1/*` forwards to Ollama for bearer tokens from the site (Orbit's AI app) or the Linux machine
    (the coding agent).
  - `/_orbit/status` reports readiness, model downloads and idle time.
  - Stops the pod after `IDLE_MINUTES` (30) with no chats, no model loaded and no download running.
- **Site** (`lib/ai.ts`): finds the pod by name (`orbit-ai`), creates it on first use, starts it,
  points a stopped pod at the site's own commit before starting, and replaces it when its host has no
  free GPU (everything worth keeping is on the volume).

## Set up

1. Create a network volume (50 GB is enough for the two default models) in a data center that has
   the GPU you want (default: `CA-MTL-1`, NVIDIA A40 48 GB, about $0.59/hour while on).
2. In Vercel set `AI_VOLUME_ID` (and `RUNPOD_API_KEY`, `LINUX_GATEWAY_SECRET`, already used by the
   Linux machine). Optional settings are in `.env.example`.
3. Open **AI playground** on the start screen. The first start downloads the models (10–15 minutes).

## Coding

The Linux machine runs VS Code in the browser (code-server) at `/code/` with the
[Kilo Code](https://github.com/Kilo-Org/kilocode) agent, configured in `~/.config/kilo/kilo.jsonc` to use
`http://127.0.0.1:8090/v1`: the Linux machine's gateway forwards that to the AI machine and asks the site
to turn it on when it's off. See `linux/pod-setup.sh`.
