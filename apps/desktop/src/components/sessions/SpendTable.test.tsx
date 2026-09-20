import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { SpendTable } from './SpendTable';

const rows = [
  { key: 'alpha', label: 'Alpha', sessionCount: 3, totalCostUsd: 1.5 },
  { key: 'beta', label: 'Beta', sessionCount: 1, totalCostUsd: 0.25 },
];

// Clickable rows are focusable buttons the keyboard can toggle, and the active
// filter is exposed as a pressed state rather than a grid-only `aria-selected`.
test('clickable rows toggle from the keyboard and expose the active filter', () => {
  const clicked: string[] = [];
  render(
    <SpendTable
      columnLabel="Project"
      rows={rows}
      emptyMessage="No spend"
      onRowClick={(key) => clicked.push(key)}
      activeKey="alpha"
    />
  );
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(2);
  expect(buttons[0]?.getAttribute('tabindex')).toBe('0');
  expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
  expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
  expect(buttons[0]?.hasAttribute('aria-selected')).toBe(false);

  fireEvent.keyDown(buttons[1], { key: 'Enter' });
  fireEvent.keyDown(buttons[1], { key: ' ' });
  fireEvent.keyDown(buttons[1], { key: 'a' });
  fireEvent.click(buttons[0]);
  expect(clicked).toEqual(['beta', 'beta', 'alpha']);
});

// Without a click handler the table is plain text: no buttons, no tab stops.
test('rows are inert when no click handler is given', () => {
  render(
    <SpendTable columnLabel="Model" rows={rows} emptyMessage="No spend" />
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(
    screen.getByText('Alpha').closest('tr')?.hasAttribute('tabindex')
  ).toBe(false);
});
