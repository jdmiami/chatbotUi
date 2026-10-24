import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { budgetFor, createStudio, jobUnits, pngSize } from '../src/studio.js';

const FILES = {
  image: [{ dir: 'diffusion_models', name: 'img.safetensors', repo: 'o/r', path: 'img.safetensors', size: 4 }],
  video: [{ dir: 'checkpoints', name: 'vid.safetensors', repo: 'o/r', path: 'vid.safetensors', size: 4 }],
};

/**
 * A pretend ComfyUI that runs one prompt at a time, like the real one. `c` controls it:
 *   up (answers at all), frozen (ignores interrupts), fail (next run ends with this error),
 *   refuse (next /prompt is rejected as invalid).
 */
function fakeComfy(c) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'huggingface.co') return new Response('nope', { status: 404 });
    const body = init.body ? JSON.parse(init.body) : null;
    c.calls.push(u.pathname);
    if (u.pathname.startsWith('/api/')) return Response.json({ models: [] });
    if (!c.up) throw new TypeError('fetch failed');
    if (u.pathname === '/system_stats') return Response.json({});
    if (u.pathname === '/prompt') {
      if (c.refuse) {
        c.refuse = false;
        return Response.json({ error: { message: 'Prompt outputs failed validation' }, node_errors: { 7: { errors: [{ message: 'Value not in list' }] } } }, { status: 400 });
      }
      const id = `p${++c.n}`;
      c.prompts.push(id);
      c.running.push(id);
      return Response.json({ prompt_id: id });
    }
    if (u.pathname === '/queue' && init.method === 'POST') {
      // Like ComfyUI: deleting only takes waiting prompts off the queue, not the running one.
      c.running = c.running.filter((id, i) => i === 0 || !body.delete?.includes(id));
      return Response.json({});
    }
    if (u.pathname === '/queue') return Response.json({ queue_running: c.running.slice(0, 1).map((id) => [0, id]), queue_pending: c.running.slice(1).map((id, i) => [i + 1, id]) });
    if (u.pathname === '/interrupt') {
      if (!c.frozen) c.running = c.running.filter((id) => id !== body.prompt_id);
      return Response.json({});
    }
    if (u.pathname.startsWith('/history/')) {
      const id = decodeURIComponent(u.pathname.slice(9));
      const h = c.history[id];
      return Response.json(h ? { [id]: h } : {});
    }
    return Response.json({});
  };
}

async function setup(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-'));
  for (const f of [...FILES.image, ...FILES.video]) {
    await fs.mkdir(path.join(dir, 'models', f.dir), { recursive: true });
    await fs.writeFile(path.join(dir, 'models', f.dir, f.name), 'abcd');
  }
  const c = { up: true, frozen: false, refuse: false, n: 0, prompts: [], running: [], history: {}, calls: [], restarts: 0 };
  const clock = { t: Date.parse('2026-10-18T12:00:00Z') };
  const studio = createStudio({
    dir,
    files: FILES,
    fetchImpl: fakeComfy(c),
    WebSocketImpl: null,
    log: { warn() {}, info() {} },
    now: () => clock.t,
    fastTroubleshoot: true,
    restartComfy: async () => {
      c.restarts++;
      c.running = [];
      return true;
    },
    ...extra,
  });
  /** ComfyUI finishes the job it is running, with a result file. */
  const done = async (id) => {
    c.running = c.running.filter((x) => x !== id);
    const name = `img-${id}.png`;
    await fs.mkdir(path.join(dir, 'output', 'orbit'), { recursive: true });
    await fs.writeFile(path.join(dir, 'output', 'orbit', name), 'PNG');
    c.history[id] = { status: { completed: true, status_str: 'success' }, outputs: { 9: { images: [{ filename: name, subfolder: 'orbit', type: 'output' }] } } };
  };
  const fail = (id, message) => {
    c.running = c.running.filter((x) => x !== id);
    c.history[id] = { status: { status_str: 'error', messages: [['execution_error', { exception_message: message }]] }, outputs: {} };
  };
  return { dir, c, clock, studio, done, fail };
}

