# Linux machine

`pod-setup.sh` turns a fresh Ubuntu 24.04 container into the Linux machine behind two workspaces:

- **Orbit** (touch-first Terminal, Code and Antigravity): the gateway's Orbit host serves the
  project files in `~/projects`, real terminals (each one a `tmux` session, so it survives a dropped
  connection) and an Antigravity runner that calls the installed `agy` CLI.
- **Linux desktop**: XFCE and Firefox over RDP (xrdp) through guacd and the same gateway the Windows
  PC uses.

Only port 8080 (the gateway) is exposed. RDP, guacd and the terminals are reachable only through
it, and every request needs a short-lived token signed by the website.

```
browser --https/wss--> gateway :8080 --+-- Orbit host: files, terminal (tmux), agy runner  (runs as `desktop`)
                                       +-- guacd :4822 --> xrdp :3389 --> XFCE
```

## Run it on Runpod (CPU pod)

Create a **network volume** first (Secure Cloud, e.g. 20 GB) so the home folder, projects, Orbit
sessions and the agy sign-in survive stopping the machine. Then create a CPU pod with:

| Setting | Value |
| --- | --- |
| Image | `ubuntu:24.04` |
| Exposed HTTP port | `8080` |
| Network volume | mounted at `/workspace` |
| Start command | `bash -c "apt-get update && apt-get install -y curl ca-certificates && curl -fsSL https://raw.githubusercontent.com/jdmiami/chatbotUi/main/linux/pod-setup.sh \| bash"` |
| Env `GATEWAY_SECRET` | `npm run gen-secret` (same value as `LINUX_GATEWAY_SECRET` in Vercel) |
| Env `DESKTOP_PASSWORD` | the password for the `desktop` user's desktop sign-in |
| Env `ALLOWED_ORIGINS` | your Vercel URL(s), comma separated, e.g. `https://your-app.vercel.app,https://your-app-*-your-team.vercel.app`. A `*` stands for one part of the address (letters, digits, dashes), so the second entry covers each deployment's and branch's own Vercel address. |

The first boot installs everything (a few minutes); later boots take about a minute. Then set these
in Vercel and redeploy:

```
LINUX_POD_ID=<pod-id>
LINUX_GATEWAY_SECRET=<same as the pod's GATEWAY_SECRET>
RUNPOD_API_KEY=<a Runpod API key, so the site can turn the machine on and off>
```

Check `https://<pod-id>-8080.proxy.runpod.net/healthz` says `ok`.

The machine turns itself off after 60 minutes without touch, mouse or keyboard input while no
Antigravity turn or Claude Code task runs: the same rule and timer as the AI machine
(`shared/autooff.js`, which this setup downloads to `/opt/shared`). Set `AUTO_OFF_MINUTES` (10–60) in
Vercel to change it for every machine; the site sends it as `IDLE_MINUTES` when it turns the machine
on. **Keep on** in Orbit's Settings → Usage adds 30 minutes, up to 2 hours ahead.

The `desktop` user has password-less `sudo` (it is a single-person machine and Orbit's terminal has no
password prompt UI).

## Antigravity

Sign in once: in **Orbit → Terminal** run `agy`, open the link it prints, sign in with Google, then
paste the code back into the terminal. The sign-in is stored as a file in the home folder on the
network volume (`~/.gemini/antigravity-cli/`), so it survives restarts.

Use Orbit's Terminal for this rather than a terminal on the Linux desktop: a desktop session may hand
the sign-in to a keyring that Orbit's Antigravity runner can't read.

In Orbit, agy runs non-interactively, so it can't ask before running a shell command. It skips such
steps and Orbit tells you which. To allow some commands ahead of time, add `permissions.allow` rules
(for example `command(git)`) to `~/.gemini/antigravity-cli/settings.json`.

## Cost

While it is on, a `cpu3g` 2 vCPU / 8 GB machine costs about $0.08/hour. While it is off it costs
nothing per hour; the network volume bills for storage (about $0.07 per GB per month, so about $1.40 a
month for 20 GB). On each start the system packages reinstall, but everything under `/workspace`
is kept.
