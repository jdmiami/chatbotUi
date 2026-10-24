import { useState } from 'react';
import { Censor } from '../../ui/Censor';
import type { GalleryMedia } from '../ai/Gallery';
import './gallerypick.css';

/**
 * "From your gallery": your pictures (or videos) in a row you swipe through; tap one to use it in
 * place of an upload. Newest first. Blurred ones stay blurred, as in the gallery.
 */
export function GalleryPick({ items, kind, label, onPick }: { items: GalleryMedia[]; kind: 'image' | 'video'; label: string; onPick: (m: GalleryMedia) => Promise<void> | void }) {
  const list = items.filter((m) => m.kind === kind);
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (m: GalleryMedia) => {
    if (busy) return;
    setBusy(m.id);
    try {
      await onPick(m);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="gal-pick" data-testid="gallery-pick">
      <p className="o5-kicker">{label}</p>
      {list.length ? (
        <ul className="gal-pick-row" aria-label={label}>
          {list.map((m) => (
            <li key={m.id}>
              <button type="button" className="gal-pick-tile" aria-label={`Use: ${m.label || (kind === 'image' ? 'a picture' : 'a video')}`} aria-busy={busy === m.id} disabled={Boolean(busy)} onClick={() => void pick(m)}>
                <Censor as="span" className="gal-pick-media" markId={m.id} nsfw={m.nsfw}>
                  {kind === 'image' || m.thumbUrl ? (
                    <img src={m.thumbUrl ?? m.url} alt="" loading="lazy" decoding="async" draggable={false} />
                  ) : (
                    <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" />
                  )}
                </Censor>
                {kind === 'video' && m.seconds ? <span className="gal-pick-len">{Math.round(m.seconds)} s</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ai-muted">{kind === 'image' ? 'No pictures in your gallery yet.' : 'No videos in your gallery yet.'}</p>
      )}
    </div>
  );
}
