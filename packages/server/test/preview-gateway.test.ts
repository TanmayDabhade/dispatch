import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { PreviewSupervisor } from '../src/preview.js';
import { PreviewGateway } from '../src/previewGateway.js';

// A stand-in dev server that reports what reached it, so a test can assert
// on exactly what the gateway forwarded — the thing that matters here is what
// agent-written code gets to see.
let upstream: ReturnType<typeof Bun.serve>;
let seen: {
  cookie: string | null;
  authorization: string | null;
  path: string;
}[];

beforeEach(() => {
  seen = [];
  upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seen.push({
        cookie: req.headers.get('cookie'),
        authorization: req.headers.get('authorization'),
        path: `${url.pathname}${url.search}`,
      });
      const headers = new Headers({ 'content-type': 'text/html' });
      headers.append('set-cookie', 'dispatch_session=forged; Path=/');
      headers.append('set-cookie', 'sid=app; Path=/');
      return new Response('<h1>preview</h1>', { headers });
    },
  });
});

afterEach(() => {
  gateway?.closeAll();
  void upstream.stop(true);
});

let gateway: PreviewGateway | undefined;

/** The supervisor surface the gateway reads, with a status the test sets. */
function supervisor(status: 'ready' | 'starting' = 'ready') {
  const touched: string[] = [];
  const fake = {
    get: (runId: string) =>
      runId.startsWith('r-')
        ? {
            runId,
            status,
            port: upstream.port,
            url: '',
            command: '',
            startedAt: '',
            lastRequestedAt: '',
          }
        : undefined,
    touch: (runId: string) => void touched.push(runId),
  };
  return { fake: fake as unknown as PreviewSupervisor, touched };
}

function clockAt(iso: string) {
  let now = new Date(iso);
  return {
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

/** Follows the gateway's first-load exchange the way a browser does: take
 *  the redirect's cookie, send it back on the next request. */
async function open(link: string) {
  const first = await fetch(link, { redirect: 'manual' });
  const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0];
  const target = new URL(first.headers.get('location') ?? '/', link);
  const page = await fetch(target, {
    headers: {
      cookie: `${cookie}; dispatch_session=viewer-token; sid=app-login`,
    },
  });
  return { first, cookie, page, target };
}

describe('PreviewGateway', () => {
  test('there is no link until the preview is up', () => {
    gateway = new PreviewGateway({ previews: supervisor('starting').fake });
    expect(gateway.link('r-1', '192.168.1.5')).toBeNull();
  });

  test('a link is traded for a cookie, then serves the preview on its own origin', async () => {
    const { fake, touched } = supervisor();
    gateway = new PreviewGateway({ previews: fake });
    const link = gateway.link('r-1', '127.0.0.1') ?? '';
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?dispatch_preview=/);

    const { first, page, target } = await open(link);
    expect(first.status).toBe(303);
    expect(first.headers.get('set-cookie')).toContain('HttpOnly');
    expect(first.headers.get('set-cookie')).toContain('SameSite=Strict');
    // The grant does not stay in the address bar.
    expect(target.search).toBe('');

    expect(page.status).toBe(200);
    expect(await page.text()).toBe('<h1>preview</h1>');
    expect(touched).toContain('r-1');
  });

  test('the dev server never sees a daemon credential, but the app keeps its own cookies', async () => {
    gateway = new PreviewGateway({ previews: supervisor().fake });
    const { page } = await open(gateway.link('r-1', '127.0.0.1') ?? '');
    await page.text();

    const last = seen.at(-1);
    expect(last?.cookie).toBe('sid=app-login');
    expect(last?.authorization).toBeNull();
    expect(seen.every((s) => !s.path.includes('dispatch_preview'))).toBe(true);
    // …and it cannot plant one either.
    expect(page.headers.getSetCookie()).toEqual(['sid=app; Path=/']);
  });

  test('no grant, a forged one, or one past its hour gets a sentence, not the preview', async () => {
    const clock = clockAt('2026-09-23T00:00:00Z');
    gateway = new PreviewGateway({
      previews: supervisor().fake,
      now: clock.now,
    });
    const link = gateway.link('r-1', '127.0.0.1') ?? '';
    const base = new URL(link);

    expect((await fetch(new URL('/', base))).status).toBe(403);

    const forged = new URL(link);
    const [expiry] = (forged.searchParams.get('dispatch_preview') ?? '').split(
      '.'
    );
    forged.searchParams.set('dispatch_preview', `${expiry}.AAAA`);
    expect((await fetch(forged, { redirect: 'manual' })).status).toBe(403);

    // A later expiry with the old signature does not extend it either.
    const stretched = new URL(link);
    const [, sig] = (
      stretched.searchParams.get('dispatch_preview') ?? ''
    ).split('.');
    stretched.searchParams.set(
      'dispatch_preview',
      `${Number(expiry) + 86_400_000}.${sig}`
    );
    expect((await fetch(stretched, { redirect: 'manual' })).status).toBe(403);

    clock.advance(60 * 60 * 1000);
    const late = await fetch(link, { redirect: 'manual' });
    expect(late.status).toBe(403);
    expect(await late.text()).toContain('Open the preview from the task');
    expect(seen).toHaveLength(0);
  });

  test('a grant for one run opens no other run’s preview', async () => {
    gateway = new PreviewGateway({ previews: supervisor().fake });
    const forOne = new URL(gateway.link('r-1', '127.0.0.1') ?? '');
    const other = new URL(gateway.link('r-2', '127.0.0.1') ?? '');
    other.search = forOne.search;
    expect((await fetch(other, { redirect: 'manual' })).status).toBe(403);
  });

  test('closing a preview closes its port', async () => {
    gateway = new PreviewGateway({ previews: supervisor().fake });
    const link = gateway.link('r-1', '127.0.0.1') ?? '';
    gateway.close('r-1');
    const outcome = await fetch(link, { redirect: 'manual' }).then(
      () => 'answered',
      () => 'refused'
    );
    expect(outcome).toBe('refused');
  });

  test('one listener per run, however often the link is asked for', () => {
    gateway = new PreviewGateway({ previews: supervisor().fake });
    const a = new URL(gateway.link('r-1', '127.0.0.1') ?? '').port;
    const b = new URL(gateway.link('r-1', '127.0.0.1') ?? '').port;
    const c = new URL(gateway.link('r-2', '127.0.0.1') ?? '').port;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
