import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CdpConnection, CdpError } from '../src/browser/cdp.js';
import type { CdpSocket } from '../src/browser/cdp.js';
import {
  buildPickerScript,
  CAPTURED_STYLE_PROPERTIES,
  PICK_RESULT_GLOBAL,
} from '../src/browser/pickerScript.js';
import {
  BrowserSession,
  envChromeArgs,
  findChrome,
  parseDevToolsUrl,
} from '../src/browser/session.js';

// A page with enough structure to exercise picking, clicking and filling.
const FIXTURE_HTML = `<!doctype html>
<html><head><title>Fixture</title></head>
<body style="margin:0">
  <h1 id="heading" style="color: rgb(255, 0, 0); font-size: 32px">Hello Dispatch</h1>
  <button id="go" onclick="document.getElementById('out').textContent = 'clicked'">Go</button>
  <input id="field" />
  <p id="out">idle</p>
  <p id="echo">empty</p>
  <script>
    document.getElementById('field').addEventListener('input', (e) => {
      document.getElementById('echo').textContent = e.target.value;
    });
  </script>
</body></html>`;

describe('parseDevToolsUrl', () => {
  it('reads the endpoint out of Chromium’s startup noise', () => {
    const line =
      '[1:1:0101/000000.0:ERROR:bus.cc] unrelated\nDevTools listening on ws://127.0.0.1:41234/devtools/browser/abc-123\n';
    expect(parseDevToolsUrl(line)).toBe(
      'ws://127.0.0.1:41234/devtools/browser/abc-123'
    );
  });

  it('is null before the line has arrived', () => {
    expect(parseDevToolsUrl('starting up...')).toBeNull();
  });
});

describe('findChrome', () => {
  it('prefers CHROME_PATH over anything installed', () => {
    const original = process.env.CHROME_PATH;
    process.env.CHROME_PATH = '/custom/chrome';
    try {
      expect(
        findChrome(
          'linux',
          () => true,
          () => '/usr/bin/chromium'
        )
      ).toBe('/custom/chrome');
    } finally {
      if (original === undefined) delete process.env.CHROME_PATH;
      else process.env.CHROME_PATH = original;
    }
  });

  it('falls back to PATH when no known location has one', () => {
    const original = process.env.CHROME_PATH;
    delete process.env.CHROME_PATH;
    try {
      expect(
        findChrome(
          'linux',
          () => false,
          (name) => (name === 'chromium' ? '/usr/bin/chromium' : null)
        )
      ).toBe('/usr/bin/chromium');
      expect(
        findChrome(
          'linux',
          () => false,
          () => null
        )
      ).toBeNull();
    } finally {
      if (original !== undefined) process.env.CHROME_PATH = original;
    }
  });
});

describe('envChromeArgs', () => {
  it('is empty when blank', () => {
    expect(envChromeArgs('')).toEqual([]);
    expect(envChromeArgs('   ')).toEqual([]);
  });

  it('is empty when the variable is unset', () => {
    // Passing `undefined` would select the default parameter, which reads the
    // real environment — so this has to clear the variable instead.
    const original = process.env.DISPATCH_CHROME_ARGS;
    delete process.env.DISPATCH_CHROME_ARGS;
    try {
      expect(envChromeArgs()).toEqual([]);
    } finally {
      if (original !== undefined) process.env.DISPATCH_CHROME_ARGS = original;
    }
  });

  it('splits on whitespace', () => {
    expect(envChromeArgs('--no-sandbox  --disable-dev-shm-usage')).toEqual([
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ]);
  });
});

describe('buildPickerScript', () => {
  it('captures a curated set of styles, not the whole computed block', () => {
    // The full computed style is hundreds of mostly-default properties; pasting
    // that into a prompt buries the few that describe how the element looks.
    const script = buildPickerScript();
    expect(CAPTURED_STYLE_PROPERTIES.length).toBeLessThan(40);
    for (const prop of ['color', 'font-size', 'display']) {
      expect(script).toContain(prop);
    }
  });

  it('swallows the click so the page never receives it', () => {
    const script = buildPickerScript();
    expect(script).toContain('stopImmediatePropagation');
    expect(script).toContain('preventDefault');
  });

  it('keeps its own overlay unpickable', () => {
    expect(buildPickerScript()).toContain('pointer-events:none');
  });
});

