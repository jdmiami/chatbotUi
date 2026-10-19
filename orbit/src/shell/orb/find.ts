import { loadChats } from '../../apps/ai/chats';
import { getFileStore } from '../../services';
import { cloudText } from '../../services/ai/CloudAi';
import { useWorkspace } from '../../state/workspace';
import { useShell, type AppId } from '../../state/shell';

/**
 * "Find across my stuff": chats, files on the Linux machine (or in this browser) and coding sessions.
 * Matching happens here first (fast, nothing leaves the device); cloud AI, when on, only re-ranks the
 * best few by their titles and short snippets. Each hit can be opened, or its text fetched into the
 * box you were typing in ("bring me…").
 */

export interface Hit {
  kind: 'chat' | 'file' | 'session';
  id: string;
  title: string;
  /** Where it matched, a line or two. */
  snippet: string;
  /** The text "bring" puts in a box. */
  text(): Promise<string>;
  open(): void;
  score: number;
}

const STOP = new Set('a an and are about any at be bring can chat chats file files find for from get give had has have i in is it me my of on or show that the this to was we what where which with you your fetch look search'.split(' '));

export function terms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** How well `text` matches: whole words count more, title hits most. */
export function scoreText(ts: string[], title: string, body = ''): number {
  if (!ts.length) return 0;
  const t = title.toLowerCase(), b = body.toLowerCase();
  let score = 0;
  for (const term of ts) {
    const word = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (word.test(t)) score += 6;
    else if (t.includes(term)) score += 3;
    if (word.test(b)) score += 2;
    else if (b.includes(term)) score += 1;
  }
  return score;
}

export function snippetAround(text: string, ts: string[], width = 140): string {
  const lower = text.toLowerCase();
  const at = ts.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 40);
  const s = text.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + s + (start + width < text.length ? '…' : '');
}

function launch(app: AppId) {
  useShell.getState().launch(app);
}

/** Search everything for `query`. */
export async function findStuff(query: string, signal?: AbortSignal): Promise<Hit[]> {
  const ts = terms(query);
  if (!ts.length) return [];
  const hits: Hit[] = [];

  for (const c of loadChats().chats) {
    const body = c.messages.map((m) => m.content).join('\n');
    const score = scoreText(ts, c.title, body);
    if (!score) continue;
    hits.push({
      kind: 'chat',
      id: c.id,
      title: c.title || 'Chat',
      snippet: snippetAround(body, ts),
      score,
      text: async () => {
        // The answer that matched best (or the last answer).
        const answers = c.messages.filter((m) => m.role === 'assistant' && m.content);
        const best = answers.map((m) => ({ m, s: scoreText(ts, '', m.content) })).sort((a, b) => b.s - a.s)[0]?.m ?? answers.at(-1);
        return best?.content ?? '';
      },
      open: () => {
        useWorkspace.getState().sendIntent({ app: 'ai', type: 'open-chat', chatId: c.id });
        launch('ai');
      },
    });
  }

  try {
    const files = getFileStore();
    for (const f of await files.list()) {
      if (signal?.aborted) break;
      const name = f.path.split('/').pop() ?? f.path;
      const score = scoreText(ts, name, f.path);
      if (!score) continue;
      hits.push({
        kind: 'file',
        id: f.path,
        title: name,
        snippet: f.path,
        score,
        text: () => files.read(f.path),
        open: () => {
          useWorkspace.getState().sendIntent({ app: 'editor', type: 'open-file', path: f.path });
          launch('editor');
        },
      });
    }
  } catch {
    /* files not reachable: search the rest */
  }

  for (const s of useWorkspace.getState().recentSessions) {
    const score = scoreText(ts, s.title, s.projectName);
    if (!score) continue;
    hits.push({
      kind: 'session',
      id: s.id,
      title: s.title,
      snippet: `Coding session · ${s.projectName}`,
      score,
      text: async () => s.title,
      open: () => {
        useWorkspace.getState().sendIntent({ app: 'agent', type: 'open-session', sessionId: s.id });
        launch('agent');
      },
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 20);
}

/** Cloud AI puts the best few in order of what the owner most likely meant (titles and snippets only). */
export async function rerank(query: string, hits: Hit[], signal?: AbortSignal): Promise<Hit[]> {
  if (hits.length < 3) return hits;
  const list = hits.slice(0, 12).map((h, i) => `${i + 1}. [${h.kind}] ${h.title} — ${h.snippet.slice(0, 120)}`).join('\n');
  try {
    const raw = await cloudText({
      task: 'fast',
      maxTokens: 40,
      temperature: 0,
      signal,
      messages: [
        { role: 'system', content: 'Pick which items best match what the owner is looking for. Reply with ONLY their numbers, best first, comma separated (at most 5). Reply "none" if nothing fits.' },
        { role: 'user', content: `Looking for: ${query}\n\n${list}` },
      ],
    });
    const order = [...raw.matchAll(/\d+/g)].map((m) => Number(m[0]) - 1).filter((i) => i >= 0 && i < hits.length);
    if (!order.length) return hits;
    const picked = [...new Set(order)].map((i) => hits[i]);
    return [...picked, ...hits.filter((h) => !picked.includes(h))];
  } catch {
    return hits;
  }
}

/** "find …", "where is …", "bring me …", "fetch …", "search my … for …". */
export function findIntent(goal: string): { query: string; bring: boolean } | null {
  const m = goal.trim().match(/^(?:please\s+)?(find|search(?: for| my [\w ]+ for)?|look for|where(?:'s| is| are| did i put)|bring(?: me)?|fetch|get me|paste)\s+(.+?)[?.!]*$/i);
  if (!m) return null;
  const bring = /^(bring|fetch|get me|paste)/i.test(m[1]);
  return { query: m[2].replace(/^(the|my|a)\s+/i, ''), bring };
}
