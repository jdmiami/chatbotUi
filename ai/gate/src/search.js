// Web search for Orbit's chat: DuckDuckGo's HTML results (no API key), plus the readable text of
// the top pages so the model can answer from them and cite them. Pages are fetched only from public
// addresses (never this machine or its private network), with short timeouts and a size cap.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (ENTITIES[e.toLowerCase()] != null) return ENTITIES[e.toLowerCase()];
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}
const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Results from DuckDuckGo's HTML page (ads skipped, redirect links unwrapped). */
export function parseResults(html, count = 5) {
  const out = [];
  const blocks = html.split(/<div[^>]+class="(?=[^"]*\bresult\b)/).slice(1);
  for (const b of blocks) {
    if (/result--ad/.test(b.slice(0, 200))) continue;
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    let href = decodeEntities(a[1]);
    const ud = /[?&]uddg=([^&]+)/.exec(href);
    if (ud) href = decodeURIComponent(ud[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    if (!/^https?:\/\//.test(href)) continue;
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(b);
    out.push({ title: stripTags(a[2]), url: href, snippet: sn ? stripTags(sn[1]) : '' });
    if (out.length >= count) break;
  }
  return out;
}

/** The readable text of a page: no scripts, styles, menus or footers. */
export function pageText(html, max = 3000) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = decodeEntities(body.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 40)
    .join('\n');
  return { title: title ? stripTags(title[1]) : '', text: text.slice(0, max) };
}

export function createSearch({ fetchImpl = fetch, lookup = (h) => dns.lookup(h, { all: true }), timeoutMs = 6000 } = {}) {
  async function publicUrl(raw) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    if (u.port && !['80', '443'].includes(u.port)) return null;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host).catch(() => []);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return null;
    return u;
  }

  async function get(raw, maxBytes = 1_500_000) {
    let url = raw;
    for (let hop = 0; hop < 4; hop++) {
      const u = await publicUrl(url);
      if (!u) return null;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetchImpl(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' } });
        if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
          url = new URL(r.headers.get('location'), u).href;
          continue;
        }
        if (!r.ok || !/text\/html|xhtml/.test(r.headers.get('content-type') || '')) return null;
        const reader = r.body.getReader();
        const chunks = [];
        let size = 0;
        while (size < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.length;
        }
        reader.cancel().catch(() => {});
        return Buffer.concat(chunks).toString('utf8');
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    }
    return null;
  }

  /** Search, then read the top `pages` results. */
  async function search(q, { count = 5, pages = 3 } = {}) {
    const query = String(q || '').trim().slice(0, 300);
    if (!query) return { query, results: [] };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs + 2000);
    let html;
    try {
      const r = await fetchImpl('https://html.duckduckgo.com/html/', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        body: new URLSearchParams({ q: query, kl: 'us-en' }).toString(),
      });
      if (!r.ok) throw Object.assign(new Error(`The search engine answered ${r.status}. Try again in a moment.`), { status: 502 });
      html = await r.text();
    } catch (err) {
      if (err.status) throw err;
      throw Object.assign(new Error('The search engine could not be reached.'), { status: 502 });
    } finally {
      clearTimeout(t);
    }
    const results = parseResults(html, Math.min(8, Math.max(1, count)));
    await Promise.all(
      results.slice(0, Math.min(5, Math.max(0, pages))).map(async (res) => {
        const page = await get(res.url);
        if (page) res.text = pageText(page).text;
      }),
    );
    return { query, results };
  }

  return { search, publicUrl };
}
