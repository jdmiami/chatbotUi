import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audioArgs, clipArgs, fitSize, ltxFrames, probeMedia, readProbe, shapeOf, uploadType, vaceFrames } from '../src/media.js';
import { runFfmpeg } from '../src/movies.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('media: sizes keep the shape in multiples of 16, frame counts fit each model', () => {
  assert.deepEqual(fitSize(1920, 1080), [1280, 720]);
  assert.deepEqual(fitSize(1080, 1920), [720, 1280]);
  assert.deepEqual(fitSize(640, 360), [1280, 720], 'small clips are enlarged to fill the box');
  assert.deepEqual(fitSize(640, 360, { enlarge: false }), [640, 368], 'unless asked not to (multiples of 16)');
  assert.deepEqual(fitSize(1000, 1000), [720, 720]);
  for (const [w, h] of [fitSize(1366, 768), fitSize(333, 777), fitSize(4000, 3000)]) assert.ok(w % 16 === 0 && h % 16 === 0);
  assert.deepEqual(['landscape', 'portrait', 'square'], [shapeOf(1280, 720), shapeOf(720, 1280), shapeOf(1000, 1100)]);
  assert.equal(vaceFrames(10), 81, 'VACE: at most 81 frames');
  assert.equal(vaceFrames(2), 29, '4k + 1 frames at 16 fps');
  assert.ok(vaceFrames(0.1) < 5, 'too short to use');
  assert.equal(ltxFrames(10, 241), 233, '8k + 1 frames at 24 fps');
  assert.equal(ltxFrames(30, 241), 241);
  assert.equal((ltxFrames(3.3, 241) - 1) % 8, 0);
});

test('media: ffprobe output in plain numbers; uploads must be a video or a sound', () => {
  const p = readProbe({
    streams: [
      { codec_type: 'video', width: 1280, height: 720, avg_frame_rate: '25/1', r_frame_rate: '25/1' },
      { codec_type: 'audio' },
    ],
    format: { duration: '5.04' },
  });
  assert.deepEqual(p, { video: true, audio: true, width: 1280, height: 720, fps: 25, seconds: 5.04 });
  assert.deepEqual(readProbe({ streams: [{ codec_type: 'audio' }], format: { duration: '3' } }), { video: false, audio: true, width: 0, height: 0, fps: 0, seconds: 3 });
  assert.deepEqual(uploadType('video/quicktime'), ['video', '.mov']);
  assert.deepEqual(uploadType('audio/mp4; codecs=mp4a.40.2'), ['audio', '.m4a']);
  assert.throws(() => uploadType('image/png'), (e) => e.status === 415);
  assert.throws(() => uploadType('application/x-sh'), /MP4, MOV or WebM/);
});

test('media: clip arguments set the frame rate, size, frame count and always a sound track', () => {
  const a = clipArgs('in.mov', 'out.mp4', { width: 1280, height: 720, fps: 16, frames: 81, seconds: 81 / 16, hasAudio: false });
  assert.equal(a[a.indexOf('-vf') + 1], 'fps=16,scale=1280:720,setsar=1,format=yuv420p');
  assert.equal(a[a.indexOf('-frames:v') + 1], '81');
  assert.ok(a.includes('anullsrc=channel_layout=stereo:sample_rate=48000'), 'silence when the clip has none');
  assert.equal(a[a.indexOf('-t') + 1], String(81 / 16));
  const b = clipArgs('in.mp4', 'out.mp4', { width: 704, height: 1280, fps: 24, seconds: 5, fit: 'cover' });
  assert.match(b[b.indexOf('-vf') + 1], /force_original_aspect_ratio=increase,crop=704:1280/);
  assert.equal(b[b.indexOf('-map', b.indexOf('-map') + 1) + 1], '0:a:0', 'its own sound');
  assert.deepEqual(audioArgs('a.m4a', 'a.wav', { seconds: 19 }).slice(-9), ['-t', '19', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', 'a.wav']);
});

test('media: a real clip comes out at the exact size, rate and length, with sound', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-'));
  const src = path.join(dir, 'in.mp4');
  // 3 s, 25 fps, 640 x 360, no sound.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '3', '-pix_fmt', 'yuv420p', src]);
  const info = await probeMedia(src);
  assert.deepEqual([info.video, info.audio, info.width, info.height, info.fps], [true, false, 640, 360, 25]);
  const frames = vaceFrames(info.seconds);
  assert.equal(frames, 45);
  const [w, h] = fitSize(info.width, info.height);
  const out = path.join(dir, 'out.mp4');
  await runFfmpeg(clipArgs(src, out, { width: w, height: h, fps: 16, frames, seconds: frames / 16, hasAudio: info.audio }));
  const got = await probeMedia(out);
  assert.deepEqual([got.width, got.height, got.fps, got.audio], [1280, 720, 16, true]);
  const count = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim();
  assert.equal(Number(count), 45);
  assert.equal(await probeMedia(path.join(dir, 'missing.mp4')), null);
});
