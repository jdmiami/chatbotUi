/** Where the last tap or click landed (screen coordinates), so things can grow from it. */
let lastTap: { x: number; y: number; at: number } | null = null;
if (typeof window !== 'undefined') {
  addEventListener(
    'pointerdown',
    (e) => {
      lastTap = { x: e.clientX, y: e.clientY, at: performance.now() };
    },
    { capture: true, passive: true },
  );
}
export function recentTap(withinMs = 700) {
  return lastTap && performance.now() - lastTap.at < withinMs ? lastTap : null;
}
