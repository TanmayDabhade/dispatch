import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, mock, test } from 'bun:test';

import { TeamLocalGate } from '../components/shell/TeamLocalGate';
import {
  clearTeamSession,
  isTeamLocalPage,
  readTeamSession,
  saveTeamSession,
} from '../lib/teamLocal';
import { checkTeamSession, signInWithToken } from './SignInView';

function answering(status: number, body: object = {}): typeof fetch {
  return mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))
  ) as unknown as typeof fetch;
}

afterEach(() => {
  delete (globalThis as { __DISPATCH_SHARED__?: unknown }).__DISPATCH_SHARED__;
  clearTeamSession();
});

describe('signInWithToken', () => {
  test('keeps who the daemon says the token is, and never the token', async () => {
    const session = await signInWithToken(
      'http://192.0.2.2:4771',
      'tok-1',
      answering(200, { handle: 'ada', ref: 'human:ada', tier: 'request' })
    );
    expect(session).toEqual({ handle: 'ada', tier: 'request' });
    expect(JSON.stringify(session)).not.toContain('tok-1');
  });

  test('posts the token to the session route, where the daemon sets the cookie', async () => {
    const fetchImpl = answering(200, { handle: 'ada', tier: 'decide' });
    await signInWithToken('http://192.0.2.2:4771', 'tok-2', fetchImpl);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof mock>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.0.2.2:4771/api/session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-2' });
  });

  test('a revoked or mistyped token fails with a sentence, not a status code', async () => {
    await expect(
      signInWithToken('http://x', 'nope', answering(401))
    ).rejects.toThrow('not recognised');
  });

  test('an expired token says so, in the daemon’s own words', async () => {
    await expect(
      signInWithToken(
        'http://x',
        'old',
        answering(401, {
          code: 'auth_token_expired',
          error: 'this token for ada expired on 2026-01-01',
        })
      )
    ).rejects.toThrow('expired on 2026-01-01');
  });

  test('a daemon error says so', async () => {
    await expect(
      signInWithToken('http://x', 'tok', answering(503))
    ).rejects.toThrow('503');
  });
});

describe('checkTeamSession', () => {
  test('asks whoami with no credential of its own — the cookie is the credential', async () => {
    const fetchImpl = answering(200, { handle: 'ada', tier: 'operator' });
    const session = await checkTeamSession('http://192.0.2.2:4771', fetchImpl);
    expect(session).toEqual({ handle: 'ada', tier: 'operator' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof mock>).mock
      .calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('http://192.0.2.2:4771/api/whoami');
    expect(init).toBeUndefined();
  });
});

describe('team session storage', () => {
  test('round-trips, and a malformed entry reads as signed out', () => {
    saveTeamSession({ handle: 'ada', tier: 'decide' });
    expect(readTeamSession()).toEqual({ handle: 'ada', tier: 'decide' });

    // The top rung reads back too, not just the two that existed first.
    saveTeamSession({ handle: 'linus', tier: 'operator' });
    expect(readTeamSession()?.tier).toBe('operator');

    window.localStorage.setItem(
      'dispatch:team-session',
      JSON.stringify({ handle: 'ada', tier: 'admin' })
    );
    expect(readTeamSession()).toBeNull();
  });

  test('never writes a token through, even if a caller carries one', () => {
    saveTeamSession({
      handle: 'ada',
      tier: 'request',
      token: 'secret',
    } as never);
    expect(window.localStorage.getItem('dispatch:team-session')).not.toContain(
      'secret'
    );
  });
});

describe('TeamLocalGate', () => {
  test('is a no-op outside team-local mode', () => {
    expect(isTeamLocalPage()).toBe(false);
    render(
      <TeamLocalGate>
        <p>the app</p>
      </TeamLocalGate>
    );
    expect(screen.getByText('the app')).toBeTruthy();
  });

  test('on a team-local page with no credential, asks to sign in instead', () => {
    (globalThis as { __DISPATCH_SHARED__?: unknown }).__DISPATCH_SHARED__ = {
      root: '/repo',
      baseUrl: '',
    };
    expect(isTeamLocalPage()).toBe(true);
    render(
      <TeamLocalGate>
        <p>the app</p>
      </TeamLocalGate>
    );
    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.getByText('Sign in to this project')).toBeTruthy();
  });
});
