import type { TaskListItem } from '@dispatch/core/browser';
import { render } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import type { CockpitItem } from '../../lib/cockpit';
import { CockpitRow } from './CockpitRow';

const ME = 'human:wyat';

function task(id: string, status: string): TaskListItem {
  return {
    meta: {
      id,
      title: `Title ${id}`,
      status,
      kind: 'task',
      parent: null,
      milestone: null,
      blockedBy: [],
      labels: [],
      priority: 'medium',
      assignee: ME,
      created: '2026-09-01T00:00:00.000Z',
      updated: '2026-09-10T00:00:00.000Z',
      dueDate: null,
      cycle: null,
    },
  } as unknown as TaskListItem;
}

function renderRow(
  item: CockpitItem,
  landing?: Parameters<typeof CockpitRow>[0]['landing']
) {
  return render(
    <div role="grid">
      <CockpitRow
        item={item}
        focused={false}
        plan={undefined}
        landing={landing}
        onActivate={() => {}}
      />
    </div>
  );
}

function badge(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot=landing-badge]');
}

describe('CockpitRow landing badge', () => {
  test('a teammate’s started task in the queue reads Landing', () => {
    const { container } = renderRow(
      {
        kind: 'started',
        key: 't-1',
        taskId: 't-1',
        owner: ME,
        task: task('t-1', 'In Review'),
      },
      'verifying'
    );
    expect(badge(container)?.textContent).toBe('Landing');
    expect(badge(container)?.getAttribute('title')).toBe('Landing · verifying');
  });

  test('an in-review row that is already queued says so beside its reason', () => {
    const { container } = renderRow(
      {
        kind: 'needs',
        key: 'needs:t-2',
        taskId: 't-2',
        owner: ME,
        reason: 'in-review',
        task: task('t-2', 'In Review'),
        run: undefined,
        since: '2026-09-10T00:00:00.000Z',
      },
      'waiting-github'
    );
    expect(container.textContent).toContain('In review');
    expect(badge(container)?.getAttribute('data-queue-state')).toBe(
      'waiting-github'
    );
  });

  test('no queue entry, no badge', () => {
    const { container } = renderRow({
      kind: 'started',
      key: 't-3',
      taskId: 't-3',
      owner: ME,
      task: task('t-3', 'In Progress'),
    });
    expect(badge(container)).toBeNull();
  });
});
