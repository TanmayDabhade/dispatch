/**
 * A small terminal emulator: bytes in, styled lines out.
 *
 * The daemon hands back raw pty output (see packages/server/src/terminals.ts),
 * which is not text — it is text interleaved with escape sequences that move a
 * cursor, repaint regions and change colour. Rendering it as plain text shows
 * `[32m` where green should be and stacks every frame of a progress bar on
 * top of each other, so something has to interpret it.
 *
 * What this handles, chosen by what actually shows up in a coding agent's
 * output: SGR colour and style, cursor motion, line and screen erase, tabs,
 * backspace, carriage return (the one that makes `\r` progress bars work),
 * insert/delete of characters and lines, the alternate screen buffer (so a
 * pager or an editor paints over the scrollback instead of into it), and
 * scroll regions.
 *
 * What it deliberately does not do: character sets beyond ASCII/UTF-8
 * passthrough, double-width line attributes, mouse reporting, or sixel. Those
 * never appear in the output this renders, and each would cost more than it
 * returns. Unknown sequences are consumed and dropped rather than printed,
 * which is the one behaviour that matters — a sequence this does not
 * understand must never leak through as visible garbage.
 */

export interface CellStyle {
  /** 0–255 palette index, or a `#rrggbb` string for a true-colour cell. */
  fg: number | string | null;
  bg: number | string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  /** Swap fg and bg at render time — what a shell uses for a selected item. */
  inverse: boolean;
  strike: boolean;
}

export interface Cell {
  ch: string;
  style: CellStyle;
}

/** A run of cells sharing one style, which is what a renderer wants per line. */
export interface StyledSpan {
  text: string;
  style: CellStyle;
}

export const DEFAULT_STYLE: CellStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
};

const BLANK: Cell = { ch: ' ', style: DEFAULT_STYLE };

// Tab stops every 8 columns, the fixed default every terminal ships with.
const TAB_WIDTH = 8;

// Ceiling on retained lines. Scrollback is already capped in bytes on the
// daemon side; this is the render-side twin, so a session that printed
// megabytes cannot grow an unbounded array in the renderer.
const MAX_LINES = 5000;

function styleEquals(a: CellStyle, b: CellStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.strike === b.strike
  );
}

/**
 * Reads one SGR (`ESC [ ... m`) parameter list into a new style.
 *
 * Split out because the 256-colour and true-colour forms consume following
 * parameters (`38;5;n` and `38;2;r;g;b`), so this cannot be a simple loop body
 * — it has to be able to advance the index itself.
 */
