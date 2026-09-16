import { renderHook } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import type { GlobalKeyCommand } from '../lib/keyboard';
import { useGlobalKeyboard } from './useGlobalKeyboard';

// Fires a real `keydown` on `window`, optionally pre-cancelled the way Radix's dismissable
// layer cancels Escape when it closes a Select/DropdownMenu popper — before this listener
// ever sees the event, not as a side effect of it.
function dispatchKeydown(key: string, { defaultPrevented = false } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    cancelable: true,
    bubbles: true,
  });
  if (defaultPrevented) event.preventDefault();
  window.dispatchEvent(event);
  return event;
}

function mount(prefixTimeoutMs?: number) {
  const commands: GlobalKeyCommand[] = [];
  renderHook(() =>
    useGlobalKeyboard({ onCommand: (c) => commands.push(c), prefixTimeoutMs })
  );
  return commands;
}

describe('useGlobalKeyboard', () => {
  test('a plain Escape resolves to a command', () => {
    const commands = mount();
    dispatchKeydown('Escape');
    expect(commands).toEqual(['escape']);
  });

  test('an Escape a Radix popper already defaultPrevented never reaches onCommand', () => {
    const commands = mount();
    dispatchKeydown('Escape', { defaultPrevented: true });
    expect(commands).toEqual([]);
  });

  test('"g" then "s" completes the chord; the prefix key itself is swallowed', () => {
    const commands = mount();
    const g = dispatchKeydown('g');
    expect(g.defaultPrevented).toBe(true);
    expect(commands).toEqual([]);
    dispatchKeydown('s');
    expect(commands).toEqual(['goto-settings']);
    // The prefix is spent: a second "s" is nothing at the global layer.
    dispatchKeydown('s');
    expect(commands).toEqual(['goto-settings']);
  });

  test('a chord miss drops the prefix and lets the key through', () => {
    const commands = mount();
    dispatchKeydown('g');
    const miss = dispatchKeydown('z');
    expect(miss.defaultPrevented).toBe(false);
    // "c" now means "new task" again, not "g c".
    dispatchKeydown('c');
    expect(commands).toEqual(['new-task']);
  });

  test('a bare modifier keydown does not end the chord', () => {
    const commands = mount();
    dispatchKeydown('g');
    dispatchKeydown('Shift');
    dispatchKeydown('t');
    expect(commands).toEqual(['goto-tasks']);
  });

  test('the prefix expires after the chord window', async () => {
    const commands = mount(20);
    dispatchKeydown('g');
    await new Promise((resolve) => setTimeout(resolve, 60));
    dispatchKeydown('s');
    expect(commands).toEqual([]);
    // And a fresh "g" arms it again.
    dispatchKeydown('g');
    dispatchKeydown('i');
    expect(commands).toEqual(['goto-inbox']);
  });
});
