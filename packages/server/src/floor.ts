import type { FloorCheck } from '@dispatch/core';
import { isAbsolute, normalize } from 'node:path/posix';

import { matchesDeclaredWrites } from './orchestrator/review.js';
import type { RunMeta } from './orchestrator/types.js';

/**
 * The server half of the irreversibility floor (core/policy.ts holds the
 * membership table): the detectors that recognize a floor action at the
 * daemon's choke points. Every floor pattern lives here and nowhere else, so
 * the floor stays one reviewable list:
 *
 * - Commands an agent runs (force-push, publish, repo settings, remote ref
 *   deletion) are caught at the executor's permission callback and again when
 *   the parked approval reaches the decision feed.
 * - States of a run (a diff deleting outside the declared writes, a spend
 *   that hit the cap) are caught where the policy engine would otherwise
 *   auto-decide, and in the feed's stalled-run items.
 * - A capped fix loop is a floor item by kind — see decisionFeed.ts.
 *
 * Detection is deliberately conservative in the blocking direction: a
 * `--dry-run` publish, a force-push mentioned inside a quoted string, or a
 * branch named like a version tag still parks for a human. The floor's
 * failure mode must be a needless question, never a silent irreversible act.
 */

// Each pattern scopes its scan to one shell segment (up to `|`, `;`, `&` or a
// newline) so a marker in a later, unrelated command does not attach to an
// innocent leading one. GAP is the stretch of one segment between two parts
// of a pattern; it is lazy so a scan stops at the earliest next part.
const GAP = '[^|;&\\n]*?';

/**
 * A pattern for `first … middles … last` within one shell segment, built to
 * run in time linear in the command's length.
 *
 * The plain form, `first[^|;&\n]*middle[^|;&\n]*last`, backtracks over every
 * pairing of `first` and `middle` occurrences in a segment: cubic time, and
 * this runs on the daemon's event loop for every tool call. A 20 KB one-line
 * command that merely mentioned "git" and "push" many times took about a
 * minute. Three changes keep exactly the same matches without that:
 *
 * - Only the first `first` in a segment is tried: a later one can only reach
 *   a subset of what the first one reaches. The negative lookbehind that
 *   rules the later ones out comes after `first`, so it runs only where
 *   `first` matched, and it stops at the nearest earlier `first`.
 * - Each middle part commits to its earliest occurrence, the one that leaves
 *   the most of the segment for what follows. A lookahead's capture replayed
 *   by a backreference is JavaScript's stand-in for an atomic group, so the
 *   engine cannot backtrack into later occurrences. A middle part must not be
 *   able to match a segment delimiter, or a later occurrence could reach a
 *   segment the earliest one cannot.
 * - `last` is only looked for, from the end of the last middle part. Its
 *   source is the lookahead body, so it states its own gap; most callers wrap
 *   it in inSegment().
 *
 * test/floor.test.ts checks these against the plain form on generated
 * commands, and times them on the inputs that stalled the plain form.
 */
function segmentChain(
  first: string,
  middles: readonly string[],
  last: string
): RegExp {
  let source = `${first}(?<!${first}${GAP}${first})`;
  middles.forEach((middle, i) => {
    source += `(?=(${GAP}${middle}))\\${String(i + 1)}`;
  });
  return new RegExp(`${source}(?=${last})`);
}

// `last` found anywhere from the current point to the end of the segment. Each
// alternative must cost constant or run-bounded time at one starting point,
// since the gap tries every starting point once.
function inSegment(alternatives: string): string {
  return `${GAP}(?:${alternatives})`;
}

const GIT = '\\bgit\\b';
const PUSH = '\\bpush\\b';
const GH = '\\bgh\\b';

