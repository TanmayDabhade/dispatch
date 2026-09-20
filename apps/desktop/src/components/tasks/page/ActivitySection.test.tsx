import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import { parseActivity } from '../../../lib/activityFeed';
import { ActivitySection } from './ActivitySection';

const FEED = parseActivity(`
- 2026-09-13T10:00:00.000Z dispatched (claude, branch dispatch/t-1)
- 2026-09-13T11:00:00.000Z Tests pass locally. — agent:wyat/claude
- an older note
`);

function mount(onSubmitNote: (text: string) => void = () => {}) {
  render(<ActivitySection entries={FEED} onSubmitNote={onSubmitNote} />);
}

describe('ActivitySection', () => {
  test('a 15px semibold heading over timeline lines and comment cards', () => {
    mount();
    const heading = screen.getByText('Activity');
    expect(heading.tagName).toBe('H3');
    expect(heading.className).toContain('text-[15px]');
    expect(heading.className).toContain('font-semibold');

    const events = document.querySelectorAll('[data-slot="activity-event"]');
    const comments = document.querySelectorAll(
      '[data-slot="activity-comment"]'
    );
    expect(events).toHaveLength(1);
    expect(comments).toHaveLength(2);

    // The event is a 12px muted line credited to Dispatch with a 16px avatar.
    expect(events[0]?.className).toContain('text-[12px]');
    expect(events[0]?.textContent).toContain('Dispatch');
    expect(events[0]?.textContent).toContain('dispatched (claude');
    expect(
      events[0]?.querySelector('[data-slot="initials-avatar"]')?.className
    ).toContain('size-4');

    // A comment is a quaternary card with the author byline and a prose body.
    expect(comments[0]?.className).toContain('bg-surface-quaternary');
    expect(comments[0]?.className).toContain('rounded-card');
    expect(comments[0]?.textContent).toContain('claude');
    expect(
      comments[0]?.querySelector('[data-variant="prose"]')?.textContent
    ).toBe('Tests pass locally.');
  });

  test('an empty feed still offers the composer', () => {
    render(<ActivitySection entries={[]} onSubmitNote={() => {}} />);
    expect(screen.getByText('No activity yet.')).toBeTruthy();
    expect(screen.getByLabelText('Leave a comment')).toBeTruthy();
  });

  test('⌘⏎ submits the trimmed draft and clears it; plain Enter does not', () => {
    const sent: string[] = [];
    mount((text) => sent.push(text));
    const field = screen.getByLabelText<HTMLTextAreaElement>('Leave a comment');
    fireEvent.change(field, { target: { value: '  looks good  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(sent).toEqual([]);
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    expect(sent).toEqual(['looks good']);
    expect(field.value).toBe('');
  });

  test('the send button is disabled until there is text; attach is always disabled', () => {
    const sent: string[] = [];
    mount((text) => sent.push(text));
    const send = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Send comment',
    });
    expect(send.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Attach a file' })
        .disabled
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Leave a comment'), {
      target: { value: 'note' },
    });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(sent).toEqual(['note']);
  });
});
