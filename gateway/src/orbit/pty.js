// Real terminal for Orbit: a WebSocket to a server-side PTY.
// The shell runs inside tmux, so closing the browser (or switching from iPhone to iPad)
// leaves the session running; reconnecting re-attaches to the same tmux session.
//
// Protocol (JSON text frames):
//   client -> server: {type:'auth', token} first, then {type:'input', data} | {type:'resize', cols, rows}
//   server -> client: {type:'ready', session, persistent} | {type:'output', data} | {type:'exit', code} | {type:'error', message}
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { verifyOrbitToken } from './auth.js';

const run = promisify(execFile);

// Orbit's terminals run in their own tmux server (socket "orbit") with this config:
// - no alternate screen, so the browser terminal (xterm.js) keeps the scrollback and touch/wheel
//   scrolling works (in the alternate screen xterm.js turns a wheel into arrow keys = old commands);
// - no status bar (Orbit's header already names the session; a phone has few rows to spare);
// - the most recently used device decides the window size.
const TMUX_SOCKET = 'orbit';
const TMUX_CONF = `set -ga terminal-overrides ',xterm*:smcup@:rmcup@'
set -as terminal-features ',*:hyperlinks'
set -g history-limit 10000
set -g status off
set -g window-size latest
setw -g aggressive-resize on
set -g escape-time 10
`;
let tmuxConfPath = null;
function tmuxConf() {
  if (!tmuxConfPath) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-tmux-'));
    tmuxConfPath = path.join(dir, 'tmux.conf');
    fs.writeFileSync(tmuxConfPath, TMUX_CONF, { mode: 0o600 });
  }
  return tmuxConfPath;
}

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
    if (msg.type === 'input' && typeof msg.data === 'string') {
      // After a swipe into tmux's history, typing first returns to the live screen (otherwise
      // tmux's history view would swallow the keys). Kept in order with pending scrolls.
      if (scrolledBack || queued) {
        const data = msg.data;
        enqueue(async () => {
          if (scrolledBack) {
            scrolledBack = false;
            await leaveScrollback(tmuxTarget).catch(() => {});
            send({ type: 'scrollback', active: false });
          }
          term.write(data);
        });
      } else term.write(msg.data);
    } else if (msg.type === 'scroll' && tmuxTarget) {
      const toLatest = msg.to === 'bottom';
      const lines = clamp(msg.lines, -500, 500, 0);
      if (!toLatest && !lines) return;
      enqueue(async () => {
        if (toLatest) await leaveScrollback(tmuxTarget).catch(() => {});
        else await scrollTerminal(tmuxTarget, lines).catch(() => {});
        const back = await inScrollback(tmuxTarget).catch(() => false);
        if (back !== scrolledBack) {
          scrolledBack = back;
          send({ type: 'scrollback', active: back });
        }
      });
    } else if (msg.type === 'resize') {
      const cols = clamp(msg.cols, 10, 500, 80);
      const rows = clamp(msg.rows, 4, 200, 24);
      term.resize(cols, rows);
      // The same session may be open on several devices: the one that just reported its size (it is
      // the one being looked at) sets the window size, so it never shows another device's smaller box.
      if (tmuxTarget) {
        run('tmux', ['-L', TMUX_SOCKET, 'resize-window', '-t', tmuxTarget, '-x', String(cols), '-y', String(rows)]).catch(
          () => {},
        );
      }
    }
  });

  let tmuxTarget = null;
  /** The pane is showing tmux's history (copy mode) because of a swipe. */
  let scrolledBack = false;
  // Scrolls and the input that follows them run in order.
  let chain = Promise.resolve();
  let queued = 0;
  const enqueue = (fn) => {
    queued++;
    chain = chain
      .then(fn)
      .catch(() => {})
      .finally(() => queued--);
  };

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
      ? ['tmux', ['-L', TMUX_SOCKET, '-f', tmuxConf(), 'new-session', '-A', '-s', `orbit-${session}`, '-c', cwd]]
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
    if (persistent) tmuxTarget = `orbit-${session}`;
    send({ type: 'ready', session, persistent });
    return p;
  }
}

const tmuxRun = (args) => run('tmux', ['-L', TMUX_SOCKET, ...args]);

/**
 * Scroll for touch gestures (lines < 0 = back/up). tmux knows what is in front of the shell:
 *  - the shell itself: tmux's own history (copy mode; it ends by itself at the bottom),
 *  - a program that reads the mouse: mouse-wheel events,
 *  - another full-screen program: the keys it scrolls with (agy: Shift+arrows, vim: Ctrl+E/Y,
 *    less, man and most others: arrows).
 */
export async function scrollTerminal(target, lines) {
  const n = Math.min(Math.abs(Math.trunc(lines)), 200);
  if (!n) return;
  const up = lines < 0;
  const { stdout } = await tmuxRun([
    'display',
    '-p',
    '-t',
    target,
    '#{alternate_on}|#{pane_in_mode}|#{mouse_any_flag}|#{mouse_sgr_flag}|#{pane_current_command}',
  ]);
  const [alt, inMode, mouseAny, sgr, cmd] = stdout.trim().split('|');
  if (inMode === '1' || alt !== '1') {
    if (inMode !== '1') {
      if (!up) return; // already at the newest line
      await tmuxRun(['copy-mode', '-e', '-t', target]);
    }
    await tmuxRun(['send-keys', '-t', target, '-X', '-N', String(n), up ? 'scroll-up' : 'scroll-down']);
    return;
  }
  if (mouseAny === '1') {
    const button = up ? 64 : 65;
    const one = sgr === '1' ? `\x1b[<${button};1;1M` : `\x1b[M${String.fromCharCode(32 + button)}!!`;
    const hex = Buffer.from(one.repeat(Math.min(n, 30))).toString('hex').match(/../g);
    await tmuxRun(['send-keys', '-t', target, '-H', ...hex]);
    return;
  }
  const key = /^n?vim?$/.test(cmd) ? (up ? 'C-y' : 'C-e') : cmd === 'agy' ? (up ? 'S-Up' : 'S-Down') : up ? 'Up' : 'Down';
  await tmuxRun(['send-keys', '-t', target, '-N', String(n), key]);
}

/** Back to the live screen if the pane is showing tmux's history. */
export async function leaveScrollback(target) {
  await tmuxRun(['if-shell', '-F', '-t', target, '#{pane_in_mode}', `send-keys -X -t ${target} cancel`]);
}

export async function inScrollback(target) {
  const { stdout } = await tmuxRun(['display', '-p', '-t', target, '#{pane_in_mode}']);
  return stdout.trim() === '1';
}

/**
 * The session's full scrollback as plain text (tmux keeps it on the machine, so it survives
 * reconnects). null when there is no such session.
 */
export async function terminalHistory(session, lines = 10000) {
  if (!SESSION_RE.test(session)) return null;
  try {
    const { stdout } = await run(
      'tmux',
      ['-L', TMUX_SOCKET, 'capture-pane', '-p', '-J', '-S', `-${lines}`, '-t', `orbit-${session}`],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.replace(/\s+$/, '') + '\n';
  } catch {
    return null;
  }
}

/** End a tmux session for good ("Restart shell"). */
export async function killTerminalSession(session) {
  if (!SESSION_RE.test(session)) return;
  try {
    await run('tmux', ['-L', TMUX_SOCKET, 'kill-session', '-t', `orbit-${session}`]);
  } catch {
    /* not running */
  }
}