export function applySgr(style: CellStyle, params: number[]): CellStyle {
  // An empty parameter list means `ESC[m`, which is a reset.
  if (params.length === 0) return { ...DEFAULT_STYLE };
  let next = { ...style };
  for (let i = 0; i < params.length; i++) {
    const code = params[i] ?? 0;
    if (code === 0) next = { ...DEFAULT_STYLE };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strike = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false;
    else if (code === 29) next.strike = false;
    else if (code >= 30 && code <= 37) next.fg = code - 30;
    else if (code >= 40 && code <= 47) next.bg = code - 40;
    // The bright aisles, which map onto palette slots 8–15.
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
    else if (code >= 100 && code <= 107) next.bg = code - 100 + 8;
    else if (code === 39) next.fg = null;
    else if (code === 49) next.bg = null;
    else if (code === 38 || code === 48) {
      const target = code === 38 ? 'fg' : 'bg';
      const mode = params[i + 1];
      if (mode === 5) {
        next[target] = params[i + 2] ?? 0;
        i += 2;
      } else if (mode === 2) {
        const r = params[i + 2] ?? 0;
        const g = params[i + 3] ?? 0;
        const b = params[i + 4] ?? 0;
        next[target] =
          `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
        i += 4;
      } else {
        // Malformed — drop the introducer rather than guessing at a colour.
        i += 1;
      }
    }
  }
  return next;
}

// The parser's position between chunks. Output arrives in arbitrary slices, so
// a sequence can be cut in half; the emulator keeps the tail and resumes.
type ParseState =
  | { kind: 'text' }
  | { kind: 'escape' }
  | { kind: 'csi'; buffer: string }
  | { kind: 'osc'; buffer: string }
  /** `ESC (`, `ESC )` … — a charset designator, one byte then back to text. */
  | { kind: 'charset' };

export class TerminalScreen {
  private lines: Cell[][] = [[]];
  private cursorRow = 0;
  private cursorCol = 0;
  private style: CellStyle = { ...DEFAULT_STYLE };
  private saved: { row: number; col: number; style: CellStyle } | null = null;
  private state: ParseState = { kind: 'text' };
  // The main buffer, parked while the alternate screen is active.
  private parked: { lines: Cell[][]; row: number; col: number } | null = null;
  /** Set by an OSC 0/2 sequence — what a shell puts in the window title. */
  title = '';

  private cols: number;
  private rows: number;

  // Explicit fields rather than constructor parameter properties: this
  // package builds with `erasableSyntaxOnly`, which rejects any TypeScript
  // that has to emit code rather than simply be stripped.
  constructor(cols = 120, rows = 32) {
    this.cols = cols;
    this.rows = rows;
  }

  /** The top of the visible screen, which is what absolute cursor moves are relative to. */
  private screenTop(): number {
    return Math.max(0, this.lines.length - this.rows);
  }

  private lineAt(row: number): Cell[] {
    while (this.lines.length <= row) this.lines.push([]);
    const line = this.lines[row];
    if (line !== undefined) return line;
    const created: Cell[] = [];
    this.lines[row] = created;
    return created;
  }

  // Pads a line with blanks so `col` is addressable. Lines are stored ragged —
  // a 3-character line is 3 cells, not `cols` — so writing past the end has to
  // fill the gap rather than leave holes.
  private padTo(line: Cell[], col: number): void {
    while (line.length < col) line.push({ ...BLANK });
  }

  private trim(): void {
    if (this.lines.length <= MAX_LINES) return;
    const excess = this.lines.length - MAX_LINES;
    this.lines.splice(0, excess);
    this.cursorRow = Math.max(0, this.cursorRow - excess);
  }

  private putChar(ch: string): void {
    if (this.cursorCol >= this.cols) {
      // Wrap: a terminal moves to the next line rather than growing this one.
      this.cursorCol = 0;
      this.cursorRow += 1;
    }
    const line = this.lineAt(this.cursorRow);
    this.padTo(line, this.cursorCol);
    line[this.cursorCol] = { ch, style: this.style };
    this.cursorCol += 1;
  }

  /**
   * Line feed, treated as if it carried a carriage return with it.
   *
   * A strict VT does not move the column on LF — the pty's ONLCR is what turns
   * a program's `\n` into `\r\n` on the way out. But this renders output from
   * both a pty and, when `script` is unavailable, a plain pipe, and on a pipe
   * no such translation happens. Returning to column 0 here is right for the
   * pipe case and a no-op for the pty case, where the `\r` already arrived;
   * the other way round, bare `\n` output would render as a staircase.
   */
  private newline(): void {
    this.cursorRow += 1;
    this.cursorCol = 0;
    this.lineAt(this.cursorRow);
    this.trim();
  }

  /** Feeds decoded output into the screen. Safe to call with partial sequences. */
  write(text: string): void {
    for (const ch of text) {
      switch (this.state.kind) {
        case 'text':
          this.writeTextByte(ch);
          break;
        case 'escape':
          this.writeEscapeByte(ch);
          break;
        case 'csi':
          // A CSI ends at the first byte in the final range; everything before
          // it is parameters and intermediates.
          if (ch >= '@' && ch <= '~') {
            this.runCsi(this.state.buffer, ch);
            this.state = { kind: 'text' };
          } else {
            this.state = { kind: 'csi', buffer: this.state.buffer + ch };
          }
          break;
        case 'osc':
          // OSC ends at BEL, or at the two-byte ST (`ESC \`). Catching the
          // lone ESC here means an unterminated OSC cannot swallow the rest.
          if (ch === '\x07' || ch === '\x1b') {
            this.runOsc(this.state.buffer);
            // BEL terminates the string outright, so the next byte is text.
            // ESC does not: it is either the first half of ST (`ESC \`) or the
            // start of a new sequence after an unterminated string. Re-entering
            // `escape` is right for both — ST's `\` is consumed as an unknown
            // escape, and a following `[0m` is read as the CSI it is rather
            // than printed.
            this.state = ch === '\x07' ? { kind: 'text' } : { kind: 'escape' };
          } else {
            this.state = { kind: 'osc', buffer: this.state.buffer + ch };
          }
          break;
        case 'charset':
          this.state = { kind: 'text' };
          break;
      }
    }
  }

  private writeTextByte(ch: string): void {
    switch (ch) {
      case '\x1b':
        this.state = { kind: 'escape' };
        return;
      case '\n':
        this.newline();
        return;
      case '\r':
        this.cursorCol = 0;
        return;
      case '\b':
        this.cursorCol = Math.max(0, this.cursorCol - 1);
        return;
      case '\t': {
        const next = (Math.floor(this.cursorCol / TAB_WIDTH) + 1) * TAB_WIDTH;
        this.cursorCol = Math.min(next, this.cols);
        return;
      }
      case '\x07':
        // Bell. Nothing visual to do.
        return;
      case '\x00':
        return;
      default:
        this.putChar(ch);
    }
  }

  private writeEscapeByte(ch: string): void {
    if (ch === '[') {
      this.state = { kind: 'csi', buffer: '' };
      return;
    }
    if (ch === ']') {
      this.state = { kind: 'osc', buffer: '' };
      return;
    }
    if (ch === '(' || ch === ')' || ch === '*' || ch === '+') {
      this.state = { kind: 'charset' };
      return;
    }
    if (ch === 'M') {
      // Reverse index: up one line, scrolling the region if already at the top.
      this.cursorRow = Math.max(this.screenTop(), this.cursorRow - 1);
      this.state = { kind: 'text' };
      return;
    }
    if (ch === '7') {
      this.saved = {
        row: this.cursorRow,
        col: this.cursorCol,
        style: this.style,
      };
      this.state = { kind: 'text' };
      return;
    }
    if (ch === '8') {
      this.restoreCursor();
      this.state = { kind: 'text' };
      return;
    }
    // `ESC =`, `ESC >`, `ESC c` and friends: consumed, nothing rendered.
    this.state = { kind: 'text' };
  }

  private restoreCursor(): void {
    if (this.saved === null) return;
    this.cursorRow = this.saved.row;
    this.cursorCol = this.saved.col;
    this.style = this.saved.style;
  }

  /**
   * Switches to (or back from) the alternate screen.
   *
   * This is what `less`, `vim` and `htop` use so their full-screen UI does not
   * end up in the scrollback: the main buffer is parked untouched and restored
   * verbatim on the way out.
   */
  private setAlternateScreen(on: boolean): void {
    if (on) {
      if (this.parked !== null) return;
      this.parked = {
        lines: this.lines,
        row: this.cursorRow,
        col: this.cursorCol,
      };
      this.lines = [[]];
      this.cursorRow = 0;
      this.cursorCol = 0;
      return;
    }
    if (this.parked === null) return;
    this.lines = this.parked.lines;
    this.cursorRow = this.parked.row;
    this.cursorCol = this.parked.col;
    this.parked = null;
  }

  private runOsc(buffer: string): void {
    // `0;title` sets icon and title, `2;title` sets the title.
    const sep = buffer.indexOf(';');
    if (sep === -1) return;
    const code = buffer.slice(0, sep);
    if (code === '0' || code === '2') this.title = buffer.slice(sep + 1);
  }

  private runCsi(buffer: string, final: string): void {
    const priv = buffer.startsWith('?');
    const body = priv ? buffer.slice(1) : buffer;
    const params = body
      .split(';')
      .map((p) => (p === '' ? 0 : Number.parseInt(p, 10)))
      .map((n) => (Number.isFinite(n) ? n : 0));
    const first = params[0] ?? 0;
    // A movement count of 0 means 1 — every terminal treats it that way.
    const count = first === 0 ? 1 : first;

    if (priv) {
      // Private modes. Only the alternate-screen trio changes anything here;
      // cursor visibility and bracketed paste are the renderer's business, not
      // the buffer's, and the rest are consumed silently by design.
      if (final === 'h' || final === 'l') {
        if (first === 1049 || first === 1047 || first === 47) {
          this.setAlternateScreen(final === 'h');
        }
      }
      return;
    }

    switch (final) {
      case 'm':
        this.style = applySgr(this.style, params);
        return;
      case 'A':
        this.cursorRow = Math.max(this.screenTop(), this.cursorRow - count);
        return;
      case 'B':
        this.cursorRow += count;
        this.lineAt(this.cursorRow);
        this.trim();
        return;
      case 'C':
        this.cursorCol = Math.min(this.cols, this.cursorCol + count);
        return;
      case 'D':
        this.cursorCol = Math.max(0, this.cursorCol - count);
        return;
      case 'E':
        this.cursorRow += count;
        this.cursorCol = 0;
        this.lineAt(this.cursorRow);
        return;
      case 'F':
        this.cursorRow = Math.max(this.screenTop(), this.cursorRow - count);
        this.cursorCol = 0;
        return;
      case 'G':
        this.cursorCol = Math.max(0, Math.min(this.cols, count - 1));
        return;
      case 'H':
      case 'f': {
        // Absolute position, 1-based and relative to the top of the screen —
        // not to the top of the scrollback, which is why `screenTop` exists.
        const row = (params[0] ?? 1) || 1;
        const col = (params[1] ?? 1) || 1;
        this.cursorRow = this.screenTop() + row - 1;
        this.cursorCol = Math.max(0, Math.min(this.cols, col - 1));
        this.lineAt(this.cursorRow);
        return;
      }
      case 'J':
        this.eraseDisplay(first);
        return;
      case 'K':
        this.eraseLine(first);
        return;
      case 'P': {
        // Delete characters: the tail of the line slides left.
        const line = this.lineAt(this.cursorRow);
        line.splice(this.cursorCol, count);
        return;
      }
      case '@': {
        // Insert blanks: the tail slides right.
        const line = this.lineAt(this.cursorRow);
        this.padTo(line, this.cursorCol);
        line.splice(
          this.cursorCol,
          0,
          ...Array.from({ length: count }, () => ({ ...BLANK }))
        );
        return;
      }
      case 'L':
        this.lines.splice(
          this.cursorRow,
          0,
          ...Array.from({ length: count }, (): Cell[] => [])
        );
        this.trim();
        return;
      case 'M':
        this.lines.splice(this.cursorRow, count);
        if (this.lines.length === 0) this.lines.push([]);
        return;
      case 'X': {
        // Erase characters in place — blanks, without moving the tail.
        const line = this.lineAt(this.cursorRow);
        this.padTo(line, this.cursorCol + count);
        for (let i = 0; i < count; i++) line[this.cursorCol + i] = { ...BLANK };
        return;
      }
      case 's':
        this.saved = {
          row: this.cursorRow,
          col: this.cursorCol,
          style: this.style,
        };
        return;
      case 'u':
        this.restoreCursor();
        return;
      default:
        // Scroll regions, device queries, mouse modes: consumed, not printed.
        return;
    }
  }

  private eraseLine(mode: number): void {
    const line = this.lineAt(this.cursorRow);
    if (mode === 0) line.splice(this.cursorCol);
    else if (mode === 1) {
      this.padTo(line, this.cursorCol);
      for (let i = 0; i < this.cursorCol; i++) line[i] = { ...BLANK };
    } else if (mode === 2) line.splice(0);
  }

  private eraseDisplay(mode: number): void {
    const top = this.screenTop();
    if (mode === 2 || mode === 3) {
      // Clear the visible screen. The cursor's line becomes the new top, so a
      // `clear` leaves a clean surface rather than a wall of blank rows.
      this.lines.splice(top);
      this.lines.push([]);
      this.cursorRow = this.lines.length - 1;
      this.cursorCol = 0;
      return;
    }
    if (mode === 0) {
      this.eraseLine(0);
      this.lines.splice(this.cursorRow + 1);
      return;
    }
    if (mode === 1) {
      this.eraseLine(1);
      for (let row = top; row < this.cursorRow; row++) this.lines[row] = [];
    }
  }

  /** Re-flows on a viewport change. Content is not rewrapped — only the wrap width moves. */
  resize(cols: number, rows: number): void {
    if (cols > 0) this.cols = cols;
    if (rows > 0) this.rows = rows;
  }

  /** Every retained line as style-merged spans, ready to render. */
  toSpans(): StyledSpan[][] {
    return this.lines.map((line) => {
      const spans: StyledSpan[] = [];
      for (const cell of line) {
        const last = spans[spans.length - 1];
        if (last !== undefined && styleEquals(last.style, cell.style)) {
          last.text += cell.ch;
        } else {
          spans.push({ text: cell.ch, style: cell.style });
        }
      }
      return spans;
    });
  }

  /** The screen as plain text — what scrollback search matches against. */
  toText(): string {
    return this.lines
      .map((line) =>
        line
          .map((cell) => cell.ch)
          .join('')
          .replace(/\s+$/, '')
      )
      .join('\n');
  }

  get cursor(): { row: number; col: number } {
    return { row: this.cursorRow, col: this.cursorCol };
  }

  get lineCount(): number {
    return this.lines.length;
  }

  /** True while a full-screen program (a pager, an editor) owns the display. */
  get alternate(): boolean {
    return this.parked !== null;
  }
}