test('queue: one job at a time, with its place in line and how long it should take', async () => {
  const { c, clock, studio, done } = await setup();
  const a = await studio.createJob({ kind: 'image', prompt: 'a red fox' });
  const b = await studio.createJob({ kind: 'image', prompt: 'a blue bird' });
  const v = await studio.createJob({ kind: 'video', prompt: 'waves', seconds: 5 });
  assert.deepEqual(c.prompts, ['p1'], 'only the first goes to ComfyUI');
  assert.equal(a.position, 0);
  assert.equal(b.position, 1);
  assert.equal(v.position, 2);
  assert.ok(a.expectedSeconds > 0);
  // The second picture reuses the loaded models; the video loads its own: it waits longer.
  assert.ok(b.etaSeconds > a.etaSeconds);
  assert.ok(v.etaSeconds > b.etaSeconds + 200, 'video after pictures: loading + making');

  clock.t += 20_000;
  await done('p1');
  await studio.poll();
  assert.equal(studio.job(a.id).status, 'done');
  assert.deepEqual(c.prompts, ['p1', 'p2']);
  assert.equal(studio.job(b.id).position, 0);
  assert.equal(studio.job(v.id).position, 1);

  // A waiting job can be cancelled without ever reaching ComfyUI.
  assert.equal((await studio.cancel(v.id)).status, 'stopped');
  await done('p2');
  await studio.poll();
  assert.deepEqual(c.prompts, ['p1', 'p2']);
});

test('queue: your waiting jobs can be put in a new order; the one being made stays, new ones go last', async () => {
  const { c, clock, studio, done } = await setup();
  const a = await studio.createJob({ kind: 'image', prompt: 'first' });
  const b = await studio.createJob({ kind: 'image', prompt: 'second' });
  const d = await studio.createJob({ kind: 'image', prompt: 'third' });
  const e = await studio.createJob({ kind: 'image', prompt: 'fourth' });
  const listed = studio.reorder([e.id, d.id, a.id, 'nope']);
  assert.deepEqual(
    listed.filter((j) => j.position).map((j) => [j.prompt, j.position]),
    [
      ['fourth', 1],
      ['third', 2],
      ['second', 3],
    ],
    'the named ones first, in that order; the one not named after them; unknown ids ignored',
  );
  assert.equal(studio.job(a.id).position, 0, 'the one being made is not moved');
  // The next one made is the one put first.
  const f = await studio.createJob({ kind: 'image', prompt: 'fifth' });
  assert.equal(studio.job(f.id).position, 4, 'added later: after the ones you ordered');
  clock.t += 20_000;
  await done('p1');
  await studio.poll();
  assert.equal(studio.job(e.id).position, 0);
  assert.equal(c.prompts.length, 2);
  assert.equal(studio.job(d.id).position, 1);
  assert.throws(() => studio.reorder('x'), (err) => err.status === 400);
  assert.equal(studio.job(b.id).position, 2);
});

test('time budget: a job that runs far too long is stopped, the GPU freed, and it runs again once', async () => {
  const { c, clock, studio } = await setup();
  const job = await studio.createJob({ kind: 'image', prompt: 'a lighthouse' });
  const budget = budgetFor(job.expectedSeconds * 1000);

  clock.t += job.expectedSeconds * 1000 * 1.6;
  await studio.poll();
  assert.equal(studio.job(job.id).slow, true, 'flagged as slower than usual');
  assert.equal(studio.job(job.id).attempt, 1);

  clock.t += budget;
  await studio.poll();
  const again = studio.job(job.id);
  assert.ok(c.calls.includes('/interrupt'), 'stopped in ComfyUI');
  assert.ok(c.calls.includes('/free'), 'GPU freed');
  assert.equal(again.attempt, 2);
  assert.equal(again.status, 'queued');
  assert.deepEqual(c.prompts, ['p1', 'p2'], 'sent again');
  assert.match(again.notes.join(' '), /longer than it should.*started again \(try 2 of 2\)/);

  // Too long again: it ends with what to do, and nothing keeps running.
  clock.t += budget * 2;
  await studio.poll();
  const end = studio.job(job.id);
  assert.equal(end.status, 'error');
  assert.match(end.error, /even after trying again\. Try a shorter or smaller one/);
  assert.deepEqual(c.running, []);
  assert.equal(studio.busy(), false);
});

