import { describe, expect, it } from 'vitest';
import { AFTER_DARK } from '../../src/studio/studios/afterdark';
import { answer, back, briefOf, finishAll, jobOf, nextStep, progressOf, promptOf, stepsFor } from '../../src/studio/engine';
import { mergeChoices, parseChoices } from '../../src/studio/predict';

const movie = AFTER_DARK.flows.movie;
const image = AFTER_DARK.flows.image;
const fixed = () => 0; // always the first choice

describe('studio walkthrough engine', () => {
  it('asks the questions in order, one at a time', () => {
    expect(nextStep(image, {})?.id).toBe('cast');
    const a = answer(image, {}, 'cast', 'A couple');
    expect(nextStep(image, a)?.id).toBe('looks');
    expect(progressOf(image, a)).toEqual({ n: 2, total: image.steps.length });
  });

  it('only asks the director questions in a director’s cut', () => {
    const quick = answer(movie, {}, 'cut', 'Quick film');
    const director = answer(movie, {}, 'cut', "Director's cut");
    expect(stepsFor(movie, quick).map((s) => s.id)).not.toContain('beats');
    expect(stepsFor(movie, director).map((s) => s.id)).toEqual(expect.arrayContaining(['lead', 'world', 'beats', 'scenes', 'review']));
  });

  it('skips the partner for a solo cast and forgets answers that no longer apply', () => {
    let a = answer(movie, {}, 'cut', "Director's cut");
    a = answer(movie, a, 'cast', 'A couple');
    a = answer(movie, a, 'partner', 'Thirties, sharp jaw, silver rings');
    expect(a.partner).toBeDefined();
    a = answer(movie, a, 'cast', 'A woman');
    expect(a.partner).toBeUndefined();
    expect(stepsFor(movie, a).map((s) => s.id)).not.toContain('partner');
  });

  it('goes back one answer at a time', () => {
    let a = answer(image, {}, 'cast', 'A woman');
    a = answer(image, a, 'looks', 'Freckles');
    expect(back(image, a)).toEqual({ cast: 'A woman' });
    expect(back(image, {})).toEqual({});
  });

  it('finishes the rest on request', () => {
    const done = finishAll(image, { cast: 'Two women' }, fixed);
    expect(nextStep(image, done)).toBeNull();
    expect(done.cast).toBe('Two women');
  });

  it('builds a prompt from the words, not the meta answers, and always adds the house rules', () => {
    const a = finishAll(image, { cast: 'A couple', shape: 'Landscape' }, fixed);
    const p = promptOf(AFTER_DARK, image, a);
    expect(p).toContain('an adult couple');
    expect(p).not.toContain('Landscape');
    expect(p.endsWith(AFTER_DARK.tail)).toBe(true);
    const job = jobOf(AFTER_DARK, 'image', a, ['krea-real']);
    expect(job.kind === 'image' && job.req.size).toBe('landscape');
    expect(job.kind === 'image' && job.req.maker).toBe('krea-real');
  });

  it('turns a director’s cut into a movie with a storyboard to approve', () => {
    let a = answer(movie, {}, 'cut', "Director's cut");
    a = finishAll(movie, { ...a, scenes: '6 scenes', msound: 'Music' }, fixed);
    const job = jobOf(AFTER_DARK, 'movie', a);
    expect(job.kind).toBe('movie');
    if (job.kind !== 'movie') return;
    expect(job.review).toBe(true);
    expect(job.draft.length).toBe(30);
    expect(job.draft.sound).toBe('music');
    expect(job.draft.idea).toContain('Story:');
    expect(briefOf(movie, a)[0]).toEqual({ key: 'Cut', value: "Director's cut" });
  });

  it('makes a quick film without a storyboard stop', () => {
    const a = finishAll(movie, { cut: 'Quick film' }, fixed);
    const job = jobOf(AFTER_DARK, 'movie', a);
    expect(job.kind === 'movie' && job.review).toBe(false);
    expect(job.kind === 'movie' && job.draft.length).toBe(15);
  });
});

describe('predicted choices', () => {
  it('reads a JSON list out of a chatty reply', () => {
    const list = parseChoices('Sure! ```json\n[{"label":"Velvet booth","hint":"Low red light"},"A rooftop pool"]\n```');
    expect(list).toEqual([{ label: 'Velvet booth', hint: 'Low red light' }, { label: 'A rooftop pool', hint: undefined }]);
    expect(parseChoices('no list here')).toEqual([]);
  });
  it('puts the writer first and drops repeats', () => {
    const merged = mergeChoices([{ label: 'Playful' }, { label: 'New one' }], [{ label: 'playful' }, { label: 'Romantic' }]);
    expect(merged.map((c) => c.label)).toEqual(['Playful', 'New one', 'Romantic']);
  });
});

import { lineFor, nudgeFor } from '../../src/studio/orbGuide';

describe('the orb as guide', () => {
  it('opens with the first question’s hint, then nods to the last answer', () => {
    expect(lineFor(image, {}, image.steps[0])).toBe('Everyone here is a fictional adult.');
    expect(lineFor(image, { cast: 'A couple' }, image.steps[1])).toMatch(/^\w[\w ]*: a couple\.$/);
  });
  it('skips meta answers when nodding, and nudges differently on yes/no questions', () => {
    expect(lineFor(movie, { cut: 'Quick film' }, movie.steps[1])).toBe('One line is enough. We build on it.');
    expect(nudgeFor(movie.steps[0])).toMatch(/Tap the one/);
    expect(nudgeFor(image.steps[0])).toMatch(/Pick for me/);
  });
});
