/** soReal: asking a chat model to plan a movie as a list of shots, and reading its answer. */
import type { ChatMessage, StudioItem } from '../../services/ai/LocalAi';

export function planMessages(idea: string, look: string, count: number, seconds: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You plan short films for an AI video maker. The film is a list of shots; each shot is one continuous clip that starts ' +
        'exactly where the previous shot ended (its first frame is the last frame of the shot before), so there are no cuts. ' +
        `Each shot lasts about ${seconds} seconds: describe one clear action and how the camera moves, in present tense, ` +
        'in one or two sentences. Do not repeat what the characters look like; that is added to every shot. ' +
        'Reply with only a JSON array of strings, one per shot.',
    },
    {
      role: 'user',
      content: `${look.trim() ? `Characters and style: ${look.trim()}\n\n` : ''}The movie: ${idea.trim()}\n\nWrite ${count} shots.`,
    },
  ];
}

/** The shot descriptions in a model's reply: a JSON array, or else a numbered or bulleted list. */
export function parseShots(reply: string): string[] {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '');
  const arr = /\[[\s\S]*\]/.exec(text);
  if (arr) {
    try {
      const v = JSON.parse(arr[0]) as unknown;
      if (Array.isArray(v)) {
        const out = v
          .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String(Object.values(x as object).find((y) => typeof y === 'string') ?? '') : ''))
          .map((x) => x.trim())
          .filter(Boolean);
        if (out.length) return out.slice(0, 60);
      }
    } catch {
      /* not JSON; read it as a list */
    }
  }
  return text
    .split('\n')
    .map((l) => /^\s*(?:\d+[.):]|[-*•]|shot\s*\d+\s*[:.-])\s*(.+)$/i.exec(l)?.[1]?.trim() ?? '')
    .map((l) => l.replace(/^\*\*[^*]+\*\*\s*[:-]?\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 60);
}

/** The newest video in the gallery: what "continue from my latest video" starts from. */
export function latestVideo(items: StudioItem[]): StudioItem | null {
  return items.filter((i) => i.kind === 'video').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
