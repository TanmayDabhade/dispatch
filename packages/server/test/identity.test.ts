import { describe, expect, test } from 'bun:test';

import { TokenRegistry } from '../src/identity.js';

const BUILT_IN = { agentToken: 'agent-aaa', appToken: 'app-bbb' };

function registry() {
  return new TokenRegistry(BUILT_IN, 'wyat');
}

describe('TokenRegistry', () => {
  test('the built-in pair keeps its tiers and now names the operator', () => {
    const reg = registry();

    // Behaviour that must not change: app token decides, agent token requests.
    expect(reg.resolve('app-bbb')).toEqual({
      handle: 'wyat',
      ref: 'human:wyat',
      tier: 'decide',
    });
    expect(reg.resolve('agent-aaa')).toEqual({
      handle: 'wyat',
      ref: 'human:wyat',
      tier: 'request',
    });
  });

  test('an unknown or absent credential resolves to nobody', () => {
    const reg = registry();

    expect(reg.resolve('nope')).toBeNull();
    expect(reg.resolve(null)).toBeNull();
    // A prefix of a real token must not pass.
    expect(reg.resolve('app-')).toBeNull();
    expect(reg.resolve('')).toBeNull();
  });

  test('an issued token tells one teammate from another', () => {
    const reg = registry();

    const ada = reg.issue('ada', 'request');
    const grace = reg.issue('grace', 'request');

    // The whole point: two humans on one daemon are no longer the same caller.
    expect(reg.resolve(ada)?.handle).toBe('ada');
    expect(reg.resolve(grace)?.handle).toBe('grace');
    expect(ada).not.toBe(grace);
  });

  test('an issued token carries the tier it was issued for', () => {
    const reg = registry();

    const requester = reg.issue('ada', 'request');
    const decider = reg.issue('ada', 'decide');

    expect(reg.resolve(requester)?.tier).toBe('request');
    expect(reg.resolve(decider)?.tier).toBe('decide');
  });

  test('re-issuing replaces the old credential rather than adding one', () => {
    const reg = registry();
    const first = reg.issue('ada', 'request');

    const second = reg.issue('ada', 'request');

    // A teammate whose laptop was lost is re-credentialed; the old token must
    // stop working the moment the new one exists.
    expect(reg.resolve(first)).toBeNull();
    expect(reg.resolve(second)?.handle).toBe('ada');
    expect(reg.list().filter((e) => e.handle === 'ada')).toHaveLength(1);
  });

  test('revoking stops a credential working', () => {
    const reg = registry();
    const ada = reg.issue('ada', 'request');

    expect(reg.revoke('ada', 'request')).toBe(true);
    expect(reg.resolve(ada)).toBeNull();
    // Revoking again is false, not an error.
    expect(reg.revoke('ada', 'request')).toBe(false);
  });

  test('the built-in pair cannot be revoked', () => {
    const reg = registry();

    // Dropping them would lock the operator out of the daemon running on
    // their own machine, with no way back short of a restart.
    expect(reg.revoke('wyat', 'decide')).toBe(false);
    expect(reg.resolve('app-bbb')?.tier).toBe('decide');
  });

  test('listing holders never discloses the credentials', () => {
    const reg = registry();
    const ada = reg.issue('ada', 'request');

    const listed = reg.list();

    expect(listed).toContainEqual({
      handle: 'ada',
      tier: 'request',
      builtIn: false,
    });
    // A list endpoint built on this must not be able to hand out tokens.
    expect(JSON.stringify(listed)).not.toContain(ada);
  });
});
