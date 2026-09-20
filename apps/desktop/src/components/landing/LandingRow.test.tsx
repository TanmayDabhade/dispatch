import type { LandingRow as LandingRowData, RepoPr } from '@dispatch/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';

import { ToastProvider } from '../shell/Toasts';
import { LandingRow } from './LandingRow';

const pr = (over: Partial<RepoPr> = {}): RepoPr => ({
  number: 123,
  title: 'Add the thing',
  url: 'https://github.com/o/r/pull/123',
  headRefName: 'feat/thing',
  baseRefName: 'main',
  author: 'Ada Lovelace',
  isDraft: false,
  updatedAt: '2026-09-15T00:00:00.000Z',
  headRefOid: 'abc',
  state: 'OPEN',
  isCrossRepository: false,
  headRepositoryOwner: 'o',
  reviewDecision: 'APPROVED',
  mergeable: 'MERGEABLE',
  checks: { passed: 2, failed: 0, pending: 0, total: 2, runs: [] },
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  ...over,
});

const row = (over: Partial<LandingRowData> = {}): LandingRowData => ({
  id: 'pr-123',
  kind: 'pr',
  title: 'Add the thing',
  pr: pr(),
  gate: { status: 'ready', detail: 'Ready to land' },
  ...over,
});

function Wrap({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const NOW = Date.parse('2026-09-15T02:00:00.000Z');

function renderRow(
  data: LandingRowData,
  handlers: Partial<{
    onFilterGate: (gate: string) => void;
    onOpenPr: (n: number) => void;
    onFilterAuthor: (a: string) => void;
  }> = {}
) {
  return render(
    <Wrap>
      <LandingRow
        row={data}
        queueRows={[data]}
        now={NOW}
        onFilterAuthor={handlers.onFilterAuthor ?? (() => undefined)}
        onFilterGate={handlers.onFilterGate ?? (() => undefined)}
        onOpenRun={() => undefined}
        onOpenPr={handlers.onOpenPr ?? (() => undefined)}
        client={null}
        port={undefined}
        onRetryQueue={() => Promise.resolve()}
      />
    </Wrap>
  );
}

test('the PR number sits in the id slot as sans text, not mono', () => {
  const { container } = renderRow(row());
  const id = container.querySelector('[data-slot=list-row-id]');
  expect(id?.textContent).toBe('#123');
  expect(id?.className).not.toContain('font-mono');
  expect(
    container.querySelector('[data-slot=list-row]')?.getAttribute('role')
  ).toBe('listitem');
});

test('the gate pill leads with the gate colour and filters instead of opening', () => {
  const onFilterGate = mock((_gate: string) => undefined);
  const onOpenPr = mock((_n: number) => undefined);
  const { container } = renderRow(row(), { onFilterGate, onOpenPr });

  const pill = container.querySelector('[data-slot=label-pill]');
  expect(pill?.textContent).toBe('Ready to land');
  const dot = pill?.querySelector<HTMLElement>('span[aria-hidden]');
  expect(dot?.style.backgroundColor).toBe('var(--state-review-fg)');

  fireEvent.click(pill);
  expect(onFilterGate).toHaveBeenCalledWith('ready');
  expect(onOpenPr).not.toHaveBeenCalled();
});

test('clicking the row itself opens the PR', () => {
  const onOpenPr = mock((_n: number) => undefined);
  const { container } = renderRow(row(), { onOpenPr });
  fireEvent.click(container.querySelector('[data-slot=list-row-title]'));
  expect(onOpenPr).toHaveBeenCalledWith(123);
});

test('the verdict is a toned status pill and the author an 18px avatar', () => {
  const onFilterAuthor = mock((_a: string) => undefined);
  const { container } = renderRow(row(), { onFilterAuthor });

  const verdict = Array.from(
    container.querySelectorAll('[data-slot=pill][data-tone]')
  ).find((el) => el.textContent === 'Approved');
  expect(verdict?.getAttribute('data-tone')).toBe('green');

  const avatar = screen.getByRole('img', { name: 'Ada Lovelace' });
  expect(avatar.getAttribute('data-slot')).toBe('initials-avatar');
  expect(avatar.textContent).toBe('AL');

  fireEvent.click(avatar);
  expect(onFilterAuthor).toHaveBeenCalledWith('Ada Lovelace');
});

test('the date slot reads relative time and the crumb names the branches', () => {
  const { container } = renderRow(row());
  expect(
    container.querySelector('[data-slot=list-row-date]')?.textContent
  ).toBe('2h ago');
  expect(
    container.querySelector('[data-slot=list-row-crumb]')?.textContent
  ).toContain('feat/thing → main');
});
