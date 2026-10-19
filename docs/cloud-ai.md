# Cloud AI (NVIDIA free API)

Quick AI jobs in Orbit use NVIDIA's free cloud models. These jobs are the orb planning a step, help with writing, and reading the screen. They work even when the AI machine is off. Pictures, videos and long chats stay on the AI machine, and the AI machine is also the fallback when cloud AI is off or busy.

## How it fits together

```
Orbit (browser) ──► /api/orb/ai (Vercel, holds NVIDIA_API_KEY) ──► integrate.api.nvidia.com/v1
                         ▲
Linux machine ───────────┘  (machine token, LINUX_GATEWAY_SECRET, audience "site-machine")
```

- The key lives only in Vercel as `NVIDIA_API_KEY`, set to Sensitive and Production. It never reaches the browser.
- `GET /api/orb/ai` returns whether cloud AI is set up and which models each job uses.
- `POST /api/orb/ai` takes `{ task, messages, stream?, max_tokens?, temperature?, tools?, tool_choice?, model? }`.
  - `task` is one of `fast`, `agent`, `vision` or `write`.
  - The route tries that task's models in order and moves to the next one when a model is missing, busy (429) or failing (5xx).
  - The `x-orb-model` header says which model answered.
- Before anything is sent to NVIDIA:
  - password boxes, one-time codes and card fields are left out in the browser (`privateField` in `orbit/src/shell/orb/agent.ts`);
  - anything that looks like a key or token is blanked on the server (`redact` in `lib/orbAi.ts`).
- In Settings, the **Cloud AI** section turns the feature off and lists exactly what is sent.

## Models

The defaults are in `lib/orbAi.ts`. To swap them without a code change, set `ORB_MODELS` in Vercel, for example:

```
ORB_MODELS={"agent":["z-ai/glm-5.3","nvidia/nemotron-3-super-120b-a12b"]}
```

The live list is at `https://integrate.api.nvidia.com/v1/models` (no key needed).

## Comparing models

`scripts/orb-eval.mjs` runs about 30 real Orbit jobs against each model through the live site, pinning one model at a time. The jobs cover orb steps, writing help, quick answers and recognising colours in a picture.

```
ORB_SITE=https://<site> ORB_TOKEN_CMD="<prints a machine token>" node scripts/orb-eval.mjs [agent|fast|write|vision]
```

## Limits

The free tier is meant for trying things out and allows roughly 40 requests a minute. When it is busy, the orb falls back to the AI machine if that is on.

To get a key, sign in at build.nvidia.com and create an API key; it starts with `nvapi-`. Add it in Vercel as `NVIDIA_API_KEY`, set to Sensitive, then redeploy.

## What uses it

| Feature | Where | Job | What is sent |
| --- | --- | --- | --- |
| Orb plans a step | Hold the orb, ask anything | `agent` | The goal, the numbered controls on screen and up to 1,500 characters of visible text |
| Ghost text | Any plain text box (not passwords, codes, autofill, Code or Terminal) | `fast` | Up to the last 1,500 characters of that box |
| Rewrite | Select words, then **Rewrite**: Fix, Shorter, Friendlier, Formal, Expand or Translate | `write` | The selected words |
| Explain this screen | "Explain this", "what does this mean?" | `fast`, or `vision` when pictures are on screen | Visible text (up to 5,000 characters) and up to 2 pictures, made small |
| Find | "find my chat about…", "where is the budget file" | `fast` (re-ranking only) | Titles and short snippets of the best local matches; the search itself runs in the browser |
| Bring | "bring me the packing list" | as Find | The same; the found text goes into the last box you typed in |
| Make | **Picture** or **Video** in the Rewrite menu, or "make a picture of…" | none | Nothing: it runs on your AI machine |

Writing help can be switched off on its own in **Settings → Cloud AI**.
