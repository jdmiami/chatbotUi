import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { Sheet, Toggle } from '../../ui/components';
import { Censor, shows, useNsfwView } from '../../ui/Censor';
import { nsfwFor, setMark, useNsfwFlags } from '../../ui/nsfwFlags';

/**
 * The gallery: a grid of picture and video tiles, and the viewer sheet a tile opens. Every gallery
 * uses these two (Make, the cloud, the Lab, the Gallery app), so they all behave the same: NSFW ones
 * stay hidden until "Show NSFW" is on and then blur until held, a long hold marks one NSFW, the
 * viewer's "NSFW" switch marks or unmarks one, a swipe goes to the next one, and videos play in the
 * same player (ViewerVideo).
 *
 * Tiles load the small thumbnail (`thumbUrl`, a WebP the AI machine makes: about 50 KB) for pictures and
 * videos alike, never the file itself; only an item without one yet falls back to its file. The viewer
 * loads the whole file, and once it has, the one before and after too, so a swipe is instant.
 */
export interface GalleryMedia {
  id: string;
  kind: 'image' | 'video';
  /** Absolute link to the file. */
  url: string;
  /** What it shows (the prompt or the title): read out for the tile, and checked by the blur. */
  label: string;
  /** NSFW unless you said otherwise: its words, the machine's check. */
  nsfw: boolean;
  seconds?: number;
  /** Its small picture for the grid (unset: the grid falls back to the file). */
  thumbUrl?: string;
  /** Its size, for the tile's shape before anything has loaded. */
  width?: number;
  height?: number;
}

