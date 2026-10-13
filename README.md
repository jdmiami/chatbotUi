# Remote Desktop in your browser

Use your Windows PC from any browser (laptop, tablet or phone). The website runs on **Vercel** and is
protected by a login (password + optional authenticator-app code). A small **gateway** runs on your
home network and does the actual Remote Desktop (RDP) connection.

```
Browser ──https──▶ Vercel app (login, issues 60-second tickets)
   │
   └──wss (ticket)──▶ Cloudflare Tunnel ──▶ gateway ──▶ guacd ──RDP──▶ your Windows PC
                                            └──── runs at home (Docker) ────┘
```

Why two parts? Vercel functions can't hold the long-lived connection an RDP session needs, so the
streaming happens at home. Your Windows password stays at home too: it's only in the gateway's
`.env`, never on Vercel or in the browser.

Features: hi-DPI auto-resize to your window, keyboard/mouse/touch, two-way clipboard,
Ctrl+Alt+Del and Win keys, on-screen keyboard for phones, fullscreen, audio.

## Repo layout

| Path | What it is |
| --- | --- |
| `app/`, `lib/`, `proxy.ts` | Next.js app deployed to Vercel (login + browser RDP client) |
| `gateway/` | Gateway for your home network (Node + Apache Guacamole `guacd`, Docker Compose) |
| `scripts/` | Helpers to hash your password and set up 2FA |

---

## Setup

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

Open the site, sign in, and your desktop appears.

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
npm run dev
cd gateway && npm install && npm test
```

## Troubleshooting

| Message | Fix |
| --- | --- |
| *Could not reach your PC* | Gateway/tunnel not running, wrong `RDP_HOST`, PC asleep, or Remote Desktop off. `docker compose logs gateway` |
| *Windows rejected the username or password* | Fix `RDP_USERNAME`/`RDP_PASSWORD`/`RDP_DOMAIN`; try `RDP_SECURITY=nla` |
| Connection drops instantly | `ALLOWED_ORIGINS` doesn't match your Vercel URL exactly, or `GATEWAY_SECRET` differs between Vercel and the gateway |
| Wrong characters when typing | Set `RDP_KEYBOARD_LAYOUT` |
