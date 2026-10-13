// Minimal helpers for the Guacamole protocol.
// An instruction looks like: 6.select,3.rdp;  (LENGTH.VALUE, comma separated, ';' terminated)
// Lengths are counted in Unicode code points, as guacd does.

export function encodeInstruction(opcode, ...args) {
  return [opcode, ...args]
    .map((value) => {
      const str = value === null || value === undefined ? '' : String(value);
      return `${[...str].length}.${str}`;
    })
    .join(',') + ';';
}

// Incremental parser. Feed it text, it returns complete instructions and keeps the remainder.
export class InstructionParser {
  constructor() {
    this.buffer = '';
  }

  // Returns { instructions: string[][], raw: string } where `raw` is the text of every
  // complete instruction found (ready to forward), and the incomplete tail is kept.
  push(text) {
    this.buffer += text;
    const instructions = [];
    let cursor = 0;
    let elements = [];
    let lastComplete = 0;

    while (cursor < this.buffer.length) {
      const dot = this.buffer.indexOf('.', cursor);
      if (dot === -1) break;
      const lenStr = this.buffer.slice(cursor, dot);
      if (!/^\d+$/.test(lenStr)) throw new Error('Malformed instruction length');
      const length = Number(lenStr);

      // Advance `length` code points from dot+1.
      let end = dot + 1;
      let count = 0;
      while (count < length && end < this.buffer.length) {
        const cp = this.buffer.codePointAt(end);
        end += cp > 0xffff ? 2 : 1;
        count++;
      }
      if (count < length || end >= this.buffer.length) break; // need more data (incl. terminator)

      elements.push(this.buffer.slice(dot + 1, end));
      const terminator = this.buffer[end];
      cursor = end + 1;

      if (terminator === ';') {
        instructions.push(elements);
        elements = [];
        lastComplete = cursor;
      } else if (terminator !== ',') {
        throw new Error('Malformed instruction terminator');
      }
    }

    const raw = this.buffer.slice(0, lastComplete);
    this.buffer = this.buffer.slice(lastComplete);
    return { instructions, raw };
  }
}
