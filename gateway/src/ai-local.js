// Local model endpoint for programs on the Linux machine (the coding agent in VS Code):
//   http://127.0.0.1:8090/v1/...  (OpenAI compatible, any API key)
// It asks the web app where the AI machine is (waking it if it's off), then forwards the request
// to the AI machine's gate with a short-lived token. Listens on localhost only.
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

  return http.createServer(async (req, res) => {
    if (!req.url.startsWith('/v1')) return aiError(res, 404, 'Use /v1/...');
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
