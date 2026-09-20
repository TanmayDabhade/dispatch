import { describe, expect, test } from 'bun:test';

import {
  sonnerActionsFor,
  sonnerOptionsFor,
  taskToastDescription,
  viewTaskLink,
} from './toastContract';

describe('sonnerOptionsFor', () => {
  test('errors never auto-dismiss', () => {
    expect(sonnerOptionsFor('error').duration).toBe(Infinity);
  });
  test('success and info keep their current timings', () => {
    expect(sonnerOptionsFor('success').duration).toBe(3500);
    expect(sonnerOptionsFor('info').duration).toBe(4500);
  });
});

describe('sonnerActionsFor', () => {
  const noop = () => {};

  test('a link lands in the action slot and a secondary in cancel', () => {
    const link = { label: 'View task', onClick: noop };
    const secondary = { label: 'Undo', onClick: noop };
    expect(sonnerActionsFor({ link, secondary })).toEqual({
      action: link,
      cancel: secondary,
    });
  });

  test('a plain action fills the same slot; the link wins when both are given', () => {
    const action = { label: 'Restart', onClick: noop };
    const link = { label: 'View task', onClick: noop };
    expect(sonnerActionsFor({ action })).toEqual({ action });
    expect(sonnerActionsFor({ action, link })).toEqual({ action: link });
  });

  test('nothing given means no slots at all, not undefined-valued keys', () => {
    expect(sonnerActionsFor({})).toEqual({});
  });
});

describe('task toasts', () => {
  test('the View task link opens that task', () => {
    const opened: string[] = [];
    const link = viewTaskLink('t-8f2a', (id) => opened.push(id));
    expect(link.label).toBe('View task');
    link.onClick();
    expect(opened).toEqual(['t-8f2a']);
  });

  test('the description is the id, an em dash, then the title', () => {
    expect(taskToastDescription('t-8f2a', 'Cache the search index')).toBe(
      't-8f2a — Cache the search index'
    );
  });
});