test('frozen maker: when ComfyUI ignores the stop, it is restarted, then the job runs again', async () => {
  const { c, clock, studio, done } = await setup();
  const job = await studio.createJob({ kind: 'image', prompt: 'a castle' });
  c.frozen = true;
  clock.t += budgetFor(job.expectedSeconds * 1000) + 1000;
  await studio.poll();
  assert.equal(c.restarts, 1);
  const again = studio.job(job.id);
  assert.match(again.notes.join(' '), /frozen, so it was restarted/);
  assert.equal(again.attempt, 2);
  c.frozen = false;
  await done('p2');
  await studio.poll();
  assert.equal(studio.job(job.id).status, 'done');
});

test('lost job: ComfyUI restarted under it (crash); it is noticed and run again, no interrupt needed', async () => {
  const { c, studio } = await setup();
  const job = await studio.createJob({ kind: 'image', prompt: 'a forest' });
  c.running = []; // ComfyUI crashed and came back empty
  await studio.poll();
  assert.equal(studio.job(job.id).attempt, 1, 'one empty check is not enough');
  await studio.poll();
  const again = studio.job(job.id);
  assert.equal(again.attempt, 2);
  assert.match(again.notes[0], /restarted and lost the job/);
  assert.ok(!c.calls.includes('/interrupt'));
  assert.deepEqual(c.prompts, ['p1', 'p2']);
});

test('errors: out of memory gets one more try on a freed GPU; other errors end the job plainly', async () => {
  const { c, studio, fail } = await setup();
  const job = await studio.createJob({ kind: 'video', prompt: 'a city at night', seconds: 8 });
  fail('p1', 'CUDA error: out of memory. Tried to allocate 2.00 GiB');
  await studio.poll();
  const again = studio.job(job.id);
  assert.equal(again.attempt, 2);
  assert.match(again.notes[0], /ran out of memory/);
  assert.ok(c.calls.includes('/free'));
  fail('p2', 'CUDA error: out of memory');
  await studio.poll();
  assert.match(studio.job(job.id).error, /ran out of memory, even after trying again\. Try a smaller size or a shorter video\./);

  const other = await studio.createJob({ kind: 'image', prompt: 'a bridge' });
  fail('p3', 'mat1 and mat2 shapes cannot be multiplied');
  await studio.poll();
  const end = studio.job(other.id);
  assert.equal(end.status, 'error');
  assert.equal(end.attempt, 1, 'not retried: it would fail the same way');
  assert.match(end.error, /^The maker hit a problem: mat1/);
});

test('a job ComfyUI refuses (recipe problem) ends at once and the next one still runs', async () => {
  const { c, studio, done } = await setup();
  c.refuse = true;
  const bad = await studio.createJob({ kind: 'image', prompt: 'a boat' });
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /couldn't run this job .*400/);
  const good = await studio.createJob({ kind: 'image', prompt: 'a boat' });
  assert.equal(good.status, 'queued');
  await done('p1');
  await studio.poll();
  assert.equal(studio.job(good.id).status, 'done');
});

test('maker down: a job waits for ComfyUI to come back, and gives up with advice after a few minutes', async () => {
  const { c, clock, studio, done } = await setup();
  const first = await studio.createJob({ kind: 'image', prompt: 'a hill' });
  const second = await studio.createJob({ kind: 'image', prompt: 'a lake' });
  c.up = false;
  await studio.poll();
  clock.t += 60_000;
  await studio.poll();
  assert.equal(studio.job(first.id).status, 'queued', 'a minute down: still waiting (it restarts itself)');
  c.up = true;
  await done('p1');
  await studio.poll();
  assert.equal(studio.job(first.id).status, 'done');
  assert.equal(studio.job(second.id).position, 0);

  c.up = false;
  clock.t += 7 * 60_000;
  await studio.poll();
  clock.t += 1000;
  await studio.poll();
  const j = studio.job(second.id);
  assert.ok(['queued', 'error'].includes(j.status));
  if (j.status === 'queued') {
    // Tried once more after the restart attempt; still down: it ends.
    clock.t += 7 * 60_000;
    await studio.poll();
    await studio.poll();
  }
  assert.equal(studio.job(second.id).status, 'error');
  assert.match(studio.job(second.id).error, /stopped answering|did not come back|Turn the AI machine off and on again/);
});

