import { describe, expect, test } from 'bun:test';

import {
  cacheHitRateDisplay,
  DEFAULT_SPEND_WINDOW,
  parseTags,
  SPEND_WINDOWS,
  spendWindowLabel,
  statusDotClass,
} from './sessionDisplay.ts';

describe('cacheHitRateDisplay', () => {
  test('is the share of input tokens served from cache, rounded to a percent', () => {
    // 8000 cache-read out of (1000 + 8000 + 1000) = 10000 total input = 80%.
    expect(
      cacheHitRateDisplay({
        prompt_tokens: 1000,
        cache_read_tokens: 8000,
        cache_creation_tokens: 1000,
      })
    ).toBe('80%');
  });

  test('returns a dash when there are no input tokens at all', () => {
    expect(
      cacheHitRateDisplay({
        prompt_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      })
    ).toBe('—');
  });

  test('is 0% when nothing was read from cache', () => {
    expect(
      cacheHitRateDisplay({
        prompt_tokens: 500,
        cache_read_tokens: 0,
        cache_creation_tokens: 500,
      })
    ).toBe('0%');
  });
});

describe('parseTags', () => {
  test('parses a JSON array of tags', () => {
    expect(parseTags('["bugfix","refactor"]')).toEqual(['bugfix', 'refactor']);
  });

  test('treats an unparseable string as a single tag', () => {
    expect(parseTags('not json')).toEqual(['not json']);
  });

  test('returns an empty array for null', () => {
    expect(parseTags(null)).toEqual([]);
  });
});

describe('spend windows', () => {
  test('the default window is one of the offered tabs', () => {
    expect(SPEND_WINDOWS).toContain(DEFAULT_SPEND_WINDOW);
  });

  test('a window labels itself in days', () => {
    expect(spendWindowLabel(30)).toBe('30 days');
  });
});

describe('statusDotClass', () => {
  // The dot is a run-state token, never a stock palette literal, so it restates with the
  // theme.
  test('an active session is the review green, an ended one is muted', () => {
    expect(statusDotClass('active')).toBe('bg-state-review');
    expect(statusDotClass('ended')).toBe('bg-muted-foreground/50');
  });
});
