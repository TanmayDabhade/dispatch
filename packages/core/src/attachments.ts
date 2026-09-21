// Pure, browser-safe half of task attachments: where the blobs live relative
// to the project, how large one may be, and what counts as a usable file name.
// The node-side directory helper (attachmentsDir) lives in store.ts.

export const ATTACHMENTS_DIR = '.dispatch/attachments';

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

// True when the string carries an ASCII control character (C0 or DEL), which
// no file name the daemon writes may contain.
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// Reduces an uploaded file name to a bare basename the daemon can write under
// the task's attachments directory, or null when nothing safe is left of it:
// empty, `.`/`..`, a control character, or over the 255-byte filesystem limit.
export function sanitizeAttachmentName(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? '';
  const trimmed = base.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return null;
  if (hasControlCharacter(trimmed)) return null;
  if (new TextEncoder().encode(trimmed).length > 255) return null;
  return trimmed;
}

// The project-relative posix path a TaskAttachment records for its blob.
export function attachmentRelativePath(taskId: string, name: string): string {
  return `${ATTACHMENTS_DIR}/${taskId}/${name}`;
}
