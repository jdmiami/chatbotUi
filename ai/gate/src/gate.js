// The AI machine's front door (port 8080, the only port Runpod exposes).
//
//   browser --https--> gate :8080 --> Open WebUI 127.0.0.1:8081   (needs the gate's sign-in cookie)
//   Orbit / coding agent --> gate /v1/* --> Ollama 127.0.0.1:11434/v1   (needs a bearer token)
//
// Sign-in: the web app sends the browser to /_orbit/login?token=<1-use, 2-minute token>. The gate
// sets its own HttpOnly cookie and from then on tells Open WebUI who the user is with a trusted
// header (which it always strips from incoming requests, so nobody can forge it).
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { signJwt, verifyJwt } from './jwt.js';

export const COOKIE = '__Host-orbit_ai';
const COOKIE_HOURS = 12;
const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Origins like "https://a.example,https://b-*.example" -> matcher ("*" = one DNS label part). */
export function originMatcher(list) {
  const res = String(list || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') + '$', 'i'));
  return (origin) => Boolean(origin) && res.some((re) => re.test(origin));
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Drop a cookie from a Cookie header (the upstream never needs ours). */
function withoutCookie(header, name) {
  if (!header) return header;
  const kept = header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(name + '='));
  return kept.length ? kept.join('; ') : undefined;
}

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

/**
 * @param {object} cfg
 *   secret (Buffer|string)  shared GATEWAY_SECRET
 *   webui, ollama           upstream base URLs (http://127.0.0.1:port)
 *   allowedOrigins          CORS list for /v1 and /_orbit/status
 *   siteUrl                 where to send people who aren't signed in
 *   userEmail, userName     identity given to Open WebUI
 *   trustedEmailHeader, trustedNameHeader
 *   activity()              called whenever someone uses the AI (keeps the machine on)
 *   status()                async () => object for /_orbit/status
 */
export function createGate(cfg, log = console) {
  const secret = cfg.secret;
  // The cookie is signed with a key derived from the shared secret, so a cookie can't be used as a token.
  const cookieKey = crypto.createHmac('sha256', secret).update('orbit-ai-cookie').digest();
  const allowed = originMatcher(cfg.allowedOrigins);
  const usedJti = new Map();
  const emailHeader = (cfg.trustedEmailHeader || 'X-Orbit-Email').toLowerCase();
  const nameHeader = (cfg.trustedNameHeader || 'X-Orbit-Name').toLowerCase();
  const webui = new URL(cfg.webui);
  const ollama = new URL(cfg.ollama);
  const activity = cfg.activity || (() => {});

  const apiToken = (req) => {
    try {
      return verifyJwt(bearer(req), secret, { audience: 'orbit-ai', maxAgeSec: 65 * 60 });
    } catch {
      return null;
    }
  };
  const session = (req) => {
    try {
      return verifyJwt(readCookie(req, COOKIE), cookieKey, { audience: 'orbit-ai-cookie' });
    } catch {
      return null;
    }
  };

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (!allowed(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  function upstreamHeaders(req, user) {
    const out = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP.has(k) || k === emailHeader || k === nameHeader || k === 'host') continue;
      out[k] = v;
    }
    const cookie = withoutCookie(req.headers.cookie, COOKIE);
    if (cookie) out.cookie = cookie;
    else delete out.cookie;
    out['x-forwarded-proto'] = 'https';
    out['x-forwarded-host'] = req.headers.host || '';
    out['x-forwarded-for'] = req.socket.remoteAddress || '';
    if (user) {
      out[emailHeader] = cfg.userEmail;
      out[nameHeader] = cfg.userName || 'Owner';
    }
    return out;
  }

  function proxy(req, res, target, path, user) {
    const up = http.request(
      { host: target.hostname, port: target.port, method: req.method, path, headers: upstreamHeaders(req, user) },
      (upRes) => {
        const headers = { ...upRes.headers };
        for (const k of Object.keys(headers)) if (HOP.has(k)) delete headers[k];
        res.writeHead(upRes.statusCode || 502, headers);
        upRes.pipe(res);
      },
    );
    up.on('error', (err) => {
      log.warn?.(`[gate] upstream ${target.host}: ${err.message}`);
      if (!res.headersSent) send(res, 502, { error: 'The AI service is still starting. Try again in a moment.' });
      else res.destroy();
    });
    req.on('aborted', () => up.destroy());
    res.on('close', () => up.destroy());
    req.pipe(up);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://gate.local');
    const path = url.pathname;

    if (path === '/healthz') return send(res, 200, 'ok', 'text/plain');

    // ---- sign-in hand-off from the web app
    if (path === '/_orbit/login') {
      let payload;
      try {
        payload = verifyJwt(url.searchParams.get('token'), secret, { audience: 'orbit-ai-login', maxAgeSec: 120 });
      } catch {
        return send(res, 401, signInAgainPage(cfg.siteUrl), 'text/html; charset=utf-8');
      }
      const now = Date.now();
      for (const [id, exp] of usedJti) if (exp < now) usedJti.delete(id);
      if (!payload.jti || usedJti.has(payload.jti)) return send(res, 401, signInAgainPage(cfg.siteUrl), 'text/html; charset=utf-8');
      usedJti.set(payload.jti, payload.exp * 1000);
      const cookie = signJwt({ sub: payload.sub, aud: 'orbit-ai-cookie' }, cookieKey, { expiresIn: COOKIE_HOURS * 3600 });
      const next = url.searchParams.get('next') || '/';
      const safeNext = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
      activity();
      res.writeHead(302, {
        location: safeNext,
        'set-cookie': `${COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_HOURS * 3600}`,
        'cache-control': 'no-store',
      });
      return res.end();
    }
    if (path === '/_orbit/logout') {
      res.writeHead(302, { location: cfg.siteUrl || '/', 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
      return res.end();
    }

    // ---- machine status for the web app / Orbit (bearer token)
    if (path === '/_orbit/status') {
      if (!cors(req, res)) return send(res, 403, { error: 'Origin not allowed' });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!apiToken(req) && !session(req)) return send(res, 401, { error: 'Unauthorized' });
      try {
        return send(res, 200, await cfg.status());
      } catch (err) {
        return send(res, 500, { error: err.message });
      }
    }

    // ---- OpenAI-compatible API (Ollama) for Orbit's chat and the coding agent
    if (path === '/v1' || path.startsWith('/v1/')) {
      if (!cors(req, res)) return send(res, 403, { error: { message: 'Origin not allowed' } });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!apiToken(req)) return send(res, 401, { error: { message: 'Unauthorized' } });
      activity();
      // Ollama doesn't need the token, and refuses browser origins it doesn't know: the origin was
      // checked above, so it isn't passed on.
      delete req.headers.authorization;
      delete req.headers.origin;
      delete req.headers.referer;
      return proxy(req, res, ollama, req.url, null);
    }

    // ---- everything else: Open WebUI, for signed-in browsers
    const user = session(req);
    if (!user) {
      const wantsPage = req.method === 'GET' && /text\/html/.test(req.headers.accept || '');
      if (wantsPage && cfg.siteUrl) {
        res.writeHead(302, { location: `${cfg.siteUrl}/ai?next=${encodeURIComponent(req.url)}`, 'cache-control': 'no-store' });
        return res.end();
      }
      return send(res, 401, { detail: 'Sign in through your workspace site first.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') activity();
    return proxy(req, res, webui, req.url, user);
  });

  // WebSockets (Open WebUI's live updates). Same cookie rule; piped as raw bytes once upgraded.
  server.on('upgrade', (req, socket, head) => {
    const user = session(req);
    if (!user) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    activity();
    const headers = upstreamHeaders(req, user);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade;
    headers.host = `${webui.hostname}:${webui.port}`;
    const up = net.connect(Number(webui.port), webui.hostname, () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) raw += `${k}: ${String(one).replace(/[\r\n]/g, '')}\r\n`;
      }
      up.write(raw + '\r\n');
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const close = () => {
      up.destroy();
      socket.destroy();
    };
    up.on('error', close);
    socket.on('error', close);
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
  });

  return server;
}

function signInAgainPage(siteUrl) {
  const link = siteUrl ? `<a href="${siteUrl}/ai">Open the AI playground from your workspace</a>` : 'Open it again from your workspace site.';
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI playground</title>
<body style="font:16px system-ui;background:#0b0d12;color:#e8eaf0;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:28rem;padding:24px;text-align:center"><h1 style="font-size:20px">That sign-in link has expired</h1>
<p>${link}.</p></main>`;
}
