import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, mock, test } from 'bun:test';

import { TeamLocalGate } from '../components/shell/TeamLocalGate';
import {
  clearTeamCredential,
  isTeamLocalPage,
  readTeamCredential,
  saveTeamCredential,
} from '../lib/teamLocal';
import { verifyTeamToken } from './SignInView';

function answering(status: number, body: object = {}): typeof fetch {
  return mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))
  ) as unknown as typeof fetch;
}

afterEach(() => {
  delete (globalThis as { __DISPATCH_SHARED__?: unknown }).__DISPATCH_SHARED__;
  clearTeamCredential();
});

describe('verifyTeamToken', () => {
  test('keeps who the daemon says the token is, not what was typed', async () => {
    const credential = await verifyTeamToken(
      'http://192.0.2.2:4771',
      'tok-1',
      answering(200, { handle: 'ada', ref: 'human:ada', tier: 'request' })
    );
    expect(credential).toEqual({
      token: 'tok-1',
      handle: 'ada',
      tier: 'request',
    });
  });

  test('a revoked or mistyped token fails with a sentence, not a status code', async () => {
    await expect(
      verifyTeamToken('http://x', 'nope', answering(401))
    ).rejects.toThrow('not recognised');
  });

  test('a daemon error says so', async () => {
    await expect(
      verifyTeamToken('http://x', 'tok', answering(503))
    ).rejects.toThrow('503');
  });

  test('sends the token as a bearer credential to whoami', async () => {
    const fetchImpl = answering(200, { handle: 'ada', tier: 'decide' });
    await verifyTeamToken('http://192.0.2.2:4771', 'tok-2', fetchImpl);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof mock>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.0.2.2:4771/api/whoami');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok-2'
    );
  });
});

describe('team credential storage', () => {
  test('round-trips, and a malformed entry reads as signed out', () => {
    saveTeamCredential({ token: 't', handle: 'ada', tier: 'decide' });
    expect(readTeamCredential()).toEqual({
      token: 't',
      handle: 'ada',
      tier: 'decide',
    });

    // The top rung reads back too, not just the two that existed first.
    saveTeamCredential({ token: 't', handle: 'linus', tier: 'operator' });
    expect(readTeamCredential()?.tier).toBe('operator');

    window.localStorage.setItem(
      'dispatch:team-credential',
      JSON.stringify({ token: 't', handle: 'ada', tier: 'admin' })
    );
    expect(readTeamCredential()).toBeNull();
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
