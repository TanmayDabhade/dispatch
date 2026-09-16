import { render } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import { PriorityIcon } from './PriorityIcon';

function rects(priority: Parameters<typeof PriorityIcon>[0]['priority']) {
  const { container } = render(<PriorityIcon priority={priority} />);
  const svg = container.querySelector('svg');
  return { svg, rects: Array.from(svg.querySelectorAll('rect')) };
}

describe('PriorityIcon', () => {
  test('renders at 14px in Linear’s 16-unit viewBox, filled in currentColor', () => {
    const { svg } = rects('high');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.classList.contains('size-3.5')).toBe(true);
    expect(svg.classList.contains('text-muted-foreground')).toBe(true);
  });

  test('none is three 3×1.5 dashes on the centre line', () => {
    const { svg, rects: bars } = rects('none');
    expect(svg.getAttribute('aria-label')).toBe('No priority');
    expect(bars.map((r) => r.getAttribute('x'))).toEqual([
      '1.5',
      '6.5',
      '11.5',
    ]);
    for (const bar of bars) {
      expect(bar.getAttribute('y')).toBe('7.25');
      expect(bar.getAttribute('width')).toBe('3');
      expect(bar.getAttribute('height')).toBe('1.5');
      expect(bar.getAttribute('rx')).toBe('0.5');
      expect(bar.getAttribute('opacity')).toBe('0.9');
    }
  });

  test.each([
    ['low', 1],
    ['medium', 2],
    ['high', 3],
  ] as const)('%s fills %d of the three ascending bars', (priority, solid) => {
    const { rects: bars } = rects(priority);
    expect(
      bars.map((r) => [r.getAttribute('y'), r.getAttribute('height')])
    ).toEqual([
      ['8', '6'],
      ['5', '9'],
      ['2', '12'],
    ]);
    expect(bars.map((r) => r.getAttribute('fill-opacity'))).toEqual(
      bars.map((_, i) => (i < solid ? null : '0.4'))
    );
  });

  test('urgent is the orange square with a white exclamation', () => {
    const { svg, rects: parts } = rects('urgent');
    expect(svg.getAttribute('aria-label')).toBe('Urgent');
    const [square, stem, dot] = parts;
    expect(square?.getAttribute('fill')).toBe('var(--priority-urgent)');
    expect(square?.getAttribute('rx')).toBe('3');
    expect(square?.getAttribute('width')).toBe('14');
    expect(stem?.getAttribute('fill')).toBe('white');
    expect(stem?.getAttribute('y')).toBe('3.5');
    expect(dot?.getAttribute('fill')).toBe('white');
  });
});
