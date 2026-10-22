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

import { recommend, SCRIPT_OK } from '../../src/studio/engine';
import { anotherTake, beatsFor, castOf, describe as describeCast, draftScript, parseScenes, scriptBasis } from '../../src/studio/writer';

describe('the orb’s pick', () => {
  it('picks the answer that fits what was chosen before, and says why', () => {
    const a = { cut: "Director's cut", premise: 'Strangers snowed in at a cabin', tone: 'Slow burn', cast: 'A couple' };
    const world = movie.steps.find((s) => s.id === 'world')!;
    expect(recommend(movie, a, world)).toEqual({ label: 'Snowed-in cabin', why: 'It fits “cabin” in your story.' });
    const ending = movie.steps.find((s) => s.id === 'ending')!;
    expect(recommend(movie, a, ending)?.label).toBe('One last look, then gone');
  });
  it('falls back to the writer’s idea, then to the step’s best', () => {
    const scenes = movie.steps.find((s) => s.id === 'scenes')!;
    expect(recommend(movie, { cut: "Director's cut" }, scenes)?.label).toBe('4 scenes');
    const premise = movie.steps.find((s) => s.id === 'premise')!;
    const idea = { label: 'A heist that turns personal', hint: 'Partners in crime' };
    expect(recommend(movie, { cut: 'Quick film' }, premise, [idea, ...premise.choices], [idea])).toEqual({ label: idea.label, why: 'The writer’s idea: partners in crime.' });
  });
});

describe('the writers’ room', () => {
  const director = { cut: "Director's cut", premise: 'Ex-lovers meet at a wedding', tone: 'Intense', cast: 'A couple', lead: 'Curvy, red lipstick, sleek bob', partner: 'Thirties, sharp jaw, silver rings', world: 'Wedding hotel suite', time: 'Late night, after the rain', beats: 'Argument turns to passion', ending: 'A twist', scenes: '4 scenes', msound: 'Their voices' };
  it('names the cast the same way every time', () => {
    const cast = castOf(director);
    expect(cast).toHaveLength(2);
    expect(castOf(director)).toEqual(cast);
    expect(castOf({ cast: 'A woman' })).toHaveLength(1);
  });
  it('drafts one scene per shot, ending on the chosen ending', () => {
    const s = draftScript(director);
    expect(s).toHaveLength(4);
    expect(beatsFor(4)).toEqual([0, 2, 4, 5]);
    expect(s[0].heading).toBe('INT. WEDDING HOTEL SUITE — NIGHT');
    expect(s[0].action).toContain(castOf(director)[0].name);
    expect(s[3].says).toContain('Nothing personal');
    expect(draftScript({ ...director, msound: 'Music' })[0].says).toBe('');
    expect(draftScript({ cut: 'Quick film', premise: 'x', cast: 'A woman', tone: 'Playful' })).toHaveLength(3);
  });
  it('gives another take, and redrafts only when the story changes', () => {
    const s = draftScript(director);
    const t = anotherTake(director, s, 1);
    expect(t[1].action).not.toBe(s[1].action);
    expect(anotherTake(director, t, 1)[1].action).toBe(s[1].action);
    expect(scriptBasis({ ...director, mcamera: 'Classic and slow' })).toBe(scriptBasis(director));
    expect(scriptBasis({ ...director, ending: 'Together at dawn' })).not.toBe(scriptBasis(director));
  });
  it('reads a script out of a chatty reply', () => {
    const s = parseScenes('Here:\n[{"heading":"INT. CABIN — NIGHT","action":"Mara opens the door.","end":"Snow blows in.","says":""}]', 'H');
    expect(s).toEqual([{ id: 's1', heading: 'INT. CABIN — NIGHT', action: 'Mara opens the door.', end: 'Snow blows in.', says: '' }]);
  });
  it('films your script as written, with who is who at the first mention', () => {
    const a = { ...director, script: `4 scenes, ${SCRIPT_OK.toLowerCase()}`, mcamera: 'Classic and slow', finish: 'Film noir', review: 'Yes, show me first' };
    const script = draftScript(a);
    const job = jobOf(AFTER_DARK, 'movie', a, null, script);
    if (job.kind !== 'movie') throw new Error('not a movie');
    expect(job.draft.shots).toHaveLength(4);
    expect(job.draft.length).toBe(20);
    expect(job.draft.opening).toMatch(/^Establishing shot of the wedding hotel suite/);
    const [lead] = castOf(a);
    expect(job.draft.shots![0].prompt).toContain(`${lead.name} (curvy, red lipstick, sleek bob)`);
    expect(job.draft.lead).toEqual({ mode: 'ai', description: expect.stringContaining(lead.name) });
    expect(describeCast('No one here', castOf(a))).toBe('No one here');
  });
  it('“Finish it for me” takes the script as drafted', () => {
    const a = finishAll(movie, { cut: 'Quick film' }, fixed);
    expect(a.script).toBe(SCRIPT_OK);
  });
});
