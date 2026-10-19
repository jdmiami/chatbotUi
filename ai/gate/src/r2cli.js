// R2 from the shell, for ai/setup.sh and ai/studio.sh (keys from the environment, never printed):
//
//   node r2cli.js has KEY                 exit 0 when KEY is in the bucket, 1 when it isn't
//   node r2cli.js get-tar KEY DIR         unpack the tar at KEY into DIR
//   node r2cli.js put-tar KEY DIR PATH... pack PATHs (relative to DIR) into a tar at KEY
//
// Exit 2 when R2 isn't set up (no keys) or a transfer failed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createR2, downloadStream, r2FromEnv, uploadStream } from './r2.js';

const [cmd, key, dir, ...paths] = process.argv.slice(2);
const conf = r2FromEnv(process.env);
if (!conf) {
  console.error('[r2] not set up (no R2 keys)');
  process.exit(2);
}
const r2 = createR2(conf);
// `ok` exit codes: when packing, GNU tar's 1 only means a file changed while it was read (fine here).
const ended = (p, ok = [0]) => new Promise((resolve, reject) => p.on('close', (c) => (ok.includes(c) ? resolve() : reject(new Error(`tar exited ${c}`)))));

try {
  if (cmd === 'has') {
    process.exit((await r2.head(key)) ? 0 : 1);
  } else if (cmd === 'get-tar') {
    if (!(await r2.head(key))) process.exit(1);
    fs.mkdirSync(dir, { recursive: true });
    const tar = spawn('tar', ['-x', '-C', dir], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = ended(tar);
    const t0 = Date.now();
    let bytes = 0;
    for await (const chunk of downloadStream(r2, key)) {
      bytes += chunk.length;
      if (!tar.stdin.write(chunk)) await new Promise((r) => tar.stdin.once('drain', r));
    }
    tar.stdin.end();
    await done;
    console.log(`[r2] ${key}: ${(bytes / 1e9).toFixed(1)} GB in ${Math.round((Date.now() - t0) / 1000)} s`);
  } else if (cmd === 'put-tar') {
    const tar = spawn('tar', ['-c', '--exclude=__pycache__', '-C', dir, ...paths], { stdio: ['ignore', 'pipe', 'inherit'] });
    const done = ended(tar, [0, 1]);
    const t0 = Date.now();
    const bytes = await uploadStream(r2, tar.stdout, key, { ready: () => done });
    console.log(`[r2] saved ${key}: ${(bytes / 1e9).toFixed(1)} GB in ${Math.round((Date.now() - t0) / 1000)} s`);
  } else {
    console.error('usage: r2cli.js has|get-tar|put-tar KEY [DIR PATH...]');
    process.exit(2);
  }
} catch (err) {
  console.error(`[r2] ${cmd} ${key}: ${err.message}`);
  process.exit(2);
}
