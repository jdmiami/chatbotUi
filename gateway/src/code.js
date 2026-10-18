// Coding workspace: VS Code in the browser (code-server on 127.0.0.1) served by the gateway at /code/.
//
// Sign-in works like the AI playground: the web app sends the browser to /code/_login?token=<1-use,
// 90-second token>; the gateway sets its own HttpOnly cookie, and only requests with that cookie
// reach code-server (which itself runs with --auth none and listens on localhost only).
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { SignJWT, jwtVerify } from 'jose';

export const CODE_COOKIE = '__Host-orbit_code';
const COOKIE_HOURS = 12;
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function withoutOurCookie(header) {
  if (!header) return undefined;
  const kept = header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(CODE_COOKIE + '='));
  return kept.length ? kept.join('; ') : undefined;
}

/**
 * @param secret   Uint8Array GATEWAY_SECRET
 * @param upstream code-server base URL (http://127.0.0.1:8443)
 * @param siteUrl  the web app, for people who aren't signed in
 */
// Reports that a person is using the editor (at most once a minute), so the machine's idle timer
// sees real typing, clicks and touches rather than the editor's own background traffic.
const INPUT_TAG = '<script src="/code/_input.js"></script>';
const INPUT_JS = `(() => {
  let seen = false, sent = 0;
  const mark = () => { seen = true; if (Date.now() - sent > 60000) flush(); };
  const flush = () => { if (!seen) return; seen = false; sent = Date.now(); fetch('/code/_input', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {}); };
  for (const t of ['keydown', 'pointerdown', 'touchstart', 'wheel']) addEventListener(t, mark, { capture: true, passive: true });
  setInterval(flush, 60000);
})();
`;

