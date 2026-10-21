// Videos and sounds people bring to the video makers (Wan VACE, erase, SeedVR2, LTX-2.5 video to
// video, Wan S2V): read what a file is (ffprobe), then make a clean copy at the frame rate, size and
// length the maker works with (ffmpeg), so every recipe in workflows.js gets exact numbers.
import { spawn } from 'node:child_process';

const err = (message, status = 400) => Object.assign(new Error(message), { status });

/** What a video or sound file holds: { width, height, fps, seconds, video, audio } (null when unreadable). */
export function probeMedia(file, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try {
      p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate:format=duration', '-of', 'json', file], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return resolve(null);
    }
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => {
      clearTimeout(t);
      resolve(null);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return resolve(null);
      try {
        resolve(readProbe(JSON.parse(out)));
      } catch {
        resolve(null);
      }
    });
  });
}

const rate = (r) => {
  const [a, b] = String(r || '').split('/').map(Number);
  return a > 0 && b > 0 ? a / b : a > 0 && !b ? a : 0;
};

/** ffprobe's JSON, in plain numbers. */
export function readProbe(j) {
  const streams = j?.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const seconds = Number(j?.format?.duration) || 0;
  return {
    video: Boolean(v),
    audio: Boolean(a),
    width: v ? Number(v.width) || 0 : 0,
    height: v ? Number(v.height) || 0 : 0,
    fps: v ? rate(v.avg_frame_rate) || rate(v.r_frame_rate) : 0,
    seconds,
  };
}

/** Round to a multiple of `m` (at least m). */
const toMultiple = (x, m) => Math.max(m, Math.round(x / m) * m);

/**
 * A size for a clip of `width` × `height` that fits in `long` × `short` (either way round), keeping
 * its shape, in multiples of `multiple`. Smaller clips are enlarged to fill the box too.
 */
export function fitSize(width, height, { long = 1280, short = 720, multiple = 16, enlarge = true } = {}) {
  if (!(width > 0 && height > 0)) return [toMultiple(long, multiple), toMultiple(short, multiple)];
  const landscape = width >= height;
  const [boxW, boxH] = landscape ? [long, short] : [short, long];
  let s = Math.min(boxW / width, boxH / height);
  if (!enlarge) s = Math.min(1, s);
  return [toMultiple(width * s, multiple), toMultiple(height * s, multiple)];
}

/** The shape (landscape | portrait | square) closest to a clip's. */
export function shapeOf(width, height) {
  if (!(width > 0 && height > 0)) return 'landscape';
  const r = width / height;
  return r > 1.2 ? 'landscape' : r < 1 / 1.2 ? 'portrait' : 'square';
}

/**
 * ffmpeg arguments for a clean copy of a video for a maker: `fps` frames a second (or the clip's
 * own), exactly `width` × `height` (`fit: 'cover'` crops to fill, `'stretch'` scales), at most
 * `frames` frames and `seconds` long, H.264 with a sound track (silence when the clip has none, so
 * every recipe can rely on one).
 */
export function clipArgs(input, output, { width, height, fps = null, frames = null, seconds = null, hasAudio = true, fit = 'stretch' }) {
  const vf = [
    ...(fps ? [`fps=${fps}`] : []),
    fit === 'cover' ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}` : `scale=${width}:${height}`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
  return [
    '-i', input,
    ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']),
    '-map', '0:v:0',
    '-map', hasAudio ? '0:a:0' : '1:a:0',
    '-vf', vf,
    ...(frames ? ['-frames:v', String(frames)] : []),
    // The length for the sound too (the silence never ends by itself).
    '-t', String(seconds || 30),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    output,
  ];
}

/** ffmpeg arguments for a sound file a maker can read: WAV, at most `seconds` long. */
export function audioArgs(input, output, { seconds = 20 } = {}) {
  return ['-i', input, '-vn', '-t', String(seconds), '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', output];
}

/** Frames a VACE run takes from a clip of `seconds` at 16 fps: 4k + 1, at most `max`. */
export function vaceFrames(seconds, max = 81) {
  const n = Math.floor((Number(seconds) || 0) * 16);
  return Math.min(max, Math.max(0, Math.floor((n - 1) / 4) * 4 + 1));
}

/** Frames LTX-2.5 takes from a clip of `seconds` at 24 fps: 8k + 1, at most `max`. */
export function ltxFrames(seconds, max) {
  const n = Math.floor((Number(seconds) || 0) * 24);
  return Math.min(max, Math.max(0, Math.floor((n - 1) / 8) * 8 + 1));
}

/** Uploaded files people may bring: what each content type is, and the most each may weigh. */
export const UPLOAD_TYPES = {
  'video/mp4': ['video', '.mp4'],
  'video/quicktime': ['video', '.mov'],
  'video/webm': ['video', '.webm'],
  'audio/mpeg': ['audio', '.mp3'],
  'audio/mp3': ['audio', '.mp3'],
  'audio/wav': ['audio', '.wav'],
  'audio/x-wav': ['audio', '.wav'],
  'audio/wave': ['audio', '.wav'],
  'audio/mp4': ['audio', '.m4a'],
  'audio/x-m4a': ['audio', '.m4a'],
  'audio/m4a': ['audio', '.m4a'],
  'audio/aac': ['audio', '.aac'],
  'audio/webm': ['audio', '.webm'],
  'audio/ogg': ['audio', '.ogg'],
};
export const UPLOAD_MAX = { video: 200 * 1024 * 1024, audio: 30 * 1024 * 1024 };

/** The kind and extension of an upload's content type, or an error people can act on. */
export function uploadType(contentType) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  const found = UPLOAD_TYPES[t];
  if (!found) throw err('Send an MP4, MOV or WebM video, or an MP3, WAV or M4A sound.', 415);
  return found;
}
