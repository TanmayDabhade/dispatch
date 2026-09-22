import { describe, expect, it } from 'bun:test';

import { applySgr, DEFAULT_STYLE, TerminalScreen } from './terminalScreen';

// Renders the screen the way a reader would see it, so an assertion reads as
// "what is on screen" rather than as a walk over cell arrays.
function screenText(screen: TerminalScreen): string {
  return screen.toText();
}

describe('applySgr', () => {
  it('resets on an empty parameter list', () => {
    const bolded = applySgr(DEFAULT_STYLE, [1]);
    expect(applySgr(bolded, [])).toEqual(DEFAULT_STYLE);
  });

  it('reads the basic colour aisles', () => {
    expect(applySgr(DEFAULT_STYLE, [31]).fg).toBe(1);
    expect(applySgr(DEFAULT_STYLE, [42]).bg).toBe(2);
  });

  it('maps the bright aisles onto palette slots 8-15', () => {
    expect(applySgr(DEFAULT_STYLE, [91]).fg).toBe(9);
    expect(applySgr(DEFAULT_STYLE, [101]).bg).toBe(9);
  });

  it('reads 256-colour and true-colour forms', () => {
    expect(applySgr(DEFAULT_STYLE, [38, 5, 200]).fg).toBe(200);
    expect(applySgr(DEFAULT_STYLE, [38, 2, 255, 128, 0]).fg).toBe('#ff8000');
    expect(applySgr(DEFAULT_STYLE, [48, 2, 0, 0, 0]).bg).toBe('#000000');
  });

  it('does not let an extended colour swallow the codes after it', () => {
    // `38;5;9` then `1`: the bold must still land.
    const style = applySgr(DEFAULT_STYLE, [38, 5, 9, 1]);
    expect(style.fg).toBe(9);
    expect(style.bold).toBe(true);
  });

  it('turns attributes back off', () => {
    const on = applySgr(DEFAULT_STYLE, [1, 3, 4, 7]);
    const off = applySgr(on, [22, 23, 24, 27]);
    expect(off).toEqual(DEFAULT_STYLE);
  });
});

describe('TerminalScreen text handling', () => {
  it('writes plain text', () => {
    const screen = new TerminalScreen();
    screen.write('hello world');
    expect(screenText(screen)).toBe('hello world');
  });

  it('starts a new line on a newline', () => {
    const screen = new TerminalScreen();
    screen.write('one\ntwo');
    expect(screenText(screen)).toBe('one\ntwo');
  });

  it('overwrites the line on a carriage return', () => {
    const screen = new TerminalScreen();
    // The progress-bar case: each frame returns to column 0 and repaints.
    screen.write('50%\r100%');
    expect(screenText(screen)).toBe('100%');
  });

  it('leaves the tail behind when the repaint is shorter', () => {
    const screen = new TerminalScreen();
    // A real terminal does not clear on \r, so the longer previous frame shows
    // through. This is why programs emit an erase-to-end with it.
    screen.write('123456\r78');
    expect(screenText(screen)).toBe('783456');
  });

  it('clears the rest of the line when asked to', () => {
    const screen = new TerminalScreen();
    screen.write('abcdef\rxy\x1b[K');
    expect(screenText(screen)).toBe('xy');
  });

  it('moves back on a backspace', () => {
    const screen = new TerminalScreen();
    screen.write('abc\b\bX');
    expect(screenText(screen)).toBe('aXc');
  });

  it('advances to the next tab stop', () => {
    const screen = new TerminalScreen();
    screen.write('ab\tc');
    expect(screenText(screen)).toBe('ab      c');
  });

  it('wraps at the configured width', () => {
    const screen = new TerminalScreen(4, 10);
    screen.write('abcdef');
    expect(screenText(screen)).toBe('abcd\nef');
  });
});

