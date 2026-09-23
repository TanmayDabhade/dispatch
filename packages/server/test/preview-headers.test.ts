import { describe, expect, test } from 'bun:test';

import {
  previewRequestHeaders,
  previewResponseHeaders,
} from '../src/previewHeaders.js';

describe('previewRequestHeaders', () => {
  test('never hands the dev server the viewer’s credentials', () => {
    const out = previewRequestHeaders(
      new Headers({
        cookie: 'dispatch_session=tok; other=1',
        authorization: 'Bearer tok',
        accept: 'text/html',
        'user-agent': 'x',
      })
    );
    expect(out.get('cookie')).toBeNull();
    expect(out.get('authorization')).toBeNull();
    // Everything a page needs to render still goes through.
    expect(out.get('accept')).toBe('text/html');
    expect(out.get('user-agent')).toBe('x');
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
  test('a dev server cannot set cookies in the daemon’s jar', () => {
    const upstream = new Headers({ 'content-type': 'text/html' });
    upstream.append('set-cookie', 'dispatch_session=theirs; Path=/');
    const out = previewResponseHeaders(upstream);
    expect(out.get('set-cookie')).toBeNull();
    expect(out.get('content-type')).toBe('text/html');
  });
});
