import type { CreateInput, TaskDoc } from '@dispatch/core/browser';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'bun:test';

import {
  type CreateTaskPreset,
  type ShellActions,
  ShellActionsProvider,
} from '../shell/ShellActionsContext';
import { ToastProvider } from '../shell/Toasts';
import {
  CREATE_TASK_DESCRIPTION_KEY,
  CREATE_TASK_TITLE_KEY,
  CreateTaskModal,
} from './CreateTaskModal';

const STATUSES = ['draft', 'ready', 'working', 'review', 'landed'];

// The title/description persist to localStorage; one test's typing must not leak into
// the next mount.
beforeEach(() => {
  window.localStorage.removeItem(CREATE_TASK_TITLE_KEY);
  window.localStorage.removeItem(CREATE_TASK_DESCRIPTION_KEY);
});

function epic(id: string, title: string): TaskDoc {
  return { meta: { id, title, kind: 'epic' }, body: '' } as unknown as TaskDoc;
}

// Only `createPreset` is read; every other verb throws if reached so a test that
// accidentally drives the shell says so.
function shellActions(createPreset: CreateTaskPreset | null): ShellActions {
  const unexpected = () => {
    throw new Error('unexpected shell action');
  };
  return {
    openTask: unexpected,
    peekTask: unexpected,
    openCreateTask: unexpected,
    createPreset,
    closeCreateTask: unexpected,
    openPalette: unexpected,
    toggleSidebar: unexpected,
    sidebarHidden: false,
    openOverseer: unexpected,
    setProjectView: unexpected,
    setGlobalView: unexpected,
    openShortcuts: unexpected,
    copyTaskId: unexpected,
  };
}

function mount({
  preset = null,
  onCreate = () => Promise.resolve(),
}: {
  preset?: CreateTaskPreset | null;
  onCreate?: (input: CreateInput) => Promise<void>;
} = {}) {
  const created: CreateInput[] = [];
  let closed = 0;
  render(
    <ToastProvider>
      <ShellActionsProvider value={shellActions(preset)}>
        <CreateTaskModal
          statuses={STATUSES}
          epics={[epic('e-1', 'Search index')]}
          onCreate={(input) => {
            created.push(input);
            return onCreate(input);
          }}
          onClose={() => {
            closed += 1;
          }}
        />
      </ShellActionsProvider>
    </ToastProvider>
  );
  return { created, closed: () => closed };
}

function titleField() {
  return screen.getByLabelText<HTMLInputElement>('Task title');
}

function createButton() {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Create task' });
}

async function settle() {
  await act(async () => {});
}

test('renders the crumb header, borderless fields and property chips', () => {
  mount();
  expect(screen.getByText('New task')).toBeTruthy();
  expect(screen.getByLabelText('Close')).toBeTruthy();
  expect(screen.getByLabelText('Expand')).toBeTruthy();

  const title = titleField();
  expect(title.dataset['variant']).toBe('borderless');
  expect(title.className).toContain('text-[18px]');
  expect(title.placeholder).toBe('Task title');
  const description = screen.getByLabelText<HTMLTextAreaElement>('Description');
  expect(description.dataset['variant']).toBe('borderless');
  expect(description.placeholder).toBe('Add description…');

  // Chips read the status label and the property name while unset.
  expect(screen.getByLabelText('Status').textContent).toBe('Draft');
  const priority = screen.getByLabelText('Priority');
  expect(priority.textContent).toBe('Priority');
  expect(priority.className).toContain('h-7');
  expect(priority.dataset['unset']).toBe('true');
  expect(screen.getByLabelText('Assignee').textContent).toBe('Assignee');
  expect(screen.getByLabelText('Labels').textContent).toBe('Labels');

  // No labels, no boxed selects, no Cancel.
  expect(screen.queryByText('Title')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(screen.getByText('Create more')).toBeTruthy();
});

test('reads status, epic and milestone from the shell createPreset', async () => {
  const { created } = mount({
    preset: { status: 'review', epic: 'e-1', milestone: 'September' },
  });
  expect(screen.getByLabelText('Status').textContent).toBe('Review');
  expect(screen.getByLabelText('Epic').textContent).toBe('Search index');
  expect(screen.getByLabelText('Milestone').textContent).toBe('September');

  fireEvent.change(titleField(), { target: { value: 'Ship it' } });
  fireEvent.click(createButton());
  await settle();

  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    title: 'Ship it',
    status: 'review',
    parent: 'e-1',
    milestone: 'September',
  });
});

test('Create task is disabled until a title exists and closes on success', async () => {
  const { created, closed } = mount();
  expect(createButton().disabled).toBe(true);

  fireEvent.change(titleField(), { target: { value: '  Cache the index  ' } });
  expect(createButton().disabled).toBe(false);
  fireEvent.click(createButton());
  await settle();

  expect(created[0]?.title).toBe('Cache the index');
  expect(created[0]?.status).toBe('draft');
  expect(closed()).toBe(1);
  expect(window.localStorage.getItem(CREATE_TASK_TITLE_KEY)).toBeNull();
});

test('⌘⏎ creates from any field', async () => {
  const { created, closed } = mount();
  fireEvent.change(titleField(), { target: { value: 'Keyboard' } });
  fireEvent.keyDown(titleField(), { key: 'Enter', metaKey: true });
  await settle();

  expect(created).toHaveLength(1);
  expect(closed()).toBe(1);
});

test('Create more keeps the dialog open and clears title and description', async () => {
  const { created, closed } = mount();
  fireEvent.click(screen.getByRole('switch', { name: 'Create more' }));
  fireEvent.change(titleField(), { target: { value: 'First' } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'body' },
  });
  fireEvent.click(createButton());
  await settle();

  expect(created).toHaveLength(1);
  expect(closed()).toBe(0);
  expect(titleField().value).toBe('');
  expect(screen.getByLabelText<HTMLTextAreaElement>('Description').value).toBe(
    ''
  );
  // The chips survive for the next task.
  expect(screen.getByLabelText('Status').textContent).toBe('Draft');
});

test('Save as draft appears once a title exists and files the task as draft', async () => {
  const { created } = mount({ preset: { status: 'ready' } });
  expect(screen.queryByRole('button', { name: 'Save as draft' })).toBeNull();

  fireEvent.change(titleField(), { target: { value: 'Later' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
  await settle();

  expect(created[0]?.status).toBe('draft');
});

test('a failed create keeps the dialog open with the title intact', async () => {
  const { closed } = mount({
    onCreate: () => Promise.reject(new Error('daemon said no')),
  });
  fireEvent.change(titleField(), { target: { value: 'Keep me' } });
  fireEvent.click(createButton());
  await settle();

  expect(closed()).toBe(0);
  expect(titleField().value).toBe('Keep me');
  expect(createButton().disabled).toBe(false);
});