/** About how many tiles the first screen holds (iPad landscape): those load first, the rest as you scroll. */
const FIRST_SCREEN = 12;

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
  const view = useNsfwView();
  const shown = items.filter((it) => shows(nsfwFor(it.id, it.nsfw), view));
  const hidden = items.length - shown.length;
  // Thumbnails that would not load: those tiles use the file instead.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const thumbBroke = (id: string) => setBroken((b) => (b.has(id) ? b : new Set(b).add(id)));
  if (items.length > 0 && shown.length === 0) return <p className="ai-muted">{hidden === 1 ? 'One NSFW result is hidden.' : `${hidden} NSFW results are hidden.`} Turn on "Show NSFW" in Settings to see them.</p>;
  return (
    <ul className="ai-gallery" aria-label={label}>
      {shown.map((it, n) => (
        <li key={it.id} style={{ '--i': Math.min(n, 14) } as React.CSSProperties}>
          <Censor as="div" markId={it.id} nsfw={it.nsfw}>
            <button
              type="button"
              className="ai-tile"
              onClick={(e) => onOpen(it, (e.currentTarget.querySelector('img, video') ?? e.currentTarget).getBoundingClientRect())}
              aria-label={`${it.kind === 'video' ? 'Video' : 'Image'}: ${it.label}`}
            >
              <TileMedia item={it} first={n < FIRST_SCREEN} thumb={it.thumbUrl && !broken.has(it.id) ? it.thumbUrl : undefined} onThumbError={() => thumbBroke(it.id)} />
              {it.kind === 'video' && (
                <span className="ai-tile-badge">
                  <Icon name="play" size={14} /> {it.seconds ? `${Math.round(it.seconds)}s` : ''}
                </span>
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
 * What a tile shows: the thumbnail (pictures and videos alike, an <img>), else a picture's own file, else
 * (a video whose frame the AI machine has not taken yet) a light placeholder with its words: never a
 * <video> in the grid. `first`: on the first screen, so it loads at once and ahead of the rest; the
 * others wait until they are scrolled near.
 */
function TileMedia({ item, first, thumb, onThumbError }: { item: GalleryMedia; first: boolean; thumb?: string; onThumbError: () => void }) {
  const size = item.width && item.height ? { width: item.width, height: item.height } : { width: 480, height: 480 };
  const common = { alt: '', decoding: 'async' as const, loading: first ? ('eager' as const) : ('lazy' as const), fetchPriority: first ? ('high' as const) : ('auto' as const), ...size };
  if (thumb) return <DevelopImg key={thumb} src={thumb} {...common} onError={onThumbError} />;
  if (!item.url && item.kind === 'image') return <span className="ai-tile-blank" aria-hidden />;
  if (item.kind === 'image') return <DevelopImg key={item.url} src={item.url} {...common} />;
  return (
    <span className="ai-tile-poster" aria-hidden>
      <Icon name="play" size={28} />
      <span className="ai-tile-poster-words">{item.label}</span>
    </span>
  );
}

/** Load a picture ahead (the viewer's next and previous): the browser keeps it, so it shows at once. */
const warmed = new Set<string>();
function warm(url: string | undefined) {
  if (!url || warmed.has(url) || typeof Image === 'undefined') return;
  warmed.add(url);
  if (warmed.size > 200) warmed.delete(warmed.values().next().value as string);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

/**
 * The items a viewer can step through: the ones the grid shows (NSFW ones only with "Show NSFW"),
 * and the one before and after `id`.
 */
export function useGalleryStepper<T extends GalleryMedia>(items: T[], id: string | null | undefined) {
  useNsfwFlags();
  const view = useNsfwView();
  const shown = items.filter((it) => shows(nsfwFor(it.id, it.nsfw), view));
  const i = id ? shown.findIndex((it) => it.id === id) : -1;
  return {
    index: i,
    count: shown.length,
    prev: i > 0 ? shown[i - 1] : null,
    next: i >= 0 && i < shown.length - 1 ? shown[i + 1] : null,
  };
}

/**
 * The viewer: the picture or the video, its words, the "NSFW" switch, then what `children` adds
 * (details and actions). With `onPrev` / `onNext`, a swipe sideways (or the arrows, or the arrow
 * keys) goes to the one before or after.
 */
export function GalleryViewer({
  media,
  title,
  origin,
  onClose,
  words,
  children,
  onPrev,
  onNext,
  position,
  lockNsfw = false,
  neighbours,
}: {
  media: GalleryMedia;
  title: string;
  origin: DOMRect | null;
  onClose: () => void;
  /** The words under it (the prompt, or a title and caption). */
  words?: ReactNode;
  children?: ReactNode;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  /** "3 of 12", read out with the arrows. */
  position?: { index: number; count: number };
  /** Always blurred, and no "NSFW" switch (the owner's Held for review screen: nothing there is for marking). */
  lockNsfw?: boolean;
  /** The ones before and after: loaded ahead once this one has (a picture whole, a video its thumbnail). */
  neighbours?: (GalleryMedia | null | undefined)[];
}) {
  useNsfwFlags();
  const nsfw = lockNsfw ? true : nsfwFor(media.id, media.nsfw);
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const prevRef = useRef(onPrev);
  const nextRef = useRef(onNext);
  prevRef.current = onPrev;
  nextRef.current = onNext;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft' && prevRef.current) prevRef.current();
      else if (e.key === 'ArrowRight' && nextRef.current) nextRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Once this one is showing, the next and previous come down too, so a swipe shows them at once.
  const [ready, setReady] = useState<string | null>(null);
  const near = (neighbours ?? []).map((m) => (m ? `${m.kind}:${m.url}:${m.thumbUrl ?? ''}` : '')).join('|');
  useEffect(() => {
    if (ready !== media.id) return;
    for (const m of neighbours ?? []) {
      if (!m) continue;
      if (m.kind === 'image') warm(m.url);
      else warm(m.thumbUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, media.id, near]);
  const shown = () => setReady(media.id);
  // A picture the browser already had may finish before it is watched: go ahead after a moment anyway.
  useEffect(() => {
    const t = window.setTimeout(() => setReady(media.id), 2500);
    return () => window.clearTimeout(t);
  }, [media.id]);

  const stepping = Boolean(onPrev || onNext);
  return (
    <Sheet title={title} origin={origin} onClose={onClose}>
      <div className="ai-viewer">
        <div
          className="ai-viewer-stage"
          onPointerDown={(e) => {
            if (stepping && e.isPrimary) swipe.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
          }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x;
            const dy = e.clientY - s.y;
            // A quick sideways swipe, not a scroll and not a hold.
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5 || e.timeStamp - s.t > 900) return;
            if (dx < 0) onNext?.();
            else onPrev?.();
          }}
          onPointerCancel={() => (swipe.current = null)}
        >
          <Censor key={media.id} as="div" className="ai-viewer-media" markId={lockNsfw ? undefined : media.id} nsfw={lockNsfw ? true : media.nsfw}>
            {media.kind === 'image' ? (
              <DevelopImg key={media.url} src={media.url} alt={media.label} draggable={false} decoding="async" onLoad={shown} onError={shown} {...(media.width && media.height ? { width: media.width, height: media.height } : {})} />
            ) : (
              <ViewerVideo key={media.url} media={media} hidden={nsfw} onReady={shown} />
            )}
          </Censor>
        </div>
        {stepping && (
          <div className="ai-viewer-step">
            <button type="button" className="icon-btn" aria-label="Previous" disabled={!onPrev} onClick={() => onPrev?.()}>
              <Icon name="back" size={18} />
            </button>
            {position && position.count > 0 && (
              <span className="ai-muted" aria-live="polite">
                {position.index + 1} of {position.count}
              </span>
            )}
            <button type="button" className="icon-btn" aria-label="Next" disabled={!onNext} onClick={() => onNext?.()}>
              <Icon name="forward" size={18} />
            </button>
          </div>
        )}
        {words != null && (
          <Censor key={`w-${media.id}`} as="div" text markId={lockNsfw ? undefined : media.id} nsfw={lockNsfw ? true : media.nsfw}>
            {words}
          </Censor>
        )}
        {!lockNsfw && (
          <div className="ai-viewer-blur">
            <span className="ai-muted">{nsfw ? 'NSFW: hidden unless "Show NSFW" is on in Settings' : 'NSFW'}</span>
            <Toggle checked={nsfw} label="NSFW" onChange={(on) => setMark(media.id, on)} />
          </div>
        )}
        {children}
      </div>
    </Sheet>
  );
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * The one video player of every gallery. No browser controls over the picture: they darken the
 * first seconds and linger while you hold a blurred video. Instead a play button that is gone the
 * moment it plays, a tap to pause, and a slim bar (time, sound, full screen) that shows while
 * paused and briefly after a tap. It starts by itself where the browser allows it, never while it
 * is blurred (`hidden`): then holding it plays it (Censor), and letting go pauses it.
 */
export function ViewerVideo({ media, hidden, onReady }: { media: GalleryMedia; hidden: boolean; onReady?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(media.seconds ?? 0);
  const [muted, setMuted] = useState(false);
  const [bar, setBar] = useState(false);
  const barTimer = useRef<number | null>(null);

  const showBar = useCallback((ms = 1800) => {
    setBar(true);
    if (barTimer.current != null) window.clearTimeout(barTimer.current);
    barTimer.current = window.setTimeout(() => setBar(false), ms);
  }, []);
  useEffect(() => () => void (barTimer.current != null && window.clearTimeout(barTimer.current)), []);

  // Straight away, as the viewer opens (still inside the tap that opened it, so the sound may play).
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v || hidden) return;
    void v.play().catch(() => {
      /* the browser wants a tap first: the play button shows */
    });
    // Only when it opens: becoming hidden later pauses it (Censor), it never starts by itself again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      // Called right in the tap, so iPhone plays it with sound.
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  };
  const fullScreen = () => {
    const v = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    else void v.requestFullscreen?.().catch(() => {});
  };
  const showChrome = !playing || bar;

  return (
    <div className="ai-player" data-playing={playing ? '' : undefined} data-chrome={showChrome ? '' : undefined}>
      <video
        ref={ref}
        src={firstFrame(media.url)}
        // Its thumbnail while the video itself comes down (blurred with it when it is NSFW).
        poster={media.thumbUrl}
        playsInline
        preload="auto"
        aria-label={media.label}
        muted={muted}
        onClick={() => {
          toggle();
          showBar();
        }}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
        }}
        onPlaying={() => setWaiting(false)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => {
          setWaiting(false);
          onReady?.();
        }}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
      />
      {!playing && (
        <button type="button" className="ai-player-big" aria-label={ended ? 'Play again' : 'Play video'} onClick={toggle}>
          <Icon name={ended ? 'refresh' : 'play'} size={28} />
        </button>
      )}
      {playing && waiting && <span className="ai-player-wait" role="status" aria-label="Loading" />}
      <div className="ai-player-bar" aria-hidden={!showChrome || undefined}>
        <button type="button" className="ai-player-btn" aria-label={playing ? 'Pause' : 'Play'} tabIndex={showChrome ? 0 : -1} onClick={toggle}>
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <input
          type="range"
          className="ai-player-seek"
          aria-label="Position in the video"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          tabIndex={showChrome ? 0 : -1}
          onChange={(e) => {
            const v = ref.current;
            if (v) v.currentTime = Number(e.target.value);
            setTime(Number(e.target.value));
            showBar(2500);
          }}
        />
        <span className="ai-player-time">
          {clock(time)} / {clock(duration)}
        </span>
        <button type="button" className="ai-player-btn" aria-label={muted ? 'Sound on' : 'Sound off'} tabIndex={showChrome ? 0 : -1} onClick={() => setMuted((m) => !m)}>
          <Icon name={muted ? 'speakerOff' : 'speaker'} size={16} />
        </button>
        <button type="button" className="ai-player-btn" aria-label="Full screen" tabIndex={showChrome ? 0 : -1} onClick={fullScreen}>
          <Icon name="expand" size={16} />
        </button>
      </div>
    </div>
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
  const { onLoad, onError, ...rest } = props;
  return (
    <img
      {...rest}
      ref={ref}
      className="ai-dev"
      data-loaded={loaded}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      onError={(e) => {
        setLoaded(true);
        onError?.(e);
      }}
    />
  );
}
