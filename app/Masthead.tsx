/** The magazine masthead on every site page: an Orbit kicker, a big serif title and a standfirst. */
export default function Masthead({ section, title, standfirst }: { section: string; title: string; standfirst?: string }) {
  return (
    <header className="masthead">
      <p className="kicker">
        <svg className="orbit-mark" width="16" height="16" viewBox="0 0 64 64" aria-hidden>
          <ellipse cx="32" cy="32" rx="26" ry="11" fill="none" stroke="currentColor" strokeWidth="4" transform="rotate(-25 32 32)" />
          <circle cx="32" cy="32" r="10" fill="currentColor" />
        </svg>
        <span>Orbit · {section}</span>
      </p>
      <h1>{title}</h1>
      {standfirst && <p className="standfirst">{standfirst}</p>}
    </header>
  );
}