// `git push` carrying --force, --force-with-lease, a short -f (alone or
// bundled), or a `+refspec`: every spelling git accepts for "overwrite the
// remote ref". The merge queue's own --force-with-lease on a run's PR branch
// is not a tool call and never reaches these detectors. The bundled-flag
// test is `-` then a run of letters holding an `f` and ending at a word
// boundary, checked with a lookahead so a long run of letters costs linear
// rather than quadratic time.
const FORCE_PUSH = segmentChain(
  GIT,
  [PUSH],
  inSegment(
    '--force(?:-with-lease)?(?![\\w-])|\\s-(?=[a-zA-Z]*f)[a-zA-Z]+\\b|\\s\\+\\S+'
  )
);

// `git push` deleting a remote ref: `--delete`, `-d`, or the empty-source
// refspec `:branch`. A ref the run does not own is outside its declared
// writes by definition.
const REMOTE_REF_DELETE = segmentChain(
  GIT,
  [PUSH],
  inSegment('--delete\\b|\\s-d\\b|\\s:\\S+')
);

// A package manager invoking publish (or unpublish, strictly more
// destructive). The lookahead keeps script names like `publish-check` out.
const REGISTRY_PUBLISH = segmentChain(
  '\\b(?:npm|pnpm|yarn|bun|npx|cargo)\\b',
  [],
  inSegment('\\s(?:un)?publish(?![\\w-])')
);

// A tag push is this repo's release trigger (release.yml builds on v*), so
// pushing tags is publishing under a different spelling: `--tags`,
// `--follow-tags`, an explicit `refs/tags/` refspec, or a bare `vN[.N...]`
// ref. `gh release create/upload` publishes a release directly.
const TAG_PUSH = segmentChain(
  GIT,
  [PUSH],
  inSegment(
    '--tags(?![\\w-])|--follow-tags(?![\\w-])|\\s(?:\\S+:)?v\\d+(?:\\.\\d+)*(?=\\s|$)'
  )
);
// The `refs/tags/` refspec, split out because `\S*refs/tags/` tried from every
// point of a long word is quadratic. The run of non-space characters ending at
// `refs/tags/` starts either where the scan starts or just after a space
// inside the segment, so only those two starting points are tried.
const TAG_REFSPEC_PUSH = segmentChain(
  GIT,
  [PUSH],
  `(?:\\S*|${GAP}[^\\S\\n]\\S*)refs/tags/`
);
const GH_RELEASE = segmentChain(
  GH,
  ['\\brelease\\b'],
  inSegment('\\b(?:create|upload)\\b')
);

// `gh` touching a repository's settings: visibility (`gh repo edit
// --visibility`, `gh api -f visibility=`, `-f private=`), the default branch,
// or the repository itself (`gh repo delete`, `gh repo archive`, a DELETE
// against /repos/). The DELETE form is two patterns because `-X` and `DELETE`
// may be split by a newline, and a middle part must not cross one: once on
// the same line, and once across the newline that ends the `-X` line.
const REPO_SETTINGS: readonly RegExp[] = [
  segmentChain(
    GH,
    [],
    inSegment('\\bvisibility\\b|\\bdefault[-_]branch\\b|\\bprivate=')
  ),
  segmentChain(GH, ['\\brepo\\b'], inSegment('\\b(?:delete|archive)\\b')),
  segmentChain(GH, ['-X[^\\S\\n]+DELETE'], inSegment('/repos/')),
  segmentChain(GH, ['-X[^\\S\\n]*\\n\\s*DELETE'], inSegment('/repos/')),
];

// Order matters only when one command trips several patterns; the first
// match names the hold, and any match blocks.
const COMMAND_CHECKS: readonly { check: FloorCheck; pattern: RegExp }[] = [
  { check: 'force-push', pattern: FORCE_PUSH },
  { check: 'publish', pattern: REGISTRY_PUBLISH },
  { check: 'publish', pattern: TAG_PUSH },
  { check: 'publish', pattern: TAG_REFSPEC_PUSH },
  { check: 'publish', pattern: GH_RELEASE },
  ...REPO_SETTINGS.map((pattern) => ({
    check: 'repo-settings' as const,
    pattern,
  })),
  { check: 'delete-outside-writes', pattern: REMOTE_REF_DELETE },
];

