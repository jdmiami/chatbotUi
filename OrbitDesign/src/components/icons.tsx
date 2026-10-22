/**
 * Line icons: thin square-cut drawings in a square frame, like the marks in a magazine's contents.
 * No rounded corners anywhere.
 */
const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h10',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M14 5l-7 7 7 7M7 12h13',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 14h8',
  options: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
  picture: 'M3.5 5.5h17v13h-17zM3.5 15l5-4 4 3 3-2 5 4',
  video: 'M3.5 6.5h12v11h-12zM15.5 10.5l5-3v9l-5-3',
  reel: 'M3.5 4.5h17v15h-17zM7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4',
  folder: 'M3.5 6.5h7l2 2h8v10h-17z',
  person: 'M8.5 3.5h7v7h-7zM4.5 20.5v-4h15v4',
  talk: 'M4 5h16v10H9l-5 4z',
  mic: 'M9 4h6v9H9zM5 11v2h0a7 7 0 0 0 14 0v-2M12 20v-0',
  shuffle: 'M4 7h4l8 10h4M4 17h4l2.5-3M14 10l2-3h4M18 4l2 3-2 3M18 14l2 3-2 3',
  forward: 'M4 6l7 6-7 6zM13 6l7 6-7 6z',
  plus: 'M12 5v14M5 12h14',
} as const;

export type IconName = keyof typeof PATHS;

export function SqIcon({ name, framed = false, label }: { name: IconName; framed?: boolean; label?: string }) {
  const svg = (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
  return framed ? <span className="st-ico">{svg}</span> : svg;
}
