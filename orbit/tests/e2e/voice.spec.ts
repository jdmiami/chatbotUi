import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openOrbit } from './helpers';
import { mockAi, openAi, recordChats } from './aiMocks';

/** 1.2 s of speech-like tone, then 3 s of silence: Chromium's fake microphone plays it on a loop. */
function speechWav(): string {
  const rate = 16000;
  const samples = Math.round(rate * 4.2);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const v = t < 1.2 ? Math.sin(2 * Math.PI * 220 * t) * 0.5 * Math.sin(Math.PI * Math.min(1, t / 1.2)) : 0;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  const file = path.join(os.tmpdir(), `orbit-speech-${process.pid}.wav`);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

test.use({
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${speechWav()}`] },
});

test.describe('AI app: voice', () => {

  test('talk: your words are transcribed on the AI machine, answered, and kept in the chat', async ({ page }) => {
    await mockAi(page, 'on');
    await recordChats(page, 'It is sunny. Enjoy the day!');
    const uploads: string[] = [];
    await page.route('**/fake-ai/_orbit/voice/transcribe', (route) => {
      uploads.push(route.request().headers()['content-type'] ?? '');
      return route.fulfill({ json: { text: 'How is the weather?' } });
    });
    const errors = await openOrbit(page);
    await openAi(page);
    await page.getByRole('button', { name: 'Talk' }).click();
    const voice = page.getByRole('dialog', { name: 'Voice chat' });
    await expect(voice).toBeVisible();
    await expect(voice.getByText('“How is the weather?”')).toBeVisible({ timeout: 15_000 });
    await expect(voice.getByText('It is sunny. Enjoy the day!')).toBeVisible();
    expect(uploads[0]).toMatch(/^audio\//);
    await voice.getByRole('button', { name: 'End' }).click();
    await expect(voice).toHaveCount(0);
    await expect(page.locator('.ai-user-text').first()).toHaveText('How is the weather?');
    await expect(page.locator('.ai-msg-assistant').first()).toContainText('It is sunny.');
    expect(errors).toEqual([]);
  });
});
