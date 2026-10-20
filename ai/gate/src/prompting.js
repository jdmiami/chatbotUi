// How a shot's words go to the video maker. Both makers (LTX-2.3 and MiniMax H3) make the sound with
// the picture in one pass, so what people say or sing has to be written inside the prompt, in the
// shape each model was trained on:
//
//   LTX-2.3   one flowing present-tense paragraph: subject, action, camera, mood. Spoken words go in
//             quotation marks, with the voice described (whisper, shout, accent), and the paragraph
//             ends with the sound (room tone, ambience, how clear the voices are). Short lines;
//             no emotion labels, on-screen text or logos.
//   H3        blocks: Beats (what happens, with timings), Look, Sound (each line with who says it and
//             when, plus effects and music), Limits (what must not appear). Spoken words are never
//             reworded, and a line must fit the time its speaker is on screen.
//
// A shot's "says" is plain text, one line each: `Mara, softly: "You said you'd be gone."` or
// `Mara sings, warm and low: "Hold me till the morning."` (what the writer, or you, wrote).

/** Words a person can say in a clip: about 2.4 a second after a short lead-in; singing is slower. */
export function wordBudget(seconds, sung = false) {
  const s = Math.max(1, Number(seconds) || 5);
  return Math.max(2, Math.floor(Math.max(1, s - 1) * (sung ? 1.9 : 2.4)));
}

const SUNG = /\b(sings?|sung|singing|croons?|raps?|hums?)\b/i;
const strip = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const wordsIn = (s) => strip(s).split(' ').filter(Boolean).length;

/** [{ who, how, sung, line }] from the lines of a shot's `says` text. Lines that don't fit the pattern are kept as plain words. */
export function parseSays(text) {
  return String(text ?? '')
    .split('\n')
    .map((raw) => strip(raw))
    .filter(Boolean)
    .map((row) => {
      const m = /^([^:"“”]{1,80}?)\s*:\s*["“”]?(.+?)["“”]?$/.exec(row);
      if (!m) return { who: '', how: '', sung: false, line: row.replace(/^["“”]|["“”]$/g, '') };
      const [head, ...rest] = m[1].split(',');
      const sung = SUNG.test(head);
      return {
        who: strip(head.replace(SUNG, '').replace(/\s+/g, ' ')),
        how: strip(rest.join(',')),
        sung,
        line: strip(m[2]),
      };
    })
    .filter((u) => u.line);
}

/** The lines that fit the time: whole lines in order, never cut in the middle (a line is never reworded). The first always stays. */
export function fitLines(lines, seconds) {
  const out = [];
  let used = 0;
  for (const u of lines) {
    const cost = wordsIn(u.line);
    if (out.length && used + cost > wordBudget(seconds, u.sung || out.some((x) => x.sung))) break;
    out.push(u);
    used += cost;
  }
  return out;
}

const q = (line) => `"${line.replace(/"/g, "'")}"`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stop = (s) => strip(s).replace(/[.!?:;,\s]+$/, '') + '.';
const SOUND_FREE = new Set(['music', 'quiet']);

/**
 * LTX-2.3: one paragraph. Look and lead first (what stays the same), then the action with its camera
 * move, then each spoken or sung line in quotes with its voice, then the sound.
 */
export function ltxPrompt({ look = '', lead = '', action = '', says = '', sound = 'shots', seconds = 5 }) {
  const lines = SOUND_FREE.has(sound) ? [] : fitLines(parseSays(says), seconds);
  const speech = lines.map((u, i) => {
    const who = u.who || (lines.length > 1 ? (i ? 'The other voice' : 'A voice') : 'The voice');
    const verb = u.sung ? 'sings' : i && !u.who ? 'replies' : 'says';
    return `${cap(who)} ${verb}${u.how ? ` ${u.how}` : ''}, ${q(u.line)}`;
  });
  const sung = lines.some((u) => u.sung);
  const audio =
    sound === 'quiet'
      ? ''
      : sound === 'music'
        ? 'The audio is instrumental music only, with no speech or singing.'
        : lines.length
          ? sung
            ? 'The audio is the sung vocal over its backing music, close and clear, with light room ambience.'
            : 'The audio is clear spoken dialogue over natural room tone and ambient sound that fit the scene.'
          : 'The audio is natural ambient sound and effects that fit the scene, with no speech.';
  return [
    look && stop(look),
    lead && stop(`The lead: ${strip(lead)}`),
    stop(action),
    speech.length && speech.map(stop).join(' Then '),
    audio,
    'No on-screen text, subtitles or logos.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Where each line lands in the clip: in order, sized by its words, starting just after the clip opens. */
export function lineTimes(lines, seconds) {
  const total = Math.max(2, Number(seconds) || 5);
  const rate = (u) => (u.sung ? 1.9 : 2.4);
  let t = 0.5;
  const raw = lines.map((u) => {
    const d = Math.max(1.2, wordsIn(u.line) / rate(u));
    const at = [t, t + d];
    t += d + 0.4;
    return at;
  });
  const end = raw.length ? raw[raw.length - 1][1] : 0;
  const k = end > total - 0.3 ? (total - 0.3) / end : 1;
  const r = (x) => Math.round(x * k * 2) / 2;
  return raw.map(([a, b]) => [r(a), Math.max(r(a) + 1, r(b))]);
}

/**
 * MiniMax H3: Roles (only when a start and end picture are used), Beats with timings, Look, Sound,
 * Limits. Each spoken or sung line says who, when and how, in the Sound block; words are left exactly
 * as written.
 */
export function h3Prompt({ look = '', lead = '', action = '', says = '', sound = 'shots', seconds = 5, keyframes = false }) {
  const S = Math.max(2, Math.round(Number(seconds) || 5));
  const lines = SOUND_FREE.has(sound) ? [] : fitLines(parseSays(says), S);
  const times = lineTimes(lines, S);
  const soundLines = [];
  if (sound === 'quiet') soundLines.push('Silent: no speech, music or effects.');
  else if (sound === 'music') soundLines.push('Instrumental music only that fits the mood, from the first second. No speech or singing.');
  else {
    soundLines.push('Natural ambient sound and effects that fit the scene, throughout.');
    lines.forEach((u, i) => {
      const [a, b] = times[i];
      const who = cap(u.who || (lines.length > 1 ? `Voice ${i + 1}` : 'The voice'));
      soundLines.push(`${who}, ${a} to ${b}s, ${u.sung ? 'sings' : 'says'}${u.how ? ` ${u.how}` : ''}: ${q(u.line)}`);
    });
    if (!lines.length) soundLines.push('No one speaks or sings.');
  }
  const limits = ['No subtitles, no on-screen text, no watermark.'];
  if (lines.length) limits.unshift('Every spoken or sung word is exactly as written, and ends before the clip does.');
  return [
    keyframes ? 'Roles: the shot opens on the start picture and ends on the end picture, and moves naturally from one to the other.' : '',
    `Beats:\n0 to ${S}s: ${stop(action)}`,
    look || lead ? `Look: ${[look && stop(look), lead && stop(`The lead: ${strip(lead)}`)].filter(Boolean).join(' ')}` : '',
    `Sound: ${soundLines.join(' ')}`,
    `Limits: ${limits.join(' ')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The prompt for a shot, written for the maker that will make it. */
export function shotPromptFor(maker, args) {
  return maker === 'h3-max' ? h3Prompt(args) : ltxPrompt(args);
}
