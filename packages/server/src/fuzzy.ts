/**
 * Subsequence matching and scoring for quick open.
 *
 * The behaviour people expect from a file finder: typing `bvt` should find
 * `src/views/BoardView.tsx` and rank it above a file that happens to contain
 * those letters scattered through the middle of a word. That ordering is the
 * whole feature — a matcher that only answers yes/no returns hundreds of files
 * with the one you wanted somewhere in the middle.
 *
 * So a match is a subsequence (every query character appears in order), and
 * the score rewards the things that distinguish an intended match from an
 * accidental one: runs of consecutive characters, hits at word boundaries, and
 * hits in the file's own name rather than its directory.
 */

export interface FuzzyMatch {
  /** Higher is better. Only meaningful relative to other scores. */
  score: number;
  /** Indices in the candidate that matched, for highlighting. */
  positions: number[];
}

// A character that begins a "word" for scoring: the separators in a path, plus
// the lowercase-to-uppercase transition inside a camelCase name.
function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1] ?? '';
  if (/[/\\\-_. ]/.test(previous)) return true;
  const current = text[index] ?? '';
  return (
    previous === previous.toLowerCase() && current !== current.toLowerCase()
  );
}

const CONSECUTIVE_BONUS = 8;
const BOUNDARY_BONUS = 10;
const BASENAME_BONUS = 6;
const EXACT_CASE_BONUS = 2;
// Charged per candidate character, so a short path outranks a long one that
// matched equally well.
const LENGTH_PENALTY = 0.2;

/**
 * Scores `query` against `candidate`, or returns null when it does not match.
 *
 * Greedy left-to-right rather than an optimal alignment: for query strings of
 * the length people actually type, the first subsequence is nearly always the
 * intended one, and a full dynamic-programming search costs far more per
 * candidate across thousands of files.
 */
export function fuzzyMatch(
  query: string,
  candidate: string
): FuzzyMatch | null {
  if (query === '') return { score: 0, positions: [] };

  const haystack = candidate.toLowerCase();
  const needle = query.toLowerCase();
  const basenameStart = candidate.lastIndexOf('/') + 1;

  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let previousIndex = -2;

  for (let q = 0; q < needle.length; q++) {
    const wanted = needle[q];
    if (wanted === undefined) return null;
    const at = haystack.indexOf(wanted, from);
    if (at === -1) return null;

    score += 1;
    if (at === previousIndex + 1) score += CONSECUTIVE_BONUS;
    if (isBoundary(candidate, at)) score += BOUNDARY_BONUS;
    if (at >= basenameStart) score += BASENAME_BONUS;
    if (candidate[at] === query[q]) score += EXACT_CASE_BONUS;

    positions.push(at);
    previousIndex = at;
    from = at + 1;
  }

  return { score: score - candidate.length * LENGTH_PENALTY, positions };
}

export interface RankedCandidate<T> {
  value: T;
  score: number;
  positions: number[];
}

/**
 * Ranks candidates best-first, keeping at most `limit`.
 *
 * Ties break on the candidate's own text so the order is stable between
 * identical queries — a list that reshuffles under the cursor is worse than
 * one that is occasionally ordered arbitrarily.
 */
export function rankFuzzy<T>(
  query: string,
  candidates: readonly T[],
  textOf: (value: T) => string,
  limit = 50
): RankedCandidate<T>[] {
  const ranked: RankedCandidate<T>[] = [];
  for (const value of candidates) {
    const match = fuzzyMatch(query, textOf(value));
    if (match === null) continue;
    ranked.push({ value, score: match.score, positions: match.positions });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return textOf(a.value).localeCompare(textOf(b.value));
  });
  return ranked.slice(0, limit);
}
