import { describe, expect, it } from 'vitest';
import { STEPS, aboutTime, phaseLine, shotsFor, stages } from '../../src/apps/soreal/plan';
import type { Movie } from '../../src/services/ai/LocalAi';

const movie = (over: Partial<Movie> = {}): Movie => ({
  id: 'm1',
  title: 'Kite day',
  look: '',
  maker: 'ltx',
  size: 'portrait',
  seconds: 5,
  start: null,
  shots: [
    { id: 's1', prompt: 'She runs', itemId: null, status: 'todo', error: null },
    { id: 's2', prompt: 'The kite flies', itemId: null, status: 'todo', error: null },
  ],
  render: null,
  running: false,
  runningOn: null,
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
  flow: 'auto',
  phase: 'draft',
  lead: { mode: 'ai', description: '', itemId: null, status: 'todo', error: null },
  frames: [],
  ...over,
});

describe('soReal', () => {
  it('turns seconds into plain words', () => {
    expect(aboutTime(30)).toBe('under a minute');
    expect(aboutTime(60)).toBe('about 1 minute');
    expect(aboutTime(12 * 60 + 10)).toBe('about 12 minutes');
    expect(aboutTime(80 * 60)).toBe('about 1 h 20 min');
    expect(aboutTime(120 * 60)).toBe('about 2 hours');
    expect(aboutTime(null)).toBe('');
  });

  it('a movie has one shot per 5 seconds, 30 seconds at most meaning 6 shots', () => {
    expect([10, 20, 30].map((l) => shotsFor(l))).toEqual([2, 4, 6]);
  });

  it('says what the machine is doing', () => {
    expect(phaseLine(movie({ phase: 'story', running: true }))).toBe('Writing the story');
    const frames = [0, 1, 2].map((i) => ({ id: `f${i}`, prompt: '', itemId: i ? null : 'x', status: (i ? 'todo' : 'done') as 'todo' | 'done', error: null }));
    expect(phaseLine(movie({ phase: 'storyboard', running: true, frames }))).toBe('Drawing the storyboard: picture 2 of 3');
    const shots = movie().shots.map((s, i) => ({ ...s, status: (i ? 'making' : 'done') as 'making' | 'done' }));
    expect(phaseLine(movie({ phase: 'shots', running: true, runningOn: 'helper', shots }))).toBe('Making shot 2 of 2 on the helper');
    expect(phaseLine(movie({ phase: 'error', error: 'Shot 2 could not be made: out of memory' }))).toBe('Shot 2 could not be made: out of memory');
    expect(phaseLine(movie({ phase: 'done', render: { itemId: 'r', at: '', stale: true } }))).toBe('Changed: update the movie to see it');
  });

  it('lists the stages, skipping the lead when there is none', () => {
    const s = stages(movie({ phase: 'shots', running: true, lead: { mode: 'none', description: '', itemId: null, status: 'todo', error: null } }));
    expect(s.map((x) => `${x.name}:${x.state}`)).toEqual(['Story:done', 'Lead:skip', 'Storyboard:todo', 'Shots:now', 'Final cut:todo']);
  });

  it('every walkthrough step has a short line for the orb that says skipping is fine where it can be skipped', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['idea', 'shape', 'story', 'cast', 'storyboard', 'sound', 'make']);
    for (const s of STEPS) expect(s.guide.length).toBeLessThan(100);
    for (const s of STEPS.filter((x) => ['idea', 'shape', 'story', 'cast', 'sound'].includes(x.id))) expect(s.guide.toLowerCase()).toContain('skip');
  });
});
