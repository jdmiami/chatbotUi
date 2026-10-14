// Real terminal for Orbit: a WebSocket to a server-side PTY.
// The shell runs inside tmux, so closing the browser (or switching from iPhone to iPad)
// leaves the session running; reconnecting re-attaches to the same tmux session.
//
// Protocol (JSON text frames):
//   client -> server: {type:'auth', token} first, then {type:'input', data} | {type:'resize', cols, rows}
//   server -> client: {type:'ready', session, persistent} | {type:'output', data} | {type:'exit', code} | {type:'error', message}
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyOrbitToken } from './auth.js';

const run = promisify(execFile);

let ptyModule;
async function loadPty() {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = (await import('node-pty')).default ?? (await import('node-pty'));
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

export async function hasTmux() {
  try {
    await run('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

const SESSION_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const clamp = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, Math.floor(+n))) : d);

export function handlePtySocket(ws, url, { secret, cwd, log }) {
  let authed = false;
  let term = null;
  const authTimer = setTimeout(() => {
    if (!authed) ws.close(4401, 'auth timeout');
  }, 10_000);

  const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!authed) {
      if (msg.type !== 'auth') return ws.close(4401, 'auth required');
      try {
        await verifyOrbitToken(msg.token, secret);
      } catch {
        send({ type: 'error', message: 'Not authorised. Reload Orbit to sign in again.' });
        return ws.close(4401, 'unauthorised');
      }
      authed = true;
      clearTimeout(authTimer);
      term = await start();
      return;
    }
    if (!term) return;
    if (msg.type === 'input' && typeof msg.data === 'string') term.write(msg.data);
    else if (msg.type === 'resize') term.resize(clamp(msg.cols, 10, 500, 80), clamp(msg.rows, 4, 200, 24));
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    // Killing the tmux *client* detaches; the tmux session and its programs keep running.
    try {
      term?.kill();
    } catch {
      /* already gone */
    }
  });

  async function start() {
    const pty = await loadPty();
    if (!pty) {
      send({ type: 'error', message: 'Terminal support (node-pty) is not installed on the Linux machine.' });
      ws.close(1011, 'no pty');
      return null;
    }
    const session = SESSION_RE.test(url.searchParams.get('session') || '') ? url.searchParams.get('session') : 'main';
    const cols = clamp(url.searchParams.get('cols'), 10, 500, 80);
    const rows = clamp(url.searchParams.get('rows'), 4, 200, 24);
    const persistent = await hasTmux();
    const [file, args] = persistent
      ? ['tmux', ['new-session', '-A', '-s', `orbit-${session}`, '-c', cwd]]
      : [process.env.SHELL || '/bin/bash', ['-l']];
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'C.UTF-8' };
    // Never leak the gateway's own secrets into the user's shell.
    for (const k of ['GATEWAY_SECRET', 'RDP_PASSWORD', 'DESKTOP_PASSWORD']) delete env[k];
    const p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
    log?.info?.(`[orbit] terminal ${session} started (pid ${p.pid}, ${persistent ? 'tmux' : 'no tmux'})`);
    p.onData((data) => send({ type: 'output', data }));
    p.onExit(({ exitCode }) => {
      send({ type: 'exit', code: exitCode });
      ws.close(1000);
    });
    send({ type: 'ready', session, persistent });
    return p;
  }
}

/** End a tmux session for good ("Restart shell"). */
export async function killTerminalSession(session) {
  if (!SESSION_RE.test(session)) return;
  try {
    await run('tmux', ['kill-session', '-t', `orbit-${session}`]);
  } catch {
    /* not running */
  }
}