/** The floor check a shell command trips, or null when it trips none. */
export function floorCheckForCommand(command: string): FloorCheck | null {
  for (const { check, pattern } of COMMAND_CHECKS) {
    if (pattern.test(command)) return check;
  }
  return null;
}

/**
 * The floor check a tool call's input trips. Recognizes any tool whose input
 * carries a `command` string (Bash and its variants), so a renamed shell tool
 * is still covered as long as it takes a command.
 */
export function floorCheckForToolInput(input: unknown): FloorCheck | null {
  if (typeof input !== 'object' || input === null) return null;
  const { command } = input as { command?: unknown };
  if (typeof command !== 'string') return null;
  return floorCheckForCommand(command);
}

/**
 * Paths in a scope request the policy may never auto-grant: anything absolute,
 * anything that climbs above the project root, and anything under `.git/`.
 * A fence extension into another repo or into git's own store can rewrite
 * refs and history, so it waits for a human at every rung (the rung-2
 * constraint in docs/design/autonomy-ladder.md). Windows separators are
 * normalized first so `..\\` escapes are not missed.
 */
export function scopeRequestEscapesRepo(paths: string[]): string[] {
  return paths.filter((path) => {
    const normalized = normalize(path.replaceAll('\\', '/'));
    if (isAbsolute(normalized)) return true;
    const segments = normalized.split('/');
    return segments[0] === '..' || segments.includes('.git');
  });
}

/**
 * Files a run's diff DELETES that no declared `writes` glob covers — the
 * floor's delete-outside-writes member, evaluated where auto-merge would
 * otherwise enqueue. Only a status git reports as `D` counts; a rename keeps
 * the content and is left to the ordinary undeclared-writes review finding.
 * `.dispatch/` bookkeeping is exempt for the same reason undeclaredWrites
 * exempts it: it is dispatch's own writing, not agent work product.
 */
export function deletesOutsideDeclaredWrites(
  writes: string[],
  files: { path: string; status: string }[]
): string[] {
  return files
    .filter(
      (file) =>
        file.status.startsWith('D') &&
        !file.path.startsWith('.dispatch/') &&
        !matchesDeclaredWrites(writes, file.path)
    )
    .map((file) => file.path);
}

/**
 * Whether a run's failure means it hit its cost budget — the floor's
 * budget-cap member. Matches the executor's own truncation message (see
 * BUDGET_EXHAUSTED_MESSAGE in executors/claude.ts, shared so the two cannot
 * drift) and the SDK's raw `error_max_budget_usd` subtype, which reaches
 * `RunMeta.error` verbatim when the SDK reports no message of its own.
 */
export function isBudgetCapFailure(error: string | undefined): boolean {
  if (error === undefined) return false;
  return (
    error.includes('hit its cost budget') ||
    error.includes('error_max_budget_usd')
  );
}

/**
 * A task's runs that died on their cost cap and nobody has dealt with: not
 * reviewed, not archived, not resumed. While one exists, every path that
 * would spend on the task's behalf (fix-loop ignition, verification retry)
 * holds — spending past the cap is a human's call at every rung. A resume is
 * that call: the resumed run is superseded, so the hold lifts with it.
 */
export function budgetCapHolds(runs: RunMeta[], taskId: string): RunMeta[] {
  const superseded = new Set<string>();
  for (const run of runs) {
    if (run.resumedFrom !== undefined) superseded.add(run.resumedFrom);
  }
  return runs.filter(
    (run) =>
      run.taskId === taskId &&
      run.state === 'failed' &&
      isBudgetCapFailure(run.error) &&
      run.reviewedAt === undefined &&
      run.archivedAt === undefined &&
      !superseded.has(run.id)
  );
}