describe('CdpConnection', () => {
  // A fake CDP peer: replies to whatever is sent, on demand.
  function fakePeer() {
    const sent: string[] = [];
    let deliver: (data: string) => void = () => {};
    const socket: CdpSocket = {
      send: (data) => sent.push(data),
      close: () => {},
    };
    const connect = CdpConnection.connect('ws://fake', (_url, handlers) => {
      deliver = handlers.onMessage;
      queueMicrotask(() => handlers.onOpen());
      return socket;
    });
    return { sent, connect, reply: (data: string) => deliver(data) };
  }

  it('matches a reply to its command by id', async () => {
    const peer = fakePeer();
    const cdp = await peer.connect;
    const pending = cdp.send('Page.navigate', { url: 'https://example.com' });

    const request = JSON.parse(peer.sent[0] ?? '{}') as {
      id: number;
      method: string;
    };
    expect(request.method).toBe('Page.navigate');
    peer.reply(JSON.stringify({ id: request.id, result: { frameId: 'f1' } }));

    expect(await pending).toEqual({ frameId: 'f1' });
  });

  it('rejects when the browser answers with an error', async () => {
    const peer = fakePeer();
    const cdp = await peer.connect;
    const pending = cdp.send('DOM.querySelector');
    const request = JSON.parse(peer.sent[0] ?? '{}') as { id: number };
    peer.reply(
      JSON.stringify({ id: request.id, error: { message: 'no node' } })
    );

    await expect(pending).rejects.toThrow(CdpError);
  });

  it('keeps concurrent commands apart', async () => {
    const peer = fakePeer();
    const cdp = await peer.connect;
    const first = cdp.send('A');
    const second = cdp.send('B');
    const ids = peer.sent.map((raw) => (JSON.parse(raw) as { id: number }).id);

    // Answered out of order, which the protocol allows.
    peer.reply(JSON.stringify({ id: ids[1], result: { which: 'B' } }));
    peer.reply(JSON.stringify({ id: ids[0], result: { which: 'A' } }));

    expect(await first).toEqual({ which: 'A' });
    expect(await second).toEqual({ which: 'B' });
  });

  it('delivers events to listeners', async () => {
    const peer = fakePeer();
    const cdp = await peer.connect;
    const seen: string[] = [];
    cdp.on((event) => seen.push(event.method));
    peer.reply(JSON.stringify({ method: 'Page.loadEventFired', params: {} }));
    expect(seen).toEqual(['Page.loadEventFired']);
  });

  it('ignores a frame that is not JSON rather than tearing down', async () => {
    const peer = fakePeer();
    const cdp = await peer.connect;
    expect(() => peer.reply('not json at all')).not.toThrow();
    expect(cdp.isClosed).toBe(false);
  });

  it('fails everything in flight when the connection closes', async () => {
    const peer = fakePeer();
    const cdp = await peer.connect;
    const pending = cdp.send('Page.navigate');
    cdp.close();
    await expect(pending).rejects.toThrow('closed');
    await expect(cdp.send('Page.reload')).rejects.toThrow('closed');
  });
});

// The real thing. Everything above verifies plumbing; this verifies that the
// plumbing actually drives a browser, which is the claim that matters.
const chrome = process.env.CHROME_PATH ?? findChrome();
const fixtureDir = mkdtempSync(join(tmpdir(), 'dispatch-browser-fixture-'));
const fixturePath = join(fixtureDir, 'index.html');
writeFileSync(fixturePath, FIXTURE_HTML);

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

const describeWithChrome = chrome === null ? describe.skip : describe;

