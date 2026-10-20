// The AI machine's front door (port 8080, the only port Runpod exposes).
//
//   browser --https--> gate :8080 --> Open WebUI 127.0.0.1:8081   (needs the gate's sign-in cookie)
//   Orbit / coding agent --> gate /v1/* --> Ollama 127.0.0.1:11434/v1   (needs a bearer token)
//
// Sign-in: the web app sends the browser to /_orbit/login?token=<1-use, 2-minute token>. The gate
// sets its own HttpOnly cookie and from then on tells Open WebUI who the user is with a trusted
// header (which it always strips from incoming requests, so nobody can forge it).
import crypto from 'node:crypto';
import fs from 'node:fs';
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

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('The request is too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('The request is too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
 *   activity()              called when someone asks for real work (a chat answer, a picture, a download);
 *                           open pages, polling and live connections never count, so a forgotten tab can't
 *                           keep the machine on
 *   idleState()             numbers for the unauthenticated /_orbit/idle (the site's watchdog reads it)
 *   status()                async () => object for /_orbit/status
 *   studio                  image/video maker (studio.js), optional
 *   lab                     meme lab (memes.js), optional
 *   studioKey               key Open WebUI uses for the studio from inside the machine (loopback only)
 *   r2test                  R2 speed test (r2.js createR2Test), optional
 */
// Open WebUI requests that ask a model for something (chat, images, speech, title/tag tasks).
const WEBUI_WORK = /\/(chat\/completions|api\/chat|api\/generate|images|audio|tasks)(\/|$)/;

export function createGate(cfg, log = console) {
  const secret = cfg.secret;
  // The cookie is signed with a key derived from the shared secret, so a cookie can't be used as a token.
  const cookieKey = crypto.createHmac('sha256', secret).update('orbit-ai-cookie').digest();
  const allowed = originMatcher(cfg.allowedOrigins);
  const usedJti = new Map();
  let islandJs = null; // { body, at }
  const emailHeader = (cfg.trustedEmailHeader || 'X-Orbit-Email').toLowerCase();
  const nameHeader = (cfg.trustedNameHeader || 'X-Orbit-Name').toLowerCase();
  const webui = new URL(cfg.webui);
  const ollama = new URL(cfg.ollama);
  const activity = cfg.activity || (() => {});
  const studio = cfg.studio || null;
  const movies = cfg.movies || null;
  const r2test = cfg.r2test || null;
  const studioKey = cfg.studioKey ? Buffer.from(cfg.studioKey) : null;

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

  // Open WebUI (same machine) calling the studio with the per-boot key.
  const internal = (req) => {
    const key = req.headers['x-studio-key'] || bearer(req);
    if (!studioKey || !key) return false;
    const given = Buffer.from(String(key));
    const addr = req.socket.remoteAddress || '';
    const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
    return loopback && given.length === studioKey.length && crypto.timingSafeEqual(given, studioKey);
  };
  // Links to results for <img>/<video> tags, which can't send a bearer token.
  const fileToken = (id) => signJwt({ sub: id, aud: 'orbit-ai-file' }, secret, { expiresIn: 12 * 3600 });
  const fileTokenOk = (token, id) => {
    try {
      return verifyJwt(token, secret, { audience: 'orbit-ai-file' }).sub === id;
    } catch {
      return false;
    }
  };

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (!allowed(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

  /** The status pill (money, timers, machine stats) added to the playground's pages. */
  function islandSnippet(user) {
    const token = signJwt({ sub: user.sub, aud: 'site-island' }, secret, { expiresIn: 12 * 3600 });
    const site = cfg.siteUrl;
    const attr = (v) => String(v).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
    return `<script type="module" src="/_orbit/island.js"></script><orbit-island api="${attr(site)}/api/status" token="${attr(token)}" place="playground" site="${attr(site)}"></orbit-island>`;
  }

  function proxy(req, res, target, path, user, inject = null) {
    const headers0 = upstreamHeaders(req, user);
    // Pages we add the pill to are read whole, so ask for them uncompressed.
    if (inject) headers0['accept-encoding'] = 'identity';
    const up = http.request(
      { host: target.hostname, port: target.port, method: req.method, path, headers: headers0 },
      (upRes) => {
        const headers = { ...upRes.headers };
        for (const k of Object.keys(headers)) if (HOP.has(k)) delete headers[k];
        const html = /text\/html/.test(String(headers['content-type'] || ''));
        if (inject && html && upRes.statusCode === 200 && !headers['content-encoding']) {
          const chunks = [];
          upRes.on('data', (c) => chunks.push(c));
          upRes.on('end', () => {
            let body = Buffer.concat(chunks).toString('utf8');
            body = body.includes('</body>') ? body.replace(/<\/body>(?![\s\S]*<\/body>)/, `${inject}</body>`) : body + inject;
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
    // How long since the last real job: read by the site's watchdog, which turns off machines whose own
    // idle timer has failed. Only numbers, no names or content, so it needs no sign-in.
    if (path === '/_orbit/idle' && req.method === 'GET' && cfg.idleState) return send(res, 200, cfg.idleState());

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

    // ---- the status pill's script, served from this address so the playground's security rules allow it
    if (path === '/_orbit/island.js' && cfg.siteUrl) {
      if (!session(req)) return send(res, 401, 'Sign in first', 'text/plain');
      try {
        if (!islandJs || Date.now() - islandJs.at > 10 * 60_000) {
          const r = await (cfg.fetchImpl || fetch)(`${cfg.siteUrl}/orbit/island.js`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) throw new Error(`site answered ${r.status}`);
          islandJs = { body: await r.text(), at: Date.now() };
        }
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=300' });
        return res.end(islandJs.body);
      } catch (err) {
        return send(res, 502, err.message, 'text/plain');
      }
    }

    // ---- live stats for the status panel (reading them doesn't count as using the machine)
    if (path === '/_orbit/stats' || path === '/_orbit/keepawake') {
      if (!cors(req, res)) return send(res, 403, { error: 'Origin not allowed' });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!apiToken(req) && !session(req)) return send(res, 401, { error: 'Unauthorized' });
      try {
        if (path === '/_orbit/stats' && req.method === 'GET' && cfg.stats) return send(res, 200, await cfg.stats());
        if (path === '/_orbit/keepawake' && req.method === 'POST' && cfg.keepAwake) {
          const { minutes } = JSON.parse((await readBody(req, 4096)) || '{}');
          activity();
          return send(res, 200, { offAt: new Date(cfg.keepAwake(Number(minutes) || 30)).toISOString() });
        }
        return send(res, 404, { error: 'Not found' });
      } catch (err) {
        return send(res, 500, { error: err.message });
      }
    }

    // ---- notifications: a browser signs up for the "turning off soon" notice (or stops)
    if (path === '/_orbit/push' && cfg.push) {
      if (!cors(req, res)) return send(res, 403, { error: 'Origin not allowed' });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!apiToken(req) && !session(req)) return send(res, 401, { error: 'Unauthorized' });
      try {
        if (req.method === 'GET') return send(res, 200, { publicKey: cfg.push.publicKey, devices: await cfg.push.count() });
        const { subscription, endpoint } = JSON.parse((await readBody(req, 8192)) || '{}');
        if (req.method === 'POST') return send(res, 200, { devices: await cfg.push.add(subscription) });
        if (req.method === 'DELETE') {
          await cfg.push.remove(String(endpoint || subscription?.endpoint || ''));
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'Method not allowed' });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }

    // ---- web search and speech to text for Orbit's chat
    if ((cfg.search && path === '/_orbit/search') || (cfg.voice && path === '/_orbit/voice/transcribe')) {
      if (!cors(req, res)) return send(res, 403, { error: 'Origin not allowed' });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!apiToken(req) && !session(req)) return send(res, 401, { error: 'Unauthorized' });
      activity();
      try {
        if (path === '/_orbit/search' && req.method === 'GET') {
          const pages = Number(url.searchParams.get('pages') ?? 3);
          return send(res, 200, await cfg.search.search(url.searchParams.get('q') || '', { pages: Number.isFinite(pages) ? pages : 3 }));
        }
        if (path === '/_orbit/voice/transcribe' && req.method === 'POST') {
          const audio = await readRaw(req, 25 * 1024 * 1024);
          if (!audio.length) return send(res, 400, { error: 'No audio.' });
          return send(res, 200, await cfg.voice.transcribe(audio, req.headers['content-type'] || ''));
        }
        return send(res, 404, { error: 'Not found' });
      } catch (err) {
        return send(res, err.status && err.status < 600 ? err.status : 500, { error: err.message });
      }
    }

    // ---- model store (chat models)
    if (cfg.store && (path === '/_orbit/models' || path.startsWith('/_orbit/models/'))) {
      if (!cors(req, res)) return send(res, 403, { error: 'Origin not allowed' });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!apiToken(req) && !session(req)) return send(res, 401, { error: 'Unauthorized' });
      if (req.method !== 'GET') activity();
      return handleStore(req, res, url, path);
    }

    // ---- image and video maker
    if (studio && (path === '/v1/images/generations' || path === '/_orbit/studio' || path.startsWith('/_orbit/studio/'))) {
      if (!cors(req, res)) return send(res, 403, { error: 'Origin not allowed' });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      return handleStudio(req, res, url, path);
    }

    // ---- OpenAI-compatible API (Ollama) for Orbit's chat and the coding agent
    if (path === '/v1' || path.startsWith('/v1/')) {
      if (!cors(req, res)) return send(res, 403, { error: { message: 'Origin not allowed' } });
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (!apiToken(req)) return send(res, 401, { error: { message: 'Unauthorized' } });
      if (req.method === 'POST') activity();
      // Ollama doesn't need the token, and refuses browser origins it doesn't know: the origin was
      // checked above, so it isn't passed on.
      delete req.headers.authorization;
      delete req.headers.origin;
      delete req.headers.referer;
      if (req.method === 'POST' && path === '/v1/chat/completions') return streamChat(req, res);
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
    if (req.method === 'POST' && WEBUI_WORK.test(url.pathname)) activity();
    const page = req.method === 'GET' && /text\/html/.test(req.headers.accept || '') && cfg.siteUrl;
    return proxy(req, res, webui, req.url, user, page ? islandSnippet(user) : null);
  });

  async function handleStore(req, res, url, path) {
    const store = cfg.store;
    try {
      if (path === '/_orbit/models' && req.method === 'GET') return send(res, 200, await store.list());
      if (path === '/_orbit/models/featured' && req.method === 'GET') return send(res, 200, { models: await store.featured() });
      if (path === '/_orbit/models/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        return send(res, 200, { results: q ? await store.search(q) : [] });
      }
      if (path === '/_orbit/models/files' && req.method === 'GET') return send(res, 200, { files: await store.files(url.searchParams.get('repo') || '') });
      if (req.method === 'POST' && ['/_orbit/models/install', '/_orbit/models/load', '/_orbit/models/dismiss', '/_orbit/models/unload'].includes(path)) {
        const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
        if (path.endsWith('/install')) return send(res, 202, { name: store.install(body) });
        if (path.endsWith('/dismiss')) return send(res, 200, { ok: store.dismiss(String(body.name || '')) });
        if (path.endsWith('/unload')) {
          await store.unload(String(body.name || ''));
          return send(res, 200, { ok: true });
        }
        await studio?.yieldGpu?.().catch(() => {});
        await store.load(String(body.name || ''));
        return send(res, 200, { ok: true });
      }
      const del = /^\/_orbit\/models\/(.+)$/.exec(path);
      if (del && req.method === 'DELETE') {
        await store.remove(decodeURIComponent(del[1]));
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      return send(res, err.status && err.status < 600 ? err.status : 500, { error: err.message });
    }
  }

  // A chat reply. Loading a big model from storage can take longer than Runpod's proxy waits for
  // a silent connection (100 s), so streamed replies start right away and send SSE comments until
  // the model answers; errors then arrive as an SSE error event.
  async function streamChat(req, res) {
    let raw;
    try {
      raw = await readBody(req, 20 * 1024 * 1024);
    } catch (err) {
      return send(res, err.status || 400, { error: { message: err.message } });
    }
    let streaming = false;
    try {
      streaming = JSON.parse(raw || '{}').stream === true;
    } catch {
      /* Ollama will say what's wrong */
    }
    await studio?.yieldGpu?.().catch(() => {});
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) };
    if (!streaming) {
      const up = http.request({ host: ollama.hostname, port: ollama.port, method: 'POST', path: req.url, headers }, (upRes) => {
        res.writeHead(upRes.statusCode || 502, { 'content-type': upRes.headers['content-type'] || 'application/json' });
        upRes.pipe(res);
      });
      up.on('error', () => (!res.headersSent ? send(res, 502, { error: { message: 'The AI service is still starting. Try again in a moment.' } }) : res.destroy()));
      res.on('close', () => up.destroy());
      return up.end(raw);
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    res.write(': loading\n\n');
    const ping = setInterval(() => res.write(': loading\n\n'), 10_000);
    const fail = (message) => {
      clearInterval(ping);
      res.end(`data: ${JSON.stringify({ error: { message } })}\n\n`);
    };
    const up = http.request({ host: ollama.hostname, port: ollama.port, method: 'POST', path: req.url, headers }, (upRes) => {
      clearInterval(ping);
      if ((upRes.statusCode || 500) >= 400) {
        let body = '';
        upRes.on('data', (c) => (body += c));
        upRes.on('end', () => {
          let message = body.slice(0, 500) || `The model answered ${upRes.statusCode}.`;
          try {
            message = JSON.parse(body).error?.message || message;
          } catch {
            /* plain text */
          }
          fail(message);
        });
        return;
      }
      upRes.pipe(res);
    });
    up.on('error', () => fail('The AI service is still starting. Try again in a moment.'));
    res.on('close', () => {
      clearInterval(ping);
      up.destroy();
    });
    up.end(raw);
  }

  async function handleStudio(req, res, url, path) {
    const fileMatch = /^\/_orbit\/studio\/file\/([A-Za-z0-9_-]+)$/.exec(path);
    const viaApi = Boolean(apiToken(req));
    const signedIn = viaApi || Boolean(session(req)) || internal(req);
    if (fileMatch && req.method === 'GET') {
      if (!signedIn && !fileTokenOk(url.searchParams.get('t'), fileMatch[1])) return send(res, 401, { error: 'Unauthorized' });
      return sendFile(req, res, await studio.file(fileMatch[1]), url.searchParams.has('download'));
    }
    if (!signedIn) return send(res, 401, { error: { message: 'Unauthorized' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') activity();
    // Results carry a link; API callers (Orbit) get one that works in <img>/<video> tags.
    const withUrl = (it) => (it ? { ...it, url: `/_orbit/studio/file/${it.id}${viaApi ? `?t=${fileToken(it.id)}` : ''}` } : it);
    const withJobUrl = (j) => (j ? { ...j, item: withUrl(j.item) } : j);
    try {
      if (path === '/v1/images/generations' && req.method === 'POST') return await openaiImage(req, res);
      if (path === '/_orbit/studio' && req.method === 'GET') return send(res, 200, await studio.state());
      if (path === '/_orbit/studio/items' && req.method === 'GET') return send(res, 200, { items: (await studio.items()).map(withUrl) });
      if (path === '/_orbit/studio/makers' && req.method === 'GET') return send(res, 200, { makers: await studio.makers() });
      if ((path === '/_orbit/studio/makers/install' || path === '/_orbit/studio/makers/remove') && req.method === 'POST') {
        const { id } = JSON.parse((await readBody(req, 4096)) || '{}');
        const list = path.endsWith('/install') ? await studio.installMaker(String(id || '')) : await studio.removeMaker(String(id || ''));
        return send(res, 200, { makers: list });
      }
      if (path === '/_orbit/studio/jobs' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 30 * 1024 * 1024)) || '{}');
        delete body.background; // only the meme lab makes background jobs
        return send(res, 200, withJobUrl(await studio.createJob(body)));
      }
      const jobMatch = /^\/_orbit\/studio\/jobs\/([A-Za-z0-9_-]+)(\/cancel)?$/.exec(path);
      if (jobMatch && req.method === 'GET' && !jobMatch[2]) {
        const j = studio.job(jobMatch[1]);
        return j ? send(res, 200, withJobUrl(j)) : send(res, 404, { error: 'No such job' });
      }
      if (jobMatch && req.method === 'POST' && jobMatch[2]) {
        const j = await studio.cancel(jobMatch[1]);
        return j ? send(res, 200, withJobUrl(j)) : send(res, 404, { error: 'No such job' });
      }
      if (movies && path.startsWith('/_orbit/studio/movies')) return await handleMovies(req, res, path, withUrl);
      // Meme lab: GET its videos and scores; POST { enabled } turns it on or off;
      // POST /lab/<id>/keep moves a video into the gallery; DELETE /lab/<id> throws it away.
      if (path === '/_orbit/studio/lab' || path.startsWith('/_orbit/studio/lab/')) {
        if (!cfg.lab) return send(res, 404, { error: 'The meme lab runs on the main AI machine only.' });
        const labState = async () => {
          const s = await cfg.lab.state();
          return { ...s, making: s.making ? { ...s.making, job: withJobUrl(s.making.job) } : null, records: s.records.map((r) => ({ ...r, url: withUrl({ id: r.id }).url })) };
        };
        if (path === '/_orbit/studio/lab' && req.method === 'GET') return send(res, 200, await labState());
        if (path === '/_orbit/studio/lab' && req.method === 'POST') {
          const { enabled, topics } = JSON.parse((await readBody(req, 16_384)) || '{}');
          await cfg.lab.configure({ enabled: typeof enabled === 'boolean' ? enabled : undefined, topics: Array.isArray(topics) ? topics : undefined });
          return send(res, 200, await labState());
        }
        // The queue: POST /lab/cancel stops the video being made; POST /lab/queue { title, prompt } adds
        // your idea (made next); POST /lab/queue/<id> edits one, /lab/queue/<id>/next moves it up front;
        // DELETE /lab/queue/<id> removes it.
        if (path === '/_orbit/studio/lab/cancel' && req.method === 'POST') {
          await cfg.lab.cancelCurrent();
          return send(res, 200, await labState());
        }
        if (path === '/_orbit/studio/lab/queue' && req.method === 'POST') {
          const idea = JSON.parse((await readBody(req, 16_384)) || '{}');
          if (!(await cfg.lab.addIdea(idea))) return send(res, 400, { error: 'Write what the video should show.' });
          return send(res, 200, await labState());
        }
        const queueMatch = /^\/_orbit\/studio\/lab\/queue\/([A-Za-z0-9_-]+)(\/next)?$/.exec(path);
        if (queueMatch) {
          const [, qid, next] = queueMatch;
          let ok = false;
          if (req.method === 'DELETE' && !next) ok = await cfg.lab.removeIdea(qid);
          else if (req.method === 'POST' && next) ok = await cfg.lab.makeNext(qid);
          else if (req.method === 'POST') ok = await cfg.lab.editIdea(qid, JSON.parse((await readBody(req, 16_384)) || '{}'));
          else return send(res, 405, { error: 'Not allowed' });
          return send(res, ok ? 200 : 404, await labState());
        }
        const labMatch = /^\/_orbit\/studio\/lab\/([A-Za-z0-9_-]+)(\/keep)?$/.exec(path);
        if (labMatch && req.method === 'POST' && labMatch[2]) return send(res, (await cfg.lab.keep(labMatch[1])) ? 200 : 404, await labState());
        if (labMatch && req.method === 'DELETE' && !labMatch[2]) return send(res, (await cfg.lab.remove(labMatch[1])) ? 200 : 404, await labState());
        return send(res, 404, { error: 'Not found' });
      }
      // R2 speed test: GET shows the last run, POST starts one ({ chunkMiB, concurrency, reupload }).
      if (path === '/_orbit/studio/r2test') {
        if (!r2test) return send(res, 404, { error: 'R2 is not set up on this machine.' });
        if (req.method === 'POST') {
          const o = JSON.parse((await readBody(req, 4096)) || '{}');
          const opts = { chunkMiB: Math.min(256, Math.max(8, Number(o.chunkMiB) || 64)), concurrency: Math.min(32, Math.max(1, Number(o.concurrency) || 8)), reupload: Boolean(o.reupload) };
          return send(res, r2test.start(opts) ? 202 : 409, r2test.state());
        }
        return send(res, 200, r2test.state());
      }
      const itemMatch = /^\/_orbit\/studio\/items\/([A-Za-z0-9_-]+)$/.exec(path);
      if (itemMatch && req.method === 'DELETE') return send(res, (await studio.remove(itemMatch[1])) ? 200 : 404, { ok: true });
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      const code = err.status || (err instanceof SyntaxError ? 400 : 500);
      return send(res, code, { error: err.message, blocked: Boolean(err.blocked) });
    }
  }

  // soReal movies: a plan of shots on this machine, made one after another from each last frame.
  async function handleMovies(req, res, path, withUrl) {
    const body = async () => JSON.parse((await readBody(req, 256 * 1024)) || '{}');
    if (path === '/_orbit/studio/movies' && req.method === 'GET') return send(res, 200, { movies: await movies.list() });
    if (path === '/_orbit/studio/movies' && req.method === 'POST') return send(res, 200, await movies.create(await body()));
    // How long a movie like this takes, before it is made: { length, size, maker, lead }.
    if (path === '/_orbit/studio/movies/estimate' && req.method === 'POST') return send(res, 200, movies.estimate(await body()));
    const m = /^\/_orbit\/studio\/movies\/([A-Za-z0-9_-]+)(?:\/(run|stop|render|plan|lead))?$/.exec(path);
    if (!m) return send(res, 404, { error: 'Not found' });
    const [, id, action] = m;
    // The AI writes (or rewrites) the story: the shots, the storyboard, the lead, look and sound.
    if (action === 'plan' && req.method === 'POST') return send(res, 200, await movies.plan(id));
    // A photo of the lead ({ photo: data URL }): becomes the lead's reference picture.
    if (action === 'lead' && req.method === 'POST') {
      const { photo } = JSON.parse((await readBody(req, 30 * 1024 * 1024)) || '{}');
      return send(res, 200, await movies.leadPhoto(id, photo));
    }
    if (!action && req.method === 'GET') {
      const movie = await movies.get(id);
      return movie ? send(res, 200, movie) : send(res, 404, { error: 'No such movie.' });
    }
    if (!action && req.method === 'PUT') return send(res, 200, await movies.update(id, await body()));
    if (!action && req.method === 'DELETE') return send(res, 200, { ok: await movies.remove(id) });
    // { approve: true }: the storyboard looks right, make the shots.
    if (action === 'run' && req.method === 'POST') return send(res, 200, await movies.run(id, await body()));
    if (action === 'stop' && req.method === 'POST') {
      const movie = await movies.stop(id);
      return movie ? send(res, 200, movie) : send(res, 404, { error: 'No such movie.' });
    }
    if (action === 'render' && req.method === 'POST') {
      const out = await movies.render(id);
      return send(res, 200, { movie: out.movie, item: withUrl(out.item) });
    }
    return send(res, 404, { error: 'Not found' });
  }

  // OpenAI-style image endpoint, so Open WebUI's built-in image button uses the image maker.
  async function openaiImage(req, res) {
    let body;
    try {
      body = JSON.parse((await readBody(req, 1024 * 1024)) || '{}');
    } catch {
      return send(res, 400, { error: { message: 'Invalid JSON' } });
    }
    const [w, h] = String(body.size || '').split('x').map(Number);
    const size = w && h ? (w > h * 1.2 ? 'landscape' : h > w * 1.2 ? 'portrait' : 'square') : 'square';
    let job;
    try {
      job = await studio.createJob({ kind: 'image', prompt: body.prompt, size });
    } catch (err) {
      return send(res, err.status || 500, { error: { message: err.message } });
    }
    const deadline = Date.now() + 15 * 60_000;
    while ((job.status === 'queued' || job.status === 'running') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      job = studio.job(job.id) || job;
    }
    if (job.status !== 'done') return send(res, 500, { error: { message: job.error || 'The image took too long.' } });
    const file = await studio.file(job.item?.id ?? job.id);
    if (!file) return send(res, 500, { error: { message: 'The picture went missing.' } });
    const b64 = (await fs.promises.readFile(file.path)).toString('base64');
    return send(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: b64, revised_prompt: job.prompt }] });
  }

  // Send a result file; supports Range requests (iPhone/iPad Safari needs them to play video).
  function sendFile(req, res, file, download) {
    if (!file) return send(res, 404, { error: 'Not found' });
    const headers = {
      'content-type': file.type,
      'accept-ranges': 'bytes',
      // The same file is loaded by <img> (no Origin) and by fetch (with Origin): don't let a cached
      // copy without CORS headers be reused for the other.
      vary: 'Origin',
      'cache-control': 'private, max-age=86400',
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${file.name}"`,
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = file.size - 1;
    if (range) {
      start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
      if (start > end || start >= file.size) {
        res.writeHead(416, { 'content-range': `bytes */${file.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${file.size}`, 'content-length': end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, 'content-length': file.size });
    }
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file.path, { start, end }).pipe(res);
  }

  // WebSockets (Open WebUI's live updates). Same cookie rule; piped as raw bytes once upgraded.
  server.on('upgrade', (req, socket, head) => {
    const user = session(req);
    if (!user) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
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
