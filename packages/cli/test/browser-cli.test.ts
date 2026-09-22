import { describe, expect, it } from 'bun:test';

import type { PickOutcome } from '../src/apiClient.js';
import { pollForPick } from '../src/commands/browser.js';

// A stand-in for the daemon: answers `waiting` a few times, then whatever the
// test wants to happen next.
function stubApi(outcomes: PickOutcome[]): {
  api: { browserPickResult: () => Promise<PickOutcome> };
  calls: () => number;
} {
  let index = 0;
  return {
    api: {
      browserPickResult: () => {
        const outcome = outcomes[Math.min(index, outcomes.length - 1)];
        index += 1;
        return Promise.resolve(outcome ?? { state: 'waiting' });
      },
    },
    calls: () => index,
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

describe('pollForPick', () => {
  it('returns as soon as something is picked', async () => {
    const picked: PickOutcome = {
      state: 'picked',
      screenshot: 'AAAA',
      element: {
        selector: '#title',
        tagName: 'h1',
        id: 'title',
        className: null,
        text: 'Hi',
        outerHTML: '<h1 id="title">Hi</h1>',
        outerHTMLTruncated: false,
        styles: { color: 'red' },
        rect: { x: 0, y: 0, width: 10, height: 10 },
        devicePixelRatio: 1,
        url: 'about:blank',
      },
    };
    const stub = stubApi([{ state: 'waiting' }, { state: 'waiting' }, picked]);

    const outcome = await pollForPick(stub.api, 'b1', 10_000, noSleep);
    expect(outcome).toEqual(picked);
    // It kept asking rather than giving up on the first `waiting`.
    expect(stub.calls()).toBe(3);
  });

  it('returns a cancellation', async () => {
    const stub = stubApi([{ state: 'waiting' }, { state: 'cancelled' }]);
    expect(await pollForPick(stub.api, 'b1', 10_000, noSleep)).toEqual({
      state: 'cancelled',
    });
  });

  it('gives up rather than blocking a script forever', async () => {
    // Nothing is ever picked; the loop has to end on its own.
    const stub = stubApi([{ state: 'waiting' }]);
    expect(await pollForPick(stub.api, 'b1', 0, noSleep)).toEqual({
      state: 'waiting',
    });
  });

  it('checks at least once even with no time budget', async () => {
    // A pick that already happened must be reported, not timed out.
    const stub = stubApi([{ state: 'cancelled' }]);
    expect(await pollForPick(stub.api, 'b1', 0, noSleep)).toEqual({
      state: 'cancelled',
    });
    expect(stub.calls()).toBe(1);
  });
});
