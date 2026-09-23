import { describe, expect, test } from 'bun:test';

import { PresenceTracker } from '../src/presence.js';

function tracker(start = Date.parse('2026-09-22T12:00:00.000Z')) {
  let ms = start;
  const presence = new PresenceTracker(() => new Date(ms));
  return { presence, advance: (by: number) => (ms += by) };
}

describe('PresenceTracker', () => {
  test('a person is present while any of their clients is connected', () => {
    const { presence } = tracker();

    const app = presence.connect('ada', 'human:ada');
    const tab = presence.connect('ada', 'human:ada');

    // Two clients are one person.
    expect(presence.list([])).toEqual([
      expect.objectContaining({ handle: 'ada', connections: 2 }),
    ]);
    app.release();
    expect(presence.list([]).map((p) => p.handle)).toEqual(['ada']);
    tab.release();
    expect(presence.list([])).toEqual([]);
  });

  test('only arriving and leaving count as a change', () => {
    const { presence } = tracker();

    const first = presence.connect('ada', 'human:ada');
    const second = presence.connect('ada', 'human:ada');

    // A second tab opening changes nothing anyone can see.
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.release()).toBe(false);
    expect(first.release()).toBe(true);
  });

  test('a socket closing twice cannot drag a count below what is really open', () => {
    const { presence } = tracker();
    const app = presence.connect('ada', 'human:ada');
    presence.connect('ada', 'human:ada');

    app.release();
    app.release();

    expect(presence.list([])[0]?.connections).toBe(1);
  });

  test('since is the start of the current stretch, not the first ever', () => {
    const { presence, advance } = tracker();
    presence.connect('ada', 'human:ada').release();

    advance(60_000);
    presence.connect('ada', 'human:ada');

    expect(presence.list([])[0]?.since).toBe('2026-09-22T12:01:00.000Z');
  });

  test('lists the live runs each person dispatched', () => {
    const { presence } = tracker();
    presence.connect('ada', 'human:ada');
    presence.connect('wyat', 'human:wyat');

    const listed = presence.list([
      { id: 'r-1', dispatchedBy: 'human:ada', live: true },
      { id: 'r-2', dispatchedBy: 'human:ada', live: false },
      { id: 'r-3', dispatchedBy: 'human:wyat', live: true },
      // Nobody pressed dispatch for an auto-filled run; it is no one's.
      { id: 'r-4', live: true },
    ]);

    expect(listed).toEqual([
      expect.objectContaining({ handle: 'ada', runs: ['r-1'] }),
      expect.objectContaining({ handle: 'wyat', runs: ['r-3'] }),
    ]);
  });
});
