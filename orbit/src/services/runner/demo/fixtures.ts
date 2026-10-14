/**
 * Sample data for the demo runner (demo mode only). Everything here is invented sample content,
 * stored in this browser; nothing came from the real Antigravity CLI.
 */
import type { ModelOption, Project, SessionSummary, TranscriptItem } from '../types';

export const DEMO_RUNNER_KEY = 'orbit:runner:v1';

export const DEMO_RUNNER_LABEL = 'Demo runner — simulated replies, Antigravity CLI not called';

/** Shown next to the model list in demo mode. */
export const DEMO_MODELS_NOTE = 'Sample list; the real list comes from `agy models`';

export const DEMO_MODELS: ModelOption[] = [
  { id: 'sample-pro', label: 'Sample Pro model' },
  { id: 'sample-fast', label: 'Sample Fast model' },
];

export const WORKING_TITLE = 'Working… (simulated)';

export const STOP_NOTICE = 'Stopped. In the real app this ends the agy process (the turn is cancelled, not paused).';

export interface DemoData {
  version: 1;
  projects: Project[];
  sessions: SessionSummary[];
  transcripts: Record<string, TranscriptItem[]>;
}

export const DEMO_PROJECTS: Project[] = [
  { id: 'orbit-demo', name: 'orbit-demo', path: 'Demo project (sample data in this browser)' },
  { id: 'api-service', name: 'api-service', path: 'Demo project (sample data in this browser)' },
  { id: 'dotfiles', name: 'dotfiles', path: 'Demo project (sample data in this browser)' },
];

/** A fenced code block (keeps backticks out of the template literals below). */
export function fence(lang: string, code: string): string {
  return '```' + lang + '\n' + code + '\n```';
}

/** The agy command a turn would run (shown in activity details; the prompt itself is elided). */
export function agyCommand(opts: { conversationId?: string; mode?: string; model?: string }): string {
  const args = ['agy', '--print', '"…"', '--output-format', 'json'];
  if (opts.conversationId) args.push('--conversation', opts.conversationId);
  if (opts.mode && opts.mode !== 'default') args.push('--mode', opts.mode);
  if (opts.model) args.push('--model', opts.model);
  return args.join(' ');
}

