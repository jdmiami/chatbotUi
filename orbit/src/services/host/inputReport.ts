import type { HostClient } from './connection';

/**
 * Tells the Linux machine that a person is here: touches, clicks, typing and scrolling in Orbit are
 * reported at most once a minute. The machine turns itself off after 20 minutes without any (see
 * gateway/src/idle.js), so a forgotten tab can't keep it running, but someone reading or typing
 * a long message can.
 */
export function startInputReport(host: HostClient, everyMs = 60_000): () => void {
  let seen = false;
  let sentAt = 0;
  const flush = () => {
    if (!seen) return;
    seen = false;
    sentAt = Date.now();
    host.fetch('/input', { method: 'POST', keepalive: true }).catch(() => {});
  };
  const mark = () => {
    seen = true;
    if (Date.now() - sentAt > everyMs) flush();
  };
  const kinds = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const;
  for (const k of kinds) window.addEventListener(k, mark, { capture: true, passive: true });
  const timer = window.setInterval(flush, everyMs);
  return () => {
    for (const k of kinds) window.removeEventListener(k, mark, { capture: true });
    window.clearInterval(timer);
  };
}
