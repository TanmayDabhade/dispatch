import type { TaskDoc } from '@dispatch/core/browser';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import { type ReactElement, useState } from 'react';

import {
  AssigneeControl,
  EpicControl,
  LabelsControl,
  PriorityControl,
  StatusControl,
} from './PropertyControls';

const STATUSES = ['draft', 'ready', 'working', 'review', 'landed'];

// A menu positions itself a microtask after mount (floating-ui), so an open picker is
// rendered — and its items clicked — inside an async `act` that lets that settle.
async function settle(work: () => void) {
  await act(async () => {
    work();
    await Promise.resolve();
  });
}

function renderOpen(ui: ReactElement) {
  return settle(() => {
    render(ui);
  });
}

function epic(id: string, title: string): TaskDoc {
  return { meta: { id, title, kind: 'epic' }, body: '' } as unknown as TaskDoc;
}

/** The label picker's rows, in order, with whether each carries the check. */
function labelOptions(): { label: string; checked: boolean; dot: boolean }[] {
  return screen.getAllByRole('option').map((o) => ({
    label: o.textContent ?? '',
    checked: o.querySelector('svg.lucide-check') !== null,
    dot: o.querySelector('[data-slot=label-dot]') !== null,
  }));
}

/** cmdk selects an item on click after a pointer-down. */
function pick(name: RegExp) {
  return settle(() => {
    const option = screen.getByRole('option', { name });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
  });
}

