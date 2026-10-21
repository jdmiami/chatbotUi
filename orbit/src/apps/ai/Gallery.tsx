import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShell } from '../../state/shell';
import { Icon } from '../../ui/Icon';
import { Sheet, Toggle } from '../../ui/components';
import { Censor } from '../../ui/Censor';
import { nsfwFor, setMark, useNsfwFlags } from '../../ui/nsfwFlags';

/**
 * The gallery: a grid of picture and video tiles, and the viewer sheet a tile opens. Used by the
 * Make tab (your creations) and the Lab (its movies), so both look and behave the same: the NSFW
 * blur with hold to see, hold a clear one to blur it, and the viewer's "Blur this one" switch.
 */
export interface GalleryMedia {
  id: string;
  kind: 'image' | 'video';
  /** Absolute link to the file. */
  url: string;
  /** What it shows (the prompt or the title): read out for the tile, and checked by the blur. */
  label: string;
  /** Blur it unless you said otherwise: its words, the machine's check. */
  nsfw: boolean;
  seconds?: number;
}

/** A video's first frame instead of black: start a tenth of a second in (iPhone shows no frame otherwise). */
const firstFrame = (url: string) => (url.includes('#') ? url : `${url}#t=0.1`);

export function GalleryGrid<T extends GalleryMedia>({
  items,
  label,
  onOpen,
  corner,
}: {
  items: T[];
  label: string;
  onOpen: (item: T, from: DOMRect) => void;
  /** Something small on a tile's corner (the Lab's score). */
  corner?: (item: T) => ReactNode;
}) {
  useNsfwFlags();
  return (
    <ul className="ai-gallery" aria-label={label}>
      {items.map((it, n) => (
        <li key={it.id} style={{ '--i': Math.min(n, 14) } as React.CSSProperties}>
          <Censor as="div" markId={it.id} nsfw={it.nsfw}>
            <button
              type="button"
              className="ai-tile"
              onClick={(e) => onOpen(it, (e.currentTarget.querySelector('img, video') ?? e.currentTarget).getBoundingClientRect())}
              aria-label={`${it.kind === 'video' ? 'Video' : 'Image'}: ${it.label}`}
            >
              {it.kind === 'image' ? (
                <DevelopImg src={it.url} alt="" loading="lazy" />
              ) : (
                <>
                  <video src={firstFrame(it.url)} muted playsInline preload="metadata" />
                  <span className="ai-tile-badge">
                    <Icon name="play" size={14} /> {it.seconds ? `${Math.round(it.seconds)}s` : ''}
                  </span>
                </>
              )}
              {corner?.(it)}
            </button>
          </Censor>
        </li>
      ))}
    </ul>
  );
}

/**
 * The viewer: the picture or the video (with controls; a blurred one plays while you hold it), its
 * words, the "Blur this one" switch, then what `children` adds (details and actions).
 */
export function GalleryViewer({
  media,
  title,
  origin,
  onClose,
  words,
  children,
}: {
  media: GalleryMedia;
  title: string;
  origin: DOMRect | null;
  onClose: () => void;
  /** The words under it (the prompt, or a title and caption), blurred with it. */
  words?: ReactNode;
  children?: ReactNode;
}) {
  useNsfwFlags();
  const censor = useShell((s) => s.settings.censor !== false);
  return (
    <Sheet title={title} origin={origin} onClose={onClose}>
      <div className="ai-viewer">
        <Censor as="div" className="ai-viewer-media" markId={media.id} nsfw={media.nsfw}>
          {media.kind === 'image' ? (
            <DevelopImg src={media.url} alt={media.label} />
          ) : (
            <video src={firstFrame(media.url)} controls playsInline autoPlay preload="metadata" aria-label={media.label} />
          )}
        </Censor>
        {words != null && (
          <Censor as="div" text markId={media.id} nsfw={media.nsfw}>
            {words}
          </Censor>
        )}
        {censor && (
          <div className="ai-viewer-blur">
            <span className="ai-muted">Blur this one (NSFW)</span>
            <Toggle checked={nsfwFor(media.id, media.nsfw)} label="Blur this one (NSFW)" onChange={(on) => setMark(media.id, on)} />
          </div>
        )}
        {children}
      </div>
    </Sheet>
  );
}

/**
 * A picture that "develops": it starts blurred and colourless and sharpens as it loads (see
 * motion.css). The final state is always a normal image, so nothing depends on the effect.
 */
export function DevelopImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, []);
  return <img {...props} ref={ref} className="ai-dev" data-loaded={loaded} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />;
}
