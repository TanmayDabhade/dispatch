import type { SyncStatus } from '@dispatch/client';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { FrameStatusStrip } from './FrameStatusStrip';
import { TooltipProvider } from '@/ui/tooltip';

function status(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    pushed: 0,
    pulled: 0,
    state: 'idle',
    detail: null,
    pendingOutgoing: 0,
    pendingIncoming: 0,
    lastSyncedAt: null,
    mergeDriverWarning: null,
    receipts: {
      state: 'disabled',
      detail: null,
      commit: null,
      changed: 0,
      removed: 0,
      problems: 0,
      lastExportedAt: null,
    },
    ...overrides,
  };
}

const props = {
  syncStatus: null as SyncStatus | null,
  onDisableAutoCommit: () => {},
  spendToday: null as number | null,
  onOpenShortcuts: () => {},
  onOpenOverseer: () => {},
};

// The strip's tooltips need the provider the app's `SidebarProvider` supplies.
function mount(overrides: Partial<typeof props> = {}) {
  return render(
    <TooltipProvider>
      <FrameStatusStrip {...props} {...overrides} />
    </TooltipProvider>
  );
}

test('the ? button opens the shortcuts reference', () => {
  let opened = 0;
  mount({
    onOpenShortcuts: () => {
      opened += 1;
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
  expect(opened).toBe(1);
});

test('no pill until the first sync status arrives', () => {
  const { container } = mount();
  expect(container.querySelector('[data-slot="sync-pill"]')).toBeNull();
});

test('"Auto-commit off" is offered only while the board syncer runs', () => {
  let disabled = 0;
  const { rerender } = render(
    <TooltipProvider>
      <FrameStatusStrip
        {...props}
        syncStatus={status()}
        onDisableAutoCommit={() => {
          disabled += 1;
        }}
      />
    </TooltipProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Auto-commit off' }));
  expect(disabled).toBe(1);

  rerender(
    <TooltipProvider>
      <FrameStatusStrip {...props} syncStatus={status({ state: 'off' })} />
    </TooltipProvider>
  );
  expect(screen.queryByRole('button', { name: 'Auto-commit off' })).toBeNull();
  expect(screen.getByText(/Board sync is off/)).toBeTruthy();
});

test('the pill becomes focusable and mirrors its detail lines when it has any', () => {
  const { container, rerender } = render(
    <TooltipProvider>
      <FrameStatusStrip {...props} syncStatus={status()} />
    </TooltipProvider>
  );
  const bare = container.querySelector('[data-slot="sync-pill"]');
  expect(bare?.getAttribute('tabindex')).toBeNull();

  rerender(
    <TooltipProvider>
      <FrameStatusStrip
        {...props}
        syncStatus={status({ pendingOutgoing: 2, pendingIncoming: 1 })}
      />
    </TooltipProvider>
  );
  const pill = container.querySelector('[data-slot="sync-pill"]');
  expect(pill?.getAttribute('tabindex')).toBe('0');
  expect(pill?.textContent).toContain('2 to push. 1 incoming');
});

test('spend shows only once there is spend', () => {
  const { rerender } = mount({ spendToday: 0 });
  expect(screen.queryByText(/today$/)).toBeNull();
  rerender(
    <TooltipProvider>
      <FrameStatusStrip {...props} spendToday={4.5} />
    </TooltipProvider>
  );
  expect(screen.getByText('$4.50 today')).toBeTruthy();
});

test('the Overseer link opens the overseer', () => {
  let opened = 0;
  mount({
    onOpenOverseer: () => {
      opened += 1;
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Overseer' }));
  expect(opened).toBe(1);
});
