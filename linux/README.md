# Linux desktop

`pod-setup.sh` turns a fresh Ubuntu 24.04 container into a Linux desktop the web app can open:
XFCE, Firefox and the Antigravity CLI, served over RDP (xrdp) through guacd and the same gateway
the Windows PC uses. Only port 8080 (the gateway) is exposed. RDP itself listens on localhost.

```
browser --wss--> gateway :8080 --> guacd :4822 --> xrdp :3389 --> XFCE
```

## Run it on Runpod (CPU pod)

Create a CPU pod with:

| Setting | Value |
| --- | --- |
| Image | `ubuntu:24.04` |
| Exposed HTTP port | `8080` |
| Volume mount | `/workspace` (keeps your home folder across restarts) |
| Start command | `bash -c "apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/jdmiami/chatbotUi/main/linux/pod-setup.sh \| bash"` |
| Env `GATEWAY_SECRET` | `npm run gen-secret` (same value as `LINUX_GATEWAY_SECRET` in Vercel) |
| Env `DESKTOP_PASSWORD` | a password for the `desktop` user (also its `sudo` password) |
| Env `ALLOWED_ORIGINS` | your Vercel URL, e.g. `https://your-app.vercel.app` |

First boot installs everything (a few minutes). Then set these in Vercel and redeploy:

```
LINUX_GATEWAY_URL=wss://<pod-id>-8080.proxy.runpod.net
LINUX_GATEWAY_SECRET=<same as the pod's GATEWAY_SECRET>
```

Check `https://<pod-id>-8080.proxy.runpod.net/healthz` says `ok`.

## Antigravity

Open a terminal on the desktop and run `agy`. Sign-in opens Firefox on the desktop.

## Cost

A stopped pod costs nothing per hour (its volume still bills for storage). When it starts
again the system packages reinstall, but your home folder on `/workspace` is kept.
