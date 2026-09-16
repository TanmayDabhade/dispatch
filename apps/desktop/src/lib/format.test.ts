import { describe, expect, test } from 'bun:test';

import {
  formatCreated,
  formatRelativeTime,
  formatRelativeTimeFromIso,
  formatShortDate,
  formatTokenCount,
  sessionDisplayName,
} from './format.ts';
import { colorForProject } from './projectColor.ts';

// Placeholder coverage for the vendored lib helpers (R1 vendor slice). Exercises the pure
// display-name/time/color helpers so `bun test` has a non-empty desktop suite; richer
// coverage of the Tauri-backed views lands with R2's Tasks work.
describe('sessionDisplayName', () => {
  test('prefers the session title', () => {
    expect(sessionDisplayName('My session', 'A summary')).toBe('My session');
  });

  test('falls back to the summary when there is no title', () => {
    expect(sessionDisplayName(null, 'A summary')).toBe('A summary');
  });

  test('falls back to a placeholder when neither exists', () => {
    expect(sessionDisplayName(null, null)).toBe('Untitled session');
  });
});

describe('formatRelativeTime', () => {
  test('reports very recent timestamps as "just now"', () => {
    expect(formatRelativeTime(Date.now() / 1000)).toBe('just now');
  });

  test('formats minutes ago', () => {
    expect(formatRelativeTime(Date.now() / 1000 - 5 * 60)).toBe('5m ago');
  });
});

describe('formatRelativeTimeFromIso', () => {
  test('formats a recent ISO timestamp the same way formatRelativeTime does', () => {
    const iso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTimeFromIso(iso)).toBe('5m ago');
  });

  test('returns an em dash for an unparseable timestamp', () => {
    expect(formatRelativeTimeFromIso('not-a-date')).toBe('—');
  });
});

describe('formatTokenCount', () => {
  test('keeps small counts exact', () => {
    expect(formatTokenCount(0)).toBe('0 tok');
    expect(formatTokenCount(950)).toBe('950 tok');
  });

  test('compacts thousands to one decimal', () => {
    expect(formatTokenCount(1000)).toBe('1.0k tok');
    expect(formatTokenCount(12345)).toBe('12.3k tok');
  });
});

describe('colorForProject', () => {
  test('is deterministic for the same project id', () => {
    expect(colorForProject('proj-a')).toBe(colorForProject('proj-a'));
  });

  test('returns one of the 8 project color tokens', () => {
    expect(colorForProject('proj-a')).toMatch(/^var\(--project-color-[1-8]\)$/);
  });
});

// The absolute formatters are re-exported from taskDates.ts (tested there); this pins the
// `@/lib/format` path a view imports them through.
describe('absolute task dates', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  test('formatShortDate and formatCreated are reachable from format', () => {
    expect(formatShortDate('2026-09-13T12:00:00.000Z', now)).toBe('Sep 13');
    expect(formatCreated('2026-09-13T12:00:00.000Z', now)).toBe(
      'Created Sep 13'
    );
  });
});
