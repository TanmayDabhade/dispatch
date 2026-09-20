import { describe, expect, test } from 'bun:test';

import { colorForLabel } from './labelColor';

describe('colorForLabel', () => {
  test('is stable for the same label', () => {
    expect(colorForLabel('ui')).toBe(colorForLabel('ui'));
  });

  test('draws from the eight categorical tokens', () => {
    for (const label of ['ui', 'kanban', 'dispatchd', 'merge-queue', '']) {
      expect(colorForLabel(label)).toMatch(/^var\(--project-color-[1-8]\)$/);
    }
  });
});
