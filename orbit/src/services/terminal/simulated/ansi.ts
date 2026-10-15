/** Small ANSI / terminal text helpers for the simulated shell. */

export const ESC = '\x1b';
export const CSI = '\x1b[';

export const style = {
  reset: '\x1b[0m',
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[39m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  boldGreen: (s: string) => `\x1b[1;32m${s}\x1b[0m`,
  boldBlue: (s: string) => `\x1b[1;34m${s}\x1b[0m`,
  boldRed: (s: string) => `\x1b[1;31m${s}\x1b[0m`,
};

/** Erase the whole screen, move home, and drop the scrollback (what `clear` does on Ubuntu). */
export const CLEAR_SCREEN = '\x1b[2J\x1b[H\x1b[3J';

// CSI sequences, OSC sequences (BEL or ST terminated) and two-byte escapes.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** Terminal cell width of one code point (wide East Asian / emoji = 2, combining marks = 0). */
export function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  // Combining marks and zero-width joiners / variation selectors.
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0x20d0 && cp <= 0x20ff)
  ) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Visible width of a string in terminal cells (ANSI sequences ignored). */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of stripAnsi(text)) w += charWidth(ch.codePointAt(0) ?? 0);
  return w;
}

/** Terminals need CR+LF; command output is written with plain LF. */
export function toCRLF(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/** Pad to a visible width (ANSI-aware). */
export function padEnd(text: string, width: number): string {
  const w = displayWidth(text);
  return w >= width ? text : text + ' '.repeat(width - w);
}

/**
 * Lay out names in columns, column-major like GNU `ls`, fitting `cols` terminal cells.
 * `names` may contain ANSI colour; widths are measured without it.
 */
export function columns(names: string[], cols: number, gap = 2): string {
  if (names.length === 0) return '';
  const widths = names.map(displayWidth);
  const maxCols = Math.max(1, cols);
  for (let ncols = Math.min(names.length, Math.floor(maxCols / (1 + gap)) || 1); ncols >= 1; ncols--) {
    const nrows = Math.ceil(names.length / ncols);
    const colWidths: number[] = [];
    for (let c = 0; c < ncols; c++) {
      let max = 0;
      for (let r = 0; r < nrows; r++) {
        const i = c * nrows + r;
        if (i < names.length) max = Math.max(max, widths[i]);
      }
      colWidths.push(max);
    }
    const total = colWidths.reduce((a, b) => a + b, 0) + gap * (ncols - 1);
    if (total <= maxCols || ncols === 1) {
      const lines: string[] = [];
      for (let r = 0; r < nrows; r++) {
        let line = '';
        for (let c = 0; c < ncols; c++) {
          const i = c * nrows + r;
          if (i >= names.length) continue;
          const isLast = c === ncols - 1 || (c + 1) * nrows + r >= names.length;
          line += isLast ? names[i] : padEnd(names[i], colWidths[c] + gap);
        }
        lines.push(line);
      }
      return lines.join('\n') + '\n';
    }
  }
  return names.join('\n') + '\n';
}
