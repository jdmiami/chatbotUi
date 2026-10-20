import { useId } from 'react';

/**
 * Orbit's app icons: one drawing per app, all from the same family (a rounded tile with a deep
 * two-tone gradient, a light glyph, a soft top highlight and an inner rim). Scales cleanly from the
 * index (28 px) to an app's cover page (160 px).
 */
export type ArtId =
  | 'terminal'
  | 'editor'
  | 'agent'
  | 'ai'
  | 'store'
  | 'soreal'
  | 'settings'
  | 'playground'
  | 'vscode'
  | 'desktop'
  | 'windows';

const TILES: Record<ArtId, [string, string, string?]> = {
  terminal: ['#2a3142', '#0b0e16'],
  editor: ['#5b6cff', '#1d2690'],
  agent: ['#19c3a6', '#0a4f6e'],
  ai: ['#9b6bff', '#2563eb', '#06b6d4'],
  store: ['#f5c16c', '#d9663a', '#6d2a5c'],
  soreal: ['#ff6a6a', '#c2185b', '#4a148c'],
  settings: ['#9aa3b6', '#454c5f'],
  playground: ['#ffb547', '#f0517a'],
  vscode: ['#3aa0ff', '#0b4fa8'],
  desktop: ['#f0743e', '#6b2457'],
  windows: ['#5ad1ff', '#1666d6'],
};

const INK = '#fffaf2';

function Glyph({ id, uid }: { id: ArtId; uid: string }) {
  switch (id) {
    case 'terminal':
      return (
        <g fill="none" stroke="#7dffb0" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="22" y="27" width="56" height="46" rx="7" stroke="rgb(255 255 255 / 0.22)" strokeWidth="3" />
          <path d="M33 42l10 8-10 8" />
          <path d="M49 60h16" stroke={INK} />
        </g>
      );
    case 'editor':
      return (
        <g fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M38 34L24 50l14 16" />
          <path d="M62 34l14 16-14 16" />
          <path d="M55 28L45 72" stroke="#c7cdff" />
        </g>
      );
    case 'agent':
      return (
        <g fill="none" strokeLinecap="round">
          <ellipse cx="50" cy="56" rx="28" ry="10" stroke="rgb(255 255 255 / 0.35)" strokeWidth="3" transform="rotate(-14 50 56)" />
          <circle cx="50" cy="44" r="13" fill="#fff6c9" />
          <path d="M50 74v8M42 76v4M58 76v4" stroke="#fff6c9" strokeWidth="4" strokeDasharray="2 5" />
          <path d="M44 41a7 7 0 0 1 6-5" stroke="#0a4f6e" strokeWidth="3" opacity="0.5" />
        </g>
      );
    case 'ai':
      return (
        <g>
          <path d="M26 33a10 10 0 0 1 10-10h28a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10H46l-12 10v-10h0a8 8 0 0 1-8-8z" fill="rgb(255 255 255 / 0.95)" />
          <path d="M50 30l3.5 8.5L62 42l-8.5 3.5L50 54l-3.5-8.5L38 42l8.5-3.5z" fill={`url(#${uid}-g)`} />
        </g>
      );
    case 'store':
      return (
        <g>
          <path d="M28 38h44l-4 38a5 5 0 0 1-5 4H37a5 5 0 0 1-5-4z" fill={INK} opacity="0.95" />
          <path d="M40 40v-8a10 10 0 0 1 20 0v8" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
          <path d="M50 50l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={`url(#${uid}-g)`} />
        </g>
      );
    case 'soreal':
      return (
        <g>
          <rect x="22" y="30" width="56" height="40" rx="6" fill="none" stroke={INK} strokeWidth="5" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={27 + i * 13} y="23" width="7" height="5" rx="1.5" fill={INK} opacity="0.8" />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <rect key={`b${i}`} x={27 + i * 13} y="72" width="7" height="5" rx="1.5" fill={INK} opacity="0.8" />
          ))}
          <path d="M45 41v18l15-9z" fill="#fff1e0" />
        </g>
      );
    case 'settings':
      return (
        <g fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round">
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            return <path key={i} d={`M${50 + Math.cos(a) * 20} ${50 + Math.sin(a) * 20}L${50 + Math.cos(a) * 28} ${50 + Math.sin(a) * 28}`} strokeWidth="8" />;
          })}
          <circle cx="50" cy="50" r="18" />
          <circle cx="50" cy="50" r="7" fill={INK} stroke="none" />
        </g>
      );
    case 'playground':
      return (
        <g>
          <path d="M42 22h16M45 22v18L30 68a6 6 0 0 0 5 9h30a6 6 0 0 0 5-9L55 40V22" fill="none" stroke={INK} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M36 60h28l5 9a3 3 0 0 1-3 4H34a3 3 0 0 1-3-4z" fill={INK} opacity="0.92" />
          <circle cx="46" cy="52" r="3" fill={INK} />
          <circle cx="56" cy="46" r="2" fill={INK} />
          <circle cx="62" cy="30" r="3.5" fill="#fff1c9" />
        </g>
      );
    case 'vscode':
      return (
        <g>
          <rect x="20" y="25" width="60" height="50" rx="7" fill="rgb(255 255 255 / 0.16)" stroke={INK} strokeWidth="3" />
          <path d="M20 35h60" stroke={INK} strokeWidth="3" />
          <circle cx="27" cy="30" r="2" fill={INK} />
          <circle cx="33" cy="30" r="2" fill={INK} />
          <path d="M28 45h18M28 53h28M34 61h20M28 69h12" stroke={INK} strokeWidth="4" strokeLinecap="round" opacity="0.9" />
          <path d="M63 47l8 8-8 8" fill="none" stroke="#bfe0ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case 'desktop':
      return (
        <g>
          <rect x="18" y="24" width="64" height="42" rx="6" fill="rgb(0 0 0 / 0.22)" stroke={INK} strokeWidth="4" />
          <rect x="26" y="32" width="24" height="16" rx="2.5" fill={INK} opacity="0.9" />
          <rect x="44" y="40" width="30" height="20" rx="2.5" fill="#ffd2b8" />
          <path d="M40 78h20M50 66v12" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        </g>
      );
    case 'windows':
      return (
        <g>
          <rect x="18" y="24" width="64" height="42" rx="6" fill="rgb(0 0 0 / 0.18)" stroke={INK} strokeWidth="4" />
          <g fill={INK}>
            <rect x="38" y="33" width="11" height="11" rx="1.5" />
            <rect x="51" y="33" width="11" height="11" rx="1.5" opacity="0.85" />
            <rect x="38" y="46" width="11" height="11" rx="1.5" opacity="0.85" />
            <rect x="51" y="46" width="11" height="11" rx="1.5" opacity="0.7" />
          </g>
          <path d="M40 78h20M50 66v12" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        </g>
      );
  }
}

export function AppArt({ id, size = 64, className = '' }: { id: ArtId; size?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [a, b, c] = TILES[id];
  return (
    <svg className={`app-art ${className}`} data-app={id} width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${uid}-t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          {c ? <stop offset="0.55" stopColor={b} /> : null}
          <stop offset="1" stopColor={c ?? b} />
        </linearGradient>
        <linearGradient id={`${uid}-h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="96" height="96" rx="24" fill={`url(#${uid}-t)`} />
      <rect x="2" y="2" width="96" height="96" rx="24" fill={`url(#${uid}-h)`} />
      <Glyph id={id} uid={uid} />
      <rect x="2.75" y="2.75" width="94.5" height="94.5" rx="23.25" fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="1.5" />
    </svg>
  );
}
