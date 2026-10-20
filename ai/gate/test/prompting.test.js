import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitLines, h3Prompt, lineTimes, ltxPrompt, parseSays, shotPromptFor, wordBudget } from '../src/prompting.js';
import { parseStory, storyMessages } from '../src/story.js';

const SAYS = 'Mara, softly: "You said you\'d be gone by morning."\nTom, low and tired: "I changed my mind."';

test('says: reads who, how and the words; singing is noticed; plain text is kept as words', () => {
  assert.deepEqual(parseSays(SAYS), [
    { who: 'Mara', how: 'softly', sung: false, line: "You said you'd be gone by morning." },
    { who: 'Tom', how: 'low and tired', sung: false, line: 'I changed my mind.' },
  ]);
  assert.deepEqual(parseSays('Mia sings, warm and low: "Hold me till the morning"'), [{ who: 'Mia', how: 'warm and low', sung: true, line: 'Hold me till the morning' }]);
  assert.deepEqual(parseSays('Let it go'), [{ who: '', how: '', sung: false, line: 'Let it go' }]);
  assert.deepEqual(parseSays(''), []);
});

test('lines that cannot be said in the time are dropped whole, never cut or reworded', () => {
  assert.equal(wordBudget(5), 9);
  assert.ok(wordBudget(5, true) < wordBudget(5));
  const lines = parseSays('A: "one two three four five six"\nB: "seven eight nine ten eleven twelve"');
  assert.deepEqual(fitLines(lines, 5).map((l) => l.line), ['one two three four five six']);
  assert.equal(fitLines(lines, 10).length, 2);
  const long = parseSays('A: "' + 'word '.repeat(30).trim() + '"');
  assert.equal(fitLines(long, 3).length, 1, 'the first line always stays');
});

test('LTX: one paragraph, present tense, quoted speech with its voice, audio last, no text on screen', () => {
  const p = ltxPrompt({ look: 'Warm 16mm film', lead: 'a woman in a grey cardigan', action: 'Mara turns from the sink toward the doorway as the camera pushes in slowly', says: SAYS, sound: 'shots', seconds: 8 });
  assert.equal(p.includes('\n'), false);
  assert.match(p, /^Warm 16mm film\. The lead: a woman in a grey cardigan\. Mara turns from the sink toward the doorway as the camera pushes in slowly\./);
  assert.match(p, /Mara says softly, "You said you'd be gone by morning\."/);
  assert.match(p, /Then Tom says low and tired, "I changed my mind\."/);
  assert.match(p, /The audio is clear spoken dialogue over natural room tone and ambient sound/);
  assert.match(p, /No on-screen text, subtitles or logos\.$/);
  assert.ok(p.indexOf('The audio') > p.indexOf('Tom says'));
  const song = ltxPrompt({ action: 'She faces the camera', says: 'Mia sings, warm and low: "Hold me till the morning"', seconds: 5 });
  assert.match(song, /Mia sings warm and low, "Hold me till the morning"\./);
  assert.match(song, /sung vocal/);
});

test('LTX: music only and quiet leave out the words; no words says nobody speaks', () => {
  assert.match(ltxPrompt({ action: 'She runs', says: SAYS, sound: 'music' }), /instrumental music only, with no speech or singing/);
  assert.doesNotMatch(ltxPrompt({ action: 'She runs', says: SAYS, sound: 'music' }), /Mara says/);
  assert.doesNotMatch(ltxPrompt({ action: 'She runs', says: SAYS, sound: 'quiet' }), /audio|Mara says/i);
  assert.match(ltxPrompt({ action: 'She runs' }), /with no speech/);
});

test('H3: Beats with timings, Look, Sound with each line timed and attributed, Limits', () => {
  const p = h3Prompt({ look: 'Warm 16mm film', lead: 'a woman in a grey cardigan', action: 'Mara turns from the sink toward the doorway', says: SAYS, sound: 'shots', seconds: 12, keyframes: true });
  const blocks = p.split('\n\n');
  assert.match(blocks[0], /^Roles: the shot opens on the start picture and ends on the end picture/);
  assert.equal(blocks[1], 'Beats:\n0 to 12s: Mara turns from the sink toward the doorway.');
  assert.match(blocks[2], /^Look: Warm 16mm film\. The lead: a woman in a grey cardigan\.$/);
  assert.match(blocks[3], /^Sound: Natural ambient sound and effects/);
  assert.match(blocks[3], /Mara, 0\.5 to \d+(\.5)?s, says softly: "You said you'd be gone by morning\."/);
  assert.match(blocks[3], /Tom, [\d.]+ to [\d.]+s, says low and tired: "I changed my mind\."/);
  assert.match(blocks[4], /^Limits: Every spoken or sung word is exactly as written/);
  assert.match(blocks[4], /No subtitles, no on-screen text, no watermark\./);
  assert.doesNotMatch(h3Prompt({ action: 'She runs', sound: 'quiet', says: SAYS }), /says|sings/);
  assert.match(h3Prompt({ action: 'She runs', sound: 'music' }), /Instrumental music only/);
  assert.match(h3Prompt({ action: 'She runs' }), /No one speaks or sings/);
});

test('H3: line timings follow each other and finish inside the clip', () => {
  const lines = parseSays(SAYS);
  for (const secs of [5, 8, 15]) {
    const t = lineTimes(fitLines(lines, secs), secs);
    t.forEach(([a, b], i) => {
      assert.ok(b > a && b <= secs, `${secs}s: ${a}-${b}`);
      if (i) assert.ok(a >= t[i - 1][1], 'in order');
    });
  }
});

test('each maker gets its own shape', () => {
  const args = { action: 'She runs', says: 'A: "Go"', seconds: 5 };
  assert.equal(shotPromptFor('ltx', args), ltxPrompt(args));
  assert.equal(shotPromptFor('h3-max', args), h3Prompt(args));
});

test('the story writer is told how to write the words, and its lines are read back', () => {
  const { system } = storyMessages({ idea: 'x', template: 'story', count: 2, seconds: 5, shape: 'portrait' });
  assert.match(system, /"says"/);
  assert.match(system, /about 9 spoken words/);
  assert.match(system, /Never write the words of a line inside "action"/);
  assert.match(system, /present-tense/);
  assert.match(storyMessages({ idea: 'x', count: 2, seconds: 5, sound: 'music' }).system, /Nobody speaks or sings/);
  const s = parseStory(JSON.stringify({ shots: [{ action: 'She turns.', says: ['Mara, softly: "Stay."', { who: 'Tom', how: 'low', line: 'No.' }], end: 'x' }, { action: 'Silence.', end: 'y' }] }), 2);
  assert.equal(s.shots[0].says, 'Mara, softly: "Stay."\nTom, low: "No."');
  assert.equal(s.shots[1].says, '');
});
