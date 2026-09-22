/**
 * The state of one file open in the editor, and the rules for autosaving it.
 *
 * Autosave looks trivial until a save is in flight. The case that loses work:
 * the user types, a save starts with that text, the user types again, the save
 * returns, and the buffer is marked clean — the second edit is now only in the
 * textarea, and switching files drops it. So a save records *what text it
 * sent*, and completing it only clears the dirty flag if the buffer still
 * holds exactly that.
 */

type BufferStatus = 'clean' | 'dirty' | 'saving' | 'error';

export interface EditorBuffer {
  path: string;
  /** What is in the editor now. */
  text: string;
  /** What the file on disk is believed to hold. */
  savedText: string;
  status: BufferStatus;
  /** The text handed to the save currently in flight, if any. */
  inFlightText: string | null;
  error: string | null;
}

export function openBuffer(path: string, text: string): EditorBuffer {
  return {
    path,
    text,
    savedText: text,
    status: 'clean',
    inFlightText: null,
    error: null,
  };
}

/** Records a keystroke. A buffer edited back to its saved text is clean again. */
export function editBuffer(buffer: EditorBuffer, text: string): EditorBuffer {
  const matchesDisk = text === buffer.savedText;
  return {
    ...buffer,
    text,
    // An in-flight save keeps `saving` so the UI does not flicker between
    // states on every keystroke; `shouldSave` below is what notices there is
    // newer text once it lands.
    status:
      buffer.status === 'saving' ? 'saving' : matchesDisk ? 'clean' : 'dirty',
    error: null,
  };
}

/** Whether a save should start now: there is unsaved text and none in flight. */
export function shouldSave(buffer: EditorBuffer): boolean {
  return buffer.inFlightText === null && buffer.text !== buffer.savedText;
}

export function beginSave(buffer: EditorBuffer): EditorBuffer {
  return {
    ...buffer,
    status: 'saving',
    inFlightText: buffer.text,
    error: null,
  };
}

/**
 * A save came back.
 *
 * The buffer is only clean if nothing was typed while it was in flight; if
 * something was, it stays dirty and the caller's next tick starts another
 * save. `savedText` advances either way, because that text really is on disk
 * now — which is what makes the next save's comparison correct.
 */
export function saveSucceeded(buffer: EditorBuffer): EditorBuffer {
  const sent = buffer.inFlightText ?? buffer.savedText;
  const stillCurrent = buffer.text === sent;
  return {
    ...buffer,
    savedText: sent,
    status: stillCurrent ? 'clean' : 'dirty',
    inFlightText: null,
    error: null,
  };
}

/**
 * A save failed.
 *
 * `savedText` is deliberately not advanced: the file on disk is whatever it
 * was, and pretending otherwise would make the next comparison skip a save
 * that is still needed.
 */
export function saveFailed(
  buffer: EditorBuffer,
  message: string
): EditorBuffer {
  return { ...buffer, status: 'error', inFlightText: null, error: message };
}

/** Whether closing this buffer would lose something. */
export function hasUnsavedChanges(buffer: EditorBuffer): boolean {
  return buffer.text !== buffer.savedText;
}

/** How long to wait after the last keystroke before saving. */
export const AUTOSAVE_DEBOUNCE_MS = 600;
