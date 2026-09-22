import { describe, expect, it } from 'bun:test';

import { createInputQueue } from './terminalInput';

// A send whose completion the test controls, so requests can be held in
// flight and released in any order.
function controlledSend() {
  const sent: string[] = [];
  const release: (() => void)[] = [];
  const send = (data: string) =>
    new Promise<void>((resolve) => {
      sent.push(data);
      release.push(resolve);
    });
  return { sent, release, send };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createInputQueue', () => {
  it('sends a lone keystroke straight away', () => {
    const { sent, send } = controlledSend();
    createInputQueue(send)('a');
    expect(sent).toEqual(['a']);
  });

  it('holds keys typed during a send and delivers them next, in order', async () => {
    const { sent, release, send } = controlledSend();
    const enqueue = createInputQueue(send);
    enqueue('e');
    enqueue('c');
    enqueue('h');
    enqueue('o');
    // Only one request is ever in flight, so nothing can overtake it.
    expect(sent).toEqual(['e']);
    release[0]?.();
    await tick();
    expect(sent).toEqual(['e', 'cho']);
    release[1]?.();
    await tick();
    expect(sent).toEqual(['e', 'cho']);
  });

  it('keeps going after a failed send', async () => {
    const sent: string[] = [];
    let fail = true;
    const enqueue = createInputQueue((data) => {
      sent.push(data);
      if (!fail) return Promise.resolve();
      fail = false;
      return Promise.reject(new Error('session just exited'));
    });
    enqueue('a');
    enqueue('b');
    await tick();
    await tick();
    expect(sent).toEqual(['a', 'b']);
  });
});
