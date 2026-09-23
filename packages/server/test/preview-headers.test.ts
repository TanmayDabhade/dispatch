import { describe, expect, test } from 'bun:test';

import {
  previewRequestHeaders,
  previewResponseHeaders,
} from '../src/previewHeaders.js';

describe('previewRequestHeaders', () => {
  test('never hands the dev server the viewer’s credentials', () => {
    const out = previewRequestHeaders(
      new Headers({
        cookie: 'dispatch_session=tok; dispatch_preview_5173=cap',
        authorization: 'Bearer tok',
        accept: 'text/html',
      })
    );
    expect(out.get('cookie')).toBeNull();
    expect(out.get('authorization')).toBeNull();
    expect(out.get('accept')).toBe('text/html');
  });

  test('the app being previewed keeps its own cookies', () => {
    const out = previewRequestHeaders(
      new Headers({ cookie: 'sid=app-login; dispatch_session=tok; theme=dark' })
    );
    expect(out.get('cookie')).toBe('sid=app-login; theme=dark');
  });

  test('still drops hop-by-hop headers', () => {
    const out = previewRequestHeaders(
      new Headers({ connection: 'keep-alive', upgrade: 'websocket' })
    );
    expect(out.get('connection')).toBeNull();
    expect(out.get('upgrade')).toBeNull();
  });
});

describe('previewResponseHeaders', () => {
  test('a dev server cannot set the daemon’s cookies, but can set its own', () => {
    const upstream = new Headers({ 'content-type': 'text/html' });
    upstream.append('set-cookie', 'dispatch_session=theirs; Path=/');
    upstream.append('set-cookie', 'sid=app; Path=/; HttpOnly');
    upstream.append('set-cookie', ' dispatch_preview_1=x; Path=/');

    const out = previewResponseHeaders(upstream);

    // Several Set-Cookie headers stay separate through the filter rather than
    // being folded into one comma-joined value it could not tell apart.
    expect(out.getSetCookie()).toEqual(['sid=app; Path=/; HttpOnly']);
    expect(out.get('content-type')).toBe('text/html');
  });
});
