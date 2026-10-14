// HTTP API for Orbit (mounted at /orbit/api on the gateway). Every route requires a valid
// Orbit token (Authorization: Bearer ...). Responses are JSON; a turn's progress is streamed
// as Server-Sent Events.
import crypto from 'node:crypto';
import os from 'node:os';
import { applyCors, bearer, verifyOrbitToken } from './auth.js';
import { HttpError } from './files.js';
import { killTerminalSession, hasTmux } from './pty.js';
import { AGY_CAPABILITIES } from './agent.js';

const MAX_BODY = 5 * 1024 * 1024;

export function createOrbitApi({ secret, allowedOrigins, files, agent, log }) {
  return async function handle(req, res, url) {
    if (!applyCors(req, res, allowedOrigins)) return json(res, 403, { error: 'Origin not allowed' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    try {
      await verifyOrbitToken(bearer(req), secret);
      const route = url.pathname.replace(/^\/orbit\/api/, '') || '/';
      const m = (re) => route.match(re);
      let match;

      // ---- general
      if (req.method === 'GET' && route === '/info') {
        return json(res, 200, {
          user: os.userInfo().username,
          projectsRoot: files.root,
          tmux: await hasTmux(),
          agy: await agent.info(),
        });
      }

      // ---- files
      if (route === '/files' && req.method === 'GET') {
        const { files: list, truncated } = await files.list();
        // A short fingerprint of the listing lets Code check for changes without downloading it all.
        const fingerprint = crypto
          .createHash('sha1')
          .update(list.map((f) => `${f.path}\0${f.size}\0${f.updatedAt}`).join('\n'))
          .update(String(truncated))
          .digest('hex');
        if (url.searchParams.get('fingerprint') === '1') return json(res, 200, { fingerprint });
        return json(res, 200, { root: rootName(files.root), files: list, truncated, fingerprint });
      }
      if (route === '/files/content') {
        const p = url.searchParams.get('path');
        if (req.method === 'GET') return json(res, 200, await files.read(p));
        if (req.method === 'PUT') {
          return json(res, 200, await files.write(p, await readBody(req), url.searchParams.get('base')));
        }
        if (req.method === 'DELETE') {
          await files.remove(p);
          return json(res, 200, { ok: true });
        }
      }
      if (route === '/files/rename' && req.method === 'POST') {
        const { from, to } = JSON.parse((await readBody(req)) || '{}');
        await files.rename(from, to);
        return json(res, 200, { ok: true });
      }

      // ---- terminal
      if ((match = m(/^\/terminal\/sessions\/([\w-]{1,32})$/)) && req.method === 'DELETE') {
        await killTerminalSession(match[1]);
        return json(res, 200, { ok: true });
      }

      // ---- agent
      if (route === '/agent/capabilities' && req.method === 'GET') return json(res, 200, AGY_CAPABILITIES);
      if (route === '/agent/projects' && req.method === 'GET') return json(res, 200, await agent.listProjects());
      if (route === '/agent/models' && req.method === 'GET') return json(res, 200, await agent.listModels());
      if (route === '/agent/sessions') {
        if (req.method === 'GET') return json(res, 200, agent.listSessions(url.searchParams.get('project')));
        if (req.method === 'POST') return json(res, 201, await agent.createSession(JSON.parse((await readBody(req)) || '{}')));
      }
      if ((match = m(/^\/agent\/sessions\/([\w-]+)$/))) {
        const sid = match[1];
        if (req.method === 'GET') return json(res, 200, agent.getSession(sid));
        if (req.method === 'PATCH') return json(res, 200, await agent.updateSession(sid, JSON.parse((await readBody(req)) || '{}')));
        if (req.method === 'DELETE') {
          await agent.deleteSession(sid);
          return json(res, 200, { ok: true });
        }
      }
      if ((match = m(/^\/agent\/sessions\/([\w-]+)\/transcript$/)) && req.method === 'GET') {
        return json(res, 200, agent.transcript(match[1]));
      }
      if ((match = m(/^\/agent\/sessions\/([\w-]+)\/stop$/)) && req.method === 'POST') {
        return json(res, 200, { stopped: agent.stop(match[1]) });
      }
      if ((match = m(/^\/agent\/sessions\/([\w-]+)\/send$/)) && req.method === 'POST') {
        const { text } = JSON.parse((await readBody(req)) || '{}');
        const sse = openSse(res);
        try {
          await agent.send(match[1], text, sse.emit);
        } catch (err) {
          sse.emit('error', { message: err.message, status: err.status ?? 500 });
          sse.end();
          return;
        }
        sse.endOn('done');
        return;
      }
      if ((match = m(/^\/agent\/sessions\/([\w-]+)\/events$/)) && req.method === 'GET') {
        // Follow a turn started elsewhere (e.g. on the other device).
        const sse = openSse(res);
        const unwatch = agent.watch(match[1], sse.emit);
        if (!unwatch) {
          sse.emit('idle', agent.getSession(match[1]));
          return sse.end();
        }
        sse.endOn('done', unwatch);
        return;
      }

      throw new HttpError(404, 'Not found', 'not-found');
    } catch (err) {
      const status = err.status ?? (err instanceof SyntaxError ? 400 : 500);
      if (status >= 500) log?.error?.(`[orbit] ${req.method} ${url.pathname}: ${err.stack || err.message}`);
      if (!res.headersSent) json(res, status, { error: status >= 500 ? 'Internal error' : err.message, code: err.code });
    }
  };
}

function rootName(root) {
  return root.split('/').filter(Boolean).pop() || 'projects';
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request is too large (5 MB limit).', 'too-large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function openSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  let ended = false;
  let onEnd = null;
  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(ping);
    onEnd?.();
    res.end();
  };
  res.on('close', end);
  let endEvent = null;
  const emit = (event, payload) => {
    if (ended) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    if (event === endEvent) end();
  };
  return {
    emit,
    end,
    endOn(event, cleanup) {
      endEvent = event;
      onEnd = cleanup ?? null;
    },
  };
}
