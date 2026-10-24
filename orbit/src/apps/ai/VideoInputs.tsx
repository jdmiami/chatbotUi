import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/components';
import { Censor } from '../../ui/Censor';
import { AiError, type LocalAi } from '../../services/ai/LocalAi';
import { recorderType } from './VoiceMode';
import { GalleryPick } from '../make/GalleryPick';
import type { GalleryMedia } from './Gallery';

/**
 * What the video makers work from, besides words: a video (from the gallery, or one you send) and a
 * voice or song (a file, or recorded here). Files go to the AI machine as soon as they are picked, so
 * making starts at once; the machine keeps them for a day.
 */

/** A video to work on: a gallery video (by id; the machine has the file) or one you sent (upload id). */
export interface VideoPick {
  src: string;
  item?: string;
  upload?: string;
  /** Blurred like its gallery tile (the machine's NSFW check, or its words). */
  nsfw: boolean;
  label: string;
}
export interface AudioPick {
  upload: string;
  src: string;
  label: string;
}

export const VIDEO_MAX = 200 * 1024 * 1024;
export const AUDIO_MAX = 30 * 1024 * 1024;
const VIDEO_TYPES = 'video/mp4,video/quicktime,video/webm';
const AUDIO_TYPES = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/m4a,audio/aac,audio/webm,audio/ogg';
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

async function send(ai: LocalAi, file: Blob, max: number, what: string) {
  if (file.size > max) throw new AiError(`That ${what} is too large (${mb(max)} at most).`, 413);
  return ai.uploadStudioMedia(file);
}

export function VideoSource({
  ai,
  value,
  onChange,
  onError,
  hint,
  gallery,
}: {
  ai: LocalAi;
  value: VideoPick | null;
  onChange: (v: VideoPick | null) => void;
  onError: (message: string) => void;
  hint?: string;
  /** Your gallery: "From your gallery" picks one of your videos (the machine has the file). */
  gallery?: GalleryMedia[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await send(ai, file, VIDEO_MAX, 'video');
      onChange({ src: URL.createObjectURL(file), upload: up.id, nsfw: false, label: file.name });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-media-pick">
      {value ? (
        <div className="ai-media-chosen">
          <Censor as="div" className="ai-media-thumb" markId={value.item} nsfw={value.nsfw}>
            <video src={value.item ? `${value.src}#t=0.1` : value.src} muted playsInline preload="metadata" aria-label="Video to work on" />
          </Censor>
          <span className="ai-muted">{value.item ? 'From your gallery.' : 'Your video.'} The maker uses up to its first seconds.</span>
          <IconButton icon="close" label="Remove the video" onClick={() => onChange(null)} />
        </div>
      ) : (
        <>
          <div className="ai-media-buttons">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => input.current?.click()}>
              <Icon name="film" size={18} /> {busy ? 'Sending the video…' : 'Add a video'}
            </button>
            {gallery && (
              <button type="button" className="btn ghost" aria-expanded={browsing} onClick={() => setBrowsing((v) => !v)}>
                <Icon name="layers" size={18} /> From your gallery
              </button>
            )}
          </div>
          {gallery && browsing && (
            <GalleryPick
              items={gallery}
              kind="video"
              label="Pick a video from your gallery"
              onPick={(m) => {
                onChange({ src: m.url, item: m.id, nsfw: m.nsfw, label: m.label });
                setBrowsing(false);
              }}
            />
          )}
          <span className="ai-muted">{hint ?? 'MP4, MOV or WebM, up to 200 MB.'}</span>
        </>
      )}
      <input
        ref={input}
        type="file"
        accept={VIDEO_TYPES}
        hidden
        aria-label="Video file"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

const RECORD_MAX_S = 20;

export function AudioSource({ ai, value, onChange, onError }: { ai: LocalAi; value: AudioPick | null; onChange: (v: AudioPick | null) => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<{ stop: () => void; started: number } | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recording]);
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const use = async (file: Blob, label: string) => {
    setBusy(true);
    try {
      const up = await send(ai, file, AUDIO_MAX, 'sound file');
      onChange({ upload: up.id, src: URL.createObjectURL(file), label });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const record = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return onError('Allow the microphone for this site to record your voice.');
    }
    const type = recorderType();
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(timer);
      setRecording(null);
      const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
      if (blob.size) void use(blob, 'Your recording');
    };
    const stop = () => rec.state !== 'inactive' && rec.stop();
    const timer = setTimeout(stop, RECORD_MAX_S * 1000);
    rec.start();
    setNow(Date.now());
    setRecording({ stop, started: Date.now() });
  };

  const secs = recording ? Math.min(RECORD_MAX_S, Math.floor((now - recording.started) / 1000)) : 0;
  return (
    <div className="ai-media-pick">
      {value ? (
        <div className="ai-media-chosen">
          <audio src={value.src} controls aria-label="Voice or song" />
          <IconButton icon="close" label="Remove the sound" onClick={() => onChange(null)} />
        </div>
      ) : recording ? (
        <button type="button" className="btn primary" onClick={() => recording.stop()}>
          <Icon name="stop" size={18} /> Stop recording · 0:{String(secs).padStart(2, '0')}
        </button>
      ) : (
        <div className="ai-media-buttons">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="speaker" size={18} /> {busy ? 'Sending…' : 'Add a voice or song'}
          </button>
          {canRecord && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void record()}>
              <Icon name="mic" size={18} /> Record
            </button>
          )}
        </div>
      )}
      {!value && !recording && <span className="ai-muted">MP3, M4A or WAV. The video is as long as the sound (up to about 19 s).</span>}
      <input
        ref={input}
        type="file"
        accept={AUDIO_TYPES}
        hidden
        aria-label="Sound file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void use(f, f.name);
          e.target.value = '';
        }}
      />
    </div>
  );
}
