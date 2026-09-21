import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import { SaveViewDialog } from './SaveViewDialog';

function mount(
  overrides: Partial<React.ComponentProps<typeof SaveViewDialog>> = {}
) {
  const submitted: { name: string; favorite: boolean }[] = [];
  const openChanges: boolean[] = [];
  render(
    <SaveViewDialog
      open
      mode="create"
      onOpenChange={(open) => {
        openChanges.push(open);
      }}
      onSubmit={(result) => {
        submitted.push(result);
      }}
      {...overrides}
    />
  );
  return {
    submitted,
    openChanges,
    name: () => screen.getByLabelText<HTMLInputElement>('View name'),
    save: () => screen.getByRole('button', { name: 'Save' }),
    favorite: () => screen.queryByRole('switch', { name: 'Favorite' }),
  };
}

describe('SaveViewDialog', () => {
  test('submit reports the trimmed name and the favourite switch', () => {
    const { submitted, openChanges, name, save, favorite } = mount();
    expect(screen.getByRole('dialog', { name: 'Save view' })).toBeTruthy();
    expect(save().hasAttribute('disabled')).toBe(true);
    fireEvent.change(name(), { target: { value: '  Urgent bugs ' } });
    expect(save().hasAttribute('disabled')).toBe(false);
    // Click the label text: the switch itself double-fires under happy-dom.
    fireEvent.click(screen.getByText('Favorite'));
    expect(favorite()?.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(save());
    expect(submitted).toEqual([{ name: 'Urgent bugs', favorite: true }]);
    expect(openChanges).toEqual([false]);
  });

  test('a blank name disables Save and ⌘⏎ does nothing', () => {
    const { submitted, name, save } = mount();
    fireEvent.change(name(), { target: { value: '   ' } });
    expect(save().hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(name(), { key: 'Enter', metaKey: true });
    expect(submitted).toEqual([]);
  });

  test('⌘⏎ and Enter in the field submit', () => {
    const { submitted, name } = mount({ defaultFavorite: true });
    fireEvent.change(name(), { target: { value: 'Mine' } });
    fireEvent.keyDown(name(), { key: 'Enter', metaKey: true });
    expect(submitted).toEqual([{ name: 'Mine', favorite: true }]);
    fireEvent.keyDown(name(), { key: 'Enter' });
    expect(submitted).toHaveLength(2);
  });

  test('rename mode hides the switch, prefills and never reports a favourite', () => {
    const { submitted, name, save, favorite } = mount({
      mode: 'rename',
      initialName: 'Old name',
      defaultFavorite: true,
    });
    expect(screen.getByRole('dialog', { name: 'Rename view' })).toBeTruthy();
    expect(favorite()).toBeNull();
    expect(name().value).toBe('Old name');
    expect(save().hasAttribute('disabled')).toBe(false);
    fireEvent.click(save());
    expect(submitted).toEqual([{ name: 'Old name', favorite: false }]);
  });

  test('Cancel closes without submitting', () => {
    const { submitted, openChanges } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(submitted).toEqual([]);
    expect(openChanges).toEqual([false]);
  });
});
