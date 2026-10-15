/**
 * Finds web addresses in terminal text, for the Terminal's "Open link" bar (e.g. a CLI's
 * sign-in link). Only http(s) addresses count, so a printed "javascript:" or "file:" can never
 * be opened from here.
 */
const URL_RE = /https?:\/\/[^\s"'<>`\\]+/g;

/**
 * Programs often break a long address over several lines at the terminal's width. Rejoin a line
 * that fills the width and ends mid-word with the next line when that line starts with a word.
 */
function unwrap(text: string, cols: number): string {
  const out: string[] = [];
  let prevLine: string | null = null; // the previous screen line (before any joining)
  for (const line of text.split('\n')) {
    // A line whose last screen row is exactly full (some programs break one column early).
    // A longer line that tmux already rejoined usually ends part-way through a row, so it's left alone.
    const rem = prevLine ? prevLine.length % cols : -1;
    if (prevLine && cols > 0 && (rem === 0 || rem === cols - 1) && /\S$/.test(prevLine) && /^\S/.test(line)) {
      out[out.length - 1] += line;
    } else {
      out.push(line);
    }
    prevLine = line;
  }
  return out.join('\n');
}

/** The last http(s) address in the text, or null. */
export function lastLink(text: string, cols = 0): string | null {
  const matches = unwrap(text, cols).match(URL_RE);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const url = matches[i].replace(/[).,;:!?\]}'"]+$/, '');
    try {
      const u = new URL(url);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname) return url;
    } catch {
      /* not a usable address; try an earlier one */
    }
  }
  return null;
}

/** The address itself if it is a usable http(s) link (e.g. from an OSC 8 hyperlink), else null. */
export function webLink(uri: string): string | null {
  try {
    const u = new URL(uri);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? uri : null;
  } catch {
    return null;
  }
}

/** Short form for display: host and the start of the path. */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const rest = `${u.pathname}${u.search}`;
    return rest.length > 1 ? `${u.host}${rest}` : u.host;
  } catch {
    return url;
  }
}
