import { currentUser } from '@/lib/auth';
import { fromMachine, sameOrigin } from '@/lib/request';
import { ORB_TASKS, callNvidia, cleanMessages, orbAiConfigured, orbModels, retryable, type OrbTask } from '@/lib/orbAi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };

/** Is cloud AI set up, and which models each kind of job uses. */
export async function GET(request: Request) {
  if (!(await fromMachine(request)) && !(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ configured: orbAiConfigured(), models: orbModels() }, { headers: noStore });
}

/**
 * One cloud AI request: { task, messages, tools?, tool_choice?, max_tokens?, temperature?, stream?, model? }.
 * Tries the task's models in order until one answers; the reply (or stream) is passed through,
 * with the model that answered in the x-orb-model header. `model` (one from the lists) pins a
 * single model, for comparing them. The Linux machine may call this too, with its machine token.
 */
export async function POST(request: Request) {
  const machine = await fromMachine(request);
  if (!machine) {
    if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!orbAiConfigured()) return Response.json({ error: 'Cloud AI is not set up yet (NVIDIA_API_KEY in Vercel).' }, { status: 501 });

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input) return Response.json({ error: 'Send JSON.' }, { status: 400 });
  const task = input.task as OrbTask;
  if (!ORB_TASKS.includes(task)) return Response.json({ error: `task must be one of ${ORB_TASKS.join(', ')}` }, { status: 400 });
  const messages = cleanMessages(input.messages);
  if (typeof messages === 'string') return Response.json({ error: messages }, { status: 400 });

  const all = orbModels();
  const known = Object.values(all).flat();
  if (input.model !== undefined && !known.includes(String(input.model))) return Response.json({ error: 'unknown model' }, { status: 400 });
  const candidates = input.model ? [String(input.model)] : all[task];

  const stream = input.stream === true;
  const body: Record<string, unknown> = {
    messages,
    stream,
    max_tokens: Math.min(Math.max(Number(input.max_tokens) || 1024, 16), 8192),
  };
  if (typeof input.temperature === 'number') body.temperature = Math.min(Math.max(input.temperature, 0), 2);
  if (Array.isArray(input.tools) && input.tools.length) {
    body.tools = input.tools.slice(0, 32);
    if (input.tool_choice) body.tool_choice = input.tool_choice;
  }

  // Leave a margin under the 60 s limit for the reply itself.
  const deadline = Date.now() + 50_000;
  let last = '';
  for (const model of candidates) {
    if (Date.now() > deadline - 5_000 || request.signal.aborted) break;
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    request.signal.addEventListener('abort', stop);
    const timer = setTimeout(stop, deadline - Date.now());
    let res: Response;
    try {
      res = await callNvidia(model, body, ctrl.signal);
    } catch (err) {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', stop);
      last = (err as Error).name === 'AbortError' ? 'took too long' : 'could not be reached';
      continue;
    }
    if (res.ok && res.body) {
      const headers = { ...noStore, 'x-orb-model': model, 'content-type': res.headers.get('content-type') ?? 'application/json' };
      if (!stream) {
        const text = await res.text().finally(() => clearTimeout(timer));
        request.signal.removeEventListener('abort', stop);
        return new Response(text, { headers });
      }
      // The timer keeps running so a stalled stream is still cut before Vercel's limit.
      return new Response(res.body, { headers });
    }
    clearTimeout(timer);
    request.signal.removeEventListener('abort', stop);
    const detail = await res.text().catch(() => '');
    last = `answered ${res.status}`;
    if (!retryable(res.status)) {
      let message = detail;
      try {
        message = JSON.parse(detail).error?.message ?? JSON.parse(detail).detail ?? detail;
      } catch {
        /* plain text */
      }
      return Response.json({ error: `Cloud AI: ${String(message).slice(0, 300) || res.statusText}` }, { status: res.status === 401 || res.status === 403 ? 502 : res.status });
    }
  }
  return Response.json({ error: `Cloud AI is busy right now (${last || 'no model answered'}). Try again in a moment.` }, { status: 503 });
}
