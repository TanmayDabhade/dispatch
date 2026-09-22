/**
 * Turns a browser keyboard event into the bytes a terminal expects.
 *
 * A pty does not receive key names — it receives the same byte sequences a
 * physical terminal would send, and a program reading from it (a shell's line
 * editor, a pager, vim) recognises nothing else. Enter is `\r`, not `\n`;
 * Ctrl-C is byte 3, not the string "Ctrl-C"; an arrow key is a three-byte
 * escape sequence. Getting this wrong is the difference between a working
 * terminal and one that echoes text but responds to nothing.
 */

// The keys that map to a fixed sequence regardless of modifiers.
const SIMPLE_KEYS: Record<string, string> = {
  Enter: '\r',
  Tab: '\t',
  Backspace: '\x7f',
  Escape: '\x1b',
  // The cursor keys, in their "normal" (non-application) form. A program that
  // has switched the keypad to application mode wants `ESC O A` instead, which
  // would need us to track DECCKM; shells and pagers accept both, and the
  // programs that care send their own bindings anyway.
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  Insert: '\x1b[2~',
  Delete: '\x1b[3~',
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
  F5: '\x1b[15~',
  F6: '\x1b[17~',
  F7: '\x1b[18~',
  F8: '\x1b[19~',
  F9: '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',
};

/** The subset of a KeyboardEvent this needs, so it can be called from a test. */
export interface KeyStroke {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * The bytes for one keystroke, or null when the key should be left alone.
 *
 * Null is how the caller learns not to swallow the event: a bare modifier
 * press, and anything carrying Meta (⌘C, ⌘V and the app's own shortcuts) must
 * reach the browser rather than the pty.
 */
export function encodeKey(event: KeyStroke): string | null {
  const { key, ctrlKey, altKey, metaKey } = event;

  // Modifier keys on their own produce no bytes.
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
    return null;
  }

  // Meta belongs to the OS and the app — copy, paste, and every app shortcut.
  // Sending it to the pty would break clipboard support on macOS outright.
  if (metaKey) return null;

  if (ctrlKey && !altKey) {
    const control = controlByte(key);
    if (control !== null) return control;
  }

  const simple = SIMPLE_KEYS[key];
  if (simple !== undefined) {
    // Alt-<key> is sent as ESC followed by the key's own bytes, which is how
    // every terminal encodes Meta.
    return altKey ? `\x1b${simple}` : simple;
  }

  // Anything else that is a single character is sent as itself. Keys with
  // multi-character names (`AudioVolumeUp`, `Unidentified`) are not text.
  //
  // The `u` flag is what makes `.` match a whole code point rather than one
  // UTF-16 unit, so an astral character counts as the single keystroke it is
  // instead of as two halves of a surrogate pair.
  if (/^.$/u.test(key)) return altKey ? `\x1b${key}` : key;
  return null;
}

/**
 * The control byte for Ctrl-<key>, or null when there is none.
 *
 * Ctrl-A through Ctrl-Z are bytes 1–26, which is what makes Ctrl-C interrupt
 * and Ctrl-D signal end of input. The handful after them are the classic
 * mappings from the ASCII table.
 */
export function controlByte(key: string): string | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  const code = upper.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(code - 64);
  switch (key) {
    case '@':
    case ' ':
      return '\x00';
    case '[':
      return '\x1b';
    case '\\':
      return '\x1c';
    case ']':
      return '\x1d';
    case '^':
      return '\x1e';
    case '_':
    case '?':
      return '\x1f';
    default:
      return null;
  }
}
