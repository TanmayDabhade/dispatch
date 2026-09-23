import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';
import type { ReactElement } from 'react';

import { DaemonSection } from './DaemonSection';
import { dataWith, testProject as project } from './fixtures.test-helper';

const data = dataWith();

// The section now holds the board sync group, which fetches its own status.
function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

// The old copy said only "this view is read-only" — the reason matters, because
// a status is stored by name in every task file on disk.
test('the read-only statuses list gives the real reason', () => {
  render(<DaemonSection activeProject={project} data={data} />);
  expect(screen.getByText(/every task file/i)).toBeDefined();
});

test('a failed daemon start shows the captured detail', () => {
  render(
    <DaemonSection
      activeProject={project}
      data={{ ...data, portError: true, portErrorDetail: 'port 7777 in use' }}
    />
  );
  expect(screen.getByText(/port 7777 in use/)).toBeDefined();
});

// The daemon row reads its state as a sentence-case word beside the dot.
test('the daemon status reads Running while a client is up', () => {
  render(<DaemonSection activeProject={project} data={data} />);
  expect(screen.getByText('Running')).toBeDefined();
  expect(screen.getByText('dispatchd')).toBeDefined();
});

test('the tracker statuses render as pills under a sentence-case heading', () => {
  render(<DaemonSection activeProject={project} data={data} />);
  expect(screen.getByRole('heading', { name: 'Tracker config' })).toBeDefined();
  expect(screen.getByText('in-progress').getAttribute('data-slot')).toBe(
    'pill'
  );
});
