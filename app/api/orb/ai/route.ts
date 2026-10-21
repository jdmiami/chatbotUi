import { currentUser } from '@/lib/auth';
import { fromMachine, sameOrigin } from '@/lib/request';
import { ORB_TASKS, attempts, callProvider, cleanMessages, orbAiConfigured, orbAiInfo, retryable, type OrbTask } from '@/lib/orbAi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store' };

/** Is cloud AI set up, which providers (in order; ?prefer= puts one first) and which models each job uses. */
export async function GET(request: Request) {
  if (!(await fromMachine(request)) && !(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const prefer = new URL(request.url).searchParams.get('prefer') ?? undefined;
  return Response.json(orbAiInfo(prefer), { headers: noStore });
}

/**
 * One cloud AI request: { task, messages, tools?, tool_choice?, max_tokens?, temperature?, stream?, model?, prefer? }.
 * Tries each provider's models for the task in order (`prefer` names the provider to try first),
 * moving on to the next model, then the next provider, when one is missing, busy or failing. The
 * reply (or stream) is passed through, with what answered in the x-orb-model and x-orb-provider headers. `model` (one from the lists) pins a
 * single model, for comparing them. The Linux machine may call this too, with its machine token.
 */
export async function POST(request: Request) {
  const machine = await fromMachine(request);
  if (!machine) {
    if (!(await currentUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!orbAiConfigured()) return Response.json({ error: 'Cloud AI is not set up yet (NVIDIA_API_KEY or a backup key in Vercel).' }, { status: 501 });

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input) return Response.json({ error: 'Send JSON.' }, { status: 400 });
  const task = input.task as OrbTask;
  if (!ORB_TASKS.includes(task)) return Response.json({ error: `task must be one of ${ORB_TASKS.join(', ')}` }, { status: 400 });
  const messages = cleanMessages(input.messages);
  if (typeof messages === 'string') return Response.json({ error: messages }, { status: 400 });

  const prefer = typeof input.prefer === 'string' ? input.prefer : undefined;
  const pinned = input.model === undefined ? undefined : String(input.model);
  // A pinned model (comparing models) is looked up in every job's list.
  const tries = pinned ? ORB_TASKS.flatMap((t) => attempts(t, prefer, pinned)).slice(0, 1) : attempts(task, prefer);
  if (pinned && !tries.length) return Response.json({ error: 'unknown model' }, { status: 400 });

  const stream = input.stream === true;
  const body: Record<string, unknown> = {
    messages,
    stream,
    max_tokens: Math.min(Math.max(Number(input.max_tokens) || 1024, 16), 8192),
  };
  // Quick jobs answer straight away: reasoning models otherwise spend the whole budget thinking.
  // `think: true` lets a caller ask for it.
  if (input.think !== true) body.chat_template_kwargs = { enable_thinking: false, thinking: false };
  if (typeof input.temperature === 'number') body.temperature = Math.min(Math.max(input.temperature, 0), 2);
  if (Array.isArray(input.tools) && input.tools.length) {
    body.tools = input.tools.slice(0, 32);
    if (input.tool_choice) body.tool_choice = input.tool_choice;
  }

  // Leave a margin under the 60 s limit for the reply itself.
  const deadline = Date.now() + 50_000;
  let last = '';
  for (const attempt of tries) {
    if (Date.now() > deadline - 5_000 || request.signal.aborted) break;
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    request.signal.addEventListener('abort', stop);
    const timer = setTimeout(stop, deadline - Date.now());
    let res: Response;
    try {
      res = await callProvider(attempt, body, ctrl.signal);
      // A model that doesn't take the no-thinking switch: ask again without it.
      if (res.status === 400 && body.chat_template_kwargs && attempt.provider.noThinking) {
        await res.body?.cancel();
        const { chat_template_kwargs: _drop, ...plain } = body;
        res = await callProvider(attempt, plain, ctrl.signal);
      }
    } catch (err) {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', stop);
      last = (err as Error).name === 'AbortError' ? 'took too long' : 'could not be reached';
      continue;
    }
    if (res.ok && res.body) {
      const headers = { ...noStore, 'x-orb-model': attempt.model, 'x-orb-provider': attempt.provider.id, 'content-type': res.headers.get('content-type') ?? 'application/json' };
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
    // A provider whose key is wrong or out of credit: the next provider may still answer.
    if (res.status === 401 || res.status === 402 || res.status === 403) continue;
    if (!retryable(res.status)) {
      let message = detail;
      try {
        message = JSON.parse(detail).error?.message ?? JSON.parse(detail).detail ?? detail;
      } catch {
        /* plain text */
      }
      return Response.json({ error: `Cloud AI: ${String(message).slice(0, 300) || res.statusText}` }, { status: res.status });
    }
  }
  return Response.json({ error: `Cloud AI is busy right now (${last || 'no model answered'}). Try again in a moment.` }, { status: 503 });
}
