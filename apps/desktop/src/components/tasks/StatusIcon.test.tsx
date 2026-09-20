import { render } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import { pieDashOffset, statusColor, StatusIcon } from './StatusIcon';

// The inner pie is the circle with the 4-wide stroke; the outer ring is the 1.5 one.
function circles(status: string) {
  const { container } = render(<StatusIcon status={status} />);
  const svg = container.querySelector('svg');
  const all = Array.from(svg.querySelectorAll('circle'));
  return {
    svg,
    ring: all.find((c) => c.getAttribute('stroke-width') === '1.5'),
    pie: all.find((c) => c.getAttribute('stroke-width') === '4'),
    disk: all.find((c) => c.getAttribute('stroke-width') === '6'),
    cutout: svg.querySelector('path'),
  };
}

describe('StatusIcon', () => {
  test('renders at 14px in Linear’s 14-unit viewBox', () => {
    const { svg } = circles('ready');
    expect(svg.getAttribute('viewBox')).toBe('0 0 14 14');
    expect(svg.classList.contains('size-3.5')).toBe(true);
    expect(svg.getAttribute('fill')).toBe('none');
  });

  test('a caller can override the size class', () => {
    const { container } = render(
      <StatusIcon status="ready" className="size-4" />
    );
    const svg = container.querySelector('svg');
    expect(svg.classList.contains('size-4')).toBe(true);
    expect(svg.classList.contains('size-3.5')).toBe(false);
  });

  test('draft is the dashed backlog ring with an empty pie', () => {
    const { svg, ring, pie } = circles('draft');
    expect(ring?.getAttribute('stroke-dasharray')).toBe('1.4 1.74');
    expect(ring?.getAttribute('stroke-dashoffset')).toBe('0.65');
    expect(pie?.getAttribute('stroke-dashoffset')).toBe(
      String(pieDashOffset(0))
    );
    expect(svg.classList.contains('text-status-backlog')).toBe(true);
  });

  test('ready is the solid todo ring with an empty pie', () => {
    const { svg, ring, pie } = circles('ready');
    expect(ring?.getAttribute('r')).toBe('6');
    expect(ring?.getAttribute('stroke-dasharray')).toBe('3.14 0');
    expect(ring?.getAttribute('stroke-dashoffset')).toBe('-0.7');
    expect(pie?.getAttribute('r')).toBe('2');
    expect(pie?.getAttribute('stroke-dasharray')).toBe(
      '12.189379495928398 24.378758991856795'
    );
    expect(pie?.getAttribute('stroke-dashoffset')).toBe('12.189379495928398');
    expect(pie?.getAttribute('transform')).toBe('rotate(-90 7 7)');
    expect(svg.classList.contains('text-status-todo')).toBe(true);
  });

  test.each([
    ['working', 0.5, 'text-status-progress'],
    ['review', 0.75, 'text-status-green'],
    ['landing', 0.9, 'text-teal'],
  ])('%s exposes %d of the pie', (status, fraction, colorClass) => {
    const { svg, pie } = circles(status);
    expect(Number(pie?.getAttribute('stroke-dashoffset'))).toBeCloseTo(
      pieDashOffset(fraction),
      6
    );
    expect(svg.classList.contains(colorClass)).toBe(true);
  });

  test('the 50% offset is Linear’s 6.0947', () => {
    expect(pieDashOffset(0.5)).toBeCloseTo(6.0947, 3);
    expect(pieDashOffset(0.75)).toBeCloseTo(3.0473, 3);
    expect(pieDashOffset(1)).toBe(0);
  });

  test('landed is the indigo disk with a check cut out in the panel colour', () => {
    const { svg, pie, disk, cutout } = circles('landed');
    expect(pie).toBeUndefined();
    expect(disk?.getAttribute('r')).toBe('3');
    expect(disk?.getAttribute('stroke-dasharray')).toBe(
      '18.84955592153876 37.69911184307752'
    );
    expect(disk?.getAttribute('stroke-dashoffset')).toBe('0');
    expect(cutout?.getAttribute('fill')).toBe('var(--surface-page)');
    expect(cutout?.getAttribute('d')?.startsWith('M10.951 4.24896')).toBe(true);
    expect(svg.classList.contains('text-status-done')).toBe(true);
  });

  test('dropped is the cancelled disk with an × cut out', () => {
    const { svg, disk, cutout } = circles('dropped');
    expect(disk).toBeDefined();
    expect(svg.getAttribute('data-status-shape')).toBe('cancelled');
    expect(cutout?.getAttribute('d')?.startsWith('M10.951')).toBe(false);
    expect(svg.classList.contains('text-status-cancelled')).toBe(true);
  });

  test('blocked overrides the colour but keeps the shape', () => {
    const { container } = render(<StatusIcon status="working" blocked />);
    const svg = container.querySelector('svg');
    expect(svg.classList.contains('text-status-blocked')).toBe(true);
    expect(svg.classList.contains('text-status-progress')).toBe(false);
    expect(svg.getAttribute('data-status-shape')).toBe('pie');
  });

  test('a custom status falls back to the empty todo ring', () => {
    const { svg, pie } = circles('triage');
    expect(pie?.getAttribute('stroke-dashoffset')).toBe('12.189379495928398');
    expect(svg.classList.contains('text-status-todo')).toBe(true);
  });

  test('statusColor is the CSS variable a group header tints with', () => {
    expect(statusColor('working')).toBe('var(--status-progress)');
    expect(statusColor('landed')).toBe('var(--status-done)');
    expect(statusColor('triage')).toBe('var(--status-todo)');
  });
});
