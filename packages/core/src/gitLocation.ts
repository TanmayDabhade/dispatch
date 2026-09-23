import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * A git location — a URL or a path — in a form git reads the same from any
 * directory. URLs (`https://…`, `ssh://…`, `file://…`, scp-style
 * `git@host:path`) and absolute paths pass through; `~/` means the home
 * directory; any other path is resolved against `baseDir`.
 *
 * Git reads a relative path against the directory it runs in, and board sync,
 * the receipts push and `receipts restore` all run git somewhere other than
 * where the path was written — a clone under DISPATCH_HOME, a temp dir — so
 * each one makes the location absolute against where it was meant first.
 */
export function absoluteGitLocation(baseDir: string, location: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) return location;
  if (isAbsolute(location)) return location;
  if (location === '~' || location.startsWith('~/')) {
    return join(homedir(), location.slice(1));
  }
  // scp-style: a colon before any slash, as in git@github.com:team/board.git.
  if (/^[^/\\]+:/.test(location)) return location;
  return resolve(baseDir, location);
}