describe('TerminalScreen escape handling', () => {
  it('never prints an escape sequence it understands', () => {
    const screen = new TerminalScreen();
    screen.write('\x1b[32m' + 'green' + '\x1b[0m');
    expect(screenText(screen)).toBe('green');
  });

  it('never prints one it does not understand either', () => {
    const screen = new TerminalScreen();
    // Mouse tracking, a device query and a scroll region: all consumed.
    screen.write('\x1b[?1000h\x1b[6n\x1b[1;10r' + 'visible');
    expect(screenText(screen)).toBe('visible');
  });

  it('carries style onto the cells it covers', () => {
    const screen = new TerminalScreen();
    screen.write('\x1b[1;31m' + 'red' + '\x1b[0m plain');
    const [line] = screen.toSpans();
    expect(line?.[0]?.text).toBe('red');
    expect(line?.[0]?.style.fg).toBe(1);
    expect(line?.[0]?.style.bold).toBe(true);
    expect(line?.[1]?.text).toBe(' plain');
    expect(line?.[1]?.style.fg).toBeNull();
  });

  it('survives a sequence split across two writes', () => {
    const screen = new TerminalScreen();
    // The chunking case: output arrives in arbitrary slices, and a cut through
    // the middle of an escape must not print its tail as text.
    screen.write('\x1b[3');
    screen.write('2m' + 'green');
    expect(screenText(screen)).toBe('green');
    expect(screen.toSpans()[0]?.[0]?.style.fg).toBe(2);
  });

  it('positions the cursor absolutely', () => {
    const screen = new TerminalScreen(20, 5);
    screen.write('\x1b[2;3HX');
    expect(screenText(screen)).toBe('\n  X');
  });

  it('moves the cursor with the arrow forms', () => {
    const screen = new TerminalScreen();
    screen.write('abc\x1b[2Dx');
    expect(screenText(screen)).toBe('axc');
  });

  it('clears the screen', () => {
    const screen = new TerminalScreen(20, 5);
    screen.write('old output\n\x1b[2J' + 'fresh');
    expect(screenText(screen)).toBe('fresh');
  });

  it('erases to the end of the display', () => {
    const screen = new TerminalScreen(20, 10);
    screen.write('keep\ngone\nalso gone');
    screen.write('\x1b[2;1H\x1b[0J');
    expect(screenText(screen)).toBe('keep\n');
  });

  it('deletes and inserts characters in place', () => {
    const screen = new TerminalScreen();
    screen.write('123456\x1b[1G\x1b[2P');
    expect(screenText(screen)).toBe('3456');

    const other = new TerminalScreen();
    other.write('abc\x1b[1G\x1b[2@');
    expect(screenText(other)).toBe('  abc');
  });

  it('reads an OSC title without printing it', () => {
    const screen = new TerminalScreen();
    screen.write('\x1b]0;my-project\x07ready');
    expect(screen.title).toBe('my-project');
    expect(screenText(screen)).toBe('ready');
  });

  it('does not let an unterminated OSC swallow the output', () => {
    const screen = new TerminalScreen();
    screen.write('\x1b]0;title' + '\x1b[0m' + 'still here');
    expect(screenText(screen)).toBe('still here');
  });

  it('saves and restores the cursor', () => {
    const screen = new TerminalScreen();
    screen.write('abc\x1b[s\ndef\x1b[uZ');
    expect(screenText(screen)).toBe('abcZ\ndef');
  });
});

describe('TerminalScreen alternate buffer', () => {
  it('parks the scrollback while a full-screen program runs', () => {
    const screen = new TerminalScreen(20, 5);
    screen.write('shell output');
    screen.write('\x1b[?1049h');
    expect(screen.alternate).toBe(true);
    screen.write('PAGER VIEW');
    expect(screenText(screen)).toBe('PAGER VIEW');

    screen.write('\x1b[?1049l');
    expect(screen.alternate).toBe(false);
    // The pager's painting left no trace in the scrollback.
    expect(screenText(screen)).toBe('shell output');
  });

  it('ignores a second enter and a spurious leave', () => {
    const screen = new TerminalScreen(20, 5);
    screen.write('base');
    screen.write('\x1b[?1049h\x1b[?1049halt');
    screen.write('\x1b[?1049l\x1b[?1049l');
    expect(screenText(screen)).toBe('base');
  });
});

describe('TerminalScreen bookkeeping', () => {
  it('caps the lines it retains', () => {
    const screen = new TerminalScreen(80, 24);
    for (let i = 0; i < 6000; i++) screen.write(`line ${i}\n`);
    expect(screen.lineCount).toBeLessThanOrEqual(5001);
    // The newest output is what survives.
    expect(screenText(screen)).toContain('line 5999');
    expect(screenText(screen)).not.toContain('line 0\n');
  });

  it('reports the cursor position', () => {
    const screen = new TerminalScreen();
    screen.write('abc\ndef');
    expect(screen.cursor).toEqual({ row: 1, col: 3 });
  });

  it('merges adjacent cells that share a style', () => {
    const screen = new TerminalScreen();
    screen.write('\x1b[31m' + 'aaa' + '\x1b[32m' + 'bbb');
    const [line] = screen.toSpans();
    expect(line?.length).toBe(2);
    expect(line?.[0]?.text).toBe('aaa');
    expect(line?.[1]?.text).toBe('bbb');
  });
});
