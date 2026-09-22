import { describe, expect, it } from 'bun:test';

import type { KeyStroke } from './terminalKeys';
import { controlByte, encodeKey } from './terminalKeys';

function stroke(key: string, mods: Partial<KeyStroke> = {}): KeyStroke {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  };
}

describe('encodeKey', () => {
  it('sends a plain character as itself', () => {
    expect(encodeKey(stroke('a'))).toBe('a');
    expect(encodeKey(stroke('Z'))).toBe('Z');
    expect(encodeKey(stroke('$'))).toBe('$');
  });

  it('sends Enter as a carriage return, not a newline', () => {
    // A shell's line editor acts on \r; \n would be read as a literal.
    expect(encodeKey(stroke('Enter'))).toBe('\r');
  });

  it('sends Backspace as DEL, which is what a pty expects', () => {
    expect(encodeKey(stroke('Backspace'))).toBe('\x7f');
  });

  it('encodes the cursor keys as escape sequences', () => {
    expect(encodeKey(stroke('ArrowUp'))).toBe('\x1b[A');
    expect(encodeKey(stroke('ArrowDown'))).toBe('\x1b[B');
    expect(encodeKey(stroke('ArrowRight'))).toBe('\x1b[C');
    expect(encodeKey(stroke('ArrowLeft'))).toBe('\x1b[D');
  });

  it('turns Ctrl-C into the interrupt byte', () => {
    expect(encodeKey(stroke('c', { ctrlKey: true }))).toBe('\x03');
    expect(encodeKey(stroke('C', { ctrlKey: true }))).toBe('\x03');
  });

  it('turns Ctrl-D into end of input', () => {
    expect(encodeKey(stroke('d', { ctrlKey: true }))).toBe('\x04');
  });

  it('prefixes Alt with an escape, the usual Meta encoding', () => {
    expect(encodeKey(stroke('b', { altKey: true }))).toBe('\x1bb');
    expect(encodeKey(stroke('ArrowLeft', { altKey: true }))).toBe('\x1b\x1b[D');
  });

  it('leaves Meta alone so copy and paste still work', () => {
    // The one that breaks a terminal outright if you get it wrong: swallowing
    // ⌘C means the user can never copy anything out of the pane.
    expect(encodeKey(stroke('c', { metaKey: true }))).toBeNull();
    expect(encodeKey(stroke('v', { metaKey: true }))).toBeNull();
  });

  it('produces nothing for a bare modifier press', () => {
    expect(encodeKey(stroke('Shift'))).toBeNull();
    expect(encodeKey(stroke('Control'))).toBeNull();
    expect(encodeKey(stroke('Alt'))).toBeNull();
    expect(encodeKey(stroke('Meta'))).toBeNull();
  });

  it('ignores keys that are not text', () => {
    expect(encodeKey(stroke('AudioVolumeUp'))).toBeNull();
    expect(encodeKey(stroke('Unidentified'))).toBeNull();
  });

  it('passes a multi-byte character through', () => {
    // One code point, several UTF-8 bytes — still a single keystroke.
    expect(encodeKey(stroke('é'))).toBe('é');
  });

  it('sends Tab and Escape verbatim', () => {
    expect(encodeKey(stroke('Tab'))).toBe('\t');
    expect(encodeKey(stroke('Escape'))).toBe('\x1b');
  });
});

describe('controlByte', () => {
  it('maps the letters onto bytes 1-26', () => {
    expect(controlByte('a')).toBe('\x01');
    expect(controlByte('z')).toBe('\x1a');
  });

  it('covers the classic punctuation mappings', () => {
    expect(controlByte('[')).toBe('\x1b');
    expect(controlByte('\\')).toBe('\x1c');
    expect(controlByte(']')).toBe('\x1d');
    expect(controlByte(' ')).toBe('\x00');
  });

  it('is null for anything without a control form', () => {
    expect(controlByte('1')).toBeNull();
    expect(controlByte('ArrowUp')).toBeNull();
  });
});
