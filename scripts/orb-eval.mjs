#!/usr/bin/env node
/**
 * Compares the cloud AI models on real Orbit jobs: the orb planning a step, writing help, quick
 * answers and reading a picture. Calls the live site's /api/orb/ai with one model pinned at a time,
 * so the NVIDIA key never leaves Vercel.
 *
 *   ORB_SITE=https://… ORB_TOKEN_CMD="node mint-machine-token.mjs" node scripts/orb-eval.mjs [task…]
 *
 * ORB_TOKEN_CMD prints a fresh machine token (LINUX_GATEWAY_SECRET, audience "site-machine");
 * it is run before each model because tokens last 3 minutes.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SITE = process.env.ORB_SITE;
const TOKEN_CMD = process.env.ORB_TOKEN_CMD;
if (!SITE || !TOKEN_CMD) {
  console.error('Set ORB_SITE and ORB_TOKEN_CMD.');
  process.exit(1);
}
const only = process.argv.slice(2);
const agentSrc = readFileSync(new URL('../orbit/src/shell/orb/agent.ts', import.meta.url), 'utf8');
const PLANNER_PROMPT = agentSrc.match(/export const PLANNER_PROMPT = `([\s\S]*?)`;/)[1];

const token = () => execSync(TOKEN_CMD, { encoding: 'utf8' }).trim();

function firstJson(text) {
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}' && --depth === 0) {
      try {
        return JSON.parse(body.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// --- Orb planning: a goal, a screen, and what a good first step looks like.
const HOME = `App on screen: home
#1 button: Talk. Chat with your AI
#2 button: Make. Pictures and videos
#3 button: Code. Edit files
#4 button: Terminal. Run commands
#5 button: Settings. Look, orb, machines
#6 button: Model store
#7 button: Makers`;
const AI = `App on screen: ai
#1 tab: Chat
#2 tab: Create
#3 button: New chat
#4 field: Message
#5 button: Send
#6 button: Model store`;
const SETTINGS = `App on screen: settings
#1 button: Connection
#2 button: Appearance
#3 radio: Dark
#4 radio: Light
#5 radio: System
#6 switch: Show the orb
#7 switch: Use cloud AI`;
const CREATE = `App on screen: ai
#1 tab: Chat
#2 tab: Create
#3 radio: Picture
#4 radio: Video
#5 field: Describe it
#6 button: Make`;
const TERMINAL = `App on screen: terminal
#1 button: New tab
#2 field: Command
#3 button: More`;
const plans = [
  ['open the terminal', HOME, (s) => s.do === 'open' && s.app === 'terminal'],
  ['I want to write some code', HOME, (s) => (s.do === 'open' && s.app === 'editor') || (s.do === 'click' && /#?3/.test(s.target))],
  ['make me a picture of a lighthouse', HOME, (s) => (s.do === 'open' && s.app === 'ai') || (s.do === 'click' && /#?2/.test(s.target))],
  ['make me a picture of a lighthouse', CREATE, (s) => s.do === 'type' && /#?5/.test(s.target) && /lighthouse/i.test(s.text)],
  ['ask the AI what the capital of Peru is', AI, (s) => s.do === 'type' && /#?4/.test(s.target) && /peru/i.test(s.text)],
  ['go dark', SETTINGS, (s) => (s.do === 'click' && /#?3/.test(s.target)) || (s.do === 'setting' && s.value === 'dark')],
  ['switch to light mode', HOME, (s) => s.do === 'setting' && s.name === 'theme' && s.value === 'light'],
  ['turn off the orb', SETTINGS, (s) => s.do === 'click' && /#?6/.test(s.target)],
  ['start a new chat', AI, (s) => s.do === 'click' && /#?3/.test(s.target)],
  ['list my files in the terminal', TERMINAL, (s) => s.do === 'type' && /#?2/.test(s.target) && /\bls\b/.test(s.text)],
  ['turn on the AI machine', HOME, (s) => s.do === 'machine' && s.which === 'ai' && s.power === 'on'],
  ['what is 12 times 12?', HOME, (s) => s.do === 'done' && /144/.test(s.say ?? '')],
  ['add a new model', HOME, (s) => s.do === 'click' && /#?6/.test(s.target)],
  ['make a short video of waves', CREATE, (s) => (s.do === 'click' && /#?4/.test(s.target)) || (s.do === 'type' && /wave/i.test(s.text ?? ''))],
  ['book me a flight to Paris', HOME, (s) => s.do === 'done'],
  ['go back to the start', SETTINGS, (s) => s.do === 'home' || s.do === 'back'],
];

// --- Writing help: an instruction, some text, and a check on the result.
const writes = [
  ['Fix the spelling and grammar. Reply with only the fixed text.', 'i has went to the store yesterday and buyed three apple', (t) => /went|go/i.test(t) && /bought/i.test(t) && /apples/i.test(t)],
  ['Make it shorter (under 12 words). Reply with only the new text.', 'I wanted to let you know that I will unfortunately not be able to make it to the meeting that we had planned for tomorrow afternoon.', (t) => t.split(/\s+/).length <= 14 && /meeting|tomorrow/i.test(t)],
  ['Translate to Spanish. Reply with only the translation.', 'Where is the train station?', (t) => /estaci[oó]n/i.test(t) && /tren/i.test(t)],
  ['Translate to French. Reply with only the translation.', 'Thank you very much for your help.', (t) => /merci/i.test(t)],
  ['Make it more friendly. Reply with only the new text.', 'Send the report now.', (t) => /please|thanks|could|would/i.test(t)],
  ['Continue this sentence with a few words. Reply with only the words that come next.', 'The quick brown fox jumps over the', (t) => /lazy|dog/i.test(t)],
  ['Write a subject line for this email. Reply with only the subject.', 'Hi team, the launch moved from Monday to Thursday because the build failed.', (t) => /launch|thursday|delay|moved/i.test(t) && t.length < 90],
  ['Turn this into a bullet list. Reply with only the list.', 'Buy milk, call mum, fix the bike', (t) => (t.match(/^\s*[-*•]/gm) || []).length >= 3],
];

// --- Quick answers.
const quick = [
  ['Reply with just the number: how many days are in a leap year?', (t) => /366/.test(t)],
  ['Reply with one word: the opposite of "ancient".', (t) => /modern|new|young/i.test(t)],
  ['Give a 3-word title for a note about watering plants. Reply with only the title.', (t) => t.trim().split(/\s+/).length <= 5],
  ['Is "rm -rf /" safe to run? Answer yes or no, then one short reason.', (t) => /^\W*no\b/i.test(t.trim())],
];

// --- Seeing: a tiny picture made here (a solid colour square).
function png(r, g, b, size = 64) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString('base64')}`;
}
const sees = [
  [png(220, 30, 30), (t) => /red/i.test(t)],
  [png(30, 60, 220), (t) => /blue/i.test(t)],
  [png(40, 180, 60), (t) => /green/i.test(t)],
];

async function call(tok, task, model, messages, maxTokens = 600) {
  const t0 = Date.now();
  const res = await fetch(`${SITE}/api/orb/ai`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ task, model, messages, max_tokens: maxTokens, temperature: 0.2 }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { ok: false, ms, text: '', error: `${res.status} ${(await res.text()).slice(0, 160)}` };
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return { ok: true, ms, text: String(msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
}

const statusRes = await fetch(`${SITE}/api/orb/ai`, { headers: { authorization: `Bearer ${token()}` } });
const models = statusRes.ok ? (await statusRes.json()).models : null;
if (!models) {
  console.error(`Status check failed (${statusRes.status}). GET needs a browser session; pass ORB_MODELS_JSON instead.`);
}
const lists = models ?? JSON.parse(process.env.ORB_MODELS_JSON ?? '{}');

const results = [];
for (const [task, list] of Object.entries(lists)) {
  if (only.length && !only.includes(task)) continue;
  for (const model of list) {
    const tok = token();
    const jobs = [];
    if (task === 'agent' || task === 'fast')
      for (const [goal, screen, ok] of plans)
        jobs.push(['plan', [{ role: 'system', content: PLANNER_PROMPT }, { role: 'user', content: `Goal: ${goal}\nDone so far: nothing yet\n\n${screen}` }], (t) => {
          const s = firstJson(t);
          return Boolean(s && ok(s));
        }]);
    if (task === 'write' || task === 'fast')
      for (const [how, text, ok] of writes) jobs.push(['write', [{ role: 'system', content: how }, { role: 'user', content: text }], ok]);
    if (task === 'fast' || task === 'write') for (const [q, ok] of quick) jobs.push(['quick', [{ role: 'user', content: q }], ok]);
    if (task === 'vision')
      for (const [img, ok] of sees)
        jobs.push(['see', [{ role: 'user', content: [{ type: 'text', text: 'What colour fills this picture? One word.' }, { type: 'image_url', image_url: { url: img } }] }], ok]);
    let pass = 0, fail = 0, errors = 0, total = 0;
    const misses = [];
    for (const [kind, messages, ok] of jobs) {
      const r = await call(tok, task, model, messages);
      total += r.ms;
      if (!r.ok) {
        errors++;
        misses.push(`${kind}: ${r.error}`);
      } else if (ok(r.text)) pass++;
      else {
        fail++;
        misses.push(`${kind}: ${r.text.slice(0, 100).replace(/\s+/g, ' ')}`);
      }
      await new Promise((r) => setTimeout(r, 1600)); // stay under ~40 requests a minute
    }
    const row = { task, model, score: `${pass}/${jobs.length}`, errors, avgMs: Math.round(total / Math.max(jobs.length, 1)), misses: misses.slice(0, 6) };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
console.log('\nSummary');
for (const r of results) console.log(`${r.task.padEnd(7)} ${r.model.padEnd(48)} ${r.score.padStart(6)}  errors ${r.errors}  ~${r.avgMs} ms`);