describe('PropertyControls', () => {
  test('a row control is a 32px ghost row with the human status label', () => {
    render(
      <StatusControl
        value="working"
        statuses={STATUSES}
        onChange={() => {}}
        variant="row"
      />
    );
    const trigger = screen.getByRole('button', {
      name: 'Change status',
      description: 'Working',
    });
    expect(trigger.dataset['variant']).toBe('row');
    expect(trigger.className).toContain('h-8');
    expect(trigger.className).toContain('rounded-control');
    expect(trigger.textContent).toBe('Working');
    expect(trigger.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Status: working'
    );
  });

  test('an inline control is the glyph alone in a 20px hit area', () => {
    render(<PriorityControl value="high" onChange={() => {}} />);
    const trigger = screen.getByRole('button', {
      name: 'Change priority',
      description: 'High',
    });
    expect(trigger.dataset['variant']).toBe('inline');
    expect(trigger.className).toContain('size-5');
    // The value is there for a screen reader only.
    expect(trigger.querySelector('.sr-only')?.textContent).toBe('High');
    expect(trigger.querySelector('.truncate')).toBeNull();
    expect(trigger.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'High'
    );
  });

  test('an unset priority reads as the action that sets it, muted', () => {
    render(<PriorityControl value="none" onChange={() => {}} variant="row" />);
    const trigger = screen.getByRole('button', {
      name: 'Change priority',
      description: 'Set priority',
    });
    expect(trigger.textContent).toBe('Set priority');
    expect(trigger.dataset['unset']).toBe('true');
    expect(trigger.className).toContain('text-muted-foreground');
    // The `···` glyph still leads the row.
    expect(trigger.querySelector('svg')?.dataset['priority']).toBe('none');
  });

  test('an unassigned row says Assign; an unparented row says Add to epic', () => {
    render(
      <>
        <AssigneeControl value="none" onChange={() => {}} variant="row" />
        <EpicControl value={null} epics={[]} onChange={() => {}} />
      </>
    );
    expect(
      screen.getByRole('button', { name: 'Change assignee' }).textContent
    ).toBe('Assign');
    expect(
      screen.getByRole('button', { name: 'Change epic' }).textContent
    ).toBe('Add to epic');
  });

  test('a set row is not muted and names the assignee', () => {
    render(
      <AssigneeControl value="human:wyat" onChange={() => {}} variant="row" />
    );
    const trigger = screen.getByRole('button', { name: 'Change assignee' });
    expect(trigger.querySelector('.truncate')?.textContent).toBe('wyat');
    expect(
      trigger.querySelector('[data-slot=initials-avatar]')?.textContent
    ).toBe('WY');
    expect(trigger.dataset['unset']).toBeUndefined();
  });

  test('a controlled open renders the menu with human labels, glyphs and the S keycap', async () => {
    await renderOpen(
      <StatusControl
        value="ready"
        statuses={STATUSES}
        onChange={() => {}}
        open
        onOpenChange={() => {}}
      />
    );
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Draft',
      'Ready',
      'Working',
      'Review',
      'Landed',
    ]);
    for (const item of items) {
      expect(item.querySelector('svg[aria-label^="Status:"]')).not.toBeNull();
    }
    expect(menu.querySelector('kbd')?.textContent).toBe('S');
    expect(items[1]?.dataset['selected']).toBe('true');
    expect(items[0]?.dataset['selected']).toBeUndefined();
  });

  test('the priority menu lists No priority … Urgent under a P keycap', async () => {
    await renderOpen(
      <PriorityControl
        value="none"
        onChange={() => {}}
        open
        onOpenChange={() => {}}
      />
    );
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Urgent',
      'High',
      'Medium',
      'Low',
      'No priority',
    ]);
    expect(screen.getByRole('menu').querySelector('kbd')?.textContent).toBe(
      'P'
    );
  });

  test('picking an item reports the raw value and asks to close', async () => {
    const picked: string[] = [];
    const opens: boolean[] = [];
    await renderOpen(
      <StatusControl
        value="ready"
        statuses={STATUSES}
        onChange={(s) => picked.push(s)}
        open
        onOpenChange={(o) => opens.push(o)}
      />
    );
    await settle(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Working/ }));
    });
    expect(picked).toEqual(['working']);
    expect(opens).toEqual([false]);
  });

  test('a closed controlled picker renders no menu until its owner opens it', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            press p
          </button>
          <PriorityControl
            value="low"
            onChange={() => {}}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    render(<Harness />);
    expect(screen.queryByRole('menu')).toBeNull();
    await settle(() => {
      fireEvent.click(screen.getByText('press p'));
    });
    expect(screen.getByRole('menu')).not.toBeNull();
  });

  test('the epic menu lists No epic then every epic by title', async () => {
    await renderOpen(
      <EpicControl
        value="e-2"
        epics={[epic('e-1', 'Payments'), epic('e-2', 'Search')]}
        onChange={() => {}}
        open
        onOpenChange={() => {}}
      />
    );
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'No epic',
      'Payments',
      'Search',
    ]);
    expect(items[2]?.dataset['selected']).toBe('true');
  });

  test('the labels row face is the Add label ghost row', () => {
    render(
      <LabelsControl
        value={['ui']}
        candidates={['ui', 'api']}
        onChange={() => {}}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Add label' });
    expect(trigger.className).toContain('h-8');
    expect(trigger.className).toContain('rounded-control');
    expect(trigger.textContent).toBe('Add label');
    expect(screen.queryByRole('option')).toBeNull();
  });

  test('an inline labels control is a 20px Tag glyph unless given a face', () => {
    render(
      <>
        <LabelsControl
          value={[]}
          candidates={[]}
          onChange={() => {}}
          variant="inline"
        />
        <LabelsControl
          value={['ui']}
          candidates={[]}
          onChange={() => {}}
          variant="inline"
        >
          <span data-slot="face">ui</span>
        </LabelsControl>
      </>
    );
    const [glyph, faced] = screen.getAllByRole('button', {
      name: 'Change labels',
    });
    expect(glyph?.className).toContain('size-5');
    expect(glyph?.querySelector('svg.lucide-tag')).not.toBeNull();
    expect(faced?.querySelector('[data-slot=face]')?.textContent).toBe('ui');
    expect(faced?.querySelector('svg.lucide-tag')).toBeNull();
  });

  test('a controlled open lists every label with its dot and a check on the applied ones', async () => {
    await renderOpen(
      <LabelsControl
        value={['ui', 'local-only']}
        candidates={['ui', 'api', 'infra']}
        onChange={() => {}}
        open
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByPlaceholderText('Label…')).not.toBeNull();
    // The sorted union of the vocabulary and the task's own labels.
    expect(labelOptions()).toEqual([
      { label: 'api', checked: false, dot: true },
      { label: 'infra', checked: false, dot: true },
      { label: 'local-only', checked: true, dot: true },
      { label: 'ui', checked: true, dot: true },
    ]);
  });

  test('picking toggles membership, reports the whole list and keeps the popover open', async () => {
    const changes: string[][] = [];
    const opens: boolean[] = [];
    await renderOpen(
      <LabelsControl
        value={['ui', 'ui']}
        candidates={['ui', 'api']}
        onChange={(next) => changes.push(next)}
        open
        onOpenChange={(o) => opens.push(o)}
      />
    );
    await pick(/^api$/);
    await pick(/^ui$/);
    expect(changes).toEqual([['ui', 'api'], []]);
    expect(opens).toEqual([]);
    expect(screen.getByPlaceholderText('Label…')).not.toBeNull();
  });

  test('typing an unknown name offers Create and appends it', async () => {
    const changes: string[][] = [];
    await renderOpen(
      <LabelsControl
        value={['ui']}
        candidates={['ui', 'api']}
        onChange={(next) => changes.push(next)}
        open
        onOpenChange={() => {}}
      />
    );
    await settle(() => {
      fireEvent.change(screen.getByPlaceholderText('Label…'), {
        target: { value: 'docs' },
      });
    });
    expect(screen.queryByText('Type a new label.')).toBeNull();
    await pick(/Create “docs”/);
    expect(changes).toEqual([['ui', 'docs']]);
    // The search resets for the next pick instead of the popover closing.
    expect(screen.getByPlaceholderText<HTMLInputElement>('Label…').value).toBe(
      ''
    );
  });

  test('a case-variant of an existing label is not offered for creation', async () => {
    await renderOpen(
      <LabelsControl
        value={[]}
        candidates={['ui']}
        onChange={() => {}}
        open
        onOpenChange={() => {}}
      />
    );
    await settle(() => {
      fireEvent.change(screen.getByPlaceholderText('Label…'), {
        target: { value: 'UI' },
      });
    });
    expect(screen.queryByRole('option', { name: /Create/ })).toBeNull();
    expect(labelOptions().map((o) => o.label)).toEqual(['ui']);
  });
});