export function simulatedDetail(cmd: string): string {
  return `Simulated: no command ran. In the real app this turn runs:\n${cmd}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Fresh copy of the sample sessions, with timestamps relative to `now`. */
export function buildSeed(now: number): DemoData {
  let n = 0;
  const item = <T extends Omit<TranscriptItem, 'id' | 'at'>>(ago: number, rest: T) =>
    ({ id: `demo-itm-${++n}`, at: now - ago, ...rest }) as unknown as TranscriptItem;

  const s1: SessionSummary = {
    id: 'demo-ses-layout',
    projectId: 'orbit-demo',
    title: 'Explain the project layout',
    createdAt: now - 3 * HOUR,
    updatedAt: now - 2 * HOUR,
    status: 'idle',
    mode: 'default',
    conversationId: 'demo-4f2c9a1e',
    messageCount: 4,
    simulated: true,
  };
  const s2: SessionSummary = {
    id: 'demo-ses-health',
    projectId: 'orbit-demo',
    title: 'Plan: add a /health endpoint',
    createdAt: now - DAY - 40 * MIN,
    updatedAt: now - DAY - 30 * MIN,
    status: 'idle',
    mode: 'plan',
    model: 'sample-pro',
    conversationId: 'demo-b81d07c3',
    messageCount: 2,
    simulated: true,
  };
  const s3: SessionSummary = {
    id: 'demo-ses-datetest',
    projectId: 'api-service',
    title: 'Fix the failing date test',
    createdAt: now - 3 * DAY,
    updatedAt: now - 3 * DAY + 2 * MIN,
    status: 'stopped',
    mode: 'accept-edits',
    messageCount: 1,
    simulated: true,
  };
  const s4: SessionSummary = {
    id: 'demo-ses-auth',
    projectId: 'api-service',
    title: 'Explain the auth middleware',
    createdAt: now - 6 * DAY,
    updatedAt: now - 5 * DAY,
    status: 'idle',
    mode: 'default',
    conversationId: 'demo-0c5e2d77',
    messageCount: 2,
    simulated: true,
  };

  const transcripts: Record<string, TranscriptItem[]> = {
    [s1.id]: [
      item(3 * HOUR, { kind: 'user', text: 'Can you explain how this project is laid out?' }),
      item(3 * HOUR - 1000, {
        kind: 'activity',
        title: 'Worked for 4 s (simulated)',
        detail: simulatedDetail(agyCommand({})),
        status: 'done',
      }),
      item(3 * HOUR - 5000, {
        kind: 'assistant',
        text: [
          'Here is how orbit-demo is laid out (sample reply):',
          '',
          '- `README.md` says what the project is.',
          '- `src/app.py` is a tiny Python app with a `Greeting` class and a `main()` function.',
          '- `src/utils.ts` has TypeScript helpers: `slugify` and `clamp`.',
          '- `config/settings.json` holds sample settings.',
          '',
          'Start with `src/app.py`. Running it prints a greeting:',
          '',
          fence('sh', 'python3 src/app.py\n# Hello, Orbit!'),
        ].join('\n'),
      }),
      item(2 * HOUR + 30_000, { kind: 'user', text: 'What does slugify do with spaces?' }),
      item(2 * HOUR + 29_000, {
        kind: 'activity',
        title: 'Worked for 3 s (simulated)',
        detail: simulatedDetail(agyCommand({ conversationId: s1.conversationId })),
        status: 'done',
      }),
      item(2 * HOUR, {
        kind: 'assistant',
        text: [
          '`slugify` lowercases the text, trims it, and replaces every run of characters that are not letters or digits (spaces included) with a single `-`. Dashes at the start and end are removed:',
          '',
          fence('ts', "slugify('  Hello Orbit World ')  // 'hello-orbit-world'\nslugify('Release 2.0 -- notes!')  // 'release-2-0-notes'"),
        ].join('\n'),
      }),
    ],
    [s2.id]: [
      item(DAY + 40 * MIN, {
        kind: 'user',
        text: "Plan how to add a /health endpoint to the app. Don't change anything yet.",
      }),
      item(DAY + 40 * MIN - 1000, {
        kind: 'notice',
        text: 'This session uses Plan mode: the real app passes `--mode plan` to agy.',
        tone: 'info',
      }),
      item(DAY + 40 * MIN - 2000, {
        kind: 'activity',
        title: 'Worked for 7 s (simulated)',
        detail: simulatedDetail(agyCommand({ mode: 'plan', model: 'sample-pro' })),
        status: 'done',
      }),
      item(DAY + 30 * MIN, {
        kind: 'assistant',
        text: [
          'Sample plan (nothing was read or changed):',
          '',
          '1. Add a `health()` function in `src/app.py` that returns `{"status": "ok"}`.',
          '2. Register it at `/health` next to the existing routes.',
          '3. Add a small test that calls it and checks the response.',
          '4. Run the tests.',
          '',
          fence('python', 'def health() -> dict:\n    return {"status": "ok"}'),
          '',
          'Reply "go ahead" to continue this conversation.',
        ].join('\n'),
      }),
    ],
    [s3.id]: [
      item(3 * DAY, { kind: 'user', text: 'The date parsing test fails on CI. Can you find out why and fix it?' }),
      item(3 * DAY - 1000, {
        kind: 'activity',
        title: 'Stopped (simulated)',
        detail: simulatedDetail(agyCommand({ mode: 'accept-edits' })),
        status: 'failed',
      }),
      item(3 * DAY - 2 * MIN, { kind: 'notice', text: STOP_NOTICE, tone: 'warning' }),
    ],
    [s4.id]: [
      item(6 * DAY, { kind: 'user', text: 'Explain what the auth middleware does, step by step.' }),
      item(6 * DAY - 1000, {
        kind: 'activity',
        title: 'Worked for 5 s (simulated)',
        detail: simulatedDetail(agyCommand({})),
        status: 'done',
      }),
      item(5 * DAY, {
        kind: 'assistant',
        text: [
          'Sample explanation (this demo project has no real middleware code):',
          '',
          '1. It reads the `Authorization` header.',
          "2. It checks the token's signature and expiry.",
          '3. It attaches the user to the request, or answers `401`.',
          '',
          fence(
            'js',
            "function auth(req, res, next) {\n  const token = req.headers.authorization?.replace('Bearer ', '');\n  if (!verify(token)) return res.status(401).end();\n  next();\n}",
          ),
        ].join('\n'),
      }),
    ],
  };

  return {
    version: 1,
    projects: DEMO_PROJECTS.map((p) => ({ ...p })),
    sessions: [s1, s2, s3, s4],
    transcripts,
  };
}

/* ------------------------------------------------------------------ canned replies */

const FILE_RE =
  /((?:[\w.-]+\/)*[\w-]+\.(?:py|tsx?|jsx?|mjs|cjs|json|md|css|scss|html|sh|go|rs|rb|java|kt|swift|c|h|cpp|toml|ya?ml|txt|sql|ini|cfg|env))(?![\w])/i;

const SNIPPETS: Record<string, { lang: string; code: string }> = {
  py: { lang: 'python', code: 'def main() -> None:\n    print("Hello, Orbit!")' },
  ts: { lang: 'ts', code: "export function main(): void {\n  console.log('Hello, Orbit!');\n}" },
  js: { lang: 'js', code: "export function main() {\n  console.log('Hello, Orbit!');\n}" },
  json: { lang: 'json', code: '{\n  "name": "orbit-demo",\n  "port": 8000\n}' },
};

function snippetFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'py') return SNIPPETS.py;
  if (ext === 'ts' || ext === 'tsx') return SNIPPETS.ts;
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return SNIPPETS.js;
  if (ext === 'json') return SNIPPETS.json;
  return { lang: 'text', code: `${path}\n(the real file's contents would be discussed here)` };
}

export type ReplyKind = 'file' | 'test' | 'plan' | 'explain' | 'default';

/** Which canned reply a message gets (file path / test / plan / explain / default). */
export function replyKind(text: string): ReplyKind {
  if (FILE_RE.test(text)) return 'file';
  if (/\btest(s|ing|ed)?\b|\bspec\b|\bfail(s|ing|ed)?\b/i.test(text)) return 'test';
  if (/\bplan\b|\bsteps?\b|\bhow (do|would|should|can) (i|we|you)\b/i.test(text)) return 'plan';
  if (/\bexplain|\bwhat (is|does|are)\b|\bwhy\b|\bhow does\b|\bdescribe\b/i.test(text)) return 'explain';
  return 'default';
}

/** Keyword-based canned reply. Always says plainly that nothing real happened. */
export function cannedReply(text: string): string {
  const kind = replyKind(text);
  if (kind === 'file') {
    const path = FILE_RE.exec(text)![1];
    const s = snippetFor(path);
    return [
      `Simulated reply: in demo mode I can't open \`${path}\`, and nothing on a real machine is read or changed.`,
      '',
      'With the real app, this message goes to `agy` in your project on the Linux machine, and the answer is about the actual file. A typical answer includes code like this:',
      '',
      fence(s.lang, s.code),
      '',
      'Ask a follow-up to continue this conversation.',
    ].join('\n');
  }
  if (kind === 'test') {
    return [
      'Simulated reply: no tests were run.',
      '',
      "Here's how I'd track down a failing test:",
      '',
      '1. Run the suite and read the first failure:',
      '',
      fence('sh', 'npm test'),
      '',
      '2. Compare the expected and actual values in that assertion.',
      '3. Fix the code (or the test, if the test is wrong) and run the suite again.',
      '',
      'With the real app, this message is sent to `agy` on your Linux machine.',
    ].join('\n');
  }
  if (kind === 'plan') {
    return [
      'Simulated plan (nothing was read or changed):',
      '',
      '1. Find where the relevant code lives (`src/` in this sample project).',
      '2. Make the smallest change that does what you asked.',
      '3. Add or update a test that covers it.',
      '4. Run the tests and review the diff.',
      '',
      'In the real app, sessions in Plan mode pass `--mode plan` to agy.',
    ].join('\n');
  }
  if (kind === 'explain') {
    return [
      'Simulated explanation of the sample project kept in this browser:',
      '',
      '- `src/app.py` defines a `Greeting` dataclass and a `main()` that prints a greeting.',
      '- `src/utils.ts` has two helpers, `slugify` and `clamp`.',
      '- `config/settings.json` holds sample settings (port `8000`).',
      '',
      fence('python', 'Greeting("Orbit").render()  # \'Hello, Orbit!\''),
      '',
      'With the real app, Antigravity answers about your actual project on the Linux machine.',
    ].join('\n');
  }
  const short = text.replace(/\s+/g, ' ').trim();
  const quoted = short.length > 60 ? `${short.slice(0, 57)}…` : short;
  return [
    `This is a simulated reply. The Antigravity CLI was not called, so nothing happened for "${quoted}".`,
    '',
    'In the real app each message runs `agy --print` on your Linux machine, and follow-ups continue the same conversation with `--conversation <id>`.',
    '',
    'Try asking me to explain the project, plan a change, fix a failing test, or look at a file such as `src/app.py` to see other sample replies.',
  ].join('\n');
}
