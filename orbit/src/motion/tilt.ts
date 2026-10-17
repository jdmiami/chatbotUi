/**
 * Tilt: the phone's motion sensor (or the mouse on a computer) moves the light and the depth layers
 * (docs/MOTION.md §1–2). Writes two numbers, --tx and --ty (−1…1), on <html> once per frame while
 * they change; CSS does the rest. Nothing else listens to the sensor.
 */

type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** iPhone/iPad Safari asks before a site may read the motion sensor. */
export function tiltNeedsPermission(): boolean {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as DOE).requestPermission === 'function';
}

/** Must run from a tap. Resolves true when the sensor may be read. */
export async function requestTiltPermission(): Promise<boolean> {
  if (!tiltNeedsPermission()) return true;
  try {
    return (await (DeviceOrientationEvent as DOE).requestPermission!()) === 'granted';
  } catch {
    return false;
  }
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Start following the sensor and the mouse. `askOnTap`: on iPhone, once permission was given before,
 * ask again (silently) on the first tap of this visit. Returns a stop function that resets the tilt.
 */
export function startTilt({ askOnTap = false } = {}): () => void {
  const root = document.documentElement;
  let tx = 0;
  let ty = 0;
  let gx = 0;
  let gy = 0;
  let base: { beta: number; gamma: number } | null = null;
  let frame = 0;

  const step = () => {
    tx += (gx - tx) * 0.12;
    ty += (gy - ty) * 0.12;
    root.style.setProperty('--tx', tx.toFixed(3));
    root.style.setProperty('--ty', ty.toFixed(3));
    frame = Math.abs(gx - tx) + Math.abs(gy - ty) > 0.002 ? requestAnimationFrame(step) : 0;
  };
  const kick = () => {
    if (!frame) frame = requestAnimationFrame(step);
  };

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    // Whatever angle you hold the phone at becomes "level"; it slowly follows if you change grip.
    base ??= { beta: e.beta, gamma: e.gamma };
    base.beta += (e.beta - base.beta) * 0.01;
    base.gamma += (e.gamma - base.gamma) * 0.01;
    gx = clamp((e.gamma - base.gamma) / 18);
    gy = clamp((e.beta - base.beta) / 18);
    kick();
  };
  const fine = matchMedia('(pointer: fine)').matches;
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    gx = clamp((e.clientX / innerWidth) * 2 - 1);
    gy = clamp((e.clientY / innerHeight) * 2 - 1);
    kick();
  };
  const onLeave = () => {
    gx = 0;
    gy = 0;
    kick();
  };

  addEventListener('deviceorientation', onOrientation);
  if (fine) {
    addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);
  }
  const onFirstTap = () => void requestTiltPermission();
  if (askOnTap && tiltNeedsPermission()) addEventListener('pointerup', onFirstTap, { once: true });

  return () => {
    removeEventListener('deviceorientation', onOrientation);
    removeEventListener('pointermove', onPointer);
    document.removeEventListener('pointerleave', onLeave);
    removeEventListener('pointerup', onFirstTap);
    cancelAnimationFrame(frame);
    root.style.removeProperty('--tx');
    root.style.removeProperty('--ty');
  };
}

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
