import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The Linux machine downloads the service file by file (linux/pod-setup.sh). A file missing from
// that list would stop the service from starting on the machine, so check every one is listed.
test('pod setup copies every service file', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const script = fs.readFileSync(path.join(root, '../linux/pod-setup.sh'), 'utf8');
  const listed = new Set(script.match(/(?:src|bin)\/[\w/.-]+\.m?js/g));
  const walk = (dir) =>
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.m?js$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const missing = [...walk('src'), ...walk('bin')].filter((f) => !listed.has(f));
  assert.deepEqual(missing, []);
});
