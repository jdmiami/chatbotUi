/**
 * Batch making (BatchMake.tsx): a small cloud model writes many prompts from one idea, you edit them,
 * and they all go to the AI machine's queue. The parts with no screen in them, tested on their own.
 */
import { NOT_POSSIBLE } from '../../services/ai/CloudAi';

export type BatchKind = 'image' | 'video';
export const BATCH_COUNTS = [4, 8, 12, 20] as const;
export const MAX_BATCH = 50;

/** What the writer is told: N different, concrete prompts as one JSON list, and nothing else. */
export function batchMessages(idea: string, count: number, kind: BatchKind, avoid: string[] = []) {
  const what = kind === 'video' ? 'a video generator (5-second clips)' : 'an image generator';
  const system =
    `You write prompts for ${what}. From the owner's idea, write exactly ${count} different prompts. ` +
    'Each one is a single paragraph of 30 to 70 words with concrete visual detail: who or what, where, the lighting, the shot and lens, and the style. ' +
    (kind === 'video' ? 'Also say what moves and how the camera moves during the clip. ' : '') +
    'Make every prompt clearly different from the others (subject, setting, angle, mood). Everyone in them is an adult. ' +
    `Reply with only a JSON array of ${count} strings: no numbering, no title, no comments.`;
  const user = avoid.length ? `${idea}\n\nAlready written (do not repeat these):\n${avoid.map((p) => `- ${p}`).join('\n')}` : idea;
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

/**
 * The prompts in a reply: a JSON array when there is one (even inside a code block or after some
 * words), else one per line with list marks taken off. Empty and repeated ones dropped, at most `max`.
 * Null when the writer said it can't (NOT_POSSIBLE).
 */
export function parsePrompts(reply: string, max = MAX_BATCH): string[] | null {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (text === NOT_POSSIBLE || text.startsWith(NOT_POSSIBLE)) return null;
  let list: unknown = null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      list = JSON.parse(text.slice(start, end + 1));
    } catch {
      list = null;
    }
  }
  const raw = Array.isArray(list)
    ? list.map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x && 'prompt' in x ? String((x as { prompt: unknown }).prompt) : ''))
    : text
        .split(/\n+/)
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“]|["”],?$/g, ''))
        .filter((l) => !/^```/.test(l));
  const out: string[] = [];
  for (const p of raw) {
    const t = p.replace(/\s+/g, ' ').trim();
    if (t.length >= 8 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, max);
}
