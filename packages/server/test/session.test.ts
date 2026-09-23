import { describe, expect, test } from 'bun:test';

import {
  clearedSessionCookie,
  SESSION_COOKIE,
  sessionCookie,
  sessionOrigins,
  sessionToken,
} from '../src/session.js';

const OWN = new Set(['http://192.168.1.5:4771']);

function req(
  headers: Record<string, string>,
  url = 'http://192.168.1.5:4771/api/tasks'
) {
  return new Request(url, { headers });
}

describe('sessionToken', () => {
  const cookie = `${SESSION_COOKIE}=tok-1`;

  test('reads the cookie when the browser says the request is same-origin', () => {
    expect(
      sessionToken(req({ cookie, 'sec-fetch-site': 'same-origin' }), OWN)
    ).toBe('tok-1');
  });

  test('ignores it from any other site, including a sandboxed preview', () => {
    // A sandboxed iframe without allow-same-origin has an opaque origin, and
    // the browser reports its requests as cross-site. That is what keeps an
    // agent-written preview from acting with the viewer's session.
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(
        sessionToken(req({ cookie, 'sec-fetch-site': site }), OWN)
      ).toBeNull();
    }
  });

  // What Chromium actually sends from a plain-HTTP LAN origin, measured: no
  // fetch metadata at all, Origin on a POST and on the WebSocket upgrade, and
  // on a same-origin GET nothing either way.
  function lan(method: string, headers: Record<string, string>) {
    return new Request('http://192.168.1.5:4771/api/tasks', {
      method,
      headers,
    });
  }

  test('a same-origin GET over plain HTTP carries neither header and still counts', () => {
    expect(sessionToken(lan('GET', { cookie }), OWN)).toBe('tok-1');
  });

  test('a state change needs an Origin that is exactly the daemon’s own', () => {
    expect(
      sessionToken(
        lan('POST', { cookie, origin: 'http://192.168.1.5:4771' }),
        OWN
      )
    ).toBe('tok-1');
    // No browser sends a POST without Origin, so one arriving without it is
    // not a browser to extend the cookie to.
    expect(sessionToken(lan('POST', { cookie }), OWN)).toBeNull();
    expect(
      sessionToken(
        lan('POST', { cookie, origin: 'http://192.168.1.5:5173' }),
        OWN
      )
    ).toBeNull();
  });

  test('loopback counts only on the daemon’s own port', () => {
    const origins = new Set(sessionOrigins(4771, OWN));
    const at = (origin: string) =>
      sessionToken(lan('POST', { cookie, origin }), origins);
    // Someone at the machine running a shared daemon, in a browser tab.
    expect(at('http://127.0.0.1:4771')).toBe('tok-1');
    expect(at('http://localhost:4771')).toBe('tok-1');
    // Any other local server must not ride the session, although bearer
    // requests trust every loopback origin.
    expect(at('http://127.0.0.1:5173')).toBeNull();
  });

  test('finds its cookie among others and treats an empty one as absent', () => {
    const site = { 'sec-fetch-site': 'same-origin' };
    expect(
      sessionToken(
        req({ ...site, cookie: `a=1; ${SESSION_COOKIE}=tok-2; b=2` }),
        OWN
      )
    ).toBe('tok-2');
    expect(
      sessionToken(req({ ...site, cookie: `${SESSION_COOKIE}=` }), OWN)
    ).toBeNull();
    expect(
      sessionToken(req({ ...site, cookie: `x${SESSION_COOKIE}=tok-3` }), OWN)
    ).toBeNull();
  });
});

describe('sessionCookie', () => {
  test('is HttpOnly and SameSite=Strict, and Secure only over TLS', () => {
    const plain = sessionCookie(req({}), 'tok');
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Strict');
    expect(plain).not.toContain('Secure');

    expect(
      sessionCookie(req({}, 'https://dispatch.lan/api/session'), 'tok')
    ).toContain('Secure');
    // Behind a TLS-terminating proxy the daemon sees plain http.
    expect(
      sessionCookie(req({ 'x-forwarded-proto': 'https' }), 'tok')
    ).toContain('Secure');
  });

  test('clearing it expires it immediately', () => {
    expect(clearedSessionCookie(req({}))).toContain('Max-Age=0');
  });
});
