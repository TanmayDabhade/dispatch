import type { PrCheckSummary } from '@dispatch/client';
import { render } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { PrChecksPill, REVIEW_VERDICT, StatusPill } from './PrStatusPills';

const checks = (over: Partial<PrCheckSummary> = {}): PrCheckSummary => ({
  passed: 0,
  failed: 0,
  pending: 0,
  total: 0,
  runs: [],
  ...over,
});

test('a repo with no checks renders no pill at all', () => {
  const { container } = render(<PrChecksPill checks={checks()} />);
  expect(container.innerHTML).toBe('');
  const bare = render(<PrChecksPill />);
  expect(bare.container.innerHTML).toBe('');
});

// One failure outranks any pending run; pending outranks a clean pass.
test.each([
  [checks({ passed: 1, failed: 1, total: 3, pending: 1 }), 'red', 'lucide-x'],
  [checks({ passed: 1, pending: 1, total: 2 }), 'amber', 'lucide-clock'],
  [checks({ passed: 2, total: 2 }), 'green', 'lucide-check'],
])('the checks rollup picks its tone and icon: %#', (summary, tone, icon) => {
  const { container } = render(<PrChecksPill checks={summary} />);
  const pill = container.querySelector('[data-slot=pill]');
  expect(pill?.getAttribute('data-tone')).toBe(tone);
  expect(pill?.querySelector('svg')?.getAttribute('class')).toContain(icon);
  expect(pill?.textContent).toBe(`${summary.passed}/${summary.total} checks`);
});

test('a toned pill without an icon leads with the tone dot; muted has neither', () => {
  const { container } = render(
    <>
      <StatusPill tone="green">Reviewed</StatusPill>
      <StatusPill>Commented</StatusPill>
    </>
  );
  const [green, muted] = Array.from(
    container.querySelectorAll('[data-slot=pill]')
  );
  const dot = green?.querySelector<HTMLElement>('span[aria-hidden]');
  expect(dot?.style.backgroundColor).toBe('var(--state-review-fg)');
  expect(green?.className).toContain('h-6');
  expect(muted?.querySelector('span[aria-hidden]')).toBeNull();
  expect(muted?.querySelector('svg')).toBeNull();
});

test('verdict labels are sentence case, never shouted', () => {
  for (const { label } of Object.values(REVIEW_VERDICT)) {
    expect(label).toMatch(/^[A-Z][a-z]+(?: [a-z]+)*$/);
  }
  expect(REVIEW_VERDICT.CHANGES_REQUESTED.label).toBe('Changes requested');
});
