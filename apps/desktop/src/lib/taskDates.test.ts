import { describe, expect, test } from 'bun:test';

import { formatCreated, formatShortDate } from './taskDates';

const NOW = new Date('2026-09-15T12:00:00.000Z');

describe('formatShortDate', () => {
  test('a date in the current year is month and day only', () => {
    expect(formatShortDate('2026-09-13T12:00:00.000Z', NOW)).toBe('Sep 13');
  });

  test('a date in another year carries the year', () => {
    expect(formatShortDate('2025-01-02T12:00:00.000Z', NOW)).toBe(
      'Jan 2, 2025'
    );
  });

  test('an unparseable value reads as a dash', () => {
    expect(formatShortDate('not a date', NOW)).toBe('—');
    expect(formatShortDate('', NOW)).toBe('—');
  });
});

describe('formatCreated', () => {
  test('prefixes the short date', () => {
    expect(formatCreated('2026-09-13T12:00:00.000Z', NOW)).toBe(
      'Created Sep 13'
    );
  });
});
