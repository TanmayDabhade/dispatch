import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import { TaskTitle } from './TaskTitle';

function mount(onCommit: (title: string) => void = () => {}) {
  render(<TaskTitle value="Apply to the Burgess" onCommit={onCommit} />);
  return screen.getByLabelText<HTMLTextAreaElement>('Task title');
}

describe('TaskTitle', () => {
  test('is a borderless 24px semibold textarea', () => {
    const field = mount();
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.dataset['variant']).toBe('borderless');
    expect(field.className).toContain('text-[24px]');
    expect(field.className).toContain('font-semibold');
    expect(field.value).toBe('Apply to the Burgess');
  });

  test('commits the trimmed title on blur when it changed', () => {
    const committed: string[] = [];
    const field = mount((t) => committed.push(t));
    fireEvent.change(field, { target: { value: '  Apply everywhere  ' } });
    fireEvent.blur(field);
    expect(committed).toEqual(['Apply everywhere']);
  });

  test('Enter commits and does not insert a newline', () => {
    const committed: string[] = [];
    const field = mount((t) => committed.push(t));
    field.focus();
    fireEvent.change(field, { target: { value: 'Renamed' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    // The keydown handler blurs the field, and blurring is what commits.
    expect(document.activeElement).not.toBe(field);
    expect(committed).toEqual(['Renamed']);
    expect(field.value).not.toContain('\n');
  });

  test('an unchanged or emptied title commits nothing', () => {
    const committed: string[] = [];
    const field = mount((t) => committed.push(t));
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);
    expect(committed).toEqual([]);
    // The field snaps back to the persisted title rather than staying blank.
    expect(field.value).toBe('Apply to the Burgess');
  });
});
