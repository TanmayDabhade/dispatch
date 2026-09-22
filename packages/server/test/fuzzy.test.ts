import { describe, expect, it } from 'bun:test';

import { fuzzyMatch, rankFuzzy } from '../src/fuzzy.js';

function best(query: string, candidates: string[]): string | undefined {
  return rankFuzzy(query, candidates, (value) => value)[0]?.value;
}

describe('fuzzyMatch', () => {
  it('matches a subsequence', () => {
    expect(fuzzyMatch('bvt', 'src/views/BoardView.tsx')).not.toBeNull();
  });

  it('rejects characters that are out of order', () => {
    expect(fuzzyMatch('tvb', 'src/views/BoardView.tsx')).toBeNull();
  });

  it('rejects a character that is not there at all', () => {
    expect(fuzzyMatch('bvz', 'src/views/BoardView.tsx')).toBeNull();
  });

  it('treats an empty query as a match with no opinion', () => {
    const match = fuzzyMatch('', 'anything');
    expect(match).not.toBeNull();
    expect(match?.positions).toEqual([]);
  });

  it('reports where it matched, for highlighting', () => {
    const match = fuzzyMatch('abc', 'a-b-c');
    expect(match?.positions).toEqual([0, 2, 4]);
  });

  it('scores a consecutive run above a scattered one', () => {
    const tight = fuzzyMatch('board', 'BoardView.tsx');
    const loose = fuzzyMatch('board', 'blue-orange-a-red-dish.tsx');
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect((tight?.score ?? 0) > (loose?.score ?? 0)).toBe(true);
  });

  it('scores word-boundary hits above mid-word ones', () => {
    const boundaries = fuzzyMatch('bv', 'board/view.ts');
    const midWord = fuzzyMatch('bv', 'abcbvxyz.ts');
    expect((boundaries?.score ?? 0) > (midWord?.score ?? 0)).toBe(true);
  });

  it('treats a camelCase hump as a boundary', () => {
    const camel = fuzzyMatch('bv', 'BoardView.tsx');
    const flat = fuzzyMatch('bv', 'xbxvxxxxx.tsx');
    expect((camel?.score ?? 0) > (flat?.score ?? 0)).toBe(true);
  });
});

describe('rankFuzzy', () => {
  it('prefers a hit in the file name over one in the directory', () => {
    // The everyday case: typing a file's name should not surface every file
    // that merely lives in a directory with those letters.
    expect(
      best('board', ['board/unrelated-file.ts', 'src/BoardView.tsx'])
    ).toBe('src/BoardView.tsx');
  });

  it('prefers the shorter of two equally good matches', () => {
    expect(best('index', ['index.ts', 'a/very/deeply/nested/index.ts'])).toBe(
      'index.ts'
    );
  });

  it('finds an initialism across path segments', () => {
    const candidates = [
      'src/views/BoardView.tsx',
      'packages/server/src/api/branches.ts',
      'docs/notes.md',
    ];
    expect(best('bvt', candidates)).toBe('src/views/BoardView.tsx');
  });

  it('drops candidates that do not match at all', () => {
    expect(rankFuzzy('zzz', ['alpha.ts', 'beta.ts'], (v) => v)).toEqual([]);
  });

  it('honours the limit', () => {
    const candidates = Array.from({ length: 200 }, (_, i) => `file-${i}.ts`);
    expect(rankFuzzy('file', candidates, (v) => v, 10)).toHaveLength(10);
  });

  it('is stable for equally scored candidates', () => {
    // Same query, same input, same order — a list that reshuffles under the
    // cursor is worse than one ordered arbitrarily but consistently.
    const candidates = ['b/x.ts', 'a/x.ts', 'c/x.ts'];
    const first = rankFuzzy('x', candidates, (v) => v).map((r) => r.value);
    const second = rankFuzzy('x', candidates, (v) => v).map((r) => r.value);
    expect(first).toEqual(second);
  });
});
