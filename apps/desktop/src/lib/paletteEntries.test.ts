import { describe, expect, test } from 'bun:test';

import type { PaletteEntriesContext, PaletteSection } from './paletteEntries';
import { buildPaletteEntries } from './paletteEntries';

function context(over: Partial<PaletteEntriesContext> = {}) {
  const calls: string[] = [];
  const ctx: PaletteEntriesContext = {
    hasProject: true,
    views: [
      { id: 'inbox', label: 'Inbox' },
      { id: 'overview', label: 'Control room' },
      { id: 'board', label: 'Tasks' },
    ],
    tasks: [
      { meta: { id: 't-1', title: 'Wire the thing' } },
      { meta: { id: 't-2', title: 'Blocked one' } },
    ],
    readyIds: new Set(['t-1']),
    dev: false,
    actions: {
      openCreateTask: () => calls.push('create'),
      openQuickAddTask: () => calls.push('quick-add'),
      setProjectView: (view) => calls.push(`project:${view}`),
      setGlobalView: (view) => calls.push(`global:${view}`),
      peekTask: (id) => calls.push(`peek:${id}`),
      dispatchTask: (id) => calls.push(`dispatch:${id}`),
      openQuickCapture: () => calls.push('capture'),
      toggleSidebar: () => calls.push('sidebar'),
      openShortcuts: () => calls.push('shortcuts'),
    },
    ...over,
  };
  return { ctx, calls };
}

describe('buildPaletteEntries', () => {
  test('groups rows into actions, navigation and tasks in that order', () => {
    const { ctx } = context();
    const sections = buildPaletteEntries(ctx).map((e) => e.section);
    const firstOf = (s: PaletteSection) => sections.indexOf(s);
    expect(firstOf('actions')).toBeLessThan(firstOf('navigation'));
    expect(firstOf('navigation')).toBeLessThan(firstOf('tasks'));
    // No row sits outside its group.
    expect(sections.lastIndexOf('actions')).toBeLessThan(firstOf('navigation'));
    expect(sections.lastIndexOf('navigation')).toBeLessThan(firstOf('tasks'));
  });

  test('Go-to rows carry ⌘N by rail position; new task is C; Overseer is G A', () => {
    const { ctx } = context();
    const byId = new Map(buildPaletteEntries(ctx).map((e) => [e.id, e]));
    expect(byId.get('go-inbox')?.shortcut).toBe('⌘1');
    expect(byId.get('go-overview')?.shortcut).toBe('⌘2');
    expect(byId.get('go-board')?.shortcut).toBe('⌘3');
    expect(byId.get('action-new-task')?.shortcut).toBe('C');
    expect(byId.get('go-overseer')?.shortcut).toBe('G A');
    expect(byId.get('go-settings')?.shortcut).toBe('G S');
    expect(byId.get('action-toggle-sidebar')?.shortcut).toBe('[');
    expect(byId.get('action-shortcuts')?.shortcut).toBe('?');
  });

  test('every task gets a row, and only ready tasks get a Dispatch row', () => {
    const { ctx, calls } = context();
    const byId = new Map(buildPaletteEntries(ctx).map((e) => [e.id, e]));
    expect(byId.get('task-t-1')?.sublabel).toBe('t-1');
    expect(byId.get('task-t-2')?.kind).toBe('task');
    expect(byId.has('dispatch-t-1')).toBe(true);
    expect(byId.has('dispatch-t-2')).toBe(false);
    byId.get('task-t-2')?.run();
    byId.get('dispatch-t-1')?.run();
    expect(calls).toEqual(['peek:t-2', 'dispatch:t-1']);
  });

  test('without a project only the global rows remain', () => {
    const { ctx } = context({ hasProject: false });
    const ids = buildPaletteEntries(ctx).map((e) => e.id);
    expect(ids).toEqual([
      'action-toggle-sidebar',
      'action-shortcuts',
      'go-all-agents',
      'go-sessions',
      'go-overseer',
      'go-settings',
    ]);
  });

  test('the Gallery row exists only in a dev build', () => {
    expect(
      buildPaletteEntries(context({ dev: true }).ctx).some(
        (e) => e.id === 'go-gallery'
      )
    ).toBe(true);
    expect(
      buildPaletteEntries(context().ctx).some((e) => e.id === 'go-gallery')
    ).toBe(false);
  });

  test('a tenth rail view has no ⌘N hint', () => {
    const views = Array.from({ length: 10 }, (_, i) => ({
      id: 'board' as const,
      label: `View ${i}`,
    }));
    const { ctx } = context({ views, tasks: [] });
    const rows = buildPaletteEntries(ctx).filter((e) => e.kind === 'go to');
    expect(rows[8]?.shortcut).toBe('⌘9');
    expect(rows[9]?.shortcut).toBeUndefined();
  });
});
