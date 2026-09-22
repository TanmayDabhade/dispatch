import { describe, expect, it } from 'bun:test';

import { runsFromNeedle, runsFromPositions } from './highlight';

// The text a run-splitter is given back unchanged, whatever it did in between.
function rejoin(runs: { text: string }[]): string {
  return runs.map((run) => run.text).join('');
}

describe('runsFromPositions', () => {
  it('marks the matched characters', () => {
    expect(runsFromPositions('abc', [1])).toEqual([
      { text: 'a', hit: false },
      { text: 'b', hit: true },
      { text: 'c', hit: false },
    ]);
  });

  it('merges adjacent matches into one run', () => {
    expect(runsFromPositions('abcd', [1, 2])).toEqual([
      { text: 'a', hit: false },
      { text: 'bc', hit: true },
      { text: 'd', hit: false },
    ]);
  });

  it('handles a match at each end', () => {
    expect(runsFromPositions('abc', [0, 2])).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: false },
      { text: 'c', hit: true },
    ]);
  });

  it('is one plain run when nothing matched', () => {
    expect(runsFromPositions('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });

  it('keeps a surrogate pair whole', () => {
    // Splitting between the two halves would render a pair of replacement
    // characters where the emoji was. Checking for a lone surrogate at either
    // edge of a run is the direct form of that: no run may begin with a low
    // surrogate or end with a high one.
    const lonelySurrogate = (text: string): boolean => {
      const first = text.charCodeAt(0);
      const last = text.charCodeAt(text.length - 1);
      return (
        (first >= 0xdc00 && first <= 0xdfff) ||
        (last >= 0xd800 && last <= 0xdbff)
      );
    };
    for (const positions of [[0], [1], [2], [3], [0, 3]]) {
      const runs = runsFromPositions('a👍b', positions);
      expect(rejoin(runs)).toBe('a👍b');
      expect(runs.some((run) => lonelySurrogate(run.text))).toBe(false);
    }
  });

  it('keeps UTF-16 offsets aligned past an astral character', () => {
    // '👍' occupies indices 0 and 1, so 'b' is at index 3, not 2. A walker
    // that counted code points would mark the wrong character here.
    const text = '👍ab';
    const runs = runsFromPositions(text, [text.indexOf('b')]);
    expect(runs.filter((run) => run.hit).map((run) => run.text)).toEqual(['b']);
  });

  it('never loses or duplicates text', () => {
    const text = 'src/views/BoardView.tsx';
    expect(rejoin(runsFromPositions(text, [0, 4, 10, 11]))).toBe(text);
  });
});

describe('runsFromNeedle', () => {
  it('marks every occurrence', () => {
    expect(runsFromNeedle('ababa', 'a')).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: false },
      { text: 'a', hit: true },
      { text: 'b', hit: false },
      { text: 'a', hit: true },
    ]);
  });

  it('ignores case while preserving it in the output', () => {
    const runs = runsFromNeedle('Hello HELLO', 'hello');
    expect(runs.filter((run) => run.hit).map((run) => run.text)).toEqual([
      'Hello',
      'HELLO',
    ]);
  });

  it('highlights nothing for an empty needle', () => {
    expect(runsFromNeedle('abc', '')).toEqual([{ text: 'abc', hit: false }]);
  });

  it('is one plain run when there is no match', () => {
    expect(runsFromNeedle('abc', 'zz')).toEqual([{ text: 'abc', hit: false }]);
  });

  it('never loses or duplicates text', () => {
    const text = 'the quick brown fox';
    expect(rejoin(runsFromNeedle(text, 'o'))).toBe(text);
  });
});
