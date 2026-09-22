/**
 * Splitting a string into highlighted and plain runs.
 *
 * Two callers with two kinds of input: scrollback search knows the substring
 * it matched, while quick open gets back a list of character indices from the
 * daemon's fuzzy matcher. Both want the same output — runs, not one element
 * per character, so a long path is a handful of DOM nodes rather than a
 * hundred.
 *
 * The indices matter more than they look. `fuzzyMatch` on the daemon produces
 * them with `String.prototype.indexOf`, so they are UTF-16 code-unit offsets.
 * Anything here that walked the string by code point would drift out of
 * alignment the moment a path contained an astral character, and highlight the
 * wrong letters from there on.
 */

export interface HighlightRun {
  text: string;
  hit: boolean;
}

// Appends to the previous run when it carries the same flag, so adjacent
// characters never each get their own element.
function push(runs: HighlightRun[], text: string, hit: boolean): void {
  const last = runs[runs.length - 1];
  if (last !== undefined && last.hit === hit) last.text += text;
  else runs.push({ text, hit });
}

/**
 * Runs from a list of matched offsets.
 *
 * Walks by code point so a surrogate pair stays one character and is never
 * split down the middle, while the offsets compared against `marked` stay
 * UTF-16 — which is the unit the matcher produced them in.
 */
export function runsFromPositions(
  text: string,
  positions: readonly number[]
): HighlightRun[] {
  const marked = new Set(positions);
  const runs: HighlightRun[] = [];
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i);
    if (code === undefined) break;
    const char = String.fromCodePoint(code);
    push(runs, char, marked.has(i));
    i += char.length;
  }
  return runs;
}

/**
 * Runs from every case-insensitive occurrence of `needle`.
 *
 * An empty needle is one plain run rather than a match on everything — a
 * search box the user has not typed into yet should highlight nothing.
 */
export function runsFromNeedle(text: string, needle: string): HighlightRun[] {
  if (needle === '') return [{ text, hit: false }];
  const runs: HighlightRun[] = [];
  const haystack = text.toLowerCase();
  const lower = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(lower, from);
    if (at === -1) break;
    if (at > from) push(runs, text.slice(from, at), false);
    push(runs, text.slice(at, at + needle.length), true);
    from = at + needle.length;
  }
  if (from < text.length) push(runs, text.slice(from), false);
  return runs;
}
