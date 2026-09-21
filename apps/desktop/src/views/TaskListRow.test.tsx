import type { TaskDoc } from '@dispatch/core/browser';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';
import { useState } from 'react';

import { testConfig } from '../components/settings/fixtures.test-helper';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import { DEFAULT_TASKS_DISPLAY } from '../lib/tasksPrefs';
import {
  handleTaskListKeyDown,
  type ListRowPassthrough,
  type OpenPicker,
  TaskListRow,
} from './TaskListRow';

function task(id: string, title: string, labels: string[] = []): TaskDoc {
  return {
    meta: {
      id,
      title,
      status: 'ready',
      kind: 'task',
      priority: 'medium',
      parent: null,
      milestone: null,
      labels,
      assignee: 'none',
      blockedBy: [],
      writes: [],
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-10T00:00:00.000Z',
    },
    body: '',
  } as unknown as TaskDoc;
}

const TASKS = [
  task('t-1', 'Cache the index', ['ui']),
  task('t-2', 'Ship the pass', ['api', 'infra']),
];

/** A `DispatchProjectData` stub carrying only what the row reads, logging label patches. */
function rowData(updates: [string, unknown][]): DispatchProjectData {
  return {
    config: testConfig,
    tasks: TASKS,
    epics: [],
    latestRunByTaskId: new Map(),
    liveRunStateByTaskId: new Map(),
    attentionByTaskId: new Map(),
    fixLoops: new Map(),
    handleUpdate: (id: string, patch: unknown) => {
      updates.push([id, patch]);
      return Promise.resolve();
    },
    moveTaskStatus: () => Promise.resolve(),
  } as unknown as DispatchProjectData;
}

// A popover positions itself a microtask after mount (floating-ui), so anything that opens
// or drives one runs inside an async `act` that lets that settle.
async function settle(work: () => void) {
  await act(async () => {
    work();
    await Promise.resolve();
  });
}

/** The two rows inside a `role="grid"` container wired to `handleTaskListKeyDown`, with the
 * picker and cursor state a list view would own. */
function Grid({
  updates,
  cursor,
  rowProps,
}: {
  updates: [string, unknown][];
  cursor: string[];
  rowProps?: ListRowPassthrough;
}) {
  const [picker, setPicker] = useState<OpenPicker | null>(null);
  const [focusedTaskId, setFocused] = useState<string | null>('t-1');
  const data = rowData(updates);
  return (
    <div
      role="grid"
      data-slot="grid"
      onKeyDown={(e) =>
        handleTaskListKeyDown(e, {
          orderedIds: TASKS.map((t) => t.meta.id),
          focusedTaskId,
          setFocusedTaskId: (id) => {
            cursor.push(id ?? '');
            setFocused(id);
          },
          onOpen: () => {},
          onPeek: () => {},
          setPicker,
          onEscape: () => false,
        })
      }
    >
      {TASKS.map((doc) => (
        <TaskListRow
          key={doc.meta.id}
          doc={doc}
          data={data}
          prefs={DEFAULT_TASKS_DISPLAY}
          picker={picker}
          onPickerChange={setPicker}
          selected={false}
          focused={focusedTaskId === doc.meta.id}
          onOpen={() => {}}
          onFocus={() => {}}
          rowProps={rowProps}
        />
      ))}
    </div>
  );
}

function grid(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot=grid]');
  if (el === null) throw new Error('no grid');
  return el;
}

function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot=list-row]')
  );
}

test('l on the focused row mounts the label picker over the project vocabulary', async () => {
  render(<Grid updates={[]} cursor={[]} />);
  expect(screen.queryByRole('button', { name: 'Change labels' })).toBeNull();
  await settle(() => {
    fireEvent.keyDown(grid(), { key: 'l' });
  });
  // The trigger sits in the focused row's trailing group, after its pills.
  const trigger = screen.getByRole('button', { name: 'Change labels' });
  expect(rows()[0]?.contains(trigger)).toBe(true);
  expect(screen.getByPlaceholderText('Label…')).not.toBeNull();
  const options = screen.getAllByRole('option').map((o) => ({
    label: o.textContent,
    checked: o.querySelector('svg.lucide-check') !== null,
  }));
  expect(options).toEqual([
    { label: 'api', checked: false },
    { label: 'infra', checked: false },
    { label: 'ui', checked: true },
  ]);
});

test('toggling a label patches the whole list and leaves the picker open', async () => {
  const updates: [string, unknown][] = [];
  render(<Grid updates={updates} cursor={[]} />);
  await settle(() => {
    fireEvent.keyDown(grid(), { key: 'l' });
  });
  await settle(() => {
    const option = screen.getByRole('option', { name: /^api$/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
  });
  expect(updates).toEqual([['t-1', { labels: ['ui', 'api'] }]]);
  expect(screen.getByPlaceholderText('Label…')).not.toBeNull();
});

test('j typed in the picker search does not move the cursor', async () => {
  const cursor: string[] = [];
  render(<Grid updates={[]} cursor={cursor} />);
  await settle(() => {
    fireEvent.keyDown(grid(), { key: 'l' });
  });
  const input = screen.getByPlaceholderText('Label…');
  await settle(() => {
    fireEvent.keyDown(input, { key: 'j' });
  });
  expect(cursor).toEqual([]);
  expect(rows()[0]?.dataset['focused']).toBe('true');
  // The bare key on the grid itself still moves it.
  fireEvent.keyDown(grid(), { key: 'j' });
  expect(cursor).toEqual(['t-2']);
});

test('rowProps land on the row element', () => {
  render(
    <Grid
      updates={[]}
      cursor={[]}
      rowProps={{ 'data-probe': 'x' } as ListRowPassthrough}
    />
  );
  for (const row of rows()) {
    expect(row.dataset['probe']).toBe('x');
  }
  expect(rows()[0]?.dataset['rowId']).toBe('t-1');
});
