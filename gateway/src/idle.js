// What counts as use on the Linux machine. The timer itself is the one every machine shares
// (shared/autooff.js): the machine turns itself off after the site's AUTO_OFF_MINUTES without touch,
// mouse or keyboard input (in the desktop, the terminal, Orbit or VS Code) while no Antigravity turn
// or Claude Code task runs. An open page or a live connection is not input: only what a person does counts.

/**
 * True while a terminal coding agent (Claude Code) runs as this user, so a long task it works on
 * by itself doesn't count as "nobody here". It still counts only up to `maxBusyMinutes` past the
 * last real input, like an Antigravity turn.
 */
export async function cliAgentRunning({ procDir = '/proc', names = ['claude'], uid = process.getuid?.() } = {}) {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  let entries;
  try { entries = await readdir(procDir); } catch { return false; }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const comm = (await readFile(`${procDir}/${pid}/comm`, 'utf8')).trim();
      if (!names.includes(comm)) continue;
      if (uid != null && (await stat(`${procDir}/${pid}`)).uid !== uid) continue;
      return true;
    } catch { /* the process ended while we looked */ }
  }
  return false;
}

/** Guacamole instructions from the browser that are a person's input (not pings or sizes). */
export const GUAC_INPUT = /(?:^|;)\d+\.(?:mouse|key|touch),/;
