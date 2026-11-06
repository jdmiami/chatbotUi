/**
 * Paper sounds, made on the spot (no sound files): a soft flick each time a note turns, louder the
 * faster it goes, and a continuous rustle while the pad riffles. Safari only lets a page make sound
 * after a tap, so the sound starts on the first touch.
 */
const KEY = 'orbit:flipbook:sound';

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* not remembered */
  }
}

type AC = typeof AudioContext;

export class PaperSound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private rustle: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private last = 0;
  enabled = soundOn();

  /** Call from a touch: wakes the sound up (Safari's rule). */
  wake() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor: AC | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** One note turning. `strength` 0..1. */
  flick(strength: number) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.noise || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.last < 0.035) return; // at most ~28 a second; a riffle becomes a rustle instead
    this.last = now;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200 + Math.random() * 1800;
    bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    const peak = 0.04 + Math.min(1, strength) * 0.16;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.06 + Math.random() * 0.03);
    src.connect(bp).connect(hp).connect(g).connect(ctx.destination);
    src.start(now, Math.random() * 0.4, 0.1);
  }

  /** The riffle's rustle: `speed` in notes a second (0 stops it). */
  riffle(speed: number) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const level = this.enabled && speed > 4 ? Math.min(0.12, (speed - 4) * 0.006) : 0;
    if (!this.rustle && level > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      this.rustle = { src, gain, filter };
    }
    if (this.rustle) {
      const t = ctx.currentTime;
      this.rustle.gain.gain.setTargetAtTime(level, t, 0.05);
      this.rustle.filter.frequency.setTargetAtTime(1800 + Math.min(40, speed) * 60, t, 0.08);
      if (level === 0) {
        const r = this.rustle;
        this.rustle = null;
        setTimeout(() => r.src.stop(), 400);
      }
    }
  }

  set(on: boolean) {
    this.enabled = on;
    setSoundOn(on);
    if (!on) this.riffle(0);
    else this.wake();
  }
}
