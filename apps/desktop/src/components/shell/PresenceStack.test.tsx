import type { PresenceEntry } from '@dispatch/client';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { initialsFor, PresenceStack, presenceLine } from './PresenceStack';
import { TooltipProvider } from '@/ui/tooltip';

const person = (
  handle: string,
  over: Partial<PresenceEntry> = {}
): PresenceEntry => ({
  handle,
  ref: `human:${handle}`,
  connections: 1,
  since: '2026-09-22T12:00:00.000Z',
  runs: [],
  ...over,
});

function mount(presence: PresenceEntry[]) {
  return render(
    <TooltipProvider>
      <PresenceStack presence={presence} />
    </TooltipProvider>
  );
}

test('renders nothing for a solo project', () => {
  // A lone chip reading "you are here" is noise on every solo project.
  const { container } = mount([person('wyat')]);
  expect(container.querySelector('[data-slot=presence-stack]')).toBeNull();
});

test('shows everyone once a teammate is here', () => {
  mount([person('ada'), person('wyat')]);
  const stack = screen.getByRole('group', { name: '2 people here' });
  expect(stack.textContent).toContain('AD');
  expect(stack.textContent).toContain('WY');
});

test('collapses past three into a count', () => {
  mount(['ada', 'bob', 'cy', 'dee', 'eve'].map((h) => person(h)));
  const stack = screen.getByRole('group', { name: '5 people here' });
  expect(stack.textContent).toContain('+2');
  expect(stack.textContent).not.toContain('DE');
});

test('initials come from both halves of a dotted handle', () => {
  expect(initialsFor('ada.lovelace')).toBe('AL');
  expect(initialsFor('grace-hopper')).toBe('GH');
  expect(initialsFor('ada')).toBe('AD');
  expect(initialsFor('x')).toBe('X');
});

test('a tooltip line says what someone is running', () => {
  expect(presenceLine(person('ada', { runs: ['r-1'] }))).toContain(
    'running 1 agent'
  );
  expect(presenceLine(person('ada', { runs: ['r-1', 'r-2'] }))).toContain(
    'running 2 agents'
  );
  expect(presenceLine(person('ada'))).toContain('not running anything');
});
