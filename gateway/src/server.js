// RDP gateway: bridges the browser (Guacamole WebSocket tunnel) to guacd, which speaks RDP.
//
// Browser --wss--> [this gateway] --tcp--> guacd --rdp--> Windows PC
//
// The browser never sees the RDP credentials. It only gets a short-lived, single-use
// token minted by the Vercel app after the user logs in. The token is a JWT signed
// with GATEWAY_SECRET, which is shared between the Vercel app and this gateway.

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { WebSocketServer } from 'ws';
import { jwtVerify } from 'jose';
import { encodeInstruction, InstructionParser } from './protocol.js';
import { handlePtySocket } from './orbit/pty.js';

export function loadConfig(env = process.env) {
  const required = ['GATEWAY_SECRET', 'RDP_HOST'];
  for (const key of required) {
    if (!env[key]) throw new Error(`Missing required environment variable ${key}`);
  }
  if (env.GATEWAY_SECRET.length < 32) {
    throw new Error('GATEWAY_SECRET must be at least 32 characters');
  }
  const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v));
  return {
    port: Number(env.PORT || 8080),
    secret: new TextEncoder().encode(env.GATEWAY_SECRET),
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    guacd: { host: env.GUACD_HOST || '127.0.0.1', port: Number(env.GUACD_PORT || 4822) },
    rdp: {
      hostname: env.RDP_HOST,
      port: env.RDP_PORT || '3389',
      username: env.RDP_USERNAME || '',
      password: env.RDP_PASSWORD || '',
      domain: env.RDP_DOMAIN || '',
      security: env.RDP_SECURITY || 'any',
      'ignore-cert': bool(env.RDP_IGNORE_CERT, true) ? 'true' : '',
      'resize-method': 'display-update',
      'enable-wallpaper': bool(env.RDP_ENABLE_WALLPAPER, false) ? 'true' : '',
      'enable-font-smoothing': 'true',
      'enable-full-window-drag': '',
      'enable-desktop-composition': '',
      'enable-menu-animations': '',
      'disable-audio': bool(env.RDP_ENABLE_AUDIO, true) ? '' : 'true',
      'disable-copy': bool(env.RDP_ENABLE_CLIPBOARD, true) ? '' : 'true',
      'disable-paste': bool(env.RDP_ENABLE_CLIPBOARD, true) ? '' : 'true',
      'server-layout': env.RDP_KEYBOARD_LAYOUT || 'en-us-qwerty',
    },
    timezone: env.RDP_TIMEZONE || '',
    handshakeTimeoutMs: 15000,
  };
}

// Single-use token tracking (jti -> expiry). Tokens live ~60s, so this stays tiny.
const usedTokens = new Map();
function markTokenUsed(jti, expSeconds) {
  const now = Date.now();
  for (const [id, exp] of usedTokens) if (exp < now) usedTokens.delete(id);
  if (usedTokens.has(jti)) return false;
  usedTokens.set(jti, expSeconds * 1000);
  return true;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Performs the guacd handshake and resolves with the connected socket plus any
// bytes guacd sent after "ready" (already decoded) once the RDP session is up.
function connectToGuacd(config, display) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(config.guacd.port, config.guacd.host);
    const decoder = new StringDecoder('utf8');
    const parser = new InstructionParser();
    let stage = 'args';

    const timer = setTimeout(() => fail(new Error('guacd handshake timed out')), config.handshakeTimeoutMs);

    function fail(err) {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    }

    socket.on('error', fail);
    socket.on('close', () => fail(new Error('guacd closed the connection during handshake')));

    socket.on('connect', () => {
      socket.write(encodeInstruction('select', 'rdp'));
    });

    function onData(chunk) {
      let parsed;
      try {
        parsed = parser.push(decoder.write(chunk));
      } catch (err) {
        return fail(err);
      }
      for (let i = 0; i < parsed.instructions.length; i++) {
        const [opcode, ...args] = parsed.instructions[i];

        if (opcode === 'error') return fail(new Error(`guacd error: ${args[0]}`));

        if (stage === 'args' && opcode === 'args') {
          const settings = { ...config.rdp };
          const values = args.map((name) => {
            if (name.startsWith('VERSION_')) return name; // echo the protocol version back
            return settings[name] ?? '';
          });
          socket.write(
            encodeInstruction('size', display.width, display.height, display.dpi) +
              encodeInstruction('audio', 'audio/L16') +
              encodeInstruction('video') +
              encodeInstruction('image', 'image/png', 'image/jpeg', 'image/webp') +
              (config.timezone ? encodeInstruction('timezone', config.timezone) : '') +
              encodeInstruction('connect', ...values),
          );
          stage = 'ready';
        } else if (stage === 'ready' && opcode === 'ready') {
          clearTimeout(timer);
          socket.removeListener('data', onData);
          socket.removeAllListeners('error');
          socket.removeAllListeners('close');
          // Everything after "ready" belongs to the session: hand it over untouched.
          const rest = parsed.instructions
            .slice(i + 1)
            .map((ins) => encodeInstruction(...ins))
            .join('');
          return resolve({ socket, decoder, parser, connectionId: args[0], pending: rest });
        }
      }
    }

    socket.on('data', onData);
  });
}

