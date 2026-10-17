/**
 * A real spring for things you let go of mid-gesture. Unlike a CSS/WAAPI curve it starts at the
 * finger's speed, so a flick carries on at the pace you threw it (MOTION.md §3, `flick`).
 * Integrates in small fixed steps each frame, and can be stopped at any point (to grab it again).
 */
export interface SpringParams {
  stiffness: number;
  damping: number;
  mass?: number;
}

export function springValue({
  from,
  to,
  velocity = 0,
  spring,
  onUpdate,
  rest = 0.0005,
}: {
  from: number;
  to: number;
  /** Units per second, in the same units as from/to. */
  velocity?: number;
  spring: SpringParams;
  onUpdate: (value: number) => void;
  rest?: number;
}) {
  const mass = spring.mass ?? 1;
  let x = from;
  let v = velocity;
  let raf = 0;
  let last = 0;
  let resolve: (finished: boolean) => void = () => {};
  const finished = new Promise<boolean>((r) => (resolve = r));
  const step = (t: number) => {
    const elapsed = last ? Math.min(0.064, (t - last) / 1000) : 1 / 60;
    last = t;
    for (let left = elapsed; left > 0; left -= 1 / 240) {
      const dt = Math.min(1 / 240, left);
      const a = (-spring.stiffness * (x - to) - spring.damping * v) / mass;
      v += a * dt;
      x += v * dt;
    }
    const range = Math.max(1e-6, Math.abs(to - from));
    if (Math.abs(x - to) / range < rest && Math.abs(v) / range < rest * 60) {
      onUpdate(to);
      return resolve(true);
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    finished,
    stop() {
      cancelAnimationFrame(raf);
      resolve(false);
    },
  };
}
