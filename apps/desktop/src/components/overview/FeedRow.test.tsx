import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'bun:test';

import type { FeedRowModel } from '../../lib/controlRoom';
import { FeedRow, type FeedRowActions, rowActions } from './FeedRow';

function row(over: Partial<FeedRowModel> = {}): FeedRowModel {
  return {
    runId: 'r-1',
    taskId: 't-1',
    title: 'Cache the search index',
    state: 'working',
    epicTitle: 'Search',
    priority: 'high',
    since: '2026-08-10T00:00:00.000Z',
    activity: '2 of 3 subagents running',
    attention: null,
    fixLoop: null,
    ...over,
  };
}

function actionsWith(log: string[]): FeedRowActions {
  return {
    onOpen: (r) => log.push(`open:${r.runId}`),
    onApprove: (r, allow) => log.push(`approve:${r.runId}:${allow}`),
    onRetry: (r) => log.push(`retry:${r.runId}`),
    onReview: (r) => log.push(`review:${r.runId}`),
    onCancelLanding: (r) => log.push(`cancel:${r.runId}`),
    onRule: (r) => log.push(`rule:${r.runId}`),
    onStopFixLoop: (r) => log.push(`stop:${r.runId}`),
  };
}

test('a row is a 36px ListRow: priority glyph, sans id, state glyph, title, activity crumb, epic pill, elapsed', () => {
  const { container } = render(
    <FeedRow row={row()} actions={actionsWith([])} />
  );
  const listRow = container.querySelector('[data-slot="list-row"]');
  expect(listRow).not.toBeNull();
  expect(listRow?.className).toContain('h-9');
  expect(
    listRow?.querySelector('[data-slot="list-row-leading"] svg')
  ).not.toBeNull();
  const id = listRow?.querySelector('[data-slot="list-row-id"]');
  expect(id?.textContent).toBe('t-1');
  expect(id?.className).not.toContain('font-mono');
  expect(
    listRow?.querySelector('[data-slot="list-row-status"] svg')
  ).not.toBeNull();
  expect(
    listRow?.querySelector('[data-slot="list-row-title"]')?.textContent
  ).toContain('Cache the search index');
  expect(
    listRow?.querySelector('[data-slot="list-row-crumb"]')?.textContent
  ).toContain('2 of 3 subagents running');
  expect(within(listRow as HTMLElement).getByText('Search')).toBeDefined();
  expect(listRow?.querySelector('[data-slot="list-row-date"]')).not.toBeNull();
  expect(
    listRow?.querySelector('[data-slot="initials-avatar"]')
  ).not.toBeNull();
  // A calm row carries no attention pill and no inline verbs.
  expect(listRow?.querySelector('[data-slot="label-pill"]')).toBeNull();
  expect(listRow?.querySelector('[data-slot="pill-button"]')).toBeNull();
});

test('an urgent row carries the Needs you pill (amber) and its reason as the crumb', () => {
  const { container } = render(
    <FeedRow
      row={row({
        state: 'approve',
        attention: { reason: 'Wants to run Bash', detail: null },
      })}
      actions={actionsWith([])}
    />
  );
  const pill = container.querySelector('[data-slot="label-pill"]');
  expect(pill?.textContent).toBe('Needs you');
  expect(pill?.getAttribute('title')).toBe('Wants to run Bash');
  expect(container.textContent).toContain('Wants to run Bash');
  // The title is not tinted by urgency — the pill carries it.
  expect(
    container.querySelector('[data-slot="list-row-title"]')?.className
  ).not.toContain('text-state-waiting');
});

test('a broken row carries a red Broken pill', () => {
  const { container } = render(
    <FeedRow
      row={row({
        state: 'failed',
        attention: { reason: 'boom', detail: null },
      })}
      actions={actionsWith([])}
    />
  );
  const pill = container.querySelector('[data-slot="label-pill"]');
  expect(pill?.textContent).toBe('Broken');
});

test('the single hover-revealed pill is the primary verb and does not open the row', () => {
  const log: string[] = [];
  render(
    <FeedRow row={row({ state: 'approve' })} actions={actionsWith(log)} />
  );
  const approve = screen.getByRole('button', { name: 'Approve' });
  expect(approve.className).toContain('opacity-0');
  expect(approve.className).toContain('group-hover/row:opacity-100');
  fireEvent.click(approve);
  expect(log).toEqual(['approve:r-1:true']);
});

test('clicking the row opens it', () => {
  const log: string[] = [];
  render(<FeedRow row={row()} actions={actionsWith(log)} />);
  fireEvent.click(screen.getByRole('row'));
  expect(log).toEqual(['open:r-1']);
});

test('the context menu holds Open run plus the state verbs', async () => {
  const log: string[] = [];
  render(<FeedRow row={row({ state: 'failed' })} actions={actionsWith(log)} />);
  fireEvent.contextMenu(screen.getByRole('row'), { clientX: 10, clientY: 10 });
  const menu = await screen.findByRole('menu');
  const labels = within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim());
  expect(labels).toEqual(['Open run', 'Retry', 'Read the error']);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Retry' }));
  expect(log).toEqual(['retry:r-1']);
});

test('rowActions: the verbs per state, and Stop loop while a fix loop runs', () => {
  const log: string[] = [];
  const actions = actionsWith(log);
  const labels = (r: FeedRowModel) =>
    rowActions(r, actions).menu.map((a) => a.label);
  expect(labels(row({ state: 'answer' }))).toEqual(['Answer']);
  expect(labels(row({ state: 'approve' }))).toEqual(['Approve', 'Deny']);
  expect(labels(row({ state: 'ruling' }))).toEqual(['Rule on findings']);
  expect(labels(row({ state: 'review' }))).toEqual(['Review']);
  expect(labels(row({ state: 'landing' }))).toEqual(['Cancel landing']);
  expect(labels(row({ state: 'working' }))).toEqual([]);
  expect(rowActions(row({ state: 'landing' }), actions).primary).toBeNull();
  expect(
    labels(
      row({
        state: 'fixing',
        fixLoop: {
          state: 'implementing',
          round: 2,
          cap: 5,
        } as unknown as FeedRowModel['fixLoop'],
      })
    )
  ).toEqual(['Stop loop']);
});