test('timings: the machine learns how long its makers take', async () => {
  const { dir, clock, studio, done } = await setup();
  const a = await studio.createJob({ kind: 'image', prompt: 'one' });
  clock.t += 100_000;
  await done('p1');
  await studio.poll();
  const units = jobUnits({ kind: 'image', maker: 'qwen', width: 1328, height: 1328 });
  let learned = JSON.parse(await fs.readFile(path.join(dir, 'timings.json'), 'utf8'));
  // The first run loaded the models: it is learned as such (a load that is quicker than the guess
  // must never make the time negative and be thrown away).
  assert.equal(learned['qwen:cold'], Math.round(100_000 / units));
  assert.equal(learned.qwen, undefined);
  const b = await studio.createJob({ kind: 'image', prompt: 'two' });
  assert.ok(b.expectedSeconds < a.expectedSeconds, 'models already loaded: quicker than the first');
  clock.t += 30_000;
  await done('p2');
  await studio.poll();
  learned = JSON.parse(await fs.readFile(path.join(dir, 'timings.json'), 'utf8'));
  assert.equal(learned.qwen, Math.round(30_000 / units));
  const c = await studio.createJob({ kind: 'image', prompt: 'three' });
  assert.equal(c.expectedSeconds, 30, 'what it measured');
});

test('an edited or sharpened picture records its real size, read from the PNG', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'png-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  png.writeUInt32BE(4416, 16);
  png.writeUInt32BE(5888, 20);
  await fs.writeFile(path.join(dir, 'a.png'), png);
  assert.deepEqual(await pngSize(path.join(dir, 'a.png')), { width: 4416, height: 5888 });
  await fs.writeFile(path.join(dir, 'b.png'), 'not a png');
  assert.equal(await pngSize(path.join(dir, 'b.png')), null);
  assert.equal(await pngSize(path.join(dir, 'missing.png')), null);
});

test('meme lab jobs: yours go first, a running lab job makes way, and lab jobs never keep the machine on', async () => {
  const { c, studio, done } = await setup();
  const lab1 = await studio.createJob({ kind: 'image', prompt: 'a goose at a desk', background: true });
  const lab2 = await studio.createJob({ kind: 'image', prompt: 'a cat in a gym', background: true });
  assert.deepEqual(c.prompts, ['p1'], 'the first lab job runs');
  assert.equal(studio.busy(), false, 'lab jobs do not keep the machine on');
  assert.equal(studio.hasUserWork(), false);
  assert.deepEqual((await studio.state()).jobs, [], 'lab jobs stay out of your queue');

  const mine = await studio.createJob({ kind: 'image', prompt: 'a red fox' });
  assert.equal(studio.job(lab1.id).status, 'stopped', 'the running lab job stopped for yours');
  assert.ok(c.calls.includes('/interrupt'));
  assert.equal(studio.busy(), true);
  assert.equal(studio.hasUserWork(), true);
  assert.deepEqual(c.prompts, ['p1', 'p2'], 'yours went next, ahead of the waiting lab job');
  assert.equal(studio.job(mine.id).position, 0);

  await done('p2');
  await studio.poll();
  assert.equal(studio.job(mine.id).status, 'done');
  assert.deepEqual(c.prompts, ['p1', 'p2', 'p3'], 'then the lab carries on');
  await done('p3');
  await studio.poll();
  assert.equal(studio.job(lab2.id).status, 'done');
  // Lab results stay out of the gallery until kept.
  assert.deepEqual((await studio.items()).map((i) => i.id), [mine.id]);
  assert.deepEqual((await studio.labItems()).map((i) => i.id), [lab2.id]);
  assert.equal(await studio.promote(lab2.id), true);
  assert.deepEqual((await studio.items()).map((i) => i.id).sort(), [mine.id, lab2.id].sort());
  assert.deepEqual(await studio.labItems(), []);
});
