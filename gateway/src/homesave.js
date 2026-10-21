// Saves the desktop user's home (projects, Orbit sessions, sign-ins) to Cloudflare R2 before the
// machine turns off. The machine has no drive of its own: linux/pod-setup.sh restores the home from
// R2 at every start and installs the save script this runs (as root, through sudo, since the R2 keys
// are readable only by root). Without HOME_SAVE_CMD (a machine on a drive) saving is a no-op.
import { execFile } from 'node:child_process';

/**
 * @param command the save script (e.g. /usr/local/bin/orbit-home-save), or empty for none
 * @param run     (cmd, args, timeoutMs) => Promise, for tests
 * Returns { enabled, save({ timeoutMs }) }: concurrent saves share one run.
 */
export function createHomeSaver({ command = process.env.HOME_SAVE_CMD || '', run = runFile, log = console } = {}) {
  let running = null;
  return {
    enabled: Boolean(command),
    save({ timeoutMs = 10 * 60_000 } = {}) {
      if (!command) return Promise.resolve({ saved: false, reason: 'no save command' });
      running ||= run('sudo', ['-n', command], timeoutMs)
        .then(() => ({ saved: true }))
        .catch((err) => {
          log.warn?.(`[home] save failed: ${err.message}`);
          throw err;
        })
        .finally(() => (running = null));
      return running;
    },
  };
}

function runFile(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).toString().trim().split('\n').pop())) : resolve(stdout),
    ),
  );
}