/**
 * @param orbit optional Orbit host: { api(req,res,url), pty: { cwd } }. When present the same port
 *   also serves Orbit's authenticated API (/orbit/api/*) and terminal WebSocket (/orbit/pty).
 */
export function createGateway(config, log = console, orbit = null) {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    const url = new URL(req.url, 'http://gateway.local');
    if (orbit && url.pathname.startsWith('/orbit/api')) return orbit.api(req, res, url);
    res.writeHead(404);
    res.end();
  });

  const orbitWss = orbit ? new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 }) : null;

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('guacamole') ? 'guacamole' : false),
    maxPayload: 4 * 1024 * 1024,
  });

  server.on('upgrade', async (req, socket, head) => {
    const reject = (code, msg) => {
      log.warn?.(`[gateway] rejected upgrade: ${msg}`);
      socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };

    const origin = req.headers.origin || '';
    if (config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
      return reject(403, 'Forbidden');
    }

    const url = new URL(req.url, 'http://gateway.local');
    if (orbit && url.pathname === '/orbit/pty') {
      // Auth happens on the first message (browsers can't set headers on WebSockets).
      return orbitWss.handleUpgrade(req, socket, head, (ws) =>
        handlePtySocket(ws, url, { secret: config.secret, cwd: orbit.pty.cwd, log }),
      );
    }
    const token = url.searchParams.get('token');
    if (!token) return reject(401, 'Unauthorized');

    let payload;
    try {
      ({ payload } = await jwtVerify(token, config.secret, {
        algorithms: ['HS256'],
        audience: 'rdp-gateway',
        issuer: 'rdp-web',
      }));
    } catch {
      return reject(401, 'Unauthorized');
    }
    if (!payload.jti || !markTokenUsed(payload.jti, payload.exp)) {
      return reject(401, 'Unauthorized');
    }

    const display = {
      width: clampInt(url.searchParams.get('width'), 320, 7680, 1280),
      height: clampInt(url.searchParams.get('height'), 240, 4320, 720),
      dpi: clampInt(url.searchParams.get('dpi'), 48, 384, 96),
    };

    wss.handleUpgrade(req, socket, head, (ws) => handleSession(ws, display, payload.sub));
  });

  async function handleSession(ws, display, user) {
    const sessionId = crypto.randomUUID();
    log.info?.(`[gateway] session ${sessionId} opened for ${user} (${display.width}x${display.height})`);

    // Buffer browser messages that arrive while the RDP session is still starting.
    const early = [];
    ws.on('message', (data) => early.push(data.toString()));

    let guac;
    try {
      guac = await connectToGuacd(config, display);
    } catch (err) {
      log.error?.(`[gateway] session ${sessionId}: ${err.message}`);
      if (ws.readyState === ws.OPEN) {
        // 519 = UPSTREAM_NOT_FOUND / 512 = SERVER_ERROR in the Guacamole status scheme.
        const code = /ECONNREFUSED|ENOTFOUND|timed out/.test(err.message) ? '519' : '512';
        ws.send(encodeInstruction('error', 'Could not reach your PC', code));
        ws.close(1011, code);
      }
      return;
    }

    const { socket, decoder, parser } = guac;
    if (ws.readyState !== ws.OPEN) {
      socket.destroy();
      return;
    }

    // Tell the browser the tunnel is open (internal opcode "" carries the tunnel UUID).
    ws.send(encodeInstruction('', guac.connectionId) + guac.pending);

    const toGuacd = (text) => {
      // Internal tunnel instructions (opcode "") are for us, not guacd. Answer pings.
      if (text.startsWith('0.,')) {
        if (text.startsWith('0.,4.ping,')) ws.send(text);
        return;
      }
      socket.write(text);
    };

    ws.removeAllListeners('message');
    early.forEach(toGuacd);
    ws.on('message', (data) => toGuacd(data.toString()));

    socket.on('data', (chunk) => {
      let parsed;
      try {
        parsed = parser.push(decoder.write(chunk));
      } catch (err) {
        log.error?.(`[gateway] session ${sessionId}: ${err.message}`);
        return ws.close(1011, '512');
      }
      if (parsed.raw && ws.readyState === ws.OPEN) ws.send(parsed.raw);
    });

    const cleanup = (why) => {
      if (socket.destroyed && ws.readyState >= ws.CLOSING) return;
      log.info?.(`[gateway] session ${sessionId} closed (${why})`);
      socket.destroy();
      if (ws.readyState === ws.OPEN) ws.close(1000);
    };
    socket.on('close', () => cleanup('guacd closed'));
    socket.on('error', (err) => cleanup(err.message));
    ws.on('close', () => cleanup('browser closed'));
    ws.on('error', (err) => cleanup(err.message));
  }

  return server;
}
