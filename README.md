# Your workspace in a browser

One private website, one login. After you sign in you choose how you want to work:

| Workspace | What it is | Runs on |
| --- | --- | --- |
| **Orbit** | A touch-first workspace for iPhone and iPad: Terminal, Code editor and Antigravity chat | Your Linux machine on Runpod |
| **Linux desktop** | A full XFCE desktop (Remote Desktop) | Your Linux machine on Runpod |
| **Windows PC** | Your own Windows PC (Remote Desktop) | Your PC at home, via the gateway (optional) |

Tick **Remember my choice** to go straight to your favourite next time; **Switch workspace** (in
each workspace) or `/?choose=1` brings the chooser back.

The Linux machine only costs money while it is on. The chooser page shows whether it is on and has
**Turn on** / **Turn off** buttons (Orbit offers **Turn on** too). Your files live on saved storage, so
they are kept while the machine is off.

```
Browser ──https──▶ Vercel app (login, workspace chooser, machine power, short-lived tokens)
   │
   ├──https/wss (1-hour token)──▶ Runpod Linux machine :8080 ─┬─ Orbit host: files, terminal (tmux), agy runner
   │                                                          └─ gateway ─▶ guacd ─▶ xrdp (Linux desktop)
   └──wss (60-second ticket)────▶ Cloudflare Tunnel ─▶ gateway ─▶ guacd ─RDP─▶ your Windows PC (at home)
```

Why two parts? Vercel functions can't hold the long-lived connection a terminal or desktop needs,
so the streaming happens on the machine itself. Passwords for the desktops stay on those machines,
never on Vercel or in the browser.

Remote desktop features: hi-DPI auto-resize to your window, keyboard/mouse/touch, two-way clipboard,
Ctrl+Alt+Del and Win keys, on-screen keyboard for phones, fullscreen, audio.

## Repo layout

| Path | What it is |
| --- | --- |
| `app/`, `lib/`, `proxy.ts` | Next.js app deployed to Vercel (login, workspace chooser, machine power, browser RDP client) |
| `orbit/` | Orbit, a Vite + React app built into `public/orbit` and served at `/orbit` behind the same login ([spec](orbit/SPEC.md)) |
| `gateway/` | Gateway: RDP over WebSocket (Apache Guacamole `guacd`) and, on the Linux machine, the Orbit host API |
| `linux/` | Script that turns an Ubuntu cloud machine into the Linux machine for this app ([guide](linux/README.md)) |
| `scripts/` | Helpers to hash your password, set up 2FA and build Orbit |

## Antigravity (agy) on the Linux machine

