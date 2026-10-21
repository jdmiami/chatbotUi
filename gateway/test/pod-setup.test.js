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

// The auto-off timer is shared with the AI machine (shared/autooff.js): the gateway imports it from
// ../../shared, so the machine must download it to /opt/shared next to /opt/gateway.
test('pod setup copies the shared auto-off timer next to the gateway', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const script = fs.readFileSync(path.join(root, '../linux/pod-setup.sh'), 'utf8');
  for (const f of fs.readdirSync(path.join(root, '../shared')).filter((x) => /\.js$|^package\.json$/.test(x))) {
    assert.ok(script.includes(`shared/${f}`), `linux/pod-setup.sh is missing shared/${f}`);
  }
  assert.match(script, /\/opt\/shared/);
  assert.match(script, /IDLE_MINUTES=\$\{IDLE_MINUTES:-60\}/, 'the default is the shared 60 minutes');
});
