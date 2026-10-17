import { describe, expect, it } from 'vitest';
import { latestVideo, parseShots, planMessages } from '../../src/apps/soreal/plan';

describe('soReal planning', () => {
  it('reads a JSON array, even inside other text and after thinking', () => {
    expect(parseShots('<think>hmm [1]</think>Sure!\n```json\n["She runs.", "  She jumps. ", ""]\n```')).toEqual(['She runs.', 'She jumps.']);
    expect(parseShots('[{"shot": "A door opens."}, {"text": "Light floods in."}]')).toEqual(['A door opens.', 'Light floods in.']);
  });

  it('falls back to numbered or bulleted lists', () => {
    expect(parseShots('1. The car stops.\n2) Rain starts.\n- **Shot 3**: Wipers swing.\nThat is all.')).toEqual(['The car stops.', 'Rain starts.', 'Wipers swing.']);
    expect(parseShots('nothing useful')).toEqual([]);
  });

  it('asks for continuous shots of the right length and passes the look', () => {
    const m = planMessages('a heist', 'Two thieves in black', 6, 5);
    expect(m[0].content).toContain('about 5 seconds');
    expect(m[1].content).toContain('Two thieves in black');
    expect(m[1].content).toContain('Write 6 shots.');
  });

  it('latest video is the newest video, not a picture', () => {
    const items = [
      { id: 'a', kind: 'video' as const, prompt: '', createdAt: '2026-10-01T00:00:00Z', url: '' },
      { id: 'b', kind: 'image' as const, prompt: '', createdAt: '2026-10-03T00:00:00Z', url: '' },
      { id: 'c', kind: 'video' as const, prompt: '', createdAt: '2026-10-02T00:00:00Z', url: '' },
    ];
    expect(latestVideo(items)?.id).toBe('c');
    expect(latestVideo([])).toBeNull();
  });
});