describeWithChrome('BrowserSession against a real Chromium', () => {
  async function open(): Promise<BrowserSession> {
    return BrowserSession.launch('test', {
      headless: true,
      url: `file://${fixturePath}`,
      // Chromium refuses to start its sandbox as root, which is how tests run
      // in a container. Never applied outside a test.
      extraArgs: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...(chrome === null ? {} : { executablePath: chrome }),
    });
  }

  it('launches, attaches and reads the page', async () => {
    const session = await open();
    try {
      expect(await session.textOf('#heading')).toContain('Hello Dispatch');
      expect(await session.currentUrl()).toContain('index.html');
    } finally {
      session.close();
    }
  }, 60_000);

  it('clicks an element and the page reacts', async () => {
    const session = await open();
    try {
      expect(await session.textOf('#out')).toBe('idle');
      await session.click('#go');
      expect(await session.textOf('#out')).toBe('clicked');
    } finally {
      session.close();
    }
  }, 60_000);

  it('fills a field so the page’s own listener fires', async () => {
    const session = await open();
    try {
      await session.fill('#field', 'typed by dispatch');
      // The assertion that matters: setting `value` from script does not fire
      // `input`, so a naive fill leaves every bound framework unaware.
      expect(await session.textOf('#echo')).toBe('typed by dispatch');
    } finally {
      session.close();
    }
  }, 60_000);

  it('reports a selector that matches nothing', async () => {
    const session = await open();
    try {
      // An explicit catch rather than `.rejects.toThrow`: that matcher awaits
      // the promise late enough here to observe the torn-down connection
      // instead of the rejection the call actually produced.
      let caught: unknown = null;
      try {
        await session.click('#nope');
      } catch (err) {
        caught = err;
      }
      expect((caught as Error | null)?.message).toContain('no element matches');
    } finally {
      session.close();
    }
  }, 60_000);

  it('captures a screenshot of the page and of one element', async () => {
    const session = await open();
    try {
      const full = await session.screenshot();
      // A PNG in base64 always begins with this.
      expect(full.startsWith('iVBORw0KGgo')).toBe(true);

      const clipped = await session.screenshot({
        x: 0,
        y: 0,
        width: 50,
        height: 20,
      });
      expect(clipped.startsWith('iVBORw0KGgo')).toBe(true);
      expect(clipped.length).toBeLessThan(full.length);
    } finally {
      session.close();
    }
  }, 60_000);

  it('picks an element, with its markup, styles and a cropped screenshot', async () => {
    const session = await open();
    try {
      await session.startPicking();
      expect(await session.pickResult()).toEqual({ state: 'waiting' });

      // Standing in for the user's click: the picker's own handler, invoked on
      // the element the user would have been hovering.
      await session.evaluate(
        `document.getElementById('heading').dispatchEvent(
           new MouseEvent('click', { bubbles: true })
         )`
      );

      const outcome = await session.pickResult();
      expect(outcome.state).toBe('picked');
      if (outcome.state !== 'picked') return;

      expect(outcome.element.tagName).toBe('h1');
      expect(outcome.element.id).toBe('heading');
      expect(outcome.element.selector).toBe('#heading');
      expect(outcome.element.outerHTML).toContain('Hello Dispatch');
      // The styles that describe how it looks, read from the live page.
      expect(outcome.element.styles.color).toBe('rgb(255, 0, 0)');
      expect(outcome.element.styles['font-size']).toBe('32px');
      expect(outcome.element.rect.width).toBeGreaterThan(0);
      expect(outcome.screenshot.startsWith('iVBORw0KGgo')).toBe(true);

      // The result is consumed, so the next pick starts clean.
      expect((await session.pickResult()).state).toBe('waiting');
    } finally {
      session.close();
    }
  }, 60_000);

  it('reports a cancelled pick', async () => {
    const session = await open();
    try {
      await session.startPicking();
      await session.evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`
      );
      expect((await session.pickResult()).state).toBe('cancelled');
    } finally {
      session.close();
    }
  }, 60_000);

  it('removes the picker overlay once it is done', async () => {
    const session = await open();
    try {
      await session.startPicking();
      await session.evaluate(
        `document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }))`
      );
      await session.pickResult();
      // Nothing left behind in the page the user has to clean up.
      expect(await session.evaluate(`window.${PICK_RESULT_GLOBAL}`)).toBeNull();
    } finally {
      session.close();
    }
  }, 60_000);

  it('does not let the picked click reach the page', async () => {
    const session = await open();
    try {
      await session.startPicking();
      await session.evaluate(
        `document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }))`
      );
      await session.pickResult();
      // #go's own handler would have written 'clicked'; the picker swallowed it.
      expect(await session.textOf('#out')).toBe('idle');
    } finally {
      session.close();
    }
  }, 60_000);

  it('navigates', async () => {
    const session = await open();
    try {
      await session.navigate('about:blank');
      await Bun.sleep(300);
      expect(await session.currentUrl()).toBe('about:blank');
    } finally {
      session.close();
    }
  }, 60_000);
});