Orbit's Antigravity app drives the real `agy` CLI on your Linux machine, one `agy --print` call per
message (it never turns on agy's "skip permissions" mode). agy needs a one-time sign-in on the
machine: open **Orbit → Terminal**, run `agy`, open the link it prints, sign in with Google, and paste
the code back. The sign-in is kept on saved storage, so you only do this once. Because Orbit runs agy
non-interactively, steps that need your approval (such as shell commands) are skipped and Orbit says so;
see [linux/README.md](linux/README.md#antigravity) to allow some ahead of time.

## Linux machine settings (Vercel environment variables)

| Variable | Purpose |
| --- | --- |
| `LINUX_POD_ID` | The Runpod pod id of your Linux machine |
| `LINUX_GATEWAY_SECRET` | Shared secret with the machine (its `GATEWAY_SECRET`) |
| `LINUX_GATEWAY_URL` | Optional; defaults to `wss://<LINUX_POD_ID>-8080.proxy.runpod.net` |
| `RUNPOD_API_KEY` | Lets the site turn the machine on and off. Create it in the Runpod console → Settings → API Keys. It stays on the server and is never sent to the browser |

---

## Setup

The steps below set up the optional **Windows PC** workspace. For the Linux machine, see
[linux/README.md](linux/README.md).

### 1. Turn on Remote Desktop on the PC

Settings → System → Remote Desktop → **On**. This needs Windows **Pro, Enterprise or Education**
(Windows Home can't accept RDP connections). Note the PC's local IP (`ipconfig`), and give it a
static/reserved IP in your router.

Use your Windows sign-in for `RDP_USERNAME`/`RDP_PASSWORD` (for a Microsoft account, the email
address and its password).

### 2. Create the secrets

```bash
npm install
npm run gen-secret                          # -> GATEWAY_SECRET (same value in Vercel AND gateway/.env)
npm run gen-secret                          # -> SESSION_SECRET (Vercel only)
npm run hash-password -- "a long password"  # -> AUTH_PASSWORD_HASH (Vercel only)
npm run setup-2fa -- admin                  # -> TOTP_SECRET (optional, recommended)
```

### 3. Run the gateway at home

On the PC itself (with [Docker Desktop](https://www.docker.com/products/docker-desktop/)) or on any
always-on machine on the same network:

1. In the [Cloudflare dashboard](https://one.dash.cloudflare.com/) → Networks → Tunnels → **Create a tunnel**
   (type *Cloudflared*). Copy its token. Add a **public hostname**, e.g. `rdp-gw.yourdomain.com`, with
   service `http://gateway:8080`. (Needs a domain on Cloudflare; the free plan works.)
2. Configure and start:

   ```bash
   cd gateway
   cp .env.example .env     # fill in GATEWAY_SECRET, ALLOWED_ORIGINS, RDP_*, CLOUDFLARE_TUNNEL_TOKEN
   docker compose --profile tunnel up -d --build
   ```

   `RDP_HOST=host.docker.internal` targets the machine running Docker; otherwise use the PC's LAN IP.
3. Check: `https://rdp-gw.yourdomain.com/healthz` should say `ok`.

No ports need to be opened on your router. (Prefer not to use Cloudflare? Any HTTPS reverse proxy
that supports WebSockets in front of port 8080 works — never expose port 3389 itself.)

### 4. Deploy the website on Vercel

1. Import this repo in Vercel (framework: Next.js, root directory: `/`).
2. Add the environment variables from `.env.example`:
   `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `TOTP_SECRET`, `SESSION_SECRET`, `GATEWAY_SECRET`,
   `GATEWAY_URL=wss://rdp-gw.yourdomain.com`.
3. Deploy, then put the Vercel URL (e.g. `https://your-app.vercel.app`) in `ALLOWED_ORIGINS` in
   `gateway/.env` and run `docker compose --profile tunnel up -d` again.
4. Recommended: Vercel → Firewall → add a **rate limit** rule for `/login` (e.g. 10 requests/minute per IP).

Open the site, sign in, and choose **Windows PC**.

---

## Security

- The login uses bcrypt, an HttpOnly/Secure/SameSite=Strict session cookie and optional TOTP 2FA.
  Turn on 2FA: this page controls your computer.
- The browser only ever gets a **60-second, single-use** ticket signed with `GATEWAY_SECRET`. The
  gateway checks the signature, expiry, issuer, audience, single use and the page's `Origin`.
- RDP credentials live only in `gateway/.env` on your network.
- To sign out every device, change `SESSION_SECRET` in Vercel and redeploy.
- RDP's own port (3389) is never exposed to the internet.

## Local development

```bash
cp .env.example .env.local   # fill it in; GATEWAY_URL=ws://localhost:8080 with the gateway running locally
npm run dev                  # the site; Orbit at /orbit needs `npm run build:orbit` first
cd orbit && npm install && npm run dev    # Orbit alone, in demo mode (no Linux machine needed)
cd gateway && npm install && npm test
```

## Troubleshooting

| Message | Fix |
| --- | --- |
| *Could not reach your PC* | Gateway/tunnel not running, wrong `RDP_HOST`, PC asleep, or Remote Desktop off. `docker compose logs gateway` |
| *Windows rejected the username or password* | Fix `RDP_USERNAME`/`RDP_PASSWORD`/`RDP_DOMAIN`; try `RDP_SECURITY=nla` |
| Connection drops instantly | `ALLOWED_ORIGINS` doesn't match your Vercel URL (exact, or a `*` pattern), or `GATEWAY_SECRET` differs between Vercel and the gateway |
| Wrong characters when typing | Set `RDP_KEYBOARD_LAYOUT` |