export function createCodeProxy({ secret, upstream, siteUrl, log = console, onInput = () => {} }) {
  const cookieKey = crypto.createHmac('sha256', Buffer.from(secret)).update('orbit-code-cookie').digest();
  const target = new URL(upstream);
  const used = new Map();

  async function session(req) {
    try {
      await jwtVerify(readCookie(req, CODE_COOKIE) || '', cookieKey, { algorithms: ['HS256'], audience: 'orbit-code-cookie' });
      return true;
    } catch {
      return false;
    }
  }

  const strip = (url) => url.replace(/^\/code(?=\/|\?|$)/, '') || '/';

  function headersFor(req) {
    const out = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) out[k] = v;
    const cookie = withoutOurCookie(req.headers.cookie);
    if (cookie) out.cookie = cookie;
    else delete out.cookie;
    // code-server compares the Origin with the host it is reached at: keep the public Host.
    out['x-forwarded-proto'] = 'https';
    return out;
  }

  async function handle(req, res, url) {
    if (url.pathname === '/code/_login') {
      let payload;
      try {
        ({ payload } = await jwtVerify(url.searchParams.get('token') || '', secret, {
          algorithms: ['HS256'],
          audience: 'orbit-code-login',
          issuer: 'rdp-web',
          requiredClaims: ['exp', 'iat', 'jti'],
          maxTokenAge: '2m',
        }));
      } catch {
        res.writeHead(302, { location: siteUrl ? `${siteUrl}/code` : '/', 'cache-control': 'no-store' });
        return res.end();
      }
      const now = Date.now();
      for (const [id, exp] of used) if (exp < now) used.delete(id);
      if (used.has(payload.jti)) {
        res.writeHead(302, { location: siteUrl ? `${siteUrl}/code` : '/' });
        return res.end();
      }
      used.set(payload.jti, payload.exp * 1000);
      const cookie = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(payload.sub || 'owner'))
        .setAudience('orbit-code-cookie')
        .setIssuedAt()
        .setExpirationTime(`${COOKIE_HOURS}h`)
        .sign(cookieKey);
      res.writeHead(302, {
        location: '/code/',
        'set-cookie': `${CODE_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_HOURS * 3600}`,
        'cache-control': 'no-store',
      });
      return res.end();
    }
    if (!(await session(req))) {
      if (req.method === 'GET' && /text\/html/.test(req.headers.accept || '') && siteUrl) {
        res.writeHead(302, { location: `${siteUrl}/code`, 'cache-control': 'no-store' });
      } else {
        res.writeHead(401, { 'content-type': 'text/plain' });
      }
      return res.end(req.method === 'GET' ? '' : 'Sign in through your workspace site first.');
    }
    // The status pill's script, served from this address so the editor's security rules allow it.
    if (url.pathname === '/code/_island.js') return serveIsland(res);
    // Typing, clicks and touches in the editor keep the machine on (see INPUT_JS).
    if (url.pathname === '/code/_input.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=300' });
      return res.end(INPUT_JS);
    }
    if (url.pathname === '/code/_input' && req.method === 'POST') {
      onInput();
      res.writeHead(204);
      return res.end();
    }
    // Assets are relative to the page, so the editor must live at /code/ (with the slash).
    if (url.pathname === '/code') {
      res.writeHead(302, { location: '/code/' + url.search });
      return res.end();
    }
    const page = req.method === 'GET' && /text\/html/.test(req.headers.accept || '') && siteUrl;
    const upHeaders = headersFor(req);
    if (page) upHeaders['accept-encoding'] = 'identity';
    const up = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: strip(req.url), headers: upHeaders },
      (upRes) => {
        const headers = { ...upRes.headers };
        for (const k of Object.keys(headers)) if (HOP.has(k)) delete headers[k];
        // code-server redirects within itself ("./login", "/?folder=..."): keep them under /code/.
        if (typeof headers.location === 'string' && headers.location.startsWith('/') && !headers.location.startsWith('//')) {
          headers.location = '/code' + headers.location;
        }
        if (page && upRes.statusCode === 200 && /text\/html/.test(String(headers['content-type'] || '')) && !headers['content-encoding']) {
          const chunks = [];
          upRes.on('data', (c) => chunks.push(c));
          upRes.on('end', async () => {
            const snippet = INPUT_TAG + (await islandSnippet().catch(() => ''));
            let body = Buffer.concat(chunks).toString('utf8');
            body = body.includes('</body>') ? body.replace(/<\/body>(?![\s\S]*<\/body>)/, `${snippet}</body>`) : body + snippet;
            delete headers['content-length'];
            res.writeHead(200, headers);
            res.end(body);
          });
          return;
        }
        res.writeHead(upRes.statusCode || 502, headers);
        upRes.pipe(res);
      },
    );
    up.on('error', (err) => {
      log.warn?.(`[code] ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('VS Code is still starting on the Linux machine. Reload in a moment.');
      } else res.destroy();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  }

  // ---- the status pill (money, timers, machine stats) on the VS Code page
  const attr = (v) => String(v).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  async function islandSnippet() {
    const token = await new SignJWT({ scope: 'island' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('owner')
      .setAudience('site-island')
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(secret);
    return `<script type="module" src="/code/_island.js"></script><orbit-island api="${attr(siteUrl)}/api/status" token="${attr(token)}" place="code" site="${attr(siteUrl)}"></orbit-island>`;
  }
  let islandJs = null; // { body, at }
  async function serveIsland(res) {
    try {
      if (!islandJs || Date.now() - islandJs.at > 10 * 60_000) {
        const r = await fetch(`${siteUrl}/orbit/island.js`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`site answered ${r.status}`);
        islandJs = { body: await r.text(), at: Date.now() };
      }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=300' });
      return res.end(islandJs.body);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      return res.end(err.message);
    }
  }

  /** WebSocket upgrade under /code/. Returns false when the path isn't ours. */
  async function upgrade(req, socket, head) {
    if (!/^\/code(\/|\?|$)/.test(req.url)) return false;
    if (!(await session(req))) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return true;
    }
    const headers = headersFor(req);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade;
    const up = net.connect(Number(target.port), target.hostname, () => {
      let raw = `${req.method} ${strip(req.url)} HTTP/1.1\r\n`;
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
    return true;
  }

  return { handle, upgrade };
}
