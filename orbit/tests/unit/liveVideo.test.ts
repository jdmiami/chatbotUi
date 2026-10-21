import { describe, expect, it } from 'vitest';
import { FRAME_SIDE, squareFrame } from '../../src/apps/ai/LiveVideo';
import { withCatalog } from '../../src/apps/ai/makerCatalog';

describe('Live video', () => {
  it('sends the middle square of the camera picture at 512 × 512', () => {
    const calls: unknown[][] = [];
    const out = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (...a: unknown[]) => calls.push(a) }),
      toDataURL: (type: string) => `data:${type};base64,AAAA`,
    } as unknown as HTMLCanvasElement;
    const camera = { videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
    expect(squareFrame(camera, out)).toBe('data:image/jpeg;base64,AAAA');
    expect([out.width, out.height]).toEqual([FRAME_SIDE, FRAME_SIDE]);
    // 720 × 720 from the middle of 1280 × 720.
    expect(calls[0].slice(1)).toEqual([280, 0, 720, 720, 0, 0, 512, 512]);
    expect(squareFrame({ videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement, out)).toBeNull();
  });

  it('both live video makers arrive from the catalog; Krea is marked Turbo-only', () => {
    const all = withCatalog([]);
    const sd = all.find((m) => m.id === 'live-sdv2');
    const krea = all.find((m) => m.id === 'live-krea');
    expect(sd?.kind).toBe('live');
    expect(krea?.turboOnly).toBe(true);
    expect(krea!.size).toBeGreaterThan(40e9);
  });
});
