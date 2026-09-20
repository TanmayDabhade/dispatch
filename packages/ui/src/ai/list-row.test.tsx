import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { ListRow } from './list-row';

// Slots must land in Linear's order — checkbox, priority, id, status, title, then the
// right-aligned group — or a row reads differently from the reference.
test('slots render in reading order', () => {
  const { container } = render(
    <ListRow
      leading={<span>P</span>}
      id="DIS-5"
      status={<span>S</span>}
      title="Cache the search index"
      crumb="Search"
      trailing={<span>pill</span>}
      date="Sep 13"
      onSelectToggle={() => {}}
    />
  );
  const order = [...container.querySelectorAll('[data-slot^="list-row-"]')].map(
    (el) => el.getAttribute('data-slot')
  );
  expect(order).toEqual([
    'list-row-select',
    'list-row-leading',
    'list-row-id',
    'list-row-status',
    'list-row-title',
    'list-row-crumb',
    'list-row-trailing',
    'list-row-date',
  ]);
});

test('the row is 36px with no background and a neutral hover', () => {
  const { container } = render(<ListRow title="Row" />);
  const row = container.firstElementChild as HTMLElement;
  const classes = row.className.split(/\s+/);
  expect(classes).toContain('h-9');
  expect(classes).toContain('hover:bg-surface-hover');
  expect(classes.some((c) => c.startsWith('bg-') && !c.includes('hover'))).toBe(
    false
  );
});

// The checkbox exists only for selectable rows, is invisible at rest, and is shown
// whenever the row is hovered, focused or selected — never through the accent.
test('the checkbox is hidden at rest and shown when focused or selected', () => {
  const { container: plain } = render(<ListRow title="Row" />);
  expect(plain.querySelector('[data-slot="list-row-select"]')).toBeNull();

  const { container: rest } = render(
    <ListRow title="Row" onSelectToggle={() => {}} />
  );
  const restBox = rest.querySelector('[data-slot="list-row-select"]');
  expect(restBox?.className).toContain('opacity-0');
  expect(restBox?.className).toContain('group-hover/row:opacity-100');

  for (const props of [{ focused: true }, { selected: true }]) {
    const { container } = render(
      <ListRow title="Row" onSelectToggle={() => {}} {...props} />
    );
    const box = container.querySelector('[data-slot="list-row-select"]');
    expect(box?.className.split(/\s+/)).toContain('opacity-100');
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('bg-surface-hover');
    expect(row.className).not.toContain('accent');
  }
});

test('toggling the checkbox does not open the row', () => {
  let opened = 0;
  let toggled: boolean | undefined;
  render(
    <ListRow
      title="Row"
      onClick={() => opened++}
      onSelectToggle={(next) => (toggled = next)}
    />
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select' }));
  expect(toggled).toBe(true);
  expect(opened).toBe(0);
});

test('a clickable row activates on Enter and Space', () => {
  let opened = 0;
  render(<ListRow title="Row" onClick={() => opened++} />);
  const row = screen.getByRole('row');
  expect(row.getAttribute('tabindex')).toBe('0');
  fireEvent.keyDown(row, { key: 'Enter' });
  fireEvent.keyDown(row, { key: ' ' });
  fireEvent.keyDown(row, { key: 'j' });
  expect(opened).toBe(2);
});

test('a nested row is indented with a tree connector', () => {
  const { container } = render(<ListRow title="Child" indent={1} />);
  const row = container.firstElementChild as HTMLElement;
  expect(row.getAttribute('data-indent')).toBe('1');
  expect(row.className.split(/\s+/)).toContain('ml-6');
  const connector = container.querySelector('[data-slot="list-row-connector"]');
  expect(connector?.className).toContain('border-l-[0.5px]');

  const { container: top } = render(<ListRow title="Parent" />);
  expect(top.querySelector('[data-slot="list-row-connector"]')).toBeNull();
});

test('the id is sans with Linear tracking, not mono', () => {
  const { container } = render(<ListRow title="Row" id="DIS-5" />);
  const id = container.querySelector('[data-slot="list-row-id"]');
  expect(id?.className).toContain('tracking-(--id-tracking)');
  expect(id?.className).not.toContain('font-mono');
  expect(id?.className).not.toContain('text-muted-foreground/70');
});

test('a nested row dims its id', () => {
  const { container } = render(<ListRow title="Child" id="DIS-6" indent={1} />);
  const id = container.querySelector('[data-slot="list-row-id"]');
  expect(id?.className).toContain('text-muted-foreground/70');
});
