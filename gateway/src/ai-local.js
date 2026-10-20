// Local model endpoint for programs on the Linux machine (the coding agent in VS Code, OpenClaw):
//   http://127.0.0.1:8090/v1/...        your AI machine (OpenAI compatible, any API key). It asks the
//                                        web app where the AI machine is (waking it if it's off), then
//                                        forwards with a short-lived token.
//   http://127.0.0.1:8090/cloud/v1/...  cloud AI (NVIDIA's free models) through the web app, which
//                                        holds the key: works with the AI machine off. Models:
//                                        orbit-agent, orbit-fast, orbit-write, orbit-vision.
// Listens on localhost only.
import http from 'node:http';
import https from 'node:https';
import { SignJWT } from 'jose';

const sign = (secret, audience, ttl) =>
  new SignJWT({ scope: 'ai' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('linux-machine')
    .setIssuer('orbit-host')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret);

/** Cloud model names (as programs on this machine ask for them) and the job each one is. */
export const CLOUD_TASKS = { 'orbit-agent': 'agent', 'orbit-fast': 'fast', 'orbit-write': 'write', 'orbit-vision': 'vision' };

const aiError = (res, code, message) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type: 'ai_machine_unavailable' } }));
};

/**
 * @param secret   Uint8Array GATEWAY_SECRET (shared with the web app and the AI machine)
 * @param siteUrl  the web app (asked for the AI machine's address)
 */
export function createLocalAiProxy({ secret, siteUrl, log = console, fetchImpl = fetch }) {
  let cached = null; // { url, at }

  async function endpoint(wake) {
    if (cached && Date.now() - cached.at < 60_000 && !wake) return cached;
    const token = await sign(secret, 'site-machine', '2m');
    const res = await fetchImpl(`${siteUrl}/api/ai/endpoint${wake ? '?wake=1' : ''}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`site ${res.status}`);
    const body = await res.json();
    cached = body.url && body.state === 'on' ? { url: body.url, at: Date.now(), state: body.state } : null;
    return body;
  }

  // Cloud AI: an OpenAI-style chat request becomes one /api/orb/ai call, signed for this machine.
  async function cloud(req, res) {
    if (req.url === '/cloud/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: Object.keys(CLOUD_TASKS).map((id) => ({ id, object: 'model', owned_by: 'orbit' })) }));
    }
    if (req.url !== '/cloud/v1/chat/completions' || req.method !== 'POST') return aiError(res, 404, 'Use /cloud/v1/chat/completions');
    let body;
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return aiError(res, 400, 'Send JSON.');
    }
    const task = CLOUD_TASKS[String(body.model || '').replace(/^.*\//, '')] ?? 'agent';
    let up;
    try {
      up = await fetchImpl(`${siteUrl}/api/orb/ai`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await sign(secret, 'site-machine', '2m')}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          task,
          messages: body.messages,
          tools: body.tools,
          tool_choice: body.tool_choice,
          max_tokens: body.max_tokens ?? body.max_completion_tokens,
          temperature: body.temperature,
          stream: body.stream === true,
          think: body.reasoning_effort ? true : undefined,
        }),
        signal: AbortSignal.timeout(65_000),
      });
    } catch (err) {
      log.warn?.(`[ai-local] cloud: ${err.message}`);
      return aiError(res, 503, 'Could not reach your workspace site for cloud AI.');
    }
    const headers = { 'content-type': up.headers.get('content-type') || 'application/json' };
    if (!up.ok) {
      const text = await up.text().catch(() => '');
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {
        /* plain */
      }
      return aiError(res, up.status, `Cloud AI: ${String(message).slice(0, 300)}`);
    }
    res.writeHead(200, headers);
    if (!up.body) return res.end();
    for await (const chunk of up.body) res.write(chunk);
    res.end();
  }

  return http.createServer(async (req, res) => {
    if (req.url.startsWith('/cloud/')) return cloud(req, res);
    if (!req.url.startsWith('/v1')) return aiError(res, 404, 'Use /v1/... or /cloud/v1/...');
    let ep;
    try {
      ep = await endpoint(false);
      if (!ep.url || ep.state !== 'on') ep = await endpoint(true);
    } catch (err) {
      log.warn?.(`[ai-local] ${err.message}`);
      return aiError(res, 503, 'Could not reach your workspace site to find the AI machine.');
    }
    if (!ep.url || ep.state !== 'on') {
      const why = ep.state === 'downloading' ? 'is downloading its models (first start only)' : 'is starting (about 2–4 minutes)';
      return aiError(res, 503, `Your AI machine ${why}. Try again shortly.`);
    }
    const target = new URL(req.url, ep.url);
    const headers = { ...req.headers, host: target.host, authorization: `Bearer ${await sign(secret, 'orbit-ai', '10m')}` };
    delete headers.connection;
    const up = https.request(target, { method: req.method, headers }, (upRes) => {
      if (upRes.statusCode >= 500) cached = null;
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    });
    up.on('error', (err) => {
      cached = null;
      if (!res.headersSent) aiError(res, 502, `AI machine: ${err.message}`);
      else res.destroy();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
}
